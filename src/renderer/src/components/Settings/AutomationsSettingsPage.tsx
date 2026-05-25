import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Automation, AutomationRun, AutomationRunStatus, AutomationSchedule, SessionListItem } from '../../types'
import {
  ConfirmDialog,
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

export default function AutomationsSettingsPage({
  sessions,
}: {
  sessions: SessionListItem[]
}): JSX.Element {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [runsByAutomation, setRunsByAutomation] = useState<Record<string, AutomationRun[]>>({})
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [pendingDeleteAutomation, setPendingDeleteAutomation] = useState<Automation | null>(null)

  const sessionNames = useMemo(() => new Map(sessions.map((session) => [session.id, session.name])), [sessions])
  const currentAutomations = useMemo(
    () => sortAutomations(automations.filter((automation) => automation.status === 'ACTIVE')),
    [automations]
  )
  const pausedAutomations = useMemo(
    () => sortAutomations(automations.filter((automation) => automation.status === 'PAUSED')),
    [automations]
  )
  const recentRuns = useMemo(
    () => Object.values(runsByAutomation)
      .flat()
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 8),
    [runsByAutomation]
  )

  const refreshAutomations = useCallback(async (): Promise<void> => {
    const records = await window.api.automations.list()
    setAutomations(records)
    const runEntries = await Promise.all(records.map(async (automation) => {
      const runs = await window.api.automations.listRuns(automation.id)
      return [automation.id, runs] as const
    }))
    setRunsByAutomation(Object.fromEntries(runEntries))
  }, [])

  useEffect(() => {
    void refreshAutomations()
    const handleAutomationUpdate = (): void => { void refreshAutomations() }
    const handleAutomationDelete = (): void => { void refreshAutomations() }
    const handleAutomationRun = (): void => { void refreshAutomations() }
    window.addEventListener('orchestrator:automation-updated', handleAutomationUpdate)
    window.addEventListener('orchestrator:automation-deleted', handleAutomationDelete)
    window.addEventListener('orchestrator:automation-run', handleAutomationRun)
    return () => {
      window.removeEventListener('orchestrator:automation-updated', handleAutomationUpdate)
      window.removeEventListener('orchestrator:automation-deleted', handleAutomationDelete)
      window.removeEventListener('orchestrator:automation-run', handleAutomationRun)
    }
  }, [refreshAutomations])

  const runAction = async (
    automation: Automation,
    label: string,
    action: () => Promise<Automation | AutomationRun | void>
  ): Promise<void> => {
    setBusyIds((current) => ({ ...current, [automation.id]: true }))
    try {
      const result = await action()
      if (isAutomation(result)) {
        window.dispatchEvent(new CustomEvent('orchestrator:automation-updated', { detail: result }))
      } else if (isAutomationRun(result)) {
        window.dispatchEvent(new CustomEvent('orchestrator:automation-run', { detail: result }))
      } else {
        window.dispatchEvent(new CustomEvent('orchestrator:automation-deleted', { detail: automation }))
      }
      await refreshAutomations()
      setStatus(`${label}: ${automation.name}`)
    } finally {
      setBusyIds((current) => ({ ...current, [automation.id]: false }))
    }
  }

  const deleteAutomation = async (automation: Automation): Promise<void> => {
    await runAction(automation, 'Deleted', () => window.api.automations.delete(automation.id))
    setPendingDeleteAutomation((current) => current?.id === automation.id ? null : current)
  }

  return (
    <div data-settings-page-module="automations">
      <SettingsPageSection dataTestId="automations-settings-section" className="automations-settings-page">
        <SettingsContentLayout
          title="Automations"
          subtitle="Manage local scheduled follow-ups and inspect the run history used by sidebar automation state."
          dataTestId="settings-content-layout-automations"
        >
          <SettingsContentGroup className="automations-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Current</div>
              <div className="settings-content-description">Active automations are eligible for scheduler ticks and manual runs.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="automations-settings-surface" dataTestId="automations-current-surface">
                <AutomationInventoryRow activeCount={currentAutomations.length} pausedCount={pausedAutomations.length} onRefresh={refreshAutomations} />
                <AutomationList
                  automations={currentAutomations}
                  runsByAutomation={runsByAutomation}
                  sessionNames={sessionNames}
                  busyIds={busyIds}
                  emptyLabel="No active automations"
                  onRunNow={(automation) => runAction(automation, 'Ran now', () => window.api.automations.runNow(automation.id))}
                  onPause={(automation) => runAction(automation, 'Paused', () => window.api.automations.pause(automation.id))}
                  onResume={(automation) => runAction(automation, 'Resumed', () => window.api.automations.resume(automation.id))}
                  onDeleteRequest={setPendingDeleteAutomation}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="automations-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Paused</div>
              <div className="settings-content-description">Paused automations keep their prompt and schedule but do not run.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="automations-settings-surface" dataTestId="automations-paused-surface">
                <AutomationList
                  automations={pausedAutomations}
                  runsByAutomation={runsByAutomation}
                  sessionNames={sessionNames}
                  busyIds={busyIds}
                  emptyLabel="No paused automations"
                  onRunNow={(automation) => runAction(automation, 'Ran now', () => window.api.automations.runNow(automation.id))}
                  onPause={(automation) => runAction(automation, 'Paused', () => window.api.automations.pause(automation.id))}
                  onResume={(automation) => runAction(automation, 'Resumed', () => window.api.automations.resume(automation.id))}
                  onDeleteRequest={setPendingDeleteAutomation}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="automations-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Run history</div>
              <div className="settings-content-description">Recent scheduled and manual attempts across local automations.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="automations-settings-surface" dataTestId="automations-history-surface">
                {recentRuns.length === 0 ? (
                  <div className="automations-empty">No automation runs yet</div>
                ) : (
                  <div className="automations-run-list">
                    {recentRuns.map((run) => {
                      const automation = automations.find((candidate) => candidate.id === run.automationId)
                      return (
                        <div key={run.id} className="automations-run-row" data-run-status={run.status}>
                          <span className="automations-status-pill" data-status={run.status}>{runStatusLabel(run.status)}</span>
                          <span className="automations-run-name">{automation?.name ?? 'Deleted automation'}</span>
                          <span className="automations-run-meta">{run.trigger} - {formatRelativeTime(run.startedAt)}</span>
                          {run.error && <span className="automations-run-error">{run.error}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
                {status && <div className="automations-status">{status}</div>}
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
        {pendingDeleteAutomation && (
          <ConfirmDialog
            dataTestId="automations-delete-confirm-dialog"
            title="Delete automation?"
            description={`Delete "${pendingDeleteAutomation.name}" and its local schedule history?`}
            confirmLabel={busyIds[pendingDeleteAutomation.id] ? 'Deleting...' : 'Delete'}
            onCancel={() => setPendingDeleteAutomation(null)}
            onConfirm={() => { void deleteAutomation(pendingDeleteAutomation) }}
          />
        )}
      </SettingsPageSection>
    </div>
  )
}

function AutomationInventoryRow({
  activeCount,
  pausedCount,
  onRefresh,
}: {
  activeCount: number
  pausedCount: number
  onRefresh: () => Promise<void>
}): JSX.Element {
  return (
    <SettingsRow
      label="Inventory"
      description={`${activeCount} current, ${pausedCount} paused`}
      control={(
        <button type="button" className="settings-action-button" onClick={() => { void onRefresh() }}>
          Refresh
        </button>
      )}
    />
  )
}

function AutomationList({
  automations,
  runsByAutomation,
  sessionNames,
  busyIds,
  emptyLabel,
  onRunNow,
  onPause,
  onResume,
  onDeleteRequest,
}: {
  automations: Automation[]
  runsByAutomation: Record<string, AutomationRun[]>
  sessionNames: Map<string, string>
  busyIds: Record<string, boolean>
  emptyLabel: string
  onRunNow: (automation: Automation) => Promise<void>
  onPause: (automation: Automation) => Promise<void>
  onResume: (automation: Automation) => Promise<void>
  onDeleteRequest: (automation: Automation) => void
}): JSX.Element {
  if (automations.length === 0) return <div className="automations-empty">{emptyLabel}</div>

  return (
    <div className="automations-list" data-testid="automations-list">
      {automations.map((automation) => {
        const busy = Boolean(busyIds[automation.id])
        const automationRuns = [...(runsByAutomation[automation.id] ?? [])].sort((a, b) => b.startedAt - a.startedAt)
        const runningRun = automationRuns.find((run) => run.status === 'RUNNING')
        const latestRun = automationRuns[0]
        const actionsDisabled = busy || Boolean(runningRun)
        return (
          <div
            key={automation.id}
            className="automations-row"
            data-testid="automation-settings-row"
            data-automation-status={automation.status}
            data-automation-run-status={runningRun?.status}
          >
            <div className="automations-row-main">
              <div className="automations-row-title">
                <span>{automation.name}</span>
                {runningRun && <span className="automations-status-pill" data-status="RUNNING">Running</span>}
                <span className="automations-status-pill" data-status={automation.status}>{automation.status === 'ACTIVE' ? 'Current' : 'Paused'}</span>
              </div>
              <div className="automations-row-meta">
                {sessionNames.get(automation.target.sessionId) ?? 'Missing chat'} - {scheduleLabel(automation.schedule)}
              </div>
              <div className="automations-row-meta">
                Next {formatTimestamp(automation.nextRunAt)} - Last {formatTimestamp(automation.lastRunAt)}
              </div>
              {latestRun && (
                <div className="automations-row-meta">
                  Latest {latestRun.trigger} {runStatusLabel(latestRun.status).toLowerCase()} {formatRelativeTime(latestRun.startedAt)}
                </div>
              )}
            </div>
            <div className="automations-actions">
              <button
                type="button"
                className="settings-action-button"
                disabled={actionsDisabled || automation.status !== 'ACTIVE'}
                onClick={() => { void onRunNow(automation) }}
              >
                Run now
              </button>
              {automation.status === 'ACTIVE' ? (
                <button type="button" className="settings-action-button" disabled={actionsDisabled} onClick={() => { void onPause(automation) }}>
                  Pause
                </button>
              ) : (
                <button type="button" className="settings-action-button" disabled={actionsDisabled} onClick={() => { void onResume(automation) }}>
                  Resume
                </button>
              )}
              <button
                type="button"
                className="settings-action-button settings-action-button-danger"
                disabled={actionsDisabled}
                onClick={() => onDeleteRequest(automation)}
              >
                Delete
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function sortAutomations(automations: Automation[]): Automation[] {
  return [...automations].sort((a, b) => {
    const aNext = a.nextRunAt ?? Number.MAX_SAFE_INTEGER
    const bNext = b.nextRunAt ?? Number.MAX_SAFE_INTEGER
    if (aNext !== bNext) return aNext - bNext
    return b.updatedAt - a.updatedAt
  })
}

function scheduleLabel(schedule: AutomationSchedule): string {
  if (schedule.mode === 'interval') return `Every ${schedule.intervalMinutes ?? 60}m`
  if (schedule.mode === 'rrule') return schedule.rrule ?? 'RRULE schedule'
  return 'Manual'
}

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) return '-'
  return formatRelativeTime(timestamp)
}

function formatRelativeTime(timestamp: number): string {
  const elapsedMs = Date.now() - timestamp
  const future = elapsedMs < 0
  const distanceMs = Math.abs(elapsedMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  let value: string
  if (distanceMs < minute) value = 'now'
  else if (distanceMs < hour) value = `${Math.max(1, Math.floor(distanceMs / minute))}m`
  else if (distanceMs < day) value = `${Math.floor(distanceMs / hour)}h`
  else if (distanceMs < week) value = `${Math.floor(distanceMs / day)}d`
  else value = `${Math.floor(distanceMs / week)}w`
  if (value === 'now') return value
  return future ? `in ${value}` : `${value} ago`
}

function runStatusLabel(status: AutomationRunStatus): string {
  if (status === 'SUCCEEDED') return 'Succeeded'
  if (status === 'FAILED') return 'Failed'
  if (status === 'SKIPPED') return 'Skipped'
  if (status === 'RUNNING') return 'Running'
  return 'Pending'
}

function isAutomation(value: unknown): value is Automation {
  return Boolean(value && typeof value === 'object' && 'target' in value && 'schedule' in value)
}

function isAutomationRun(value: unknown): value is AutomationRun {
  return Boolean(value && typeof value === 'object' && 'automationId' in value && 'trigger' in value)
}
