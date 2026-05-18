import { useCallback, useRef, useState } from 'react'
import { useSessionStore } from '../../store/sessions'
import { derivePlanStates, derivePlanStatesFromMessages } from '../../types'
import type { AgentNode, Session, SessionRunEventRecord } from '../../types'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import ExtensionsPanel from './ExtensionsPanel'
import PlanPanel from './PlanPanel'
import SideQuestionPanel from './SideQuestionPanel'
import { MotionPanel, PanelResizeHandle, TabButton, ToolbarButton } from '../shared/designSystem'
import { deriveSessionAgentNodes } from './agentNodes'
import Icon, { type IconName } from '../shared/Icon'

export type ContextTab = 'plan' | 'diff' | 'agents' | 'extensions' | 'side'

interface Props {
  session: Session
}

const DEFAULT_PANEL_WIDTH = 468
const MIN_PANEL_WIDTH = 360
const MAX_PANEL_WIDTH = 720

interface ContextTabSpec {
  id: ContextTab
  label: string
  icon: IconName
  count?: number
}

export default function ContextSidebar({ session }: Props): JSX.Element | null {
  const {
    eventBuffers,
    uiState,
    setShowDiff,
    setShowEvents,
    setShowPlan,
    setShowExtensions,
    setShowSideQuestions,
    setRightPanelWidth,
    closeRightPanel
  } = useSessionStore()
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const ui = uiState[session.id]
  const rightPanel = ui?.rightPanel
  const panelWidth = rightPanel?.width ?? DEFAULT_PANEL_WIDTH
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
  const tabs: ContextTabSpec[] = [
    ...(ui?.showDiff ? [{ id: 'diff' as const, label: 'Changes', icon: 'diff' as const }] : []),
    ...(hasPlan ? [{ id: 'plan' as const, label: 'Plan', icon: 'plan' as const, count: plans.length }] : []),
    ...((hasOpenAgent || hasLiveAgent) ? [{ id: 'agents' as const, label: 'Agents', icon: 'agents' as const, count: agents.length }] : []),
    ...(ui?.showExtensions ? [{ id: 'extensions' as const, label: 'Extensions', icon: 'extensions' as const }] : []),
    ...(hasSideQuestions ? [{ id: 'side' as const, label: 'Side', icon: 'chat' as const, count: ui?.sideQuestions?.length ?? 0 }] : [])
  ]
  const activeTab: ContextTab | null = rightPanel?.activeTabId
    ? rightPanel.activeTabId
    : ui?.showPlan
    ? 'plan'
    : ui?.showDiff
      ? 'diff'
      : ui?.showEvents
        ? 'agents'
        : ui?.showExtensions
          ? 'extensions'
          : ui?.showSideQuestions
            ? 'side'
            : null
  const effectiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id ?? null

  const activate = (tab: ContextTab): void => {
    setShowPlan(session.id, tab === 'plan')
    setShowDiff(session.id, tab === 'diff')
    setShowEvents(session.id, tab === 'agents')
    setShowExtensions(session.id, tab === 'extensions')
    setShowSideQuestions(session.id, tab === 'side')
  }

  const close = (tab?: ContextTab): void => {
    if (!tab) {
      closeRightPanel(session.id)
      return
    }
    if (tab === 'plan' || !tab) setShowPlan(session.id, false)
    if (tab === 'diff' || !tab) setShowDiff(session.id, false)
    if (tab === 'agents' || !tab) setShowEvents(session.id, false)
    if (tab === 'extensions' || !tab) setShowExtensions(session.id, false)
    if (tab === 'side' || !tab) setShowSideQuestions(session.id, false)
  }

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizeStartRef.current = { x: event.clientX, width: panelWidth }
    setIsResizing(true)

    const onMove = (moveEvent: PointerEvent): void => {
      const start = resizeStartRef.current
      if (!start) return
      const delta = start.x - moveEvent.clientX
      setRightPanelWidth(session.id, Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, start.width + delta)))
    }
    const onUp = (): void => {
      resizeStartRef.current = null
      setIsResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [panelWidth, session.id, setRightPanelWidth])

  return (
    <MotionPanel
      open={Boolean(effectiveTab)}
      side="right"
      size={panelWidth}
      className="flex"
    >
      <PanelResizeHandle
        orientation="vertical"
        label="Resize inspector"
        active={isResizing}
        onPointerDown={handleResizeStart}
      />
      <aside
        className="min-w-0 flex flex-1 flex-col overflow-hidden"
        data-testid="session-right-panel"
        data-right-panel-active-tab={effectiveTab ?? ''}
        data-right-panel-width={panelWidth}
        data-right-panel-tabs={rightPanel?.tabs.map((tab) => tab.id).join(',') ?? ''}
      >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-2 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-bg)' }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              active={effectiveTab === tab.id}
              onClick={() => activate(tab.id)}
              onClose={() => close(tab.id)}
              closeLabel={`Close ${tab.label}`}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name={tab.icon} size={13} />
                <span className="truncate">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className="grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4"
                    style={{
                      background: effectiveTab === tab.id ? 'var(--accent-bg)' : 'var(--control-bg)',
                      color: effectiveTab === tab.id ? 'var(--accent)' : 'var(--text-tertiary)',
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </span>
            </TabButton>
          ))}
        </div>
        <ToolbarButton
          icon="close"
          label="Close inspector"
          onClick={() => close()}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {effectiveTab === 'plan' && <PlanPanel session={session} embedded />}
        {effectiveTab === 'agents' && (
          <EventInspectorPanel session={session} embedded activeAgentId={ui?.activeAgentId ?? null} />
        )}
        {effectiveTab === 'extensions' && (
          <ExtensionsPanel provider={session.provider ?? 'claude'} workDir={session.workDir} embedded />
        )}
        {effectiveTab === 'diff' && <DiffPanel sessionId={session.id} embedded />}
        {effectiveTab === 'side' && <SideQuestionPanel session={session} embedded />}
      </div>
      </aside>
    </MotionPanel>
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
