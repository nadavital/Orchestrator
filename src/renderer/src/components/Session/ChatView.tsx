import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { ReactNode, WheelEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import Icon from '../shared/Icon'
import {
  AttachmentPill,
  Button,
  DisclosureSection,
  IconButton,
  MarkdownSurface,
  ScrollEdgeButton,
  StatusBadge,
  SurfaceRow,
  ThinkingDots,
  WorkbenchSearchField,
} from '../shared/designSystem'
import {
  describeToolAction,
  describeToolActivity,
  diffForPathFromUnifiedDiff,
  extractFileReferences,
  extractWorkspaceRootsFromText,
  pairToolActivities,
  parseFileChangesFromUnifiedDiff,
  permissionRequestDetail,
  summarizeToolActivities
} from '../../types'
import type { Session, ChatMessage, FileChange, FileReference, ResultMessage, SessionRunEventRecord, ToolResultMessage, ToolUseMessage, UserInputQuestion } from '../../types'
import type { Attachment } from '../../types'
import type { TranscriptSearchResult } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import { markRendererStart, recordRendererMetric } from '../../performance'

type PreferredEditor = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
interface TranscriptPrependAnchor {
  scrollHeight: number
  scrollTop: number
  messageId?: string
  messageTop?: number
  estimatedPrependedHeight?: number
}

interface Props {
  sessionId: string
}

const TOOL_SUMMARY_SCROLL_THRESHOLD = 8
const TOOL_SUMMARY_MAX_HEIGHT = 220
const FOLLOW_BOTTOM_THRESHOLD = 80
const USER_MESSAGE_COLLAPSE_LENGTH = 1400
const USER_MESSAGE_COLLAPSE_MIN_BREAK = 980
const TRANSCRIPT_RENDER_CHUNK = 40
const TRANSCRIPT_LAZY_LOAD_TOP_THRESHOLD = 360
const TRANSCRIPT_VIRTUAL_OVERSCAN = 900
const EMPTY_STATE_SUGGESTIONS = [
  {
    label: 'Review this branch',
    prompt: 'Review the current branch and call out the highest-impact correctness, usability, and test gaps.'
  },
  {
    label: 'Fix a flaky test',
    prompt: 'Find the likely cause of the flaky test, make the smallest safe fix, and run the targeted test that proves it.'
  },
  {
    label: 'Plan the next slice',
    prompt: 'Inspect the current app state and propose the next small implementation slice with the exact validation it should pass.'
  }
]

type DiffUpdatedRunEvent = Extract<SessionRunEventRecord['event'], { type: 'diff.updated' }>
type ProviderCheckpointUndoStatus = 'not-applicable' | 'missing-checkpoint' | 'unsupported'
const TRANSCRIPT_VIRTUAL_ROW_GAP = 14

export default function ChatView({ sessionId }: Props): JSX.Element {
  const session = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId))
  if (!session) return <></>
  return <ChatViewContent session={session} />
}

