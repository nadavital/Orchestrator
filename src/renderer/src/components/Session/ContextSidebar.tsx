import { useSessionStore } from '../../store/sessions'
import type { Session } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import PlanPanel from './PlanPanel'
import ExtensionsPanel from './ExtensionsPanel'
import SideQuestionPanel from './SideQuestionPanel'
import UsagePanel from './UsagePanel'
import Icon from '../shared/Icon'

type ContextTab = 'plan' | 'diff' | 'agents' | 'extensions' | 'usage' | 'side'

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
        : ui?.showExtensions
          ? 'extensions'
          : ui?.showSideQuestions
            ? 'side'
            : ui?.showUsage
              ? 'usage'
              : null
  const effectiveTab = activeTab

  const close = (): void => {
    setShowPlan(session.id, false)
    setShowDiff(session.id, false)
    setShowEvents(session.id, false)
    setShowExtensions(session.id, false)
    setShowSideQuestions(session.id, false)
    setShowUsage(session.id, false)
  }

  if (!effectiveTab) return null

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width: 440,
        background: 'var(--surface-bg)',
        borderLeft: '1px solid var(--border-subtle)',
        boxShadow: '-1px 0 0 rgba(255,255,255,0.55)'
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-bg)' }}
      >
        <div className="text-xs font-semibold min-w-0 truncate" style={{ color: 'var(--color-text)' }}>
          {effectiveTab === 'plan'
            ? 'Plan'
            : effectiveTab === 'agents'
              ? 'Agents'
              : effectiveTab === 'diff'
                ? 'Changes'
                : effectiveTab === 'extensions'
                  ? 'Resources'
                  : effectiveTab === 'side'
                    ? 'Side questions'
                    : 'Usage'}
        </div>
        <button
          onClick={close}
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
        {effectiveTab === 'extensions' && (
          <ExtensionsPanel provider={session.provider ?? 'claude'} workDir={session.workDir} embedded />
        )}
        {effectiveTab === 'side' && <SideQuestionPanel session={session} embedded />}
        {effectiveTab === 'usage' && <UsagePanel session={session} embedded />}
      </div>
    </aside>
  )
}
