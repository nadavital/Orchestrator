import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProjectStore } from './store/projects'
import { useSessionStore } from './store/sessions'
import Sidebar from './components/Sidebar/Sidebar'
import SessionPane from './components/Session/SessionPane'
import Titlebar from './components/Titlebar'
import SettingsPage from './components/SettingsModal'
import CapabilitiesPage from './components/CapabilitiesPage'
import DesignSystemPreview from './components/DesignSystemPreview'
import CommandPalette, { type CommandPaletteAction } from './components/CommandPalette'
import { MotionView, TextInputDialog } from './components/shared/designSystem'
import { applyAppearance, type Appearance } from './theme'
import { markRendererStart, recordRendererMetric } from './performance'
import type { AppMenuCommand } from './env'

export default function App(): JSX.Element {
  const isDesignSystemPreview = window.location.hash === '#design-system'
  const { setProjects, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const {
    sessions,
    setSessions,
    addSession,
    mergeTranscriptPage,
    updateStatus,
    updateName,
    updatePinned,
    updateSession,
    updateSettings,
    appendMessages,
    upsertMessage,
    appendEvents,
    appendRaw,
    setShowTerminal,
    setActiveSession,
    setHasUnread,
    setProviderAvailability,
    setProviderModels,
    setShowSettings,
    setShowCapabilities,
    setSettingsSection,
    showSettings,
    showCapabilities,
    settingsSection,
    activeSessionId
  } = useSessionStore()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [renamingActiveChat, setRenamingActiveChat] = useState(false)
  const activeSession = sessions.find((session) => session.id === activeSessionId)

  const createNewChat = useCallback(async (): Promise<void> => {
    const sessionState = useSessionStore.getState()
    const projectState = useProjectStore.getState()
    const active = sessionState.sessions.find((session) => session.id === sessionState.activeSessionId)
    const targetProject = active
      ? projectState.projects.find((project) => project.id === active.projectId)
      : projectState.projects.at(-1)
    if (!targetProject) return

    if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running') {
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

  const openSettings = useCallback((section: 'general' | 'providers' | 'shortcuts' | 'pets' = 'general'): void => {
    setSettingsSection(section)
    setShowCapabilities(false)
    setShowSettings(true)
  }, [setSettingsSection, setShowCapabilities, setShowSettings])

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

  const commandSymbol = useMemo(() => navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl', [])
  const chatSlotActions = useMemo<CommandPaletteAction[]>(() => (
    Array.from({ length: Math.min(9, sessions.length) }, (_, index) => ({
      id: `go-chat-${index + 1}`,
      label: `Go to Chat ${index + 1}`,
      group: 'Navigation',
      description: 'Jump to a recent chat from the sidebar order.',
      shortcut: `${commandSymbol}${index + 1}`,
      keywords: ['thread', 'session', 'recent'],
      run: () => switchChatSlot(index + 1)
    }))
  ), [commandSymbol, sessions.length, switchChatSlot])

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(() => [
    {
      id: 'new-chat',
      label: 'New Chat',
      group: 'Chat',
      description: 'Start a fresh chat in the current project.',
      shortcut: `${commandSymbol}N`,
      keywords: ['thread', 'session'],
      run: () => { void createNewChat() }
    },
    {
      id: 'rename-chat',
      label: 'Rename Chat',
      group: 'Chat',
      description: 'Rename the active sidebar thread.',
      shortcut: `${commandSymbol}⌥R`,
      disabled: !activeSessionId,
      keywords: ['thread', 'session', 'title'],
      run: () => setRenamingActiveChat(true)
    },
    {
      id: 'toggle-chat-pin',
      label: activeSession?.pinned ? 'Unpin Chat' : 'Pin Chat',
      group: 'Chat',
      description: activeSession?.pinned ? 'Remove this chat from the pinned list.' : 'Keep this chat at the top of the sidebar.',
      shortcut: `${commandSymbol}⌥P`,
      disabled: !activeSessionId,
      keywords: ['thread', 'session', 'favorite'],
      run: () => { void toggleActiveChatPin() }
    },
    {
      id: 'search-transcript',
      label: 'Search Transcript',
      group: 'Navigation',
      description: 'Open search for the active chat.',
      shortcut: `${commandSymbol}F`,
      disabled: !activeSessionId,
      keywords: ['find', 'history'],
      run: openTranscriptSearch
    },
    {
      id: 'previous-chat',
      label: 'Previous Chat',
      group: 'Navigation',
      description: 'Switch to the previous recent chat.',
      shortcuts: [`${commandSymbol}⇧[`, '⌃⇧Tab'],
      disabled: sessions.length < 2,
      run: () => switchChat(-1)
    },
    {
      id: 'next-chat',
      label: 'Next Chat',
      group: 'Navigation',
      description: 'Switch to the next recent chat.',
      shortcuts: [`${commandSymbol}⇧]`, '⌃Tab'],
      disabled: sessions.length < 2,
      run: () => switchChat(1)
    },
    ...chatSlotActions,
    {
      id: 'toggle-inspector',
      label: 'Toggle Inspector',
      group: 'Panels',
      description: 'Show or hide Diff, Agents, Plan, and related detail.',
      shortcut: `${commandSymbol}B`,
      disabled: !activeSessionId,
      keywords: ['sidebar', 'diff', 'agents'],
      run: toggleInspector
    },
    {
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      group: 'Panels',
      description: 'Show or hide the terminal pane.',
      shortcut: `${commandSymbol}J`,
      disabled: !activeSessionId,
      run: toggleTerminal
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
      label: 'Keyboard Shortcuts',
      group: 'App',
      description: 'Open the shortcuts reference in Settings.',
      shortcut: `${commandSymbol}⇧/`,
      keywords: ['settings', 'keybindings'],
      run: () => openSettings('shortcuts')
    },
    {
      id: 'settings',
      label: 'Open Settings',
      group: 'App',
      description: 'Open app settings.',
      shortcut: `${commandSymbol},`,
      run: () => openSettings('general')
    }
  ], [
    activeSession?.pinned,
    activeSessionId,
    chatSlotActions,
    commandSymbol,
    createNewChat,
    openSettings,
    openTranscriptSearch,
    sessions.length,
    switchChat,
    toggleActiveChatPin,
    toggleInspector,
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
        openTranscriptSearch()
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
      case 'toggle-terminal':
        toggleTerminal()
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
    openSettings,
    openTranscriptSearch,
    switchChat,
    switchChatSlot,
    toggleActiveChatPin,
    toggleInspector,
    toggleTerminal
  ])

  useEffect(() => {
    const bootStartedAt = markRendererStart()
    window.api.app.getProfile().then((profile) => {
      document.documentElement.dataset.reducedMotion = profile.forceReducedMotion ? 'true' : 'false'
    })
    window.api.sessions.checkProviders().then(setProviderAvailability)
    window.api.settings.get().then((s) => {
      applyAppearance(
        s.appearance ?? 'mist',
        s.accent ?? 'blue',
        s.density ?? 'comfortable',
        s.sidebarTint ?? true,
        s.transcriptStyle ?? 'relaxed',
        s.customAccent ?? '#0a7cff',
        s.interfaceScale ?? 1,
        s.uiFont ?? 'system',
        s.monoFont ?? 'system'
      )
      const pm = (s as unknown as Record<string, unknown>).providerModels
      if (pm && typeof pm === 'object') setProviderModels(pm as Record<string, string[]>)
    })

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
        s.monoFont ?? 'system'
      ))
    }
    media.addEventListener('change', onSystemThemeChanged)

    Promise.all([window.api.projects.list(), window.api.sessions.listSummaries()]).then(
      async ([projects, sessions]) => {
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
        const emptySessions = sessions.filter((s) => s.messageCount === 0 && s.status !== 'running')
        const liveSessions = sessions.filter((s) => s.messageCount > 0 || s.status === 'running')

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

        if (reuseCandidate) {
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

    const unsubNav = window.api.pet.onNavigate((sessionId) => {
      setActiveSession(sessionId)
    })

    const unsub = window.api.onSessionEvent((event) => {
      if (event.type === 'created') {
        addSession(event.session)
      } else if (event.type === 'status') {
        updateStatus(event.id, event.status)
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
      } else if (event.type === 'raw') {
        appendRaw(event.id, event.data)
      } else if (event.type === 'renamed') {
        updateName(event.id, event.name)
      } else if (event.type === 'pinned') {
        updatePinned(event.id, event.pinned)
      } else if (event.type === 'updated') {
        updateSession(event.id, { workDir: event.workDir, useWorktree: event.useWorktree })
      } else if (event.type === 'settingsUpdated') {
        const { id, ...patch } = event
        updateSettings(id, patch)
      } else if (event.type === 'needsInput') {
        setShowTerminal(event.id, true)
      }
    })

    return () => { unsub(); unsubNav(); media.removeEventListener('change', onSystemThemeChanged) }
  }, [])

  useEffect(() => {
    if (isDesignSystemPreview) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      const command = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'tab') {
        event.preventDefault()
        switchChat(event.shiftKey ? -1 : 1)
        return
      }

      if (!command) return

      if (event.altKey) {
        if (key === 'r' && !event.shiftKey) {
          event.preventDefault()
          if (useSessionStore.getState().activeSessionId) setRenamingActiveChat(true)
          return
        }
        if (key === 'p' && !event.shiftKey) {
          event.preventDefault()
          void toggleActiveChatPin()
        }
        return
      }

      if ((key === 'k' && !event.shiftKey) || (key === 'p' && event.shiftKey)) {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        void createNewChat()
        return
      }
      if (event.shiftKey && event.code === 'BracketLeft') {
        event.preventDefault()
        switchChat(-1)
        return
      }
      if (event.shiftKey && event.code === 'BracketRight') {
        event.preventDefault()
        switchChat(1)
        return
      }
      if (key === 'b' && !event.shiftKey) {
        event.preventDefault()
        toggleInspector()
        return
      }
      if (event.code === 'Backquote' && !event.shiftKey) {
        event.preventDefault()
        toggleTerminal()
        return
      }
      if (key === 'j' && !event.shiftKey) {
        event.preventDefault()
        toggleTerminal()
        return
      }
      if (key === ',' && !event.shiftKey) {
        event.preventDefault()
        openSettings('general')
        return
      }
      if (event.shiftKey && event.code === 'Slash') {
        event.preventDefault()
        openSettings('shortcuts')
        return
      }
      if (!event.shiftKey && /^[1-9]$/.test(key)) {
        event.preventDefault()
        switchChatSlot(Number(key))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    createNewChat,
    isDesignSystemPreview,
    openSettings,
    switchChat,
    switchChatSlot,
    toggleInspector,
    toggleActiveChatPin,
    toggleTerminal
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
    >
      <Sidebar />
      <section className="content-shell flex-1 flex flex-col min-w-0 min-h-0">
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
          <>
            <Titlebar />
            <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {activeSessionId ? (
                <MotionView viewKey="session" animate={false} className="flex flex-col overflow-hidden">
                  <SessionPane />
                </MotionView>
              ) : null}
            </main>
          </>
        )}
      </section>
      {commandPaletteOpen && (
        <CommandPalette
          actions={commandPaletteActions}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {renamingActiveChat && activeSession && (
        <TextInputDialog
          title="Rename chat"
          initialValue={activeSession.name}
          confirmLabel="Rename"
          onCancel={() => setRenamingActiveChat(false)}
          onConfirm={(value) => void renameActiveChat(value)}
        />
      )}
    </div>
  )
}
