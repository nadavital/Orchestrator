import type { Automation, AutomationRun, Session } from '../../types'
import { PROVIDER_DEFS, isSidebarPinnedSession, isSidebarProjectlessSession, sidebarThreadKind } from '../../types'
import { hasComposerDraft, useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import { sidebarSessionSelectedKey, useSidebarStore } from '../../store/sidebar'
import Icon from '../shared/Icon'
import SessionActionsMenu from '../shared/SessionActionsMenu'
import RenameChatDialog from '../shared/RenameChatDialog'
import { announceHoverSurfaceOpen, IconButton, SidebarListRow, Tooltip, useExclusiveHoverSurface } from '../shared/designSystem'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  session: Session
}

const hoverCardIntentDelayMs = 650

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
  const addSession = useSessionStore((state) => state.addSession)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const transferBrowserWorkbench = useSessionStore((state) => state.transferBrowserWorkbench)
  const removeSession = useSessionStore((state) => state.removeSession)
  const updateName = useSessionStore((state) => state.updateName)
  const updatePinned = useSessionStore((state) => state.updatePinned)
  const updateStatus = useSessionStore((state) => state.updateStatus)
  const setHasUnread = useSessionStore((state) => state.setHasUnread)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const selectedSidebarKey = useSidebarStore((state) => state.selectedKey)
  const setSelectedSidebarKey = useSidebarStore((state) => state.setSelectedKey)
  const { projects, addSessionToProject, removeSessionFromProject } = useProjectStore()
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [detailsVisible, setDetailsVisible] = useState(false)
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number } | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [branchLoadedFor, setBranchLoadedFor] = useState<string | null>(null)
  const [automations, setAutomations] = useState<Automation[]>([])
  const [runsByAutomation, setRunsByAutomation] = useState<Record<string, AutomationRun[]>>({})
  const hoverCardTimerRef = useRef<number | null>(null)
  const hasUnread = !isActive && unread
  const hasError = errorStatuses.has(session.status)
  const isRunning = session.status === 'running' || session.status === 'reconnecting'
  const isWaiting = session.status === 'waiting_for_permission' || session.status === 'waiting_for_user'
  const hasUncheckedCompletion = hasUnread && session.status === 'idle'
  const showStatusIndicator = isRunning || isWaiting || hasUncheckedCompletion || hasError
  const project = projects.find((p) => p.id === session.projectId)
  const projectIdSet = useMemo(() => new Set(projects.map((project) => project.id)), [projects])
  const projectless = isSidebarProjectlessSession(session, projectIdSet)
  const statusLabel = statusLabelFor(session.status, hasUnread)
  const createdLabel = formatRelativeTime(session.createdAt)
  const automation = automations.find((item) => item.status === 'ACTIVE') ?? automations[0] ?? null
  const automationRuns = automation ? runsByAutomation[automation.id] ?? [] : []
  const automationRun = automationRuns.find((run) => run.status === 'RUNNING') ?? null
  const automationLabel = automation ? automationStatusLabel(automation, automationRun) : null
  const branchLabel = branch ?? inferredWorktreeBranch(session)
  const threadKind = sidebarThreadKind(session)
  const labelColor = sidebarLabelColor(session)
  const isPinned = isSidebarPinnedSession(session)
  const providerPinReadOnly = session.providerPinned === true && session.pinned !== true
  const pinActionLabel = providerPinReadOnly
    ? 'Provider pin is read-only in Orchestrator'
    : isPinned
      ? 'Unpin chat locally'
      : 'Pin chat locally'
  const rowSelectedKey = sidebarSessionSelectedKey(session.id)

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

  useEffect(() => {
    let cancelled = false
    const refreshAutomations = (): void => {
      window.api.automations.listForSession(session.id)
        .then(async (nextAutomations) => {
          const runEntries = await Promise.all(nextAutomations.map(async (automation) => {
            const runs = await window.api.automations.listRuns(automation.id)
            return [automation.id, runs] as const
          }))
          if (!cancelled) setAutomations(nextAutomations)
          if (!cancelled) setRunsByAutomation(Object.fromEntries(runEntries))
        })
        .catch(() => {
          if (!cancelled) setAutomations([])
          if (!cancelled) setRunsByAutomation({})
        })
    }
    const handleAutomationUpdate = (event: Event): void => {
      const detail = (event as CustomEvent<Automation>).detail
      if (!detail || detail.target.sessionId === session.id) refreshAutomations()
    }
    const handleAutomationDeleted = (event: Event): void => {
      const detail = (event as CustomEvent<Automation>).detail
      if (!detail || detail.target.sessionId === session.id) refreshAutomations()
    }
    const handleAutomationRun = (event: Event): void => {
      const detail = (event as CustomEvent<AutomationRun>).detail
      if (!detail || typeof detail.automationId === 'string') refreshAutomations()
    }
    refreshAutomations()
    window.addEventListener('orchestrator:automation-updated', handleAutomationUpdate)
    window.addEventListener('orchestrator:automation-deleted', handleAutomationDeleted)
    window.addEventListener('orchestrator:automation-run', handleAutomationRun)
    return () => {
      cancelled = true
      window.removeEventListener('orchestrator:automation-updated', handleAutomationUpdate)
      window.removeEventListener('orchestrator:automation-deleted', handleAutomationDeleted)
      window.removeEventListener('orchestrator:automation-run', handleAutomationRun)
    }
  }, [session.id])

  useEffect(() => {
    if (!automationRun) return
    const interval = window.setInterval(() => {
      window.api.automations.listForSession(session.id)
        .then(async (nextAutomations) => {
          const runEntries = await Promise.all(nextAutomations.map(async (item) => {
            const runs = await window.api.automations.listRuns(item.id)
            return [item.id, runs] as const
          }))
          setAutomations(nextAutomations)
          setRunsByAutomation(Object.fromEntries(runEntries))
        })
        .catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(interval)
  }, [automationRun, session.id])

  const cleanupSessionIfEmpty = async (sessionId: string | null): Promise<void> => {
    const { sessions, removeSession, uiState } = useSessionStore.getState()
    if (!sessionId || sessionId === session.id) return
    const active = sessions.find((s) => s.id === sessionId)
    if (active && (active.messageCount ?? active.messages.length) === 0 && active.status !== 'running' && !hasComposerDraft(uiState[active.id])) {
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
    setSelectedSidebarKey(rowSelectedKey)
    setActiveSession(session.id)
    setShowCapabilities(false)
    setShowSettings(false)
    void cleanupSessionIfEmpty(previousActiveId)
  }

  const handleRemove = async (): Promise<void> => {
    await window.api.sessions.archive(session.id)
    await window.api.projects.removeSession(session.projectId, session.id)
    removeSession(session.id)
    removeSessionFromProject(session.projectId, session.id)
  }

  const togglePinned = async (event: React.MouseEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    if (providerPinReadOnly) return
    const nextPinned = !isPinned
    const previousPinOrder = session.pinOrder
    updatePinned(session.id, nextPinned)
    try {
      await window.api.sessions.updatePinned(session.id, nextPinned)
    } catch (error) {
      updatePinned(session.id, isPinned, previousPinOrder)
      console.error('Failed to update pinned chat', error)
    }
  }

  const openMenu = (event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenuPoint({ x: event.clientX, y: event.clientY })
  }

  const hideDetails = (): void => {
    if (hoverCardTimerRef.current !== null) {
      window.clearTimeout(hoverCardTimerRef.current)
      hoverCardTimerRef.current = null
    }
    setDetailsVisible(false)
  }

  useEffect(() => () => {
    if (hoverCardTimerRef.current !== null) window.clearTimeout(hoverCardTimerRef.current)
  }, [])

  const showDetails = (delayed = false): void => {
    if (hoverCardTimerRef.current !== null) {
      window.clearTimeout(hoverCardTimerRef.current)
      hoverCardTimerRef.current = null
    }
    if (delayed) {
      hoverCardTimerRef.current = window.setTimeout(() => {
        hoverCardTimerRef.current = null
        showDetails(false)
      }, hoverCardIntentDelayMs)
      return
    }
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

  const openRename = (event?: React.MouseEvent): void => {
    event?.preventDefault()
    event?.stopPropagation()
    hideDetails()
    setMenuPoint(null)
    setRenaming(true)
  }

  const rename = async (nextName: string): Promise<void> => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === session.name) {
      setRenaming(false)
      return
    }
    await window.api.sessions.updateName(session.id, trimmed)
    updateName(session.id, trimmed)
    setRenaming(false)
  }

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
        data-session-id={session.id}
        data-sidebar-thread-kind={threadKind}
        data-sidebar-provider-id={session.provider}
        data-sidebar-provider-thread-source={session.providerThreadSource ?? (session.providerSessionId ? 'remote' : 'local')}
        data-sidebar-provider-host-id={session.providerHostId ?? undefined}
        data-sidebar-worktree-source-root={session.providerWorktreeSourceRoot ?? undefined}
        data-sidebar-worktree-root={session.providerWorktreeRoot ?? undefined}
        data-sidebar-worktree-host-id={session.providerWorktreeHostId ?? undefined}
        data-sidebar-label-color={labelColor}
        data-sidebar-provider-pinned={session.providerPinned ? 'true' : undefined}
        data-sidebar-pinned-thread-key={session.providerPinnedThreadKey ?? undefined}
        data-sidebar-projectless={projectless ? 'true' : undefined}
        data-sidebar-projectless-thread-id={session.providerProjectlessThreadId ?? undefined}
        data-sidebar-selected-key={rowSelectedKey}
        onMouseEnter={() => showDetails(true)}
        onMouseLeave={hideDetails}
        onFocus={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          showDetails(false)
        }}
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
        <SidebarListRow
          as="div"
          dataTestId="session-row"
          className="group session-row cursor-pointer select-none"
          size="thread"
          active={isActive || selectedSidebarKey === rowSelectedKey}
          onClick={handleClick}
          onDoubleClick={openRename}
          onContextMenu={openMenu}
          dataSidebarKey={rowSelectedKey}
          label={(
            <div
              className="session-row-title truncate leading-4"
              data-thread-title={session.name}
            >
              {session.name}
            </div>
          )}
          trailing={(
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
              ) : automation && automationLabel ? (
                <Tooltip label={automationLabel}>
                  <span
                    className="session-automation-status"
                    data-testid="session-automation-status"
                    data-automation-status={automation.status}
                    data-automation-run-status={automationRun?.status}
                    data-automation-next-run={automation.nextRunAt ?? undefined}
                    data-native-title-free="true"
                    aria-label={automationLabel}
                  >
                    {automationRun ? <span className="session-automation-status-spinner" /> : <Icon name="clock" size={12} />}
                  </span>
                </Tooltip>
              ) : (
                <span className="session-row-right-meta" aria-label={`Created ${createdLabel}`}>
                  {createdLabel}
                </span>
              )}
            </span>
            <span
              className="surface-row-secondary session-row-actions"
              data-sidebar-row-action-slot="consolidated"
            >
              <Tooltip label={pinActionLabel}>
                <button
                  type="button"
                  className="session-item-pin-button"
                  data-testid="session-pin-toggle"
                  aria-label={pinActionLabel}
                  data-native-title-free="true"
                  data-pinned={isPinned ? 'true' : 'false'}
                  data-sidebar-pin-boundary={providerPinReadOnly ? 'provider-readonly' : 'local'}
                  disabled={providerPinReadOnly}
                  onClick={(event) => void togglePinned(event)}
                >
                  <Icon name="pin" size={12} />
                </button>
              </Tooltip>
              <IconButton
                icon="ellipsis"
                label="Chat actions"
                size="sm"
                onClick={openMenu}
                style={{ color: 'var(--text-tertiary)' }}
              />
            </span>
            </span>
          )}
        />
      </div>
      {detailsVisible && cardPosition && createPortal(
        <div
          id={hoverSurfaceId}
          className="session-hover-card"
          data-testid="session-hover-card"
          style={{ left: cardPosition.left, top: cardPosition.top }}
          role="tooltip"
        >
          <div className="session-hover-card-title">{session.name}</div>
          <SessionHoverRow label="Project" value={project?.name ?? (projectless ? 'Chat' : 'No project')} />
          {branchLabel && <SessionHoverRow label="Branch" value={branchLabel} />}
          {automationLabel && <SessionHoverRow label="Automation" value={automationLabel} />}
        </div>,
        document.body
      )}
      {menuPoint && (
        <SessionActionsMenu
          session={session}
          x={menuPoint.x}
          y={menuPoint.y}
          onClose={() => setMenuPoint(null)}
          onRemove={handleRemove}
          isUnread={unread}
          onMarkUnread={(nextUnread) => setHasUnread(session.id, nextUnread)}
          onStop={() => updateStatus(session.id, 'idle')}
          onForked={(forked) => {
            addSession(forked)
            transferBrowserWorkbench(session.id, forked.id)
            addSessionToProject(forked.projectId, forked.id)
            setActiveSession(forked.id)
            setShowCapabilities(false)
            setShowSettings(false)
          }}
        />
      )}
      {renaming && (
        <RenameChatDialog
          initialValue={session.name}
          onCancel={() => setRenaming(false)}
          onConfirm={(value) => void rename(value)}
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

function formatFutureRelativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((timestamp - Date.now()) / 1000))
  if (elapsedSeconds < 45) return 'now'
  const elapsedMinutes = Math.ceil(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.ceil(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  const elapsedDays = Math.ceil(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays}d`
  const elapsedWeeks = Math.ceil(elapsedDays / 7)
  if (elapsedWeeks < 8) return `${elapsedWeeks}w`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function automationStatusLabel(automation: Automation, runningRun?: AutomationRun | null): string {
  if (runningRun?.status === 'RUNNING') return 'Automation running'
  if (automation.status === 'PAUSED') return 'Automation paused'
  if (automation.status === 'ACTIVE' && typeof automation.nextRunAt === 'number') {
    return `Next run: ${formatFutureRelativeTime(automation.nextRunAt)}`
  }
  if (automation.status === 'ACTIVE') return 'Automation ready'
  return 'Automation deleted'
}

function inferredWorktreeBranch(session: Session): string | null {
  return session.useWorktree ? `orchestrator/${session.id.slice(0, 8)}` : null
}

function sidebarLabelColor(session: Session): string {
  const providerColor = PROVIDER_DEFS[session.provider]?.color
  return providerColor && /^#[0-9a-f]{6}$/i.test(providerColor) ? providerColor : 'var(--text-tertiary)'
}

export default memo(SessionItem)
