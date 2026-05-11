import { useMemo } from 'react'
import { useSessionStore } from '../../store/sessions'
import type { AgentNode, AgentStatus, Session } from '../../types'
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
  const openAgents = openAgentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentNode => Boolean(agent))
  const selectedAgent = useMemo(
    () => openAgents.find((agent) => agent.id === activeAgentId) ?? openAgents.at(-1) ?? null,
    [activeAgentId, openAgents]
  )

  return (
    <section
      className="flex flex-col min-w-0 overflow-hidden"
      style={{
        width: embedded ? '100%' : 420,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        background: 'var(--color-surface)'
      }}
    >
      <div className="shrink-0 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          Agent transcripts
        </div>
      </div>

      {openAgents.length === 0 ? (
        <EmptyText>
          {agents.length === 0
            ? 'Agent transcripts will appear here when a subagent starts.'
            : 'Select an agent chip above the composer to open its transcript here.'}
        </EmptyText>
      ) : (
        <div className="flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="shrink-0 overflow-x-auto overflow-y-hidden px-2 py-2"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div className="flex min-w-0 gap-1.5">
              {openAgents.map((agent) => (
                <AgentTab
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgent?.id}
                  onClick={() => setActiveAgent(session.id, agent.id)}
                  onClose={() => closeAgentTab(session.id, agent.id)}
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

function AgentTab({
  agent,
  active,
  onClick,
  onClose
}: {
  agent: AgentNode
  active: boolean
  onClick: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <div
      className="group inline-flex h-8 min-w-0 max-w-[220px] shrink-0 items-center gap-1.5 rounded-md px-2 text-left"
      style={{
        background: active ? 'var(--color-accent-dim)' : 'var(--color-surface2)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)'
      }}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <StatusDot status={agent.status} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: active ? 'var(--color-accent)' : 'var(--color-text)' }}>
          {agent.name ?? agent.role ?? agent.id}
        </span>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="grid h-5 w-5 shrink-0 place-items-center rounded"
        title="Close transcript"
        aria-label="Close transcript"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
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
    <div
      className="mt-3 rounded-md p-3 text-sm"
      style={{
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        color: muted ? 'var(--color-text-muted)' : 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word'
      }}
    >
      {content}
    </div>
  )
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
