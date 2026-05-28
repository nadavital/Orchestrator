import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { DEFAULT_TERMINAL_PANEL_CONTENT_HEIGHT, defaultUI, useSessionStore } from '../../store/sessions'
import type { Session } from '../../types'
import { AppShellPanel, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelResizeHandle, PanelTabStrip, ToolbarButton, exitFullscreenForPanelTab, panelTabDomId, panelTabPanelDomId, useAppShellBottomPanelLayout, useAppShellResizeController } from '../shared/designSystem'
import TerminalView from './TerminalView'

const MIN_TERMINAL_HEIGHT = 110
const MAX_TERMINAL_HEIGHT = 600
const DEFAULT_TERMINAL_HEIGHT = DEFAULT_TERMINAL_PANEL_CONTENT_HEIGHT
const MIN_PRIMARY_CONTENT_HEIGHT = 260
const TERMINAL_PANEL_CHROME_HEIGHT = 50

type TerminalActionStatus = {
  text: string
  tone: 'info' | 'danger'
}

interface TerminalPanelProps {
  session: Pick<Session, 'id' | 'workDir'>
}

export default function TerminalPanel({ session }: TerminalPanelProps): JSX.Element {
  const ui = useSessionStore(useShallow((state) => {
    const current = state.uiState[session.id] ?? defaultUI
    return {
      showTerminal: current.showTerminal,
      terminalPanel: current.terminalPanel
    }
  }))
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const setTerminalHeight = useSessionStore((state) => state.setTerminalHeight)
  const addTerminalTab = useSessionStore((state) => state.addTerminalTab)
  const setActiveTerminalTab = useSessionStore((state) => state.setActiveTerminalTab)
  const moveTerminalTab = useSessionStore((state) => state.moveTerminalTab)
  const transferSessionPanelTab = useSessionStore((state) => state.transferSessionPanelTab)
  const closeTerminalTab = useSessionStore((state) => state.closeTerminalTab)
  const openRightPanelBrowserUrl = useSessionStore((state) => state.openRightPanelBrowserUrl)
  const [terminalMenu, setTerminalMenu] = useState<{ tabId: number; x: number; y: number } | null>(null)
  const [terminalActionStatus, setTerminalActionStatus] = useState<TerminalActionStatus | null>(null)
  const terminalActionStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const terminalPanel = ui.terminalPanel ?? { height: DEFAULT_TERMINAL_HEIGHT, tabs: [0], activeTabId: 0, nextTabId: 1 }
  const terminalResizeController = useAppShellResizeController({
    edge: 'top',
    size: terminalPanel.height,
    defaultSize: DEFAULT_TERMINAL_HEIGHT,
    minSize: MIN_TERMINAL_HEIGHT,
    maxSize: MAX_TERMINAL_HEIGHT,
    onSizeChange: (nextSize) => setTerminalHeight(session.id, nextSize),
    onReset: () => setTerminalHeight(session.id, DEFAULT_TERMINAL_HEIGHT)
  })
  const terminalLayout = useAppShellBottomPanelLayout({
    containerTestId: 'session-shell',
    defaultSize: DEFAULT_TERMINAL_HEIGHT,
    size: terminalPanel.height,
    minSize: MIN_TERMINAL_HEIGHT,
    minPrimaryContentSize: MIN_PRIMARY_CONTENT_HEIGHT,
    maxSize: MAX_TERMINAL_HEIGHT
  })
  const terminalHeight = terminalLayout.size
  const terminalChromeHeight = TERMINAL_PANEL_CHROME_HEIGHT
  const terminalPanelTotalHeight = terminalHeight + terminalChromeHeight
  const tabs = terminalPanel.tabs
  const activeTab = terminalPanel.activeTabId

  const terminalId = (tab: number): string => `${session.id}-${tab}`
  const terminalTabs = tabs.map((tabId, idx) => ({
    id: tabId,
    label: tabs.length === 1 ? 'Terminal' : `Terminal ${idx + 1}`,
    icon: 'terminal' as const,
    closeLabel: 'Close terminal'
  }))

  useEffect(() => () => {
    if (terminalActionStatusTimeoutRef.current) window.clearTimeout(terminalActionStatusTimeoutRef.current)
  }, [])

  const setPanelActionStatus = useCallback((status: TerminalActionStatus): void => {
    if (terminalActionStatusTimeoutRef.current) window.clearTimeout(terminalActionStatusTimeoutRef.current)
    setTerminalActionStatus(status)
    terminalActionStatusTimeoutRef.current = window.setTimeout(() => {
      setTerminalActionStatus(null)
      terminalActionStatusTimeoutRef.current = null
    }, 2200)
  }, [])

  const addTab = (): void => {
    addTerminalTab(session.id)
    setPanelActionStatus({ text: 'New terminal opened', tone: 'info' })
  }

  const clearActiveTerminal = useCallback((): void => {
    void window.api.terminal.clear(`${session.id}-${activeTab}`)
      .then(() => setPanelActionStatus({ text: 'Terminal cleared', tone: 'info' }))
      .catch(() => setPanelActionStatus({ text: 'Clear failed', tone: 'danger' }))
  }, [activeTab, session.id, setPanelActionStatus])

  const closeTab = (tabId: number): void => {
    exitFullscreenForPanelTab('bottom', tabId)
    window.api.terminal.kill(terminalId(tabId))
    closeTerminalTab(session.id, tabId)
    setPanelActionStatus({ text: 'Terminal tab closed', tone: 'info' })
    setTerminalMenu(null)
  }

  const moveTab = (tabId: number, direction: 'left' | 'right'): void => {
    moveTerminalTab(session.id, tabId, direction)
    setPanelActionStatus({ text: `Terminal tab moved ${direction}`, tone: 'info' })
    setTerminalMenu(null)
  }

  const moveTabToRight = (tabId: number): void => {
    transferSessionPanelTab(session.id, {
      sourcePanel: 'bottom',
      targetPanel: 'right',
      tabKind: 'terminal',
      tabId
    })
    setPanelActionStatus({ text: 'Terminal moved to right panel', tone: 'info' })
    setTerminalMenu(null)
  }

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

  const terminalMenuIndex = terminalMenu ? tabs.findIndex((tabId) => tabId === terminalMenu.tabId) : -1

  return (
    <AppShellPanel
      open={ui.showTerminal}
      side="bottom"
      size={terminalPanelTotalHeight}
      panel="bottom"
      surface="terminal"
      focusArea="bottom-panel"
      telemetryActiveTab={activeTab}
      telemetryRouteKind="local_thread"
      className={`flex flex-col ${terminalLayout.className}`.trim()}
      style={terminalLayout.style}
      data-app-shell-panel-size-controller="shared"
      data-app-shell-panel-layout={terminalLayout.mode}
      data-app-shell-panel-container-size={Math.round(terminalLayout.containerSize)}
      data-app-shell-panel-stored-size={terminalLayout.storedSize}
      data-app-shell-panel-resolved-size={terminalLayout.size}
      data-app-shell-panel-max-size={terminalLayout.maxSize}
      data-bottom-panel-content-height={terminalHeight}
      data-bottom-panel-chrome-height={terminalChromeHeight}
      data-bottom-panel-total-height={terminalPanelTotalHeight}
      data-bottom-panel-default-height={DEFAULT_TERMINAL_HEIGHT}
    >
      <PanelResizeHandle
        orientation="horizontal"
        edge="top"
        label="Resize terminal"
        active={terminalResizeController.isResizing}
        onPointerDown={terminalResizeController.onPointerDown}
        onKeyDown={terminalResizeController.onKeyDown}
        onDoubleClick={terminalResizeController.onDoubleClick}
        valueNow={terminalResizeController.valueNow}
        valueMin={terminalResizeController.valueMin}
        valueMax={terminalResizeController.valueMax}
      />
      {ui.showTerminal && (
        <>
          <div
            id="orchestrator-terminal-panel"
            className="app-shell-panel-chrome"
            data-testid="session-bottom-panel"
            data-app-shell-focus-area="bottom-panel"
            data-app-shell-panel-chrome="true"
            data-app-shell-panel-chrome-surface="terminal"
            data-bottom-panel-height={terminalHeight}
            data-bottom-panel-content-height={terminalHeight}
            data-bottom-panel-chrome-height={terminalChromeHeight}
            data-bottom-panel-total-height={terminalPanelTotalHeight}
            data-bottom-panel-default-height={DEFAULT_TERMINAL_HEIGHT}
            data-bottom-panel-min-height={MIN_TERMINAL_HEIGHT}
            data-bottom-panel-max-height={terminalLayout.maxSize}
            data-bottom-panel-layout={terminalLayout.mode}
            data-bottom-panel-container-size={Math.round(terminalLayout.containerSize)}
            data-bottom-panel-tabs={tabs.join(',')}
            data-bottom-panel-active-tab={activeTab}
            data-terminal-action-status={terminalActionStatus?.text ?? ''}
            data-terminal-action-status-tone={terminalActionStatus?.tone ?? ''}
          >
            <PanelTabStrip
              tabs={terminalTabs}
              activeTabId={activeTab}
              panelId="bottom"
              onActivate={(tabId) => setActiveTerminalTab(session.id, tabId)}
              onClose={tabs.length > 1 ? closeTab : undefined}
              onContextMenu={(event, tabId) => {
                event.preventDefault()
                setTerminalMenu({ tabId, x: event.clientX, y: event.clientY })
              }}
              onMove={(tabId, direction) => moveTab(tabId, direction)}
              stripTestId="terminal-panel-tabstrip"
              tabRowTestId="terminal-panel-tab-row"
              tabListLabel="Terminal tabs"
              actions={(
                <>
                  {terminalActionStatus && (
                    <span
                      className="terminal-panel-action-status"
                      data-testid="terminal-panel-action-status"
                      data-terminal-action-status-tone={terminalActionStatus.tone}
                      role={terminalActionStatus.tone === 'danger' ? 'alert' : 'status'}
                      aria-live={terminalActionStatus.tone === 'danger' ? 'assertive' : 'polite'}
                      aria-atomic="true"
                    >
                      {terminalActionStatus.text}
                    </span>
                  )}
                  <IconButton icon="plus" label="New terminal" size="sm" variant="toolbar" onClick={addTab} />
                  <ToolbarButton
                    icon="eraser"
                    label="Clear terminal"
                    size="sm"
                    variant="toolbar"
                    onClick={clearActiveTerminal}
                  />
                  <ToolbarButton
                    icon="close"
                    label="Hide terminal"
                    size="sm"
                    variant="toolbar"
                    onClick={() => {
                      setTerminalMenu(null)
                      setShowTerminal(session.id, false)
                    }}
                  />
                </>
              )}
            />
          </div>

          {terminalMenu && (
            <MenuSurface
              className="terminal-tab-context-menu"
              data-panel-tab-transfer-model="shared"
              data-panel-tab-transfer-source="bottom"
              data-panel-tab-transfer-target="right"
              data-panel-tab-transfer-kind="terminal"
              data-panel-tab-transfer-supported="true"
              data-panel-tab-transfer-reason="available"
              onClose={() => setTerminalMenu(null)}
              style={{
                position: 'fixed',
                left: Math.max(8, Math.min(terminalMenu.x, window.innerWidth - 190)),
                top: Math.max(8, Math.min(terminalMenu.y, window.innerHeight - 130)),
                width: 180,
                zIndex: 80
              }}
            >
              <MenuSection dataTestId="terminal-tab-context-menu-tab-section">
                <MenuSectionLabel>Tab</MenuSectionLabel>
                <MenuItem
                  icon="arrowLeft"
                  label="Move tab left"
                  disabled={terminalMenuIndex <= 0}
                  onClick={() => moveTab(terminalMenu.tabId, 'left')}
                />
                <MenuItem
                  icon="arrowRight"
                  label="Move tab right"
                  disabled={terminalMenuIndex < 0 || terminalMenuIndex >= tabs.length - 1}
                  onClick={() => moveTab(terminalMenu.tabId, 'right')}
                />
              </MenuSection>
              <MenuSection
                dataTestId="terminal-tab-context-menu-terminal-section"
                data-panel-tab-transfer-model="shared"
                data-panel-tab-transfer-source="bottom"
                data-panel-tab-transfer-target="right"
              >
                <MenuSectionLabel>Terminal</MenuSectionLabel>
                <MenuItem
                  icon="terminal"
                  label="Move tab to right panel"
                  onClick={() => moveTabToRight(terminalMenu.tabId)}
                />
              </MenuSection>
              <MenuSection dataTestId="terminal-tab-context-menu-manage-section">
                <MenuSectionLabel>Manage</MenuSectionLabel>
                <MenuItem
                  icon="close"
                  label="Close terminal tab"
                  disabled={tabs.length <= 1}
                  onClick={() => closeTab(terminalMenu.tabId)}
                />
              </MenuSection>
            </MenuSurface>
          )}

          <div
            id={panelTabPanelDomId('bottom', activeTab)}
            role="tabpanel"
            tabIndex={-1}
            aria-label={terminalTabs.find((tab) => tab.id === activeTab)?.label ?? 'Terminal'}
            aria-labelledby={panelTabDomId('bottom', activeTab)}
            data-app-shell-focus-area="bottom-panel"
            data-app-shell-tab-panel-controller="bottom"
            data-tab-id={activeTab}
            data-bottom-panel-content-height={terminalHeight}
            data-bottom-panel-chrome-height={terminalChromeHeight}
            data-bottom-panel-total-height={terminalPanelTotalHeight}
            style={{ height: terminalHeight, flexShrink: 0, overflow: 'hidden', background: 'var(--surface-bg)' }}
          >
            <TerminalView
              key={terminalId(activeTab)}
              terminalId={terminalId(activeTab)}
              workDir={session.workDir}
              onNewTab={addTab}
              onOpenUrl={openTerminalUrl}
            />
          </div>
        </>
      )}
    </AppShellPanel>
  )
}
