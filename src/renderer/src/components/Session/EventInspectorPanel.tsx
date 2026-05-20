import { useMemo } from 'react'
import { useSessionStore } from '../../store/sessions'
import type { AgentNode, AgentStatus, Session } from '../../types'
import { Badge, InspectorCard, MetricPill, PanelHeader, TabButton } from '../shared/designSystem'
import { deriveSessionAgentNodes } from './agentNodes'

interface Props {
  session: Session
  embedded?: boolean
  activeAgentId?: string | null
}

export default function EventInspectorPanel({ session, embedded = false, activeAgentId = null }: Props): JSX.Element {
  const { eventBuffers, uiState, setActiveAgent, closeAgentTab } = useSessionStore()
  const events = eventBuffers[session.id] ?? []
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

      {visibleAgents.length === 0 ? (
        <EmptyState providerId={session.provider ?? 'provider'} embedded={embedded} />
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

          {selectedAgent && <AgentConversation agent={selectedAgent} />}
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

function EmptyState({ providerId, embedded = false }: { providerId: string; embedded?: boolean }): JSX.Element {
  const title = embedded ? 'No agents yet' : 'No agent activity yet'
  const body = embedded
    ? 'Agent transcripts will appear here.'
    : `When ${providerId} starts a subagent or side task, its status and transcript will appear here.`

  return (
    <div className="flex-1 min-h-0 p-3">
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

function AgentConversation({ agent }: { agent: AgentNode }): JSX.Element {
  const transcript = agent.transcript?.trim()
  const summary = agent.summary?.trim()
  const displaySummary = summary && summary !== agent.role && summary !== agent.name ? summary : undefined

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3">
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
