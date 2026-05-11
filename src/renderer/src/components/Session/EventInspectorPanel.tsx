import { useMemo, useState } from 'react'
import { useSessionStore } from '../../store/sessions'
import { agentDepth, deriveAgentNodes, derivePlanStates, eventCounts } from '../../types'
import type { AgentNode, AgentStatus, PlanState, Session, SessionRunEventRecord } from '../../types'

interface Props {
  session: Session
  embedded?: boolean
  activeAgentId?: string | null
}

type InspectorTab = 'agents' | 'plans' | 'events' | 'raw'

export default function EventInspectorPanel({ session, embedded = false, activeAgentId = null }: Props): JSX.Element {
  const { rawBuffers, eventBuffers } = useSessionStore()
  const [tab, setTab] = useState<InspectorTab>('agents')
  const sessionId = session.id
  const events = eventBuffers[sessionId] ?? []
  const raw = rawBuffers[sessionId] ?? ''
  const rawLines = useMemo(() => raw.split('\n').filter((line) => line.trim()).slice(-200), [raw])
  const counts = useMemo(() => eventCounts(events), [events])
  const agents = useMemo(() => deriveAgentNodes(session, events), [session, events])
  const plans = useMemo(() => derivePlanStates(session, events), [session, events])

  return (
    <aside
      className="w-[420px] shrink-0 flex flex-col"
      style={{
        width: embedded ? '100%' : 420,
        height: embedded ? '100%' : undefined,
        background: 'var(--color-surface)',
        borderLeft: embedded ? 'none' : '1px solid var(--color-border)'
      }}
    >
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              Provider Events
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
              {events.length} parsed · {rawLines.length} raw lines
            </div>
          </div>
          <div className="flex gap-1">
            <TabButton active={tab === 'agents'} onClick={() => setTab('agents')}>Agents</TabButton>
            <TabButton active={tab === 'plans'} onClick={() => setTab('plans')}>Plans</TabButton>
            <TabButton active={tab === 'events'} onClick={() => setTab('events')}>Events</TabButton>
            <TabButton active={tab === 'raw'} onClick={() => setTab('raw')}>Raw</TabButton>
          </div>
        </div>
        {Object.keys(counts).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(counts).map(([type, count]) => (
              <span
                key={type}
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-surface2)',
                  border: '1px solid var(--color-border)',
                  fontSize: 10
                }}
              >
                {type} {count}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-2">
        {tab === 'agents' ? (
          agents.length === 0 ? (
            <EmptyText>No agent activity yet.</EmptyText>
          ) : (
            <AgentTree agents={agents} activeAgentId={activeAgentId} />
          )
        ) : tab === 'plans' ? (
          plans.length === 0 ? (
            <EmptyText>No plans yet.</EmptyText>
          ) : (
            <PlanList plans={plans} />
          )
        ) : tab === 'events' ? (
          events.length === 0 ? (
            <EmptyText>No parsed events yet.</EmptyText>
          ) : (
            <div className="space-y-2">
              {events.map((record) => <EventCard key={record.id} record={record} />)}
            </div>
          )
        ) : rawLines.length === 0 ? (
          <EmptyText>No raw output yet.</EmptyText>
        ) : (
          <pre
            className="text-xs whitespace-pre-wrap break-words"
            style={{ color: 'var(--color-text-muted)', fontSize: 10, lineHeight: 1.45 }}
          >
            {rawLines.join('\n')}
          </pre>
        )}
      </div>
    </aside>
  )
}

function AgentTree({ agents, activeAgentId }: { agents: AgentNode[]; activeAgentId?: string | null }): JSX.Element {
  const childCount = new Map<string, number>()
  for (const agent of agents) {
    if (agent.parentAgentId) childCount.set(agent.parentAgentId, (childCount.get(agent.parentAgentId) ?? 0) + 1)
  }

  return (
    <div className="space-y-2">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          depth={agentDepth(agent, agents)}
          childCount={childCount.get(agent.id) ?? 0}
          active={agent.id === activeAgentId}
        />
      ))}
    </div>
  )
}

