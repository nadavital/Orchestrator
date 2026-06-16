import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { useProjectStore } from './store/projects'
import { hasComposerDraft, sideChatIdFromTabId, terminalTabIdFromTabId, useSessionStore } from './store/sessions'
import type { SettingsSection } from './store/sessions'
import type { ProviderModelDef } from './types'
import Sidebar from './components/Sidebar/Sidebar'
import SessionPane from './components/Session/SessionPane'
import SettingsPage from './components/SettingsModal'
import AutomationsSettingsPage from './components/Settings/AutomationsSettingsPage'
import CapabilitiesPage from './components/CapabilitiesPage'
import DesignSystemPreview from './components/DesignSystemPreview'
import CommandPalette, { type CommandPaletteAction } from './components/CommandPalette'
import RenameChatDialog from './components/shared/RenameChatDialog'
import { MotionView, exitFullscreenForPanelTab } from './components/shared/designSystem'
import EmptyState from './components/shared/EmptyState'
import Icon from './components/shared/Icon'
import { applyAppearance, type Appearance } from './theme'
import { markRendererStart, recordRendererMetric } from './performance'
import { APP_COMMANDS, appMenuCommandForKeyboardEvent, commandShortcuts, formatShortcutSequence } from '../../types/appCommands'
import type { AppCommandAvailability, AppMenuCommand, ShortcutOverrides, StableAppCommand } from '../../types/appCommands'
import { browserManagerPatchFromEvents, parseSessionRouteLocation, parseSettingsRouteLocation, resolvePanelBrowserCommandTarget, resolvePanelCloseTarget, resolvePanelFindTarget, resolvePanelNewTabTarget, sessionRouteUrlForLocation, settingsRouteExitUrl, settingsRouteUrlForLocation } from '../../types'
import type { ChatMessage, PanelFindTarget, ReviewMetadata, SessionListItem, SessionRunEventRecord } from '../../types'
import type { PanelCloseFocusArea } from '../../types'

type ShellFocusArea = PanelCloseFocusArea
type ThreadFindDomain = 'conversation' | 'diff'
const STREAMING_MESSAGE_RENDER_INTERVAL_MS = 80
const EMPTY_SESSION_LIST: SessionListItem[] = []
type ThreadFindStatus = {
  totalMatches: number
  activeMatch: number
  isCapped: boolean
  activePath?: string | null
}
type SessionRouteNotice = {
  kind: 'resolving' | 'archived' | 'missing'
  sessionId: string
  name: string | null
  restoring?: boolean
  error?: string | null
}
type BrowserPanelCommand =
  | 'open-browser-tab'
  | 'focus-browser-address-bar'
  | 'browser-reload-page'
  | 'browser-hard-reload-page'
  | 'browser-navigate-back'
  | 'browser-navigate-forward'

const BROWSER_PANEL_COMMANDS: BrowserPanelCommand[] = [
  'focus-browser-address-bar',
  'browser-reload-page',
  'browser-hard-reload-page',
  'browser-navigate-back',
  'browser-navigate-forward'
]

const LEFT_SIDEBAR_COLLAPSED_KEY = 'orchestrator.leftSidebar.collapsed'

function settingsRouteUrl(section: SettingsSection, hostId?: string | null): string {
  return settingsRouteUrlForLocation(section, hostId, window.location)
}

function sessionRouteUrl(sessionId: string): string {
  return sessionRouteUrlForLocation(sessionId, window.location)
}

function currentUrlMatches(targetUrl: string): boolean {
  if (targetUrl.startsWith('#')) return window.location.hash === targetUrl
  return `${window.location.pathname}${window.location.search}` === targetUrl && window.location.hash === ''
}

function replaceRouteUrl(url: string): void {
  if (currentUrlMatches(url)) return
  window.history.replaceState(window.history.state, '', url)
}

function pushRouteUrl(url: string): void {
  if (currentUrlMatches(url)) return
  window.history.pushState(window.history.state, '', url)
}

function newestSessionExcluding(sessions: SessionListItem[], excludedId: string): SessionListItem | undefined {
  return sessions
    .filter((session) => session.id !== excludedId)
    .sort((a, b) => (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt))[0]
}

async function sessionRouteNoticeForMissingId(sessionId: string): Promise<SessionRouteNotice> {
  const stored = await window.api.sessions.get(sessionId)
  if (stored?.archivedAt) {
    return {
      kind: 'archived',
      sessionId,
      name: stored.name ?? null
    }
  }
  return {
    kind: 'missing',
    sessionId,
    name: stored?.name ?? null
  }
}

async function inspectSessionRoute(sessionId: string): Promise<SessionRouteNotice> {
  const globals = window as typeof window & {
    __orchestratorDelaySessionRouteInspectionForSmoke?: (sessionId: string) => Promise<void> | void
  }
  await globals.__orchestratorDelaySessionRouteInspectionForSmoke?.(sessionId)
  return sessionRouteNoticeForMissingId(sessionId)
}

function applyBrowserManagerRunEvents(sessionId: string, records: SessionRunEventRecord[]): void {
  const patch = browserManagerPatchFromEvents(records.map((record) => record.event))
  if (!patch) return

  const { shouldOpenBrowser, ...browserWorkbenchPatch } = patch
  const store = useSessionStore.getState()
  if (shouldOpenBrowser) store.openRightPanelTab(sessionId, 'browser')

  if (Object.keys(browserWorkbenchPatch).length > 0) {
    store.setRightPanelBrowserWorkbench(sessionId, browserWorkbenchPatch)
  }
}

