import { useMemo } from 'react'
import { useSessionStore } from '../../store/sessions'
import { agentDepth, deriveAgentNodes, deriveAgentNodesFromMessages } from '../../types'
import type { AgentNode, AgentStatus, Session } from '../../types'

interface Props {
  session: Session
  embedded?: boolean
  activeAgentId?: string | null
}

export default function EventInspectorPanel({ session, embedded = false, activeAgentId = null }: Props): JSX.Element {
  const { eventBuffers, setActiveAgent } = useSessionStore()
  const events = eventBuffers[session.id] ?? []
  const agents = useMemo(() => {
    const fromMessages = deriveAgentNodesFromMessages(session, session.messages)
    const byId = new Map(fromMessages.map((agent) => [agent.id, agent]))
    for (const agent of deriveAgentNodes(session, events)) {
      byId.set(agent.id, {
        ...byId.get(agent.id),
        ...agent,
        transcript: agent.transcript ?? byId.get(agent.id)?.transcript,
        summary: agent.summary ?? byId.get(agent.id)?.summary
      })
    }
    return [...byId.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  }, [events, session])
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? agents[0] ?? null,
    [activeAgentId, agents]
  )

  return (
    <section
      className="flex flex-col"
      style={{
        width: embedded ? '100%' : 420,
        height: embedded ? '100%' : undefined,
        background: 'var(--color-surface)'
      }}
    >
      <div className="shrink-0 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          {agents.length === 0
            ? 'No subagents'
            : `${agents.length} subagent${agents.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {agents.length === 0 ? (
        <EmptyText>No subagent activity yet.</EmptyText>
      ) : (
        <div className="flex flex-col min-h-0 flex-1">
          <div
            className="shrink-0 overflow-auto p-2"
            style={{ maxHeight: 190, borderBottom: '1px solid var(--color-border)' }}
          >
            <div className="space-y-1.5">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  depth={agentDepth(agent, agents)}
                  active={agent.id === selectedAgent?.id}
                  onClick={() => setActiveAgent(session.id, agent.id)}
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

function AgentRow({
  agent,
  depth,
  active,
  onClick
}: {
  agent: AgentNode
  depth: number
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md px-2 py-2 text-left"
      style={{
        marginLeft: depth * 12,
        width: `calc(100% - ${depth * 12}px)`,
        background: active ? 'var(--color-accent-dim)' : 'var(--color-surface2)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)'
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <StatusDot status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>
            {agent.name ?? agent.role ?? agent.id}
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
            {agent.summary ?? agent.role ?? agent.model ?? agent.status}
          </div>
        </div>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-xs"
          style={{
            color: agentStatusColor(agent.status),
            border: `1px solid ${agentStatusColor(agent.status)}`,
            fontSize: 10
          }}
        >
          {agent.status}
        </span>
      </div>
    </button>
  )
}

function AgentConversation({ agent }: { agent: AgentNode }): JSX.Element {
  const transcript = agent.transcript?.trim()
  const summary = agent.summary?.trim()
  const displaySummary = summary && summary !== agent.role && summary !== agent.name ? summary : undefined

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot status={agent.status} />
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              {agent.name ?? agent.role ?? agent.id}
            </h3>
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
        <EmptyText>No subagent transcript yet.</EmptyText>
      )}
    </div>
  )
}

function TranscriptBlock({ content, muted = false }: { content: string; muted?: boolean }): JSX.Element {
  return (
    <div
      className="mt-3 rounded-md p-3 text-sm"
      style={{
        color: muted ? 'var(--color-text-muted)' : 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere'
      }}
    >
      {content}
    </div>
  )
}

function EmptyText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-xs p-3" style={{ color: 'var(--color-text-muted)' }}>
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
