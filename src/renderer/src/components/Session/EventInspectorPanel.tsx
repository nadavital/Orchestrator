import { useMemo, useState } from 'react'
import { useSessionStore } from '../../store/sessions'
import type { AgentNode, AgentStatus, Session, SessionRunEventRecord } from '../../types'
import { Badge, InspectorCard, InspectorRow, InspectorSection, MetricPill, PanelHeader, TabButton, WorkbenchSearchField } from '../shared/designSystem'
import { deriveSessionAgentNodes } from './agentNodes'

interface Props {
  session: Session
  embedded?: boolean
  activeAgentId?: string | null
}

type EventSeverityFilter = 'all' | 'issues' | 'failures' | 'waiting'
type EventSourceFilter = 'all' | 'agents' | 'tools' | 'approvals' | 'connection'

export default function EventInspectorPanel({ session, embedded = false, activeAgentId = null }: Props): JSX.Element {
  const { eventBuffers, rawBuffers, uiState, setActiveAgent, closeAgentTab } = useSessionStore()
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const events = eventBuffers[session.id] ?? []
  const rawLog = rawBuffers[session.id] ?? ''
  const agents = useMemo(() => deriveSessionAgentNodes(session, events), [events, session])
  const openAgentIds = uiState[session.id]?.agentTabIds ?? (activeAgentId ? [activeAgentId] : [])
  const pinnedAgents = openAgentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentNode => Boolean(agent))
  const visibleAgents = pinnedAgents.length > 0 ? pinnedAgents : agents
  const selectedAgent = useMemo(
    () => visibleAgents.find((agent) => agent.id === activeAgentId) ?? visibleAgents.at(-1) ?? null,
    [activeAgentId, visibleAgents]
  )
  const stats = useMemo(() => agentStats(agents), [agents])
  const recentEvents = useMemo(() => events.slice(-4).reverse(), [events])
  const selectedEvent = useMemo(
    () => events.find((record) => record.id === selectedEventId) ?? recentEvents[0] ?? null,
    [events, recentEvents, selectedEventId]
  )

  return (
    <section
      className="flex flex-col min-w-0 overflow-hidden"
      style={{
        width: embedded ? '100%' : 420,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        background: 'var(--surface-bg)'
      }}
    >
      {!embedded && (
        <PanelHeader
          title="Agent Activity"
          subtitle="Subagents, side tasks, and transcript handoffs."
          actions={<MetricPill tone={stats.active > 0 ? 'success' : 'neutral'}>{stats.total} total</MetricPill>}
        />
      )}

      {(!embedded || stats.total > 0) && <AgentOverview stats={stats} embedded={embedded} />}
      <SessionContextSummary
        session={session}
        stats={stats}
        events={events}
        recentEvents={recentEvents}
        rawLog={rawLog}
        selectedEventId={selectedEvent?.id ?? null}
        selectedEvent={selectedEvent}
        embedded={embedded}
        onSelectEvent={setSelectedEventId}
      />

      {visibleAgents.length === 0 ? (
        <EmptyState providerId={session.provider ?? 'provider'} embedded={embedded} hasEvents={events.length > 0} />
      ) : (
        <div className="flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="shrink-0 overflow-x-auto overflow-y-hidden px-2 py-2"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex min-w-0 gap-1.5">
              {visibleAgents.map((agent) => (
                <AgentTab
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgent?.id}
                  onClick={() => setActiveAgent(session.id, agent.id)}
                  onClose={openAgentIds.includes(agent.id) ? () => closeAgentTab(session.id, agent.id) : undefined}
                />
              ))}
            </div>
          </div>

          {selectedAgent && <AgentConversation agent={selectedAgent} events={events} />}
        </div>
      )}
    </section>
  )
}

function AgentOverview({
  stats,
  embedded = false
}: {
  stats: ReturnType<typeof agentStats>
  embedded?: boolean
}): JSX.Element {
  return (
    <div
      className={`shrink-0 grid grid-cols-4 gap-1.5 ${embedded ? 'px-2 py-2' : 'px-4 py-3'}`}
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <AgentStat label="Active" value={stats.active} tone="var(--color-green)" />
      <AgentStat label="Waiting" value={stats.waiting} tone="var(--color-yellow)" />
      <AgentStat label="Done" value={stats.completed} tone="var(--color-accent)" />
      <AgentStat label="Issues" value={stats.issues} tone="#EF4444" />
    </div>
  )
}

