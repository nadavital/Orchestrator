import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { Project, Session } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSidebarStore } from '../../store/sidebar'
import { hasComposerDraft, useSessionStore } from '../../store/sessions'
import SessionItem from './SessionItem'
import Icon from '../shared/Icon'
import { ConfirmDialog, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, SidebarListRow, TextInputDialog, Tooltip } from '../shared/designSystem'

interface Props {
  project: Project
  sessions: Session[]
  renderSession?: (session: Session) => ReactNode
}

export default function ProjectSection({ project, sessions, renderSession }: Props): JSX.Element {
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
  const collapsed = useSidebarStore((state) => state.collapsedProjectIds[project.id] === true)
  const toggleProjectCollapsed = useSidebarStore((state) => state.toggleProjectCollapsed)
  const handleNewSession = async (): Promise<void> => {
    if (creating) return
    setCreating(true)

    // Clean up the currently active session if it has no messages
    const { activeSessionId, sessions: allSessions, removeSession, uiState } = useSessionStore.getState()
    if (activeSessionId) {
      const active = allSessions.find((s) => s.id === activeSessionId)
      if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running' && !hasComposerDraft(uiState[active.id])) {
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
      await window.api.sessions.archive(s.id)
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
    <div className="min-w-0" style={{ marginBottom: 6 }}>
      {/* Project header */}
      <SidebarListRow
        as="div"
        dataTestId="project-section-header"
        className="group project-section-row cursor-pointer select-none"
        size="section"
        onClick={() => toggleProjectCollapsed(project.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setMenuPoint({ x: e.clientX || rect.right - 214, y: e.clientY || rect.bottom + 6 })
        }}
        leading={(
          <>
            <span className="motion-chevron shrink-0" style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
              <Icon name="chevronDown" size={12} />
            </span>
            <span className="shrink-0">
              <Icon name="folder" size={13} />
            </span>
          </>
        )}
        label={project.name}
        trailing={(
          <>
            {project.pinned && (
              <Tooltip label="Pinned project">
                <span
                  className="shrink-0"
                  data-native-title-free="true"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <Icon name="pin" size={11} />
                </span>
              </Tooltip>
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
          </>
        )}
      />

      {/* Sessions */}
      {!collapsed && (
        <div className="space-y-1">
          {sessions.length === 0 && (
            <div className="pl-5 pr-1 py-px">
              <SidebarListRow
                dataTestId="project-empty-new-chat"
                size="compact"
                icon="plus"
                label="New chat"
                ariaLabel="New chat"
                onClick={handleNewSession}
              />
            </div>
          )}
          {visibleSessions.map((session) => (
            renderSession ? renderSession(session) : <SessionItem key={session.id} session={session} />
          ))}
          {hiddenSessionCount > 0 && (
            <SidebarListRow
              dataTestId="project-show-more-row"
              size="compact"
              className="project-disclosure-row"
              label={`Show ${hiddenSessionCount} more`}
              onClick={() => setExpanded(true)}
            />
          )}
          {expanded && sessions.length > 6 && (
            <SidebarListRow
              dataTestId="project-show-less-row"
              size="compact"
              className="project-disclosure-row"
              label="Show less"
              onClick={() => setExpanded(false)}
            />
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
          className="project-section-menu fixed p-[5px]"
          onClose={() => setMenuPoint(null)}
          style={{
            left: Math.max(8, Math.min(menuPoint.x, window.innerWidth - 226)),
            top: Math.max(8, Math.min(menuPoint.y, window.innerHeight - 270)),
            width: 214,
            zIndex: 10000
          }}
        >
          <MenuSection dataTestId="project-section-menu-main">
            <MenuSectionLabel>Project</MenuSectionLabel>
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
          </MenuSection>
          <MenuSection dataTestId="project-section-menu-danger">
            <MenuSectionLabel>Manage</MenuSectionLabel>
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
          </MenuSection>
        </MenuSurface>
      )}
    </div>
  )
}
