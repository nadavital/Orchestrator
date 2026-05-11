import { useSessionStore } from '../../store/sessions'
import type { Session } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import SkillsPanel from './SkillsPanel'

type ContextTab = 'diff' | 'agents' | 'skills'

interface Props {
  session: Session
}

export default function ContextSidebar({ session }: Props): JSX.Element | null {
  const { uiState, setShowDiff, setShowEvents, setShowSkills } = useSessionStore()
  const ui = uiState[session.id]
  const activeTab: ContextTab | null = ui?.showDiff
    ? 'diff'
    : ui?.showEvents
      ? 'agents'
      : ui?.showSkills
        ? 'skills'
        : null

  const toggleTab = (tab: ContextTab): void => {
    const nextTab = activeTab === tab ? null : tab
    setShowDiff(session.id, nextTab === 'diff')
    setShowEvents(session.id, nextTab === 'agents')
    setShowSkills(session.id, nextTab === 'skills')
  }

  const close = (): void => {
    setShowDiff(session.id, false)
    setShowEvents(session.id, false)
    setShowSkills(session.id, false)
  }

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden"
      style={{
        width: activeTab ? 492 : 52,
        background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div
          className="w-[52px] shrink-0 flex flex-col items-center gap-2 py-2"
          style={{
            background: 'var(--color-surface)',
            borderRight: activeTab ? '1px solid var(--color-border)' : 'none'
          }}
        >
          <RailTab active={activeTab === 'agents'} label="Agents" onClick={() => toggleTab('agents')}>
            <path d="M5.25 3.5a2.25 2.25 0 1 1 3.307 1.986 3.754 3.754 0 0 1 2.943 3.66.75.75 0 0 1-1.5 0 2.25 2.25 0 0 0-4.5 0 .75.75 0 0 1-1.5 0 3.754 3.754 0 0 1 2.943-3.66A2.245 2.245 0 0 1 5.25 3.5ZM7.5 2.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm5.5 6a1.75 1.75 0 1 0-1.267 2.933 2.75 2.75 0 0 0-1.983 2.64.75.75 0 0 0 1.5 0 1.25 1.25 0 0 1 2.5 0 .75.75 0 0 0 1.5 0 2.75 2.75 0 0 0-1.983-2.64A1.75 1.75 0 0 0 13 8.75Zm-10 0a1.75 1.75 0 1 0-1.267 2.933 2.75 2.75 0 0 0-1.983 2.64.75.75 0 0 0 1.5 0 1.25 1.25 0 0 1 2.5 0 .75.75 0 0 0 1.5 0 2.75 2.75 0 0 0-1.983-2.64A1.75 1.75 0 0 0 3 8.75Z" />
          </RailTab>
          <RailTab active={activeTab === 'diff'} label="Diff" onClick={() => toggleTab('diff')}>
            <path d="M8.75 1.75a.75.75 0 0 0-1.5 0V7H1.75a.75.75 0 0 0 0 1.5H7.25v5.25a.75.75 0 0 0 1.5 0V8.5h5.25a.75.75 0 0 0 0-1.5H8.75V1.75Z" />
          </RailTab>
          <RailTab active={activeTab === 'skills'} label="Skills" onClick={() => toggleTab('skills')}>
            <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z" />
          </RailTab>
        </div>

        {activeTab && (
          <div className="w-[440px] flex flex-col min-h-0 overflow-hidden">
            <div
              className="shrink-0 flex items-center justify-between gap-2 px-3 py-2"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                {activeTab === 'agents' ? 'Agents' : activeTab === 'diff' ? 'Diff' : 'Skills'}
              </div>
              <button
                onClick={close}
                title="Close sidebar"
                aria-label="Close sidebar"
                className="h-7 w-7 rounded-md grid place-items-center"
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
              {activeTab === 'agents' && (
                <EventInspectorPanel session={session} embedded activeAgentId={ui?.activeAgentId ?? null} />
              )}
              {activeTab === 'diff' && <DiffPanel sessionId={session.id} embedded />}
              {activeTab === 'skills' && (
                <SkillsPanel provider={session.provider ?? 'claude'} workDir={session.workDir} embedded />
              )}
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
      className="h-9 w-9 rounded-md grid place-items-center"
      style={{
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        border: active ? '1px solid var(--color-accent)' : '1px solid transparent'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        {children}
      </svg>
    </button>
  )
}
