import { Fragment, useEffect, useMemo, useState } from 'react'
import type { DragEvent as ReactDragEvent, ReactNode } from 'react'
import type { Project, Session, SidebarConnectionGroupIdentity } from '../../types'
import { comparePinnedSessions, compareSidebarSessions, isSidebarPinnedSession, isSidebarProjectlessSession, normalizeSettingsHostId, normalizeSettingsSectionForHostKind, settingsHostOptionsFromSessions, settingsNavigationGroupsForHostKind, sidebarConnectionGroupIdentity } from '../../types'
import { useProjectStore } from '../../store/projects'
import type { SidebarCustomSection } from '../../store/sidebar'
import { sidebarSessionSelectedKey, sidebarSettingsSelectedKey, useSidebarStore } from '../../store/sidebar'
import { hasComposerDraft, useSessionStore } from '../../store/sessions'
import ProjectSection from './ProjectSection'
import SessionItem from './SessionItem'
import { IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, SidebarListRow, TextInputDialog } from '../shared/designSystem'
import type { IconName } from '../shared/Icon'
import type { SettingsSection } from '../../store/sessions'

const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  appearance: 'Appearance',
  providers: 'Providers',
  automations: 'Automations',
  worktrees: 'Worktrees',
  shortcuts: 'Shortcuts',
  personalization: 'Personalization',
  pets: 'Pet overlay',
  data: 'Data controls'
}

const SETTINGS_SECTION_ICONS: Record<SettingsSection, IconName> = {
  general: 'settings',
  appearance: 'sparkles',
  providers: 'agents',
  automations: 'clock',
  worktrees: 'branch',
  shortcuts: 'keyboard',
  personalization: 'book',
  pets: 'sparkles',
  data: 'folder'
}

export async function pickAndAddProject(addProject: (p: Project) => void): Promise<Project | null> {
  const dir = await window.api.dialog.openDirectory()
  if (!dir) return null
  const name = dir.split('/').pop() ?? dir
  const project = await window.api.projects.add(name, dir)
  addProject(project)
  return project
}

interface SidebarProps {
  onNewChat: () => void
  onSearch: () => void
  onOpenPlugins: () => void
  onOpenAutomations: () => void
}

