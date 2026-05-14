import { useState } from 'react'
import type { Project, Session } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import SessionItem from './SessionItem'

interface Props {
  project: Project
  sessions: Session[]
}

export default function ProjectSection({ project, sessions }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [creating, setCreating] = useState(false)
  const { removeProject, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const { sessions: allSessions, activeSessionId, removeSession, addSession, setActiveSession } = useSessionStore()

  const handleNewSession = async (): Promise<void> => {
    if (creating) return
    setCreating(true)

    // Clean up the currently active session if it has no messages
    if (activeSessionId) {
      const active = allSessions.find((s) => s.id === activeSessionId)
      if (active && active.messages.length === 0 && active.status !== 'running') {
        await window.api.sessions.remove(active.id)
        await window.api.projects.removeSession(active.projectId, active.id)
        removeSession(active.id)
        removeSessionFromProject(active.projectId, active.id)
      }
    }
    try {
      const session = await window.api.sessions.create({
        projectId: project.id,
        workDir: project.rootPath,
        useWorktree: false,
        repoRoot: project.rootPath
      })
      await window.api.projects.addSession(project.id, session.id)
      addSession(session)
      addSessionToProject(project.id, session.id)
      setActiveSession(session.id)
    } finally {
      setCreating(false)
    }
  }

  const handleRemoveProject = async (): Promise<void> => {
    for (const s of sessions) {
      await window.api.sessions.remove(s.id)
      removeSession(s.id)
    }
    await window.api.projects.remove(project.id)
    removeProject(project.id)
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Project header */}
      <div
        className="group flex items-center gap-2 cursor-pointer select-none"
        style={{
          padding: '7px 8px',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)'
        }}
        onClick={() => setCollapsed((c) => !c)}
        onContextMenu={(e) => {
          e.preventDefault()
          if (confirm(`Remove project "${project.name}"?`)) handleRemoveProject()
        }}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
          className="shrink-0 transition-transform"
          style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          <path d="M5 7 L1 3 L9 3 Z" />
        </svg>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
          <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
        </svg>
        <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {project.name}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); handleNewSession() }}
          disabled={creating}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
          style={{ color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)' }}
          title="New chat"
        >
          {creating ? (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5.75.75 0 0 1 1.5 0 8 8 0 1 1-8-8 .75.75 0 0 1 0 1.5Z" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
            </svg>
          )}
        </button>
      </div>

      {/* Sessions */}
      {!collapsed && (
        <div className="space-y-0.5">
          {sessions.length === 0 && (
            <div
              className="cursor-pointer"
              style={{ color: 'var(--text-secondary)', padding: '7px 10px 7px 31px', fontSize: 13 }}
              onClick={handleNewSession}
            >
              New chat
            </div>
          )}
          {sessions.map((session) => (
            <SessionItem key={session.id} session={session} />
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
