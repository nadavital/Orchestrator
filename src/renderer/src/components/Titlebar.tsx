import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/sessions'
import { useProjectStore } from '../store/projects'
import type { AppProfile } from '../env'
import Icon from './shared/Icon'
import SessionActionsMenu from './shared/SessionActionsMenu'
import { StatusBadge, ToolbarButton } from './shared/designSystem'

export default function Titlebar(): JSX.Element {
  const {
    sessions,
    activeSessionId,
    uiState,
    setShowTerminal,
    setShowDiff,
    setShowEvents,
    setShowExtensions,
    setShowPlan,
    setShowSideQuestions
  } = useSessionStore()
  const { removeSessionFromProject } = useProjectStore()
  const session = sessions.find((s) => s.id === activeSessionId)
  const ui = activeSessionId
    ? (uiState[activeSessionId] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showExtensions: false, showSideQuestions: false, hasUnread: false })
    : null
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    window.api.app.getProfile().then(setProfile).catch(() => setProfile(null))
  }, [])

  const inspectorOpen = Boolean(ui?.showDiff || ui?.showPlan || ui?.showEvents || ui?.showSideQuestions)
  const toggleInspector = (): void => {
    if (!activeSessionId) return
    if (inspectorOpen) {
      setShowDiff(activeSessionId, false)
      setShowPlan(activeSessionId, false)
      setShowEvents(activeSessionId, false)
      setShowExtensions(activeSessionId, false)
      setShowSideQuestions(activeSessionId, false)
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

  return (
    <div
      className="flex items-center shrink-0 w-full"
      style={{
        height: 46,
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
            <span
              data-testid="active-session-title"
              className="truncate"
              style={{ color: 'var(--text-primary)', maxWidth: 520, fontSize: 15, fontWeight: 520 }}
              title={session.name}
            >
              {session.name}
            </span>
            <SessionStatusBadge status={session.status} />
            {session.pinned && (
              <span style={{ color: 'var(--text-tertiary)' }} title="Pinned">
                <Icon name="pin" size={13} />
              </span>
            )}
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
          <span
            className="text-xs font-medium rounded-md px-2 py-0.5"
            title={`User data: ${profile.userDataDir}`}
            style={{
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--control-bg)'
            }}
          >
            {profile.displayName} profile
          </span>
        </div>
      )}

      {/* Right: toggle buttons — no-drag */}
      <div
        className="flex items-center gap-2 px-3"
        style={{ WebkitAppRegion: 'no-drag', zIndex: 1 } as React.CSSProperties}
      >
        {session && ui && (
          <>
            <ToolbarButton
              icon="ellipsis"
              label="Chat actions"
              active={menuPoint !== null}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMenuPoint({ x: rect.right - 196, y: rect.bottom + 6 })
              }}
            />
            <ToolbarButton
              icon="diff"
              label="Toggle sidebar"
              active={inspectorOpen}
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
          onClose={() => setMenuPoint(null)}
          onRemove={removeActiveSession}
        />
      )}
    </div>
  )
}

function SessionStatusBadge({ status }: { status: string }): JSX.Element {
  const isRunning = status === 'running'
  const isWaiting = status.startsWith('waiting_') || status === 'reconnecting'
  const isError = status.endsWith('_error') || status === 'error'
  const tone = isError ? 'danger' : isWaiting ? 'warning' : isRunning ? 'success' : 'neutral'
  const label = isRunning ? 'running' : isWaiting || isError ? statusLabel(status) : 'idle'
  return <StatusBadge label={label} tone={tone} pulse={isRunning || isWaiting} />
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    waiting_for_permission: 'waiting for permission',
    waiting_for_user: 'waiting for input',
    reconnecting: 'reconnecting',
    auth_error: 'auth error',
    model_error: 'model error',
    quota_error: 'quota error',
    rate_limit_error: 'rate limited',
    provider_error: 'provider error',
    error: 'error'
  }
  return labels[status] ?? status
}
