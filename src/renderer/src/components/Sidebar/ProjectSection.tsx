import { useState } from 'react'
import type { Project, Session } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import SessionItem from './SessionItem'
import Icon from '../shared/Icon'
import { ConfirmDialog, IconButton, SurfaceRow } from '../shared/designSystem'

interface Props {
  project: Project
  sessions: Session[]
}

export default function ProjectSection({ project, sessions }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const { removeProject, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const removeSession = useSessionStore((state) => state.removeSession)
  const addSession = useSessionStore((state) => state.addSession)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const handleNewSession = async (): Promise<void> => {
    if (creating) return
    setCreating(true)

    // Clean up the currently active session if it has no messages
    const { activeSessionId, sessions: allSessions, removeSession } = useSessionStore.getState()
    if (activeSessionId) {
      const active = allSessions.find((s) => s.id === activeSessionId)
      if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running') {
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
      setShowCapabilities(false)
      setShowSettings(false)
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
    <div style={{ marginBottom: 8 }}>
      {/* Project header */}
      <SurfaceRow
        className="group flex items-center gap-2 cursor-pointer select-none"
        style={{
          padding: '5px 7px',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)',
        }}
        onClick={() => setCollapsed((c) => !c)}
        onContextMenu={(e) => {
          e.preventDefault()
          setConfirmingRemoval(true)
        }}
      >
        <span className="motion-chevron shrink-0" style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          <Icon name="chevronDown" size={12} />
        </span>
        <Icon name="folder" size={14} />
        <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {project.name}
        </span>
        <span className="surface-row-secondary">
          <IconButton
            icon={creating ? 'refresh' : 'plus'}
            label={creating ? 'Creating chat' : 'New chat'}
            disabled={creating}
            size="sm"
            tooltip={false}
            onClick={(e) => { e.stopPropagation(); void handleNewSession() }}
          />
        </span>
      </SurfaceRow>

      {/* Sessions */}
      {!collapsed && (
        <div className="space-y-px">
          {sessions.length === 0 && (
            <div
              className="cursor-pointer"
              style={{ color: 'var(--text-secondary)', padding: '5px 8px 5px 29px', fontSize: 13 }}
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
      {confirmingRemoval && (
        <ConfirmDialog
          title={`Remove project "${project.name}"?`}
          description="This removes the project and its chats from Orchestrator."
          confirmLabel="Remove"
          onCancel={() => setConfirmingRemoval(false)}
          onConfirm={() => {
            setConfirmingRemoval(false)
            void handleRemoveProject()
          }}
        />
      )}
    </div>
  )
}
