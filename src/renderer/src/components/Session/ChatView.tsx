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
} from '../shared/designSystem'
import {
  describeToolAction,
  describeToolActivity,
  extractFileReferences,
  extractWorkspaceRootsFromText,
  pairToolActivities,
  permissionSummary,
  summarizeToolActivities
} from '../../types'
import type { Session, ChatMessage, FileReference, ResultMessage, ToolResultMessage, ToolUseMessage, UserInputQuestion } from '../../types'
import type { Attachment } from '../../types'
import type { TranscriptSearchResult } from '../../types'
import { useSessionStore } from '../../store/sessions'
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
  session: Session
}

const TOOL_SUMMARY_SCROLL_THRESHOLD = 8
const TOOL_SUMMARY_MAX_HEIGHT = 220
const FOLLOW_BOTTOM_THRESHOLD = 80
const USER_MESSAGE_COLLAPSE_LENGTH = 1400
const USER_MESSAGE_COLLAPSE_MIN_BREAK = 980
const TRANSCRIPT_RENDER_CHUNK = 40
const TRANSCRIPT_LAZY_LOAD_TOP_THRESHOLD = 360
const TRANSCRIPT_VIRTUAL_OVERSCAN = 900
const TRANSCRIPT_VIRTUAL_ROW_GAP = 14

