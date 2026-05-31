import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isSidebarPinnedSession, sessionRouteUrlForLocation } from '../../types'
import type { Automation, AutomationPermissionSnapshot, AutomationSchedule, AutomationStatus, ChatMessage, Session, SessionForkMode } from '../../types'
import RenameChatDialog from './RenameChatDialog'
import { Button, ConfirmDialog, DialogContent, DialogField, DialogFooter, DialogHeader, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, MotionOverlay } from './designSystem'

interface SessionActionsMenuSession {
  id: string
  projectId: string
  name: string
  pinned?: boolean
  status?: 'idle' | 'running' | 'waiting_for_permission' | 'waiting_for_user' | 'reconnecting' | 'auth_error' | 'model_error' | 'quota_error' | 'rate_limit_error' | 'provider_error' | 'error'
  workDir: string
  repoRoot?: string
  provider?: string
  providerSessionId?: string | null
  providerPinned?: boolean
  providerPinOrder?: number
  providerPinnedThreadKey?: string | null
  useWorktree?: boolean
  worktreeState?: Session['worktreeState']
  permissionMode?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  messages?: ChatMessage[]
  messageCount?: number
}

interface Props {
  session: SessionActionsMenuSession
  x: number
  y: number
  onClose: () => void
  onRemove?: (session: SessionActionsMenuSession) => void | Promise<void>
  onMarkUnread?: (unread: boolean) => void
  onStop?: () => void
  onForked?: (session: Session) => void
  isUnread?: boolean
  projectRoot?: string
  branch?: string | null
  menuId?: string
}

