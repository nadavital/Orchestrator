import type { Session } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'

interface Props {
  session: Session
}

const statusColor: Record<Session['status'], string> = {
  idle: 'var(--color-text-muted)',
  running: 'var(--color-green)',
  waiting_for_permission: 'var(--color-yellow)',
  waiting_for_user: 'var(--color-yellow)',
  reconnecting: 'var(--color-yellow)',
  auth_error: 'var(--color-red)',
  model_error: 'var(--color-red)',
  quota_error: 'var(--color-red)',
  rate_limit_error: 'var(--color-red)',
  provider_error: 'var(--color-red)',
  error: 'var(--color-red)'
}

export default function SessionItem({ session }: Props): JSX.Element {
  const { sessions, activeSessionId, uiState, setActiveSession, removeSession } = useSessionStore()
  const { removeSessionFromProject } = useProjectStore()
  const isActive = activeSessionId === session.id
  const hasUnread = !isActive && (uiState[session.id]?.hasUnread ?? false)

  const lastMessage = session.messages.findLast((m) => m.type === 'text' && m.role !== 'system')
  const preview = lastMessage && lastMessage.type === 'text'
    ? compactPreview(lastMessage.content, session.name, session.status)
    : ''

  const cleanupActiveIfEmpty = async (): Promise<void> => {
    if (!activeSessionId || activeSessionId === session.id) return
    const active = sessions.find((s) => s.id === activeSessionId)
    if (active && active.messages.length === 0 && active.status !== 'running') {
      await window.api.sessions.remove(active.id)
      await window.api.projects.removeSession(active.projectId, active.id)
      removeSession(active.id)
      removeSessionFromProject(active.projectId, active.id)
    }
  }

  const handleClick = async (): Promise<void> => {
    await cleanupActiveIfEmpty()
    setActiveSession(session.id)
  }

  const handleRemove = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    await window.api.sessions.remove(session.id)
    await window.api.projects.removeSession(session.projectId, session.id)
    removeSession(session.id)
    removeSessionFromProject(session.projectId, session.id)
  }

  return (
    <div
      className="group flex items-start gap-2 cursor-pointer select-none"
      style={{
        background: isActive ? 'var(--control-bg)' : 'transparent',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        padding: '7px 8px 7px 30px'
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = 'var(--control-bg-hover)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent'
      }}
    >
      <div className="mt-2 shrink-0 flex items-center justify-center" style={{ width: 12 }}>
        <div
          className="rounded-full"
          style={{
            width: 5,
            height: 5,
            background: hasUnread ? 'var(--color-accent)' : statusColor[session.status],
            opacity: session.status === 'idle' && !hasUnread ? 0.4 : 1,
            boxShadow: session.status === 'running'
              ? '0 0 4px var(--color-green)'
              : hasUnread
                ? '0 0 4px var(--color-accent)'
                : 'none'
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {session.name}
        </div>
        {preview && (
          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {preview}
          </div>
        )}
        {/* Only show worktree badge — local is the default and doesn't need labelling */}
        {session.useWorktree && (
          <span
            className="text-xs px-1.5 py-0.5 mt-1 inline-block"
            style={{ background: 'var(--color-accent-dim)', color: 'var(--color-accent)', fontSize: 10, borderRadius: 'var(--radius-pill)' }}
          >
            worktree
          </span>
        )}
      </div>
      <button
        onClick={handleRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
        style={{ color: 'var(--text-tertiary)' }}
        title="Remove session"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
  )
}

function compactPreview(content: string, name: string, status: Session['status']): string {
  if (status === 'running') return 'Running...'
  if (status === 'waiting_for_permission') return 'Waiting for approval'
  if (status === 'waiting_for_user') return 'Waiting for answer'

  const compact = content.replace(/\s+/g, ' ').trim()
  if (!compact || compact === name) return ''
  return compact.length > 44 ? `${compact.slice(0, 41)}...` : compact
}