export default function ChatView({ session }: Props): JSX.Element {
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
  const [renderLimit, setRenderLimit] = useState(() => Math.min(session.messages.length, TRANSCRIPT_RENDER_CHUNK))
  const [scrollMetrics, setScrollMetrics] = useState({ top: 0, height: 0, listOffsetTop: 0 })
  const [rowMeasurementVersion, setRowMeasurementVersion] = useState(0)
  const visibleMessages = useMemo(() => {
    if (session.messages.length <= renderLimit) return session.messages
    return session.messages.slice(-renderLimit)
  }, [renderLimit, session.messages])
  const totalMessageCount = session.messageCount ?? session.messages.length
  const hiddenMessageCount = Math.max(0, totalMessageCount - visibleMessages.length)
  const transcriptItems = useMemo(() => groupTranscriptMessages(visibleMessages), [visibleMessages])
  const fileReferenceRoots = useMemo(() => sessionFileReferenceRoots(session), [session])
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
    if (!shouldFollowBottomRef.current) return
    scrollToBottom()
  }, [session.messages.length, lastTextLength, scrollToBottom])

  useEffect(() => {
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
    const frame = window.requestAnimationFrame(() => {
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
    })
    return () => window.cancelAnimationFrame(frame)
  }, [session.id, visibleMessages.length])

  useEffect(() => {
    const openSearch = (): void => setSearchOpen(true)
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openSearch()
        return
      }
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
    if (!searchOpen) return
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen])

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
    useSessionStore.getState().mergeTranscriptPage(session.id, page, 'replace')
    setRenderLimit(page.messages.length)
    recordRendererMetric('transcript.search.jump-ready', startedAt, {
      sessionId: session.id,
      messageIndex: result.messageIndex,
      messages: page.messages.length
    })
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-message-id="${CSS.escape(result.messageId)}"]`)?.scrollIntoView({ block: 'center' })
    })
  }, [session.id])

  // New threads keep the canvas quiet; the composer owns the prompt.
  if (session.messages.length === 0 && session.status !== 'running') {
    return (
      <div
        data-testid="chat-empty-state"
        aria-label="New chat ready"
        className="chat-empty-state flex-1"
        style={{ background: 'var(--canvas-bg)' }}
      />
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
              loading={loadingEarlier}
              onLoad={() => { void handleLoadEarlier('manual') }}
              onLoadAll={handleLoadAllLoaded}
            />
          )}
          {unloadedBeforeCount > 0 && session.messages.length < Math.min(totalMessageCount, TRANSCRIPT_RENDER_CHUNK) && (
            <TranscriptLoadingState />
          )}
          <TranscriptSearch
            open={searchOpen}
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
            }}
          />
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
                    ? <ToolActivitySummary messages={item.messages} />
                    : (
                      <MessageRow
                        msg={item.message}
                        session={session}
                        fileReferenceRoots={fileReferenceRoots}
                        preferredEditor={preferredEditor}
                        canCopy={item.message.id === lastAssistantTextId}
                      />
                    )}
                </MeasuredTranscriptRow>
              ))}
            </div>
          </div>
          {session.status === 'running' && <ThinkingIndicator />}
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

function LoadEarlierMessages({
  hiddenCount,
  loading,
  onLoad,
  onLoadAll
}: {
  hiddenCount: number
  loading: boolean
  onLoad: () => void
  onLoadAll: () => void
}): JSX.Element {
  return (
    <div className="flex justify-center">
      <SurfaceRow
        dataTestId="load-earlier-messages"
        className="items-center gap-2 rounded-full px-3 py-1.5 text-xs"
        style={{
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)'
        }}
      >
        <span>Earlier messages</span>
        <Button variant="ghost" className="px-2 py-0.5" onClick={onLoad} disabled={loading}>
          {loading ? 'Loading' : `Show ${hiddenCount.toLocaleString()}`}
        </Button>
        <Button variant="ghost" className="px-2 py-0.5" onClick={onLoadAll}>Show loaded</Button>
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
        <label className="sr-only" htmlFor="transcript-search">Search transcript</label>
        <input
          id="transcript-search"
          data-testid="transcript-search"
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search transcript"
          className="w-full rounded-md py-1 pl-2 pr-7 text-xs outline-none"
          style={{
            background: 'var(--control-bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        />
        <button
          type="button"
          aria-label="Close transcript search"
          onClick={onClose}
          className="absolute right-3 top-2.5 grid h-5 w-5 place-items-center rounded"
          style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
        >
          <Icon name="close" size={12} />
        </button>
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

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }, [getText])

  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? 'Copied' : 'Copy'}
      size="sm"
      tone={copied ? 'success' : 'neutral'}
      onClick={handleCopy}
      style={{
        opacity: copied ? 1 : 0.55
      }}
    />
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
  canCopy
}: {
  msg: ChatMessage
  session: Session
  fileReferenceRoots: string[]
  preferredEditor: PreferredEditor
  canCopy: boolean
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
            className={`min-w-0 break-words ${isUser ? 'px-4 py-3 pr-9' : 'pr-8 py-1'}`}
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
              <div className="mt-2 flex items-center justify-end gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.82)' }}
                >
                  {queueState === 'steer_next' ? 'Steering next' : 'Queued'}
                </span>
                {queueState === 'queued' && (
                  <button
                    type="button"
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--color-accent)' }}
                    title="Send after the current tool call completes"
                    onClick={() => window.api.sessions.steerQueuedMessage(session.id, msg.id)}
                  >
                    Steer
                  </button>
                )}
              </div>
            )}
          </div>
          {canCopy && (
            <div
              style={{
                position: 'absolute',
                top: 2,
                right: 0
              }}
            >
              <CopyButton getText={() => content} />
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
      return <StatusCard content={msg.content} />
    }
    if (msg.subtype === 'success') return null
    return (
      <div className="flex justify-center">
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{ background: '#2d1a1a', color: 'var(--color-red)' }}
        >
          ✗ Error{msg.content ? ` — ${msg.content.slice(0, 80)}` : ''}
        </span>
      </div>
    )
  }

  return null
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

function StatusCard({ content }: { content: string }): JSX.Element {
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
        <FileReferenceCard key={file.path} file={file} cwd={cwd} searchRoots={searchRoots} preferredEditor={preferredEditor} />
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
    const result = await window.api.fs.openPath(displayPath)
    if (result) setError(result)
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
          <div className="font-medium truncate">{displayLabel}</div>
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

function ToolActivitySummary({ messages }: { messages: Array<ToolUseMessage | ToolResultMessage> }): JSX.Element {
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
  const [submitted, setSubmitted] = useState(false)
  const questions = msg.userInputQuestions?.length ? msg.userInputQuestions : [{ question: msg.content }]
  const requestIsActive = sessionStatus === 'waiting_for_user'
  const isAnswered = submitted || !requestIsActive

  const submitAnswer = async (value: string): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSubmitted(true)
    await window.api.sessions.answerUserInput(sessionId, trimmed)
  }

  return (
    <div className="flex justify-center my-1">
      <SurfaceRow
        className="rounded-xl px-4 py-3 w-full"
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
              disabled={isAnswered}
              onAnswer={submitAnswer}
            />
          ))}
        </div>
        {!isAnswered && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void submitAnswer(answer)
            }}
          >
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Type an answer..."
              className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
            />
            <Button
              type="submit"
              disabled={!answer.trim()}
              variant="primary"
              className="px-4 py-2"
            >
              Send
            </Button>
          </form>
        )}
        {isAnswered && (
          <div className="mt-2 text-xs" style={{ color: 'var(--color-green)' }}>
            {submitted ? 'Answer sent - resuming...' : 'Answered'}
          </div>
        )}
      </SurfaceRow>
    </div>
  )
}

function QuestionBlock({
  question,
  disabled,
  onAnswer
}: {
  question: UserInputQuestion
  disabled: boolean
  onAnswer: (answer: string) => Promise<void>
}): JSX.Element {
  return (
    <div>
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
            <SurfaceRow
              as="button"
              key={option.label}
              disabled={disabled}
              className="rounded-lg px-3 py-2 text-left disabled:opacity-50"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
              onClick={() => { if (!disabled) void onAnswer(option.label) }}
            >
              <div className="text-sm">{option.label}</div>
              {option.description && (
                <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {option.description}
                </div>
              )}
            </SurfaceRow>
          ))}
        </div>
      )}
    </div>
  )
}

function PermissionCard({ msg, sessionId, sessionStatus }: { msg: ResultMessage; sessionId: string; sessionStatus: Session['status'] }): JSX.Element {
  const [decision, setDecision] = useState<'pending' | 'allowed_once' | 'allowed_session' | 'denied'>('pending')
  const denials = msg.permissionDenials ?? []
  const toolNames = [...new Set(denials.map((d) => d.tool_name))]
  const isPlanApproval = denials.some((d) => d.tool_name === 'ExitPlanMode')
  const requestIsActive = sessionStatus === 'waiting_for_permission'
  const displayDecision = msg.permissionDecision ?? decision

  const handleAllowOnce = async (): Promise<void> => {
    setDecision('allowed_once')
    if (isPlanApproval) {
      await window.api.sessions.grantAndResume(sessionId, toolNames)
    } else {
      await window.api.sessions.allowOnceAndResume(sessionId, toolNames)
    }
  }

  const handleAllowSession = async (): Promise<void> => {
    setDecision('allowed_session')
    await window.api.sessions.grantAndResume(sessionId, toolNames)
  }

  const handleDeny = async (): Promise<void> => {
    setDecision('denied')
    if (isPlanApproval) {
      await window.api.sessions.answerUserInput(sessionId, 'Keep planning. Do not exit plan mode yet.')
    } else {
      await window.api.sessions.denyPermission(sessionId)
    }
  }

  return (
    <div className="flex justify-center my-1">
      <SurfaceRow
        className="rounded-xl px-4 py-3 w-full"
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
        <div className="mb-3 space-y-1">
          {denials.map((d, i) => (
            <div
              key={i}
              className="text-xs font-mono"
              style={{
                color: 'var(--color-text-muted)',
                lineHeight: 1.45,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal'
              }}
            >
              {permissionSummary(d)}
            </div>
          ))}
        </div>
        {decision === 'pending' && requestIsActive ? (
          isPlanApproval ? (
            <div className="flex gap-2">
              <Button
                onClick={handleAllowOnce}
                variant="primary"
                className="flex-1"
              >
                Approve Plan
              </Button>
              <Button
                onClick={handleDeny}
                variant="secondary"
                className="px-4"
              >
                Keep Planning
              </Button>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}>
              <Button
                onClick={handleAllowOnce}
                variant="primary"
              >
                Allow Once
              </Button>
              <Button
                onClick={handleAllowSession}
                variant="secondary"
              >
                Allow Session
              </Button>
              <Button
                onClick={handleDeny}
                variant="secondary"
                className="px-4"
              >
                Deny
              </Button>
            </div>
          )
        ) : (
          <div className="text-xs font-medium" style={{ color: permissionDecisionColor(displayDecision) }}>
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
      </SurfaceRow>
    </div>
  )
}

function permissionDecisionColor(decision: ResultMessage['permissionDecision'] | 'pending'): string {
  if (decision === 'allowed_once' || decision === 'allowed_session') return 'var(--color-green)'
  if (decision === 'denied') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}

function ThinkingIndicator(): JSX.Element {
  return (
    <ThinkingDots />
  )
}
