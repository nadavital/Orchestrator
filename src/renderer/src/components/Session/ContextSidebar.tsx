import { useSessionStore } from '../../store/sessions'
import type { Session } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import PlanPanel from './PlanPanel'
import ExtensionsPanel from './ExtensionsPanel'
import SideQuestionPanel from './SideQuestionPanel'
import UsagePanel from './UsagePanel'

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
          <RailTab active={activeTab === 'plan'} label="Plan" onClick={() => toggleTab('plan')}>
            <path d="M2.75 1A1.75 1.75 0 0 0 1 2.75v10.5C1 14.216 1.784 15 2.75 15h10.5A1.75 1.75 0 0 0 15 13.25V2.75A1.75 1.75 0 0 0 13.25 1H2.75Zm0 1.5h10.5a.25.25 0 0 1 .25.25v10.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25V2.75a.25.25 0 0 1 .25-.25Zm2 2.25A.75.75 0 0 1 5.5 4h5.75a.75.75 0 0 1 0 1.5H5.5a.75.75 0 0 1-.75-.75Zm0 3A.75.75 0 0 1 5.5 7h5.75a.75.75 0 0 1 0 1.5H5.5a.75.75 0 0 1-.75-.75Zm0 3A.75.75 0 0 1 5.5 10h3.75a.75.75 0 0 1 0 1.5H5.5a.75.75 0 0 1-.75-.75Z" />
          </RailTab>
          <RailTab active={activeTab === 'agents'} label="Agents" onClick={() => toggleTab('agents')}>
            <path d="M5.25 3.5a2.25 2.25 0 1 1 3.307 1.986 3.754 3.754 0 0 1 2.943 3.66.75.75 0 0 1-1.5 0 2.25 2.25 0 0 0-4.5 0 .75.75 0 0 1-1.5 0 3.754 3.754 0 0 1 2.943-3.66A2.245 2.245 0 0 1 5.25 3.5ZM7.5 2.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm5.5 6a1.75 1.75 0 1 0-1.267 2.933 2.75 2.75 0 0 0-1.983 2.64.75.75 0 0 0 1.5 0 1.25 1.25 0 0 1 2.5 0 .75.75 0 0 0 1.5 0 2.75 2.75 0 0 0-1.983-2.64A1.75 1.75 0 0 0 13 8.75Zm-10 0a1.75 1.75 0 1 0-1.267 2.933 2.75 2.75 0 0 0-1.983 2.64.75.75 0 0 0 1.5 0 1.25 1.25 0 0 1 2.5 0 .75.75 0 0 0 1.5 0 2.75 2.75 0 0 0-1.983-2.64A1.75 1.75 0 0 0 3 8.75Z" />
          </RailTab>
          <RailTab active={activeTab === 'diff'} label="Diff" onClick={() => toggleTab('diff')}>
            <path d="M8.75 1.75a.75.75 0 0 0-1.5 0V7H1.75a.75.75 0 0 0 0 1.5H7.25v5.25a.75.75 0 0 0 1.5 0V8.5h5.25a.75.75 0 0 0 0-1.5H8.75V1.75Z" />
          </RailTab>
          <RailTab active={activeTab === 'extensions'} label="Extensions" onClick={() => toggleTab('extensions')}>
            <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z" />
          </RailTab>
          <RailTab active={activeTab === 'side'} label="Side questions" onClick={() => toggleTab('side')}>
            <path d="M2.75 1A1.75 1.75 0 0 0 1 2.75v7.5C1 11.216 1.784 12 2.75 12H4v2.25a.75.75 0 0 0 1.28.53L8.06 12h5.19A1.75 1.75 0 0 0 15 10.25v-7.5A1.75 1.75 0 0 0 13.25 1H2.75Zm.75 3.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z" />
          </RailTab>
          <RailTab active={effectiveTab === 'usage'} label="Usage" onClick={() => toggleTab('usage')}>
            <path d="M2.5 11.5a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 0 1.5h-9.5a.75.75 0 0 1-.75-.75Zm0-3.5a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 2.5 8Zm0-3.5a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H3.25A.75.75 0 0 1 2.5 4.5Z" />
          </RailTab>
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
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
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
  children,
  active,
  label,
  onClick
}: {
  children: React.ReactNode
  active: boolean
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
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        border: active ? '1px solid var(--color-accent)' : '1px solid transparent',
        borderRadius: 'var(--radius-lg)'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        {children}
      </svg>
    </button>
  )
}