function AgentStat({ label, value, tone }: { label: string; value: number; tone: string }): JSX.Element {
  return (
    <InspectorCard
      className="rounded-md px-2 py-1.5 min-w-0"
    >
      <div
        className="truncate text-[11px] font-semibold tracking-normal"
        data-testid="agent-stat-label"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </div>
      <div className="text-xs font-semibold" style={{ color: value > 0 ? tone : 'var(--color-text-muted)' }}>
        {value}
      </div>
    </InspectorCard>
  )
}

function SessionContextSummary({
  session,
  stats,
  events,
  recentEvents,
  rawLog,
  selectedEventId,
  selectedEvent,
  onSelectEvent,
  embedded = false
}: {
  session: Session
  stats: ReturnType<typeof agentStats>
  events: SessionRunEventRecord[]
  recentEvents: SessionRunEventRecord[]
  rawLog: string
  selectedEventId: string | null
  selectedEvent: SessionRunEventRecord | null
  onSelectEvent: (id: string) => void
  embedded?: boolean
}): JSX.Element {
  const [eventQuery, setEventQuery] = useState('')
  const [eventSeverityFilter, setEventSeverityFilter] = useState<EventSeverityFilter>('all')
  const [eventSourceFilter, setEventSourceFilter] = useState<EventSourceFilter>('all')
  const messageCount = session.messageCount ?? session.messages.length
  const workDirLabel = compactPath(session.workDir)
  const transportLines = useMemo(() => transportLogLines(rawLog), [rawLog])
  const visibleEvents = useMemo(() => {
    const query = eventQuery.trim().toLowerCase()
    const hasActiveFilter = eventSeverityFilter !== 'all' || eventSourceFilter !== 'all'
    const candidates = query || hasActiveFilter
      ? events.slice().reverse()
      : recentEvents
    return candidates
      .filter((record) => eventMatchesSeverityFilter(record, eventSeverityFilter))
      .filter((record) => eventMatchesSourceFilter(record, eventSourceFilter))
      .filter((record) => !query || eventSearchText(record).includes(query))
      .slice(0, query || hasActiveFilter ? 8 : 4)
  }, [eventQuery, eventSeverityFilter, eventSourceFilter, events, recentEvents])
  const issueEvents = useMemo(() => (
    events
      .slice()
      .reverse()
      .filter(isRuntimeIssueEvent)
      .slice(0, 4)
  ), [events])
  const runtimeIssueCounts = useMemo(() => {
    return issueEvents.reduce((counts, record) => {
      if (eventTone(record) === 'danger') counts.failures += 1
      else counts.waiting += 1
      return counts
    }, { failures: 0, waiting: 0 })
  }, [issueEvents])
  const failureCauseGroups = useMemo(() => groupFailureCauses(issueEvents), [issueEvents])

  return (
    <div
      className={`grid shrink-0 gap-2 ${embedded ? 'px-2 py-2' : 'px-4 py-3'}`}
      data-testid="agent-session-context"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <InspectorSection title="Session" variant="raised">
        <InspectorRow dataTestId="agent-session-runtime">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              {[session.provider, session.model].filter(Boolean).join(' · ') || 'Runtime'}
            </div>
            <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              {workDirLabel}
            </div>
          </div>
          <Badge tone={sessionStatusTone(session.status)}>{session.status}</Badge>
        </InspectorRow>
        <div className="grid grid-cols-3 gap-1.5">
          <CompactMetric label="Messages" value={messageCount} />
          <CompactMetric label="Events" value={events.length} />
          <CompactMetric label="Agents" value={stats.total} />
        </div>
      </InspectorSection>

      {issueEvents.length > 0 && (
        <InspectorSection
          title="Runtime issues"
          dataTestId="agent-runtime-issues"
          className="gap-2"
        >
          <div
            className="grid grid-cols-2 gap-1.5"
            data-testid="agent-runtime-issue-summary"
            data-agent-runtime-issue-count={issueEvents.length}
            data-agent-runtime-failure-count={runtimeIssueCounts.failures}
            data-agent-runtime-waiting-count={runtimeIssueCounts.waiting}
          >
            <CompactMetric label="Failures" value={runtimeIssueCounts.failures} />
            <CompactMetric label="Waiting" value={runtimeIssueCounts.waiting} />
          </div>
          {failureCauseGroups.length > 0 && (
            <div
              className="grid gap-1.5"
              data-testid="agent-runtime-failure-groups"
              data-agent-runtime-failure-group-count={failureCauseGroups.length}
            >
              {failureCauseGroups.map((group) => (
                <InspectorRow
                  key={group.cause}
                  variant="muted"
                  dataTestId="agent-runtime-failure-group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
                      {group.cause}
                    </div>
                    <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {group.latest}
                    </div>
                  </div>
                  <Badge tone="danger">{group.count}</Badge>
                </InspectorRow>
              ))}
            </div>
          )}
          <div className="grid gap-1.5">
            {issueEvents.map((record) => (
              <button
                key={record.id}
                type="button"
                className="orchestrator-inspector-row text-left"
                data-inspector-row="true"
                data-inspector-row-variant="muted"
                data-testid="agent-runtime-issue"
                data-agent-event-selected={selectedEventId === record.id ? 'true' : 'false'}
                onClick={() => onSelectEvent(record.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {eventTitle(record)}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {formatClockTime(record.timestamp)}
                  </div>
                </div>
                <Badge tone={eventTone(record)}>{eventBadge(record)}</Badge>
              </button>
            ))}
          </div>
        </InspectorSection>
      )}

      {transportLines.length > 0 && (
        <InspectorSection
          title="Transport log"
          dataTestId="agent-transport-log"
          className="gap-1.5"
        >
          <div
            className="grid gap-1.5"
            data-testid="agent-transport-log-list"
            data-agent-transport-log-bytes={rawLog.length}
            data-agent-transport-log-lines={transportLines.length}
          >
            {transportLines.map((line, index) => (
              <InspectorRow
                key={`${line.label}-${index}`}
                variant="muted"
                dataTestId="agent-transport-log-line"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {line.label}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {line.preview}
                  </div>
                </div>
                <Badge tone="neutral">raw</Badge>
              </InspectorRow>
            ))}
          </div>
        </InspectorSection>
      )}

      {recentEvents.length > 0 && (
        <InspectorSection
          title="Recent activity"
          dataTestId="agent-recent-events"
          className="gap-2"
        >
          <WorkbenchSearchField
            value={eventQuery}
            onChange={setEventQuery}
            placeholder="Search runtime events"
            clearLabel="Clear runtime event search"
            dataTestId="agent-event-search"
            clearDataTestId="agent-event-search-clear"
            className="w-full"
            inputClassName="text-[11px]"
            ariaLabel="Search runtime events"
          />
          <div
            className="grid grid-cols-2 gap-1.5"
            data-testid="agent-event-filter-controls"
            data-agent-event-severity-filter={eventSeverityFilter}
            data-agent-event-source-filter={eventSourceFilter}
          >
            <EventFilterSelect<EventSeverityFilter>
              label="Severity"
              value={eventSeverityFilter}
              dataTestId="agent-event-severity-filter"
              onChange={setEventSeverityFilter}
              options={[
                { value: 'all', label: 'All severities' },
                { value: 'issues', label: 'Issues only' },
                { value: 'failures', label: 'Failures' },
                { value: 'waiting', label: 'Waiting' }
              ]}
            />
            <EventFilterSelect<EventSourceFilter>
              label="Source"
              value={eventSourceFilter}
              dataTestId="agent-event-source-filter"
              onChange={setEventSourceFilter}
              options={[
                { value: 'all', label: 'All sources' },
                { value: 'agents', label: 'Agents' },
                { value: 'tools', label: 'Tools' },
                { value: 'approvals', label: 'Approvals' },
                { value: 'connection', label: 'Connection' }
              ]}
            />
          </div>
          <div
            className="grid gap-1.5"
            data-testid="agent-recent-event-list"
            data-agent-event-filtered-count={visibleEvents.length}
            data-agent-event-query-active={eventQuery.trim() ? 'true' : 'false'}
            data-agent-event-severity-filter={eventSeverityFilter}
            data-agent-event-source-filter={eventSourceFilter}
          >
            {visibleEvents.length > 0 ? visibleEvents.map((record) => (
              <button
                key={record.id}
                type="button"
                className="orchestrator-inspector-row text-left"
                data-inspector-row="true"
                data-inspector-row-variant="muted"
                data-testid="agent-recent-event"
                data-agent-event-selected={selectedEventId === record.id ? 'true' : 'false'}
                onClick={() => onSelectEvent(record.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
                    {eventTitle(record)}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                    {formatClockTime(record.timestamp)}
                  </div>
                </div>
                <Badge tone={eventTone(record)}>{eventBadge(record)}</Badge>
              </button>
            )) : (
              <div
                className="rounded-md px-2 py-1.5 text-[11px]"
                data-testid="agent-recent-event-empty"
                style={{
                  background: 'var(--surface-muted)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                No matching runtime events.
              </div>
            )}
          </div>
        </InspectorSection>
      )}

      {selectedEvent && (
        <EventDetailCard record={selectedEvent} />
      )}
    </div>
  )
}

function EventDetailCard({ record }: { record: SessionRunEventRecord }): JSX.Element {
  const payload = compactJson(record.event)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const copyPayload = (): void => {
    const writeText = window.api.clipboard?.writeText
      ? window.api.clipboard.writeText(payload).then(() => undefined)
      : navigator.clipboard.writeText(payload)
    void writeText
      .then(() => setCopyStatus('Event payload copied'))
      .catch(() => setCopyStatus('Unable to copy event payload'))
  }

  return (
    <InspectorSection title="Event detail" dataTestId="agent-event-detail">
      <InspectorRow dataTestId="agent-event-detail-summary" variant="muted">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
            {eventTitle(record)}
          </div>
          <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {formatClockTime(record.timestamp)}
          </div>
        </div>
        <Badge tone={eventTone(record)}>{record.event.type}</Badge>
      </InspectorRow>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-[11px] font-semibold"
          data-testid="agent-event-detail-copy"
          onClick={copyPayload}
          style={{
            color: 'var(--color-text)',
            background: 'var(--control-bg)',
            borderColor: 'var(--border-subtle)'
          }}
        >
          Copy payload
        </button>
        {copyStatus && (
          <span
            className="min-w-0 truncate rounded-md px-2 py-1 text-[11px]"
            data-testid="agent-event-detail-copy-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              color: copyStatus.startsWith('Unable') ? 'var(--state-danger)' : 'var(--accent)',
              background: copyStatus.startsWith('Unable')
                ? 'color-mix(in srgb, var(--state-danger) 8%, var(--surface-bg))'
                : 'color-mix(in srgb, var(--accent) 8%, var(--surface-bg))',
              border: '1px solid var(--border-subtle)'
            }}
          >
            {copyStatus}
          </span>
        )}
      </div>
      <pre
        className="m-0 max-h-32 overflow-auto rounded-md px-2 py-1.5 text-[11px]"
        data-testid="agent-event-detail-payload"
        style={{
          background: 'color-mix(in srgb, var(--surface-bg) 86%, var(--canvas-bg))',
          border: '1px solid var(--border-subtle)',
          color: 'var(--color-text-muted)',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere'
        }}
      >
        {payload}
      </pre>
    </InspectorSection>
  )
}

function transportLogLines(rawLog: string): Array<{ label: string; preview: string }> {
  return rawLog
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .map((line) => ({
      label: transportLogLabel(line),
      preview: compactText(transportLogPreview(line))
    }))
}

function transportLogLabel(line: string): string {
  try {
    const parsed = JSON.parse(line) as unknown
    if (!parsed || typeof parsed !== 'object') return 'Provider output'
    const record = parsed as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : null
    const subtype = typeof record.subtype === 'string' ? record.subtype : null
    if (type && subtype) return `${type}.${subtype}`
    if (type) return type
  } catch {
    // Non-JSON stdout/stderr remains useful as raw transport context.
  }
  return 'Provider output'
}

function transportLogPreview(line: string): string {
  try {
    const parsed = JSON.parse(line) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (typeof record.content === 'string') return redactTransportLogLine(record.content)
      const message = record.message
      if (message && typeof message === 'object') {
        const content = (message as Record<string, unknown>).content
        if (typeof content === 'string') return redactTransportLogLine(content)
      }
      const sessionId = typeof record.session_id === 'string' ? record.session_id : null
      const redacted = redactTransportLogLine(line)
      if (sessionId) {
        return redacted.includes('[redacted]')
          ? `session ${sessionId} · [redacted]`
          : `session ${sessionId}`
      }
      return redacted
    }
  } catch {
    // Fall through to redacted raw text.
  }
  return redactTransportLogLine(line)
}

function redactTransportLogLine(line: string): string {
  return line
    .replace(/(api[_-]?key|token|secret|password)(["'\s:=]+)([^"',\s}]+)/gi, '$1$2[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-[redacted]')
}

function CompactMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <InspectorCard className="rounded-md px-2 py-1.5 min-w-0">
      <div className="truncate text-[10.5px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </div>
      <div className="truncate text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
        {value}
      </div>
    </InspectorCard>
  )
}

function EventFilterSelect<T extends string>({
  label,
  value,
  options,
  dataTestId,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  dataTestId: string
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="truncate text-[10.5px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <select
        value={value}
        data-testid={dataTestId}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-7 min-w-0 rounded-md px-2 text-[11px] font-medium outline-none"
        style={{
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--color-text)'
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function EmptyState({
  providerId,
  embedded = false,
  hasEvents = false
}: {
  providerId: string
  embedded?: boolean
  hasEvents?: boolean
}): JSX.Element {
  const title = embedded ? 'No agents yet' : 'No agent activity yet'
  const body = embedded
    ? hasEvents
      ? 'This session has runtime activity, but no subagent transcript has been opened yet.'
      : 'Session diagnostics are available above. Agent transcripts will appear here when a side task starts.'
    : `When ${providerId} starts a subagent or side task, its status and transcript will appear here.`

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3" data-testid="agent-empty-state">
      <InspectorCard className="p-3">
        <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
          {title}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
          {body}
        </div>
      </InspectorCard>
    </div>
  )
}

function sessionStatusTone(status: Session['status']): 'accent' | 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'running') return 'success'
  if (status === 'waiting_for_permission' || status === 'waiting_for_user') return 'warning'
  if (status === 'provider_error' || status === 'auth_error' || status === 'model_error' || status === 'quota_error' || status === 'rate_limit_error' || status === 'error') return 'danger'
  if (status === 'idle') return 'accent'
  return 'neutral'
}

function eventTone(record: SessionRunEventRecord): 'accent' | 'success' | 'warning' | 'danger' | 'neutral' {
  const { type } = record.event
  if (type === 'run.failed' || type === 'agent.failed') return 'danger'
  if (type === 'tool.completed' && record.event.isError) return 'danger'
  if (type === 'permission.requested' || type === 'user_input.requested' || type === 'connection.reconnecting' || type === 'connection.retrying') return 'warning'
  if (type === 'run.completed' || type === 'agent.completed' || type === 'tool.completed') return 'success'
  if (type.startsWith('assistant.') || type.startsWith('agent.')) return 'accent'
  return 'neutral'
}

function eventBadge(record: SessionRunEventRecord): string {
  return record.event.type.split('.')[0]
}

function isRuntimeIssueEvent(record: SessionRunEventRecord): boolean {
  const { event } = record
  if (event.type === 'run.failed' || event.type === 'agent.failed') return true
  if (event.type === 'tool.completed') return event.isError
  return event.type === 'permission.requested' ||
    event.type === 'user_input.requested' ||
    event.type === 'connection.reconnecting' ||
    event.type === 'connection.retrying'
}

function groupFailureCauses(records: SessionRunEventRecord[]): Array<{ cause: string; count: number; latest: string; timestamp: number }> {
  const groups = new Map<string, { cause: string; count: number; latest: string; timestamp: number }>()
  for (const record of records) {
    if (eventTone(record) !== 'danger') continue
    const cause = failureCause(record)
    const previous = groups.get(cause)
    if (!previous || record.timestamp > previous.timestamp) {
      groups.set(cause, {
        cause,
        count: (previous?.count ?? 0) + 1,
        latest: failureDetail(record),
        timestamp: record.timestamp
      })
    } else {
      previous.count += 1
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.timestamp - a.timestamp)
}

function failureCause(record: SessionRunEventRecord): string {
  const { event } = record
  if (event.type === 'tool.completed' && event.isError) return `Tool: ${event.toolUseId}`
  if (event.type === 'agent.failed') return 'Agent failed'
  if (event.type === 'run.failed') return 'Provider run'
  return 'Failure'
}

function failureDetail(record: SessionRunEventRecord): string {
  const { event } = record
  if (event.type === 'tool.completed' && event.isError) return compactText(event.content)
  if (event.type === 'agent.failed') return event.agent.summary ?? event.agent.name ?? event.agent.id
  if (event.type === 'run.failed') return event.content ?? 'Run failed'
  return eventTitle(record)
}

function eventMatchesSeverityFilter(record: SessionRunEventRecord, filter: EventSeverityFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'issues') return isRuntimeIssueEvent(record)
  const tone = eventTone(record)
  if (filter === 'failures') return tone === 'danger'
  return tone === 'warning'
}

function eventMatchesSourceFilter(record: SessionRunEventRecord, filter: EventSourceFilter): boolean {
  if (filter === 'all') return true
  const { type } = record.event
  if (filter === 'agents') return type.startsWith('agent.')
  if (filter === 'tools') return type.startsWith('tool.')
  if (filter === 'approvals') return type === 'permission.requested' || type === 'user_input.requested'
  return type === 'connection.reconnecting' || type === 'connection.retrying'
}

function eventTitle(record: SessionRunEventRecord): string {
  const { event } = record
  if (event.type === 'assistant.status') return event.content || 'Assistant status'
  if (event.type === 'assistant.text' || event.type === 'assistant.text.delta') return compactText(event.content)
  if (event.type === 'tool.started') return `Started ${event.toolName}`
  if (event.type === 'tool.completed') return event.isError ? 'Tool failed' : 'Tool completed'
  if (event.type === 'agent.started' || event.type === 'agent.updated' || event.type === 'agent.completed' || event.type === 'agent.failed') {
    return event.agent.name ?? event.agent.role ?? event.agent.id
  }
  if (event.type === 'permission.requested') return event.content ?? 'Permission requested'
  if (event.type === 'user_input.requested') return event.content
  if (event.type === 'run.failed') return event.content ?? 'Run failed'
  if (event.type === 'run.completed') return event.content ?? 'Run completed'
  return event.type.replace(/\./g, ' ')
}

function eventSearchText(record: SessionRunEventRecord): string {
  return [
    record.event.type,
    eventTitle(record),
    compactJson(record.event)
  ].join('\n').toLowerCase()
}

function compactPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 3) return path || 'Workspace'
  return `.../${parts.slice(-3).join('/')}`
}

function compactText(text: string): string {
  const compacted = text.replace(/\s+/g, ' ').trim()
  if (compacted.length <= 72) return compacted || 'Assistant update'
  return `${compacted.slice(0, 69)}...`
}

function compactJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2) ?? ''
  if (serialized.length <= 1400) return serialized
  return `${serialized.slice(0, 1397)}...`
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function agentStats(agents: AgentNode[]): {
  total: number
  active: number
  waiting: number
  completed: number
  issues: number
} {
  return agents.reduce((current, agent) => {
    current.total += 1
    if (agent.status === 'running' || agent.status === 'queued') current.active += 1
    if (agent.status === 'waiting' || agent.status === 'blocked') current.waiting += 1
    if (agent.status === 'completed') current.completed += 1
    if (agent.status === 'failed' || agent.status === 'cancelled') current.issues += 1
    return current
  }, { total: 0, active: 0, waiting: 0, completed: 0, issues: 0 })
}

function AgentTab({
  agent,
  active,
  onClick,
  onClose
}: {
  agent: AgentNode
  active: boolean
  onClick: () => void
  onClose?: () => void
}): JSX.Element {
  return (
    <TabButton
      active={active}
      onClick={onClick}
      onClose={onClose}
      closeLabel="Close transcript"
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <StatusDot status={agent.status} />
        <span className="min-w-0 truncate">{agent.name ?? agent.role ?? agent.id}</span>
      </span>
    </TabButton>
  )
}

function AgentConversation({ agent, events }: { agent: AgentNode; events: SessionRunEventRecord[] }): JSX.Element {
  const transcript = agent.transcript?.trim()
  const summary = agent.summary?.trim()
  const displaySummary = summary && summary !== agent.role && summary !== agent.name ? summary : undefined
  const timelineEvents = useMemo(() => selectedAgentTimeline(agent, events), [agent, events])

  return (
    <div
      className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3"
      data-testid="agent-selected-conversation"
      data-agent-id={agent.id}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot status={agent.status} />
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              {agent.name ?? agent.role ?? agent.id}
            </h3>
            <Badge tone={agentStatusTone(agent.status)}>{agent.status}</Badge>
          </div>
          {(agent.role || agent.model || agent.providerId) && (
            <div className="text-xs mt-1 truncate" style={{ color: 'var(--color-text-muted)' }}>
              {[agent.role, agent.model, agent.providerId].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {timelineEvents.length > 0 && <AgentTimeline agent={agent} events={timelineEvents} />}

      {transcript ? (
        <TranscriptBlock content={transcript} />
      ) : displaySummary ? (
        <TranscriptBlock content={displaySummary} muted />
      ) : (
        <EmptyText>Waiting for transcript text from this agent.</EmptyText>
      )}
    </div>
  )
}

function AgentTimeline({ agent, events }: { agent: AgentNode; events: SessionRunEventRecord[] }): JSX.Element {
  return (
    <InspectorSection
      title="Timeline"
      className="mt-3 gap-1.5"
      dataTestId="agent-selected-timeline"
    >
      <div
        className="grid gap-1.5"
        data-testid="agent-selected-timeline-list"
        data-agent-id={agent.id}
        data-agent-timeline-count={events.length}
      >
        {events.map((record) => (
          <InspectorRow
            key={record.id}
            variant="muted"
            dataTestId="agent-selected-timeline-event"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--color-text)' }}>
                {agentTimelineTitle(record)}
              </div>
              <div className="truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                {formatClockTime(record.timestamp)}
              </div>
            </div>
            <Badge tone={eventTone(record)}>{eventBadge(record)}</Badge>
          </InspectorRow>
        ))}
      </div>
    </InspectorSection>
  )
}

function TranscriptBlock({ content, muted = false }: { content: string; muted?: boolean }): JSX.Element {
  return (
    <InspectorCard
      className="mt-3 rounded-md p-3 text-sm"
      style={{
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        color: muted ? 'var(--color-text-muted)' : 'var(--color-text)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word'
      }}
    >
      {content}
    </InspectorCard>
  )
}

function selectedAgentTimeline(agent: AgentNode, events: SessionRunEventRecord[]): SessionRunEventRecord[] {
  return events
    .filter((record) => eventBelongsToAgent(record, agent.id))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-6)
}

function eventBelongsToAgent(record: SessionRunEventRecord, agentId: string): boolean {
  const { event } = record
  if (
    event.type === 'agent.started' ||
    event.type === 'agent.updated' ||
    event.type === 'agent.completed' ||
    event.type === 'agent.failed'
  ) {
    return event.agent.id === agentId
  }
  if (event.type === 'agent.text.delta' || event.type === 'agent.text.completed') return event.agentId === agentId
  if (event.type === 'tool.started') return event.id === agentId
  if (event.type === 'tool.completed') return event.toolUseId === agentId
  return false
}

function agentTimelineTitle(record: SessionRunEventRecord): string {
  const { event } = record
  if (event.type === 'agent.text.delta') return compactText(event.content)
  if (event.type === 'agent.text.completed') return 'Agent text completed'
  return eventTitle(record)
}

function agentStatusTone(status: AgentStatus): 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'running') return 'success'
  if (status === 'waiting' || status === 'blocked' || status === 'queued') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'accent'
}

function EmptyText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-xs p-3 min-w-0" style={{ color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
      {children}
    </div>
  )
}

function StatusDot({ status }: { status: AgentStatus }): JSX.Element {
  return (
    <span
      className="rounded-full shrink-0"
      style={{
        width: 7,
        height: 7,
        background: agentStatusColor(status),
        opacity: status === 'completed' ? 0.8 : 1,
        animation: status === 'running' ? 'statusPulse 1.5s ease-in-out infinite' : 'none'
      }}
    />
  )
}

function agentStatusColor(status: AgentStatus): string {
  if (status === 'running') return 'var(--color-green)'
  if (status === 'waiting' || status === 'blocked' || status === 'queued') return 'var(--color-yellow)'
  if (status === 'failed' || status === 'cancelled') return 'var(--color-red)'
  return 'var(--color-accent)'
}
