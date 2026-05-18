import type { Session } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import Icon from '../shared/Icon'
import SessionActionsMenu from '../shared/SessionActionsMenu'
import { IconButton, SurfaceRow, TextInputDialog } from '../shared/designSystem'
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

const errorStatuses = new Set<Session['status']>([
  'auth_error',
  'model_error',
  'quota_error',
  'rate_limit_error',
  'provider_error',
  'error'
])

function SessionItem({ session }: Props): JSX.Element {
  const isActive = useSessionStore((state) => state.activeSessionId === session.id)
  const unread = useSessionStore((state) => state.uiState[session.id]?.hasUnread ?? false)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const removeSession = useSessionStore((state) => state.removeSession)
  const updatePinned = useSessionStore((state) => state.updatePinned)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const { removeSessionFromProject } = useProjectStore()
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const hasUnread = !isActive && unread
  const hasError = errorStatuses.has(session.status)
  const isRunning = session.status === 'running' || session.status === 'reconnecting'
  const hasUncheckedCompletion = hasUnread && session.status === 'idle'
  const showStatusIndicator = isRunning || hasUncheckedCompletion || hasError
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

  const rename = async (nextName: string): Promise<void> => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === session.name) {
      setRenaming(false)
      return
    }
    await window.api.sessions.updateName(session.id, trimmed)
    setRenaming(false)
  }

  const togglePinned = async (event: React.MouseEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    const nextPinned = !session.pinned
    updatePinned(session.id, nextPinned)
    try {
      await window.api.sessions.updatePinned(session.id, nextPinned)
    } catch (error) {
      updatePinned(session.id, Boolean(session.pinned))
      console.error('Failed to update pinned chat', error)
    }
  }

  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenuPoint({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
      <SurfaceRow
        dataTestId="session-row"
        className="group flex items-start gap-2 cursor-pointer select-none"
        active={isActive}
        style={{
          borderRadius: 'var(--radius-md)',
          padding: '5px 7px'
        }}
        onClick={handleClick}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          setRenaming(true)
        }}
        onContextMenu={openMenu}
      >
        <div className="session-item-pin-slot mt-0.5 shrink-0">
          <button
            type="button"
            className="session-item-pin-button"
            data-testid="session-pin-toggle"
            title={session.pinned ? 'Unpin chat' : 'Pin chat'}
            aria-label={session.pinned ? 'Unpin chat' : 'Pin chat'}
            data-pinned={session.pinned ? 'true' : 'false'}
            onClick={(event) => void togglePinned(event)}
          >
            <Icon name="pin" size={12} />
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
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
        {showStatusIndicator && (
          isRunning ? (
            <span
              className="session-item-running-spinner mt-1.5 shrink-0"
              data-testid="session-status-spinner"
              title="Running"
              aria-label="Running"
            />
          ) : (
            <span
              className="session-item-status-dot mt-2 shrink-0 rounded-full"
              data-testid="session-status-dot"
              title={hasError ? 'Needs attention' : 'Unread updates'}
              style={{
                background: hasError ? statusColor[session.status] : 'var(--color-accent)',
                boxShadow: hasError
                  ? '0 0 4px var(--color-red)'
                  : '0 0 4px var(--color-accent)'
              }}
            />
          )
        )}
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
      {renaming && (
        <TextInputDialog
          title="Rename chat"
          initialValue={session.name}
          confirmLabel="Rename"
          onCancel={() => setRenaming(false)}
          onConfirm={(value) => void rename(value)}
        />
      )}
    </>
  )
}

function compactPreview(content: string, name: string, status: Session['status']): string {
  if (status === 'waiting_for_permission') return 'Waiting for approval'
  if (status === 'waiting_for_user') return 'Waiting for answer'

  const compact = content.replace(/\s+/g, ' ').trim()
  if (!compact || compact === name) return ''
  return compact.length > 44 ? `${compact.slice(0, 41)}...` : compact
}

export default memo(SessionItem)