export default function App(): JSX.Element {
  const isDesignSystemPreview = window.location.hash === '#design-system'
  const setProjects = useProjectStore((state) => state.setProjects)
  const addSessionToProject = useProjectStore((state) => state.addSessionToProject)
  const removeSessionFromProject = useProjectStore((state) => state.removeSessionFromProject)
  const sessionCount = useSessionStore((state) => state.sessions.length)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const activeMenuUi = useSessionStore(useShallow((state) => {
    const id = state.activeSessionId
    const ui = id ? state.uiState[id] : undefined
    return {
      rightPanelOpen: ui?.rightPanel?.open ?? false,
      rightPanelActiveTabId: ui?.rightPanel?.activeTabId ?? null,
      showTerminal: ui?.showTerminal ?? false,
      bottomPanelActiveTabId: ui?.terminalPanel?.activeTabId ?? null,
      bottomPanelTabCount: ui?.terminalPanel?.tabs.length ?? 0
    }
  }))
  const activeSessionName = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessions.find((session) => session.id === id)?.name ?? null : null
  })
  const activeSessionPinned = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessions.find((session) => session.id === id)?.pinned ?? false : false
  })
  const setSessions = useSessionStore((state) => state.setSessions)
  const addSession = useSessionStore((state) => state.addSession)
  const mergeTranscriptPage = useSessionStore((state) => state.mergeTranscriptPage)
  const updateStatus = useSessionStore((state) => state.updateStatus)
  const updateName = useSessionStore((state) => state.updateName)
  const updatePinned = useSessionStore((state) => state.updatePinned)
  const updateSession = useSessionStore((state) => state.updateSession)
  const updateSettings = useSessionStore((state) => state.updateSettings)
  const appendMessages = useSessionStore((state) => state.appendMessages)
  const upsertMessage = useSessionStore((state) => state.upsertMessage)
  const upsertStreamingMessage = useSessionStore((state) => state.upsertStreamingMessage)
  const removeMessage = useSessionStore((state) => state.removeMessage)
  const appendEvents = useSessionStore((state) => state.appendEvents)
  const appendRaw = useSessionStore((state) => state.appendRaw)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setHasUnread = useSessionStore((state) => state.setHasUnread)
  const setProviderAvailability = useSessionStore((state) => state.setProviderAvailability)
  const setProviderModels = useSessionStore((state) => state.setProviderModels)
  const mergeProviderModelCatalog = useSessionStore((state) => state.mergeProviderModelCatalog)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setSettingsSection = useSessionStore((state) => state.setSettingsSection)
  const setSettingsHostId = useSessionStore((state) => state.setSettingsHostId)
  const showSettings = useSessionStore((state) => state.showSettings)
  const showCapabilities = useSessionStore((state) => state.showCapabilities)
  const settingsSection = useSessionStore((state) => state.settingsSection)
  const settingsHostId = useSessionStore((state) => state.settingsHostId)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [renamingActiveChat, setRenamingActiveChat] = useState(false)
  const [showAutomations, setShowAutomations] = useState(false)
  const automationSessions = useSessionStore(
    useCallback((state) => showAutomations ? state.sessions : EMPTY_SESSION_LIST, [showAutomations])
  )
  const [shellFocusArea, setShellFocusArea] = useState<ShellFocusArea>('main')
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>({})
  const [threadFindVisible, setThreadFindVisible] = useState(false)
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => (
    window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY) === 'true'
  ))
  const pendingStreamingMessageUpsertsRef = useRef(new Map<string, { sessionId: string; message: ChatMessage }>())
  const streamingMessageTimerRef = useRef<number | null>(null)

  const flushStreamingMessageUpserts = useCallback((): void => {
    streamingMessageTimerRef.current = null
    const pending = [...pendingStreamingMessageUpsertsRef.current.values()]
    pendingStreamingMessageUpsertsRef.current.clear()
    startTransition(() => {
      for (const item of pending) {
        upsertStreamingMessage(item.sessionId, item.message)
      }
    })
  }, [upsertStreamingMessage])

  const scheduleMessageUpsert = useCallback((sessionId: string, message: ChatMessage): void => {
    const pendingKey = `${sessionId}:${message.id}`
    if (message.type === 'text' && message.role === 'assistant' && message.isStreaming === true) {
      pendingStreamingMessageUpsertsRef.current.set(pendingKey, { sessionId, message })
      if (streamingMessageTimerRef.current === null) {
        streamingMessageTimerRef.current = window.setTimeout(flushStreamingMessageUpserts, STREAMING_MESSAGE_RENDER_INTERVAL_MS)
      }
      return
    }
    pendingStreamingMessageUpsertsRef.current.delete(pendingKey)
    upsertMessage(sessionId, message)
  }, [flushStreamingMessageUpserts, upsertMessage])

  useEffect(() => {
    return () => {
      if (streamingMessageTimerRef.current !== null) {
        window.clearTimeout(streamingMessageTimerRef.current)
        streamingMessageTimerRef.current = null
      }
      pendingStreamingMessageUpsertsRef.current.clear()
    }
  }, [])
  const [threadFindDomain, setThreadFindDomain] = useState<ThreadFindDomain>('conversation')
  const [threadFindQuery, setThreadFindQuery] = useState('')
  const [threadFindStatus, setThreadFindStatus] = useState<Record<ThreadFindDomain, ThreadFindStatus>>({
    conversation: { totalMatches: 0, activeMatch: 0, isCapped: false },
    diff: { totalMatches: 0, activeMatch: 0, isCapped: false }
  })
  const [sessionRouteNotice, setSessionRouteNotice] = useState<SessionRouteNotice | null>(null)
  const waitingNotificationKeysRef = useRef(new Set<string>())
  const shellFocusAreaRef = useRef<ShellFocusArea>('main')
  const sessionRouteNoticeRequestRef = useRef(0)

  const threadFindInputRef = useRef<HTMLInputElement | null>(null)
  const threadFindReturnFocusRef = useRef<HTMLElement | null>(null)
  const deferredActiveSessionId = useDeferredValue(activeSessionId)

  const recoverMissingSessionRoute = useCallback((missingSessionId: string): boolean => {
    const state = useSessionStore.getState()
    const fallbackId = state.activeSessionId && state.sessions.some((session) => session.id === state.activeSessionId)
      ? state.activeSessionId
      : [...state.sessions].sort((a, b) => (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt))[0]?.id
    if (!fallbackId) return false
    sessionRouteNoticeRequestRef.current += 1
    setSessionRouteNotice(null)
    setShowAutomations(false)
    state.setShowSettings(false)
    state.setShowCapabilities(false)
    state.setActiveSession(fallbackId)
    replaceRouteUrl(sessionRouteUrl(fallbackId))
    if (process.env.NODE_ENV !== 'production') {
      const globals = window as typeof window & { __orchestratorRecoveredMissingSessionRouteForSmoke?: string }
      globals.__orchestratorRecoveredMissingSessionRouteForSmoke = missingSessionId
    }
    return true
  }, [])

  useEffect(() => {
    window.localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, leftSidebarCollapsed ? 'true' : 'false')
  }, [leftSidebarCollapsed])

  useEffect(() => {
    const globals = window as typeof window & { __orchestratorAppCommitCount?: number }
    if (typeof globals.__orchestratorAppCommitCount === 'number') {
      globals.__orchestratorAppCommitCount += 1
    }
  })

  useEffect(() => {
    const applyRoute = (): void => {
      const route = parseSettingsRouteLocation(window.location)
      if (!route) {
        if (window.location.hash !== '#design-system') setShowSettings(false)
        return
      }
      if (route.section === 'automations') {
        setShowSettings(false)
        setShowCapabilities(false)
        setShowAutomations(true)
        return
      }
      setSettingsSection(route.section as SettingsSection)
      if (route.hostId) setSettingsHostId(route.hostId)
      setShowCapabilities(false)
      setShowSettings(true)
    }
    applyRoute()
    window.addEventListener('hashchange', applyRoute)
    window.addEventListener('popstate', applyRoute)
    return () => {
      window.removeEventListener('hashchange', applyRoute)
      window.removeEventListener('popstate', applyRoute)
    }
  }, [setSettingsHostId, setSettingsSection, setShowCapabilities, setShowSettings])

  useEffect(() => {
    if (window.location.hash === '#design-system') return
    if (showSettings) {
      setShowAutomations(false)
      replaceRouteUrl(settingsRouteUrl(settingsSection, settingsHostId))
      return
    }
    const route = parseSettingsRouteLocation(window.location)
    if (route) {
      replaceRouteUrl(settingsRouteExitUrl(route.mode))
    }
  }, [settingsHostId, settingsSection, showSettings])

  useEffect(() => {
    if (window.location.hash === '#design-system') return
    if (showSettings || showCapabilities || showAutomations || sessionRouteNotice || !activeSessionId) return
    replaceRouteUrl(sessionRouteUrl(activeSessionId))
  }, [activeSessionId, sessionRouteNotice, showAutomations, showCapabilities, showSettings])

  useEffect(() => {
    const inspectMissingSessionRoute = (sessionId: string): void => {
      const requestId = sessionRouteNoticeRequestRef.current + 1
      sessionRouteNoticeRequestRef.current = requestId
      setShowSettings(false)
      setShowCapabilities(false)
      setShowAutomations(false)
      setSessionRouteNotice({
        kind: 'resolving',
        sessionId,
        name: null
      })
      void inspectSessionRoute(sessionId)
        .then((notice) => {
          if (sessionRouteNoticeRequestRef.current !== requestId) return
          const currentRoute = parseSessionRouteLocation(window.location)
          if (currentRoute?.sessionId !== sessionId) return
          const state = useSessionStore.getState()
          if (state.sessions.some((session) => session.id === sessionId)) {
            setSessionRouteNotice(null)
            return
          }
          if (notice.kind === 'missing' && recoverMissingSessionRoute(sessionId)) return
          setSessionRouteNotice(notice)
        })
        .catch(() => {
          if (sessionRouteNoticeRequestRef.current !== requestId) return
          const currentRoute = parseSessionRouteLocation(window.location)
          if (currentRoute?.sessionId !== sessionId) return
          setSessionRouteNotice({ kind: 'missing', sessionId, name: null, error: 'Could not inspect this chat route.' })
        })
    }

    const applyRoute = (): void => {
      if (window.location.hash === '#design-system') return
      const route = parseSessionRouteLocation(window.location)
      if (!route) return
      const state = useSessionStore.getState()
      if (!state.sessions.some((session) => session.id === route.sessionId)) {
        inspectMissingSessionRoute(route.sessionId)
        return
      }
      if (state.activeSessionId === route.sessionId && !state.showSettings && !state.showCapabilities) {
        sessionRouteNoticeRequestRef.current += 1
        setSessionRouteNotice(null)
        return
      }
      sessionRouteNoticeRequestRef.current += 1
      setSessionRouteNotice(null)
      setShowSettings(false)
      setShowCapabilities(false)
      setActiveSession(route.sessionId)
    }
    applyRoute()
    window.addEventListener('hashchange', applyRoute)
    window.addEventListener('popstate', applyRoute)
    return () => {
      window.removeEventListener('hashchange', applyRoute)
      window.removeEventListener('popstate', applyRoute)
    }
  }, [recoverMissingSessionRoute, sessionCount, setActiveSession, setHasUnread, setShowCapabilities, setShowSettings])

  useEffect(() => {
    const globals = window as typeof window & {
      __orchestratorAppendSessionEventsForSmoke?: (sessionId: string, events: SessionRunEventRecord[]) => boolean
      __orchestratorAppendSessionRawForSmoke?: (sessionId: string, data: string) => boolean
      __orchestratorAppendSessionMessagesForSmoke?: (sessionId: string, messages: ChatMessage[]) => boolean
      __orchestratorSetSessionReviewMetadataForSmoke?: (sessionId: string, reviewMetadata: ReviewMetadata | null) => boolean
      __orchestratorSetActiveSessionForSmoke?: (sessionId: string) => boolean
      __orchestratorSetSessionUnreadForSmoke?: (sessionId: string, unread: boolean) => boolean
    }
    globals.__orchestratorAppendSessionEventsForSmoke = (sessionId, events) => {
      appendEvents(sessionId, events)
      applyBrowserManagerRunEvents(sessionId, events)
      return true
    }
    globals.__orchestratorAppendSessionRawForSmoke = (sessionId, data) => {
      appendRaw(sessionId, data)
      return true
    }
    globals.__orchestratorAppendSessionMessagesForSmoke = (sessionId, messages) => {
      appendMessages(sessionId, messages)
      return true
    }
    globals.__orchestratorSetSessionReviewMetadataForSmoke = (sessionId, reviewMetadata) => {
      const state = useSessionStore.getState()
      const targetSessionId = sessionId === 'active' ? state.activeSessionId : sessionId
      if (!targetSessionId || !state.sessions.some((session) => session.id === targetSessionId)) return false
      updateSession(targetSessionId, { reviewMetadata: reviewMetadata ?? undefined })
      return true
    }
    globals.__orchestratorSetActiveSessionForSmoke = (sessionId) => {
      const state = useSessionStore.getState()
      if (!state.sessions.some((session) => session.id === sessionId)) return false
      state.setShowSettings(false)
      state.setShowCapabilities(false)
      state.setActiveSession(sessionId)
      return true
    }
    globals.__orchestratorSetSessionUnreadForSmoke = (sessionId, unread) => {
      const state = useSessionStore.getState()
      if (!state.sessions.some((session) => session.id === sessionId)) return false
      state.setHasUnread(sessionId, unread)
      return true
    }
    return () => {
      delete globals.__orchestratorAppendSessionEventsForSmoke
      delete globals.__orchestratorAppendSessionRawForSmoke
      delete globals.__orchestratorAppendSessionMessagesForSmoke
      delete globals.__orchestratorSetSessionReviewMetadataForSmoke
      delete globals.__orchestratorSetActiveSessionForSmoke
      delete globals.__orchestratorSetSessionUnreadForSmoke
    }
  }, [appendEvents, appendMessages, appendRaw, updateSession])

  const createNewChat = useCallback(async (): Promise<void> => {
    const sessionState = useSessionStore.getState()
    const projectState = useProjectStore.getState()
    const active = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId)
    let targetProject = active
      ? projectState.projects.find((project) => project.id === active.projectId)
      : projectState.projects.at(-1)
    if (!targetProject) {
      const dir = await window.api.dialog.openDirectory()
      if (!dir) return
      const name = dir.split('/').pop() ?? dir
      targetProject = await window.api.projects.add(name, dir)
      projectState.addProject(targetProject)
    }
    const projectStat = await window.api.fs.statPath(targetProject.rootPath)
    if (!projectStat.exists || !projectStat.isDirectory) {
      projectState.removeProject(targetProject.id)
      await window.api.projects.remove(targetProject.id)
      for (const staleSession of sessionState.sessions.filter((session) => session.projectId === targetProject.id)) {
        await window.api.sessions.remove(staleSession.id)
        await window.api.projects.removeSession(targetProject.id, staleSession.id)
        sessionState.removeSession(staleSession.id)
        projectState.removeSessionFromProject(targetProject.id, staleSession.id)
      }
      return createNewChat()
    }

    if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running' && !hasComposerDraft(sessionState.uiState[active.id])) {
      await window.api.sessions.remove(active.id)
      await window.api.projects.removeSession(active.projectId, active.id)
      sessionState.removeSession(active.id)
      projectState.removeSessionFromProject(active.projectId, active.id)
    }

    const session = await window.api.sessions.create({
      projectId: targetProject.id,
      workDir: targetProject.rootPath,
      useWorktree: false,
      repoRoot: targetProject.rootPath
    })
    await window.api.projects.addSession(targetProject.id, session.id)
    sessionState.addSession(session)
    projectState.addSessionToProject(targetProject.id, session.id)
    sessionState.setActiveSession(session.id)
    sessionState.setShowCapabilities(false)
    sessionState.setShowSettings(false)
    setShowAutomations(false)
    setSessionRouteNotice(null)
    replaceRouteUrl(sessionRouteUrl(session.id))
  }, [])

  const switchChat = useCallback((direction: 1 | -1): void => {
    const { sessions, activeSessionId, setActiveSession, setShowCapabilities, setShowSettings } = useSessionStore.getState()
    if (sessions.length < 2) return
    const ordered = [...sessions].sort((a, b) => (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt))
    const currentIndex = Math.max(0, ordered.findIndex((session) => session.id === activeSessionId))
    const nextIndex = (currentIndex + direction + ordered.length) % ordered.length
    setActiveSession(ordered[nextIndex].id)
    setShowCapabilities(false)
    setShowSettings(false)
  }, [])

  const toggleInspector = useCallback((): void => {
    const {
      activeSessionId,
      uiState,
      setShowDiff,
      setShowPlan,
      setShowEvents,
      setShowExtensions,
      setShowSideQuestions
    } = useSessionStore.getState()
    if (!activeSessionId) return
    const ui = uiState[activeSessionId]
    const open = Boolean(ui?.showDiff || ui?.showPlan || ui?.showEvents || ui?.showExtensions || ui?.showSideQuestions)
    if (open) {
      setShowDiff(activeSessionId, false)
      setShowPlan(activeSessionId, false)
      setShowEvents(activeSessionId, false)
      setShowExtensions(activeSessionId, false)
      setShowSideQuestions(activeSessionId, false)
    } else {
      setShowDiff(activeSessionId, true)
    }
  }, [])

  const openBrowserPanelTab = useCallback((): void => {
    const { activeSessionId, openRightPanelTab, setShowCapabilities, setShowSettings } = useSessionStore.getState()
    if (!activeSessionId) return
    openRightPanelTab(activeSessionId, 'browser')
    setShowCapabilities(false)
    setShowSettings(false)
  }, [])

  const toggleBrowserPanel = useCallback((): void => {
    const { activeSessionId, uiState, closeRightPanelTab } = useSessionStore.getState()
    if (!activeSessionId) return
    const rightPanel = uiState[activeSessionId]?.rightPanel
    if (rightPanel?.open && rightPanel.activeTabId === 'browser') {
      closeRightPanelTab(activeSessionId, 'browser')
      return
    }
    openBrowserPanelTab()
  }, [openBrowserPanelTab])

  const openReviewPanelTab = useCallback((): void => {
    const { activeSessionId, setShowCapabilities, setShowDiff, setShowSettings } = useSessionStore.getState()
    if (!activeSessionId) return
    setShowDiff(activeSessionId, true)
    setShowCapabilities(false)
    setShowSettings(false)
  }, [])

  const toggleTerminal = useCallback((): void => {
    const { activeSessionId, uiState, setShowTerminal } = useSessionStore.getState()
    if (!activeSessionId) return
    setShowTerminal(activeSessionId, !(uiState[activeSessionId]?.showTerminal ?? false))
  }, [])

  const togglePet = useCallback(async (): Promise<void> => {
    const config = await window.api.pet.getConfig() as { isOpen?: boolean }
    await window.api.pet.setOpen(!(config.isOpen ?? true))
  }, [])

  const openTranscriptSearch = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('orchestrator:open-transcript-search'))
  }, [])

  const openBrowserFind = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('orchestrator:focus-browser-find'))
  }, [])

  const openThreadFind = useCallback((domain: ThreadFindDomain): void => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && !activeElement.closest('[data-testid="thread-find-bar"]')) {
      threadFindReturnFocusRef.current = activeElement
    }
    setThreadFindDomain(domain)
    setThreadFindVisible(true)
    window.requestAnimationFrame(() => {
      threadFindInputRef.current?.focus({ preventScroll: true })
      threadFindInputRef.current?.select()
    })
  }, [])

  const closeThreadFind = useCallback((): void => {
    const returnFocusTarget = threadFindReturnFocusRef.current
    threadFindReturnFocusRef.current = null
    setThreadFindVisible(false)
    setThreadFindQuery('')
    window.dispatchEvent(new CustomEvent('orchestrator:thread-find-close', {
      detail: { sessionId: useSessionStore.getState().activeSessionId }
    }))
    window.requestAnimationFrame(() => {
      if (returnFocusTarget && document.contains(returnFocusTarget)) {
        returnFocusTarget.focus({ preventScroll: true })
      }
    })
  }, [])

  const openFileSearch = useCallback((): void => {
    const { activeSessionId, openRightPanelTab, setShowCapabilities, setShowSettings } = useSessionStore.getState()
    if (!activeSessionId) return
    openRightPanelTab(activeSessionId, 'files')
    setShowCapabilities(false)
    setShowSettings(false)
    window.setTimeout(() => {
      window.dispatchEvent(new Event('orchestrator:focus-workspace-file-search'))
    }, 0)
  }, [])

  const resolveCurrentPanelFindTarget = useCallback((): PanelFindTarget | null => {
    const { activeSessionId, uiState } = useSessionStore.getState()
    if (!activeSessionId) return null
    const ui = uiState[activeSessionId]
    return resolvePanelFindTarget(shellFocusAreaRef.current, {
      rightPanelOpen: Boolean(ui?.rightPanel?.open),
      rightPanelActiveTabId: ui?.rightPanel?.activeTabId ?? null
    })
  }, [])

  const canRunPanelFind = useCallback((): boolean => resolveCurrentPanelFindTarget() !== null, [resolveCurrentPanelFindTarget])

  const canRunBrowserPanelCommand = useCallback((): boolean => {
    const { activeSessionId, uiState } = useSessionStore.getState()
    if (!activeSessionId) return false
    const ui = uiState[activeSessionId]
    return resolvePanelBrowserCommandTarget(shellFocusAreaRef.current, {
      rightPanelOpen: Boolean(ui?.rightPanel?.open),
      rightPanelActiveTabId: ui?.rightPanel?.activeTabId ?? null
    }) !== null
  }, [])

  const runBrowserPanelCommand = useCallback((command: BrowserPanelCommand): void => {
    if (!canRunBrowserPanelCommand()) return
    window.dispatchEvent(new CustomEvent('orchestrator:browser-panel-command', { detail: { command } }))
  }, [canRunBrowserPanelCommand])

  const currentMenuCommandAvailability = useCallback((): AppCommandAvailability => {
    const { activeSessionId, sessions, uiState } = useSessionStore.getState()
    const hasActiveSession = Boolean(activeSessionId)
    const sessionCount = sessions.length
    const activeUi = activeSessionId ? uiState[activeSessionId] : undefined
    const browserPanelCommandAvailable = hasActiveSession && resolvePanelBrowserCommandTarget(shellFocusAreaRef.current, {
      rightPanelOpen: Boolean(activeUi?.rightPanel?.open),
      rightPanelActiveTabId: activeUi?.rightPanel?.activeTabId ?? null
    }) !== null
    const panelFindAvailable = hasActiveSession && resolvePanelFindTarget(shellFocusAreaRef.current, {
      rightPanelOpen: Boolean(activeUi?.rightPanel?.open),
      rightPanelActiveTabId: activeUi?.rightPanel?.activeTabId ?? null
    }) !== null
    const closePanelAvailable = hasActiveSession && resolvePanelCloseTarget(shellFocusAreaRef.current, {
      rightPanelActiveTabId: activeUi?.rightPanel?.activeTabId ?? null,
      bottomPanelOpen: Boolean(activeUi?.showTerminal),
      bottomPanelActiveTabId: activeUi?.terminalPanel?.activeTabId ?? null,
      bottomPanelTabCount: activeUi?.terminalPanel?.tabs.length ?? 0
    }) !== null
    return {
      'rename-chat': hasActiveSession,
      'toggle-chat-pin': hasActiveSession,
      'previous-chat': sessionCount > 1,
      'next-chat': sessionCount > 1,
      'previous-recent-chat': sessionCount > 1,
      'next-recent-chat': sessionCount > 1,
      'open-file-search': hasActiveSession,
      'search-transcript': panelFindAvailable,
      'find-next': panelFindAvailable,
      'find-previous': panelFindAvailable,
      'toggle-inspector': hasActiveSession,
      'open-review-tab': hasActiveSession,
      'open-browser-tab': hasActiveSession,
      'toggle-browser-panel': hasActiveSession,
      'toggle-terminal': hasActiveSession,
      'close-active-panel-tab': closePanelAvailable,
      'focus-browser-address-bar': browserPanelCommandAvailable,
      'browser-reload-page': browserPanelCommandAvailable,
      'browser-hard-reload-page': browserPanelCommandAvailable,
      'browser-navigate-back': browserPanelCommandAvailable,
      'browser-navigate-forward': browserPanelCommandAvailable
    }
  }, [])

  const openPanelFindTarget = useCallback((): void => {
    const target = resolveCurrentPanelFindTarget()
    if (target === 'transcript') {
      openThreadFind('conversation')
      return
    }
    if (target === 'review-files') {
      openThreadFind('diff')
      return
    }
    if (target === 'workspace-files') {
      window.dispatchEvent(new Event('orchestrator:focus-workspace-file-search'))
      return
    }
    if (target === 'source-file') {
      openThreadFind('diff')
      return
    }
    if (target === 'browser-page') {
      openBrowserFind()
    }
  }, [openBrowserFind, openThreadFind, resolveCurrentPanelFindTarget])

  const stepPanelFindTarget = useCallback((direction: 1 | -1): void => {
    if (threadFindVisible && activeSessionId) {
      window.dispatchEvent(new CustomEvent('orchestrator:thread-find-step', {
        detail: { sessionId: activeSessionId, domain: threadFindDomain, direction }
      }))
      return
    }
    const target = resolveCurrentPanelFindTarget()
    if (target === 'browser-page') {
      window.dispatchEvent(new CustomEvent('orchestrator:browser-find-step', {
        detail: { direction }
      }))
      return
    }
    if (!activeSessionId) return
    if (target === 'transcript' || target === 'review-files' || target === 'source-file') {
      const domain: ThreadFindDomain = target === 'transcript' ? 'conversation' : 'diff'
      if (!threadFindVisible || threadFindDomain !== domain) {
        openThreadFind(domain)
        return
      }
      window.dispatchEvent(new CustomEvent('orchestrator:thread-find-step', {
        detail: { sessionId: activeSessionId, domain, direction }
      }))
      return
    }
    openPanelFindTarget()
  }, [activeSessionId, openPanelFindTarget, openThreadFind, resolveCurrentPanelFindTarget, threadFindDomain, threadFindVisible])

  const openBrowserTabCommand = useCallback((): void => {
    const { activeSessionId, uiState, addTerminalTab, moveTerminalTabToRight } = useSessionStore.getState()
    if (!activeSessionId) return
    const ui = uiState[activeSessionId]
    const target = resolvePanelNewTabTarget(shellFocusAreaRef.current, {
      rightPanelOpen: Boolean(ui?.rightPanel?.open),
      rightPanelActiveTabId: ui?.rightPanel?.activeTabId ?? null,
      bottomPanelOpen: Boolean(ui?.showTerminal),
      bottomPanelActiveTabId: ui?.terminalPanel?.activeTabId ?? null,
      bottomPanelTabCount: ui?.terminalPanel?.tabs.length ?? 0
    })
    if (target === 'browser') {
      runBrowserPanelCommand('open-browser-tab')
      return
    }
    if (target === 'right-terminal') {
      const newTabId = addTerminalTab(activeSessionId)
      moveTerminalTabToRight(activeSessionId, newTabId)
      return
    }
    if (target === 'bottom-terminal') {
      addTerminalTab(activeSessionId)
      return
    }
    openBrowserPanelTab()
  }, [openBrowserPanelTab, runBrowserPanelCommand])

  const openSettings = useCallback((section: SettingsSection = 'general'): void => {
    pushRouteUrl(settingsRouteUrl(section, useSessionStore.getState().settingsHostId))
    setSettingsSection(section)
    setShowCapabilities(false)
    setShowAutomations(false)
    setShowSettings(true)
  }, [setSettingsSection, setShowCapabilities, setShowSettings])

  const closeSettings = useCallback((): void => {
    setShowSettings(false)
    setShowAutomations(false)
    const focusComposer = (): boolean => {
      const composer = document.querySelector<HTMLTextAreaElement>('[data-testid="composer-textarea"]')
      if (!(composer instanceof HTMLTextAreaElement) || composer.disabled) return false
      composer.focus({ preventScroll: true })
      return document.activeElement === composer
    }
    window.requestAnimationFrame(() => {
      if (!focusComposer()) window.setTimeout(focusComposer, 0)
    })
  }, [setShowSettings])

  const returnToActiveChatFromRouteNotice = useCallback((): void => {
    sessionRouteNoticeRequestRef.current += 1
    setSessionRouteNotice(null)
    const currentActiveId = useSessionStore.getState().activeSessionId
    if (currentActiveId) replaceRouteUrl(sessionRouteUrl(currentActiveId))
  }, [])

  const restoreArchivedRouteSession = useCallback(async (): Promise<void> => {
    const notice = sessionRouteNotice
    if (!notice || notice.kind !== 'archived' || notice.restoring) return
    setSessionRouteNotice({ ...notice, restoring: true, error: null })
    try {
      const restored = await window.api.sessions.restoreArchived(notice.sessionId)
      if (!restored) {
        setSessionRouteNotice({
          kind: 'missing',
          sessionId: notice.sessionId,
          name: notice.name,
          error: 'This archived chat could not be restored.'
        })
        return
      }
      addSession(restored)
      addSessionToProject(restored.projectId, restored.id)
      sessionRouteNoticeRequestRef.current += 1
      setSessionRouteNotice(null)
      setShowSettings(false)
      setShowCapabilities(false)
      setShowAutomations(false)
      setActiveSession(restored.id)
      replaceRouteUrl(sessionRouteUrl(restored.id))
    } catch (error) {
      setSessionRouteNotice({
        ...notice,
        restoring: false,
        error: error instanceof Error ? error.message : 'Could not restore this archived chat.'
      })
    }
  }, [addSession, addSessionToProject, sessionRouteNotice, setActiveSession, setHasUnread, setShowCapabilities, setShowSettings])

  const handleSidebarNewChat = useCallback((): void => {
    void createNewChat()
  }, [createNewChat])

  const openSidebarSearch = useCallback((): void => {
    setCommandPaletteOpen(true)
  }, [])

  const openSidebarPlugins = useCallback((): void => {
    setShowSettings(false)
    setShowAutomations(false)
    setShowCapabilities(true)
  }, [setShowCapabilities, setShowSettings])

  const openSidebarAutomations = useCallback((): void => {
    setShowSettings(false)
    setShowCapabilities(false)
    setShowAutomations(true)
  }, [setShowCapabilities, setShowSettings])

  const closeSidebarAutomations = useCallback((): void => {
    setShowAutomations(false)
  }, [])

  const toggleLeftSidebar = useCallback((): void => {
    setLeftSidebarCollapsed((collapsed) => !collapsed)
  }, [])

  const canCloseActivePanelTab = useCallback((): boolean => {
    const { activeSessionId, uiState } = useSessionStore.getState()
    if (!activeSessionId) return false
    const ui = uiState[activeSessionId]
    const target = resolvePanelCloseTarget(shellFocusAreaRef.current, {
      rightPanelActiveTabId: ui?.rightPanel?.activeTabId ?? null,
      bottomPanelOpen: Boolean(ui?.showTerminal),
      bottomPanelActiveTabId: ui?.terminalPanel?.activeTabId ?? null,
      bottomPanelTabCount: ui?.terminalPanel?.tabs.length ?? 0
    })
    return target !== null
  }, [])

  const restoreTerminalToggleFocus = useCallback((): void => {
    const focusToggle = (): boolean => {
      const toggle = document.querySelector<HTMLButtonElement>('[data-testid="titlebar-toggle-terminal"]')
      if (!(toggle instanceof HTMLButtonElement)) return false
      toggle.focus({ preventScroll: true })
      return document.activeElement === toggle
    }
    window.requestAnimationFrame(() => {
      if (!focusToggle()) window.setTimeout(focusToggle, 0)
    })
  }, [])

  const restoreRightPanelToggleFocus = useCallback((): void => {
    const focusToggle = (): boolean => {
      const toggle = document.querySelector<HTMLButtonElement>('[data-testid="titlebar-toggle-sidebar"]')
      if (!(toggle instanceof HTMLButtonElement)) return false
      toggle.focus({ preventScroll: true })
      return document.activeElement === toggle
    }
    window.requestAnimationFrame(() => {
      if (!focusToggle()) window.setTimeout(focusToggle, 0)
    })
  }, [])

  const closeActivePanelTab = useCallback((): void => {
    const { activeSessionId, uiState, closeRightPanelTab, closeSideChat, closeTerminalTab } = useSessionStore.getState()
    if (!activeSessionId) return
    const ui = uiState[activeSessionId]
    const closeTarget = resolvePanelCloseTarget(shellFocusAreaRef.current, {
      rightPanelActiveTabId: ui?.rightPanel?.activeTabId ?? null,
      bottomPanelOpen: Boolean(ui?.showTerminal),
      bottomPanelActiveTabId: ui?.terminalPanel?.activeTabId ?? null,
      bottomPanelTabCount: ui?.terminalPanel?.tabs.length ?? 0
    })
    if (closeTarget === 'right-panel') {
      const activeTabId = ui?.rightPanel?.activeTabId
      if (!activeTabId) return
      const closingFinalRightTab = (ui?.rightPanel?.tabs.length ?? 0) <= 1
      const sideChatId = sideChatIdFromTabId(activeTabId)
      const terminalTabId = terminalTabIdFromTabId(activeTabId)
      exitFullscreenForPanelTab('right', activeTabId)
      if (sideChatId) {
        closeSideChat(activeSessionId, sideChatId)
      } else if (terminalTabId !== null) {
        window.api.terminal.kill(`${activeSessionId}-${terminalTabId}`)
        closeTerminalTab(activeSessionId, terminalTabId)
      } else {
        closeRightPanelTab(activeSessionId, activeTabId)
      }
      if (closingFinalRightTab) restoreRightPanelToggleFocus()
      return
    }
    if (closeTarget === 'bottom-panel') {
      const terminalPanel = ui?.terminalPanel
      if (!ui?.showTerminal || terminalPanel?.activeTabId === undefined) return
      const closingFinalTerminalTab = terminalPanel.tabs.length <= 1
      exitFullscreenForPanelTab('bottom', terminalPanel.activeTabId)
      if (typeof terminalPanel.activeTabId === 'number') {
        window.api.terminal.kill(`${activeSessionId}-${terminalPanel.activeTabId}`)
      }
      closeTerminalTab(activeSessionId, terminalPanel.activeTabId)
      if (closingFinalTerminalTab) restoreTerminalToggleFocus()
    }
  }, [restoreRightPanelToggleFocus, restoreTerminalToggleFocus])

  const updateShellFocusArea = useCallback((target: EventTarget | null): void => {
    const next = shellFocusAreaFromTarget(target)
    if (shellFocusAreaRef.current === next) return
    shellFocusAreaRef.current = next
    setShellFocusArea(next)
  }, [])

  const focusSkipTarget = useCallback((event: ReactMouseEvent<HTMLAnchorElement>, targetId: string): void => {
    event.preventDefault()
    const target = document.getElementById(targetId)
    if (!(target instanceof HTMLElement)) return
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    target.focus({ preventScroll: true })
    updateShellFocusArea(target)
  }, [updateShellFocusArea])

  const toggleActiveChatPin = useCallback(async (): Promise<void> => {
    const { sessions, activeSessionId } = useSessionStore.getState()
    const session = sessions.find((candidate) => candidate.id === activeSessionId)
    if (!session) return
    await window.api.sessions.updatePinned(session.id, !session.pinned)
  }, [])

  const switchChatSlot = useCallback((slot: number): void => {
    const { sessions, setActiveSession, setShowCapabilities, setShowSettings } = useSessionStore.getState()
    const ordered = [...sessions].sort((a, b) => (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt))
    const session = ordered[slot - 1]
    if (!session) return
    setActiveSession(session.id)
    setShowCapabilities(false)
    setShowSettings(false)
  }, [])

  const renameActiveChat = useCallback(async (nextName: string): Promise<void> => {
    const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === useSessionStore.getState().activeSessionId)
    const trimmed = nextName.trim()
    if (!session || !trimmed || trimmed === session.name) {
      setRenamingActiveChat(false)
      return
    }
    await window.api.sessions.updateName(session.id, trimmed)
    setRenamingActiveChat(false)
  }, [])

  const shortcutPlatform = useMemo(() => navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other', [])
  const shortcutsFor = useCallback((command: StableAppCommand): string[] => (
    commandShortcuts(command, shortcutOverrides).map((sequence) => formatShortcutSequence(sequence, shortcutPlatform))
  ), [shortcutOverrides, shortcutPlatform])
  const chatSlotActions = useMemo<CommandPaletteAction[]>(() => (
    Array.from({ length: Math.min(9, sessionCount) }, (_, index) => ({
      id: `go-chat-${index + 1}`,
      label: `Go to Chat ${index + 1}`,
      group: 'Navigation',
      description: 'Jump to a recent chat from the sidebar order.',
      shortcut: formatShortcutSequence(['mod', String(index + 1)], shortcutPlatform),
      keywords: ['thread', 'session', 'recent'],
      run: () => switchChatSlot(index + 1)
    }))
  ), [sessionCount, shortcutPlatform, switchChatSlot])

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(() => [
    {
      id: 'new-chat',
      label: APP_COMMANDS['new-chat'].label,
      group: APP_COMMANDS['new-chat'].group,
      description: APP_COMMANDS['new-chat'].description,
      shortcuts: shortcutsFor('new-chat'),
      keywords: [...(APP_COMMANDS['new-chat'].keywords ?? [])],
      run: () => { void createNewChat() }
    },
    {
      id: 'rename-chat',
      label: APP_COMMANDS['rename-chat'].label,
      group: APP_COMMANDS['rename-chat'].group,
      description: APP_COMMANDS['rename-chat'].description,
      shortcuts: shortcutsFor('rename-chat'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['rename-chat'].keywords ?? [])],
      run: () => setRenamingActiveChat(true)
    },
    {
      id: 'toggle-chat-pin',
      label: activeSessionPinned ? 'Unpin Chat' : 'Pin Chat',
      group: APP_COMMANDS['toggle-chat-pin'].group,
      description: activeSessionPinned ? 'Remove this chat from the pinned list.' : 'Keep this chat at the top of the sidebar.',
      shortcuts: shortcutsFor('toggle-chat-pin'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['toggle-chat-pin'].keywords ?? [])],
      run: () => { void toggleActiveChatPin() }
    },
    {
      id: 'search-transcript',
      label: APP_COMMANDS['search-transcript'].label,
      group: APP_COMMANDS['search-transcript'].group,
      description: APP_COMMANDS['search-transcript'].description,
      shortcuts: shortcutsFor('search-transcript'),
      keywords: [...(APP_COMMANDS['search-transcript'].keywords ?? [])],
      disabled: !activeSessionId || !canRunPanelFind(),
      run: openPanelFindTarget
    },
    {
      id: 'find-next',
      label: APP_COMMANDS['find-next'].label,
      group: APP_COMMANDS['find-next'].group,
      description: APP_COMMANDS['find-next'].description,
      shortcuts: shortcutsFor('find-next'),
      keywords: [...(APP_COMMANDS['find-next'].keywords ?? [])],
      disabled: !activeSessionId || !canRunPanelFind(),
      run: () => stepPanelFindTarget(1)
    },
    {
      id: 'find-previous',
      label: APP_COMMANDS['find-previous'].label,
      group: APP_COMMANDS['find-previous'].group,
      description: APP_COMMANDS['find-previous'].description,
      shortcuts: shortcutsFor('find-previous'),
      keywords: [...(APP_COMMANDS['find-previous'].keywords ?? [])],
      disabled: !activeSessionId || !canRunPanelFind(),
      run: () => stepPanelFindTarget(-1)
    },
    {
      id: 'open-file-search',
      label: APP_COMMANDS['open-file-search'].label,
      group: APP_COMMANDS['open-file-search'].group,
      description: APP_COMMANDS['open-file-search'].description,
      shortcuts: shortcutsFor('open-file-search'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['open-file-search'].keywords ?? [])],
      run: openFileSearch
    },
    ...BROWSER_PANEL_COMMANDS.map((command): CommandPaletteAction => ({
      id: command,
      label: APP_COMMANDS[command].label,
      group: APP_COMMANDS[command].group,
      description: APP_COMMANDS[command].description,
      shortcuts: shortcutsFor(command),
      disabled: !canRunBrowserPanelCommand(),
      keywords: [...(APP_COMMANDS[command].keywords ?? [])],
      run: () => runBrowserPanelCommand(command)
    })),
    {
      id: 'previous-chat',
      label: APP_COMMANDS['previous-chat'].label,
      group: APP_COMMANDS['previous-chat'].group,
      description: APP_COMMANDS['previous-chat'].description,
      shortcuts: shortcutsFor('previous-chat'),
      disabled: sessionCount < 2,
      run: () => switchChat(-1)
    },
    {
      id: 'next-chat',
      label: APP_COMMANDS['next-chat'].label,
      group: APP_COMMANDS['next-chat'].group,
      description: APP_COMMANDS['next-chat'].description,
      shortcuts: shortcutsFor('next-chat'),
      disabled: sessionCount < 2,
      run: () => switchChat(1)
    },
    ...chatSlotActions,
    {
      id: 'toggle-inspector',
      label: APP_COMMANDS['toggle-inspector'].label,
      group: APP_COMMANDS['toggle-inspector'].group,
      description: APP_COMMANDS['toggle-inspector'].description,
      shortcuts: shortcutsFor('toggle-inspector'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['toggle-inspector'].keywords ?? [])],
      run: toggleInspector
    },
    {
      id: 'open-review-tab',
      label: APP_COMMANDS['open-review-tab'].label,
      group: APP_COMMANDS['open-review-tab'].group,
      description: APP_COMMANDS['open-review-tab'].description,
      shortcuts: shortcutsFor('open-review-tab'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['open-review-tab'].keywords ?? [])],
      run: openReviewPanelTab
    },
    {
      id: 'open-browser-tab',
      label: APP_COMMANDS['open-browser-tab'].label,
      group: APP_COMMANDS['open-browser-tab'].group,
      description: APP_COMMANDS['open-browser-tab'].description,
      shortcuts: shortcutsFor('open-browser-tab'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['open-browser-tab'].keywords ?? [])],
      run: openBrowserTabCommand
    },
    {
      id: 'toggle-browser-panel',
      label: APP_COMMANDS['toggle-browser-panel'].label,
      group: APP_COMMANDS['toggle-browser-panel'].group,
      description: APP_COMMANDS['toggle-browser-panel'].description,
      shortcuts: shortcutsFor('toggle-browser-panel'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['toggle-browser-panel'].keywords ?? [])],
      run: toggleBrowserPanel
    },
    {
      id: 'toggle-terminal',
      label: APP_COMMANDS['toggle-terminal'].label,
      group: APP_COMMANDS['toggle-terminal'].group,
      description: APP_COMMANDS['toggle-terminal'].description,
      shortcuts: shortcutsFor('toggle-terminal'),
      disabled: !activeSessionId,
      keywords: [...(APP_COMMANDS['toggle-terminal'].keywords ?? [])],
      run: toggleTerminal
    },
    {
      id: 'close-active-panel-tab',
      label: APP_COMMANDS['close-active-panel-tab'].label,
      group: APP_COMMANDS['close-active-panel-tab'].group,
      description: APP_COMMANDS['close-active-panel-tab'].description,
      shortcuts: shortcutsFor('close-active-panel-tab'),
      disabled: !canCloseActivePanelTab(),
      keywords: [...(APP_COMMANDS['close-active-panel-tab'].keywords ?? [])],
      run: closeActivePanelTab
    },
    {
      id: 'toggle-pet',
      label: 'Toggle Pet Overlay',
      group: 'App',
      description: 'Show or hide the floating activity overlay.',
      keywords: ['overlay'],
      run: () => { void togglePet() }
    },
    {
      id: 'keyboard-shortcuts',
      label: APP_COMMANDS['keyboard-shortcuts'].label,
      group: APP_COMMANDS['keyboard-shortcuts'].group,
      description: APP_COMMANDS['keyboard-shortcuts'].description,
      shortcuts: shortcutsFor('keyboard-shortcuts'),
      keywords: [...(APP_COMMANDS['keyboard-shortcuts'].keywords ?? [])],
      run: () => openSettings('shortcuts')
    },
    {
      id: 'settings',
      label: APP_COMMANDS.settings.label,
      group: APP_COMMANDS.settings.group,
      description: APP_COMMANDS.settings.description,
      shortcuts: shortcutsFor('settings'),
      keywords: [...(APP_COMMANDS.settings.keywords ?? [])],
      run: () => openSettings('general')
    }
  ], [
    activeSessionPinned,
    activeSessionId,
    chatSlotActions,
    createNewChat,
    openFileSearch,
    openSettings,
    openPanelFindTarget,
    stepPanelFindTarget,
    openBrowserTabCommand,
    openReviewPanelTab,
    openTranscriptSearch,
    runBrowserPanelCommand,
    sessionCount,
    shortcutsFor,
    shellFocusArea,
    canRunPanelFind,
    canRunBrowserPanelCommand,
    switchChat,
    canCloseActivePanelTab,
    closeActivePanelTab,
    toggleActiveChatPin,
    toggleInspector,
    toggleBrowserPanel,
    togglePet,
    toggleTerminal
  ])

  const runAppCommand = useCallback((command: AppMenuCommand): void => {
    if (command.startsWith('go-chat-')) {
      switchChatSlot(Number(command.replace('go-chat-', '')))
      return
    }
    switch (command) {
      case 'open-command-menu':
        setCommandPaletteOpen(true)
        break
      case 'new-chat':
        void createNewChat()
        break
      case 'search-transcript':
        openPanelFindTarget()
        break
      case 'find-next':
        stepPanelFindTarget(1)
        break
      case 'find-previous':
        stepPanelFindTarget(-1)
        break
      case 'open-file-search':
        openFileSearch()
        break
      case 'focus-browser-address-bar':
      case 'browser-reload-page':
      case 'browser-hard-reload-page':
      case 'browser-navigate-back':
      case 'browser-navigate-forward':
        runBrowserPanelCommand(command)
        break
      case 'rename-chat':
        if (useSessionStore.getState().activeSessionId) setRenamingActiveChat(true)
        break
      case 'toggle-chat-pin':
        void toggleActiveChatPin()
        break
      case 'previous-chat':
      case 'previous-recent-chat':
        switchChat(-1)
        break
      case 'next-chat':
      case 'next-recent-chat':
        switchChat(1)
        break
      case 'toggle-inspector':
        toggleInspector()
        break
      case 'open-review-tab':
        openReviewPanelTab()
        break
      case 'open-browser-tab':
        openBrowserTabCommand()
        break
      case 'toggle-browser-panel':
        toggleBrowserPanel()
        break
      case 'toggle-terminal':
        toggleTerminal()
        break
      case 'close-active-panel-tab':
        closeActivePanelTab()
        break
      case 'settings':
        openSettings('general')
        break
      case 'keyboard-shortcuts':
        openSettings('shortcuts')
        break
    }
  }, [
    createNewChat,
    openFileSearch,
    openSettings,
    openPanelFindTarget,
    stepPanelFindTarget,
    openBrowserTabCommand,
    openReviewPanelTab,
    openTranscriptSearch,
    closeActivePanelTab,
    switchChat,
    switchChatSlot,
    runBrowserPanelCommand,
    toggleActiveChatPin,
    toggleBrowserPanel,
    toggleInspector,
    toggleTerminal
  ])

  useEffect(() => {
    const bootStartedAt = markRendererStart()
    window.api.app.getProfile().then((profile) => {
      document.documentElement.dataset.forcedReducedMotion = profile.forceReducedMotion ? 'true' : 'false'
      if (profile.forceReducedMotion) {
        document.documentElement.dataset.reducedMotion = 'true'
      }
    })
    window.api.sessions.checkProviders().then(setProviderAvailability)
    window.api.settings.get().then((s) => {
      setShortcutOverrides(s.shortcutOverrides ?? {})
      applyAppearance(
        s.appearance ?? 'mist',
        s.accent ?? 'blue',
        s.density ?? 'comfortable',
        s.sidebarTint ?? true,
        s.transcriptStyle ?? 'relaxed',
        s.customAccent ?? '#0a7cff',
        s.interfaceScale ?? 1,
        s.uiFont ?? 'system',
        s.monoFont ?? 'system',
        s
      )
      const pm = (s as unknown as Record<string, unknown>).providerModels
      if (pm && typeof pm === 'object') setProviderModels(pm as Record<string, string[]>)
      const catalog = (s as unknown as Record<string, unknown>).providerModelCatalog
      if (catalog && typeof catalog === 'object') {
        mergeProviderModelCatalog(catalog as Record<string, ProviderModelDef[]>)
      }
    })
    const onShortcutOverridesChanged = (event: Event): void => {
      const custom = event as CustomEvent<ShortcutOverrides>
      setShortcutOverrides(custom.detail ?? {})
    }
    window.addEventListener('orchestrator:shortcut-overrides-changed', onShortcutOverridesChanged)

    const media = window.matchMedia('(prefers-color-scheme: light)')
    const onSystemThemeChanged = (): void => {
      window.api.settings.get().then((s) => applyAppearance(
        (s.appearance ?? 'mist') as Appearance,
        s.accent ?? 'blue',
        s.density ?? 'comfortable',
        s.sidebarTint ?? true,
        s.transcriptStyle ?? 'relaxed',
        s.customAccent ?? '#0a7cff',
        s.interfaceScale ?? 1,
        s.uiFont ?? 'system',
        s.monoFont ?? 'system',
        s
      ))
    }
    media.addEventListener('change', onSystemThemeChanged)

    const navigateToSession = (sessionId: string): boolean => {
      const state = useSessionStore.getState()
      if (!state.sessions.some((session) => session.id === sessionId)) return false
      flushSync(() => {
        state.setShowSettings(false)
        state.setShowCapabilities(false)
        setShowAutomations(false)
        state.setActiveSession(sessionId)
      })
      return true
    }

    const navigateToSettings = (section: SettingsSection, hostId: string | null): void => {
      if (section === 'automations') {
        flushSync(() => {
          setShowSettings(false)
          setShowCapabilities(false)
          setShowAutomations(true)
        })
        return
      }
      flushSync(() => {
        setSettingsSection(section)
        setSettingsHostId(hostId ?? 'local')
        setShowCapabilities(false)
        setShowAutomations(false)
        setShowSettings(true)
      })
      pushRouteUrl(settingsRouteUrl(section, hostId))
    }

    Promise.all([window.api.projects.list(), window.api.sessions.listSummaries()]).then(
      async ([projects, sessions]) => {
        const pendingNavigation = await window.api.app.consumePendingNavigation()
        const routeNavigation = parseSessionRouteLocation(window.location)
        const effectiveNavigation = pendingNavigation ?? (routeNavigation
          ? { kind: 'session' as const, sessionId: routeNavigation.sessionId }
          : null)
        setProjects(projects)

        if (projects.length === 0) {
          setSessions(sessions)
          return
        }

        // Most recent project = the one containing the latest session (by any session)
        let targetProject = projects[projects.length - 1]
        const allSorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt)
        const requestedSession = effectiveNavigation?.kind === 'session'
          ? sessions.find((session) => session.id === effectiveNavigation.sessionId)
          : undefined
        if (requestedSession) {
          const found = projects.find((p) => p.id === requestedSession.projectId)
          if (found) targetProject = found
        } else if (allSorted.length > 0) {
          const found = projects.find((p) => p.id === allSorted[0].projectId)
          if (found) targetProject = found
        }

        // Separate empty sessions (safe to clean up) from live ones
        const { uiState } = useSessionStore.getState()
        const emptySessions = sessions.filter((s) => s.messageCount === 0 && s.status !== 'running' && !hasComposerDraft(uiState[s.id]))
        const liveSessions = sessions.filter((s) => s.messageCount > 0 || s.status === 'running' || hasComposerDraft(uiState[s.id]))

        // Keep one empty session in the target project to reuse; delete all others
        const requestedEmptySession = requestedSession && emptySessions.some((session) => session.id === requestedSession.id)
          ? requestedSession
          : undefined
        const reuseCandidate = requestedEmptySession ?? emptySessions
          .filter((s) => s.projectId === targetProject.id)
          .sort((a, b) => b.createdAt - a.createdAt)[0]

        const requestedSessionId = effectiveNavigation?.kind === 'session' ? effectiveNavigation.sessionId : null
        const toDelete = emptySessions.filter((s) => s.id !== reuseCandidate?.id && s.id !== requestedSessionId)
        for (const s of toDelete) {
          await window.api.sessions.remove(s.id)
          await window.api.projects.removeSession(s.projectId, s.id)
          removeSessionFromProject(s.projectId, s.id)
        }

        const cleanSessions = reuseCandidate
          ? [...liveSessions, reuseCandidate]
          : liveSessions
        setSessions(cleanSessions)
        recordRendererMetric('app.boot.session-index-ready', bootStartedAt, {
          projects: projects.length,
          sessions: cleanSessions.length,
          messages: cleanSessions.reduce((sum, session) => sum + session.messageCount, 0)
        })

        if (effectiveNavigation?.kind === 'settings') {
          navigateToSettings(effectiveNavigation.section as SettingsSection, effectiveNavigation.hostId)
        } else if (effectiveNavigation?.kind === 'session' && cleanSessions.some((session) => session.id === effectiveNavigation.sessionId)) {
          sessionRouteNoticeRequestRef.current += 1
          setSessionRouteNotice(null)
          setShowSettings(false)
          setShowCapabilities(false)
          setShowAutomations(false)
          setActiveSession(effectiveNavigation.sessionId)
        } else if (effectiveNavigation?.kind === 'session') {
          setSessionRouteNotice({
            kind: 'resolving',
            sessionId: effectiveNavigation.sessionId,
            name: null
          })
          const notice = await inspectSessionRoute(effectiveNavigation.sessionId)
          setShowSettings(false)
          setShowCapabilities(false)
          setShowAutomations(false)
          let recoveredSessionId: string | null = null
          if (reuseCandidate) {
            setActiveSession(reuseCandidate.id)
            recoveredSessionId = reuseCandidate.id
          } else {
            const session = await window.api.sessions.create({
              projectId: targetProject.id,
              workDir: targetProject.rootPath,
              useWorktree: false,
              repoRoot: targetProject.rootPath
            })
            await window.api.projects.addSession(targetProject.id, session.id)
            addSession(session)
            addSessionToProject(targetProject.id, session.id)
            setActiveSession(session.id)
            recoveredSessionId = session.id
          }
          if (notice.kind === 'missing' && recoveredSessionId) {
            sessionRouteNoticeRequestRef.current += 1
            setSessionRouteNotice(null)
            replaceRouteUrl(sessionRouteUrl(recoveredSessionId))
          } else {
            setSessionRouteNotice(notice)
          }
        } else if (reuseCandidate) {
          setActiveSession(reuseCandidate.id)
        } else {
          const session = await window.api.sessions.create({
            projectId: targetProject.id,
            workDir: targetProject.rootPath,
            useWorktree: false,
            repoRoot: targetProject.rootPath
          })
          await window.api.projects.addSession(targetProject.id, session.id)
          addSession(session)
          addSessionToProject(targetProject.id, session.id)
          setActiveSession(session.id)
        }
      }
    )

    const unsubAppNav = window.api.app.onNavigateSession((sessionId) => {
      navigateToSession(sessionId)
    })
    const unsubSettingsNav = window.api.app.onNavigateSettings((navigation) => {
      navigateToSettings(navigation.section as SettingsSection, navigation.hostId)
    })
    const unsubNav = window.api.pet.onNavigate((sessionId) => {
      navigateToSession(sessionId)
    })

    const unsub = window.api.onSessionEvent((event) => {
      if (event.type === 'created') {
        addSession(event.session)
      } else if (event.type === 'status') {
        updateStatus(event.id, event.status)
        const isWaitingStatus = event.status === 'waiting_for_permission' || event.status === 'waiting_for_user'
        if (!isWaitingStatus) {
          waitingNotificationKeysRef.current.forEach((key) => {
            if (key.startsWith(`${event.id}:`)) waitingNotificationKeysRef.current.delete(key)
          })
        }
        if (isWaitingStatus) {
          const currentActiveId = useSessionStore.getState().activeSessionId
          if (event.id !== currentActiveId) setHasUnread(event.id, true)
          const key = `${event.id}:${event.status}`
          if (!document.hasFocus() && !waitingNotificationKeysRef.current.has(key)) {
            const session = useSessionStore.getState().sessions.find((s) => s.id === event.id)
            if (session && typeof Notification !== 'undefined') {
              try {
                new Notification(event.status === 'waiting_for_permission' ? 'Permission needed' : 'Answer needed', {
                  body: session.name,
                  silent: false
                })
                waitingNotificationKeysRef.current.add(key)
              } catch {
                waitingNotificationKeysRef.current.add(key)
              }
            }
          }
        }
        if (event.status === 'idle') {
          const currentActiveId = useSessionStore.getState().activeSessionId
          if (event.id !== currentActiveId) {
            setHasUnread(event.id, true)
            const session = useSessionStore.getState().sessions.find((s) => s.id === event.id)
            if (session && session.messages.length > 0) {
              new Notification('Session finished', { body: session.name, silent: false })
            }
          }
        }
      } else if (event.type === 'messages') {
        appendMessages(event.id, event.messages)
      } else if (event.type === 'messageUpdated') {
        scheduleMessageUpsert(event.id, event.message)
      } else if (event.type === 'messageRemoved') {
        removeMessage(event.id, event.messageId)
      } else if (event.type === 'events') {
        appendEvents(event.id, event.events)
        applyBrowserManagerRunEvents(event.id, event.events)
      } else if (event.type === 'raw') {
        appendRaw(event.id, event.data)
      } else if (event.type === 'renamed') {
        updateName(event.id, event.name, event.nameSource)
      } else if (event.type === 'pinned') {
        updatePinned(event.id, event.pinned, event.pinOrder)
      } else if (event.type === 'updated') {
        const { id, type, ...patch } = event
        updateSession(id, patch)
      } else if (event.type === 'settingsUpdated') {
        const { id, ...patch } = event
        updateSettings(id, patch)
      } else if (event.type === 'needsInput') {
        setShowTerminal(event.id, true)
      } else if (event.type === 'archived') {
        const state = useSessionStore.getState()
        const archived = state.sessions.find((s) => s.id === event.id)
        const wasActive = state.activeSessionId === event.id
        const fallback = wasActive ? newestSessionExcluding(state.sessions, event.id) : undefined
        if (archived) removeSessionFromProject(archived.projectId, archived.id)
        state.removeSession(event.id)
        if (wasActive) {
          sessionRouteNoticeRequestRef.current += 1
          setSessionRouteNotice(null)
          setShowAutomations(false)
          state.setShowSettings(false)
          state.setShowCapabilities(false)
          if (fallback) {
            state.setActiveSession(fallback.id)
            replaceRouteUrl(sessionRouteUrl(fallback.id))
          } else {
            state.setActiveSession(null)
            replaceRouteUrl('/')
          }
        }
      }
    })

    return () => {
      unsub()
      unsubAppNav()
      unsubSettingsNav()
      unsubNav()
      media.removeEventListener('change', onSystemThemeChanged)
      window.removeEventListener('orchestrator:shortcut-overrides-changed', onShortcutOverridesChanged)
    }
  }, [])

  useEffect(() => {
    if (isDesignSystemPreview) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      const command = appMenuCommandForKeyboardEvent(event, shortcutOverrides)
      if (command) {
        updateShellFocusArea(event.target)
        if (command === 'close-active-panel-tab' && !canCloseActivePanelTab()) return
        if ((command === 'search-transcript' || command === 'find-next' || command === 'find-previous') && !canRunPanelFind()) return
        if (BROWSER_PANEL_COMMANDS.includes(command as BrowserPanelCommand) && !canRunBrowserPanelCommand()) return
        event.preventDefault()
        runAppCommand(command)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    isDesignSystemPreview,
    canCloseActivePanelTab,
    canRunPanelFind,
    canRunBrowserPanelCommand,
    runAppCommand,
    shortcutOverrides,
    updateShellFocusArea
  ])

  useEffect(() => {
    if (!threadFindVisible || !activeSessionId) return
    window.dispatchEvent(new CustomEvent('orchestrator:thread-find-query', {
      detail: {
        sessionId: activeSessionId,
        domain: threadFindDomain,
        query: threadFindQuery
      }
    }))
  }, [activeSessionId, threadFindDomain, threadFindQuery, threadFindVisible])

  useEffect(() => {
    const onThreadFindStatus = (event: Event): void => {
      const detail = (event as CustomEvent<{
        sessionId?: string
        domain?: ThreadFindDomain
        totalMatches?: number
        activeMatch?: number
        isCapped?: boolean
        activePath?: string | null
      }>).detail
      if (detail?.sessionId && detail.sessionId !== useSessionStore.getState().activeSessionId) return
      if (detail?.domain !== 'conversation' && detail?.domain !== 'diff') return
      setThreadFindStatus((current) => ({
        ...current,
        [detail.domain as ThreadFindDomain]: {
          totalMatches: Math.max(0, detail.totalMatches ?? 0),
          activeMatch: Math.max(0, detail.activeMatch ?? 0),
          isCapped: detail.isCapped === true,
          activePath: detail.activePath ?? null
        }
      }))
    }
    window.addEventListener('orchestrator:thread-find-status', onThreadFindStatus)
    return () => window.removeEventListener('orchestrator:thread-find-status', onThreadFindStatus)
  }, [])

  useEffect(() => {
    if (isDesignSystemPreview) return
    void window.api.app.setMenuCommandAvailability(currentMenuCommandAvailability())
  }, [
    activeSessionId,
    activeMenuUi,
    currentMenuCommandAvailability,
    isDesignSystemPreview,
    sessionCount,
    shellFocusArea
  ])

  useEffect(() => {
    if (isDesignSystemPreview) return
    return window.api.app.onMenuCommand(runAppCommand)
  }, [isDesignSystemPreview, runAppCommand])

  useEffect(() => {
    if (!activeSessionId) return
    const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === activeSessionId)
    if (!session || session.messagesLoaded || session.messageCount === 0) return
    let cancelled = false
    const startedAt = markRendererStart()
    window.api.sessions.getTranscriptPage(activeSessionId, { limit: 120 }).then((page) => {
      if (!cancelled && page) {
        mergeTranscriptPage(activeSessionId, page, 'replace')
        recordRendererMetric('transcript.initial-page-ready', startedAt, {
          sessionId: activeSessionId,
          messages: page.messages.length,
          messageCount: page.messageCount,
          hasMoreBefore: page.hasMoreBefore
        })
      }
    })
    return () => { cancelled = true }
  }, [activeSessionId, mergeTranscriptPage])

  if (isDesignSystemPreview) {
    return <DesignSystemPreview />
  }

  return (
    <div
      className="app-shell flex flex-1 overflow-hidden"
      data-app-shell-active-focus-area={shellFocusArea}
      onFocusCapture={(event) => updateShellFocusArea(event.target)}
      onPointerOverCapture={(event) => updateShellFocusArea(event.target)}
    >
      <nav className="app-skip-links" aria-label="Skip navigation">
        <a
          href="#orchestrator-chat-transcript"
          className="app-skip-link"
          data-testid="app-skip-to-transcript"
          onClick={(event) => focusSkipTarget(event, 'orchestrator-chat-transcript')}
        >
          Skip to transcript
        </a>
        <a
          href="#orchestrator-chat-composer"
          className="app-skip-link"
          data-testid="app-skip-to-composer"
          onClick={(event) => focusSkipTarget(event, 'orchestrator-chat-composer')}
        >
          Skip to composer
        </a>
        <a
          href="#orchestrator-workbench-panel"
          className="app-skip-link"
          data-testid="app-skip-to-workbench"
          onClick={(event) => focusSkipTarget(event, 'orchestrator-workbench-panel')}
        >
          Skip to Workbench
        </a>
      </nav>
      <Sidebar
        onNewChat={handleSidebarNewChat}
        onSearch={openSidebarSearch}
        onOpenPlugins={openSidebarPlugins}
        onOpenAutomations={openSidebarAutomations}
        onCloseAutomations={closeSidebarAutomations}
        isAutomationsOpen={showAutomations}
        isCollapsed={leftSidebarCollapsed}
        onToggleSidebar={toggleLeftSidebar}
      />
      <section
        className="content-shell main-surface flex-1 flex flex-col min-w-0 min-h-0"
        data-app-shell-main-content-frame="codex-continuous"
      >
        {showAutomations ? (
          <MotionView viewKey="automations" className="flex flex-col overflow-hidden">
            <AutomationsStandalonePage sessions={automationSessions} onClose={() => setShowAutomations(false)} />
          </MotionView>
        ) : showSettings ? (
          <MotionView viewKey={`settings:${settingsSection}`} className="flex flex-col overflow-hidden">
            <SettingsPage
              section={settingsSection}
              onClose={closeSettings}
            />
          </MotionView>
        ) : showCapabilities ? (
          <MotionView viewKey="capabilities" className="flex flex-col overflow-hidden">
            <CapabilitiesPage />
          </MotionView>
        ) : (
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {sessionRouteNotice ? (
              <SessionRouteRecoveryView
                notice={sessionRouteNotice}
                onRestore={() => { void restoreArchivedRouteSession() }}
                onReturn={returnToActiveChatFromRouteNotice}
                onNewChat={() => { void createNewChat() }}
              />
            ) : deferredActiveSessionId ? (
              <MotionView viewKey="session" animate={false} className="flex flex-col overflow-hidden">
                <SessionPane sessionId={deferredActiveSessionId} />
              </MotionView>
            ) : (
              <EmptyState />
            )}
          </main>
        )}
      </section>
      <ThreadFindBar
        visible={threadFindVisible}
        domain={threadFindDomain}
        inputRef={threadFindInputRef}
        query={threadFindQuery}
        status={threadFindStatus[threadFindDomain]}
        onDomainChange={(domain) => setThreadFindDomain(domain)}
        onQueryChange={setThreadFindQuery}
        onStep={(direction) => {
          window.dispatchEvent(new CustomEvent('orchestrator:thread-find-step', {
            detail: { sessionId: activeSessionId, domain: threadFindDomain, direction }
          }))
        }}
        onClose={closeThreadFind}
      />
      {commandPaletteOpen && (
        <CommandPalette
          actions={commandPaletteActions}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {renamingActiveChat && activeSessionName && (
        <RenameChatDialog
          initialValue={activeSessionName}
          onCancel={() => setRenamingActiveChat(false)}
          onConfirm={(value) => void renameActiveChat(value)}
        />
      )}
    </div>
  )
}

function ThreadFindBar({
  visible,
  domain,
  inputRef,
  query,
  status,
  onDomainChange,
  onQueryChange,
  onStep,
  onClose
}: {
  visible: boolean
  domain: ThreadFindDomain
  inputRef: RefObject<HTMLInputElement>
  query: string
  status: ThreadFindStatus
  onDomainChange: (domain: ThreadFindDomain) => void
  onQueryChange: (query: string) => void
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}): JSX.Element {
  if (!visible) return <></>

  const hasMatches = status.totalMatches > 0
  const countLabel = query.trim()
    ? hasMatches
      ? `${Math.max(1, status.activeMatch || 1)} / ${status.totalMatches}${status.isCapped ? '+' : ''} results`
      : '0 results'
    : ''
  const statusId = 'thread-find-status'
  const inputLabel = domain === 'diff' ? 'Find in diffs' : 'Find in chat'
  const inputPlaceholder = domain === 'diff' ? 'Search diffs...' : 'Search chat...'

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onStep(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="thread-find-bar"
      data-testid="thread-find-bar"
      data-thread-find-domain={domain}
      data-thread-find-visible="true"
      data-thread-find-query={query}
      data-thread-find-total-matches={status.totalMatches}
      data-thread-find-active-match={status.activeMatch}
      data-thread-find-capped={status.isCapped ? 'true' : 'false'}
    >
      <div className="thread-find-input-cell">
        <Icon name="search" size={14} />
        <label className="sr-only" htmlFor="content-search-input">{inputLabel}</label>
        <input
          id="content-search-input"
          ref={inputRef}
          type="text"
          value={query}
          aria-label={inputLabel}
          aria-describedby={countLabel ? statusId : undefined}
          placeholder={inputPlaceholder}
          className="thread-find-input"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="thread-find-scope-controls" aria-label="Find scope">
        <button
          type="button"
          className="thread-find-scope-button"
          data-active={domain === 'conversation' ? 'true' : 'false'}
          aria-label="Search chat"
          aria-pressed={domain === 'conversation'}
          onClick={() => onDomainChange('conversation')}
        >
          <Icon name="chat" size={14} />
        </button>
        <button
          type="button"
          className="thread-find-scope-button"
          data-active={domain === 'diff' ? 'true' : 'false'}
          aria-label="Search diffs"
          aria-pressed={domain === 'diff'}
          onClick={() => onDomainChange('diff')}
        >
          <Icon name="diff" size={14} />
        </button>
      </div>
      <div className="thread-find-result-cell">
        {countLabel && (
          <span
            id={statusId}
            className="thread-find-result-count"
            data-testid="thread-find-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {countLabel}
          </span>
        )}
        <button
          type="button"
          className="thread-find-nav-button"
          aria-label="Previous result"
          disabled={!hasMatches}
          onClick={() => onStep(-1)}
        >
          <Icon name="arrowUp" size={13} />
        </button>
        <button
          type="button"
          className="thread-find-nav-button"
          aria-label="Next result"
          disabled={!hasMatches}
          onClick={() => onStep(1)}
        >
          <Icon name="chevronDown" size={13} />
        </button>
        <button
          type="button"
          className="thread-find-close-button"
          aria-label="Close find"
          onClick={onClose}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </div>
  )
}

function SessionRouteRecoveryView({
  notice,
  onRestore,
  onReturn,
  onNewChat
}: {
  notice: SessionRouteNotice
  onRestore: () => void
  onReturn: () => void
  onNewChat: () => void
}): JSX.Element {
  const isArchived = notice.kind === 'archived'
  const isResolving = notice.kind === 'resolving'
  const title = isResolving ? 'Opening chat' : isArchived ? 'Archived chat' : 'Chat not found'
  const description = isResolving
    ? 'Checking this thread route before switching the visible chat.'
    : isArchived
      ? `${notice.name ?? 'This chat'} is archived. Restore it to reopen the thread from this link.`
      : 'This chat link does not match an available local or archived chat in this profile.'

  return (
    <div
      className="session-route-recovery"
      data-testid="session-route-recovery"
      data-session-route-recovery-kind={notice.kind}
      data-session-route-recovery-id={notice.sessionId}
      data-session-route-recovery-lifecycle={notice.restoring ? 'restoring' : notice.kind}
      role={isArchived || isResolving ? 'status' : 'alert'}
      aria-live={isArchived || isResolving ? 'polite' : 'assertive'}
      aria-atomic="true"
    >
      <div className="session-route-recovery-card">
        <div className="session-route-recovery-icon" aria-hidden="true">
          <Icon name={isResolving ? 'refresh' : isArchived ? 'archive' : 'warning'} size={18} />
        </div>
        <div className="session-route-recovery-body">
          <div className="session-route-recovery-kicker">Thread route</div>
          <h1 className="session-route-recovery-title">{title}</h1>
          <p className="session-route-recovery-description">{description}</p>
          <div className="session-route-recovery-code" title={notice.sessionId}>{notice.sessionId}</div>
          {notice.error && (
            <div className="session-route-recovery-error" data-testid="session-route-recovery-error">
              {notice.error}
            </div>
          )}
          <div className="session-route-recovery-actions">
            {isArchived && (
              <button
                type="button"
                className="session-route-recovery-primary"
                data-testid="session-route-recovery-restore"
                disabled={notice.restoring === true}
                onClick={onRestore}
              >
                {notice.restoring ? 'Restoring...' : 'Restore chat'}
              </button>
            )}
            <button
              type="button"
              className="session-route-recovery-secondary"
              data-testid="session-route-recovery-return"
              onClick={onReturn}
            >
              Return to current chat
            </button>
            <button
              type="button"
              className="session-route-recovery-secondary"
              data-testid="session-route-recovery-new-chat"
              onClick={onNewChat}
            >
              New chat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AutomationsStandalonePage({
  sessions,
  onClose
}: {
  sessions: ReturnType<typeof useSessionStore.getState>['sessions']
  onClose: () => void
}): JSX.Element {
  return (
    <div className="automations-standalone-shell" data-testid="automations-standalone-page" data-app-shell-focus-area="main">
      <div className="automations-standalone-topbar" data-app-shell-header-band="shared">
        <div className="automations-standalone-title">
          <Icon name="clock" size={14} />
          <span>Automations</span>
        </div>
        <button
          type="button"
          className="settings-back-button"
          data-testid="automations-back-to-chat"
          onClick={onClose}
        >
          <Icon name="chat" size={14} />
          Chat
        </button>
      </div>
      <div className="automations-standalone-body">
        <AutomationsSettingsPage sessions={sessions} standalone />
      </div>
    </div>
  )
}

function shellFocusAreaFromTarget(target: EventTarget | null): ShellFocusArea {
  if (!(target instanceof HTMLElement)) return 'main'
  const focusArea = target.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area')
  return focusArea === 'right-panel' || focusArea === 'bottom-panel' ? focusArea : 'main'
}
