import { useCallback, useEffect, useState } from 'react'
import { filePathFromTabId, sideChatContextSnapshot, sideChatIdFromTabId, terminalTabIdFromTabId, useSessionStore } from '../../store/sessions'
import type { RightPanelTabId, RightPanelTabKind } from '../../store/sessions'
import { bottomPanelTransferPolicyLabel, derivePlanStates, derivePlanStatesFromMessages, resolvePanelTabTransferAvailability } from '../../types'
import type { AgentNode, Session, SessionRunEventRecord } from '../../types'
import BrowserPanel from './BrowserPanel'
import DiffPanel from './DiffPanel'
import EnvironmentPanel from './EnvironmentPanel'
import EventInspectorPanel from './EventInspectorPanel'
import ExtensionsPanel from './ExtensionsPanel'
import FileTabPanel from './FileTabPanel'
import FilesPanel from './FilesPanel'
import GitPanel from './GitPanel'
import PlanPanel from './PlanPanel'
import SideQuestionPanel from './SideQuestionPanel'
import TerminalView from './TerminalView'
import { AppShellPanel, IconButton, MenuItem, MenuMessage, MenuSection, MenuSectionLabel, MenuSurface, PanelResizeHandle, PanelTabStrip, exitFullscreenForPanelTab, panelTabContextMenuPoint, panelTabDomId, panelTabPanelDomId, useAppShellResizeController, useAppShellSidePanelLayout } from '../shared/designSystem'
import { deriveSessionAgentNodes } from './agentNodes'
import Icon, { type IconName } from '../shared/Icon'

export type ContextTab = RightPanelTabId

interface Props {
  sessionId: string
}

const DEFAULT_PANEL_WIDTH = 600
const LEGACY_DEFAULT_PANEL_WIDTH = 468
const LEGACY_DEFAULT_PANEL_WIDTH_RATIO = 0.34
const MIN_PANEL_WIDTH = 320
const MIN_PRIMARY_CONTENT_WIDTH = 352
const MIN_OVERLAY_PANEL_WIDTH = 280

interface ContextTabSpec {
  id: ContextTab
  label: string
  icon: IconName
  count?: number
  preview?: boolean
  pinned?: boolean
  shimmering?: boolean
  tooltipLabel?: string
}

export default function ContextSidebar({ sessionId }: Props): JSX.Element | null {
  const session = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId))
  if (!session) return null
  return <ContextSidebarContent session={session} />
}

