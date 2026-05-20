import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../../types'
import { comparePinnedSessions, compareSidebarSessions } from '../../types'
import { useProjectStore } from '../../store/projects'
import { hasComposerDraft, useSessionStore } from '../../store/sessions'
import ProjectSection from './ProjectSection'
import SessionItem from './SessionItem'
import Icon from '../shared/Icon'
import { IconButton, MenuItem, MenuSurface, SurfaceRow } from '../shared/designSystem'

type SidebarViewMode = 'project' | 'recent-projects' | 'chronological'
type SidebarSortMode = 'updated' | 'created'

const SIDEBAR_VIEW_KEY = 'orchestrator.sidebar.viewMode'
const SIDEBAR_SORT_KEY = 'orchestrator.sidebar.sortMode'

export async function pickAndAddProject(addProject: (p: Project) => void): Promise<Project | null> {
  const dir = await window.api.dialog.openDirectory()
  if (!dir) return null
  const name = dir.split('/').pop() ?? dir
  const project = await window.api.projects.add(name, dir)
  addProject(project)
  return project
}

export default function Sidebar(): JSX.Element {
  const { projects, addProject, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const {
    sessions,
    addSession,
    removeSession,
    showSettings,
    showCapabilities,
    settingsSection,
    setSettingsSection,
    setShowCapabilities,
    setShowSettings,
    activeSessionId,
    setActiveSession
  } = useSessionStore()
  const [viewMode, setViewMode] = useState<SidebarViewMode>(() => readSidebarViewMode())
  const [sortMode, setSortMode] = useState<SidebarSortMode>(() => readSidebarSortMode())
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const sortedPinnedSessions = useMemo(() => {
    return [...sessions]
      .filter((session) => session.pinned)
      .sort(comparePinnedSessions)
  }, [sessions])
  const unpinnedSessions = useMemo(() => {
    return [...sessions]
      .filter((session) => !session.pinned)
      .sort((a, b) => compareSidebarSessions(a, b, { sortMode, activeSessionId }))
  }, [activeSessionId, sessions, sortMode])
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>()
    for (const session of sessions) {
      if (session.pinned) continue
      const current = grouped.get(session.projectId)
      if (current) current.push(session)
      else grouped.set(session.projectId, [session])
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => compareSidebarSessions(a, b, { sortMode, activeSessionId }))
    }
    return grouped
  }, [activeSessionId, sessions, sortMode])
  const visibleProjects = useMemo(() => {
    const sorted = viewMode !== 'recent-projects'
      ? [...projects]
      : [...projects].sort((a, b) => {
          const aLatest = projectLatestTimestamp(sessionsByProject.get(a.id) ?? [])
          const bLatest = projectLatestTimestamp(sessionsByProject.get(b.id) ?? [])
          return bLatest - aLatest
        })
    return sorted.sort(compareProjectsByPin)
  }, [projects, sessionsByProject, viewMode])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_VIEW_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_SORT_KEY, sortMode)
  }, [sortMode])

  const handleAddProject = async (): Promise<void> => {
    const project = await pickAndAddProject(addProject)
    if (!project) return

    const { sessions: currentSessions, activeSessionId: currentActiveSessionId, uiState } = useSessionStore.getState()
    const active = currentSessions.find((session) => session.id === currentActiveSessionId)
    if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running' && !hasComposerDraft(uiState[active.id])) {
      await window.api.sessions.remove(active.id)
      await window.api.projects.removeSession(active.projectId, active.id)
      removeSession(active.id)
      removeSessionFromProject(active.projectId, active.id)
    }

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
  }

  return (
    <aside
      className="app-sidebar flex min-w-0 flex-col overflow-hidden shrink-0"
      data-testid="app-sidebar"
      style={{
        width: 264,
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)'
      }}
    >
      <div
        className="shrink-0"
        style={{ height: 64, WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {showSettings ? (
        <>
          <div className="flex items-center justify-between px-3 pb-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
              Settings
            </span>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-0.5">
            <SidebarNavItem
              icon="settings"
              label="General"
              active={settingsSection === 'general'}
              onClick={() => setSettingsSection('general')}
            />
            <SidebarNavItem
              icon="sparkles"
              label="Appearance"
              active={settingsSection === 'appearance'}
              onClick={() => setSettingsSection('appearance')}
            />
            <SidebarNavItem
              icon="agents"
              label="Providers"
              active={settingsSection === 'providers'}
              onClick={() => setSettingsSection('providers')}
            />
            <SidebarNavItem
              icon="keyboard"
              label="Shortcuts"
              active={settingsSection === 'shortcuts'}
              onClick={() => setSettingsSection('shortcuts')}
            />
            <SidebarNavItem
              icon="book"
              label="Pets"
              active={settingsSection === 'pets'}
              onClick={() => setSettingsSection('pets')}
            />
            <SidebarNavItem
              icon="folder"
              label="Data controls"
              active={settingsSection === 'data'}
              onClick={() => setSettingsSection('data')}
            />
          </div>
        </>
      ) : (
        <>
          <div className="min-w-0 px-2.5 pb-2">
            <SidebarNavItem
              icon="plug"
              label="Capabilities"
              active={showCapabilities}
              onClick={() => {
                setShowCapabilities(true)
                setShowSettings(false)
              }}
            />
          </div>

          {sortedPinnedSessions.length > 0 && (
            <div className="sidebar-section min-w-0 px-2.5 pb-2" data-testid="sidebar-pinned-section">
              <div className="sidebar-section-title px-1.5 pb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Pinned
              </div>
              <div className="min-w-0 space-y-1">
                {sortedPinnedSessions.map((session) => (
                  <SessionItem key={session.id} session={session} />
                ))}
              </div>
            </div>
          )}

          <div className="sidebar-section-header flex items-center justify-between px-3 pb-0.5" data-testid="sidebar-projects-header">
            <span className="sidebar-section-title" style={{ color: 'var(--text-secondary)' }}>
              {viewMode === 'chronological' ? 'Recent chats' : 'Projects'}
            </span>
            <div className="sidebar-section-actions relative flex items-center gap-1" data-open={organizeOpen ? 'true' : 'false'}>
              <IconButton
                icon="menu"
                label="Organize sidebar"
                size="sm"
                onClick={() => setOrganizeOpen((open) => !open)}
                active={organizeOpen}
              />
              <IconButton
                icon="plus"
                label="Add project"
                size="sm"
                onClick={() => { void handleAddProject() }}
              />
              {organizeOpen && (
                <MenuSurface
                  className="sidebar-organize-menu"
                  onClose={() => setOrganizeOpen(false)}
                  style={{ position: 'absolute', right: 0, top: 34, width: 230, zIndex: 120 }}
                >
                  <MenuItem
                    icon={viewMode === 'project' ? 'check' : 'folder'}
                    label="By project"
                    onClick={() => { setViewMode('project'); setOrganizeOpen(false) }}
                  />
                  <MenuItem
                    icon={viewMode === 'recent-projects' ? 'check' : 'clock'}
                    label="Recent projects"
                    onClick={() => { setViewMode('recent-projects'); setOrganizeOpen(false) }}
                  />
                  <MenuItem
                    icon={viewMode === 'chronological' ? 'check' : 'chat'}
                    label="Chronological list"
                    onClick={() => { setViewMode('chronological'); setOrganizeOpen(false) }}
                  />
                  <div className="mx-1 my-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                  <MenuItem
                    icon={sortMode === 'updated' ? 'check' : 'clock'}
                    label="Sort by updated"
                    onClick={() => { setSortMode('updated'); setOrganizeOpen(false) }}
                  />
                  <MenuItem
                    icon={sortMode === 'created' ? 'check' : 'clock'}
                    label="Sort by created"
                    onClick={() => { setSortMode('created'); setOrganizeOpen(false) }}
                  />
                </MenuSurface>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1.5">
            {viewMode === 'chronological' ? (
              <div className="min-w-0 space-y-1">
                {unpinnedSessions.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', padding: '5px 8px', fontSize: 13 }}>
                    No recent chats
                  </div>
                )}
                {unpinnedSessions.map((session) => (
                  <SessionItem key={session.id} session={session} />
                ))}
              </div>
            ) : (
              visibleProjects.length === 0 ? (
                <div className="min-w-0 px-1 pt-0.5" data-testid="sidebar-project-empty-state">
                  <SurfaceRow
                    as="button"
                    onClick={() => { void handleAddProject() }}
                    className="flex min-w-0 w-full items-center gap-2 text-left"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontWeight: 600
                    }}
                    ariaLabel="Add project"
                  >
                    <Icon name="plus" size={13} />
                    <span className="min-w-0 flex-1 truncate">Add project</span>
                  </SurfaceRow>
                </div>
              ) : (
                visibleProjects.map((project) => (
                  <ProjectSection
                    key={project.id}
                    project={project}
                    sessions={sessionsByProject.get(project.id) ?? []}
                  />
                ))
              )
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <div
        className="shrink-0 px-2.5 py-2.5"
      >
        <SurfaceRow
          as="button"
          onClick={() => {
            if (showCapabilities) {
              setShowCapabilities(false)
              return
            }
            setShowSettings(!showSettings)
          }}
          dataTestId="sidebar-footer-action"
          className="flex items-center gap-2.5 w-full text-[13px]"
          style={{
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius-md)',
            minHeight: 32,
            padding: '6px 8px',
            textAlign: 'left'
          }}
        >
          <Icon name={showSettings || showCapabilities ? 'chat' : 'settings'} size={15} />
          {showSettings || showCapabilities ? 'Back to chats' : 'Settings'}
        </SurfaceRow>
      </div>
    </aside>
  )
}

function projectLatestTimestamp(sessions: ReturnType<typeof useSessionStore.getState>['sessions']): number {
  if (sessions.length === 0) return 0
  return Math.max(...sessions.map((session) => session.latestMessageAt ?? session.createdAt))
}

function compareProjectsByPin(a: Project, b: Project): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
  return 0
}

function readSidebarViewMode(): SidebarViewMode {
  const value = window.localStorage.getItem(SIDEBAR_VIEW_KEY)
  return value === 'project' || value === 'recent-projects' || value === 'chronological' ? value : 'project'
}

function readSidebarSortMode(): SidebarSortMode {
  const value = window.localStorage.getItem(SIDEBAR_SORT_KEY)
  return value === 'updated' || value === 'created' ? value : 'updated'
}

function SidebarNavItem({
  icon,
  label,
  detail,
  active,
  onClick
}: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  detail?: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <SurfaceRow
      as="button"
      onClick={onClick}
      active={active}
      dataTestId="sidebar-nav-item"
      className="flex min-w-0 items-center gap-2 w-full text-[13px]"
      style={{
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-md)',
        minHeight: 30,
        padding: '5px 8px',
        fontWeight: active ? 500 : 400,
        textAlign: 'left'
      }}
    >
      <Icon name={icon} size={14} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="shrink-0 truncate text-xs" style={{ maxWidth: 92, color: 'var(--text-tertiary)' }}>
          {detail}
        </span>
      )}
    </SurfaceRow>
  )
}
