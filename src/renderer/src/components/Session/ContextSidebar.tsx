import { useCallback, useEffect, useRef, useState } from 'react'
import { sideChatIdFromTabId, useSessionStore } from '../../store/sessions'
import type { RightPanelTabId } from '../../store/sessions'
import { derivePlanStates, derivePlanStatesFromMessages } from '../../types'
import type { AgentNode, Session, SessionRunEventRecord } from '../../types'
import BrowserPanel from './BrowserPanel'
import DiffPanel from './DiffPanel'
import EventInspectorPanel from './EventInspectorPanel'
import ExtensionsPanel from './ExtensionsPanel'
import FilesPanel from './FilesPanel'
import PlanPanel from './PlanPanel'
import SideQuestionPanel from './SideQuestionPanel'
import { MenuItem, MenuSurface, MotionPanel, PanelResizeHandle, TabButton, ToolbarButton } from '../shared/designSystem'
import { deriveSessionAgentNodes } from './agentNodes'
import Icon, { type IconName } from '../shared/Icon'

export type ContextTab = RightPanelTabId

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
    setRightPanelFullWidth,
    openRightPanelTab,
    closeRightPanelTab,
    moveRightPanelTab,
    setRightPanelBrowserUrl,
    setRightPanelBrowserWorkbench,
    closeSideChat,
    openSideChat,
    closeRightPanel
  } = useSessionStore()
  const [isResizing, setIsResizing] = useState(false)
  const [tabMenu, setTabMenu] = useState<{ tabId: ContextTab; x: number; y: number } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const ui = uiState[session.id]
  const rightPanel = ui?.rightPanel
  const panelWidth = rightPanel?.width ?? DEFAULT_PANEL_WIDTH
  const panelSize = rightPanel?.fullWidth
    ? Math.max(MIN_PANEL_WIDTH, viewportWidth - 322)
    : panelWidth
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
  const hasFilesTab = rightPanel?.tabs.some((tab) => tab.id === 'files') ?? false
  const hasBrowserTab = rightPanel?.tabs.some((tab) => tab.id === 'browser') ?? false
  const sideChatTabs = (rightPanel?.tabs ?? [])
    .filter((tab) => tab.kind === 'sidechat')
    .map((tab) => {
      const chatId = sideChatIdFromTabId(tab.id)
      const chat = chatId ? ui?.sideChats?.find((candidate) => candidate.id === chatId) : null
      return {
        id: tab.id,
        label: chat?.title ?? tab.title,
        icon: 'chat' as const,
        count: sideChatBadgeCount(chat)
      }
    })
  const availableTabs: ContextTabSpec[] = [
    ...(ui?.showDiff ? [{ id: 'diff' as const, label: 'Changes', icon: 'diff' as const }] : []),
    ...(hasBrowserTab ? [{ id: 'browser' as const, label: 'Browser', icon: 'browser' as const }] : []),
    ...(hasFilesTab ? [{ id: 'files' as const, label: 'Files', icon: 'folder' as const }] : []),
    ...sideChatTabs,
    ...(hasPlan ? [{ id: 'plan' as const, label: 'Plan', icon: 'plan' as const, count: plans.length }] : []),
    ...((hasOpenAgent || hasLiveAgent) ? [{ id: 'agents' as const, label: 'Agents', icon: 'agents' as const, count: agents.length }] : []),
    ...(ui?.showExtensions ? [{ id: 'extensions' as const, label: 'Extensions', icon: 'extensions' as const }] : []),
    ...(hasSideQuestions ? [{ id: 'side' as const, label: 'Side', icon: 'chat' as const, count: ui?.sideQuestions?.length ?? 0 }] : [])
  ]
  const persistedTabIds = rightPanel?.tabs.map((tab) => tab.id) ?? []
  const tabs: ContextTabSpec[] = [
    ...persistedTabIds
      .map((tabId) => availableTabs.find((tab) => tab.id === tabId))
      .filter((tab): tab is ContextTabSpec => Boolean(tab)),
    ...availableTabs.filter((tab) => !persistedTabIds.includes(tab.id))
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

  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const activate = (tab: ContextTab): void => {
    const sideChatId = sideChatIdFromTabId(tab)
    if (sideChatId) {
      openSideChat(session.id, sideChatId)
      return
    }
    if (tab === 'files' || tab === 'browser') {
      openRightPanelTab(session.id, tab)
      return
    }
    setShowPlan(session.id, tab === 'plan')
    setShowDiff(session.id, tab === 'diff')
    setShowEvents(session.id, tab === 'agents')
    setShowExtensions(session.id, tab === 'extensions')
    setShowSideQuestions(session.id, tab === 'side')
  }

  const close = (tab?: ContextTab): void => {
    setTabMenu(null)
    if (!tab) {
      closeRightPanel(session.id)
      return
    }
    if (tab === 'files') closeRightPanelTab(session.id, 'files')
    if (tab === 'browser') closeRightPanelTab(session.id, 'browser')
    const sideChatId = sideChatIdFromTabId(tab)
    if (sideChatId) closeSideChat(session.id, sideChatId)
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
      if (rightPanel?.fullWidth) setRightPanelFullWidth(session.id, false)
    }
    const onUp = (): void => {
      resizeStartRef.current = null
      setIsResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [panelWidth, rightPanel?.fullWidth, session.id, setRightPanelFullWidth, setRightPanelWidth])

  const moveTab = (tabId: ContextTab, direction: 'left' | 'right'): void => {
    moveRightPanelTab(session.id, tabId, direction)
    setTabMenu(null)
  }

  const tabMenuIndex = tabMenu ? tabs.findIndex((tab) => tab.id === tabMenu.tabId) : -1

  return (
    <MotionPanel
      open={Boolean(effectiveTab)}
      side="right"
      size={panelSize}
      className="flex"
      style={{ borderLeft: '1px solid var(--border-subtle)' }}
    >
      {!rightPanel?.fullWidth && (
        <PanelResizeHandle
          orientation="vertical"
          label="Resize inspector"
          active={isResizing}
          onPointerDown={handleResizeStart}
        />
      )}
      <aside
        className="min-w-0 flex flex-1 flex-col overflow-hidden"
        data-testid="session-right-panel"
        data-app-shell-focus-area="right-panel"
        data-right-panel-active-tab={effectiveTab ?? ''}
        data-right-panel-width={panelSize}
        data-right-panel-full-width={rightPanel?.fullWidth ? 'true' : 'false'}
        data-right-panel-tabs={rightPanel?.tabs.map((tab) => tab.id).join(',') ?? ''}
      >
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-2 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-bg)' }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" data-app-shell-tab-controller>
          {tabs.map((tab) => (
            <TabButton
              key={tab.id}
              active={effectiveTab === tab.id}
              onClick={() => activate(tab.id)}
              onClose={() => close(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                setTabMenu({ tabId: tab.id, x: event.clientX, y: event.clientY })
              }}
              closeLabel={`Close ${tab.label}`}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5" data-tab-id={tab.id}>
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
          icon="browser"
          label="Open browser"
          active={effectiveTab === 'browser'}
          onClick={() => openRightPanelTab(session.id, 'browser')}
        />
        <ToolbarButton
          icon="folder"
          label="Open files"
          active={effectiveTab === 'files'}
          onClick={() => openRightPanelTab(session.id, 'files')}
        />
        <ToolbarButton
          icon="chevronRight"
          label={rightPanel?.fullWidth ? 'Restore panel width' : 'Expand panel'}
          onClick={() => setRightPanelFullWidth(session.id, !rightPanel?.fullWidth)}
        />
        <ToolbarButton
          icon="close"
          label="Close inspector"
          onClick={() => close()}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" data-app-shell-tab-panel-controller>
        {effectiveTab === 'plan' && <PlanPanel session={session} embedded />}
        {effectiveTab === 'agents' && (
          <EventInspectorPanel session={session} embedded activeAgentId={ui?.activeAgentId ?? null} />
        )}
        {effectiveTab === 'extensions' && (
          <ExtensionsPanel provider={session.provider ?? 'claude'} workDir={session.workDir} embedded />
        )}
        {effectiveTab === 'browser' && (
          <BrowserPanel
            embedded
            initialUrl={ui?.browserUrl ?? ''}
            browserState={ui?.browserWorkbench}
            onUrlChange={(url) => setRightPanelBrowserUrl(session.id, url)}
            onBrowserStateChange={(patch) => setRightPanelBrowserWorkbench(session.id, patch)}
          />
        )}
        {effectiveTab === 'files' && <FilesPanel workDir={session.workDir} embedded />}
        {effectiveTab === 'diff' && <DiffPanel sessionId={session.id} workDir={session.workDir} embedded />}
        {effectiveTab === 'side' && <SideQuestionPanel session={session} embedded />}
        {sideChatIdFromTabId(effectiveTab ?? 'plan') && (
          <SideQuestionPanel session={session} chatId={sideChatIdFromTabId(effectiveTab ?? 'plan') ?? undefined} embedded />
        )}
      </div>
      {tabMenu && (
        <MenuSurface
          onClose={() => setTabMenu(null)}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(tabMenu.x, window.innerWidth - 190)),
            top: Math.max(8, Math.min(tabMenu.y, window.innerHeight - 130)),
            width: 180,
            zIndex: 80
          }}
        >
          <MenuItem
            icon="arrowLeft"
            label="Move tab left"
            disabled={tabMenuIndex <= 0}
            onClick={() => moveTab(tabMenu.tabId, 'left')}
          />
          <MenuItem
            icon="arrowRight"
            label="Move tab right"
            disabled={tabMenuIndex < 0 || tabMenuIndex >= tabs.length - 1}
            onClick={() => moveTab(tabMenu.tabId, 'right')}
          />
          <MenuItem
            icon="close"
            label="Close tab"
            onClick={() => close(tabMenu.tabId)}
          />
        </MenuSurface>
      )}
      </aside>
    </MotionPanel>
  )
}

function isLiveAgent(agent: AgentNode): boolean {
  return agent.status === 'running' || agent.status === 'queued' || agent.status === 'waiting' || agent.status === 'blocked'
}

function sideChatBadgeCount(chat: { unread?: boolean; messages: Array<{ status?: string }> } | null | undefined): number | undefined {
  if (!chat) return undefined
  const pending = chat.messages.filter((message) => message.status === 'pending').length
  const errors = chat.messages.filter((message) => message.status === 'error').length
  if (pending > 0) return pending
  if (errors > 0) return errors
  return chat.unread ? 1 : undefined
}

function hasActiveGoal(events: SessionRunEventRecord[]): boolean {
  let active = false
  for (const record of events) {
    if (record.event.type === 'goal.updated') active = true
    if (record.event.type === 'goal.cleared') active = false
  }
  return active
}
