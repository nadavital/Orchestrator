import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { flushSync } from 'react-dom'
import { useProjectStore } from './store/projects'
import { hasComposerDraft, sideChatIdFromTabId, useSessionStore } from './store/sessions'
import type { SettingsSection } from './store/sessions'
import Sidebar from './components/Sidebar/Sidebar'
import SessionPane from './components/Session/SessionPane'
import SettingsPage from './components/SettingsModal'
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
import { browserManagerPatchFromEvents, parseSettingsRouteLocation, resolvePanelBrowserCommandTarget, resolvePanelCloseTarget, resolvePanelFindTarget, resolvePanelNewTabTarget, settingsRouteExitUrl, settingsRouteUrlForLocation } from '../../types'
import type { PanelFindTarget, SessionRunEventRecord } from '../../types'
import type { PanelCloseFocusArea } from '../../types'

type ShellFocusArea = PanelCloseFocusArea
type ThreadFindDomain = 'conversation' | 'diff'
type ThreadFindStatus = {
  totalMatches: number
  activeMatch: number
  isCapped: boolean
  activePath?: string | null
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

function currentUrlMatches(targetUrl: string): boolean {
  if (targetUrl.startsWith('#')) return window.location.hash === targetUrl
  return `${window.location.pathname}${window.location.search}` === targetUrl
}

function replaceRouteUrl(url: string): void {
  if (currentUrlMatches(url)) return
  window.history.replaceState(window.history.state, '', url)
}

function pushRouteUrl(url: string): void {
  if (currentUrlMatches(url)) return
  window.history.pushState(window.history.state, '', url)
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
  const activeSessionUi = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.uiState[id] : undefined
  })
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
  const appendEvents = useSessionStore((state) => state.appendEvents)
  const appendRaw = useSessionStore((state) => state.appendRaw)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setHasUnread = useSessionStore((state) => state.setHasUnread)
  const setProviderAvailability = useSessionStore((state) => state.setProviderAvailability)
  const setProviderModels = useSessionStore((state) => state.setProviderModels)
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
  const [shellFocusArea, setShellFocusArea] = useState<ShellFocusArea>('main')
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>({})
  const [threadFindVisible, setThreadFindVisible] = useState(false)
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => (
    window.localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY) === 'true'
  ))
  const [threadFindDomain, setThreadFindDomain] = useState<ThreadFindDomain>('conversation')
  const [threadFindQuery, setThreadFindQuery] = useState('')
  const [threadFindStatus, setThreadFindStatus] = useState<Record<ThreadFindDomain, ThreadFindStatus>>({
    conversation: { totalMatches: 0, activeMatch: 0, isCapped: false },
    diff: { totalMatches: 0, activeMatch: 0, isCapped: false }
  })
  const waitingNotificationKeysRef = useRef(new Set<string>())
  const shellFocusAreaRef = useRef<ShellFocusArea>('main')
  const threadFindInputRef = useRef<HTMLInputElement | null>(null)
  const deferredActiveSessionId = useDeferredValue(activeSessionId)

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
      replaceRouteUrl(settingsRouteUrl(settingsSection, settingsHostId))
      return
    }
    const route = parseSettingsRouteLocation(window.location)
    if (route) {
      replaceRouteUrl(settingsRouteExitUrl(route.mode))
    }
  }, [settingsHostId, settingsSection, showSettings])

  useEffect(() => {
    const globals = window as typeof window & {
      __orchestratorAppendSessionEventsForSmoke?: (sessionId: string, events: SessionRunEventRecord[]) => boolean
      __orchestratorSetActiveSessionForSmoke?: (sessionId: string) => boolean
    }
    globals.__orchestratorAppendSessionEventsForSmoke = (sessionId, events) => {
      appendEvents(sessionId, events)
      applyBrowserManagerRunEvents(sessionId, events)
      return true
    }
    globals.__orchestratorSetActiveSessionForSmoke = (sessionId) => {
      const state = useSessionStore.getState()
      if (!state.sessions.some((session) => session.id === sessionId)) return false
      state.setShowSettings(false)
      state.setShowCapabilities(false)
      state.setActiveSession(sessionId)
      state.setHasUnread(sessionId, false)
      return true
    }
    return () => {
      delete globals.__orchestratorAppendSessionEventsForSmoke
      delete globals.__orchestratorSetActiveSessionForSmoke
    }
  }, [appendEvents])

  const createNewChat = useCallback(async (): Promise<void> => {
    const sessionState = useSessionStore.getState()
    const projectState = useProjectStore.getState()
    const active = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId)
    const targetProject = active
      ? projectState.projects.find((project) => project.id === active.projectId)
      : projectState.projects.at(-1)
    if (!targetProject) return

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
    setThreadFindDomain(domain)
    setThreadFindVisible(true)
    window.requestAnimationFrame(() => {
      threadFindInputRef.current?.focus({ preventScroll: true })
      threadFindInputRef.current?.select()
    })
  }, [])

  const closeThreadFind = useCallback((): void => {
    setThreadFindVisible(false)
    setThreadFindQuery('')
    window.dispatchEvent(new CustomEvent('orchestrator:thread-find-close', {
      detail: { sessionId: useSessionStore.getState().activeSessionId }
    }))
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
    setShowSettings(true)
  }, [setSettingsSection, setShowCapabilities, setShowSettings])

  const handleSidebarNewChat = useCallback((): void => {
    void createNewChat()
  }, [createNewChat])

  const openSidebarSearch = useCallback((): void => {
    setCommandPaletteOpen(true)
  }, [])

  const openSidebarPlugins = useCallback((): void => {
    setShowSettings(false)
    setShowCapabilities(true)
  }, [setShowCapabilities, setShowSettings])

  const openSidebarAutomations = useCallback((): void => {
    openSettings('automations')
  }, [openSettings])

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
      const sideChatId = sideChatIdFromTabId(activeTabId)
      exitFullscreenForPanelTab('right', activeTabId)
      if (sideChatId) {
        closeSideChat(activeSessionId, sideChatId)
      } else {
        closeRightPanelTab(activeSessionId, activeTabId)
      }
      return
    }
    if (closeTarget === 'bottom-panel') {
      const terminalPanel = ui?.terminalPanel
      if (!ui?.showTerminal || terminalPanel?.activeTabId === undefined) return
      exitFullscreenForPanelTab('bottom', terminalPanel.activeTabId)
      window.api.terminal.kill(`${activeSessionId}-${terminalPanel.activeTabId}`)
      closeTerminalTab(activeSessionId, terminalPanel.activeTabId)
    }
  }, [])

  const updateShellFocusArea = useCallback((target: EventTarget | null): void => {
    const next = shellFocusAreaFromTarget(target)
    if (shellFocusAreaRef.current === next) return
    shellFocusAreaRef.current = next
    setShellFocusArea(next)
  }, [])

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
        state.setActiveSession(sessionId)
        state.setHasUnread(sessionId, false)
      })
      return true
    }

    const navigateToSettings = (section: SettingsSection, hostId: string | null): void => {
      flushSync(() => {
        setSettingsSection(section)
        setSettingsHostId(hostId ?? 'local')
        setShowCapabilities(false)
        setShowSettings(true)
      })
      pushRouteUrl(settingsRouteUrl(section, hostId))
    }

    Promise.all([window.api.projects.list(), window.api.sessions.listSummaries()]).then(
      async ([projects, sessions]) => {
        const pendingNavigation = await window.api.app.consumePendingNavigation()
        setProjects(projects)

        if (projects.length === 0) {
          setSessions(sessions)
          return
        }

        // Most recent project = the one containing the latest session (by any session)
        let targetProject = projects[projects.length - 1]
        const allSorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt)
        if (allSorted.length > 0) {
          const found = projects.find((p) => p.id === allSorted[0].projectId)
          if (found) targetProject = found
        }

        // Separate empty sessions (safe to clean up) from live ones
        const { uiState } = useSessionStore.getState()
        const emptySessions = sessions.filter((s) => s.messageCount === 0 && s.status !== 'running' && !hasComposerDraft(uiState[s.id]))
        const liveSessions = sessions.filter((s) => s.messageCount > 0 || s.status === 'running' || hasComposerDraft(uiState[s.id]))

        // Keep one empty session in the target project to reuse; delete all others
        const reuseCandidate = emptySessions
          .filter((s) => s.projectId === targetProject.id)
          .sort((a, b) => b.createdAt - a.createdAt)[0]

        const toDelete = emptySessions.filter((s) => s.id !== reuseCandidate?.id)
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

        if (pendingNavigation?.kind === 'settings') {
          navigateToSettings(pendingNavigation.section as SettingsSection, pendingNavigation.hostId)
        } else if (pendingNavigation?.kind === 'session' && cleanSessions.some((session) => session.id === pendingNavigation.sessionId)) {
          setShowSettings(false)
          setShowCapabilities(false)
          setActiveSession(pendingNavigation.sessionId)
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
        upsertMessage(event.id, event.message)
      } else if (event.type === 'events') {
        appendEvents(event.id, event.events)
        applyBrowserManagerRunEvents(event.id, event.events)
      } else if (event.type === 'raw') {
        appendRaw(event.id, event.data)
      } else if (event.type === 'renamed') {
        updateName(event.id, event.name)
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
        const archived = useSessionStore.getState().sessions.find((s) => s.id === event.id)
        if (archived) removeSessionFromProject(archived.projectId, archived.id)
        useSessionStore.getState().removeSession(event.id)
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
        if (command === 'search-transcript' && !canRunPanelFind()) return
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
    activeSessionUi,
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
    window.api.sessions.getTranscriptPage(activeSessionId, { limit: 40 }).then((page) => {
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
      <Sidebar
        onNewChat={handleSidebarNewChat}
        onSearch={openSidebarSearch}
        onOpenPlugins={openSidebarPlugins}
        onOpenAutomations={openSidebarAutomations}
        isCollapsed={leftSidebarCollapsed}
        onToggleSidebar={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
      />
      <section className="content-shell main-surface flex-1 flex flex-col min-w-0 min-h-0">
        {showSettings ? (
          <MotionView viewKey={`settings:${settingsSection}`} className="flex flex-col overflow-hidden">
            <SettingsPage
              section={settingsSection}
              onClose={() => setShowSettings(false)}
            />
          </MotionView>
        ) : showCapabilities ? (
          <MotionView viewKey="capabilities" className="flex flex-col overflow-hidden">
            <CapabilitiesPage />
          </MotionView>
        ) : (
          <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {deferredActiveSessionId ? (
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
        <label className="sr-only" htmlFor="content-search-input">Find in chat</label>
        <input
          id="content-search-input"
          ref={inputRef}
          type="text"
          value={query}
          aria-label="Find in chat"
          placeholder={domain === 'diff' ? 'Search diff...' : 'Search chat...'}
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
        {countLabel && <span className="thread-find-result-count">{countLabel}</span>}
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

function shellFocusAreaFromTarget(target: EventTarget | null): ShellFocusArea {
  if (!(target instanceof HTMLElement)) return 'main'
  const focusArea = target.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area')
  return focusArea === 'right-panel' || focusArea === 'bottom-panel' ? focusArea : 'main'
}