export default function SessionActionsMenu({
  session,
  x,
  y,
  onClose,
  onRemove,
  onMarkUnread,
  onStop,
  onForked,
  isUnread = false,
  projectRoot,
  branch,
  menuId
}: Props): JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false)
  const [automations, setAutomations] = useState<Automation[]>([])
  const existingAutomation = automations[0] ?? null
  const isPinned = isSidebarPinnedSession(session)
  const providerPinReadOnly = session.providerPinned === true && session.pinned !== true
  const pinActionLabel = providerPinReadOnly
    ? 'Provider pin is read-only in Orchestrator'
    : isPinned
      ? 'Unpin chat locally'
      : 'Pin chat locally'

  useEffect(() => {
    let cancelled = false
    window.api.automations.listForSession(session.id)
      .then((nextAutomations) => {
        if (!cancelled) setAutomations(nextAutomations)
      })
      .catch(() => {
        if (!cancelled) setAutomations([])
      })
    return () => {
      cancelled = true
    }
  }, [session.id])

  const rename = async (nextName: string): Promise<void> => {
    const trimmed = nextName.trim()
    if (!trimmed || trimmed === session.name) {
      onClose()
      return
    }
    await window.api.sessions.updateName(session.id, trimmed)
    onClose()
  }

  const togglePinned = async (): Promise<void> => {
    if (providerPinReadOnly) return
    await window.api.sessions.updatePinned(session.id, !isPinned)
    onClose()
  }

  const copyToClipboard = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    onClose()
  }

  const copyThreadLink = async (): Promise<void> => {
    const routeUrl = sessionRouteUrlForLocation(session.id, window.location)
    const href = new URL(routeUrl, window.location.href).href
    if (typeof window.api.clipboard?.writeText === 'function') {
      await window.api.clipboard.writeText(href)
    } else {
      await navigator.clipboard.writeText(href)
    }
    const testWindow = window as typeof window & { __orchestratorLastCopiedThreadLink?: string }
    testWindow.__orchestratorLastCopiedThreadLink = href
    onClose()
  }

  const copyDeeplink = async (): Promise<void> => {
    const deeplink = await window.api.sessions.copyDeeplink(session.id)
    const testWindow = window as typeof window & { __orchestratorLastCopiedDeeplink?: string }
    testWindow.__orchestratorLastCopiedDeeplink = deeplink
    onClose()
  }

  const copyConversationMarkdown = async (): Promise<void> => {
    const markdown = await window.api.sessions.copyMarkdown(session.id)
    const testWindow = window as typeof window & { __orchestratorLastCopiedMarkdown?: string }
    testWindow.__orchestratorLastCopiedMarkdown = markdown
    onClose()
  }

  const remove = async (): Promise<void> => {
    if (!onRemove) return
    await onRemove(session)
    onClose()
  }

  const markUnread = (nextUnread: boolean): void => {
    onMarkUnread?.(nextUnread)
    onClose()
  }

  const stopChat = async (): Promise<void> => {
    await window.api.sessions.stop(session.id)
    onStop?.()
    const testWindow = window as typeof window & { __orchestratorLastStoppedSessionId?: string }
    testWindow.__orchestratorLastStoppedSessionId = session.id
    onClose()
  }

  const openInNewWindow = async (): Promise<void> => {
    const testWindow = window as typeof window & { __orchestratorLastOpenedSessionWindowId?: string }
    testWindow.__orchestratorLastOpenedSessionWindowId = session.id
    await window.api.app.openSessionWindow(session.id)
    onClose()
  }

  const forkChat = async (mode: SessionForkMode): Promise<void> => {
    const currentSession = await window.api.sessions.get(session.id)
    const sourceMessageId = latestForkTurnMessageId(currentSession?.messages ?? session.messages ?? [])
    const options = sourceMessageId ? { throughMessageId: sourceMessageId } : undefined
    const forked = await window.api.sessions.fork(session.id, mode, options)
    const testWindow = window as typeof window & { __orchestratorLastForkedSession?: { id: string; mode: SessionForkMode; sourceMessageId?: string; name: string; messageCount: number; useWorktree: boolean; workDir: string; worktreeState?: Session['worktreeState'] } }
    testWindow.__orchestratorLastForkedSession = {
      id: forked.id,
      mode,
      sourceMessageId,
      name: forked.name,
      messageCount: forked.messages.length,
      useWorktree: forked.useWorktree,
      workDir: forked.workDir,
      worktreeState: forked.worktreeState
    }
    onForked?.(forked)
    onClose()
  }

  const retryPendingWorktree = async (): Promise<void> => {
    const retried = await window.api.sessions.retryPendingWorktree(session.id)
    const testWindow = window as typeof window & { __orchestratorLastPendingWorktreeAction?: { mode: 'retry'; id: string; worktreeState?: Session['worktreeState']; status?: Session['status']; workDir: string } }
    testWindow.__orchestratorLastPendingWorktreeAction = {
      mode: 'retry',
      id: retried.id,
      worktreeState: retried.worktreeState,
      status: retried.status,
      workDir: retried.workDir
    }
    onClose()
  }

  const saveAutomation = async ({
    name,
    prompt,
    status,
    schedule,
  }: {
    name: string
    prompt: string
    status: AutomationStatus
    schedule: AutomationSchedule
  }): Promise<void> => {
    const automation = await window.api.automations.upsert({
      id: existingAutomation?.id ?? null,
      kind: 'heartbeat',
      name,
      prompt,
      status,
      target: { type: 'session', sessionId: session.id },
      schedule,
      permissionSnapshot: existingAutomation?.permissionSnapshot ?? automationPermissionSnapshotForSession(session)
    })
    setAutomations([automation])
    const testWindow = window as typeof window & { __orchestratorLastAutomationAction?: { mode: 'add' | 'edit'; id: string; sessionId: string; name: string; status: string; scheduleMode?: string } }
    testWindow.__orchestratorLastAutomationAction = {
      mode: existingAutomation ? 'edit' : 'add',
      id: automation.id,
      sessionId: session.id,
      name: automation.name,
      status: automation.status,
      scheduleMode: automation.schedule.mode
    }
    window.dispatchEvent(new CustomEvent('orchestrator:automation-updated', { detail: automation }))
    setAutomationDialogOpen(false)
    onClose()
  }

  const recordAutomationAction = (
    mode: 'add' | 'edit' | 'run' | 'pause' | 'resume' | 'delete',
    automation: Automation | { id: string; name: string; status: string }
  ): void => {
    const testWindow = window as typeof window & {
      __orchestratorLastAutomationAction?: {
        mode: 'add' | 'edit' | 'run' | 'pause' | 'resume' | 'delete'
        id: string
        sessionId: string
        name: string
        status: string
      }
    }
    testWindow.__orchestratorLastAutomationAction = {
      mode,
      id: automation.id,
      sessionId: session.id,
      name: automation.name,
      status: automation.status
    }
  }

  const runAutomationNow = async (): Promise<void> => {
    if (!existingAutomation) return
    const run = await window.api.automations.runNow(existingAutomation.id)
    recordAutomationAction('run', {
      id: existingAutomation.id,
      name: existingAutomation.name,
      status: run.status
    })
    window.dispatchEvent(new CustomEvent('orchestrator:automation-run', { detail: run }))
    onClose()
  }

  const pauseAutomation = async (): Promise<void> => {
    if (!existingAutomation) return
    const automation = await window.api.automations.pause(existingAutomation.id)
    if (!automation) return
    setAutomations([automation])
    recordAutomationAction('pause', automation)
    window.dispatchEvent(new CustomEvent('orchestrator:automation-updated', { detail: automation }))
    onClose()
  }

  const resumeAutomation = async (): Promise<void> => {
    if (!existingAutomation) return
    const automation = await window.api.automations.resume(existingAutomation.id)
    if (!automation) return
    setAutomations([automation])
    recordAutomationAction('resume', automation)
    window.dispatchEvent(new CustomEvent('orchestrator:automation-updated', { detail: automation }))
    onClose()
  }

  const deleteAutomation = async (): Promise<void> => {
    if (!existingAutomation) return
    await window.api.automations.delete(existingAutomation.id)
    recordAutomationAction('delete', existingAutomation)
    setAutomations([])
    window.dispatchEvent(new CustomEvent('orchestrator:automation-deleted', { detail: existingAutomation }))
    onClose()
  }

  const canStop =
    session.status === 'running' ||
    session.status === 'waiting_for_permission' ||
    session.status === 'waiting_for_user' ||
    session.status === 'reconnecting'

  const menu = (
    <>
    {!renaming && !confirmingArchive && !automationDialogOpen && (
      <MenuSurface
        id={menuId}
        className="fixed"
        onClose={onClose}
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 208)),
          top: Math.max(8, Math.min(y, window.innerHeight - 292)),
          width: 216,
          maxHeight: Math.min(320, window.innerHeight - 16),
          zIndex: 10000,
        }}
      >
        <MenuSection dataTestId="session-action-menu-chat-section">
          <MenuSectionLabel>Chat</MenuSectionLabel>
          <MenuItem icon="pencil" label="Rename" onClick={() => setRenaming(true)} />
          <MenuItem
            icon="pin"
            label={pinActionLabel}
            disabled={providerPinReadOnly}
            onClick={() => void togglePinned()}
          />
          {onMarkUnread && (
            <MenuItem
              icon="dot"
              label={isUnread ? 'Mark as read' : 'Mark as unread'}
              onClick={() => markUnread(!isUnread)}
            />
          )}
          {canStop && <MenuItem icon="stop" label="Stop chat" onClick={() => void stopChat()} />}
        </MenuSection>
        <MenuSection dataTestId="session-action-menu-automation-section">
          <MenuSectionLabel>Automation</MenuSectionLabel>
          <MenuItem
            icon="clock"
            label={existingAutomation ? 'Edit automation...' : 'Add automation...'}
            onClick={() => setAutomationDialogOpen(true)}
          />
          {existingAutomation && (
            <>
              <MenuItem
                icon="send"
                label="Run automation now"
                disabled={existingAutomation.status !== 'ACTIVE'}
                onClick={() => void runAutomationNow()}
              />
              {existingAutomation.status === 'ACTIVE' ? (
                <MenuItem icon="stop" label="Pause automation" onClick={() => void pauseAutomation()} />
              ) : (
                <MenuItem icon="refresh" label="Resume automation" onClick={() => void resumeAutomation()} />
              )}
              <MenuItem icon="archive" label="Delete automation" onClick={() => void deleteAutomation()} />
            </>
          )}
        </MenuSection>
        <MenuSection dataTestId="session-action-menu-workspace-section">
          <MenuSectionLabel>Workspace</MenuSectionLabel>
          <MenuItem icon="external" label="Open in new window" onClick={() => void openInNewWindow()} />
          <MenuItem icon="branch" label="Fork into local from latest turn" onClick={() => void forkChat('local')} />
          {session.useWorktree && (
            <MenuItem icon="branch" label="Fork into same worktree from latest turn" onClick={() => void forkChat('same-worktree')} />
          )}
          {session.repoRoot && (
            <MenuItem icon="branch" label="Fork into new worktree from latest turn" onClick={() => void forkChat('new-worktree')} />
          )}
          {session.worktreeState === 'failed' && (
            <MenuItem icon="refresh" label="Retry worktree creation" onClick={() => void retryPendingWorktree()} />
          )}
        </MenuSection>
        <MenuSection dataTestId="session-action-menu-copy-section">
          <MenuSectionLabel>Copy</MenuSectionLabel>
          <MenuItem icon="copy" label="Copy folder path" onClick={() => void copyToClipboard(session.workDir)} />
          {projectRoot && projectRoot !== session.workDir && (
            <MenuItem icon="copy" label="Copy project path" onClick={() => void copyToClipboard(projectRoot)} />
          )}
          {session.repoRoot && session.repoRoot !== session.workDir && session.repoRoot !== projectRoot && (
            <MenuItem icon="copy" label="Copy repo root" onClick={() => void copyToClipboard(session.repoRoot!)} />
          )}
          <MenuItem icon="copy" label="Copy session ID" onClick={() => void copyToClipboard(session.id)} />
          <MenuItem icon="copy" label="Copy thread link" onClick={() => void copyThreadLink()} />
          <MenuItem icon="copy" label="Copy deeplink" onClick={() => void copyDeeplink()} />
          <MenuItem icon="copy" label="Copy as Markdown" onClick={() => void copyConversationMarkdown()} />
          <MenuItem
            icon="copy"
            label="Copy provider session ID"
            disabled={!session.providerSessionId}
            onClick={() => void copyToClipboard(session.providerSessionId ?? '')}
          />
          {branch && <MenuItem icon="copy" label="Copy branch name" onClick={() => void copyToClipboard(branch)} />}
        </MenuSection>
        {onRemove && (
          <MenuSection dataTestId="session-action-menu-manage-section">
            <MenuSectionLabel>Manage</MenuSectionLabel>
            <MenuItem
              icon="archive"
              label={session.worktreeState === 'failed' ? 'Archive failed worktree' : 'Archive chat'}
              onClick={() => setConfirmingArchive(true)}
            />
          </MenuSection>
        )}
      </MenuSurface>
    )}
    {renaming && (
      <RenameChatDialog
        initialValue={session.name}
        onCancel={onClose}
        onConfirm={(value) => void rename(value)}
      />
    )}
    {confirmingArchive && (
      <ConfirmDialog
        title={`Archive "${session.name}"?`}
        description="This removes the chat from the active sidebar while keeping its record in Orchestrator."
        confirmLabel="Archive"
        tone="accent"
        onCancel={() => setConfirmingArchive(false)}
        onConfirm={() => void remove()}
      />
    )}
    {automationDialogOpen && (
      <AutomationEditDialog
        automation={existingAutomation}
        sessionName={session.name}
        onCancel={() => setAutomationDialogOpen(false)}
        onConfirm={(value) => void saveAutomation(value)}
      />
    )}
    </>
  )

  return createPortal(menu, document.body)
}

