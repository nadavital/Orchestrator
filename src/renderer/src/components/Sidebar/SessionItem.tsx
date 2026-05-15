import type { Session } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import Icon from '../shared/Icon'
import SessionActionsMenu from '../shared/SessionActionsMenu'
import { IconButton, SurfaceRow } from '../shared/designSystem'
import { memo, useMemo, useState } from 'react'

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

function SessionItem({ session }: Props): JSX.Element {
  const isActive = useSessionStore((state) => state.activeSessionId === session.id)
  const unread = useSessionStore((state) => state.uiState[session.id]?.hasUnread ?? false)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const removeSession = useSessionStore((state) => state.removeSession)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const { removeSessionFromProject } = useProjectStore()
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const hasUnread = !isActive && unread
  const preview = useMemo(() => {
    if (session.previewText) return compactPreview(session.previewText, session.name, session.status)
    const lastMessage = session.messages.findLast((m) => m.type === 'text' && m.role !== 'system')
    return lastMessage && lastMessage.type === 'text'
      ? compactPreview(lastMessage.content, session.name, session.status)
      : ''
  }, [session.messages, session.name, session.previewText, session.status])

  const cleanupSessionIfEmpty = async (sessionId: string | null): Promise<void> => {
    const { sessions, removeSession } = useSessionStore.getState()
    if (!sessionId || sessionId === session.id) return
    const active = sessions.find((s) => s.id === sessionId)
    if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running') {
      await window.api.sessions.remove(active.id)
      await window.api.projects.removeSession(active.projectId, active.id)
      removeSession(active.id)
      removeSessionFromProject(active.projectId, active.id)
    }
  }

  const handleClick = async (): Promise<void> => {
    const previousActiveId = useSessionStore.getState().activeSessionId
    const perfWindow = window as typeof window & {
      __orchestratorSessionSwitchPerf?: {
        sessionId: string
        startedAt: number
        messageCount: number
        renderedMessages?: number
        transcriptReadyAt?: number
        transcriptReadyMs?: number
      }
      __orchestratorSessionSwitchLastPerf?: unknown
    }
    perfWindow.__orchestratorSessionSwitchPerf = {
      sessionId: session.id,
      startedAt: performance.now(),
      messageCount: session.messageCount ?? session.messages.length
    }
    setActiveSession(session.id)
    setShowCapabilities(false)
    setShowSettings(false)
    void cleanupSessionIfEmpty(previousActiveId)
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
      <SurfaceRow
        className="group flex items-start gap-2 cursor-pointer select-none"
        active={isActive}
        style={{
          borderRadius: 'var(--radius-md)',
          padding: '5px 7px 5px 28px'
        }}
        onClick={handleClick}
        onContextMenu={openMenu}
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
        <span className="surface-row-secondary shrink-0 mt-0.5">
          <IconButton
            icon="ellipsis"
            label="Chat actions"
            size="sm"
            tooltip={false}
            onClick={openMenu}
            style={{ color: 'var(--text-tertiary)' }}
          />
        </span>
      </SurfaceRow>
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

export default memo(SessionItem)
