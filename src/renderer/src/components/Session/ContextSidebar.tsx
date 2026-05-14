import { useSessionStore } from '../../store/sessions'
import type { Session } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import PlanPanel from './PlanPanel'
import SideQuestionPanel from './SideQuestionPanel'
import UsagePanel from './UsagePanel'
import Icon from '../shared/Icon'

export type ContextTab = 'plan' | 'diff' | 'agents' | 'usage' | 'side'

interface Props {
  session: Session
}

export default function ContextSidebar({ session }: Props): JSX.Element | null {
  const { uiState, setShowDiff, setShowEvents, setShowPlan, setShowExtensions, setShowSideQuestions, setShowUsage } = useSessionStore()
  const ui = uiState[session.id]
  const activeTab: ContextTab | null = ui?.showPlan
    ? 'plan'
    : ui?.showDiff
      ? 'diff'
      : ui?.showEvents
        ? 'agents'
        : ui?.showSideQuestions
          ? 'side'
          : ui?.showUsage
            ? 'usage'
            : null
  const effectiveTab = activeTab

  const activate = (tab: ContextTab): void => {
    setShowPlan(session.id, tab === 'plan')
    setShowDiff(session.id, tab === 'diff')
    setShowEvents(session.id, tab === 'agents')
    setShowExtensions(session.id, false)
    setShowSideQuestions(session.id, tab === 'side')
    setShowUsage(session.id, tab === 'usage')
  }

  const close = (tab?: ContextTab): void => {
    if (tab === 'plan' || !tab) setShowPlan(session.id, false)
    if (tab === 'diff' || !tab) setShowDiff(session.id, false)
    if (tab === 'agents' || !tab) setShowEvents(session.id, false)
    setShowExtensions(session.id, false)
    if (tab === 'side' || !tab) setShowSideQuestions(session.id, false)
    if (tab === 'usage' || !tab) setShowUsage(session.id, false)
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
          {TABS.map((tab) => (
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
        {effectiveTab === 'usage' && <UsagePanel session={session} embedded />}
      </div>
    </aside>
  )
}

const TABS: Array<{ id: ContextTab; label: string }> = [
  { id: 'diff', label: 'Changes' },
  { id: 'plan', label: 'Plan' },
  { id: 'agents', label: 'Agents' },
  { id: 'side', label: 'Side' },
  { id: 'usage', label: 'Usage' }
]

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
