import type { Session } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import Icon from '../shared/Icon'
import SessionActionsMenu from '../shared/SessionActionsMenu'
import { useState } from 'react'

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
  const {
    sessions,
    activeSessionId,
    uiState,
    setActiveSession,
    removeSession,
    setShowCapabilities,
    setShowSettings
  } = useSessionStore()
  const { removeSessionFromProject } = useProjectStore()
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
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
    setShowCapabilities(false)
    setShowSettings(false)
  }

  const handleRemove = async (): Promise<void> => {
    await window.api.sessions.remove(session.id)
    await window.api.projects.removeSession(session.projectId, session.id)
    removeSession(session.id)
    removeSessionFromProject(session.projectId, session.id)
  }

  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenuPoint({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
      <div
        className="group flex items-start gap-2 cursor-pointer select-none"
        style={{
          background: isActive ? 'var(--control-bg)' : 'transparent',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-md)',
          padding: '5px 7px 5px 28px'
        }}
        onClick={handleClick}
        onContextMenu={openMenu}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--control-bg-hover)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent'
        }}
      >
        <div className="mt-1.5 shrink-0 flex items-center justify-center" style={{ width: 11 }}>
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
          <div className="flex items-center gap-1.5 min-w-0">
            {session.pinned && (
              <span className="shrink-0" style={{ color: 'var(--text-tertiary)' }} title="Pinned">
                <Icon name="pin" size={11} />
              </span>
            )}
            <div className="text-[13px] font-medium truncate leading-5" style={{ color: 'var(--text-primary)' }}>
              {session.name}
            </div>
          </div>
          {preview && (
            <div className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
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
          onClick={openMenu}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
          style={{ color: 'var(--text-tertiary)' }}
          title="Chat actions"
        >
          <Icon name="ellipsis" size={14} />
        </button>
      </div>
      {menuPoint && (
        <SessionActionsMenu
          session={session}
          x={menuPoint.x}
          y={menuPoint.y}
          onClose={() => setMenuPoint(null)}
          onRemove={handleRemove}
        />
      )}
    </>
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