function AgentCard({
  agent,
  depth,
  childCount,
  active
}: {
  agent: AgentNode
  depth: number
  childCount: number
  active: boolean
}): JSX.Element {
  return (
    <div
      className="rounded-lg p-2"
      style={{
        marginLeft: depth * 14,
        background: active ? 'var(--color-accent-dim)' : 'var(--color-surface2)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)'
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot status={agent.status} />
            <span className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              {agent.name ?? agent.role ?? agent.id}
            </span>
          </div>
          <div className="text-xs mt-1 truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
            {agent.role ?? agent.model ?? agent.providerId}
            {childCount > 0 ? ` · ${childCount} child${childCount === 1 ? '' : 'ren'}` : ''}
          </div>
        </div>
        <span
          className="rounded px-1.5 py-0.5 text-xs shrink-0"
          style={{
            color: agentStatusColor(agent.status),
            border: `1px solid ${agentStatusColor(agent.status)}`,
            fontSize: 10
          }}
        >
          {agent.status}
        </span>
      </div>
      {agent.summary && (
        <div className="text-xs mt-2" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
          {agent.summary}
        </div>
      )}
      {agent.transcript && agent.transcript !== agent.summary && (
        <div
          className="text-xs mt-2 rounded-md p-2"
          style={{
            color: 'var(--color-text)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap'
          }}
        >
          {agent.transcript}
        </div>
      )}
    </div>
  )
}

function PlanList({ plans }: { plans: PlanState[] }): JSX.Element {
  return (
    <div className="space-y-2">
      {plans.map((plan, index) => (
        <div
          key={`${plan.sessionId}-${index}`}
          className="rounded-lg p-2"
          style={{
            background: 'var(--color-surface2)',
            border: '1px solid var(--color-border)'
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
              {plan.title ?? (plan.mode === 'plan' ? 'Plan mode' : 'Plan')}
            </div>
            {plan.mode && (
              <span
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  color: plan.mode === 'plan' ? 'var(--color-yellow)' : 'var(--color-green)',
                  border: `1px solid ${plan.mode === 'plan' ? 'var(--color-yellow)' : 'var(--color-green)'}`,
                  fontSize: 10
                }}
              >
                {plan.mode}
              </span>
            )}
          </div>
          {plan.summary && (
            <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
              {plan.summary}
            </div>
          )}
          {plan.items.length > 0 && (
            <div className="mt-2 space-y-1">
              {plan.items.map((item) => (
                <div key={item.id ?? item.content} className="flex items-start gap-2 text-xs">
                  <StatusDot status={item.status === 'in_progress' ? 'running' : item.status === 'blocked' ? 'blocked' : item.status === 'completed' ? 'completed' : 'queued'} />
                  <span className="min-w-0 flex-1" style={{ color: 'var(--color-text)' }}>
                    {item.content}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function EventCard({ record }: { record: SessionRunEventRecord }): JSX.Element {
  return (
    <div
      className="rounded-lg p-2"
      style={{
        background: 'var(--color-surface2)',
        border: '1px solid var(--color-border)'
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium" style={{ color: eventColor(record.event.type) }}>
          {record.event.type}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          {new Date(record.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <pre
        className="text-xs whitespace-pre-wrap break-words"
        style={{ color: 'var(--color-text-muted)', fontSize: 10, lineHeight: 1.45 }}
      >
        {JSON.stringify(record.event, null, 2)}
      </pre>
    </div>
  )
}

function TabButton({
  children,
  active,
  onClick
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded px-2 py-1 text-xs"
      style={{
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        background: active ? 'var(--color-accent-dim)' : 'var(--color-surface2)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`
      }}
    >
      {children}
    </button>
  )
}

function EmptyText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-xs p-2" style={{ color: 'var(--color-text-muted)' }}>
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

function eventColor(type: string): string {
  if (type.startsWith('run.failed') || type.startsWith('permission')) return 'var(--color-yellow)'
  if (type.startsWith('tool')) return 'var(--color-accent)'
  if (type.startsWith('run.completed')) return 'var(--color-green)'
  return 'var(--color-text)'
}
