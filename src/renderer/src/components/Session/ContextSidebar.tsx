import { useSessionStore } from '../../store/sessions'
import type { Session } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import PlanPanel from './PlanPanel'
import ExtensionsPanel from './ExtensionsPanel'
import SideQuestionPanel from './SideQuestionPanel'
import UsagePanel from './UsagePanel'
import Icon, { type IconName } from '../shared/Icon'

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

  const toggleTab = (tab: ContextTab): void => {
    const nextTab = activeTab === tab ? null : tab
    setShowPlan(session.id, nextTab === 'plan')
    setShowDiff(session.id, nextTab === 'diff')
    setShowEvents(session.id, nextTab === 'agents')
    setShowExtensions(session.id, nextTab === 'extensions')
    setShowSideQuestions(session.id, nextTab === 'side')
    setShowUsage(session.id, nextTab === 'usage')
  }

  const close = (): void => {
    setShowPlan(session.id, false)
    setShowDiff(session.id, false)
    setShowEvents(session.id, false)
    setShowExtensions(session.id, false)
    setShowSideQuestions(session.id, false)
    setShowUsage(session.id, false)
  }

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width: effectiveTab ? 492 : 52,
        background: 'var(--panel-bg)',
        borderLeft: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)'
      }}
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div
          className="w-[52px] shrink-0 flex flex-col items-center gap-2 py-2"
          style={{
            background: 'transparent',
            borderRight: effectiveTab ? '1px solid var(--border-subtle)' : 'none'
          }}
        >
          <RailTab active={activeTab === 'plan'} label="Plan" icon="plan" onClick={() => toggleTab('plan')} />
          <RailTab active={activeTab === 'agents'} label="Agents" icon="agents" onClick={() => toggleTab('agents')} />
          <RailTab active={activeTab === 'diff'} label="Diff" icon="diff" onClick={() => toggleTab('diff')} />
          <RailTab active={activeTab === 'extensions'} label="Extensions" icon="extensions" onClick={() => toggleTab('extensions')} />
          <RailTab active={activeTab === 'side'} label="Side questions" icon="chat" onClick={() => toggleTab('side')} />
          <RailTab active={effectiveTab === 'usage'} label="Usage" icon="usage" onClick={() => toggleTab('usage')} />
        </div>

        {effectiveTab && (
          <div className="w-[440px] min-w-0 flex flex-col min-h-0 overflow-hidden">
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
                      ? 'Diff'
                      : effectiveTab === 'extensions'
                        ? 'Extensions'
                        : effectiveTab === 'side'
                          ? 'Side questions'
                          : 'Usage'}
              </div>
              <button
                onClick={close}
                title="Close sidebar"
                aria-label="Close sidebar"
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
          </div>
        )}
      </div>
    </aside>
  )
}

function RailTab({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: IconName
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="h-9 w-9 grid place-items-center"
      style={{
        background: active ? 'var(--control-bg-active)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        border: active ? '1px solid var(--border-subtle)' : '1px solid transparent',
        borderRadius: 'var(--radius-md)'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--control-bg-hover)'
        e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = active ? 'var(--text-primary)' : 'var(--text-secondary)'
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  )
}