function ContextSidebarContent({ session }: { session: Session }): JSX.Element | null {
  const globals = window as typeof window & { __orchestratorWorkbenchCommitCount?: number }
  if (typeof globals.__orchestratorWorkbenchCommitCount === 'number') {
    globals.__orchestratorWorkbenchCommitCount += 1
  }
  const {
    eventBuffers,
    uiState,
    setShowDiff,
    setShowEvents,
    setShowPlan,
    setShowExtensions,
    setShowSideQuestions,
    setRightPanelWidth,
    setRightPanelOpen,
    setRightPanelFullWidth,
    openRightPanelTab,
    closeRightPanelTab,
    moveRightPanelTab,
    resetRightPanelTabState,
    pinRightPanelTab,
    updateRightPanelFileTabState,
    setRightPanelBrowserUrl,
    openRightPanelBrowserUrl,
    setRightPanelBrowserWorkbench,
    closeSideChat,
    openSideChat,
    closeTerminalTab,
    addTerminalTab,
    transferSessionPanelTab,
    closeRightPanel
  } = useSessionStore()
  const [tabMenu, setTabMenu] = useState<{ tabId: ContextTab; x: number; y: number } | null>(null)
  const ui = uiState[session.id]
  const rightPanel = ui?.rightPanel
  const rawPanelWidthRatio = rightPanel?.widthRatio
  const panelLayout = useAppShellSidePanelLayout({
    containerTestId: 'session-main-row',
    defaultSize: DEFAULT_PANEL_WIDTH,
    size: rightPanel?.width,
    widthRatio: rawPanelWidthRatio,
    legacyDefaultSize: LEGACY_DEFAULT_PANEL_WIDTH,
    legacyDefaultSizeRatio: LEGACY_DEFAULT_PANEL_WIDTH_RATIO,
    fullWidth: rightPanel?.fullWidth,
    minSize: MIN_PANEL_WIDTH,
    minPrimaryContentSize: MIN_PRIMARY_CONTENT_WIDTH,
    minOverlaySize: MIN_OVERLAY_PANEL_WIDTH
  })
  const mainRowWidth = panelLayout.containerSize
  const panelWidthRatio = panelLayout.widthRatio
  const panelWidth = panelLayout.storedSize
  const shouldOverlayPanel = panelLayout.isOverlay
  const panelSize = panelLayout.size
  const events = eventBuffers[session.id] ?? []
  const plans = [
    ...derivePlanStatesFromMessages(session, session.messages),
    ...derivePlanStates(session, events)
  ]
  const agents = deriveSessionAgentNodes(session, events)
  const hasPlan = plans.length > 0 || hasActiveGoal(events) || hasActiveReviewMode(events, session)
  const hasOpenAgent = (ui?.agentTabIds?.length ?? 0) > 0
  const hasLiveAgent = agents.some(isLiveAgent)
  const hasSideQuestions = (ui?.sideQuestions?.length ?? 0) > 0
  const hasEnvironmentTab = rightPanel?.tabs.some((tab) => tab.id === 'environment') ?? false
  const hasGitTab = rightPanel?.tabs.some((tab) => tab.id === 'git') ?? false
  const hasDiffTab = rightPanel?.tabs.some((tab) => tab.id === 'diff') ?? false
  const hasFilesTab = rightPanel?.tabs.some((tab) => tab.id === 'files') ?? false
  const hasBrowserTab = rightPanel?.tabs.some((tab) => tab.id === 'browser') ?? false
  const hasNewTab = rightPanel?.tabs.some((tab) => tab.id === 'new-tab') ?? false
  const hasPlanTab = rightPanel?.tabs.some((tab) => tab.id === 'plan') ?? false
  const hasBottomPanelPlanTab = ui?.terminalPanel?.tabs.includes('plan') ?? false
  const sideChatTabs = (rightPanel?.tabs ?? [])
    .filter((tab) => tab.kind === 'sidechat')
    .map((tab) => {
      const chatId = sideChatIdFromTabId(tab.id)
      const chat = chatId ? ui?.sideChats?.find((candidate) => candidate.id === chatId) : null
      return {
        id: tab.id,
        label: chat?.title ?? tab.title,
        icon: 'chat' as const,
        count: sideChatBadgeCount(chat),
        shimmering: chat?.messages.some((message) => message.status === 'pending') ?? false
      }
    })
  const terminalTabs = (rightPanel?.tabs ?? [])
    .filter((tab) => tab.kind === 'terminal')
    .map((tab) => ({
      id: tab.id,
      label: tab.title,
      icon: 'terminal' as const
    }))
  const fileTabs = (rightPanel?.tabs ?? [])
    .filter((tab) => tab.kind === 'file' && tab.filePath)
    .map((tab) => ({
      id: tab.id,
      label: tab.title,
      icon: 'file' as const,
      preview: tab.isPreview,
      pinned: tab.isPinned,
      tooltipLabel: tab.filePath
    }))
  const availableTabs: ContextTabSpec[] = [
    ...(hasNewTab ? [{ id: 'new-tab' as const, label: 'New tab', icon: 'plus' as const }] : []),
    ...(hasEnvironmentTab ? [{ id: 'environment' as const, label: 'Environment', icon: 'settings' as const }] : []),
    ...(hasGitTab ? [{ id: 'git' as const, label: 'Git', icon: 'branch' as const }] : []),
    ...(ui?.showDiff || hasDiffTab ? [{ id: 'diff' as const, label: 'Review', icon: 'diff' as const }] : []),
    ...(hasBrowserTab ? [{ id: 'browser' as const, label: 'Browser', icon: 'browser' as const }] : []),
    ...(hasFilesTab ? [{ id: 'files' as const, label: 'Files', icon: 'folder' as const }] : []),
    ...fileTabs,
    ...sideChatTabs,
    ...terminalTabs,
    ...(hasPlan && !hasBottomPanelPlanTab && (ui?.showPlan || hasPlanTab)
      ? [{ id: 'plan' as const, label: 'Plan', icon: 'plan' as const, count: plans.length }]
      : []),
    ...((ui?.showEvents || hasOpenAgent || hasLiveAgent) ? [{ id: 'agents' as const, label: 'Agents', icon: 'agents' as const, count: agents.length, shimmering: hasLiveAgent }] : []),
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
  const effectiveFilePath = filePathFromTabId(effectiveTab ?? 'plan')
  const effectiveFileTab = rightPanel?.tabs.find((tab) => tab.id === effectiveTab && tab.kind === 'file') ?? null
  const effectiveTabLabel = tabs.find((tab) => tab.id === effectiveTab)?.label ?? 'Workbench'
  const rightPanelOpen = rightPanel?.open ?? false

  const openTerminalUrl = useCallback((url: string): void => {
    openRightPanelBrowserUrl(session.id, url)
    const ui = useSessionStore.getState().uiState[session.id]
    const globals = window as typeof window & {
      __orchestratorLastTerminalBrowserRoute?: {
        sessionId: string
        url: string
        rightPanelActiveTab?: string | null
        browserUrl?: string
      }
    }
    globals.__orchestratorLastTerminalBrowserRoute = {
      sessionId: session.id,
      url,
      rightPanelActiveTab: ui?.rightPanel?.activeTabId ?? null,
      browserUrl: ui?.browserUrl
    }
  }, [openRightPanelBrowserUrl, session.id])

  const activate = (tab: ContextTab): void => {
    const sideChatId = sideChatIdFromTabId(tab)
    if (sideChatId) {
      openSideChat(session.id, sideChatId)
      return
    }
    if (terminalTabIdFromTabId(tab) !== null) {
      openRightPanelTab(session.id, tab)
      return
    }
    if (filePathFromTabId(tab)) {
      openRightPanelTab(session.id, tab)
      return
    }
    if (tab === 'new-tab' || tab === 'environment' || tab === 'git' || tab === 'files' || tab === 'browser') {
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
    const restoreToggleFocus = (): void => {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>('[data-testid="titlebar-toggle-sidebar"]')?.focus({ preventScroll: true })
      })
    }
    if (!tab) {
      closeRightPanel(session.id)
      restoreToggleFocus()
      return
    }
    const closingFinalTab = tabs.length <= 1
    exitFullscreenForPanelTab('right', tab)
    if (tab === 'new-tab') closeRightPanelTab(session.id, 'new-tab')
    if (tab === 'environment') closeRightPanelTab(session.id, 'environment')
    if (tab === 'git') closeRightPanelTab(session.id, 'git')
    if (tab === 'files') closeRightPanelTab(session.id, 'files')
    if (filePathFromTabId(tab)) closeRightPanelTab(session.id, tab)
    if (tab === 'browser') closeRightPanelTab(session.id, 'browser')
    const sideChatId = sideChatIdFromTabId(tab)
    if (sideChatId) closeSideChat(session.id, sideChatId)
    const terminalTabId = terminalTabIdFromTabId(tab)
    if (terminalTabId !== null) {
      window.api.terminal.kill(`${session.id}-${terminalTabId}`)
      closeTerminalTab(session.id, terminalTabId)
    }
    if (tab === 'plan' || !tab) setShowPlan(session.id, false)
    if (tab === 'diff' || !tab) setShowDiff(session.id, false)
    if (tab === 'agents' || !tab) setShowEvents(session.id, false)
    if (tab === 'extensions' || !tab) setShowExtensions(session.id, false)
    if (tab === 'side' || !tab) setShowSideQuestions(session.id, false)
    if (closingFinalTab) restoreToggleFocus()
  }

  const getRightPanelDragRowWidth = useCallback((): number => {
      const row = document.querySelector('[data-testid="session-main-row"]')
      return row instanceof HTMLElement ? row.getBoundingClientRect().width : mainRowWidth
  }, [mainRowWidth])

  const resizeController = useAppShellResizeController({
    edge: 'left',
    size: panelWidth,
    defaultSize: DEFAULT_PANEL_WIDTH,
    minSize: MIN_PANEL_WIDTH,
    maxSize: () => Math.max(MIN_PANEL_WIDTH, getRightPanelDragRowWidth() - MIN_PRIMARY_CONTENT_WIDTH),
    onBelowMin: () => {
      setRightPanelOpen(session.id, false)
      if (rightPanel?.fullWidth) setRightPanelFullWidth(session.id, false)
    },
    onSizeChange: (nextWidth) => {
      const rowWidth = getRightPanelDragRowWidth()
      const nextRatio = rowWidth > 0 ? nextWidth / rowWidth : panelWidthRatio
      setRightPanelOpen(session.id, true)
      setRightPanelWidth(session.id, nextWidth, nextRatio)
      if (rightPanel?.fullWidth) setRightPanelFullWidth(session.id, false)
    },
    onReset: () => setRightPanelWidth(session.id, DEFAULT_PANEL_WIDTH, null)
  })

  const moveTab = (tabId: ContextTab, direction: 'left' | 'right'): void => {
    moveRightPanelTab(session.id, tabId, direction)
    setTabMenu(null)
  }

  const resetTab = (tabId: ContextTab): void => {
    resetRightPanelTabState(session.id, tabId)
    setTabMenu(null)
  }

  const tabMenuIndex = tabMenu ? tabs.findIndex((tab) => tab.id === tabMenu.tabId) : -1
  const tabMenuTransferKind = tabMenu
    ? rightPanelTabTransferKind(tabMenu.tabId, rightPanel?.tabs.find((tab) => tab.id === tabMenu.tabId)?.kind)
    : null
  const tabMenuTransferAvailability = tabMenuTransferKind
    ? resolvePanelTabTransferAvailability('right', 'bottom', tabMenuTransferKind)
    : null
  const tabMenuCanReset = tabMenu
    ? tabMenu.tabId === 'browser' || Boolean(filePathFromTabId(tabMenu.tabId))
    : false

  const openToolTab = (tab: 'environment' | 'git' | 'diff' | 'browser' | 'files'): void => {
    if (tab === 'diff') {
      openRightPanelTab(session.id, 'environment')
      setShowDiff(session.id, true)
      return
    }
    openRightPanelTab(session.id, tab)
  }
  const openSideChatTab = (): void => {
    openSideChat(session.id, crypto.randomUUID(), 'Side chat', sideChatContextSnapshot(session, 'workbench-new-tab'))
  }
  const openRightTerminalTab = (): void => {
    const tabId = addTerminalTab(session.id)
    transferSessionPanelTab(session.id, {
      sourcePanel: 'bottom',
      targetPanel: 'right',
      tabKind: 'terminal',
      tabId
    })
  }
  const openPlanTab = (): void => {
    setShowPlan(session.id, true)
  }
  const showWorkbenchAddTabButton = effectiveTab !== 'new-tab'
  const newTabActions: WorkbenchNewTabAction[] = [
    {
      id: 'files',
      title: 'Files',
      description: hasFilesTab ? 'Switch to open Files tab' : 'Browse project files',
      icon: 'folder',
      state: hasFilesTab ? 'open' : 'new',
      onSelect: () => openToolTab('files')
    },
    {
      id: 'environment',
      title: 'Environment',
      description: hasEnvironmentTab ? 'Switch to open Environment tab' : 'Inspect workspace context',
      icon: 'settings',
      state: hasEnvironmentTab ? 'open' : 'new',
      onSelect: () => openToolTab('environment')
    },
    ...(hasPlan && !hasBottomPanelPlanTab ? [{
      id: 'plan',
      title: 'Plan',
      description: ui?.showPlan || hasPlanTab ? 'Switch to open Plan tab' : 'View goal and task state',
      icon: 'plan' as const,
      state: ui?.showPlan || hasPlanTab ? 'open' as const : 'new' as const,
      onSelect: openPlanTab
    }] : []),
    {
      id: 'side-chat',
      title: 'Side chat',
      description: 'Start a side conversation',
      icon: 'chat',
      onSelect: openSideChatTab
    },
    {
      id: 'browser',
      title: 'Browser',
      description: hasBrowserTab ? 'Switch to open Browser tab' : 'Open a website',
      icon: 'browser',
      state: hasBrowserTab ? 'open' : 'new',
      onSelect: () => openToolTab('browser')
    },
    {
      id: 'git',
      title: 'Git',
      description: hasGitTab ? 'Switch to open Git tab' : 'Stage and review changes',
      icon: 'branch',
      state: hasGitTab ? 'open' : 'new',
      onSelect: () => openToolTab('git')
    },
    {
      id: 'review',
      title: 'Review',
      description: ui?.showDiff || hasDiffTab ? 'Switch to open Review tab' : 'View code changes',
      icon: 'diff',
      state: ui?.showDiff || hasDiffTab ? 'open' : 'new',
      onSelect: () => openToolTab('diff')
    },
    {
      id: 'agents',
      title: 'Agents',
      description: ui?.showEvents ? 'Switch to open Agents tab' : 'Inspect runtime activity',
      icon: 'agents',
      state: ui?.showEvents ? 'open' : 'new',
      onSelect: () => setShowEvents(session.id, true)
    },
    {
      id: 'extensions',
      title: 'Extensions',
      description: ui?.showExtensions ? 'Switch to open Extensions tab' : 'Inspect MCP, apps, plugins, and skills',
      icon: 'extensions',
      state: ui?.showExtensions ? 'open' : 'new',
      onSelect: () => setShowExtensions(session.id, true)
    },
    {
      id: 'terminal',
      title: 'Terminal',
      description: 'Start an interactive shell',
      icon: 'terminal',
      onSelect: openRightTerminalTab
    }
  ]

  return (
    <AppShellPanel
      open={rightPanelOpen && Boolean(effectiveTab)}
      side="right"
      size={panelSize}
      panel="right"
      surface="workbench"
      focusArea="right-panel"
      telemetryActiveTab={effectiveTab}
      telemetryRouteKind="local_thread"
      className={`workbench-panel flex ${panelLayout.className}`.trim()}
      style={panelLayout.style}
      data-app-shell-panel-size-controller="shared"
      data-app-shell-panel-layout={panelLayout.mode}
      data-app-shell-panel-container-size={Math.round(panelLayout.containerSize)}
      data-app-shell-panel-resolved-size={panelLayout.size}
      data-app-shell-panel-max-size={panelLayout.maxSize}
    >
      {rightPanelOpen && !rightPanel?.fullWidth && !shouldOverlayPanel && (
        <PanelResizeHandle
          orientation="vertical"
          edge="left"
          label="Resize panel"
          active={resizeController.isResizing}
          onPointerDown={resizeController.onPointerDown}
          onKeyDown={resizeController.onKeyDown}
          onDoubleClick={resizeController.onDoubleClick}
          valueNow={resizeController.valueNow}
          valueMin={resizeController.valueMin}
          valueMax={resizeController.valueMax}
        />
      )}
      <aside
        id="orchestrator-workbench-panel"
        className="workbench-panel-surface min-w-0 flex flex-1 flex-col overflow-hidden"
        data-testid="session-right-panel"
        data-app-shell-focus-area="right-panel"
        tabIndex={-1}
        aria-label="Workbench panel"
        data-right-panel-open={rightPanelOpen ? 'true' : 'false'}
        data-right-panel-active-tab={effectiveTab ?? ''}
        data-right-panel-width={panelSize}
        data-right-panel-full-width={rightPanel?.fullWidth ? 'true' : 'false'}
        data-right-panel-width-ratio={panelWidthRatio?.toFixed(4) ?? ''}
        data-right-panel-layout={panelLayout.mode}
        data-right-panel-tabs={rightPanel?.tabs.map((tab) => tab.id).join(',') ?? ''}
      >
      <div className="workbench-panel-chrome">
        <PanelTabStrip
          tabs={tabs}
          activeTabId={effectiveTab}
          panelId="right"
          onActivate={activate}
          onClose={close}
          onContextMenu={(event, tabId) => {
            event.preventDefault()
            const point = panelTabContextMenuPoint(event)
            setTabMenu({ tabId, ...point })
          }}
          onMove={(tabId, direction) => moveTab(tabId, direction)}
          className="workbench-panel-tabbar"
          stripTestId="workbench-panel-tabbar"
          tabRowTestId="workbench-panel-tab-row"
          tabListLabel="Workbench tabs"
          actionsTestId="workbench-panel-tab-actions"
          activeActionsHostTestId="right-panel-active-tab-actions"
          actions={(
            <>
            {showWorkbenchAddTabButton && (
              <IconButton
                icon="plus"
                label="Add Workbench tab"
                size="sm"
                variant="toolbar"
                dataTestId="right-panel-add-tab"
                onClick={() => openRightPanelTab(session.id, 'new-tab')}
              />
            )}
            <IconButton
              icon={rightPanel?.fullWidth ? 'minimize' : 'maximize'}
              label={rightPanel?.fullWidth ? 'Restore Workbench width' : 'Expand Workbench'}
              size="sm"
              variant="toolbar"
              active={rightPanel?.fullWidth}
              dataTestId="right-panel-expand-toggle"
              onClick={() => setRightPanelFullWidth(session.id, !rightPanel?.fullWidth)}
            />
            </>
          )}
        />
      </div>
      <div
        id={effectiveTab ? panelTabPanelDomId('right', effectiveTab) : undefined}
        role="tabpanel"
        tabIndex={-1}
        aria-label={effectiveTabLabel}
        aria-labelledby={effectiveTab ? panelTabDomId('right', effectiveTab) : undefined}
        className="flex-1 min-h-0 overflow-hidden"
        data-app-shell-tab-panel-controller="right"
        data-tab-id={effectiveTab ?? ''}
      >
        {effectiveTab === 'new-tab' && (
          <WorkbenchNewTabPanel actions={newTabActions} />
        )}
        {effectiveTab === 'environment' && (
          <EnvironmentPanel
            session={session}
            embedded
            onOpenReview={() => setShowDiff(session.id, true)}
          />
        )}
        {effectiveTab === 'git' && (
          <GitPanel
            session={session}
            embedded
            onOpenReview={() => setShowDiff(session.id, true)}
          />
        )}
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
            hostId={`right:${session.id}:browser`}
            initialUrl={ui?.browserUrl ?? ''}
            browserState={ui?.browserWorkbench}
            onUrlChange={(url) => setRightPanelBrowserUrl(session.id, url)}
            onBrowserStateChange={(patch) => setRightPanelBrowserWorkbench(session.id, patch)}
          />
        )}
        {effectiveTab === 'files' && <FilesPanel sessionId={session.id} workDir={session.workDir} embedded />}
        {effectiveFilePath && (
          <FileTabPanel
            workDir={session.workDir}
            sessionId={session.id}
            filePath={effectiveFilePath}
            fileHost={effectiveFileTab?.fileHost}
            tabId={effectiveTab ?? 'files'}
            isPreview={effectiveFileTab?.isPreview}
            fileViewMode={effectiveFileTab?.fileViewMode}
            sourceWrap={effectiveFileTab?.sourceWrap ?? true}
            selectedSourceLine={effectiveFileTab?.selectedSourceLine ?? null}
            sourceSearchQuery={effectiveFileTab?.sourceSearchQuery ?? ''}
            sourceSearchIndex={effectiveFileTab?.sourceSearchIndex ?? 0}
            sourceAnnotations={effectiveFileTab?.sourceAnnotations ?? []}
            sourceBlameVisible={effectiveFileTab?.sourceBlameVisible ?? false}
            sourceRevealLine={effectiveFileTab?.sourceRevealLine ?? null}
            sourceRevealRequest={effectiveFileTab?.sourceRevealRequest ?? 0}
            onPin={(tabId) => pinRightPanelTab(session.id, tabId)}
            onFileTabStateChange={(tabId, patch) => updateRightPanelFileTabState(session.id, tabId, patch)}
          />
        )}
        {effectiveTab === 'diff' && <DiffPanel sessionId={session.id} workDir={session.workDir} embedded />}
        {effectiveTab === 'side' && <SideQuestionPanel session={session} embedded />}
        {sideChatIdFromTabId(effectiveTab ?? 'plan') && (
          <SideQuestionPanel session={session} chatId={sideChatIdFromTabId(effectiveTab ?? 'plan') ?? undefined} embedded />
        )}
        {terminalTabIdFromTabId(effectiveTab ?? 'plan') !== null && (
          <TerminalView
            terminalId={`${session.id}-${terminalTabIdFromTabId(effectiveTab ?? 'plan') ?? 0}`}
            workDir={session.workDir}
            onOpenUrl={openTerminalUrl}
            onNewTab={() => {
              const newTabId = addTerminalTab(session.id)
              transferSessionPanelTab(session.id, {
                sourcePanel: 'bottom',
                targetPanel: 'right',
                tabKind: 'terminal',
                tabId: newTabId
              })
            }}
          />
        )}
      </div>
      {tabMenu && (
        <MenuSurface
          className="workbench-tab-context-menu"
          data-panel-tab-transfer-model={tabMenuTransferAvailability?.model ?? 'shared'}
          data-panel-tab-transfer-source="right"
          data-panel-tab-transfer-target="bottom"
          data-panel-tab-transfer-kind={tabMenuTransferKind ?? 'unknown'}
          data-panel-tab-transfer-supported={tabMenuTransferAvailability?.supported ? 'true' : 'false'}
          data-panel-tab-transfer-reason={tabMenuTransferAvailability?.reason ?? 'unsupported-tab-kind'}
          onClose={() => setTabMenu(null)}
          style={{
            position: 'fixed',
            left: Math.max(8, Math.min(tabMenu.x, window.innerWidth - 190)),
            top: Math.max(8, Math.min(tabMenu.y, window.innerHeight - 130)),
            width: 212,
            zIndex: 80
          }}
        >
          <MenuSection dataTestId="workbench-tab-context-menu-tab-section">
            <MenuSectionLabel>Tab</MenuSectionLabel>
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
            {tabMenuCanReset && (
              <MenuItem
                icon="refresh"
                label="Reset tab"
                onClick={() => resetTab(tabMenu.tabId)}
              />
            )}
          </MenuSection>
          {terminalTabIdFromTabId(tabMenu.tabId) !== null && (
            <MenuSection
              dataTestId="workbench-tab-context-menu-terminal-section"
              data-panel-tab-transfer-model="shared"
              data-panel-tab-transfer-source="right"
              data-panel-tab-transfer-target="bottom"
            >
              <MenuSectionLabel>Terminal</MenuSectionLabel>
              <MenuItem
                icon="terminal"
                label="Move tab to bottom panel"
                dataTestId="workbench-tab-context-menu-move-bottom"
                onClick={() => {
                  transferSessionPanelTab(session.id, {
                    sourcePanel: 'right',
                    targetPanel: 'bottom',
                    tabKind: 'terminal',
                    tabId: tabMenu.tabId
                  })
                  setTabMenu(null)
                }}
              />
            </MenuSection>
          )}
          {tabMenu.tabId === 'plan' && tabMenuTransferAvailability?.supported && (
            <MenuSection
              dataTestId="workbench-tab-context-menu-bottom-panel-section"
              data-panel-tab-transfer-model="shared"
              data-panel-tab-transfer-source="right"
              data-panel-tab-transfer-target="bottom"
            >
              <MenuSectionLabel>Bottom panel</MenuSectionLabel>
              <MenuItem
                icon="panelRight"
                label="Move tab to bottom panel"
                dataTestId="workbench-tab-context-menu-move-plan-bottom"
                onClick={() => {
                  transferSessionPanelTab(session.id, {
                    sourcePanel: 'right',
                    targetPanel: 'bottom',
                    tabKind: 'plan',
                    tabId: tabMenu.tabId
                  })
                  setTabMenu(null)
                }}
              />
            </MenuSection>
          )}
          {tabMenuTransferAvailability && !tabMenuTransferAvailability.supported && tabMenuTransferAvailability.reason === 'unsupported-tab-kind' && (
            <MenuSection
              dataTestId="workbench-tab-context-menu-bottom-panel-boundary-section"
              data-panel-tab-transfer-model="shared"
              data-panel-tab-transfer-source="right"
              data-panel-tab-transfer-target="bottom"
              data-panel-tab-transfer-kind={tabMenuTransferAvailability.tabKind}
              data-panel-tab-transfer-supported="false"
              data-panel-tab-transfer-reason={tabMenuTransferAvailability.reason}
            >
              <MenuSectionLabel>Bottom panel</MenuSectionLabel>
              <MenuMessage
                compact
                state={tabMenuTransferAvailability.reason}
                dataTestId="workbench-tab-context-menu-bottom-panel-boundary-message"
              >
                {bottomPanelTransferPolicyLabel()}
              </MenuMessage>
            </MenuSection>
          )}
          <MenuSection dataTestId="workbench-tab-context-menu-manage-section">
            <MenuSectionLabel>Manage</MenuSectionLabel>
            <MenuItem
              icon="close"
              label="Close tab"
              onClick={() => close(tabMenu.tabId)}
            />
          </MenuSection>
        </MenuSurface>
      )}
      </aside>
    </AppShellPanel>
  )
}