export default function Sidebar({
  onNewChat,
  onSearch,
  onOpenPlugins,
  onOpenAutomations
}: SidebarProps): JSX.Element {
  const { projects, addProject, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const {
    sessions,
    addSession,
    removeSession,
    showSettings,
    showCapabilities,
    settingsSection,
    settingsHostId,
    setSettingsSection,
    setSettingsHostId,
    setShowCapabilities,
    setShowSettings,
    activeSessionId,
    setActiveSession,
    reorderPinned
  } = useSessionStore()
  const viewMode = useSidebarStore((state) => state.viewMode)
  const setViewMode = useSidebarStore((state) => state.setViewMode)
  const sortMode = useSidebarStore((state) => state.sortMode)
  const setSortMode = useSidebarStore((state) => state.setSortMode)
  const pinnedSectionCollapsed = useSidebarStore((state) => state.collapsedSections.pinned)
  const projectsSectionCollapsed = useSidebarStore((state) => state.collapsedSections.projects)
  const projectlessChatsCollapsed = useSidebarStore((state) => state.projectlessChatsCollapsed)
  const projectlessChatsFirst = useSidebarStore((state) => state.projectlessChatsFirst)
  const collapsedConnectionGroupIds = useSidebarStore((state) => state.collapsedConnectionGroupIds)
  const customSections = useSidebarStore((state) => state.customSections)
  const sectionOrder = useSidebarStore((state) => state.sectionOrder)
  const selectedSidebarKey = useSidebarStore((state) => state.selectedKey)
  const setSelectedSidebarKey = useSidebarStore((state) => state.setSelectedKey)
  const setSectionOrder = useSidebarStore((state) => state.setSectionOrder)
  const moveSection = useSidebarStore((state) => state.moveSection)
  const createCustomSection = useSidebarStore((state) => state.createCustomSection)
  const removeCustomSection = useSidebarStore((state) => state.removeCustomSection)
  const addSessionToCustomSection = useSidebarStore((state) => state.addSessionToCustomSection)
  const moveSessionToCustomSection = useSidebarStore((state) => state.moveSessionToCustomSection)
  const toggleCustomSectionCollapsed = useSidebarStore((state) => state.toggleCustomSectionCollapsed)
  const toggleSectionCollapsed = useSidebarStore((state) => state.toggleSectionCollapsed)
  const toggleProjectlessChatsCollapsed = useSidebarStore((state) => state.toggleProjectlessChatsCollapsed)
  const toggleProjectlessChatsFirst = useSidebarStore((state) => state.toggleProjectlessChatsFirst)
  const toggleConnectionGroupCollapsed = useSidebarStore((state) => state.toggleConnectionGroupCollapsed)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [creatingCustomSection, setCreatingCustomSection] = useState(false)
  const [customSectionMenuId, setCustomSectionMenuId] = useState<string | null>(null)
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null)
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null)
  const [draggedPinnedSessionId, setDraggedPinnedSessionId] = useState<string | null>(null)
  const [activePinnedDropTarget, setActivePinnedDropTarget] = useState<string | null>(null)
  const [draggedSectionKey, setDraggedSectionKey] = useState<`custom:${string}` | null>(null)
  const [activeSectionDropTarget, setActiveSectionDropTarget] = useState<string | null>(null)
  const settingsHostOptions = useMemo(() => settingsHostOptionsFromSessions(sessions), [sessions])
  const normalizedSettingsHostId = normalizeSettingsHostId(settingsHostId, settingsHostOptions)
  const selectedSettingsHost = settingsHostOptions.find((host) => host.id === normalizedSettingsHostId) ?? settingsHostOptions[0]
  const hasRemoteSettingsHosts = settingsHostOptions.length > 1
  const settingsNavigationGroups = useMemo(() => settingsNavigationGroupsForHostKind(selectedSettingsHost.kind), [selectedSettingsHost.kind])
  const effectiveSettingsSection = normalizeSettingsSectionForHostKind(settingsSection, selectedSettingsHost.kind)
  const customSectionKeys = useMemo(() => customSections.map((section) => `custom:${section.id}` as const), [customSections])
  const customSessionIds = useMemo(() => new Set(customSections.flatMap((section) => section.sessionIds)), [customSections])
  const sessionsById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const projectIdSet = useMemo(() => new Set(projects.map((project) => project.id)), [projects])
  const sortedPinnedSessions = useMemo(() => {
    return [...sessions]
      .filter(isSidebarPinnedSession)
      .sort(comparePinnedSessions)
  }, [sessions])
  const unpinnedSessions = useMemo(() => {
    return [...sessions]
      .filter((session) => !isSidebarPinnedSession(session) && !customSessionIds.has(session.id))
      .sort((a, b) => compareSidebarSessions(a, b, { sortMode, activeSessionId }))
  }, [activeSessionId, customSessionIds, sessions, sortMode])
  const projectlessSessions = useMemo(() => (
    unpinnedSessions.filter((session) => isSidebarProjectlessSession(session, projectIdSet))
  ), [projectIdSet, unpinnedSessions])

  useEffect(() => {
    if (normalizedSettingsHostId === settingsHostId) return
    setSettingsHostId(normalizedSettingsHostId)
    window.api.settings.set('settingsHostId', normalizedSettingsHostId)
  }, [normalizedSettingsHostId, settingsHostId, setSettingsHostId])

  useEffect(() => {
    if (effectiveSettingsSection === settingsSection) return
    setSettingsSection(effectiveSettingsSection)
    if (showSettings) setSelectedSidebarKey(sidebarSettingsSelectedKey(effectiveSettingsSection))
  }, [effectiveSettingsSection, settingsSection, setSelectedSidebarKey, setSettingsSection, showSettings])

  useEffect(() => {
    const currentSessionState = useSessionStore.getState()
    const nextSelectedKey = currentSessionState.showSettings
      ? sidebarSettingsSelectedKey(currentSessionState.settingsSection)
      : currentSessionState.showCapabilities
        ? 'capabilities'
        : currentSessionState.activeSessionId
          ? sidebarSessionSelectedKey(currentSessionState.activeSessionId)
          : null
    setSelectedSidebarKey(nextSelectedKey)
  }, [activeSessionId, setSelectedSidebarKey, settingsSection, showCapabilities, showSettings])

  const saveSettingsHostId = (value: string): void => {
    const normalized = normalizeSettingsHostId(value, settingsHostOptions)
    const nextHost = settingsHostOptions.find((host) => host.id === normalized) ?? settingsHostOptions[0]
    const nextSettingsSection = normalizeSettingsSectionForHostKind(settingsSection, nextHost.kind)
    setSettingsHostId(normalized)
    window.api.settings.set('settingsHostId', normalized)
    if (nextSettingsSection !== settingsSection) {
      setSettingsSection(nextSettingsSection)
      setSelectedSidebarKey(sidebarSettingsSelectedKey(nextSettingsSection))
    }
  }
  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, typeof sessions>()
    for (const session of sessions) {
      if (isSidebarPinnedSession(session)) continue
      if (customSessionIds.has(session.id)) continue
      if (isSidebarProjectlessSession(session, projectIdSet)) continue
      const current = grouped.get(session.projectId)
      if (current) current.push(session)
      else grouped.set(session.projectId, [session])
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => compareSidebarSessions(a, b, { sortMode, activeSessionId }))
    }
    return grouped
  }, [activeSessionId, customSessionIds, projectIdSet, sessions, sortMode])
  const customSectionSessions = useMemo(() => {
    const grouped = new Map<string, typeof sessions>()
    for (const section of customSections) {
      grouped.set(
        section.id,
        section.sessionIds.flatMap((sessionId) => {
          const session = sessionsById.get(sessionId)
          return session && !isSidebarPinnedSession(session) ? [session] : []
        })
      )
    }
    return grouped
  }, [customSections, sessionsById])
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
  const connectionGroups = useMemo(() => {
    const groups = new Map<string, {
      identity: SidebarConnectionGroupIdentity
      sessions: Session[]
    }>()
    for (const session of unpinnedSessions) {
      const identity = sidebarConnectionGroupIdentity(session)
      const current = groups.get(identity.key)
      if (current) {
        current.sessions.push(session)
      } else {
        groups.set(identity.key, { identity, sessions: [session] })
      }
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        sessions: group.sessions.sort((a, b) => compareSidebarSessions(a, b, { sortMode, activeSessionId }))
      }))
      .sort((a, b) => (
        a.identity.order - b.identity.order ||
        a.identity.label.localeCompare(b.identity.label)
      ))
  }, [activeSessionId, sortMode, unpinnedSessions])

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

  const handleCreateCustomSection = (name: string): void => {
    const currentActiveSession = sessionsById.get(activeSessionId ?? '')
    createCustomSection(name, currentActiveSession && !isSidebarPinnedSession(currentActiveSession) ? [currentActiveSession.id] : [])
    setCreatingCustomSection(false)
    setOrganizeOpen(false)
  }

  const sessionIdFromDragEvent = (event: ReactDragEvent<HTMLElement>): string | null => (
    event.dataTransfer.getData('application/x-orchestrator-session-id') ||
    event.dataTransfer.getData('text/plain') ||
    draggedSessionId
  )

  const handleSessionDragStart = (event: ReactDragEvent<HTMLElement>, session: Session): void => {
    if (isSidebarPinnedSession(session)) {
      event.preventDefault()
      return
    }
    event.stopPropagation()
    setDraggedSessionId(session.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-orchestrator-session-id', session.id)
    event.dataTransfer.setData('text/plain', session.id)
  }

  const handlePinnedSessionDragStart = (event: ReactDragEvent<HTMLElement>, session: Session): void => {
    event.stopPropagation()
    setDraggedPinnedSessionId(session.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-orchestrator-pinned-session-id', session.id)
    event.dataTransfer.setData('text/plain', session.id)
  }

  const customDropTargetKey = (sectionId: string, beforeSessionId?: string | null): string => (
    `${sectionId}:${beforeSessionId ?? 'end'}`
  )

  const allowCustomSectionDrop = (event: ReactDragEvent<HTMLElement>): void => {
    if (!draggedSessionId && !event.dataTransfer.types.includes('application/x-orchestrator-session-id')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  const activateCustomDropTarget = (
    event: ReactDragEvent<HTMLElement>,
    sectionId: string,
    beforeSessionId?: string | null
  ): void => {
    allowCustomSectionDrop(event)
    setActiveDropTarget(customDropTargetKey(sectionId, beforeSessionId))
  }

  const handleCustomSectionDrop = (
    event: ReactDragEvent<HTMLElement>,
    sectionId: string,
    beforeSessionId?: string | null
  ): void => {
    const sessionId = sessionIdFromDragEvent(event)
    if (!sessionId) return
    event.preventDefault()
    event.stopPropagation()
    moveSessionToCustomSection(sectionId, sessionId, beforeSessionId)
    setDraggedSessionId(null)
    setActiveDropTarget(null)
  }

  const pinnedDropTargetKey = (beforeSessionId: string): string => `pinned:${beforeSessionId}`

  const pinnedSessionIdFromDragEvent = (event: ReactDragEvent<HTMLElement>): string | null => (
    event.dataTransfer.getData('application/x-orchestrator-pinned-session-id') ||
    draggedPinnedSessionId
  )

  const activatePinnedDropTarget = (event: ReactDragEvent<HTMLElement>, beforeSessionId: string): void => {
    const sessionId = pinnedSessionIdFromDragEvent(event)
    if (!sessionId || sessionId === beforeSessionId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setActivePinnedDropTarget(pinnedDropTargetKey(beforeSessionId))
  }

  const handlePinnedSessionDrop = (event: ReactDragEvent<HTMLElement>, beforeSessionId: string): void => {
    const sessionId = pinnedSessionIdFromDragEvent(event)
    if (!sessionId || sessionId === beforeSessionId) return
    event.preventDefault()
    event.stopPropagation()
    const currentPinnedIds = sortedPinnedSessions.map((session) => session.id)
    const nextOrder = currentPinnedIds.filter((id) => id !== sessionId)
    const insertIndex = nextOrder.indexOf(beforeSessionId)
    nextOrder.splice(insertIndex >= 0 ? insertIndex : nextOrder.length, 0, sessionId)
    reorderPinned(nextOrder)
    void window.api.sessions.reorderPinned(nextOrder)
    setDraggedPinnedSessionId(null)
    setActivePinnedDropTarget(null)
  }

  const sectionDropTargetKey = (sectionKey: string): string => `section:${sectionKey}`

  const handleCustomSectionDragStart = (event: ReactDragEvent<HTMLElement>, sectionId: string): void => {
    const sectionKey = `custom:${sectionId}` as const
    setDraggedSectionKey(sectionKey)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-orchestrator-sidebar-section-key', sectionKey)
  }

  const sectionKeyFromDragEvent = (event: ReactDragEvent<HTMLElement>): `custom:${string}` | null => {
    const key = event.dataTransfer.getData('application/x-orchestrator-sidebar-section-key') || draggedSectionKey
    return key.startsWith('custom:') ? key as `custom:${string}` : null
  }

  const activateSectionDropTarget = (event: ReactDragEvent<HTMLElement>, beforeSectionKey: SidebarSectionKey): void => {
    const sectionKey = sectionKeyFromDragEvent(event)
    if (!sectionKey || sectionKey === beforeSectionKey) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setActiveSectionDropTarget(sectionDropTargetKey(beforeSectionKey))
  }

  const handleSectionDrop = (event: ReactDragEvent<HTMLElement>, beforeSectionKey: SidebarSectionKey): void => {
    const sectionKey = sectionKeyFromDragEvent(event)
    if (!sectionKey || sectionKey === beforeSectionKey) return
    event.preventDefault()
    event.stopPropagation()
    moveSection(sectionKey, beforeSectionKey)
    setDraggedSectionKey(null)
    setActiveSectionDropTarget(null)
  }

  const renderDraggableSession = (
    session: Session,
    dropTarget?: { sectionId: string; beforeSessionId?: string | null }
  ): JSX.Element => {
    const dropTargetKey = dropTarget ? customDropTargetKey(dropTarget.sectionId, dropTarget.beforeSessionId) : null
    return (
      <div
        key={session.id}
        className="sidebar-draggable-session"
        data-testid="sidebar-draggable-session"
        data-sidebar-session-id={session.id}
        data-sidebar-drop-target={dropTargetKey && activeDropTarget === dropTargetKey ? 'before' : undefined}
        draggable={!isSidebarPinnedSession(session)}
        onDragStart={(event) => handleSessionDragStart(event, session)}
        onDragEnd={() => {
          setDraggedSessionId(null)
          setActiveDropTarget(null)
        }}
        onDragOver={dropTarget ? (event) => activateCustomDropTarget(event, dropTarget.sectionId, dropTarget.beforeSessionId) : undefined}
        onDragLeave={dropTarget ? (event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveDropTarget(null)
        } : undefined}
        onDrop={dropTarget ? (event) => handleCustomSectionDrop(event, dropTarget.sectionId, dropTarget.beforeSessionId) : undefined}
      >
        <SessionItem session={session} />
      </div>
    )
  }

  const renderPinnedSection = (): JSX.Element | null => {
    if (sortedPinnedSessions.length === 0) return null
    return (
      <div
        key="pinned"
        className="sidebar-section min-w-0 px-2.5 pb-2"
        data-testid="sidebar-pinned-section"
        data-sidebar-pinned-reorder="local"
      >
        <button
          type="button"
          className="sidebar-section-title-button"
          data-testid="sidebar-pinned-collapse-toggle"
          aria-expanded={!pinnedSectionCollapsed}
          onClick={() => toggleSectionCollapsed('pinned')}
        >
          <span className="motion-chevron" style={{ transform: pinnedSectionCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <IconChevron />
          </span>
          <span>Pinned</span>
        </button>
        {!pinnedSectionCollapsed && (
          <div className="min-w-0 space-y-1" data-testid="sidebar-pinned-session-list">
            {sortedPinnedSessions.map((session) => (
              <div
                key={session.id}
                className="sidebar-draggable-session"
                data-testid="sidebar-pinned-draggable-session"
                data-sidebar-session-id={session.id}
                data-sidebar-pinned-drop-target={activePinnedDropTarget === pinnedDropTargetKey(session.id) ? 'before' : undefined}
                draggable
                onDragStart={(event) => handlePinnedSessionDragStart(event, session)}
                onDragEnd={() => {
                  setDraggedPinnedSessionId(null)
                  setActivePinnedDropTarget(null)
                }}
                onDragOver={(event) => activatePinnedDropTarget(event, session.id)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActivePinnedDropTarget(null)
                }}
                onDrop={(event) => handlePinnedSessionDrop(event, session.id)}
              >
                <SessionItem session={session} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderProjectsSection = (): JSX.Element => (
    <div key="projects" className="sidebar-section min-w-0" data-testid="sidebar-projects-section">
      <div className="sidebar-section-header flex items-center justify-between px-3 pb-0.5" data-testid="sidebar-projects-header">
        <button
          type="button"
          className="sidebar-section-title-button"
          data-testid="sidebar-projects-collapse-toggle"
          aria-expanded={!projectsSectionCollapsed}
          onClick={() => toggleSectionCollapsed('projects')}
        >
          <span className="motion-chevron" style={{ transform: projectsSectionCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <IconChevron />
          </span>
          <span>{viewMode === 'chronological' ? 'Recent chats' : viewMode === 'connections' ? 'Connections' : 'Projects'}</span>
        </button>
        <div className="sidebar-section-actions relative flex items-center gap-1" data-open={organizeOpen ? 'true' : 'false'}>
          <IconButton
            icon="menu"
            label="Organize sidebar"
            size="sm"
            variant="toolbar"
            onClick={() => setOrganizeOpen((open) => !open)}
            active={organizeOpen}
          />
          <IconButton
            icon="plus"
            label="Add project"
            size="sm"
            variant="toolbar"
            onClick={() => { void handleAddProject() }}
          />
          {organizeOpen && (
            <MenuSurface
              className="sidebar-organize-menu"
              onClose={() => setOrganizeOpen(false)}
              style={{ position: 'absolute', right: 0, top: 34, width: 230, zIndex: 120 }}
            >
              <MenuSection dataTestId="sidebar-organize-view-section">
                <MenuSectionLabel>View</MenuSectionLabel>
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
                <MenuItem
                  icon={viewMode === 'connections' ? 'check' : 'plug'}
                  label="By connection"
                  onClick={() => { setViewMode('connections'); setOrganizeOpen(false) }}
                />
              </MenuSection>
              <MenuSection dataTestId="sidebar-organize-sort-section">
                <MenuSectionLabel>Sort</MenuSectionLabel>
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
              </MenuSection>
              <MenuSection dataTestId="sidebar-organize-layout-section">
                <MenuSectionLabel>Layout</MenuSectionLabel>
                <MenuItem
                  icon={sectionOrder[0] === 'pinned' ? 'check' : 'pin'}
                  label="Pinned above projects"
                  onClick={() => { setSectionOrder(['pinned', ...customSectionKeys, 'projects']); setOrganizeOpen(false) }}
                />
                <MenuItem
                  icon={sectionOrder[0] === 'projects' ? 'check' : 'folder'}
                  label="Projects above pinned"
                  onClick={() => { setSectionOrder(['projects', ...customSectionKeys, 'pinned']); setOrganizeOpen(false) }}
                />
                <MenuItem
                  icon={projectlessChatsFirst ? 'check' : 'chat'}
                  label="Chats before projects"
                  onClick={() => { toggleProjectlessChatsFirst(); setOrganizeOpen(false) }}
                />
              </MenuSection>
              <MenuSection dataTestId="sidebar-organize-custom-section">
                <MenuSectionLabel>Sections</MenuSectionLabel>
                <MenuItem
                  icon="plus"
                  label="New custom section"
                  onClick={() => {
                    setCreatingCustomSection(true)
                    setOrganizeOpen(false)
                  }}
                />
              </MenuSection>
            </MenuSurface>
          )}
        </div>
      </div>

      {!projectsSectionCollapsed && <div className="min-w-0 px-2 py-1.5">
        {viewMode === 'chronological' ? (
          <div className="min-w-0 space-y-1">
            {unpinnedSessions.length === 0 && (
              <div style={{ color: 'var(--text-secondary)', padding: '5px 8px', fontSize: 13 }}>
                No recent chats
              </div>
            )}
            {unpinnedSessions.map((session) => (
              renderDraggableSession(session)
            ))}
          </div>
        ) : viewMode === 'connections' ? (
          <div
            className="min-w-0 space-y-1"
            data-testid="sidebar-connection-groups"
            data-sidebar-connection-group-count={connectionGroups.length}
          >
            {connectionGroups.length === 0 && (
              <div style={{ color: 'var(--text-secondary)', padding: '5px 8px', fontSize: 13 }}>
                No chats
              </div>
            )}
            {connectionGroups.map((group) => (
              <SidebarConnectionGroup
                key={group.identity.key}
                identity={group.identity}
                sessions={group.sessions}
                collapsed={collapsedConnectionGroupIds[group.identity.key] === true}
                onToggle={() => toggleConnectionGroupCollapsed(group.identity.key)}
                renderSession={renderDraggableSession}
              />
            ))}
          </div>
        ) : (
          visibleProjects.length === 0 ? (
            <div className="min-w-0 px-1 pt-0.5" data-testid="sidebar-project-empty-state">
              <SidebarListRow
                icon="plus"
                label="Add project"
                onClick={() => { void handleAddProject() }}
                ariaLabel="Add project"
                className="sidebar-list-row-empty"
              />
            </div>
          ) : (
            <div
              className="min-w-0"
              data-testid="sidebar-project-group-list"
              data-sidebar-projectless-chats-first={projectlessChatsFirst ? 'true' : 'false'}
            >
              {visibleProjects.map((project) => (
                <ProjectSection
                  key={project.id}
                  project={project}
                  sessions={sessionsByProject.get(project.id) ?? []}
                  renderSession={renderDraggableSession}
                />
              ))}
            </div>
          )
        )}
      </div>}
    </div>
  )

  const renderProjectlessChatsSection = (): JSX.Element | null => {
    if (viewMode === 'chronological' || viewMode === 'connections' || projectlessSessions.length === 0) return null

    return (
      <SidebarProjectlessChatsGroup
        key="projectless"
        sessions={projectlessSessions}
        collapsed={projectlessChatsCollapsed}
        projectlessChatsFirst={projectlessChatsFirst}
        onToggle={toggleProjectlessChatsCollapsed}
        renderSession={renderDraggableSession}
      />
    )
  }

  const renderCustomSection = (section: SidebarCustomSection): JSX.Element => {
    const sectionSessions = customSectionSessions.get(section.id) ?? []
    const menuOpen = customSectionMenuId === section.id
    const sectionKey = `custom:${section.id}` as const
    const sectionTargetKey = sectionDropTargetKey(sectionKey)
    return (
      <div
        key={sectionKey}
        className="sidebar-section sidebar-custom-section min-w-0 px-2.5 pb-2"
        data-testid="sidebar-custom-section"
        data-sidebar-section-id={section.id}
        data-sidebar-custom-session-count={sectionSessions.length}
        data-sidebar-section-key={sectionKey}
        data-sidebar-section-drop-target={activeSectionDropTarget === sectionTargetKey ? 'before' : undefined}
        draggable
        onDragStart={(event) => handleCustomSectionDragStart(event, section.id)}
        onDragEnd={() => {
          setDraggedSectionKey(null)
          setActiveSectionDropTarget(null)
        }}
        onDragOver={(event) => activateSectionDropTarget(event, sectionKey)}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveSectionDropTarget(null)
        }}
        onDrop={(event) => handleSectionDrop(event, sectionKey)}
      >
        <div
          className="sidebar-section-header relative flex items-center justify-between"
          data-testid="sidebar-custom-section-header"
          data-sidebar-drop-active={activeDropTarget === customDropTargetKey(section.id) ? 'true' : 'false'}
          onDragOver={(event) => activateCustomDropTarget(event, section.id)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveDropTarget(null)
          }}
          onDrop={(event) => handleCustomSectionDrop(event, section.id)}
        >
          <button
            type="button"
            className="sidebar-section-title-button"
            data-testid="sidebar-custom-collapse-toggle"
            aria-expanded={!section.collapsed}
            onClick={() => toggleCustomSectionCollapsed(section.id)}
          >
            <span className="motion-chevron" style={{ transform: section.collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
              <IconChevron />
            </span>
            <span className="sidebar-custom-section-mark" aria-hidden="true">{section.emoji}</span>
            <span>{section.name}</span>
          </button>
          <div className="sidebar-section-actions relative flex items-center gap-1" data-open={menuOpen ? 'true' : 'false'}>
            <IconButton
              icon="ellipsis"
              label={`Custom section actions: ${section.name}`}
              size="sm"
              variant="toolbar"
              active={menuOpen}
              onClick={() => setCustomSectionMenuId((current) => current === section.id ? null : section.id)}
            />
            {menuOpen && (
              <MenuSurface
                className="sidebar-custom-section-menu"
                onClose={() => setCustomSectionMenuId(null)}
                style={{ position: 'absolute', right: 0, top: 28, width: 210, zIndex: 120 }}
              >
                <MenuSection dataTestId="sidebar-custom-section-actions-menu-section">
                  <MenuSectionLabel>Section</MenuSectionLabel>
                  <MenuItem
                    icon="plus"
                    label="Add selected chat"
                    disabled={!activeSessionId}
                    onClick={() => {
                      if (activeSessionId) addSessionToCustomSection(section.id, activeSessionId)
                      setCustomSectionMenuId(null)
                    }}
                  />
                  <MenuItem
                    icon="close"
                    label="Remove section"
                    tone="danger"
                    onClick={() => {
                      removeCustomSection(section.id)
                      setCustomSectionMenuId(null)
                    }}
                  />
                </MenuSection>
              </MenuSurface>
            )}
          </div>
        </div>
        {!section.collapsed && (
          <div
            className="min-w-0 space-y-1"
            data-testid="sidebar-custom-section-sessions"
            onDragOver={allowCustomSectionDrop}
            onDrop={(event) => handleCustomSectionDrop(event, section.id)}
          >
            {sectionSessions.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', padding: '5px 8px', fontSize: 13 }}>
                No chats
              </div>
            ) : (
              sectionSessions.map((session) => (
                renderDraggableSession(session, { sectionId: section.id, beforeSessionId: session.id })
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside
      className="app-sidebar app-shell-left-panel flex min-w-0 flex-col overflow-hidden shrink-0"
      data-testid="app-sidebar"
      data-sidebar-selected-key={selectedSidebarKey ?? ''}
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
          <div className="settings-nav-list min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-0.5">
            {settingsNavigationGroups.map((group) => (
              <div
                key={group.id}
                className="settings-nav-group"
                data-testid={`settings-nav-group-${group.id}`}
                data-settings-nav-group={group.id}
              >
                <div className="settings-nav-group-heading" data-testid="settings-nav-group-heading">
                  <span>{group.label}</span>
                  {group.id === 'host' && hasRemoteSettingsHosts && (
                    <label className="settings-host-selector settings-host-selector--nav" data-testid="settings-host-selector">
                      <span className="settings-host-selector-label">Host</span>
                      <select
                        value={selectedSettingsHost.id}
                        aria-label="Settings host"
                        data-testid="settings-host-select"
                        onChange={(event) => saveSettingsHostId(event.target.value)}
                      >
                        {settingsHostOptions.map((host) => (
                          <option key={host.id} value={host.id}>
                            {host.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="settings-nav-group-rows">
                  {group.sections.map((section) => (
                    <SidebarNavItem
                      key={section}
                      icon={SETTINGS_SECTION_ICONS[section]}
                      label={SETTINGS_SECTION_LABELS[section]}
                      active={effectiveSettingsSection === section}
                      sidebarKey={sidebarSettingsSelectedKey(section)}
                      onClick={() => {
                        setSelectedSidebarKey(sidebarSettingsSelectedKey(section))
                        setSettingsSection(section)
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="min-w-0 px-2.5 pb-2" data-testid="sidebar-primary-actions">
            <SidebarNavItem
              icon="pencil"
              label="New chat"
              active={false}
              dataTestId="sidebar-primary-action-new-chat"
              onClick={onNewChat}
            />
            <SidebarNavItem
              icon="search"
              label="Search"
              active={false}
              dataTestId="sidebar-primary-action-search"
              onClick={onSearch}
            />
            <SidebarNavItem
              icon="extensions"
              label="Plugins"
              active={showCapabilities}
              sidebarKey="capabilities"
              dataTestId="sidebar-primary-action-plugins"
              onClick={() => {
                setSelectedSidebarKey('capabilities')
                onOpenPlugins()
              }}
            />
            <SidebarNavItem
              icon="clock"
              label="Automations"
              active={false}
              sidebarKey={sidebarSettingsSelectedKey('automations')}
              dataTestId="sidebar-primary-action-automations"
              onClick={() => {
                setSelectedSidebarKey(sidebarSettingsSelectedKey('automations'))
                onOpenAutomations()
              }}
            />
          </div>

          <div
            className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
            data-testid="sidebar-chat-scroll"
            data-sidebar-custom-section-count={customSections.length}
            data-sidebar-section-order={sectionOrder.join(',')}
          >
            {sectionOrder.map((section) => {
              if (section === 'pinned') return renderPinnedSection()
              if (section === 'projects') {
                const projectlessSection = renderProjectlessChatsSection()
                return (
                  <Fragment key="projects-and-chats">
                    {projectlessChatsFirst ? projectlessSection : null}
                    {renderProjectsSection()}
                    {projectlessChatsFirst ? null : projectlessSection}
                  </Fragment>
                )
              }
              const customSection = customSections.find((candidate) => `custom:${candidate.id}` === section)
              return customSection ? renderCustomSection(customSection) : null
            })}
          </div>
        </>
      )}

      {/* Footer */}
      <div
        className="shrink-0 px-2.5 py-2.5"
      >
        <SidebarListRow
          onClick={() => {
            if (showCapabilities) {
              setSelectedSidebarKey(activeSessionId ? sidebarSessionSelectedKey(activeSessionId) : null)
              setShowCapabilities(false)
              return
            }
            const nextShowSettings = !showSettings
            setSelectedSidebarKey(nextShowSettings
              ? sidebarSettingsSelectedKey(settingsSection)
              : activeSessionId
                ? sidebarSessionSelectedKey(activeSessionId)
                : null)
            setShowSettings(nextShowSettings)
          }}
          dataTestId="sidebar-footer-action"
          icon={showSettings || showCapabilities ? 'chat' : 'settings'}
          label={showSettings || showCapabilities ? 'Back to chats' : 'Settings'}
          className="sidebar-footer-row"
        />
      </div>
      {creatingCustomSection && (
        <TextInputDialog
          title="New custom section"
          description="The selected chat will move into this section."
          initialValue="Focus"
          confirmLabel="Create"
          onCancel={() => setCreatingCustomSection(false)}
          onConfirm={handleCreateCustomSection}
        />
      )}
    </aside>
  )
}

function IconChevron(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.75 5.75L8 10.25L12.25 5.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

function SidebarConnectionGroup({
  identity,
  sessions,
  collapsed,
  onToggle,
  renderSession
}: {
  identity: SidebarConnectionGroupIdentity
  sessions: Session[]
  collapsed: boolean
  onToggle: () => void
  renderSession?: (session: Session) => ReactNode
}): JSX.Element {
  return (
    <div
      className="sidebar-connection-group min-w-0"
      data-testid="sidebar-connection-group"
      data-sidebar-connection-key={identity.key}
      data-sidebar-connection-kind={identity.kind}
      data-sidebar-connection-thread-kind={identity.threadKind}
      data-sidebar-connection-provider-id={identity.providerId}
      data-sidebar-connection-session-count={sessions.length}
    >
      <SidebarListRow
        as="div"
        dataTestId="sidebar-connection-group-header"
        className="group project-section-row cursor-pointer select-none"
        size="section"
        onClick={onToggle}
        leading={(
          <>
            <span className="motion-chevron shrink-0" style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
              <IconChevron />
            </span>
            <span className="sidebar-connection-kind-mark" aria-hidden="true" data-sidebar-connection-kind={identity.kind} />
          </>
        )}
        label={identity.label}
        detail={`${sessions.length}`}
      />
      {!collapsed && (
        <div className="space-y-1">
          {sessions.map((session) => (
            renderSession ? renderSession(session) : <SessionItem key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarProjectlessChatsGroup({
  sessions,
  collapsed,
  projectlessChatsFirst,
  onToggle,
  renderSession
}: {
  sessions: Session[]
  collapsed: boolean
  projectlessChatsFirst: boolean
  onToggle: () => void
  renderSession?: (session: Session) => ReactNode
}): JSX.Element {
  return (
    <div
      className="sidebar-section sidebar-projectless-chats-group min-w-0 px-2 py-1.5"
      data-testid="sidebar-projectless-chats-section"
      data-sidebar-projectless-session-count={sessions.length}
      data-sidebar-projectless-chats-first={projectlessChatsFirst ? 'true' : 'false'}
    >
      <SidebarListRow
        as="div"
        dataTestId="sidebar-projectless-chats-header"
        className="group project-section-row cursor-pointer select-none"
        size="section"
        onClick={onToggle}
        leading={(
          <>
            <span className="motion-chevron shrink-0" style={{ color: 'var(--text-tertiary)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
              <IconChevron />
            </span>
            <span className="sidebar-projectless-chat-mark" aria-hidden="true" />
          </>
        )}
        label="Chats"
        detail={`${sessions.length}`}
      />
      {!collapsed && (
        <div className="space-y-1">
          {sessions.map((session) => (
            renderSession ? renderSession(session) : <SessionItem key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarNavItem({
  icon,
  label,
  detail,
  active,
  sidebarKey,
  dataTestId = 'sidebar-nav-item',
  onClick
}: {
  icon: IconName
  label: string
  detail?: string
  active: boolean
  sidebarKey?: string
  dataTestId?: string
  onClick: () => void
}): JSX.Element {
  return (
    <SidebarListRow
      onClick={onClick}
      active={active}
      dataTestId={dataTestId}
      dataSidebarKey={sidebarKey}
      icon={icon}
      label={label}
      detail={detail}
    />
  )
}
