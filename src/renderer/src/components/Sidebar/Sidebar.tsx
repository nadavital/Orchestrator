import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../../types'
import { comparePinnedSessions } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import ProjectSection from './ProjectSection'
import SessionItem from './SessionItem'
import Icon from '../shared/Icon'
import { IconButton, MenuItem, MenuSurface, SurfaceRow } from '../shared/designSystem'

type SidebarViewMode = 'project' | 'recent-projects' | 'chronological'
type SidebarSortMode = 'updated' | 'created'

const SIDEBAR_VIEW_KEY = 'orchestrator.sidebar.viewMode'
const SIDEBAR_SORT_KEY = 'orchestrator.sidebar.sortMode'

export async function pickAndAddProject(addProject: (p: Project) => void): Promise<void> {
  const dir = await window.api.dialog.openDirectory()
  if (!dir) return
  const name = dir.split('/').pop() ?? dir
  const project = await window.api.projects.add(name, dir)
  addProject(project)
}

export default function Sidebar(): JSX.Element {
  const { projects, addProject } = useProjectStore()
  const {
    sessions,
    showSettings,
    showCapabilities,
    settingsSection,
    setSettingsSection,
    setShowCapabilities,
    setShowSettings
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
      .sort((a, b) => compareSessionsByMode(a, b, sortMode))
  }, [sessions, sortMode])
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>()
    for (const session of sessions) {
      if (session.pinned) continue
      const current = grouped.get(session.projectId)
      if (current) current.push(session)
      else grouped.set(session.projectId, [session])
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => compareSessionsByMode(a, b, sortMode))
    }
    return grouped
  }, [sessions, sortMode])
  const visibleProjects = useMemo(() => {
    if (viewMode !== 'recent-projects') return projects
    return [...projects].sort((a, b) => {
      const aLatest = projectLatestTimestamp(sessionsByProject.get(a.id) ?? [])
      const bLatest = projectLatestTimestamp(sessionsByProject.get(b.id) ?? [])
      return bLatest - aLatest
    })
  }, [projects, sessionsByProject, viewMode])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_VIEW_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_SORT_KEY, sortMode)
  }, [sortMode])

  const handleAddProject = (): void => {
    pickAndAddProject(addProject)
  }

  return (
    <aside
      className="flex flex-col overflow-hidden shrink-0"
      style={{
        width: 282,
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
          <div className="flex items-center justify-between px-4 pb-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
              Settings
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2.5 py-1">
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
              label="Providers & models"
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
          </div>
        </>
      ) : (
        <>
          <div className="px-2.5 pb-3">
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
            <div className="px-2.5 pb-3">
              <div className="px-1.5 pb-1 text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                Pinned
              </div>
              <div className="space-y-px">
                {sortedPinnedSessions.map((session) => (
                  <SessionItem key={session.id} session={session} />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-4 pb-1">
            <span className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
              {viewMode === 'chronological' ? 'Recent chats' : 'Projects'}
            </span>
            <div className="relative flex items-center gap-1">
              <IconButton
                icon="menu"
                label="Organize sidebar"
                onClick={() => setOrganizeOpen((open) => !open)}
                active={organizeOpen}
              />
              <IconButton
                icon="plus"
                label="Add project"
                onClick={handleAddProject}
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

          <div className="flex-1 overflow-y-auto px-2.5 py-1">
            {viewMode === 'chronological' ? (
              <div className="space-y-px">
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
              visibleProjects.map((project) => (
                <ProjectSection
                  key={project.id}
                  project={project}
                  sessions={sessionsByProject.get(project.id) ?? []}
                />
              ))
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
          className="flex items-center gap-3 w-full text-sm"
          style={{
            color: 'var(--text-secondary)',
            borderRadius: 'var(--radius-lg)',
            padding: '8px 10px',
            textAlign: 'left'
          }}
        >
          <Icon name={showSettings || showCapabilities ? 'chat' : 'settings'} size={17} />
          {showSettings || showCapabilities ? 'Back to chats' : 'Settings'}
        </SurfaceRow>
      </div>
    </aside>
  )
}

function compareSessionsByMode(
  a: ReturnType<typeof useSessionStore.getState>['sessions'][number],
  b: ReturnType<typeof useSessionStore.getState>['sessions'][number],
  sortMode: SidebarSortMode
): number {
  if (sortMode === 'created') return b.createdAt - a.createdAt
  return (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt)
}

function projectLatestTimestamp(sessions: ReturnType<typeof useSessionStore.getState>['sessions']): number {
  if (sessions.length === 0) return 0
  return Math.max(...sessions.map((session) => session.latestMessageAt ?? session.createdAt))
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
      className="flex min-w-0 items-center gap-2.5 w-full text-sm"
      style={{
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-lg)',
        padding: '8px 10px',
        fontWeight: active ? 650 : 500,
        textAlign: 'left'
      }}
    >
      <Icon name={icon} size={15} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && (
        <span className="shrink-0 truncate text-xs" style={{ maxWidth: 92, color: 'var(--text-tertiary)' }}>
          {detail}
        </span>
      )}
    </SurfaceRow>
  )
}
