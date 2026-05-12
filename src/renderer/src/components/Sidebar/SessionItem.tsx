import type { Session } from '../../types'
import { PROVIDER_DEFS } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import ProviderIcon from '../shared/ProviderIcon'

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
      className="group flex items-start gap-2 pl-6 pr-2 py-1.5 cursor-pointer select-none"
      style={{
        background: isActive ? 'var(--color-surface2)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--color-accent)' : '2px solid transparent'
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = 'var(--color-surface2)'
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Provider icon + status dot */}
      <div className="mt-0.5 shrink-0 flex flex-col items-center gap-0.5">
        <ProviderIcon
          providerId={session.provider ?? 'claude'}
          size={12}
          color={session.status === 'idle' ? undefined : PROVIDER_DEFS[session.provider ?? 'claude']?.color}
        />
        <div
          className="rounded-full"
          style={{
            width: 4,
            height: 4,
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
        <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
          {session.name}
        </div>
        {preview && (
          <div className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {preview}
          </div>
        )}
        {/* Only show worktree badge — local is the default and doesn't need labelling */}
        {session.useWorktree && (
          <span
            className="text-xs px-1 rounded mt-0.5 inline-block"
            style={{ background: 'var(--color-accent-dim)', color: 'var(--color-accent)', fontSize: 10 }}
          >
            worktree
          </span>
        )}
      </div>
      <button
        onClick={handleRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
        style={{ color: 'var(--color-text-muted)' }}
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
