import { useState } from 'react'
import type { MouseEvent } from 'react'
import type { Project, Session } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import SessionItem from './SessionItem'
import Icon from '../shared/Icon'
import { ConfirmDialog, IconButton, MenuItem, MenuSurface, SurfaceRow, TextInputDialog } from '../shared/designSystem'

interface Props {
  project: Project
  sessions: Session[]
}

export default function ProjectSection({ project, sessions }: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const { removeProject, updateProjectName, updateProjectPinned, addSessionToProject, removeSessionFromProject } = useProjectStore()
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
    for (const s of projectSessions()) {
      await window.api.sessions.remove(s.id)
      removeSession(s.id)
    }
    await window.api.projects.remove(project.id)
    removeProject(project.id)
  }

  const handleArchiveChats = async (): Promise<void> => {
    for (const s of projectSessions()) {
      await window.api.sessions.remove(s.id)
      removeSession(s.id)
      removeSessionFromProject(project.id, s.id)
    }
  }

  const renameProject = async (nextName: string): Promise<void> => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === project.name) {
      setRenaming(false)
      return
    }
    updateProjectName(project.id, trimmed)
    try {
      await window.api.projects.updateName(project.id, trimmed)
    } catch (error) {
      updateProjectName(project.id, project.name)
      console.error('Failed to rename project', error)
    } finally {
      setRenaming(false)
    }
  }

  const togglePinnedProject = async (): Promise<void> => {
    const nextPinned = !project.pinned
    updateProjectPinned(project.id, nextPinned)
    setMenuPoint(null)
    try {
      await window.api.projects.updatePinned(project.id, nextPinned)
    } catch (error) {
      updateProjectPinned(project.id, Boolean(project.pinned))
      console.error('Failed to pin project', error)
    }
  }

  const projectSessions = (): Session[] => (
    useSessionStore.getState().sessions.filter((session) => session.projectId === project.id)
  )

  const openProjectMenu = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setMenuPoint({ x: rect.right - 214, y: rect.bottom + 6 })
  }

  const visibleSessions = expanded ? sessions : sessions.slice(0, 6)
  const hiddenSessionCount = Math.max(0, sessions.length - visibleSessions.length)

  return (
    <div className="min-w-0" style={{ marginBottom: 4 }}>
      {/* Project header */}
      <SurfaceRow
        dataTestId="project-section-header"
        className="group flex min-w-0 items-center gap-2 cursor-pointer select-none"
        style={{
          padding: '3px 6px',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)',
        }}
        onClick={() => setCollapsed((c) => !c)}
        onContextMenu={(e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setMenuPoint({ x: e.clientX || rect.right - 214, y: e.clientY || rect.bottom + 6 })
        }}
      >
        <span className="motion-chevron shrink-0" style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          <Icon name="chevronDown" size={12} />
        </span>
        <span className="shrink-0">
          <Icon name="folder" size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {project.name}
        </span>
        {project.pinned && (
          <span className="shrink-0" style={{ color: 'var(--text-tertiary)' }} title="Pinned project">
            <Icon name="pin" size={11} />
          </span>
        )}
        <span className="surface-row-secondary">
          <IconButton
            icon="ellipsis"
            label="Project actions"
            size="sm"
            onClick={openProjectMenu}
          />
          <IconButton
            icon={creating ? 'refresh' : 'plus'}
            label={creating ? 'Creating chat' : 'New chat'}
            disabled={creating}
            size="sm"
            onClick={(e) => { e.stopPropagation(); void handleNewSession() }}
          />
        </span>
      </SurfaceRow>

      {/* Sessions */}
      {!collapsed && (
        <div>
          {sessions.length === 0 && (
            <div
              className="cursor-pointer"
              style={{ color: 'var(--text-secondary)', padding: '4px 8px 4px 28px', fontSize: 12.5 }}
              onClick={handleNewSession}
            >
              New chat
            </div>
          )}
          {visibleSessions.map((session) => (
            <SessionItem key={session.id} session={session} />
          ))}
          {hiddenSessionCount > 0 && (
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium"
              style={{ color: 'var(--text-tertiary)' }}
              onClick={() => setExpanded(true)}
            >
              Show {hiddenSessionCount} more
            </button>
          )}
          {expanded && sessions.length > 6 && (
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium"
              style={{ color: 'var(--text-tertiary)' }}
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          )}
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
      {confirmingArchive && (
        <ConfirmDialog
          title={`Archive chats in "${project.name}"?`}
          description="This removes this project's chats from Orchestrator but keeps the project in the sidebar."
          confirmLabel="Archive chats"
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={() => {
            setConfirmingArchive(false)
            void handleArchiveChats()
          }}
        />
      )}
      {renaming && (
        <TextInputDialog
          title="Rename project"
          initialValue={project.name}
          confirmLabel="Rename"
          onCancel={() => setRenaming(false)}
          onConfirm={(value) => void renameProject(value)}
        />
      )}
      {menuPoint && (
        <MenuSurface
          className="fixed p-[5px]"
          onClose={() => setMenuPoint(null)}
          style={{
            left: Math.max(8, Math.min(menuPoint.x, window.innerWidth - 226)),
            top: Math.max(8, Math.min(menuPoint.y, window.innerHeight - 270)),
            width: 214,
            zIndex: 10000
          }}
        >
          <MenuItem
            icon="pencil"
            label="Rename project"
            onClick={() => {
              setMenuPoint(null)
              setRenaming(true)
            }}
          />
          <MenuItem
            icon={project.pinned ? 'check' : 'pin'}
            label={project.pinned ? 'Unpin project' : 'Pin project'}
            onClick={() => void togglePinnedProject()}
          />
          <MenuItem
            icon="folder"
            label="Open folder"
            onClick={() => {
              setMenuPoint(null)
              void window.api.fs.openPath(project.rootPath)
            }}
          />
          <div className="mx-1 my-1 h-px" style={{ background: 'var(--border-subtle)' }} />
          <MenuItem
            icon="eraser"
            label="Archive project chats"
            onClick={() => {
              setMenuPoint(null)
              setConfirmingArchive(true)
            }}
          />
          <MenuItem
            icon="close"
            label="Remove project"
            tone="danger"
            onClick={() => {
              setMenuPoint(null)
              setConfirmingRemoval(true)
            }}
          />
        </MenuSurface>
      )}
    </div>
  )
}