interface WorkbenchNewTabAction {
  id: string
  title: string
  description: string
  icon: IconName
  disabled?: boolean
  state?: 'new' | 'open'
  onSelect: () => void
}

function WorkbenchNewTabPanel({ actions }: { actions: WorkbenchNewTabAction[] }): JSX.Element {
  const firstEnabledActionId = actions.find((action) => !action.disabled)?.id ?? null
  const [focusedActionId, setFocusedActionId] = useState<string | null>(firstEnabledActionId)

  useEffect(() => {
    if (!focusedActionId || actions.some((action) => action.id === focusedActionId && !action.disabled)) return
    setFocusedActionId(firstEnabledActionId)
  }, [actions, firstEnabledActionId, focusedActionId])

  const moveActionFocus = (currentTarget: HTMLElement, direction: 'next' | 'previous' | 'first' | 'last'): void => {
    const enabledButtons = [...currentTarget.querySelectorAll<HTMLButtonElement>('[data-workbench-new-tab-action]:not(:disabled)')]
    if (enabledButtons.length === 0) return
    const activeIndex = enabledButtons.findIndex((button) => button === document.activeElement)
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? enabledButtons.length - 1
        : direction === 'next'
          ? (Math.max(0, activeIndex) + 1) % enabledButtons.length
          : activeIndex <= 0
            ? enabledButtons.length - 1
            : activeIndex - 1
    const nextButton = enabledButtons[nextIndex]
    setFocusedActionId(nextButton?.dataset.workbenchNewTabAction ?? null)
    nextButton?.focus({ preventScroll: true })
  }

  return (
    <div className="workbench-new-tab-panel" data-testid="workbench-new-tab-panel" aria-label="Workbench tab actions">
      <div className="workbench-new-tab-content">
        <div
          className="workbench-new-tab-list"
          data-testid="workbench-new-tab-action-grid"
          data-workbench-new-tab-keyboard="roving"
          role="list"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
              event.preventDefault()
              moveActionFocus(event.currentTarget, 'next')
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
              event.preventDefault()
              moveActionFocus(event.currentTarget, 'previous')
            } else if (event.key === 'Home') {
              event.preventDefault()
              moveActionFocus(event.currentTarget, 'first')
            } else if (event.key === 'End') {
              event.preventDefault()
              moveActionFocus(event.currentTarget, 'last')
            }
          }}
        >
          {actions.map((action) => (
            <div key={action.id} className="workbench-new-tab-action-item" role="listitem">
              <button
                type="button"
                className="workbench-new-tab-action"
                disabled={action.disabled}
                tabIndex={!action.disabled && (focusedActionId === action.id || (!focusedActionId && firstEnabledActionId === action.id)) ? 0 : -1}
                data-testid={`workbench-new-tab-action-${action.id}`}
                data-workbench-new-tab-action={action.id}
                data-workbench-new-tab-action-state={action.state ?? 'new'}
                data-workbench-new-tab-keyboard-selected={!action.disabled && focusedActionId === action.id ? 'true' : 'false'}
                aria-label={`${action.title}: ${action.description}`}
                onFocus={() => setFocusedActionId(action.id)}
                onClick={action.onSelect}
              >
                <span className="workbench-new-tab-action-icon">
                  <Icon name={action.icon} size={18} />
                </span>
                <span className="workbench-new-tab-action-copy">
                  <span className="workbench-new-tab-action-title">{action.title}</span>
                  <span className="workbench-new-tab-action-description">{action.description}</span>
                </span>
                {action.state === 'open' && (
                  <span className="workbench-new-tab-action-state">Open</span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
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

function rightPanelTabTransferKind(tabId: RightPanelTabId, kind?: RightPanelTabKind): string {
  if (kind) return kind
  if (terminalTabIdFromTabId(tabId) !== null) return 'terminal'
  if (filePathFromTabId(tabId)) return 'file'
  if (sideChatIdFromTabId(tabId)) return 'sidechat'
  return tabId
}

function hasActiveGoal(events: SessionRunEventRecord[]): boolean {
  let active = false
  for (const record of events) {
    if (record.event.type === 'goal.updated') active = true
    if (record.event.type === 'goal.cleared') active = false
  }
  return active
}

function hasActiveReviewMode(events: SessionRunEventRecord[], session: Session): boolean {
  let active = false
  for (const record of events) {
    if (record.event.type === 'review.mode.changed') active = record.event.active
  }
  if (active) return true
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index]!
    if (message.type !== 'result') continue
    const match = /^Review mode:\s*(active|exited)\b/i.exec(message.content.trim())
    if (match) return match[1]?.toLowerCase() === 'active'
  }
  return false
}
