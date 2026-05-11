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

  if (!activeTab) return null

  const openTab = (tab: ContextTab): void => {
    setShowDiff(session.id, tab === 'diff')
    setShowEvents(session.id, tab === 'agents')
    setShowSkills(session.id, tab === 'skills')
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
        width: 440,
        background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)'
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-1">
          <SidebarTab active={activeTab === 'agents'} onClick={() => openTab('agents')}>Agents</SidebarTab>
          <SidebarTab active={activeTab === 'diff'} onClick={() => openTab('diff')}>Diff</SidebarTab>
          <SidebarTab active={activeTab === 'skills'} onClick={() => openTab('skills')}>Skills</SidebarTab>
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
    </aside>
  )
}

function SidebarTab({
  children,
  active,
  onClick
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-2 py-1 text-xs font-medium"
      style={{
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
        border: active ? '1px solid var(--color-accent)' : '1px solid transparent'
      }}
    >
      {children}
    </button>
  )
}