function ChatViewContent({ session }: { session: Session }): JSX.Element {
  const projectName = useProjectStore((state) => state.projects.find((project) => project.id === session.projectId)?.name)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const shouldFollowBottomRef = useRef(true)
  const pendingScrollFrameRef = useRef<number | null>(null)
  const loadingEarlierRef = useRef(false)
  const transcriptListRef = useRef<HTMLDivElement>(null)
  const measuredRowHeightsRef = useRef<Record<string, number>>({})
  const prependAnchorRef = useRef<TranscriptPrependAnchor | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>('system')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TranscriptSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [sharedFindActive, setSharedFindActive] = useState(false)
  const [sharedSearchActiveResultIndex, setSharedSearchActiveResultIndex] = useState(0)
  const [renderLimit, setRenderLimit] = useState(() => Math.min(session.messages.length, TRANSCRIPT_RENDER_CHUNK))
  const [scrollMetrics, setScrollMetrics] = useState({ top: 0, height: 0, listOffsetTop: 0 })
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  const [transcriptActionStatus, setTranscriptActionStatus] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)

  useEffect(() => {
    const globals = window as typeof window & { __orchestratorChatViewCommitCount?: number }
    if (typeof globals.__orchestratorChatViewCommitCount === 'number') {
      globals.__orchestratorChatViewCommitCount += 1
    }
  })

  const visibleMessages = useMemo(() => {
    if (session.messages.length <= renderLimit) return session.messages
    return session.messages.slice(-renderLimit)
  }, [renderLimit, session.messages])
  const totalMessageCount = session.messageCount ?? session.messages.length
  const hiddenMessageCount = Math.max(0, totalMessageCount - visibleMessages.length)
  const transcriptItems = useMemo(() => groupTranscriptMessages(visibleMessages), [visibleMessages])
  const fileReferenceRoots = useMemo(() => sessionFileReferenceRoots(session), [session])
  const hasStreamingAssistantMessage = useMemo(() => (
    visibleMessages.some((message) => (
      message.type === 'text' &&
      message.role === 'assistant' &&
      message.isStreaming === true
    ))
  ), [visibleMessages])
  const showThinkingIndicator = isActiveSessionStatus(session.status) || hasStreamingAssistantMessage
  const lastMessage = session.messages[session.messages.length - 1]
  const lastTextLength = lastMessage?.type === 'text' ? lastMessage.content.length : 0
  const lastAssistantTextId = useMemo(() => {
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index]
      if (message.type === 'text' && message.role === 'assistant' && message.content.trim()) return message.id
    }
    return null
  }, [session.messages])
  const loadedHiddenCount = Math.max(0, session.messages.length - visibleMessages.length)
  const unloadedBeforeCount = Math.max(0, totalMessageCount - session.messages.length)
  const virtualWindow = useMemo(() => buildVirtualTranscriptWindow(
    transcriptItems,
    measuredRowHeightsRef.current,
    Math.max(0, scrollMetrics.top - scrollMetrics.listOffsetTop),
    scrollMetrics.height || 800
  ), [rowMeasurementVersion, scrollMetrics.height, scrollMetrics.listOffsetTop, scrollMetrics.top, transcriptItems])

  useEffect(() => {
    loadingEarlierRef.current = loadingEarlier
  }, [loadingEarlier])

  useEffect(() => {
    setTranscriptActionStatus(null)
  }, [session.id])

  const steerQueuedMessage = useCallback(async (messageId: string): Promise<void> => {
    setTranscriptActionStatus({ text: 'Steering follow-up', tone: 'info' })
    try {
      await window.api.sessions.steerQueuedMessage(session.id, messageId)
      setTranscriptActionStatus({ text: 'Follow-up will steer next', tone: 'info' })
    } catch (error) {
      setTranscriptActionStatus({ text: `Steer failed: ${errorText(error)}`, tone: 'danger' })
    }
  }, [session.id])

  const cancelQueuedMessage = useCallback(async (messageId: string, queueState: 'queued' | 'steer_next'): Promise<void> => {
    const label = queueState === 'steer_next' ? 'steering message' : 'queued message'
    setTranscriptActionStatus({ text: `Canceling ${label}`, tone: 'info' })
    try {
      await window.api.sessions.cancelQueuedMessage(session.id, messageId)
      setTranscriptActionStatus({ text: queueState === 'steer_next' ? 'Steering message canceled' : 'Queued message canceled', tone: 'info' })
    } catch (error) {
      setTranscriptActionStatus({ text: `Cancel failed: ${errorText(error)}`, tone: 'danger' })
    }
  }, [session.id])

  const updateScrollMetrics = useCallback(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const nextMetrics = {
      top: scroller.scrollTop,
      height: scroller.clientHeight,
      listOffsetTop: transcriptListRef.current?.offsetTop ?? 0
    }
    setScrollMetrics((current) => (
      Math.abs(current.top - nextMetrics.top) < 1 &&
      Math.abs(current.height - nextMetrics.height) < 1 &&
      Math.abs(current.listOffsetTop - nextMetrics.listOffsetTop) < 1
        ? current
        : nextMetrics
    ))
  }, [])

  useLayoutEffect(() => {
    updateScrollMetrics()
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const observer = new ResizeObserver(updateScrollMetrics)
    observer.observe(scroller)
    if (transcriptListRef.current) observer.observe(transcriptListRef.current)
    return () => observer.disconnect()
  }, [session.id, updateScrollMetrics])

  useEffect(() => {
    let cancelled = false
    window.api.settings.get().then((settings) => {
      if (cancelled) return
      setPreferredEditor(normalizePreferredEditor(settings.preferredEditor))
    })
    return () => { cancelled = true }
  }, [])

  const setFollowingBottom = useCallback((isFollowing: boolean) => {
    const shouldShowJumpButton = !isFollowing
    shouldFollowBottomRef.current = isFollowing
    setShowJumpToLatest((current) => current === shouldShowJumpButton ? current : shouldShowJumpButton)
  }, [])

  const stopFollowingBottom = useCallback(() => {
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current)
      pendingScrollFrameRef.current = null
    }
    setFollowingBottom(false)
  }, [setFollowingBottom])

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) stopFollowingBottom()
  }, [stopFollowingBottom])

  const handleTouchStart = useCallback(() => {
    stopFollowingBottom()
  }, [stopFollowingBottom])

  const readVisiblePrependAnchor = useCallback((): TranscriptPrependAnchor | null => {
    const scroller = scrollContainerRef.current
    if (!scroller) return null
    const scrollerRect = scroller.getBoundingClientRect()
    const scrollerTop = scrollerRect.top
    const messages = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'))
    const firstMessage = messages.find((message) => {
      const rect = message.getBoundingClientRect()
      return rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom
    }) ?? messages[0]
    return {
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      messageId: firstMessage?.dataset.messageId,
      messageTop: firstMessage ? firstMessage.getBoundingClientRect().top - scrollerTop : undefined
    }
  }, [])

  const capturePrependAnchor = useCallback((anchor?: TranscriptPrependAnchor | null) => {
    if (prependAnchorRef.current) return
    prependAnchorRef.current = anchor ?? readVisiblePrependAnchor()
  }, [readVisiblePrependAnchor])

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current
    const scroller = scrollContainerRef.current
    if (!anchor || !scroller) return
    const restoreAnchor = (): void => {
      const currentScroller = scrollContainerRef.current
      if (!currentScroller) return
      if (anchor.messageId && typeof anchor.messageTop === 'number') {
        const scrollerTop = currentScroller.getBoundingClientRect().top
        const anchoredMessage = currentScroller.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.messageId)}"]`)
        if (anchoredMessage) {
          const nextMessageTop = anchoredMessage.getBoundingClientRect().top - scrollerTop
          currentScroller.scrollTop += nextMessageTop - anchor.messageTop
          return
        }
        const estimatedOffset = transcriptItemOffset(anchor.messageId, transcriptItems, measuredRowHeightsRef.current)
        if (estimatedOffset !== null) {
          currentScroller.scrollTop = (transcriptListRef.current?.offsetTop ?? 0) + estimatedOffset - anchor.messageTop
          return
        }
      }
      if (typeof anchor.estimatedPrependedHeight === 'number') {
        currentScroller.scrollTop = anchor.scrollTop + anchor.estimatedPrependedHeight
        return
      }
      const heightDelta = currentScroller.scrollHeight - anchor.scrollHeight
      currentScroller.scrollTop = anchor.scrollTop + Math.max(0, heightDelta)
    }
    restoreAnchor()
    const frame = window.requestAnimationFrame(() => {
      restoreAnchor()
      prependAnchorRef.current = null
      updateScrollMetrics()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [session.messages.length, renderLimit, transcriptItems, updateScrollMetrics])

  const scrollToBottom = useCallback((force = false) => {
    if (force) {
      const scroller = scrollContainerRef.current
      if (scroller) scroller.scrollTop = scroller.scrollHeight
      setFollowingBottom(true)
      updateScrollMetrics()
      return
    }
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current)
    }
    pendingScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null
      if (!force && !shouldFollowBottomRef.current) return
      const scroller = scrollContainerRef.current
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight
        updateScrollMetrics()
      } else {
        bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      }
    })
  }, [setFollowingBottom, updateScrollMetrics])

  const handleVirtualRowHeight = useCallback((id: string, height: number) => {
    const previous = measuredRowHeightsRef.current[id]
    if (previous && Math.abs(previous - height) < 1) return
    measuredRowHeightsRef.current = {
      ...measuredRowHeightsRef.current,
      [id]: height
    }
    setRowMeasurementVersion((version) => version + 1)
    updateScrollMetrics()
  }, [updateScrollMetrics])

  const schedulePrependScrollCompensation = useCallback((anchor: TranscriptPrependAnchor | null, estimatedHeight: number) => {
    if (!anchor || estimatedHeight <= 0) return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scroller = scrollContainerRef.current
        if (!scroller) return
        scroller.scrollTop = anchor.scrollTop + estimatedHeight
        updateScrollMetrics()
      })
    })
  }, [updateScrollMetrics])

  const handleLoadEarlier = useCallback(async (
    source: 'manual' | 'auto' = 'manual',
    anchor?: TranscriptPrependAnchor | null
  ) => {
    if (loadingEarlierRef.current) return
    capturePrependAnchor(anchor)
    if (loadedHiddenCount > 0) {
      const nextRenderLimit = Math.min(session.messages.length, renderLimit + TRANSCRIPT_RENDER_CHUNK)
      const previousStart = Math.max(0, session.messages.length - renderLimit)
      const nextStart = Math.max(0, session.messages.length - nextRenderLimit)
      const anchorToRestore = prependAnchorRef.current
      const estimatedPrependedHeight = estimateTranscriptMessagesHeight(session.messages.slice(nextStart, previousStart))
      if (prependAnchorRef.current) {
        prependAnchorRef.current.estimatedPrependedHeight = estimatedPrependedHeight
      }
      loadingEarlierRef.current = true
      setRenderLimit(nextRenderLimit)
      schedulePrependScrollCompensation(anchorToRestore, estimatedPrependedHeight)
      window.requestAnimationFrame(() => {
        loadingEarlierRef.current = false
      })
      recordRendererMetric('transcript.lazy.render-loaded', markRendererStart(), {
        sessionId: session.id,
        source,
        renderedMessages: Math.min(session.messages.length, renderLimit + TRANSCRIPT_RENDER_CHUNK)
      })
      return
    }
    const beforeMessageId = session.messages[0]?.id
    if (!beforeMessageId || unloadedBeforeCount <= 0) {
      prependAnchorRef.current = null
      return
    }
    loadingEarlierRef.current = true
    setLoadingEarlier(true)
    const startedAt = markRendererStart()
    try {
      const page = await window.api.sessions.getTranscriptPage(session.id, { beforeMessageId, limit: TRANSCRIPT_RENDER_CHUNK })
      if (page) {
        const anchorToRestore = prependAnchorRef.current
        const estimatedPrependedHeight = estimateTranscriptMessagesHeight(page.messages)
        if (prependAnchorRef.current) {
          prependAnchorRef.current.estimatedPrependedHeight = estimatedPrependedHeight
        }
        useSessionStore.getState().mergeTranscriptPage(session.id, page, 'prepend')
        setRenderLimit((current) => Math.min(current + page.messages.length, current + TRANSCRIPT_RENDER_CHUNK))
        schedulePrependScrollCompensation(anchorToRestore, estimatedPrependedHeight)
        recordRendererMetric('transcript.page.prepend-ready', startedAt, {
          sessionId: session.id,
          source,
          messages: page.messages.length,
          hasMoreBefore: page.hasMoreBefore
        })
      } else {
        prependAnchorRef.current = null
      }
    } finally {
      loadingEarlierRef.current = false
      setLoadingEarlier(false)
    }
  }, [
    capturePrependAnchor,
    loadedHiddenCount,
    renderLimit,
    session.id,
    session.messages,
    unloadedBeforeCount
  ])

  const handleScroll = useCallback(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    updateScrollMetrics()
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    setFollowingBottom(distanceFromBottom <= FOLLOW_BOTTOM_THRESHOLD)
    if (hiddenMessageCount > 0 && scroller.scrollTop <= TRANSCRIPT_LAZY_LOAD_TOP_THRESHOLD) {
      const anchor = readVisiblePrependAnchor()
      void handleLoadEarlier('auto', anchor)
    }
  }, [handleLoadEarlier, hiddenMessageCount, readVisiblePrependAnchor, setFollowingBottom, updateScrollMetrics])

  useEffect(() => {
    setFollowingBottom(true)
    measuredRowHeightsRef.current = {}
    setRowMeasurementVersion((version) => version + 1)
    setRenderLimit(Math.min(session.messages.length, TRANSCRIPT_RENDER_CHUNK))
    scrollToBottom(true)
  }, [scrollToBottom, session.id, session.messagesLoaded, setFollowingBottom])

  useEffect(() => {
    const firstPageLimit = Math.min(session.messages.length, TRANSCRIPT_RENDER_CHUNK)
    setRenderLimit((current) => current < firstPageLimit ? firstPageLimit : current)
  }, [session.id, session.messages.length])

  useEffect(() => {
    if (!shouldFollowBottomRef.current) return
    scrollToBottom()
  }, [session.messages.length, lastTextLength, scrollToBottom])

  useLayoutEffect(() => {
    const perfWindow = window as typeof window & {
      __orchestratorSessionSwitchPerf?: {
        sessionId: string
        startedAt: number
        messageCount: number
        renderedMessages?: number
        transcriptReadyAt?: number
        transcriptReadyMs?: number
      }
      __orchestratorSessionSwitchLastPerf?: unknown
    }
    const pending = perfWindow.__orchestratorSessionSwitchPerf
    if (!pending || pending.sessionId !== session.id || pending.transcriptReadyAt) return
    if (visibleMessages.length === 0) return
    const transcriptReadyAt = performance.now()
    const result = {
      ...pending,
      renderedMessages: visibleMessages.length,
      transcriptReadyAt,
      transcriptReadyMs: transcriptReadyAt - pending.startedAt
    }
    perfWindow.__orchestratorSessionSwitchPerf = result
    perfWindow.__orchestratorSessionSwitchLastPerf = result
    void window.api.performance.record({
      name: 'session.switch.transcript-ready',
      surface: 'renderer',
      startedAt: Date.now() - result.transcriptReadyMs,
      durationMs: result.transcriptReadyMs,
      metadata: {
        sessionId: result.sessionId,
        messageCount: result.messageCount,
        renderedMessages: result.renderedMessages ?? 0
      }
    })
    window.dispatchEvent(new CustomEvent('orchestrator:session-switch-perf', { detail: result }))
    if (import.meta.env.DEV) {
      console.info('[orchestrator] session switch', {
        sessionId: result.sessionId,
        messageCount: result.messageCount,
        renderedMessages: result.renderedMessages,
        transcriptReadyMs: Math.round(result.transcriptReadyMs)
      })
    }
  }, [session.id, visibleMessages.length])

  useEffect(() => {
    const openSearch = (): void => {
      setSharedFindActive(false)
      setSearchOpen(true)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && searchOpen) {
        const activeElement = document.activeElement
        if (activeElement === searchInputRef.current || searchInputRef.current?.contains(activeElement)) {
          event.preventDefault()
          setSearchOpen(false)
          setSearchQuery('')
          setSearchResults([])
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('orchestrator:open-transcript-search', openSearch)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('orchestrator:open-transcript-search', openSearch)
    }
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen || sharedFindActive) return
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen, sharedFindActive])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!searchOpen) {
      setSearchResults([])
      setSearching(false)
      return
    }
    if (query.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timeout = window.setTimeout(() => {
      const startedAt = markRendererStart()
      window.api.sessions.searchTranscript(session.id, query, 8).then((results) => {
        if (cancelled) return
        setSearchResults(results)
        setSearching(false)
        recordRendererMetric('transcript.search.results-ready', startedAt, {
          sessionId: session.id,
          results: results.length
        })
      })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [searchOpen, searchQuery, session.id])

  useEffect(() => {
    if (session.messagesLoaded || session.messageCount === 0 || session.messages.length >= Math.min(totalMessageCount, TRANSCRIPT_RENDER_CHUNK)) return
    let cancelled = false
    const startedAt = markRendererStart()
    window.api.sessions.getTranscriptPage(session.id, { limit: TRANSCRIPT_RENDER_CHUNK }).then((page) => {
      if (cancelled || !page) return
      useSessionStore.getState().mergeTranscriptPage(session.id, page, 'replace')
      setRenderLimit(Math.min(page.messages.length, TRANSCRIPT_RENDER_CHUNK))
      recordRendererMetric('transcript.visible-page-ready', startedAt, {
        sessionId: session.id,
        messages: page.messages.length,
        messageCount: page.messageCount
      })
    })
    return () => { cancelled = true }
  }, [session.id, session.messageCount, session.messages.length, session.messagesLoaded, totalMessageCount])

  useEffect(() => {
    return () => {
      if (pendingScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingScrollFrameRef.current)
      }
    }
  }, [])

  const handleLoadAllLoaded = useCallback(() => {
    setRenderLimit(session.messages.length)
  }, [session.messages.length])

  const handleJumpToSearchResult = useCallback(async (result: TranscriptSearchResult) => {
    const startedAt = markRendererStart()
    const page = await window.api.sessions.getTranscriptPage(session.id, {
      aroundMessageId: result.messageId,
      limit: TRANSCRIPT_RENDER_CHUNK
    })
    if (!page) return
    const targetOffset = transcriptItemOffset(result.messageId, groupTranscriptMessages(page.messages), {})
    useSessionStore.getState().mergeTranscriptPage(session.id, page, 'replace')
    setRenderLimit(page.messages.length)
    recordRendererMetric('transcript.search.jump-ready', startedAt, {
      sessionId: session.id,
      messageIndex: result.messageIndex,
      messages: page.messages.length
    })
    window.requestAnimationFrame(() => {
      const scroller = scrollContainerRef.current
      if (scroller && targetOffset !== null) {
        scroller.scrollTop = Math.max(0, targetOffset - Math.round(scroller.clientHeight * 0.35))
        updateScrollMetrics()
      }
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-message-id="${CSS.escape(result.messageId)}"]`)?.scrollIntoView({ block: 'center' })
        updateScrollMetrics()
      })
    })
  }, [session.id, updateScrollMetrics])

  useEffect(() => {
    if (sharedSearchActiveResultIndex < searchResults.length) return
    setSharedSearchActiveResultIndex(0)
  }, [searchResults.length, sharedSearchActiveResultIndex])

  useEffect(() => {
    const onThreadFindQuery = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string; domain?: string; query?: string }>).detail
      if (detail?.sessionId !== session.id || detail.domain !== 'conversation') return
      setSharedFindActive(true)
      setSearchOpen(true)
      setSearchQuery(detail.query ?? '')
      setSharedSearchActiveResultIndex(0)
    }
    const onThreadFindStep = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string; domain?: string; direction?: number }>).detail
      if (detail?.sessionId !== session.id || detail.domain !== 'conversation') return
      if (searchResults.length === 0) return
      const direction = detail.direction === -1 ? -1 : 1
      const next = (sharedSearchActiveResultIndex + direction + searchResults.length) % searchResults.length
      setSharedSearchActiveResultIndex(next)
      void handleJumpToSearchResult(searchResults[next])
    }
    const onThreadFindClose = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (detail?.sessionId !== session.id) return
      setSharedFindActive(false)
      setSearchOpen(false)
      setSearchQuery('')
      setSearchResults([])
      setSharedSearchActiveResultIndex(0)
    }
    window.addEventListener('orchestrator:thread-find-query', onThreadFindQuery)
    window.addEventListener('orchestrator:thread-find-step', onThreadFindStep)
    window.addEventListener('orchestrator:thread-find-close', onThreadFindClose)
    return () => {
      window.removeEventListener('orchestrator:thread-find-query', onThreadFindQuery)
      window.removeEventListener('orchestrator:thread-find-step', onThreadFindStep)
      window.removeEventListener('orchestrator:thread-find-close', onThreadFindClose)
    }
  }, [handleJumpToSearchResult, searchResults, session.id, sharedSearchActiveResultIndex])

  useEffect(() => {
    if (!sharedFindActive) return
    window.dispatchEvent(new CustomEvent('orchestrator:thread-find-status', {
      detail: {
        sessionId: session.id,
        domain: 'conversation',
        totalMatches: searchResults.length,
        activeMatch: searchResults.length > 0 ? sharedSearchActiveResultIndex + 1 : 0,
        isCapped: false
      }
    }))
  }, [searchResults.length, session.id, sharedFindActive, sharedSearchActiveResultIndex])

  if (session.messages.length === 0 && session.status !== 'running') {
    const promptTarget = projectName ?? 'this project'
    const applyEmptyStateSuggestion = (prompt: string): void => {
      window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
        detail: { text: prompt }
      }))
    }
    return (
      <div
        data-testid="chat-empty-state"
        aria-label="New chat ready"
        className="chat-empty-state flex-1 flex items-center justify-center px-6"
        style={{ background: 'var(--canvas-bg)' }}
      >
        <div className="w-full max-w-[460px] text-center">
          <div
            className="text-[17px] font-medium"
            style={{ color: 'var(--text-primary)', letterSpacing: 0 }}
          >
            What should we build in {promptTarget}?
          </div>
          <div
            className="mt-2 text-[13px] leading-5"
            style={{ color: 'var(--text-secondary)' }}
          >
            Start with a goal, a bug, a branch, or a file you want to understand.
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EMPTY_STATE_SUGGESTIONS.map((suggestion) => (
              <button
                type="button"
                key={suggestion.label}
                data-testid="chat-empty-state-suggestion"
                data-suggestion-label={suggestion.label}
                onClick={() => applyEmptyStateSuggestion(suggestion.prompt)}
                className="rounded-full border px-3 py-1 text-[12px]"
                style={{
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--surface-bg)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
          <div className="mt-8 text-left">
            <ChangesReviewCard content="Diff updated" session={session} hideWhenEmpty />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex-1 min-h-0 min-w-0"
      style={{ background: 'var(--canvas-bg)' }}
    >
      <div
        data-testid="transcript-scroll"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-5"
        style={{ userSelect: 'text' }}
      >
        <div
          className="mx-auto flex min-w-0 flex-col"
          style={{
            maxWidth: 'min(920px, 100%)',
            gap: 'var(--transcript-gap, 14px)'
          }}
        >
          {hiddenMessageCount > 0 && (
            <LoadEarlierMessages
              hiddenCount={hiddenMessageCount}
              visibleCount={visibleMessages.length}
              totalCount={totalMessageCount}
              loadedHiddenCount={loadedHiddenCount}
              unloadedBeforeCount={unloadedBeforeCount}
              loading={loadingEarlier}
              onLoad={() => { void handleLoadEarlier('manual') }}
              onLoadAll={handleLoadAllLoaded}
            />
          )}
          {hiddenMessageCount === 0 && totalMessageCount > TRANSCRIPT_RENDER_CHUNK && (
            <TranscriptHistoryStatus
              totalCount={totalMessageCount}
              visibleCount={visibleMessages.length}
            />
          )}
          {unloadedBeforeCount > 0 && session.messages.length < Math.min(totalMessageCount, TRANSCRIPT_RENDER_CHUNK) && (
            <TranscriptLoadingState />
          )}
          <TranscriptSearch
            open={searchOpen && !sharedFindActive}
            inputRef={searchInputRef}
            query={searchQuery}
            results={searchResults}
            searching={searching}
            onQueryChange={setSearchQuery}
            onJump={handleJumpToSearchResult}
            onClose={() => {
              setSearchOpen(false)
              setSearchQuery('')
              setSearchResults([])
              setSharedFindActive(false)
            }}
          />
          {transcriptActionStatus && (
            <TranscriptActionStatus status={transcriptActionStatus} />
          )}
          <div
            ref={transcriptListRef}
            data-testid="virtualized-transcript"
            data-rendered-message-count={visibleMessages.length}
            data-total-message-count={totalMessageCount}
            className="relative min-w-0"
            style={{ height: virtualWindow.totalHeight }}
          >
            <div
              className="absolute left-0 right-0 top-0 min-w-0"
              style={{ transform: `translateY(${virtualWindow.offsetTop}px)` }}
            >
              {virtualWindow.items.map(({ id, item }) => (
                <MeasuredTranscriptRow
                  key={id}
                  id={id}
                  onHeight={handleVirtualRowHeight}
                >
                  {item.type === 'tool_group'
                    ? <ToolActivitySummary messages={item.messages} session={session} />
                    : (
                      <MessageRow
                        msg={item.message}
                        session={session}
                        fileReferenceRoots={fileReferenceRoots}
                        preferredEditor={preferredEditor}
                        canCopy={item.message.id === lastAssistantTextId}
                        canContinue={item.message.id === lastAssistantTextId && !isActiveSessionStatus(session.status)}
                        onSteerQueuedMessage={steerQueuedMessage}
                        onCancelQueuedMessage={cancelQueuedMessage}
                      />
                    )}
                </MeasuredTranscriptRow>
              ))}
            </div>
          </div>
          {showThinkingIndicator && <ThinkingIndicator streaming={hasStreamingAssistantMessage} />}
          <div ref={bottomRef} />
        </div>
      </div>
      {showJumpToLatest && (
        <ScrollEdgeButton
          onClick={() => scrollToBottom(true)}
          ariaLabel="Jump to latest"
          dataTestId="jump-to-latest"
          className="absolute bottom-4 right-6"
        >
          Jump to latest
        </ScrollEdgeButton>
      )}
    </div>
  )
}

function TranscriptLoadingState(): JSX.Element {
  return (
    <div className="flex justify-center">
      <SurfaceRow
        className="items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        style={{
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)'
        }}
      >
        <ThinkingDots />
        <span>Loading recent transcript page</span>
      </SurfaceRow>
    </div>
  )
}

function TranscriptHistoryStatus({
  totalCount,
  visibleCount
}: {
  totalCount: number
  visibleCount: number
}): JSX.Element {
  return (
    <div className="flex justify-center">
      <SurfaceRow
        dataTestId="long-thread-message-status"
        data-visible-message-count={visibleCount}
        data-total-message-count={totalCount}
        className="items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        style={{
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)'
        }}
      >
        <span>{totalCount.toLocaleString()} messages loaded</span>
      </SurfaceRow>
    </div>
  )
}

function TranscriptActionStatus({
  status
}: {
  status: { text: string; tone: 'info' | 'danger' }
}): JSX.Element {
  return (
    <div className="flex justify-center">
      <div
        data-testid="transcript-action-status"
        data-transcript-action-status-tone={status.tone}
        role={status.tone === 'danger' ? 'alert' : 'status'}
        aria-live={status.tone === 'danger' ? 'assertive' : 'polite'}
        aria-atomic="true"
        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        style={{
          background: status.tone === 'danger'
            ? 'color-mix(in srgb, var(--color-red) 9%, var(--surface-bg))'
            : 'var(--surface-bg)',
          border: status.tone === 'danger'
            ? '1px solid color-mix(in srgb, var(--color-red) 40%, var(--border-subtle))'
            : '1px solid var(--border-subtle)',
          color: status.tone === 'danger' ? 'var(--color-red)' : 'var(--text-secondary)'
        }}
      >
        <span>{status.text}</span>
      </div>
    </div>
  )
}

function LoadEarlierMessages({
  hiddenCount,
  visibleCount,
  totalCount,
  loadedHiddenCount,
  unloadedBeforeCount,
  loading,
  onLoad,
  onLoadAll
}: {
  hiddenCount: number
  visibleCount: number
  totalCount: number
  loadedHiddenCount: number
  unloadedBeforeCount: number
  loading: boolean
  onLoad: () => void
  onLoadAll: () => void
}): JSX.Element {
  const nextBatchCount = Math.min(TRANSCRIPT_RENDER_CHUNK, hiddenCount)
  const primaryLabel = loading
    ? 'Loading'
    : loadedHiddenCount > 0
      ? `Show ${nextBatchCount.toLocaleString()} earlier`
      : `Load ${nextBatchCount.toLocaleString()} earlier`
  return (
    <div className="flex justify-center">
      <SurfaceRow
        dataTestId="load-earlier-messages"
        data-hidden-message-count={hiddenCount}
        data-loaded-hidden-count={loadedHiddenCount}
        data-unloaded-before-count={unloadedBeforeCount}
        data-visible-message-count={visibleCount}
        data-total-message-count={totalCount}
        className="items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        style={{
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)'
        }}
      >
        <span>{visibleCount.toLocaleString()} of {totalCount.toLocaleString()} messages shown</span>
        <Button variant="ghost" className="px-2 py-0.5" onClick={onLoad} disabled={loading}>
          {primaryLabel}
        </Button>
        {loadedHiddenCount > 0 && (
          <Button variant="ghost" className="px-2 py-0.5" onClick={onLoadAll}>Show all loaded</Button>
        )}
      </SurfaceRow>
    </div>
  )
}

function TranscriptSearch({
  open,
  inputRef,
  query,
  results,
  searching,
  onQueryChange,
  onJump,
  onClose
}: {
  open: boolean
  inputRef: React.RefObject<HTMLInputElement>
  query: string
  results: TranscriptSearchResult[]
  searching: boolean
  onQueryChange: (query: string) => void
  onJump: (result: TranscriptSearchResult) => void
  onClose: () => void
}): JSX.Element {
  if (!open) return <></>

  return (
    <div className="sticky top-0 z-10 -mx-1 flex justify-end pb-1">
      <div
        className="motion-row relative w-full max-w-[360px] rounded-lg px-2 py-1"
        style={{
          background: 'color-mix(in srgb, var(--surface-bg) 92%, transparent)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-soft)',
          backdropFilter: 'blur(18px)'
        }}
      >
        <WorkbenchSearchField
          id="transcript-search"
          dataTestId="transcript-search"
          inputRef={inputRef}
          value={query}
          onChange={onQueryChange}
          placeholder="Search transcript"
          className="h-[30px]"
          ariaLabel="Search transcript"
          trailing={(
            <button
              type="button"
              aria-label="Close transcript search"
              onClick={onClose}
              className="workbench-search-clear"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        />
        {(searching || results.length > 0) && (
          <div className="mt-1 max-h-56 overflow-auto rounded-md" style={{ background: 'var(--canvas-bg)' }}>
            {searching ? (
              <div className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>Searching...</div>
            ) : (
              results.map((result) => (
                <button
                  key={`${result.messageId}:${result.messageIndex}`}
                  type="button"
                  className="motion-menu-item block w-full rounded-md px-2 py-1.5 text-left text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={() => onJump(result)}
                >
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{result.role}</span>
                  <span className="ml-2">{result.snippet}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type TranscriptItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'tool_group'; id: string; messages: Array<ToolUseMessage | ToolResultMessage> }

interface VirtualTranscriptWindow {
  totalHeight: number
  offsetTop: number
  items: Array<{ id: string; item: TranscriptItem }>
}

function buildVirtualTranscriptWindow(
  items: TranscriptItem[],
  measuredHeights: Record<string, number>,
  scrollTop: number,
  viewportHeight: number
): VirtualTranscriptWindow {
  if (items.length === 0) return { totalHeight: 0, offsetTop: 0, items: [] }

  const viewportStart = Math.max(0, scrollTop - TRANSCRIPT_VIRTUAL_OVERSCAN)
  const viewportEnd = scrollTop + viewportHeight + TRANSCRIPT_VIRTUAL_OVERSCAN
  const visibleItems: Array<{ id: string; item: TranscriptItem }> = []
  let offset = 0
  let offsetTop = 0
  let totalHeight = 0

  for (const item of items) {
    const id = transcriptItemId(item)
    const height = measuredHeights[id] ?? estimateTranscriptItemHeight(item)
    const itemStart = offset
    const itemEnd = itemStart + height
    if (itemEnd >= viewportStart && itemStart <= viewportEnd) {
      if (visibleItems.length === 0) offsetTop = itemStart
      visibleItems.push({ id, item })
    }
    offset = itemEnd
    totalHeight = itemEnd
  }

  if (visibleItems.length === 0) {
    const item = items[items.length - 1]
    const id = transcriptItemId(item)
    return {
      totalHeight,
      offsetTop: Math.max(0, totalHeight - (measuredHeights[id] ?? estimateTranscriptItemHeight(item))),
      items: [{ id, item }]
    }
  }

  return { totalHeight, offsetTop, items: visibleItems }
}

function transcriptItemId(item: TranscriptItem): string {
  return item.type === 'tool_group' ? item.id : item.message.id
}

function transcriptItemOffset(
  messageId: string,
  items: TranscriptItem[],
  measuredHeights: Record<string, number>
): number | null {
  let offset = 0
  for (const item of items) {
    const id = transcriptItemId(item)
    if (id === messageId) return offset
    offset += measuredHeights[id] ?? estimateTranscriptItemHeight(item)
  }
  return null
}

function estimateTranscriptMessagesHeight(messages: ChatMessage[]): number {
  return groupTranscriptMessages(messages).reduce((total, item) => total + estimateTranscriptItemHeight(item), 0)
}

function estimateTranscriptItemHeight(item: TranscriptItem): number {
  if (item.type === 'tool_group') {
    return 58 + Math.min(item.messages.length, TOOL_SUMMARY_SCROLL_THRESHOLD) * 26 + TRANSCRIPT_VIRTUAL_ROW_GAP
  }
  const message = item.message
  if (message.type === 'text') {
    const lines = message.content.split('\n').length
    const wrappedLines = Math.ceil(message.content.length / (message.role === 'user' ? 70 : 92))
    const bodyHeight = Math.min(720, Math.max(lines, wrappedLines) * 18)
    return (message.role === 'user' ? 52 : 44) + bodyHeight + TRANSCRIPT_VIRTUAL_ROW_GAP
  }
  if (message.type === 'tool_use' || message.type === 'tool_result') return 96 + TRANSCRIPT_VIRTUAL_ROW_GAP
  return 72 + TRANSCRIPT_VIRTUAL_ROW_GAP
}

function MeasuredTranscriptRow({
  id,
  onHeight,
  children
}: {
  id: string
  onHeight: (id: string, height: number) => void
  children: ReactNode
}): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = (): void => {
      const height = row.getBoundingClientRect().height
      if (height > 0) onHeight(id, height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [id, onHeight])

  return (
    <div
      ref={rowRef}
      data-testid="virtual-transcript-row"
      data-virtual-row-id={id}
      className="min-w-0"
      style={{ paddingBottom: TRANSCRIPT_VIRTUAL_ROW_GAP }}
    >
      {children}
    </div>
  )
}

function groupTranscriptMessages(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let pendingTools: Array<ToolUseMessage | ToolResultMessage> = []

  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    items.push({
      type: 'tool_group',
      id: `tools-${pendingTools[0].id}-${pendingTools[pendingTools.length - 1].id}`,
      messages: pendingTools
    })
    pendingTools = []
  }

  for (const message of messages) {
    if (message.type === 'tool_use' || message.type === 'tool_result') {
      pendingTools.push(message)
      continue
    }
    flushTools()
    items.push({ type: 'message', message })
  }
  flushTools()

  return items
}

function CopyButton({ getText }: { getText: () => string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const copyStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copyStatusTimeoutRef.current) window.clearTimeout(copyStatusTimeoutRef.current)
  }, [])

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (copyStatusTimeoutRef.current) window.clearTimeout(copyStatusTimeoutRef.current)
    try {
      const text = getText()
      if (typeof window.api.clipboard?.writeText === 'function') {
        const didWrite = await window.api.clipboard.writeText(text)
        if (!didWrite) throw new Error('Clipboard write failed')
      } else {
        await navigator.clipboard.writeText(text)
      }
      setCopied(true)
      setCopyStatus('copied')
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopied(false)
        setCopyStatus('idle')
        copyStatusTimeoutRef.current = null
      }, 1500)
    } catch {
      setCopied(false)
      setCopyStatus('error')
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus('idle')
        copyStatusTimeoutRef.current = null
      }, 2200)
    }
  }, [getText])

  return (
    <>
      <IconButton
        icon={copied ? 'check' : 'copy'}
        label={copyStatus === 'error' ? 'Copy failed' : copied ? 'Copied message' : 'Copy message'}
        size="sm"
        tone={copied ? 'success' : copyStatus === 'error' ? 'danger' : 'neutral'}
        dataTestId="chat-message-copy"
        onClick={handleCopy}
        style={{
          opacity: copied ? 1 : 0.55
        }}
      />
      {copyStatus !== 'idle' && (
        <span
          className="sr-only"
          data-testid="chat-message-copy-status"
          data-copy-state={copyStatus}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {copyStatus === 'copied' ? 'Copied message' : 'Unable to copy message'}
        </span>
      )}
    </>
  )
}

function ContinueButton({ sessionId }: { sessionId: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const label = state === 'sending' ? 'Continuing' : state === 'sent' ? 'Continue sent' : state === 'error' ? 'Continue failed' : 'Continue'

  const handleContinue = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (state === 'sending') return
    setState('sending')
    try {
      const ok = await window.api.sessions.continueLastTurn(sessionId)
      setState(ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }, [sessionId, state])

  return (
    <Button
      variant="ghost"
      className="h-7 px-2 text-[11px]"
      dataTestId="chat-continue-last-turn"
      disabled={state === 'sending'}
      title={label}
      ariaLabel={label}
      onClick={handleContinue}
    >
      {state === 'sending' ? <ThinkingDots /> : <Icon name="arrowRight" size={13} />}
      <span
        data-testid="chat-continue-last-turn-label"
        data-continue-state={state}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {label}
      </span>
    </Button>
  )
}

function makeMarkdownComponents(isUser: boolean): Components {
  return {
    // Code blocks
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith('language-')
      const lang = className?.replace('language-', '') ?? ''
      if (!isBlock) {
        return (
          <code
            style={{
              background: isUser ? 'rgba(0,0,0,0.08)' : 'var(--control-bg)',
              borderRadius: 3,
              padding: '1px 4px',
              fontSize: '0.85em',
              fontFamily: 'monospace',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word'
            }}
            {...props}
          >
            {children}
          </code>
        )
      }
      return (
        <div style={{ position: 'relative', margin: '8px 0', maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              minWidth: 0,
              padding: '4px 10px',
              background: 'var(--color-surface)',
              borderRadius: '6px 6px 0 0',
              borderBottom: '1px solid var(--color-border)'
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
              {lang || 'code'}
            </span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              background: 'var(--color-surface)',
              borderRadius: '0 0 6px 6px',
              overflowX: 'auto',
              overflowY: 'hidden',
              fontSize: '0.82em',
              lineHeight: 1.5
            }}
          >
            <code
              className={className}
              style={{ display: 'block', minWidth: 'max-content' }}
              {...props}
            >
              {children}
            </code>
          </pre>
        </div>
      )
    },
    // Paragraphs — no extra margin inside bubbles
    p({ children }) {
      return <p style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</p>
    },
    // Lists
    ul({ children }) {
      return <ul style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.6 }}>{children}</ul>
    },
    ol({ children }) {
      return <ol style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.6 }}>{children}</ol>
    },
    li({ children }) {
      return <li style={{ margin: '2px 0' }}>{children}</li>
    },
    // Headings
    h1({ children }) { return <h1 style={{ fontSize: '1.15em', fontWeight: 700, margin: '8px 0 4px' }}>{children}</h1> },
    h2({ children }) { return <h2 style={{ fontSize: '1.05em', fontWeight: 600, margin: '8px 0 4px' }}>{children}</h2> },
    h3({ children }) { return <h3 style={{ fontSize: '1em', fontWeight: 600, margin: '6px 0 2px' }}>{children}</h3> },
    // Blockquote
    blockquote({ children }) {
      return (
        <blockquote
          style={{
            borderLeft: '3px solid var(--color-border)',
            paddingLeft: 10,
            margin: '6px 0',
            color: 'var(--color-text-muted)',
            fontStyle: 'italic'
          }}
        >
          {children}
        </blockquote>
      )
    },
    // Horizontal rule
    hr() {
      return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />
    },
    // Table
    table({ children }) {
      return (
        <div style={{ overflowX: 'hidden', maxWidth: '100%', minWidth: 0, margin: '6px 0' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              fontSize: '0.9em',
              width: '100%',
              maxWidth: '100%',
              tableLayout: 'fixed'
            }}
          >
            {children}
          </table>
        </div>
      )
    },
    th({ children }) {
      return (
        <th
          style={{
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border)',
            textAlign: 'left',
            fontWeight: 600,
            verticalAlign: 'top',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'normal'
          }}
        >
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td
          style={{
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border)',
            verticalAlign: 'top',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'normal'
          }}
        >
          {children}
        </td>
      )
    },
    // Strong / em
    strong({ children }) { return <strong style={{ fontWeight: 700 }}>{children}</strong> },
    em({ children }) { return <em style={{ fontStyle: 'italic' }}>{children}</em> },
    // Links — open externally
    a({ href, children }) {
      return (
        <a
          href={href}
          onClick={(e) => { e.preventDefault(); if (href) window.open(href) }}
          style={{ color: isUser ? 'rgba(255,255,255,0.85)' : 'var(--color-accent)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          {children}
        </a>
      )
    }
  }
}

const assistantComponents = makeMarkdownComponents(false)
const userComponents = makeMarkdownComponents(true)

function MessageRow({
  msg,
  session,
  fileReferenceRoots,
  preferredEditor,
  canCopy,
  canContinue,
  onSteerQueuedMessage,
  onCancelQueuedMessage
}: {
  msg: ChatMessage
  session: Session
  fileReferenceRoots: string[]
  preferredEditor: PreferredEditor
  canCopy: boolean
  canContinue: boolean
  onSteerQueuedMessage: (messageId: string) => Promise<void>
  onCancelQueuedMessage: (messageId: string, queueState: 'queued' | 'steer_next') => Promise<void>
}): JSX.Element | null {
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false)

  if (msg.type === 'text') {
    const isUser = msg.role === 'user'
    const isSystem = msg.role === 'system'

    if (isSystem) {
      return (
        <div className="flex justify-center">
          <span className="text-xs px-3 py-1 rounded-full" style={{ background: 'var(--color-surface2)', color: 'var(--color-text-muted)' }}>
            {msg.content.slice(0, 120)}
          </span>
        </div>
      )
    }

    const content = msg.content
    const shouldCollapseUserMessage = isUser && content.length > USER_MESSAGE_COLLAPSE_LENGTH
    const displayContent = shouldCollapseUserMessage && !isUserMessageExpanded
      ? collapsedUserMessageContent(content)
      : content
    const queueState = isUser ? msg.queueState : undefined
    const fileReferences = !isUser && !isSystem
      ? extractFileReferences(content, session.workDir).slice(0, 8)
      : []
    return (
      <div
        data-message-id={msg.id}
        className={`flex min-w-0 w-full ${isUser ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className="min-w-0"
          style={{
            maxWidth: isUser ? '78%' : '100%',
            width: isUser ? 'auto' : '100%',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div
            className={`min-w-0 break-words ${isUser ? 'px-4 py-3 pr-9' : canContinue ? 'pr-32 py-1' : 'pr-8 py-1'}`}
            style={{
              background: isUser ? 'var(--control-bg-active)' : 'transparent',
              color: 'var(--text-primary)',
              overflowWrap: 'anywhere',
              borderRadius: isUser ? 'var(--radius-xl)' : undefined,
              border: isUser ? '1px solid var(--border-subtle)' : 'none',
              fontSize: 'var(--transcript-font-size, 14px)',
              lineHeight: 1.65
            }}
          >
            <MarkdownSurface user={isUser}>
              {shouldCollapseUserMessage && !isUserMessageExpanded ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={isUser ? userComponents : assistantComponents}
                >
                  {displayContent}
                </ReactMarkdown>
              )}
            </MarkdownSurface>
            {msg.isStreaming && (
              <span
                aria-label="Streaming"
                data-testid="streaming-cursor"
                className="inline-block align-baseline"
                style={{ color: 'var(--color-accent)', marginLeft: 2 }}
              >
                |
              </span>
            )}
            {!isUser && msg.interrupted && !msg.isStreaming && (
              <div
                className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium"
                data-testid="chat-partial-response-status"
                style={{
                  background: 'color-mix(in srgb, var(--color-yellow) 12%, var(--color-surface2))',
                  border: '1px solid color-mix(in srgb, var(--color-yellow) 34%, var(--color-border))',
                  color: 'var(--color-text-muted)'
                }}
              >
                <span className="shrink-0" style={{ color: 'var(--color-yellow)' }}>{iconPath('warning')}</span>
                <span className="min-w-0 truncate">Partial response stopped</span>
              </div>
            )}
            {fileReferences.length > 0 && <FileReferenceList files={fileReferences} cwd={session.workDir} searchRoots={fileReferenceRoots} preferredEditor={preferredEditor} />}
            {isUser && msg.attachments && msg.attachments.length > 0 && <MessageAttachmentList attachments={msg.attachments} />}
            {shouldCollapseUserMessage && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsUserMessageExpanded((expanded) => !expanded)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 10%, var(--control-bg))',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)'
                  }}
                  aria-expanded={isUserMessageExpanded}
                >
                  <span>{isUserMessageExpanded ? 'Show less' : 'Show more'}</span>
                  <span style={{ transform: isUserMessageExpanded ? 'rotate(180deg)' : undefined, display: 'inline-flex' }}>
                    <Icon name="chevronDown" size={12} />
                  </span>
                </button>
              </div>
            )}
            {queueState && (
              <div
                className="mt-2 flex flex-wrap items-center justify-end gap-2"
                data-testid="queued-message-actions"
                data-queued-message-state={queueState}
              >
                <StatusBadge
                  label={queueState === 'steer_next' ? 'Steering next' : 'Queued'}
                  tone={queueState === 'steer_next' ? 'accent' : 'neutral'}
                  pulse={queueState === 'steer_next'}
                />
                {queueState === 'queued' && (
                  <Button
                    variant="secondary"
                    className="rounded-full px-2 py-0.5 text-[10px]"
                    dataTestId="queued-message-steer"
                    ariaLabel="Steer queued message"
                    title="Send after the current tool call completes"
                    onClick={() => { void onSteerQueuedMessage(msg.id) }}
                  >
                    Steer
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="rounded-full px-2 py-0.5 text-[10px]"
                  dataTestId="queued-message-cancel"
                  ariaLabel={queueState === 'steer_next' ? 'Cancel steering message' : 'Cancel queued message'}
                  title={queueState === 'steer_next' ? 'Cancel steering message' : 'Cancel queued message'}
                  onClick={() => { void onCancelQueuedMessage(msg.id, queueState) }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
          {(canCopy || canContinue) && !isUser && (
            <div
              className="flex items-center gap-1"
              style={{
                position: 'absolute',
                top: 2,
                right: 0
              }}
            >
              {canContinue && <ContinueButton sessionId={session.id} />}
              {canCopy && <CopyButton getText={() => content} />}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (msg.type === 'result') {
    if (msg.subtype === 'waiting_for_user') {
      return <UserInputCard msg={msg} sessionId={session.id} sessionStatus={session.status} />
    }
    if (msg.permissionDenials && msg.permissionDenials.length > 0) {
      return <PermissionCard msg={msg} sessionId={session.id} sessionStatus={session.status} />
    }
    if (msg.subtype === 'status') {
      return <StatusCard content={msg.content} session={session} />
    }
    if (msg.subtype === 'success') return null
    return <ErrorRecoveryCard msg={msg} session={session} />
  }

  return null
}

function ErrorRecoveryCard({ msg, session }: { msg: ResultMessage; session: Session }): JSX.Element {
  const [retryState, setRetryState] = useState<'idle' | 'retrying' | 'sent' | 'error'>('idle')
  const [retryError, setRetryError] = useState<string | null>(null)
  const activeSession = isActiveSessionStatus(session.status)
  const canRetry = hasRetryableUserMessage(session)
  const actionLabel = activeSession ? 'Stop and retry' : 'Retry last message'

  const retryLastMessage = async (): Promise<void> => {
    if (!canRetry || retryState === 'retrying') return
    setRetryState('retrying')
    setRetryError(null)
    try {
      if (activeSession) {
        await window.api.sessions.stop(session.id)
        await new Promise((resolve) => setTimeout(resolve, 160))
      }
      const ok = await window.api.sessions.retryLastUserMessage(session.id)
      if (!ok) {
        setRetryState('error')
        setRetryError('No retryable message is available.')
        return
      }
      setRetryState('sent')
    } catch (error) {
      setRetryState('error')
      setRetryError(error instanceof Error ? error.message : 'Retry failed.')
    }
  }

  return (
    <div className="flex justify-start min-w-0 w-full" role="group" aria-label="Run failure recovery">
      <SurfaceRow
        className="flex min-w-0 items-start gap-2 rounded-xl px-3 py-2 text-xs"
        dataTestId="chat-error-recovery-card"
        style={{
          maxWidth: 'min(640px, 100%)',
          background: 'color-mix(in srgb, var(--color-red) 8%, var(--color-surface2))',
          border: '1px solid color-mix(in srgb, var(--color-red) 28%, var(--color-border))',
          color: 'var(--color-text)'
        }}
      >
        <span
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded"
          style={{ color: 'var(--color-red)', background: 'var(--color-surface)' }}
        >
          {iconPath('warning')}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold" style={{ color: 'var(--color-red)' }}>
            Run failed
          </div>
          <div className="mt-0.5" style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
            {msg.content?.trim() || 'The provider run stopped before completing.'}
          </div>
          {(retryError || retryState === 'sent') && (
            <div
              className="mt-1 text-[11px]"
              data-testid="chat-error-retry-status"
              role={retryState === 'error' ? 'alert' : 'status'}
              aria-live={retryState === 'error' ? 'assertive' : 'polite'}
              aria-atomic="true"
              style={{ color: retryState === 'error' ? 'var(--color-red)' : 'var(--color-green)' }}
            >
              {retryState === 'error' ? retryError : 'Retry sent'}
            </div>
          )}
        </div>
        <Button
          variant="secondary"
          className="shrink-0 px-3 py-1"
          dataTestId="chat-error-retry-last"
          disabled={!canRetry || retryState === 'retrying'}
          ariaLabel={actionLabel}
          onClick={() => { void retryLastMessage() }}
        >
          {retryState === 'retrying' ? 'Retrying...' : actionLabel}
        </Button>
      </SurfaceRow>
    </div>
  )
}

function hasRetryableUserMessage(session: Session): boolean {
  return session.messages.some((message) =>
    message.type === 'text' && message.role === 'user' && message.content.trim().length > 0
  )
}

function isActiveSessionStatus(status: Session['status']): boolean {
  return status === 'running' || status === 'waiting_for_permission' || status === 'waiting_for_user' || status === 'reconnecting'
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function collapsedUserMessageContent(content: string): string {
  const hardCut = content.slice(0, USER_MESSAGE_COLLAPSE_LENGTH)
  const lastNewline = hardCut.lastIndexOf('\n')
  const lastSpace = hardCut.lastIndexOf(' ')
  const breakIndex = Math.max(lastNewline, lastSpace)
  const cutIndex = breakIndex >= USER_MESSAGE_COLLAPSE_MIN_BREAK ? breakIndex : USER_MESSAGE_COLLAPSE_LENGTH
  return `${content.slice(0, cutIndex).trimEnd()}\n...`
}

type StatusMeta = {
  label: string
  tone: string
  icon: JSX.Element
}

function StatusCard({ content, session }: { content: string; session: Session }): JSX.Element {
  if (isChangesStatus(content)) {
    return <ChangesReviewCard content={content} session={session} />
  }
  const meta = statusMeta(content)
  return (
    <div className="flex justify-start min-w-0 w-full">
      <SurfaceRow
        className="flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-xs"
        style={{
          maxWidth: 'min(680px, 100%)',
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)'
        }}
      >
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded" style={{ color: meta.tone, background: 'var(--color-surface)' }}>
          {meta.icon}
        </span>
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold tracking-normal"
            data-testid="status-card-label"
            style={{ color: meta.tone }}
          >
            {meta.label}
          </div>
          <div className="mt-0.5" style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
            {statusBody(content)}
          </div>
        </div>
      </SurfaceRow>
    </div>
  )
}

function ChangesReviewCard({ content, session, hideWhenEmpty = false }: { content: string; session: Session; hideWhenEmpty?: boolean }): JSX.Element {
  const openRightPanelTab = useSessionStore((state) => state.openRightPanelTab)
  const setShowDiff = useSessionStore((state) => state.setShowDiff)
  const lastTurnDiffEvent = useSessionStore((state) => latestDiffUpdatedEvent(state.eventBuffers[session.id] ?? []))
  const lastTurnDiff = lastTurnDiffEvent?.content ?? ''
  const [files, setFiles] = useState<FileChange[]>([])
  const [diffsByPath, setDiffsByPath] = useState<Record<string, { loading: boolean; diff: string }>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [undoState, setUndoState] = useState<'idle' | 'undoing' | 'undone' | 'error'>('idle')
  const [undoError, setUndoError] = useState<string | null>(null)
  const lastTurnFiles = useMemo(() => parseFileChangesFromUnifiedDiff(lastTurnDiff), [lastTurnDiff])
  const reviewCardSource: 'last-turn' | 'local' = isDiffUpdatedStatus(content) && lastTurnFiles.length > 0 ? 'last-turn' : 'local'

  useEffect(() => {
    if (reviewCardSource === 'last-turn') {
      setFiles(lastTurnFiles)
      setLoading(false)
      setUndoState('idle')
      setUndoError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setUndoState('idle')
    setUndoError(null)
    window.api.sessions.getChangedFiles(session.id, 'all')
      .then((changes) => {
        if (!cancelled) setFiles(changes)
      })
      .catch(() => {
        if (!cancelled) setFiles([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lastTurnFiles, reviewCardSource, session.id, content])

  const totals = useMemo(() => files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions
    }),
    { additions: 0, deletions: 0 }
  ), [files])
  const visibleFiles = expanded ? files : files.slice(0, 3)
  const hiddenCount = Math.max(0, files.length - visibleFiles.length)
  const title = files.length > 0
    ? `Edited ${files.length} ${files.length === 1 ? 'file' : 'files'}`
    : loading ? 'Edited files' : 'No changed files'

  useEffect(() => {
    if (!expandedPath) return
    if (reviewCardSource === 'last-turn') {
      setDiffsByPath((current) => ({
        ...current,
        [expandedPath]: {
          loading: false,
          diff: diffForPathFromUnifiedDiff(lastTurnDiff, expandedPath)
        }
      }))
      return
    }
    let cancelled = false
    setDiffsByPath((current) => ({
      ...current,
      [expandedPath]: { loading: true, diff: '' }
    }))
    window.api.sessions.getDiffForFile(session.id, expandedPath, 'all')
      .then((diff) => {
        if (!cancelled) {
          setDiffsByPath((current) => ({
            ...current,
            [expandedPath]: { loading: false, diff }
          }))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffsByPath((current) => ({
            ...current,
            [expandedPath]: { loading: false, diff: '' }
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [expandedPath, lastTurnDiff, reviewCardSource, session.id])

  const openReview = (): void => {
    if (reviewCardSource === 'last-turn') {
      try {
        window.localStorage.setItem(`orchestrator.review.source:${session.workDir}`, 'last-turn')
        window.localStorage.setItem(`orchestrator.review.sidePaneVisible:${session.workDir}`, 'false')
      } catch {
        // Review can still open if storage is unavailable; the event below updates mounted panels.
      }
    }
    openRightPanelTab(session.id, 'environment')
    setShowDiff(session.id, true)
    openRightPanelTab(session.id, 'diff')
    if (reviewCardSource === 'last-turn') {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('orchestrator:review-open-request', {
          detail: {
            sessionId: session.id,
            source: 'last-turn',
            sidePaneVisible: false
          }
        }))
      }, 0)
    }
  }
  const providerCheckpointUndoStatus: ProviderCheckpointUndoStatus = reviewCardSource !== 'last-turn'
    ? 'not-applicable'
    : lastTurnDiffEvent?.checkpointId
      ? 'unsupported'
      : 'missing-checkpoint'
  const undoKind = reviewCardSource === 'last-turn'
    ? providerCheckpointUndoStatus === 'missing-checkpoint'
      ? 'provider-checkpoint-missing'
      : 'provider-checkpoint-unsupported'
    : 'local-current-change'
  const canUndo = reviewCardSource === 'local' && !loading && files.length > 0 && undoState !== 'undoing'
  const undoTitle = canUndo
    ? `Undo ${files.length} changed ${files.length === 1 ? 'file' : 'files'}`
    : reviewCardSource === 'last-turn'
      ? providerCheckpointUndoStatus === 'missing-checkpoint'
        ? 'Provider checkpoint id was not provided by this adapter'
        : 'Provider checkpoint undo is not supported by this adapter yet'
      : undoState === 'undoing'
        ? 'Undoing changes...'
        : undoState === 'error'
          ? undoError ?? 'Undo failed'
          : 'No changed files to undo'
  const reviewTitle = reviewCardSource === 'last-turn'
    ? files.length > 0
      ? `Open Review for last turn, ${files.length} changed ${files.length === 1 ? 'file' : 'files'}`
      : 'Open Review for last turn'
    : files.length > 0
      ? `Open Review for ${files.length} changed ${files.length === 1 ? 'file' : 'files'}`
      : 'Open Review'
  const undoReviewChanges = async (): Promise<void> => {
    if (!canUndo) return
    setUndoState('undoing')
    setUndoError(null)
    const paths = files.map((file) => file.path)
    const result = await window.api.sessions.undoChangedFiles(session.id, paths)
    if (!result.ok) {
      setUndoState('error')
      setUndoError(result.error ?? 'Undo failed')
      setFiles(result.changedFiles)
      return
    }
    setFiles(result.changedFiles)
    setDiffsByPath({})
    setExpandedPath(null)
    setExpanded(false)
    setUndoState(result.discarded ? 'undone' : 'idle')
  }

  if (hideWhenEmpty && !loading && files.length === 0) return <></>

  return (
    <div className="flex justify-start min-w-0 w-full">
      <div
        className="codex-review-card"
        data-testid="codex-review-card"
        data-review-card-layout="file-first"
        data-review-card-file-count={files.length}
        data-review-card-additions={totals.additions}
        data-review-card-deletions={totals.deletions}
        data-review-card-undo-state={undoState}
        data-review-card-undo-available={canUndo ? 'true' : 'false'}
        data-review-card-source={reviewCardSource}
        data-review-card-provider-session-id={reviewCardSource === 'last-turn' ? lastTurnDiffEvent?.providerSessionId ?? '' : ''}
        data-review-card-provider-turn-id={reviewCardSource === 'last-turn' ? lastTurnDiffEvent?.providerTurnId ?? '' : ''}
        data-review-card-provider-checkpoint-id={reviewCardSource === 'last-turn' ? lastTurnDiffEvent?.checkpointId ?? '' : ''}
        data-review-card-provider-checkpoint-adapter-supported={reviewCardSource === 'last-turn' && lastTurnDiffEvent?.checkpointUndoSupported === true ? 'true' : 'false'}
        data-review-card-provider-checkpoint-undo={providerCheckpointUndoStatus}
        data-review-card-undo-kind={undoKind}
      >
        <div className="codex-review-card-summary">
          <span className="codex-review-card-icon" aria-hidden="true">
            <Icon name="diff" size={15} />
          </span>
          <span className="codex-review-card-title">
            {title}
          </span>
          <span className="codex-review-card-totals" data-testid="codex-review-card-totals">
            {totals.additions > 0 && <span className="codex-review-card-additions">+{totals.additions}</span>}
            {totals.deletions > 0 && <span className="codex-review-card-deletions">-{totals.deletions}</span>}
          </span>
          <span className="codex-review-card-actions">
            <button
              type="button"
              className="codex-review-card-action"
              data-testid="codex-review-card-undo"
              disabled={!canUndo}
              title={undoTitle}
              aria-label={undoTitle}
              onClick={() => { void undoReviewChanges() }}
            >
              {undoState === 'undoing' ? 'Undoing...' : 'Undo'}
            </button>
            <button
              type="button"
              className="codex-review-card-action codex-review-card-review-action"
              data-testid="codex-review-card-review"
              title={reviewTitle}
              aria-label={reviewTitle}
              onClick={openReview}
            >
              Review
            </button>
          </span>
        </div>
        {undoState === 'error' && undoError && (
          <div className="codex-review-card-error" data-testid="codex-review-card-undo-error">
            {undoError}
          </div>
        )}
        <div className="codex-review-card-list" data-testid="codex-review-card-file-list" data-review-card-inline-diffs="true">
          {loading ? (
            <div className="codex-review-card-empty">Loading changes...</div>
          ) : visibleFiles.length === 0 ? (
            <div className="codex-review-card-empty">{statusBody(content)}</div>
          ) : (
            visibleFiles.map((file) => {
              const fileExpanded = expandedPath === file.path
              const diffState = diffsByPath[file.path]
              const fileStatusLabel = reviewCardStatusLabel(file)
              const fileStatsLabel = [
                file.additions > 0 ? `${file.additions} ${file.additions === 1 ? 'addition' : 'additions'}` : '',
                file.deletions > 0 ? `${file.deletions} ${file.deletions === 1 ? 'deletion' : 'deletions'}` : ''
              ].filter(Boolean).join(', ')
              const fileActionLabel = `${fileStatusLabel} ${file.path}${fileStatsLabel ? `, ${fileStatsLabel}` : ''}`
              return (
                <div
                  key={file.path}
                  className="codex-review-card-file-group"
                  data-review-card-file-expanded={fileExpanded ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className="codex-review-card-file"
                    data-testid="codex-review-card-file"
                    data-review-card-path={file.path}
                    data-review-card-status={reviewCardStatus(file)}
                    aria-expanded={fileExpanded}
                    aria-label={fileActionLabel}
                    onClick={() => setExpandedPath((current) => current === file.path ? null : file.path)}
                    title={file.path}
                  >
                    <span className="codex-review-card-file-leading">
                      <span className="codex-review-card-file-status">{fileStatusLabel}</span>
                      <span className="codex-review-card-path">{file.path}</span>
                    </span>
                    <span className="codex-review-card-file-stats">
                      {file.additions > 0 && <span className="codex-review-card-additions">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="codex-review-card-deletions">-{file.deletions}</span>}
                    </span>
                    <span className="codex-review-card-chevron" aria-hidden="true">
                      <Icon name="chevronDown" size={13} />
                    </span>
                  </button>
                  {fileExpanded && (
                    <TranscriptDiffPreview
                      path={file.path}
                      diff={diffState?.diff ?? ''}
                      loading={diffState?.loading !== false}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
        {files.length > 3 && (
          <button
            type="button"
            className="codex-review-card-show-more"
            data-testid="codex-review-card-show-more"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? 'Show fewer files' : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'file' : 'files'}`}
            <span style={{ transform: expanded ? 'rotate(180deg)' : undefined }}>
              <Icon name="chevronDown" size={13} />
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

function TranscriptDiffPreview({ path, diff, loading }: { path: string; diff: string; loading: boolean }): JSX.Element {
  const lines = useMemo(() => diff.split(/\r?\n/).slice(0, 80), [diff])
  if (loading) {
    return (
      <div className="codex-review-card-inline-diff" data-testid="codex-review-card-inline-diff" data-review-card-inline-diff-loading="true">
        <div className="codex-review-card-inline-diff-header">
          <span className="codex-review-card-inline-diff-path">{path}</span>
        </div>
        <div className="codex-review-card-inline-diff-empty">Loading diff...</div>
      </div>
    )
  }
  if (!diff.trim()) {
    return (
      <div className="codex-review-card-inline-diff" data-testid="codex-review-card-inline-diff" data-review-card-inline-diff-empty="true">
        <div className="codex-review-card-inline-diff-header">
          <span className="codex-review-card-inline-diff-path">{path}</span>
        </div>
        <div className="codex-review-card-inline-diff-empty">No inline diff available.</div>
      </div>
    )
  }
  return (
    <div className="codex-review-card-inline-diff" data-testid="codex-review-card-inline-diff">
      <div className="codex-review-card-inline-diff-header">
        <span className="codex-review-card-inline-diff-path">{path}</span>
        <span className="codex-review-card-inline-diff-count">
          {lines.length < diff.split(/\r?\n/).length ? 'First 80 lines' : `${lines.length} lines`}
        </span>
      </div>
      <pre className="codex-review-card-inline-diff-code" aria-label={`Inline diff for ${path}`}>
        {lines.map((line, index) => (
          <span
            key={`${index}:${line}`}
            className="codex-review-card-inline-diff-line"
            data-line-kind={reviewCardDiffLineKind(line)}
          >
            {line || ' '}
          </span>
        ))}
      </pre>
    </div>
  )
}

function reviewCardStatus(file: FileChange): 'added' | 'deleted' | 'edited' {
  if (file.status === 'A' || file.status === '?') return 'added'
  if (file.status === 'D') return 'deleted'
  return 'edited'
}

function reviewCardStatusLabel(file: FileChange): string {
  switch (reviewCardStatus(file)) {
    case 'added':
      return 'Created'
    case 'deleted':
      return 'Deleted'
    case 'edited':
      return 'Edited'
  }
}

function reviewCardDiffLineKind(line: string): 'addition' | 'deletion' | 'hunk' | 'meta' | 'context' {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'meta'
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  return 'context'
}

function isChangesStatus(content: string): boolean {
  return /^(Diff updated|Patch updated|Changes updated|Changes):?/i.test(content.trim())
}

function isDiffUpdatedStatus(content: string): boolean {
  return /^Diff updated\b/i.test(content.trim())
}

function latestDiffUpdatedEvent(events: SessionRunEventRecord[]): DiffUpdatedRunEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]?.event
    if (event?.type === 'diff.updated' && event.content.trim().length > 0) return event
  }
  return null
}

function statusBody(content: string): string {
  if (/^Diff updated/i.test(content)) return content
  if (/^Goal\b/i.test(content)) return compactGoalStatusBody(content)
  const stripped = content.replace(/^(Goal|Auto-review|MCP progress|Reasoning|Patch updated|Thread compacted|Context compacted|Thread status|Thread renamed|Thread closed|Turn started|Hook started|Hook completed|Realtime|Model rerouted|Model verification|Codex warning|Codex guardian warning|Codex deprecation notice|Codex config warning):?\s*/i, '')
  return stripped.trim() || content
}

function compactGoalStatusBody(content: string): string {
  const normalized = content
    .replace(/^Goal:?\s*/i, '')
    .split(/\s+·\s+/)[0]
    ?.replace(/\s+\((active|complete|completed|paused|cancelled|canceled|failed)\)$/i, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.trim() ?? content.trim()
  const firstSentence = normalized.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim() ?? normalized
  if (firstSentence.length <= 132) return firstSentence
  return `${firstSentence.slice(0, 129).trimEnd()}...`
}

function statusMeta(content: string): StatusMeta {
  const lower = content.toLowerCase()
  if (lower.startsWith('goal')) return { label: 'Goal', tone: 'var(--color-accent)', icon: iconPath('target') }
  if (lower.startsWith('diff updated') || lower.startsWith('patch updated')) return { label: 'Changes', tone: 'var(--color-green)', icon: iconPath('diff') }
  if (lower.startsWith('auto-review') || lower.includes('review mode')) return { label: 'Review', tone: 'var(--color-yellow)', icon: iconPath('review') }
  if (lower.startsWith('mcp')) return { label: 'MCP', tone: 'var(--color-accent)', icon: iconPath('plug') }
  if (lower.startsWith('reasoning')) return { label: 'Reasoning', tone: 'var(--color-text-muted)', icon: iconPath('spark') }
  if (lower.includes('warning') || lower.includes('error')) return { label: 'Notice', tone: 'var(--color-yellow)', icon: iconPath('warning') }
  if (lower.startsWith('thread') || lower.startsWith('turn') || lower.startsWith('hook')) return { label: 'Run', tone: 'var(--color-text-muted)', icon: iconPath('activity') }
  if (lower.startsWith('realtime')) return { label: 'Realtime', tone: 'var(--color-accent)', icon: iconPath('wave') }
  return { label: 'Status', tone: 'var(--color-text-muted)', icon: iconPath('activity') }
}

function iconPath(kind: 'target' | 'diff' | 'review' | 'plug' | 'spark' | 'warning' | 'activity' | 'wave'): JSX.Element {
  const paths: Record<typeof kind, string> = {
    target: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2.25a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z',
    diff: 'M4.75 2a.75.75 0 0 1 .75.75V5h2.25a.75.75 0 0 1 0 1.5H5.5v2.25a.75.75 0 0 1-1.5 0V6.5H1.75a.75.75 0 0 1 0-1.5H4V2.75A.75.75 0 0 1 4.75 2Zm5.5 7.5h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z',
    review: 'M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-8.5A1.75 1.75 0 0 0 13.25 2H2.75Zm1 3h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 3h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Z',
    plug: 'M5 1.75a.75.75 0 0 1 1.5 0V4h3V1.75a.75.75 0 0 1 1.5 0V4h.75a.75.75 0 0 1 0 1.5H11v1.25A3.75 3.75 0 0 1 8.75 10.2v2.05a.75.75 0 0 1-1.5 0V10.2A3.75 3.75 0 0 1 5 6.75V5.5h-.75a.75.75 0 0 1 0-1.5H5V1.75Z',
    spark: 'M8 1.5 9.25 5.7 13.5 7 9.25 8.3 8 12.5 6.75 8.3 2.5 7l4.25-1.3L8 1.5Z',
    warning: 'M7.16 2.33a1 1 0 0 1 1.68 0l6.02 9.52A1 1 0 0 1 14.02 13H1.98a1 1 0 0 1-.84-1.15l6.02-9.52ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 6a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6Z',
    activity: 'M1.75 8.75h2.5l1.25-4 2.5 7.5 2-5h4.25a.75.75 0 0 0 0-1.5H9l-.9 2.25-2.7-8.1-2.25 7.35h-1.4a.75.75 0 0 0 0 1.5Z',
    wave: 'M1.5 8c1.2-2.1 2.4-2.1 3.6 0s2.4 2.1 3.6 0 2.4-2.1 3.6 0 2.4 2.1 3.6 0v2c-1.2 2.1-2.4 2.1-3.6 0s-2.4-2.1-3.6 0-2.4 2.1-3.6 0-2.4-2.1-3.6 0V8Z'
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  )
}

function MessageAttachmentList({ attachments }: { attachments: Attachment[] }): JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {attachments.map((attachment) => (
        <AttachmentPill
          key={attachment.id}
          label={attachment.kind === 'local_file' ? attachment.name : attachment.name ?? attachment.relativePath}
          title={attachment.kind === 'local_file' ? attachment.path : `${attachment.fileId}:${attachment.relativePath}`}
          className="text-[10px]"
        />
      ))}
    </div>
  )
}

function FileReferenceList({ files, cwd, searchRoots, preferredEditor }: { files: FileReference[]; cwd: string; searchRoots: string[]; preferredEditor: PreferredEditor }): JSX.Element {
  return (
    <div className="mt-3 min-w-0 max-w-full space-y-1.5" aria-label="Referenced files" data-testid="file-reference-list">
      {files.map((file) => (
        <FileReferenceCard key={`${file.path}:${file.line ?? ''}:${file.column ?? ''}`} file={file} cwd={cwd} searchRoots={searchRoots} preferredEditor={preferredEditor} />
      ))}
    </div>
  )
}

function FileReferenceCard({ file, cwd, searchRoots, preferredEditor }: { file: FileReference; cwd: string; searchRoots: string[]; preferredEditor: PreferredEditor }): JSX.Element {
  const [exists, setExists] = useState<boolean | null>(null)
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const displayPath = resolvedPath ?? file.path
  const displayLabel = resolvedPath ? fileName(resolvedPath) : file.label
  const targetLabel = file.line ? `:${file.line}${file.column ? `:${file.column}` : ''}` : ''

  useEffect(() => {
    let cancelled = false
    setExists(null)
    setResolvedPath(null)
    setError(null)

    const resolve = async (): Promise<void> => {
      try {
        const stat = await window.api.fs.statPath(file.path)
        if (cancelled) return
        if (stat.exists) {
          setResolvedPath(file.path)
          setExists(true)
          return
        }

        for (const root of uniqueRoots(cwd, searchRoots)) {
          const workspacePath = await window.api.fs.resolveWorkspaceFileReference(root, file.path)
          if (cancelled) return
          if (workspacePath) {
            setResolvedPath(workspacePath)
            setExists(true)
            return
          }
        }

        if (file.source === 'relative') {
          setExists(false)
          return
        }

        setExists(false)
      } catch {
        if (!cancelled) setExists(false)
      }
    }

    void resolve()
    return () => { cancelled = true }
  }, [cwd, file.path, searchRoots])

  const openPath = async (): Promise<void> => {
    setError(null)
    const result = await window.api.fs.openPath(displayPath, { line: file.line, column: file.column })
    if (!result.ok) setError(result.message ?? 'Unable to open file.')
  }

  const revealPath = async (): Promise<void> => {
    setError(null)
    await window.api.fs.showInFolder(displayPath)
  }

  if (exists === false && file.source === 'relative') return <></>

  return (
    <div
      data-testid="file-reference-card"
      className="min-w-0 max-w-full overflow-hidden rounded-lg px-3 py-2 text-xs"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)'
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 8 3.25V1.5Zm5.75.06v1.69c0 .138.112.25.25.25h1.69Z" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{displayLabel}{targetLabel}</div>
          <div className="truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }} title={displayPath}>
            {displayPath}
          </div>
        </div>
        {exists === false && (
          <span className="shrink-0" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
            missing
          </span>
        )}
        <button
          type="button"
          onClick={openPath}
          disabled={exists === false}
          className="shrink-0 rounded-md px-2 py-1 transition-colors"
          style={{
            color: exists === false ? 'var(--color-text-muted)' : 'var(--color-accent)',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            opacity: exists === false ? 0.5 : 1
          }}
        >
          {openButtonLabel(preferredEditor)}
        </button>
        <button
          type="button"
          onClick={revealPath}
          disabled={exists === false}
          className="shrink-0 rounded-md px-2 py-1 transition-colors"
          style={{
            color: exists === false ? 'var(--color-text-muted)' : 'var(--color-text)',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            opacity: exists === false ? 0.5 : 1
          }}
        >
          Reveal
        </button>
      </div>
      {error && (
        <div className="mt-1" style={{ color: 'var(--color-red)', fontSize: 10 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function fileName(filePath: string): string {
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

function openButtonLabel(editor: PreferredEditor): string {
  switch (editor) {
    case 'cursor':
      return 'Open in Cursor'
    case 'vscode':
      return 'Open in VS Code'
    case 'vscode-insiders':
      return 'Open in Insiders'
    case 'zed':
      return 'Open in Zed'
    case 'system':
      return 'Open'
  }
}

function uniqueRoots(cwd: string, roots: string[]): string[] {
  return [...new Set([cwd, ...roots].filter(Boolean).map((root) => root.replace(/\/+$/, '')))]
}

function sessionFileReferenceRoots(session: Session): string[] {
  const roots = new Set<string>()
  roots.add(session.workDir)
  for (const dir of session.additionalDirs ?? []) roots.add(dir)

  for (const message of session.messages.slice(-80)) {
    const content = fileReferenceSearchContent(message)
    if (!content) continue
    for (const root of extractWorkspaceRootsFromText(content, session.workDir)) {
      roots.add(root)
    }
  }

  return [...roots]
}

function fileReferenceSearchContent(message: ChatMessage): string | null {
  if (message.type === 'text' || message.type === 'tool_result') return message.content
  if (message.type === 'tool_use') return JSON.stringify(message.toolInput)
  return null
}

function ToolActivitySummary({ messages, session }: { messages: Array<ToolUseMessage | ToolResultMessage>; session: Session }): JSX.Element {
  const activities = pairToolActivities(messages)
  const orphanResults = messages.filter((message): message is ToolResultMessage => message.type === 'tool_result' && !activities.some((activity) => activity.result?.id === message.id))
  const hasErrors = activities.some((activity) => activity.result?.isError) || orphanResults.some((result) => result.isError)
  const summary = summarizeToolActivities(activities, orphanResults)
  const rowCount = activities.length + orphanResults.length
  const shouldScroll = rowCount > TOOL_SUMMARY_SCROLL_THRESHOLD

  return (
    <div className="flex justify-start min-w-0 w-full" data-testid="tool-activity-summary">
      <div className="w-full min-w-0" style={{ maxWidth: 'min(760px, 100%)' }}>
        <DisclosureSection
          title={<span style={{ color: hasErrors ? 'var(--color-red)' : 'var(--color-text-muted)' }}>{summary}</span>}
        >
          <div
            data-testid="tool-activity-body"
            className="min-w-0 overflow-y-auto overflow-x-hidden pl-5 pr-1 pb-1 text-xs"
            style={{
              color: 'var(--color-text-muted)',
              maxHeight: shouldScroll ? TOOL_SUMMARY_MAX_HEIGHT : undefined,
              overscrollBehavior: 'contain'
            }}
          >
            <div className="min-w-0 space-y-1">
              {hasErrors && <ToolFailureRecovery session={session} />}
              {activities.map((activity) => (
                <div key={activity.tool.id} className="flex min-w-0 max-w-full items-start gap-2">
                  <span
                    className="shrink-0"
                    style={{ color: activity.result?.isError ? 'var(--color-red)' : actionColor(describeToolAction(activity.tool).risk) }}
                  >
                    {activity.result?.isError ? 'Error' : 'Done'}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={describeToolActivity(activity.tool)}>
                    {describeToolActivity(activity.tool)}
                  </span>
                </div>
              ))}
              {orphanResults.map((result) => (
                <div key={result.id} className="flex min-w-0 max-w-full items-start gap-2">
                  <span className="shrink-0" style={{ color: result.isError ? 'var(--color-red)' : 'var(--color-text-muted)' }}>
                    {result.isError ? 'Error' : 'Done'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Tool result
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DisclosureSection>
      </div>
    </div>
  )
}

function ToolFailureRecovery({ session }: { session: Session }): JSX.Element {
  const [retryState, setRetryState] = useState<'idle' | 'retrying' | 'sent' | 'error'>('idle')
  const [retryError, setRetryError] = useState<string | null>(null)
  const activeSession = isActiveSessionStatus(session.status)
  const canRetry = hasRetryableUserMessage(session)
  const actionLabel = activeSession ? 'Stop and retry' : 'Retry last message'

  const retryLastMessage = async (): Promise<void> => {
    if (!canRetry || retryState === 'retrying') return
    setRetryState('retrying')
    setRetryError(null)
    try {
      if (activeSession) {
        await window.api.sessions.stop(session.id)
        await new Promise((resolve) => setTimeout(resolve, 160))
      }
      const ok = await window.api.sessions.retryLastUserMessage(session.id)
      if (!ok) {
        setRetryState('error')
        setRetryError('No retryable message is available.')
        return
      }
      setRetryState('sent')
    } catch (error) {
      setRetryState('error')
      setRetryError(error instanceof Error ? error.message : 'Retry failed.')
    }
  }

  return (
    <div
      className="mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg px-2 py-1.5"
      data-testid="tool-failure-recovery"
      role="group"
      aria-label="Tool failure recovery"
      style={{
        background: 'color-mix(in srgb, var(--color-red) 8%, var(--color-surface2))',
        border: '1px solid color-mix(in srgb, var(--color-red) 24%, var(--color-border))',
        color: 'var(--color-text)'
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-red)' }}>
          Tool failed
        </div>
        {(retryError || retryState === 'sent') && (
          <div
            className="truncate text-[11px]"
            data-testid="tool-failure-retry-status"
            role={retryState === 'error' ? 'alert' : 'status'}
            aria-live={retryState === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
            style={{ color: retryState === 'error' ? 'var(--color-red)' : 'var(--color-green)' }}
          >
            {retryState === 'error' ? retryError : 'Retry sent'}
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        className="h-7 shrink-0 px-2 text-[11px]"
        dataTestId="tool-failure-retry-last"
        disabled={!canRetry || retryState === 'retrying'}
        ariaLabel={actionLabel}
        onClick={() => { void retryLastMessage() }}
      >
        {retryState === 'retrying' ? 'Retrying...' : actionLabel}
      </Button>
    </div>
  )
}

function actionColor(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'high') return 'var(--color-red)'
  if (risk === 'medium') return 'var(--color-yellow)'
  return 'var(--color-text-muted)'
}

function UserInputCard({
  msg,
  sessionId,
  sessionStatus
}: {
  msg: ResultMessage
  sessionId: string
  sessionStatus: Session['status']
}): JSX.Element {
  const [answer, setAnswer] = useState('')
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string[]>>({})
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const answerInputRef = useRef<HTMLTextAreaElement>(null)
  const questions = msg.userInputQuestions?.length ? msg.userInputQuestions : [{ question: msg.content }]
  const requestIsActive = sessionStatus === 'waiting_for_user'
  const isAnswered = submitState === 'sent' || !requestIsActive
  const isSending = submitState === 'sending'
  const hasMultipleQuestions = questions.length > 1

  useEffect(() => {
    if (!requestIsActive || submitState === 'sent') return
    answerInputRef.current?.focus({ preventScroll: true })
  }, [requestIsActive, submitState])

  const composeAnswer = (freeform: string): string => {
    const selectedAnswers = questions.flatMap((question, index) => {
      const selected = questionAnswers[questionInputKey(question, index)]?.map((value) => value.trim()).filter(Boolean) ?? []
      if (selected.length === 0) return []
      const label = question.header ? `${question.header}: ${question.question}` : question.question
      return [`${label}\nAnswer: ${selected.join(', ')}`]
    })
    const trimmedFreeform = freeform.trim()
    if (selectedAnswers.length === 0) return trimmedFreeform
    return [...selectedAnswers, ...(trimmedFreeform ? [`Additional details:\n${trimmedFreeform}`] : [])].join('\n\n')
  }

  const composedAnswer = composeAnswer(answer)

  const submitAnswer = async (value: string): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSubmitState('sending')
    setSubmitError(null)
    try {
      const result = await window.api.sessions.answerUserInput(sessionId, trimmed)
      if (result.ok) {
        setSubmitState('sent')
      } else {
        setSubmitState('error')
        setSubmitError(result.error ?? 'Could not resume the session.')
      }
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : 'Could not resume the session.')
    }
  }

  const selectQuestionAnswer = (question: UserInputQuestion, index: number, value: string): void => {
    const key = questionInputKey(question, index)
    setQuestionAnswers((current) => {
      const currentValues = current[key] ?? []
      if (!question.multiSelect) return { ...current, [key]: [value] }
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((candidate) => candidate !== value)
        : [...currentValues, value]
      return { ...current, [key]: nextValues }
    })
  }

  return (
    <div className="flex justify-center my-1">
      <SurfaceRow
        className="rounded-xl px-4 py-3 w-full"
        dataTestId="chat-user-input-card"
        style={{
          maxWidth: 560,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: isAnswered ? 'var(--color-green)' : 'var(--color-yellow)', flexShrink: 0 }}>
            {isAnswered ? (
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            ) : (
              <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm7.25 4.25a.75.75 0 0 1 1.5 0v.01a.75.75 0 0 1-1.5 0v-.01ZM6.5 5.75A1.5 1.5 0 0 1 8 4.25c.828 0 1.5.67 1.5 1.49 0 .54-.277.86-.897 1.296l-.335.23C7.55 7.76 7.25 8.29 7.25 9.25a.75.75 0 0 0 1.5 0c0-.34.043-.427.367-.65l.35-.24C10.101 7.914 11 7.28 11 5.74a3 3 0 0 0-6 .01.75.75 0 0 0 1.5 0Z" />
            )}
          </svg>
          <StatusBadge label={isAnswered ? 'Answer sent' : 'Answer required'} tone={isAnswered ? 'success' : 'warning'} />
        </div>
        <div className="space-y-3">
          {questions.map((question, index) => (
            <QuestionBlock
              key={`${question.question}-${index}`}
              question={question}
              index={index}
              disabled={isAnswered || isSending}
              selectedAnswers={questionAnswers[questionInputKey(question, index)] ?? []}
              onSelectAnswer={(value) => {
                if (hasMultipleQuestions) selectQuestionAnswer(question, index, value)
                else void submitAnswer(value)
              }}
            />
          ))}
        </div>
        {!isAnswered && (
          <form
            className="mt-3 flex flex-wrap gap-2"
            data-testid="chat-user-input-form"
            data-user-input-question-count={questions.length}
            data-user-input-selected-count={Object.values(questionAnswers).filter((values) => values.some((value) => value.trim())).length}
            data-user-input-selected-option-count={Object.values(questionAnswers).reduce((count, values) => count + values.filter((value) => value.trim()).length, 0)}
            onSubmit={(event) => {
              event.preventDefault()
              void submitAnswer(composedAnswer)
            }}
          >
            <textarea
              ref={answerInputRef}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={hasMultipleQuestions ? 'Add details...' : 'Type an answer...'}
              disabled={isSending}
              rows={1}
              className="min-h-9 min-w-0 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
            />
            <Button
              type="submit"
              disabled={!composedAnswer.trim() || isSending}
              variant="primary"
              className="px-4 py-2"
              dataTestId="chat-user-input-send"
            >
              {isSending ? 'Sending...' : 'Send'}
            </Button>
          </form>
        )}
        {submitState === 'error' && submitError && (
          <div
            className="mt-2 text-xs"
            data-testid="chat-user-input-error"
            role="alert"
            aria-live="assertive"
            style={{ color: 'var(--color-red)' }}
          >
            {submitError}
          </div>
        )}
        {isAnswered && (
          <div className="mt-2 text-xs" role="status" aria-live="polite" aria-atomic="true" style={{ color: 'var(--color-green)' }}>
            {submitState === 'sent' ? 'Answer sent - resuming...' : 'Answered'}
          </div>
        )}
      </SurfaceRow>
    </div>
  )
}

function QuestionBlock({
  question,
  index,
  disabled,
  selectedAnswers,
  onSelectAnswer
}: {
  question: UserInputQuestion
  index: number
  disabled: boolean
  selectedAnswers: string[]
  onSelectAnswer: (answer: string) => void
}): JSX.Element {
  return (
    <div data-testid="chat-user-input-question" data-question-index={index}>
      {question.header && (
        <div className="mb-1 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {question.header}
        </div>
      )}
      <div className="text-sm" style={{ color: 'var(--color-text)' }}>
        {question.question}
      </div>
      {question.options && question.options.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {question.options.map((option) => (
            (() => {
              const selected = selectedAnswers.includes(option.label)
              return (
            <SurfaceRow
              as="button"
              key={option.label}
              disabled={disabled}
              className="rounded-lg px-3 py-2 text-left disabled:opacity-50"
              dataTestId="chat-user-input-option"
              data-selected={selected ? 'true' : 'false'}
              ariaPressed={selected}
              ariaLabel={`${selected ? 'Selected' : 'Select'} ${option.label}`}
              style={{
                background: selected ? 'color-mix(in srgb, var(--accent) 14%, var(--color-surface))' : 'var(--color-surface)',
                color: 'var(--color-text)',
                border: selected ? '1px solid color-mix(in srgb, var(--accent) 45%, var(--color-border))' : '1px solid var(--color-border)'
              }}
              onClick={() => { if (!disabled) onSelectAnswer(option.label) }}
            >
              <div className="text-sm">{option.label}</div>
              {option.description && (
                <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {option.description}
                </div>
              )}
            </SurfaceRow>
              )
            })()
          ))}
        </div>
      )}
    </div>
  )
}

function questionInputKey(question: UserInputQuestion, index: number): string {
  return question.id ?? `${index}:${question.question}`
}

function PermissionCard({ msg, sessionId, sessionStatus }: { msg: ResultMessage; sessionId: string; sessionStatus: Session['status'] }): JSX.Element {
  const [decision, setDecision] = useState<'pending' | 'allowed_once' | 'allowed_session' | 'denied'>('pending')
  const [submittingDecision, setSubmittingDecision] = useState<'allowed_once' | 'allowed_session' | 'denied' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const denials = msg.permissionDenials ?? []
  const requestDetails = denials.map(permissionRequestDetail)
  const toolNames = [...new Set(denials.map((d) => d.tool_name))]
  const isPlanApproval = denials.some((d) => d.tool_name === 'ExitPlanMode')
  const requestIsActive = sessionStatus === 'waiting_for_permission'
  const displayDecision = msg.permissionDecision ?? decision
  const permissionTarget = permissionDecisionTarget(requestDetails, toolNames, isPlanApproval)
  const allowOnceLabel = isPlanApproval ? 'Approve plan' : `Allow once for ${permissionTarget}`
  const allowSessionLabel = `Allow for session for ${permissionTarget}`
  const denyLabel = isPlanApproval ? 'Keep planning' : `Deny ${permissionTarget}`

  const submitPermissionDecision = async (
    nextDecision: 'allowed_once' | 'allowed_session' | 'denied',
    action: () => Promise<{ ok: boolean; error?: string }>
  ): Promise<void> => {
    setSubmittingDecision(nextDecision)
    setSubmitError(null)
    try {
      const result = await action()
      if (result.ok) {
        setDecision(nextDecision)
      } else {
        setSubmitError(result.error ?? 'The session could not resume from this approval.')
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The session could not resume from this approval.')
    } finally {
      setSubmittingDecision(null)
    }
  }

  const handleAllowOnce = async (): Promise<void> => {
    await submitPermissionDecision('allowed_once', () =>
      isPlanApproval
        ? window.api.sessions.grantAndResume(sessionId, toolNames)
        : window.api.sessions.allowOnceAndResume(sessionId, toolNames)
    )
  }

  const handleAllowSession = async (): Promise<void> => {
    await submitPermissionDecision('allowed_session', () => window.api.sessions.grantAndResume(sessionId, toolNames))
  }

  const handleDeny = async (): Promise<void> => {
    await submitPermissionDecision('denied', () =>
      isPlanApproval
        ? window.api.sessions.answerUserInput(sessionId, 'Keep planning. Do not exit plan mode yet.')
        : window.api.sessions.denyPermission(sessionId)
    )
  }

  return (
    <div className="flex justify-center my-1">
      <SurfaceRow
        className="rounded-xl px-4 py-3 w-full"
        dataTestId="chat-permission-card"
        style={{
          maxWidth: 560,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
            <path d="M8 0a5 5 0 0 0-5 5v1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a5 5 0 0 0-5-5Zm-3 5a3 3 0 1 1 6 0v1H5V5Zm3 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
          </svg>
          <StatusBadge label={isPlanApproval ? 'Plan ready' : 'Permission required'} tone="accent" pulse={requestIsActive && decision === 'pending'} />
        </div>
        <div className="mb-3 space-y-2">
          {requestDetails.map((detail, i) => (
            <div
              key={i}
              className="rounded-lg px-3 py-2"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                minWidth: 0
              }}
            >
              <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                  {detail.title}
                </span>
                <span
                  className="text-[10px] font-semibold"
                  style={{
                    color: permissionRiskColor(detail.risk),
                    border: `1px solid ${permissionRiskColor(detail.risk)}`,
                    borderRadius: 999,
                    padding: '1px 6px',
                    lineHeight: '14px'
                  }}
                >
                  {detail.toolName}
                </span>
              </div>
              {detail.fields.length > 0 ? (
                <div className="mt-2" style={{ display: 'grid', gap: 6 }}>
                  {detail.fields.slice(0, 4).map((field) => (
                    <div
                      key={`${field.label}:${field.value}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '72px minmax(0, 1fr)',
                        gap: 8,
                        alignItems: 'baseline',
                        fontSize: 11,
                        lineHeight: 1.35
                      }}
                    >
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>
                        {field.label}
                      </span>
                      <span
                        style={{
                          color: 'var(--color-text)',
                          fontFamily: field.mono ? 'var(--font-mono)' : undefined,
                          overflowWrap: 'anywhere',
                          whiteSpace: field.value.includes('\n') ? 'pre-wrap' : 'normal'
                        }}
                      >
                        {field.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className="mt-1 text-xs"
                  style={{ color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}
                >
                  {detail.summary}
                </div>
              )}
            </div>
          ))}
        </div>
        {decision === 'pending' && requestIsActive ? (
          isPlanApproval ? (
            <div className="flex flex-wrap gap-2" data-testid="chat-permission-actions" role="group" aria-label="Plan approval actions">
              <Button
                onClick={handleAllowOnce}
                variant="primary"
                disabled={submittingDecision !== null}
                className="min-w-[132px] flex-1"
                dataTestId="chat-permission-allow-once"
                ariaLabel={allowOnceLabel}
              >
                {submittingDecision === 'allowed_once' ? 'Approving...' : 'Approve Plan'}
              </Button>
              <Button
                onClick={handleDeny}
                variant="secondary"
                disabled={submittingDecision !== null}
                className="min-w-[120px] px-4"
                dataTestId="chat-permission-deny"
                ariaLabel={denyLabel}
              >
                {submittingDecision === 'denied' ? 'Sending...' : 'Keep Planning'}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="chat-permission-actions" role="group" aria-label="Permission decision actions">
              <Button
                onClick={handleAllowOnce}
                variant="primary"
                disabled={submittingDecision !== null}
                className="min-w-[112px] flex-1"
                dataTestId="chat-permission-allow-once"
                ariaLabel={allowOnceLabel}
              >
                {submittingDecision === 'allowed_once' ? 'Allowing...' : 'Allow Once'}
              </Button>
              <Button
                onClick={handleAllowSession}
                variant="secondary"
                disabled={submittingDecision !== null}
                className="min-w-[124px] flex-1"
                dataTestId="chat-permission-allow-session"
                ariaLabel={allowSessionLabel}
              >
                {submittingDecision === 'allowed_session' ? 'Allowing...' : 'Allow Session'}
              </Button>
              <Button
                onClick={handleDeny}
                variant="secondary"
                disabled={submittingDecision !== null}
                className="min-w-[76px] px-4"
                dataTestId="chat-permission-deny"
                ariaLabel={denyLabel}
              >
                {submittingDecision === 'denied' ? 'Denying...' : 'Deny'}
              </Button>
            </div>
          )
        ) : (
          <div className="text-xs font-medium" role="status" aria-live="polite" aria-atomic="true" style={{ color: permissionDecisionColor(displayDecision) }}>
            {displayDecision === 'allowed_session'
              ? isPlanApproval ? 'Plan approved' : requestIsActive ? 'Allowed for session - resuming...' : 'Allowed for session'
              : displayDecision === 'allowed_once'
                ? isPlanApproval ? 'Plan approved' : requestIsActive ? 'Allowed once - resuming...' : 'Allowed once'
                : displayDecision === 'denied'
                  ? isPlanApproval ? 'Kept planning' : 'Denied'
                  : displayDecision === 'kept_planning'
                    ? 'Kept planning'
                  : 'Handled'}
          </div>
        )}
        {submitError && (
          <div
            className="mt-2 rounded-lg px-3 py-2 text-xs"
            data-testid="chat-permission-error"
            role="alert"
            aria-live="assertive"
            style={{
              color: 'var(--color-red)',
              background: 'color-mix(in srgb, var(--color-red) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-red) 28%, transparent)'
            }}
          >
            {submitError}
          </div>
        )}
      </SurfaceRow>
    </div>
  )
}

function permissionDecisionTarget(
  requestDetails: ReturnType<typeof permissionRequestDetail>[],
  toolNames: string[],
  isPlanApproval: boolean
): string {
  if (isPlanApproval) return 'plan approval'
  if (requestDetails.length === 1) {
    const kind = requestDetails[0]?.kind
    if (kind === 'profile') return 'permission profile'
    if (kind === 'command') return 'command permission'
    if (kind === 'file') return 'file permission'
    if (kind === 'network') return 'network permission'
    if (kind === 'mcp') return 'MCP permission'
    return `${toolNames[0] ?? 'tool'} permission`
  }
  return `${requestDetails.length || toolNames.length} permission requests`
}

function permissionDecisionColor(decision: ResultMessage['permissionDecision'] | 'pending'): string {
  if (decision === 'allowed_once' || decision === 'allowed_session') return 'var(--color-green)'
  if (decision === 'denied') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}

function permissionRiskColor(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'high') return 'var(--color-red)'
  if (risk === 'medium') return 'var(--color-yellow)'
  return 'var(--color-green)'
}

function ThinkingIndicator({ streaming }: { streaming: boolean }): JSX.Element {
  const statusText = streaming ? 'Assistant response streaming' : 'Assistant is thinking'
  return (
    <div className="flex justify-center">
      <div
        className="transcript-thinking-indicator"
        data-testid="thinking-indicator"
        data-thinking-indicator-streaming={streaming ? 'true' : 'false'}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <ThinkingDots label={statusText} />
        <span className="sr-only">{statusText}</span>
      </div>
    </div>
  )
}
