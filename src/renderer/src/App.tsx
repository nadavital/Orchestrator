import { useEffect } from 'react'
import { useProjectStore } from './store/projects'
import { useSessionStore } from './store/sessions'
import Sidebar from './components/Sidebar/Sidebar'
import SessionPane from './components/Session/SessionPane'
import Titlebar from './components/Titlebar'
import SettingsPage from './components/SettingsModal'
import CapabilitiesPage from './components/CapabilitiesPage'
import DesignSystemPreview from './components/DesignSystemPreview'
import { MotionView } from './components/shared/designSystem'
import { applyAppearance, type Appearance } from './theme'
import { markRendererStart, recordRendererMetric } from './performance'

export default function App(): JSX.Element {
  const isDesignSystemPreview = window.location.hash === '#design-system'
  const { setProjects, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const {
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
    showSettings,
    showCapabilities,
    settingsSection,
    activeSessionId
  } = useSessionStore()

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

    const createNewChat = async (): Promise<void> => {
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
    }

    const switchChat = (direction: 1 | -1): void => {
      const { sessions, activeSessionId, setActiveSession, setShowCapabilities, setShowSettings } = useSessionStore.getState()
      if (sessions.length < 2) return
      const ordered = [...sessions].sort((a, b) => (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt))
      const currentIndex = Math.max(0, ordered.findIndex((session) => session.id === activeSessionId))
      const nextIndex = (currentIndex + direction + ordered.length) % ordered.length
      setActiveSession(ordered[nextIndex].id)
      setShowCapabilities(false)
      setShowSettings(false)
    }

    const toggleInspector = (): void => {
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
    }

    const toggleTerminal = (): void => {
      const { activeSessionId, uiState, setShowTerminal } = useSessionStore.getState()
      if (!activeSessionId) return
      setShowTerminal(activeSessionId, !(uiState[activeSessionId]?.showTerminal ?? false))
    }

    const togglePet = async (): Promise<void> => {
      const config = await window.api.pet.getConfig() as { isOpen?: boolean }
      await window.api.pet.setOpen(!(config.isOpen ?? true))
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey
      if (!command || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()

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
      if (key === ',' && !event.shiftKey) {
        event.preventDefault()
        setShowCapabilities(false)
        setShowSettings(true)
        return
      }
      if (key === 'p' && event.shiftKey) {
        event.preventDefault()
        void togglePet()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isDesignSystemPreview, setShowCapabilities, setShowSettings])

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
    </div>
  )
}
