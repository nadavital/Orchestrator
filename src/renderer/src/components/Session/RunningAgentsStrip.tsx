import { useMemo } from 'react'
import { useSessionStore } from '../../store/sessions'
import type { AgentNode, Session } from '../../types'
import { deriveSessionAgentNodes } from './agentNodes'

interface Props {
  sessionId: string
}

const LIVE_STATUSES = new Set(['queued', 'running', 'waiting', 'blocked'])

export default function RunningAgentsStrip({ sessionId }: Props): JSX.Element | null {
  const session = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId))
  if (!session) return null
  return <RunningAgentsStripContent session={session} />
}

function RunningAgentsStripContent({ session }: { session: Session }): JSX.Element | null {
  const { eventBuffers, uiState, setActiveAgent } = useSessionStore()
  const events = eventBuffers[session.id] ?? []
  const activeAgentId = uiState[session.id]?.activeAgentId ?? null
  const agents = useMemo(
    () => deriveSessionAgentNodes(session, events).filter((agent) => LIVE_STATUSES.has(agent.status)),
    [events, session]
  )

  if (agents.length === 0) return null

  return (
    <div
      className="composer-live-agents-shell shrink-0 px-6 pt-2"
      style={{
        paddingRight: 'calc(1.5rem + var(--transcript-scrollbar-width, 0px))'
      }}
    >
      <div
        className="composer-live-agents-bar mx-auto"
        data-testid="running-agents-strip"
        style={{
          maxWidth: 'var(--composer-effective-column-max-width, var(--composer-column-max-width, 860px))'
        }}
      >
        <span className="composer-live-agents-label">Live</span>
        <div className="composer-live-agents-list" aria-label="Live agents">
          {agents.map((agent) => (
            <AgentPill
              key={agent.id}
              agent={agent}
              active={agent.id === activeAgentId}
              onClick={() => setActiveAgent(session.id, agent.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentPill({ agent, active, onClick }: { agent: AgentNode; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={agent.summary ?? agent.role ?? agent.name ?? agent.id}
      className="composer-live-agent-pill"
      data-active={active ? 'true' : 'false'}
      data-agent-status={agent.status}
      aria-pressed={active}
    >
      <span
        className="composer-live-agent-status"
        style={{
          background: statusColor(agent.status),
          animation: agent.status === 'running' ? 'statusPulse 1.5s ease-in-out infinite' : 'none'
        }}
      />
      <span className="composer-live-agent-name">
        {agent.name ?? agent.role ?? agent.id}
      </span>
      <span className="composer-live-agent-state">{statusLabel(agent.status)}</span>
    </button>
  )
}

function statusColor(status: AgentNode['status']): string {
  if (status === 'running') return 'var(--color-green)'
  if (status === 'waiting' || status === 'blocked') return 'var(--color-yellow)'
  if (status === 'failed' || status === 'cancelled') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}

function statusLabel(status: AgentNode['status']): string {
  if (status === 'running') return 'Running'
  if (status === 'waiting') return 'Waiting'
  if (status === 'blocked') return 'Blocked'
  if (status === 'queued') return 'Queued'
  return status
}
