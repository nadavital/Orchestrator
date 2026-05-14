import { useSessionStore } from '../../store/sessions'
import { derivePlanStates, derivePlanStatesFromMessages } from '../../types'
import type { AgentNode, Session, SessionRunEventRecord } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import PlanPanel from './PlanPanel'
import SideQuestionPanel from './SideQuestionPanel'
import Icon from '../shared/Icon'
import { deriveSessionAgentNodes } from './agentNodes'

export type ContextTab = 'plan' | 'diff' | 'agents' | 'side'

interface Props {
  session: Session
}

export default function ContextSidebar({ session }: Props): JSX.Element | null {
  const { eventBuffers, uiState, setShowDiff, setShowEvents, setShowPlan, setShowExtensions, setShowSideQuestions } = useSessionStore()
  const ui = uiState[session.id]
  const events = eventBuffers[session.id] ?? []
  const plans = [
    ...derivePlanStatesFromMessages(session, session.messages),
    ...derivePlanStates(session, events)
  ]
  const agents = deriveSessionAgentNodes(session, events)
  const hasPlan = plans.length > 0 || hasActiveGoal(events)
  const hasOpenAgent = (ui?.agentTabIds?.length ?? 0) > 0
  const hasLiveAgent = agents.some(isLiveAgent)
  const hasSideQuestions = (ui?.sideQuestions?.length ?? 0) > 0
  const tabs = [
    ui?.showDiff ? { id: 'diff' as const, label: 'Changes' } : null,
    hasPlan ? { id: 'plan' as const, label: 'Plan' } : null,
    (hasOpenAgent || hasLiveAgent) ? { id: 'agents' as const, label: 'Agents' } : null,
    hasSideQuestions ? { id: 'side' as const, label: 'Side' } : null
  ].filter((tab): tab is { id: ContextTab; label: string } => Boolean(tab))
  const activeTab: ContextTab | null = ui?.showPlan
    ? 'plan'
    : ui?.showDiff
      ? 'diff'
      : ui?.showEvents
        ? 'agents'
        : ui?.showSideQuestions
          ? 'side'
          : null
  const effectiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? null

  const activate = (tab: ContextTab): void => {
    setShowPlan(session.id, tab === 'plan')
    setShowDiff(session.id, tab === 'diff')
    setShowEvents(session.id, tab === 'agents')
    setShowExtensions(session.id, false)
    setShowSideQuestions(session.id, tab === 'side')
  }

  const close = (tab?: ContextTab): void => {
    if (tab === 'plan' || !tab) setShowPlan(session.id, false)
    if (tab === 'diff' || !tab) setShowDiff(session.id, false)
    if (tab === 'agents' || !tab) setShowEvents(session.id, false)
    setShowExtensions(session.id, false)
    if (tab === 'side' || !tab) setShowSideQuestions(session.id, false)
  }

  if (!effectiveTab) return null

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width: 468,
        background: 'var(--surface-bg)',
        borderLeft: '1px solid var(--border-subtle)',
        boxShadow: '-1px 0 0 rgba(255,255,255,0.55)'
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-2 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-bg)' }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <InspectorTab
              key={tab.id}
              label={tab.label}
              active={effectiveTab === tab.id}
              onClick={() => activate(tab.id)}
              onClose={() => close(tab.id)}
            />
          ))}
        </div>
        <button
          onClick={() => close()}
          title="Close inspector"
          aria-label="Close inspector"
          className="h-7 w-7 grid place-items-center"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {effectiveTab === 'plan' && <PlanPanel session={session} embedded />}
        {effectiveTab === 'agents' && (
          <EventInspectorPanel session={session} embedded activeAgentId={ui?.activeAgentId ?? null} />
        )}
        {effectiveTab === 'diff' && <DiffPanel sessionId={session.id} embedded />}
        {effectiveTab === 'side' && <SideQuestionPanel session={session} embedded />}
      </div>
    </aside>
  )
}

function isLiveAgent(agent: AgentNode): boolean {
  return agent.status === 'running' || agent.status === 'queued' || agent.status === 'waiting' || agent.status === 'blocked'
}

function hasActiveGoal(events: SessionRunEventRecord[]): boolean {
  let active = false
  for (const record of events) {
    if (record.event.type === 'goal.updated') active = true
    if (record.event.type === 'goal.cleared') active = false
  }
  return active
}

function InspectorTab({
  label,
  active,
  onClick,
  onClose
}: {
  label: string
  active: boolean
  onClick: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
      style={{
        background: active ? 'var(--control-bg-active)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: active ? 650 : 500
      }}
    >
      <span>{label}</span>
      {active && (
        <span
          role="button"
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          className="grid h-4 w-4 place-items-center rounded"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <Icon name="close" size={11} />
        </span>
      )}
    </button>
  )
}
