import { memo, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSessionStore } from '../store/sessions'
import { useProjectStore } from '../store/projects'
import type { AppProfile } from '../env'
import { PROVIDER_DEFS } from '../types'
import Icon from './shared/Icon'
import SessionActionsMenu from './shared/SessionActionsMenu'
import { ToolbarButton, Tooltip } from './shared/designSystem'

function Titlebar(): JSX.Element {
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const session = useSessionStore(useShallow((state) => {
    const id = state.activeSessionId
    if (!id) return null
    const current = state.sessions.find((candidate) => candidate.id === id)
    if (!current) return null
    return {
      id: current.id,
      projectId: current.projectId,
      name: current.name,
      pinned: current.pinned,
      workDir: current.workDir,
      repoRoot: current.repoRoot,
      providerSessionId: current.providerSessionId,
      provider: current.provider,
      model: current.model,
      status: current.status,
      useWorktree: current.useWorktree
    }
  }))
  const showTerminal = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.showTerminal ?? false : false)
  const showDiff = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.showDiff ?? false : false)
  const showPlan = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.showPlan ?? false : false)
  const showEvents = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.showEvents ?? false : false)
  const showExtensions = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.showExtensions ?? false : false)
  const showSideQuestions = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.showSideQuestions ?? false : false)
  const rightPanelOpen = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.rightPanel?.open ?? false : false)
  const rightPanelHasTabs = useSessionStore((state) => activeSessionId ? (state.uiState[activeSessionId]?.rightPanel?.tabs.length ?? 0) > 0 : false)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const setRightPanelOpen = useSessionStore((state) => state.setRightPanelOpen)
  const openRightPanelTab = useSessionStore((state) => state.openRightPanelTab)
  const closeRightPanel = useSessionStore((state) => state.closeRightPanel)
  const updateStatus = useSessionStore((state) => state.updateStatus)
  const addSession = useSessionStore((state) => state.addSession)
  const transferBrowserWorkbench = useSessionStore((state) => state.transferBrowserWorkbench)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setHasUnread = useSessionStore((state) => state.setHasUnread)
  const sessionUnread = useSessionStore((state) => activeSessionId ? state.uiState[activeSessionId]?.hasUnread ?? false : false)
  const projects = useProjectStore((state) => state.projects)
  const addSessionToProject = useProjectStore((state) => state.addSessionToProject)
  const removeSessionFromProject = useProjectStore((state) => state.removeSessionFromProject)
  const project = session ? projects.find((candidate) => candidate.id === session.projectId) : null
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    const globals = window as typeof window & { __orchestratorTitlebarCommitCount?: number }
    if (typeof globals.__orchestratorTitlebarCommitCount === 'number') {
      globals.__orchestratorTitlebarCommitCount += 1
    }
  })

  useEffect(() => {
    window.api.app.getProfile().then(setProfile).catch(() => setProfile(null))
  }, [])

  useEffect(() => {
    if (!session?.workDir) {
      setBranch(null)
      return
    }
    let cancelled = false
    setBranch(null)
    window.api.git.getCurrentBranch(session.workDir)
      .then((nextBranch) => {
        if (!cancelled) setBranch(nextBranch)
      })
      .catch(() => {
        if (!cancelled) setBranch(null)
      })
    return () => {
      cancelled = true
    }
  }, [session?.workDir])

  const inspectorOpen = Boolean(
    rightPanelOpen &&
    (
      rightPanelHasTabs ||
      showDiff ||
      showPlan ||
      showEvents ||
      showExtensions ||
      showSideQuestions
    )
  )
  const toggleInspector = (): void => {
    if (!activeSessionId) return
    if (inspectorOpen) {
      closeRightPanel(activeSessionId)
    } else if (rightPanelHasTabs) {
      setRightPanelOpen(activeSessionId, true)
    } else {
      openRightPanelTab(activeSessionId, 'new-tab')
    }
  }

  const removeActiveSession = async (): Promise<void> => {
    if (!session) return
    await window.api.sessions.archive(session.id)
    await window.api.projects.removeSession(session.projectId, session.id)
    useSessionStore.getState().removeSession(session.id)
    removeSessionFromProject(session.projectId, session.id)
  }

  const provider = session ? PROVIDER_DEFS[session.provider] : null
  const model = session && provider ? provider.models.find((candidate) => candidate.id === session.model) : null
  const branchLabel = session ? branch ?? inferredWorktreeBranch(session) : null
  const folderLabel = session
    ? project
      ? relativePath(project.rootPath, session.workDir)
      : basename(session.workDir)
    : null
  const providerLabel = session
    ? [provider?.name ?? session.provider, model?.label ?? session.model].filter(Boolean).join(' · ')
    : null
  const metadataParts = [
    project?.name ?? 'No project',
    folderLabel,
    branchLabel ? `Branch ${branchLabel}` : null,
    providerLabel
  ].filter(Boolean)
  const metadataLabel = metadataParts.join(' · ')
  const titleTooltipLabel = [session?.name, metadataLabel].filter(Boolean).join(' · ')

  return (
    <div
      data-testid="session-titlebar"
      className="flex items-center shrink-0 w-full"
      style={{
        height: 'var(--app-shell-header-height)',
        background: 'var(--app-shell-header-bg)',
        borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 26%, transparent)',
        userSelect: 'none',
        position: 'relative',
        WebkitAppRegion: 'drag'
      } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2 px-3" style={{ flex: 1 }}>
        {session ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <Tooltip label={titleTooltipLabel}>
                <span
                  data-testid="active-session-title"
                  className="truncate"
                  data-tooltip-label={titleTooltipLabel}
                  data-native-title-free="true"
                  aria-label={titleTooltipLabel}
                  tabIndex={0}
                  style={{ color: 'var(--text-primary)', flexShrink: 0, maxWidth: 260, fontSize: 13, fontWeight: 560, lineHeight: '16px' }}
                >
                  {session.name}
                </span>
              </Tooltip>
              {session.pinned && (
                <Tooltip label="Pinned">
                  <span
                    className="shrink-0"
                    data-testid="session-header-pinned"
                    data-tooltip-label="Pinned"
                    data-native-title-free="true"
                    aria-label="Pinned"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    <Icon name="pin" size={12} />
                  </span>
                </Tooltip>
              )}
              <span
                data-testid="session-header-metadata"
                className="sr-only"
                data-tooltip-label={metadataLabel}
                data-native-title-free="true"
                aria-label={metadataLabel}
                data-session-header-metadata-visibility="tooltip-only"
              >
                {metadataLabel}
              </span>
            </div>
          </>
        ) : (
          <span style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 520 }}>
            Orchestrator
          </span>
        )}
      </div>

      {profile?.isIsolated && (
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag', zIndex: 1 } as React.CSSProperties}
        >
          <Tooltip label={`Profile: ${profile.displayName}`}>
            <span
              className="profile-badge-compact"
              data-testid="profile-badge"
              data-tooltip-label={`Profile: ${profile.displayName}`}
              data-native-title-free="true"
              data-profile-badge-visibility="icon-only"
              tabIndex={0}
              aria-label={`Profile: ${profile.displayName}`}
              style={{
                display: 'inline-flex',
                width: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                border: '1px solid transparent',
                borderRadius: 6,
                background: 'transparent'
              }}
            >
              <Icon name="agents" size={13} />
            </span>
          </Tooltip>
        </div>
      )}

      {/* Right: toggle buttons — no-drag */}
      <div
        data-testid="titlebar-actions"
        data-header-panel-action-style="codex-compact"
        data-header-actions="folder,project,session,provider-session,branch"
        data-header-panel-owner="right-workbench"
        data-header-panel-toggle-label="Toggle side panel"
        data-header-panel-empty-fallback="new-tab"
        className="flex items-center gap-1 px-2"
        style={{ WebkitAppRegion: 'no-drag', zIndex: 1 } as React.CSSProperties}
      >
        {session && (
          <>
            <ToolbarButton
              icon="ellipsis"
              label="Chat actions"
              active={menuPoint !== null}
              ariaExpanded={menuPoint !== null}
              ariaControls="titlebar-chat-actions-menu"
              ariaHasPopup="menu"
              dataTestId="titlebar-chat-actions"
              size="sm"
              variant="toolbar"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMenuPoint({ x: rect.right - 196, y: rect.bottom + 6 })
              }}
            />
            <ToolbarButton
              icon="panelRight"
              label="Toggle side panel"
              active={inspectorOpen}
              ariaExpanded={inspectorOpen}
              ariaControls="orchestrator-workbench-panel"
              dataTestId="titlebar-toggle-sidebar"
              size="sm"
              variant="toolbar"
              onClick={toggleInspector}
            />
            <ToolbarButton
              icon="terminal"
              label="Toggle bottom panel"
              active={showTerminal}
              ariaExpanded={showTerminal}
              ariaControls="orchestrator-terminal-panel"
              dataTestId="titlebar-toggle-terminal"
              size="sm"
              variant="toolbar"
              onClick={() => setShowTerminal(activeSessionId!, !showTerminal)}
            />
          </>
        )}
      </div>
      {session && menuPoint && (
        <SessionActionsMenu
          session={session}
          x={menuPoint.x}
          y={menuPoint.y}
          projectRoot={project?.rootPath}
          branch={branchLabel}
          menuId="titlebar-chat-actions-menu"
          onClose={() => setMenuPoint(null)}
          onRemove={removeActiveSession}
          isUnread={sessionUnread}
          onMarkUnread={(nextUnread) => setHasUnread(session.id, nextUnread)}
          onStop={() => updateStatus(session.id, 'idle')}
          onForked={(forked) => {
            addSession(forked)
            transferBrowserWorkbench(session.id, forked.id)
            addSessionToProject(forked.projectId, forked.id)
            setActiveSession(forked.id)
            setShowSettings(false)
            setShowCapabilities(false)
          }}
        />
      )}
    </div>
  )
}

export default memo(Titlebar)

function relativePath(rootPath: string, workDir: string): string {
  const normalizedRoot = rootPath.replace(/\/+$/, '')
  const normalizedWorkDir = workDir.replace(/\/+$/, '')
  if (normalizedWorkDir === normalizedRoot) return basename(normalizedRoot)
  if (normalizedWorkDir.startsWith(`${normalizedRoot}/`)) return `./${normalizedWorkDir.slice(normalizedRoot.length + 1)}`
  return basename(workDir)
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function inferredWorktreeBranch(session: { id: string; useWorktree?: boolean }): string | null {
  return session.useWorktree ? `orchestrator/${session.id.slice(0, 8)}` : null
}
