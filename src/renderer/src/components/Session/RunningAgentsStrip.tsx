import { useMemo } from 'react'
import { useSessionStore } from '../../store/sessions'
import { deriveAgentNodes } from '../../types'
import type { AgentNode, Session } from '../../types'

interface Props {
  session: Session
}

const LIVE_STATUSES = new Set(['queued', 'running', 'waiting', 'blocked'])

export default function RunningAgentsStrip({ session }: Props): JSX.Element | null {
  const { eventBuffers, setActiveAgent } = useSessionStore()
  const events = eventBuffers[session.id] ?? []
  const agents = useMemo(
    () => deriveAgentNodes(session, events).filter((agent) => LIVE_STATUSES.has(agent.status)),
    [events, session]
  )

  if (agents.length === 0) return null

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-4 py-2 overflow-x-auto"
      style={{
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)'
      }}
    >
      <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
        Agents
      </span>
      {agents.map((agent) => (
        <AgentPill
          key={agent.id}
          agent={agent}
          onClick={() => setActiveAgent(session.id, agent.id)}
        />
      ))}
    </div>
  )
}

function AgentPill({ agent, onClick }: { agent: AgentNode; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={agent.summary ?? agent.role ?? agent.name ?? agent.id}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs shrink-0"
      style={{
        background: 'var(--color-surface2)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        maxWidth: 220
      }}
    >
      <span
        className="rounded-full shrink-0"
        style={{
          width: 7,
          height: 7,
          background: statusColor(agent.status),
          animation: agent.status === 'running' ? 'statusPulse 1.5s ease-in-out infinite' : 'none'
        }}
      />
      <span className="truncate">
        {agent.name ?? agent.role ?? agent.id}
      </span>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
        {agent.status}
      </span>
    </button>
  )
}

function statusColor(status: AgentNode['status']): string {
  if (status === 'running') return 'var(--color-green)'
  if (status === 'waiting' || status === 'blocked') return 'var(--color-yellow)'
  if (status === 'failed' || status === 'cancelled') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}
