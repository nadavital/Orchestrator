import type { Session } from '../../types'
import { PROVIDER_DEFS } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import Icon from '../shared/Icon'
import SessionActionsMenu from '../shared/SessionActionsMenu'
import { announceHoverSurfaceOpen, IconButton, SurfaceRow, Tooltip, useExclusiveHoverSurface } from '../shared/designSystem'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

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
  const rowRef = useRef<HTMLDivElement>(null)
  const hoverSurfaceId = `session-hover-${session.id}`
  const isActive = useSessionStore((state) => state.activeSessionId === session.id)
  const unread = useSessionStore((state) => state.uiState[session.id]?.hasUnread ?? false)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const removeSession = useSessionStore((state) => state.removeSession)
  const updatePinned = useSessionStore((state) => state.updatePinned)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const { projects, removeSessionFromProject } = useProjectStore()
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [detailsVisible, setDetailsVisible] = useState(false)
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number } | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [branchLoadedFor, setBranchLoadedFor] = useState<string | null>(null)
  const hasUnread = !isActive && unread
  const hasError = errorStatuses.has(session.status)
  const isRunning = session.status === 'running' || session.status === 'reconnecting'
  const isWaiting = session.status === 'waiting_for_permission' || session.status === 'waiting_for_user'
  const hasUncheckedCompletion = hasUnread && session.status === 'idle'
  const showStatusIndicator = isRunning || isWaiting || hasUncheckedCompletion || hasError
  const project = projects.find((p) => p.id === session.projectId)
  const provider = PROVIDER_DEFS[session.provider]
  const model = provider?.models.find((candidate) => candidate.id === session.model)
  const statusLabel = statusLabelFor(session.status, hasUnread)
  const environment = session.useWorktree
    ? { label: 'Worktree' }
    : { label: 'Local' }
  const updatedLabel = formatRelativeTime(session.latestMessageAt ?? session.createdAt)
  const createdLabel = formatRelativeTime(session.createdAt)
  const cwdLabel = project ? relativePath(project.rootPath, session.workDir) : session.workDir
  const branchLabel = branch ?? inferredWorktreeBranch(session)
  const preview = useMemo(() => {
    if (session.previewText) return compactPreview(session.previewText, session.name, session.status)
    const lastMessage = session.messages.findLast((m) => m.type === 'text' && m.role !== 'system')
    return lastMessage && lastMessage.type === 'text'
      ? compactPreview(lastMessage.content, session.name, session.status)
      : ''
  }, [session.messages, session.name, session.previewText, session.status])

  useEffect(() => {
    if (!detailsVisible || branchLoadedFor === session.workDir) return
    let cancelled = false
    setBranchLoadedFor(session.workDir)
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
  }, [branchLoadedFor, detailsVisible, session.workDir])

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

  const togglePinned = async (event: React.MouseEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    const nextPinned = !session.pinned
    const previousPinOrder = session.pinOrder
    updatePinned(session.id, nextPinned)
    try {
      await window.api.sessions.updatePinned(session.id, nextPinned)
    } catch (error) {
      updatePinned(session.id, Boolean(session.pinned), previousPinOrder)
      console.error('Failed to update pinned chat', error)
    }
  }

  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenuPoint({ x: event.clientX, y: event.clientY })
  }

  const hideDetails = (): void => {
    setDetailsVisible(false)
  }

  const showDetails = (): void => {
    const rect = rowRef.current?.getBoundingClientRect()
    if (rect) {
      const estimatedWidth = Math.min(320, Math.max(260, window.innerWidth - 32))
      const left = Math.min(
        Math.max(rect.right + 8, 12),
        Math.max(12, window.innerWidth - estimatedWidth - 12)
      )
      const cardTop = Math.min(Math.max(rect.top - 10, 10), window.innerHeight - 220)
      setCardPosition({ left, top: cardTop })
    }
    announceHoverSurfaceOpen(hoverSurfaceId)
    setDetailsVisible(true)
  }

  useExclusiveHoverSurface(hoverSurfaceId, hideDetails)

  return (
    <>
      <div
        ref={rowRef}
        className="session-row-shell"
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'page' : undefined}
        aria-describedby={detailsVisible ? hoverSurfaceId : undefined}
        data-details-visible={detailsVisible ? 'true' : 'false'}
        onMouseEnter={showDetails}
        onMouseLeave={hideDetails}
        onFocus={showDetails}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideDetails()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if ((event.target as HTMLElement).closest('button')) return
          event.preventDefault()
          void handleClick()
        }}
      >
        <SurfaceRow
          dataTestId="session-row"
          className="group flex h-7 min-w-0 items-center gap-1.5 cursor-pointer select-none"
          active={isActive}
          style={{
            borderRadius: 'var(--radius-md)',
            padding: '3px 7px'
          }}
          onClick={handleClick}
          onContextMenu={openMenu}
        >
          <div className="session-item-pin-slot shrink-0">
            <Tooltip label={session.pinned ? 'Unpin chat' : 'Pin chat'}>
              <button
                type="button"
                className="session-item-pin-button"
                data-testid="session-pin-toggle"
                aria-label={session.pinned ? 'Unpin chat' : 'Pin chat'}
                data-native-title-free="true"
                data-pinned={session.pinned ? 'true' : 'false'}
                onClick={(event) => void togglePinned(event)}
              >
                <Icon name="pin" size={12} />
              </button>
            </Tooltip>
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[12.5px] truncate leading-4"
              data-thread-title={session.name}
              style={{ color: 'var(--text-primary)', fontWeight: 400 }}
            >
              {session.name}
            </div>
          </div>
          <span className="session-row-right-slot shrink-0">
            <span className="session-row-state-control">
              {showStatusIndicator ? (
                isRunning ? (
                  <Tooltip label={statusLabel}>
                    <span
                      className="session-item-running-spinner"
                      data-testid="session-status-spinner"
                      data-native-title-free="true"
                      aria-label={statusLabel}
                    />
                  </Tooltip>
                ) : (
                  <Tooltip label={statusLabel}>
                    <span
                      className="session-item-status-dot rounded-full"
                      data-testid="session-status-dot"
                      data-native-title-free="true"
                      aria-label={statusLabel}
                      style={{
                        background: hasError || isWaiting ? statusColor[session.status] : 'var(--color-accent)',
                        boxShadow: hasError
                          ? '0 0 4px var(--color-red)'
                          : isWaiting
                            ? '0 0 4px var(--color-yellow)'
                            : '0 0 4px var(--color-accent)'
                      }}
                    />
                  </Tooltip>
                )
              ) : (
                <span className="session-row-right-meta" aria-label={`Created ${createdLabel}`}>
                  {createdLabel}
                </span>
              )}
            </span>
            <span className="surface-row-secondary session-row-actions">
              <IconButton
                icon="ellipsis"
                label="Chat actions"
                size="sm"
                onClick={openMenu}
                style={{ color: 'var(--text-tertiary)' }}
              />
            </span>
          </span>
        </SurfaceRow>
      </div>
      {detailsVisible && cardPosition && (
        <div
          id={hoverSurfaceId}
          className="session-hover-card"
          data-testid="session-hover-card"
          style={{ left: cardPosition.left, top: cardPosition.top }}
          role="tooltip"
        >
          <div className="session-hover-card-title">{session.name}</div>
          {preview && <div className="session-hover-card-preview">{preview}</div>}
          <SessionHoverRow label="Project" value={project?.name ?? 'No project'} />
          <SessionHoverRow label="Folder" value={cwdLabel} />
          {branchLabel && <SessionHoverRow label="Branch" value={branchLabel} />}
          <SessionHoverRow label="Environment" value={environment.label} />
          <SessionHoverRow label="Provider" value={[provider?.name ?? session.provider, model?.label ?? session.model].filter(Boolean).join(' · ')} />
          <SessionHoverRow label="Status" value={statusLabel} />
          <SessionHoverRow label="Updated" value={updatedLabel} />
        </div>
      )}
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

function SessionHoverRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="session-hover-card-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function compactPreview(content: string, name: string, status: Session['status']): string {
  if (status === 'waiting_for_permission') return 'Waiting for approval'
  if (status === 'waiting_for_user') return 'Waiting for answer'

  const compact = content.replace(/\s+/g, ' ').trim()
  if (!compact || compact === name) return ''
  return compact.length > 44 ? `${compact.slice(0, 41)}...` : compact
}

function statusLabelFor(status: Session['status'], hasUnread: boolean): string {
  if (hasUnread && status === 'idle') return 'Unread updates'
  switch (status) {
    case 'idle':
      return 'Idle'
    case 'running':
      return 'Running'
    case 'waiting_for_permission':
      return 'Waiting for approval'
    case 'waiting_for_user':
      return 'Waiting for answer'
    case 'reconnecting':
      return 'Reconnecting'
    case 'auth_error':
      return 'Authentication error'
    case 'model_error':
      return 'Model error'
    case 'quota_error':
      return 'Quota error'
    case 'rate_limit_error':
      return 'Rate limit error'
    case 'provider_error':
      return 'Provider error'
    case 'error':
      return 'Needs attention'
  }
}

function formatRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (elapsedSeconds < 45) return 'now'
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays}d`
  const elapsedWeeks = Math.floor(elapsedDays / 7)
  if (elapsedWeeks < 8) return `${elapsedWeeks}w`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function relativePath(rootPath: string, workDir: string): string {
  const normalizedRoot = rootPath.replace(/\/+$/, '')
  const normalizedWorkDir = workDir.replace(/\/+$/, '')
  if (normalizedWorkDir === normalizedRoot) return basename(normalizedRoot)
  if (normalizedWorkDir.startsWith(`${normalizedRoot}/`)) return `./${normalizedWorkDir.slice(normalizedRoot.length + 1)}`
  return workDir
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function inferredWorktreeBranch(session: Session): string | null {
  return session.useWorktree ? `orchestrator/${session.id.slice(0, 8)}` : null
}

export default memo(SessionItem)