function latestForkTurnMessageId(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'text') continue
    if (message.role === 'system') continue
    if (message.isStreaming || message.queueState) continue
    if (!message.content.trim()) continue
    return message.id
  }
  return undefined
}

function AutomationEditDialog({
  automation,
  sessionName,
  onCancel,
  onConfirm,
}: {
  automation: Automation | null
  sessionName: string
  onCancel: () => void
  onConfirm: (value: {
    name: string
    prompt: string
    status: AutomationStatus
    schedule: AutomationSchedule
  }) => void | Promise<void>
}): JSX.Element {
  const [name, setName] = useState(automation?.name ?? `Follow up: ${sessionName}`)
  const [prompt, setPrompt] = useState(automation?.prompt ?? 'Continue this chat and check whether anything needs attention.')
  const [status, setStatus] = useState<AutomationStatus>(automation?.status ?? 'PAUSED')
  const [scheduleMode, setScheduleMode] = useState<AutomationSchedule['mode']>(automation?.schedule.mode ?? 'manual')
  const [intervalMinutes, setIntervalMinutes] = useState(String(automation?.schedule.intervalMinutes ?? 60))
  const [rrule, setRrule] = useState(automation?.schedule.rrule ?? 'FREQ=DAILY')

  const submit = (): void => {
    const trimmedName = name.trim()
    const trimmedPrompt = prompt.trim()
    if (!trimmedName || !trimmedPrompt) return
    void onConfirm({
      name: trimmedName,
      prompt: trimmedPrompt,
      status,
      schedule: buildSchedule(scheduleMode, intervalMinutes, rrule)
    })
  }

  return (
    <MotionOverlay onClose={onCancel} surfaceClassName="orchestrator-dialog-surface orchestrator-dialog-surface-wide">
      <DialogContent
        as="form"
        className="automation-edit-dialog"
        dataTestId="automation-edit-dialog"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <DialogHeader
          title={automation ? 'Edit automation' : 'Add automation'}
          description="Configure the local heartbeat follow-up for this chat."
        />
        <DialogField label="Name">
          <input
            value={name}
            placeholder="Automation name"
            onChange={(event) => setName(event.target.value)}
            className="orchestrator-dialog-input"
            data-testid="automation-name-input"
            autoFocus
          />
        </DialogField>
        <DialogField label="Prompt">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="orchestrator-dialog-input automation-dialog-textarea"
            data-testid="automation-prompt-input"
          />
        </DialogField>
        <div className="automation-dialog-grid">
          <DialogField label="Status">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as AutomationStatus)}
              className="orchestrator-dialog-input"
              data-testid="automation-status-select"
            >
              <option value="PAUSED">Paused</option>
              <option value="ACTIVE">Active</option>
            </select>
          </DialogField>
          <DialogField label="Schedule">
            <select
              value={scheduleMode}
              onChange={(event) => setScheduleMode(event.target.value as AutomationSchedule['mode'])}
              className="orchestrator-dialog-input"
              data-testid="automation-schedule-mode"
            >
              <option value="manual">Manual</option>
              <option value="interval">Interval</option>
              <option value="rrule">RRULE</option>
            </select>
          </DialogField>
        </div>
        {scheduleMode === 'interval' && (
          <DialogField label="Interval minutes">
            <input
              type="number"
              min={1}
              max={10080}
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              className="orchestrator-dialog-input"
              data-testid="automation-interval-minutes"
            />
          </DialogField>
        )}
        {scheduleMode === 'rrule' && (
          <DialogField label="RRULE">
            <input
              value={rrule}
              onChange={(event) => setRrule(event.target.value)}
              className="orchestrator-dialog-input"
              data-testid="automation-rrule-input"
            />
          </DialogField>
        )}
        {status === 'ACTIVE' && scheduleMode !== 'manual' && (
          <div className="automation-dialog-warning" data-testid="automation-lifecycle-warning">
            Active scheduled automations can start a run when their next run is due.
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || !prompt.trim()}>{automation ? 'Save' : 'Add'}</Button>
        </DialogFooter>
      </DialogContent>
    </MotionOverlay>
  )
}

function buildSchedule(
  mode: AutomationSchedule['mode'],
  intervalMinutes: string,
  rrule: string
): AutomationSchedule {
  if (mode === 'interval') {
    const parsed = Number(intervalMinutes)
    const minutes = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 60
    return { mode: 'interval', intervalMinutes: minutes, rrule: null }
  }
  if (mode === 'rrule') {
    return { mode: 'rrule', rrule: rrule.trim() || 'FREQ=DAILY' }
  }
  return { mode: 'manual', rrule: null }
}

function automationPermissionSnapshotForSession(session: SessionActionsMenuSession): AutomationPermissionSnapshot | null {
  const allowedTools = session.allowedTools ?? []
  const disallowedTools = session.disallowedTools ?? []
  if (!session.permissionMode && allowedTools.length === 0 && disallowedTools.length === 0) return null
  return {
    executionPolicy: session.permissionMode ?? null,
    allowedTools,
    disallowedTools
  }
}
