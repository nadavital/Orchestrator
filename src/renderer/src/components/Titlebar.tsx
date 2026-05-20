import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/sessions'
import { useProjectStore } from '../store/projects'
import type { AppProfile } from '../env'
import { PROVIDER_DEFS } from '../types'
import Icon from './shared/Icon'
import SessionActionsMenu from './shared/SessionActionsMenu'
import { ToolbarButton, Tooltip } from './shared/designSystem'

export default function Titlebar(): JSX.Element {
  const {
    sessions,
    activeSessionId,
    uiState,
    setShowTerminal,
    setShowDiff,
    closeRightPanel
  } = useSessionStore()
  const { projects, removeSessionFromProject } = useProjectStore()
  const session = sessions.find((s) => s.id === activeSessionId)
  const project = session ? projects.find((candidate) => candidate.id === session.projectId) : null
  const ui = activeSessionId
    ? (uiState[activeSessionId] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showExtensions: false, showSideQuestions: false, hasUnread: false })
    : null
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [branch, setBranch] = useState<string | null>(null)

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
    ui?.rightPanel?.open ||
    ui?.showDiff ||
    ui?.showPlan ||
    ui?.showEvents ||
    ui?.showExtensions ||
    ui?.showSideQuestions
  )
  const toggleInspector = (): void => {
    if (!activeSessionId) return
    if (inspectorOpen) {
      closeRightPanel(activeSessionId)
    } else {
      setShowDiff(activeSessionId, true)
    }
  }

  const removeActiveSession = async (): Promise<void> => {
    if (!session) return
    await window.api.sessions.remove(session.id)
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

  return (
    <div
      className="flex items-center shrink-0 w-full"
      style={{
        height: 50,
        background: 'var(--surface-bg)',
        borderBottom: '1px solid var(--border-subtle)',
        userSelect: 'none',
        position: 'relative',
        WebkitAppRegion: 'drag'
      } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2 px-4" style={{ flex: 1 }}>
        {session ? (
          <>
            <div className="flex min-w-0 flex-col">
              <div className="flex min-w-0 items-center gap-1.5">
                <Tooltip label={session.name}>
                  <span
                    data-testid="active-session-title"
                    className="truncate"
                    data-tooltip-label={session.name}
                    data-native-title-free="true"
                    aria-label={session.name}
                    style={{ color: 'var(--text-primary)', maxWidth: 520, fontSize: 14, fontWeight: 540, lineHeight: '18px' }}
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
              </div>
              <Tooltip label={metadataParts.join(' · ')}>
                <div
                  data-testid="session-header-metadata"
                  className="flex min-w-0 items-center gap-1 truncate text-[11px]"
                  data-tooltip-label={metadataParts.join(' · ')}
                  data-native-title-free="true"
                  aria-label={metadataParts.join(' · ')}
                  style={{ color: 'var(--text-tertiary)', lineHeight: '14px', maxWidth: 680 }}
                >
                  {metadataParts.map((part, index) => (
                    <span
                      key={`${part}-${index}`}
                      data-testid={String(part).startsWith('Branch ') ? 'session-header-branch' : undefined}
                      className="truncate"
                      style={{ minWidth: index === 0 ? 0 : undefined }}
                    >
                      {index > 0 && <span aria-hidden="true">· </span>}
                      {part}
                    </span>
                  ))}
                </div>
              </Tooltip>
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
              className="text-xs font-medium rounded-md px-2 py-0.5"
              data-testid="profile-badge"
              data-tooltip-label={`Profile: ${profile.displayName}`}
              data-native-title-free="true"
              style={{
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--control-bg)'
              }}
            >
              {profile.displayName} profile
            </span>
          </Tooltip>
        </div>
      )}

      {/* Right: toggle buttons — no-drag */}
      <div
        data-testid="titlebar-actions"
        data-header-actions="folder,project,session,provider-session,branch"
        className="flex items-center gap-2 px-3"
        style={{ WebkitAppRegion: 'no-drag', zIndex: 1 } as React.CSSProperties}
      >
        {session && ui && (
          <>
            <ToolbarButton
              icon="ellipsis"
              label="Chat actions"
              active={menuPoint !== null}
              dataTestId="titlebar-chat-actions"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMenuPoint({ x: rect.right - 196, y: rect.bottom + 6 })
              }}
            />
            <ToolbarButton
              icon="panelRight"
              label="Toggle sidebar"
              active={inspectorOpen}
              dataTestId="titlebar-toggle-sidebar"
              onClick={toggleInspector}
            />
            <ToolbarButton
              icon="terminal"
              label="Toggle terminal"
              active={ui.showTerminal}
              onClick={() => setShowTerminal(activeSessionId!, !ui.showTerminal)}
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
          onClose={() => setMenuPoint(null)}
          onRemove={removeActiveSession}
        />
      )}
    </div>
  )
}

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
