import { useSessionStore } from '../store/sessions'

export default function Titlebar(): JSX.Element {
  const { sessions, activeSessionId, uiState, setShowDiff, setShowEvents, setShowTerminal, setShowSkills } = useSessionStore()
  const session = sessions.find((s) => s.id === activeSessionId)
  const ui = activeSessionId ? (uiState[activeSessionId] ?? { showDiff: false, showEvents: false, showTerminal: false, showSkills: false }) : null

  return (
    <div
      className="flex items-center shrink-0 w-full"
      style={{
        height: 38,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
        userSelect: 'none',
        position: 'relative'
      }}
    >
      {/* Traffic light zone — drag, 80px left */}
      <div
        style={{ width: 80, flexShrink: 0, height: '100%', WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Center — absolutely positioned so it spans the full width for true centering */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          pointerEvents: 'none',
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        {session ? (
          <>
            <span
              className="text-xs font-medium truncate"
              style={{ color: 'var(--color-text-muted)', maxWidth: 280 }}
              title={session.name}
            >
              {session.name}
            </span>
            <StatusDot status={session.status} />
          </>
        ) : (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Orchestrator
          </span>
        )}
      </div>

      {/* Spacer so buttons push to right */}
      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Right: toggle buttons — no-drag */}
      <div
        className="flex items-center gap-1 pr-3"
        style={{ WebkitAppRegion: 'no-drag', zIndex: 1 } as React.CSSProperties}
      >
        {session && ui && (
          <>
            <TitleBtn
              active={ui.showSkills}
              onClick={() => setShowSkills(activeSessionId!, !ui.showSkills)}
              title="Toggle skills and provider instructions"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z" />
              </svg>
              Skills
            </TitleBtn>
            <TitleBtn
              active={ui.showEvents}
              onClick={() => setShowEvents(activeSessionId!, !ui.showEvents)}
              title="Toggle agent activity and provider events"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5.25 3.5a2.25 2.25 0 1 1 3.307 1.986 3.754 3.754 0 0 1 2.943 3.66.75.75 0 0 1-1.5 0 2.25 2.25 0 0 0-4.5 0 .75.75 0 0 1-1.5 0 3.754 3.754 0 0 1 2.943-3.66A2.245 2.245 0 0 1 5.25 3.5ZM7.5 2.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm5.5 6a1.75 1.75 0 1 0-1.267 2.933 2.75 2.75 0 0 0-1.983 2.64.75.75 0 0 0 1.5 0 1.25 1.25 0 0 1 2.5 0 .75.75 0 0 0 1.5 0 2.75 2.75 0 0 0-1.983-2.64A1.75 1.75 0 0 0 13 8.75Zm-10 0a1.75 1.75 0 1 0-1.267 2.933 2.75 2.75 0 0 0-1.983 2.64.75.75 0 0 0 1.5 0 1.25 1.25 0 0 1 2.5 0 .75.75 0 0 0 1.5 0 2.75 2.75 0 0 0-1.983-2.64A1.75 1.75 0 0 0 3 8.75Z" />
              </svg>
              Activity
            </TitleBtn>
            <TitleBtn
              active={ui.showDiff}
              onClick={() => setShowDiff(activeSessionId!, !ui.showDiff)}
              title="Toggle diff panel"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8.75 1.75a.75.75 0 0 0-1.5 0V7H1.75a.75.75 0 0 0 0 1.5H7.25v5.25a.75.75 0 0 0 1.5 0V8.5h5.25a.75.75 0 0 0 0-1.5H8.75V1.75Z" />
              </svg>
              Diff
            </TitleBtn>
            <TitleBtn
              active={ui.showTerminal}
              onClick={() => setShowTerminal(activeSessionId!, !ui.showTerminal)}
              title="Toggle terminal"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM4.28 5.22a.75.75 0 0 0-1.06 1.06L5.44 8.5 3.22 10.72a.75.75 0 1 0 1.06 1.06l2.75-2.75a.75.75 0 0 0 0-1.06Zm3.47 5.28a.75.75 0 0 1 0-1.5h3a.75.75 0 0 1 0 1.5Z" />
              </svg>
              Terminal
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
      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
      style={{
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        border: active ? '1px solid var(--color-accent)' : '1px solid transparent'
      }}
    >
      {children}
    </button>
  )
}
