import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSessionStore } from '../../store/sessions'
import { parseFileChangesFromUnifiedDiff, summarizeFileChanges } from '../../types'
import type { AgentNode, TextMessage, SessionRunEventRecord } from '../../types'
import Icon from '../shared/Icon'
import { deriveSessionAgentNodes } from './agentNodes'

interface Props {
  sessionId: string
}

const LIVE_STATUSES = new Set(['queued', 'running', 'waiting', 'blocked'])
const EMPTY_EVENTS: [] = []

export default function ComposerContextShelf({ sessionId }: Props): JSX.Element | null {
  const {
    session,
    events,
    activeAgentId,
    setActiveAgent,
    setShowDiff,
    openRightPanelTab,
    removeMessage
  } = useSessionStore(useShallow((state) => {
    const current = state.sessions.find((candidate) => candidate.id === sessionId) ?? null
    return {
      session: current,
      events: state.eventBuffers[sessionId] ?? EMPTY_EVENTS,
      activeAgentId: state.uiState[sessionId]?.activeAgentId ?? null,
      setActiveAgent: state.setActiveAgent,
      setShowDiff: state.setShowDiff,
      openRightPanelTab: state.openRightPanelTab,
      removeMessage: state.removeMessage
    }
  }))
  const changes = useMemo(
    () => parseFileChangesFromUnifiedDiff(latestDiffUpdatedContent(events)),
    [events]
  )

  const queuedMessages = useMemo(() => {
    if (!session) return []
    return session.messages.filter((message): message is TextMessage =>
      message.type === 'text' && message.role === 'user' && Boolean(message.queueState)
    )
  }, [session])

  const agents = useMemo(
    () => session ? deriveSessionAgentNodes(session, events).filter((agent) => LIVE_STATUSES.has(agent.status)) : [],
    [events, session]
  )

  const openReview = useCallback((): void => {
    if (!session) return
    setShowDiff(session.id, true)
    openRightPanelTab(session.id, 'diff')
  }, [openRightPanelTab, session, setShowDiff])

  const steerQueuedMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!session) return
    await window.api.sessions.steerQueuedMessage(session.id, messageId)
  }, [session])

  const cancelQueuedMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!session) return
    await window.api.sessions.cancelQueuedMessage(session.id, messageId)
    removeMessage(session.id, messageId)
  }, [removeMessage, session])

  if (!session || (changes.length === 0 && queuedMessages.length === 0 && agents.length === 0)) return null

  const changeSummary = summarizeFileChanges(changes)
  const queuedCount = queuedMessages.filter((message) => message.queueState === 'queued').length
  const steeringCount = queuedMessages.filter((message) => message.queueState === 'steer_next').length

  return (
    <div
      className="composer-context-shelf-shell shrink-0 px-4 pt-2"
      style={{
        paddingRight: 'calc(1rem + var(--transcript-scrollbar-width, 0px))'
      }}
    >
      <div
        className="composer-context-shelf mx-auto"
        data-testid="composer-context-shelf"
        style={{
          width: 'max(280px, calc(100% - 48px))',
          maxWidth: 'max(280px, calc(var(--composer-effective-column-max-width, var(--composer-column-max-width, 860px)) - 48px))'
        }}
      >
        {changes.length > 0 && (
          <div
            className="composer-context-row composer-context-row-changes"
            data-testid="composer-context-changes"
            data-changed-file-count={changeSummary.total}
            data-changed-file-additions={changeSummary.additions}
            data-changed-file-deletions={changeSummary.deletions}
          >
            <div className="composer-context-row-main">
              <span className="composer-context-title">{changeSummary.total} {changeSummary.total === 1 ? 'file' : 'files'} changed</span>
              {changeSummary.additions > 0 && <span className="composer-context-stat-additions">+{changeSummary.additions}</span>}
              {changeSummary.deletions > 0 && <span className="composer-context-stat-deletions">-{changeSummary.deletions}</span>}
            </div>
            <button type="button" className="composer-context-review-button" data-testid="composer-context-review" onClick={openReview}>
              Review
            </button>
          </div>
        )}
        {queuedMessages.length > 0 && (
          <QueuedMessageRow
            message={queuedMessages[0]}
            queuedCount={queuedCount}
            steeringCount={steeringCount}
            hasMore={queuedMessages.length > 1}
            onSteer={() => { void steerQueuedMessage(queuedMessages[0].id) }}
            onCancel={() => { void cancelQueuedMessage(queuedMessages[0].id) }}
          />
        )}
        {agents.length > 0 && (
          <div className="composer-context-row composer-context-row-agents" data-testid="running-agents-strip">
            <div className="composer-context-row-leading">
              <Icon name="agents" size={15} />
            </div>
            <span className="composer-context-agent-label">Live</span>
            <div className="composer-context-agent-list" aria-label="Live agents">
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
        )}
      </div>
    </div>
  )
}

function latestDiffUpdatedContent(records: SessionRunEventRecord[]): string {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const event = records[index]?.event
    if (event?.type === 'diff.updated' && event.content.trim().length > 0) return event.content
  }
  return ''
}

function QueuedMessageRow({
  message,
  queuedCount,
  steeringCount,
  hasMore,
  onSteer,
  onCancel
}: {
  message: TextMessage
  queuedCount: number
  steeringCount: number
  hasMore: boolean
  onSteer: () => void
  onCancel: () => void
}): JSX.Element {
  const isSteering = message.queueState === 'steer_next'
  const label = [
    queuedCount > 0 ? `${queuedCount} queued` : null,
    steeringCount > 0 ? `${steeringCount} steering` : null
  ].filter(Boolean).join(' · ')

  return (
    <div
      className="composer-context-row composer-context-row-queue"
      data-testid="composer-queued-summary"
      data-queued-follow-up-count={queuedCount}
      data-steering-follow-up-count={steeringCount}
    >
      <div className="composer-context-row-leading">
        <Icon name={isSteering ? 'arrowRight' : 'chat'} size={15} />
      </div>
      <div className="composer-context-queue-copy">
        <span className="composer-context-queue-label">{label}</span>
        <span className="composer-context-queue-preview">{message.content.trim()}</span>
      </div>
      <div className="composer-context-actions">
        {!isSteering && (
          <button type="button" className="composer-context-action-button" onClick={onSteer}>
            <Icon name="arrowRight" size={14} />
            <span>Steer</span>
          </button>
        )}
        <button type="button" className="composer-context-icon-button" aria-label="Cancel queued message" onClick={onCancel}>
          <Icon name="trash" size={14} />
        </button>
        {hasMore && (
          <button type="button" className="composer-context-icon-button" aria-label="More queued messages">
            <Icon name="ellipsis" size={14} />
          </button>
        )}
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
      className="composer-context-agent-pill"
      data-active={active ? 'true' : 'false'}
      data-agent-status={agent.status}
      aria-pressed={active}
    >
      <span
        className="composer-context-agent-status"
        style={{
          background: statusColor(agent.status),
          animation: agent.status === 'running' ? 'statusPulse 1.5s ease-in-out infinite' : 'none'
        }}
      />
      <span className="composer-context-agent-name">
        {agent.name ?? agent.role ?? agent.id}
      </span>
      <span className="composer-context-agent-state">{statusLabel(agent.status)}</span>
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
