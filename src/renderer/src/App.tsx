import { useEffect } from 'react'
import { useProjectStore } from './store/projects'
import { useSessionStore } from './store/sessions'
import Sidebar from './components/Sidebar/Sidebar'
import SessionPane from './components/Session/SessionPane'
import Titlebar from './components/Titlebar'
import SettingsPage from './components/SettingsModal'
import { applyAppearance, type Appearance } from './theme'

export default function App(): JSX.Element {
  const { setProjects, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const {
    setSessions,
    addSession,
    updateStatus,
    updateName,
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
    showSettings,
    activeSessionId
  } = useSessionStore()

  useEffect(() => {
    window.api.sessions.checkProviders().then(setProviderAvailability)
    window.api.settings.get().then((s) => {
      applyAppearance(
        s.appearance ?? 'mist',
        s.accent ?? 'blue',
        s.density ?? 'comfortable',
        s.sidebarTint ?? true,
        s.transcriptStyle ?? 'relaxed'
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
        s.transcriptStyle ?? 'relaxed'
      ))
    }
    media.addEventListener('change', onSystemThemeChanged)

    Promise.all([window.api.projects.list(), window.api.sessions.list()]).then(
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
        const emptySessions = sessions.filter((s) => s.messages.length === 0 && s.status !== 'running')
        const liveSessions = sessions.filter((s) => s.messages.length > 0 || s.status === 'running')

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

  if (showSettings) {
    return (
      <div className="app-shell flex flex-1 overflow-hidden">
        <Sidebar />
        <section className="content-shell flex-1 flex flex-col min-w-0 min-h-0">
          <SettingsPage onClose={() => setShowSettings(false)} />
        </section>
      </div>
    )
  }

  return (
    <div
      className="app-shell flex flex-1 overflow-hidden"
    >
      <Sidebar />
      <section className="content-shell flex-1 flex flex-col min-w-0 min-h-0">
        <Titlebar />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {activeSessionId ? <SessionPane /> : null}
        </main>
      </section>
    </div>
  )
}
