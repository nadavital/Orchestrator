import { useEffect, useState } from 'react'
import { useSessionStore } from '../store/sessions'
import type { AppProfile } from '../env'
import Icon from './shared/Icon'

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
    setShowSideQuestions,
    setShowUsage
  } = useSessionStore()
  const session = sessions.find((s) => s.id === activeSessionId)
  const ui = activeSessionId
    ? (uiState[activeSessionId] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showExtensions: false, showSideQuestions: false, showUsage: false, hasUnread: false })
    : null
  const [profile, setProfile] = useState<AppProfile | null>(null)

  useEffect(() => {
    window.api.app.getProfile().then(setProfile).catch(() => setProfile(null))
  }, [])

  const inspectorOpen = Boolean(ui?.showDiff || ui?.showPlan || ui?.showEvents || ui?.showSideQuestions || ui?.showUsage)
  const toggleInspector = (): void => {
    if (!activeSessionId) return
    if (inspectorOpen) {
      setShowDiff(activeSessionId, false)
      setShowPlan(activeSessionId, false)
      setShowEvents(activeSessionId, false)
      setShowExtensions(activeSessionId, false)
      setShowSideQuestions(activeSessionId, false)
      setShowUsage(activeSessionId, false)
    } else {
      setShowDiff(activeSessionId, true)
    }
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
      }}
    >
      <div className="flex min-w-0 items-center gap-2 px-4" style={{ flex: 1 }}>
        {session ? (
          <>
            <span
              className="truncate"
              style={{ color: 'var(--text-primary)', maxWidth: 520, fontSize: 15, fontWeight: 520 }}
              title={session.name}
            >
              {session.name}
            </span>
            <StatusDot status={session.status} />
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
            <TitleBtn
              active={inspectorOpen}
              onClick={toggleInspector}
              title="Toggle sidebar"
            >
              <Icon name="diff" size={14} />
            </TitleBtn>
            <TitleBtn
              active={ui.showTerminal}
              onClick={() => setShowTerminal(activeSessionId!, !ui.showTerminal)}
              title="Toggle terminal"
            >
              <Icon name="terminal" size={14} />
            </TitleBtn>
          </>
        )}
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }): JSX.Element {
  const isRunning = status === 'running'
  const isWaiting = status.startsWith('waiting_') || status === 'reconnecting'
  const isError = status.endsWith('_error') || status === 'error'
  return (
    <span className="flex items-center gap-1">
      <span
        className="rounded-full shrink-0"
        style={{
          width: 6,
          height: 6,
          background: isRunning
            ? 'var(--color-green)'
            : isWaiting
              ? 'var(--color-yellow)'
              : isError
                ? 'var(--color-red)'
                : 'var(--color-text-muted)',
          opacity: isRunning || isWaiting || isError ? 1 : 0.4,
          animation: isRunning ? 'statusPulse 1.5s ease-in-out infinite' : 'none',
          display: 'inline-block'
        }}
      />
      {(isWaiting || isError) && (
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          {statusLabel(status)}
        </span>
      )}
    </span>
  )
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

function TitleBtn({
  children, active, onClick, title
}: {
  children: React.ReactNode; active: boolean; onClick: () => void; title: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 text-xs transition-colors"
      style={{
        width: 30,
        height: 30,
        justifyContent: 'center',
        background: active ? 'var(--control-bg-active)' : 'var(--control-bg)',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        padding: 0,
        fontWeight: 600
      }}
    >
      {children}
    </button>
  )
}
