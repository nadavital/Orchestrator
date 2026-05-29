import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { DEFAULT_TERMINAL_PANEL_CONTENT_HEIGHT, defaultUI, useSessionStore } from '../../store/sessions'
import type { BottomPanelTabId, BottomPanelTabKind } from '../../store/sessions'
import type { Session } from '../../types'
import { canCloseBottomPanelTab } from '../../../../types/panelTabs'
import { AppShellPanel, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelResizeHandle, PanelTabStrip, ToolbarButton, exitFullscreenForPanelTab, panelTabContextMenuPoint, panelTabDomId, panelTabPanelDomId, useAppShellBottomPanelLayout, useAppShellResizeController } from '../shared/designSystem'
import PlanPanel from './PlanPanel'
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

type TerminalCommandState = {
  command: string
  outputOffset: number
}

interface TerminalPanelProps {
  session: Session
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
  const [terminalMenu, setTerminalMenu] = useState<{ tabId: BottomPanelTabId; x: number; y: number } | null>(null)
  const [terminalActionStatus, setTerminalActionStatus] = useState<TerminalActionStatus | null>(null)
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, string>>({})
  const [terminalSelections, setTerminalSelections] = useState<Record<string, string>>({})
  const [terminalCommandStates, setTerminalCommandStates] = useState<Record<string, TerminalCommandState>>({})
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
    label: bottomPanelTabLabel(tabId, idx, tabs),
    icon: bottomPanelTabIcon(tabId),
    kind: bottomPanelTabKind(tabId),
    closable: canCloseBottomPanelTab(tabId, tabs),
    closeLabel: bottomPanelTabCloseLabel(tabId)
  }))
  const activeTabKind = bottomPanelTabKind(activeTab)
  const activeTerminalId = typeof activeTab === 'number' ? terminalId(activeTab) : null
  const activeTerminalOutput = activeTerminalId ? terminalOutputs[activeTerminalId] ?? '' : ''
  const activeTerminalSelection = activeTerminalId ? terminalSelections[activeTerminalId] ?? '' : ''
  const activeCommandState = activeTerminalId ? terminalCommandStates[activeTerminalId] : undefined
  const activeCommandOutput = activeCommandState
    ? activeTerminalOutput.slice(Math.max(0, Math.min(activeCommandState.outputOffset, activeTerminalOutput.length))).trim()
    : ''

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

  const openPlanTab = (): void => {
    if (tabs.includes('plan')) {
      setActiveTerminalTab(session.id, 'plan')
      setPanelActionStatus({ text: 'Plan tab selected', tone: 'info' })
      return
    }

    const moved = transferSessionPanelTab(session.id, {
      sourcePanel: 'right',
      targetPanel: 'bottom',
      tabKind: 'plan',
      tabId: 'plan'
    })
    setPanelActionStatus(moved
      ? { text: 'Plan opened in bottom panel', tone: 'info' }
      : { text: 'Plan tab unavailable', tone: 'danger' })
  }

  const clearActiveTerminal = useCallback((): void => {
    if (typeof activeTab !== 'number') {
      setPanelActionStatus({ text: 'No active terminal to clear', tone: 'danger' })
      return
    }
    const id = `${session.id}-${activeTab}`
    setTerminalOutputs((current) => ({ ...current, [id]: '' }))
    setTerminalCommandStates((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    void window.api.terminal.clear(id)
      .then(() => setPanelActionStatus({ text: 'Terminal cleared', tone: 'info' }))
      .catch(() => setPanelActionStatus({ text: 'Clear failed', tone: 'danger' }))
  }, [activeTab, session.id, setPanelActionStatus])

  const handleTerminalOutputChange = useCallback((id: string, output: string): void => {
    setTerminalOutputs((current) => current[id] === output ? current : { ...current, [id]: output })
  }, [])

  const handleTerminalSelectionChange = useCallback((id: string, selection: string): void => {
    setTerminalSelections((current) => current[id] === selection ? current : { ...current, [id]: selection })
  }, [])

  const handleTerminalCommandSubmitted = useCallback((id: string, command: string, outputOffset: number): void => {
    setTerminalCommandStates((current) => ({ ...current, [id]: { command, outputOffset } }))
  }, [])

  useEffect(() => {
    if (!activeTerminalId) return undefined
    const globals = window as typeof window & {
      __orchestratorSubmitTerminalCommandForSmokeById?: Record<string, (command: string) => void>
    }
    const submitCommandForSmoke = (command: string): void => {
      const input = command.endsWith('\r') || command.endsWith('\n') ? command.replace(/\n$/, '\r') : `${command}\r`
      handleTerminalCommandSubmitted(activeTerminalId, command.trim(), terminalOutputs[activeTerminalId]?.length ?? 0)
      void window.api.terminal.write(activeTerminalId, input)
    }
    globals.__orchestratorSubmitTerminalCommandForSmokeById = {
      ...(globals.__orchestratorSubmitTerminalCommandForSmokeById ?? {}),
      [activeTerminalId]: submitCommandForSmoke
    }
    return () => {
      if (globals.__orchestratorSubmitTerminalCommandForSmokeById?.[activeTerminalId] === submitCommandForSmoke) {
        delete globals.__orchestratorSubmitTerminalCommandForSmokeById[activeTerminalId]
      }
    }
  }, [activeTerminalId, handleTerminalCommandSubmitted, terminalOutputs])

  const addActiveTerminalOutputToChat = useCallback((): void => {
    if (activeTabKind !== 'terminal') {
      setPanelActionStatus({ text: 'No active terminal output to add', tone: 'danger' })
      return
    }
    const output = activeTerminalOutput.trim()
    if (!output) {
      setPanelActionStatus({ text: 'Terminal output is empty', tone: 'danger' })
      return
    }
    const clippedOutput = output.split('\n').slice(-120).join('\n').slice(-12_000)
    const lines = [
      'Review this terminal output:',
      `Working dir: ${session.workDir}`,
      activeTerminalId ? `Terminal: ${activeTerminalId}` : '',
      '',
      '```text',
      clippedOutput,
      '```'
    ].filter(Boolean)
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: lines.join('\n') }
    }))
    setPanelActionStatus({ text: 'Terminal output added to chat', tone: 'info' })
  }, [activeTabKind, activeTerminalId, activeTerminalOutput, session.workDir, setPanelActionStatus])

  const addActiveTerminalSelectionToChat = useCallback((): void => {
    if (activeTabKind !== 'terminal') {
      setPanelActionStatus({ text: 'No active terminal selection to add', tone: 'danger' })
      return
    }
    const selection = activeTerminalSelection.trim()
    if (!selection) {
      setPanelActionStatus({ text: 'Terminal selection is empty', tone: 'danger' })
      return
    }
    const clippedSelection = selection.split('\n').slice(-80).join('\n').slice(-8_000)
    const lines = [
      'Review this selected terminal output:',
      `Working dir: ${session.workDir}`,
      activeTerminalId ? `Terminal: ${activeTerminalId}` : '',
      '',
      '```text',
      clippedSelection,
      '```'
    ].filter(Boolean)
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: lines.join('\n') }
    }))
    setPanelActionStatus({ text: 'Selected terminal output added to chat', tone: 'info' })
  }, [activeTabKind, activeTerminalId, activeTerminalSelection, session.workDir, setPanelActionStatus])

  const addActiveTerminalCommandOutputToChat = useCallback((): void => {
    if (activeTabKind !== 'terminal') {
      setPanelActionStatus({ text: 'No active terminal command to add', tone: 'danger' })
      return
    }
    if (!activeCommandState) {
      setPanelActionStatus({ text: 'No submitted terminal command to add', tone: 'danger' })
      return
    }
    const output = activeCommandOutput.trim()
    if (!output) {
      setPanelActionStatus({ text: 'Latest command output is empty', tone: 'danger' })
      return
    }
    const clippedOutput = output.split('\n').slice(-80).join('\n').slice(-8_000)
    const lines = [
      'Review this terminal command output:',
      `Working dir: ${session.workDir}`,
      activeTerminalId ? `Terminal: ${activeTerminalId}` : '',
      `Command: ${activeCommandState.command}`,
      '',
      '```text',
      clippedOutput,
      '```'
    ].filter(Boolean)
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: lines.join('\n') }
    }))
    setPanelActionStatus({ text: 'Latest command output added to chat', tone: 'info' })
  }, [activeCommandOutput, activeCommandState, activeTabKind, activeTerminalId, session.workDir, setPanelActionStatus])

  const closeTab = (tabId: BottomPanelTabId): void => {
    exitFullscreenForPanelTab('bottom', tabId)
    if (typeof tabId === 'number') window.api.terminal.kill(terminalId(tabId))
    const closingFinalTab = tabs.length <= 1
    closeTerminalTab(session.id, tabId)
    setPanelActionStatus({ text: `${bottomPanelTabLabel(tabId, 0, [tabId])} tab closed`, tone: 'info' })
    setTerminalMenu(null)
    if (closingFinalTab) focusBottomPanelToggle()
  }

  const moveTab = (tabId: BottomPanelTabId, direction: 'left' | 'right'): void => {
    moveTerminalTab(session.id, tabId, direction)
    setPanelActionStatus({ text: `${bottomPanelTabLabel(tabId, 0, [tabId])} tab moved ${direction}`, tone: 'info' })
    setTerminalMenu(null)
  }

  const moveTabToRight = (tabId: BottomPanelTabId): void => {
    transferSessionPanelTab(session.id, {
      sourcePanel: 'bottom',
      targetPanel: 'right',
      tabKind: bottomPanelTabKind(tabId),
      tabId
    })
    setPanelActionStatus({ text: `${bottomPanelTabLabel(tabId, 0, [tabId])} moved to right panel`, tone: 'info' })
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
      surface="bottom-panel"
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
        label="Resize bottom panel"
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
            data-app-shell-panel-chrome-surface="bottom-panel"
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
            data-bottom-panel-tab-kinds={tabs.map((tab) => bottomPanelTabKind(tab)).join(',')}
            data-bottom-panel-active-tab-kind={activeTabKind}
            data-bottom-panel-active-terminal-id={activeTerminalId ?? ''}
            data-terminal-last-command={activeCommandState?.command ?? ''}
            data-terminal-latest-command-output-lines={activeCommandOutput ? activeCommandOutput.split('\n').length : 0}
            data-terminal-selected-output-lines={activeTerminalSelection.trim() ? activeTerminalSelection.trim().split('\n').length : 0}
            data-terminal-action-status={terminalActionStatus?.text ?? ''}
            data-terminal-action-status-tone={terminalActionStatus?.tone ?? ''}
          >
            <PanelTabStrip
              tabs={terminalTabs}
              activeTabId={activeTab}
              panelId="bottom"
              onActivate={(tabId) => setActiveTerminalTab(session.id, tabId)}
              onClose={closeTab}
              onContextMenu={(event, tabId) => {
                event.preventDefault()
                const point = panelTabContextMenuPoint(event)
                setTerminalMenu({ tabId, ...point })
              }}
              onMove={(tabId, direction) => moveTab(tabId, direction)}
              stripTestId="terminal-panel-tabstrip"
              tabRowTestId="terminal-panel-tab-row"
              tabListLabel="Bottom panel tabs"
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
                  <IconButton
                    icon="plan"
                    label="Open Plan in bottom panel"
                    size="sm"
                    variant="toolbar"
                    active={activeTab === 'plan'}
                    dataTestId="bottom-panel-open-plan"
                    onClick={openPlanTab}
                  />
                  <ToolbarButton
                    icon="chat"
                    label="Add terminal output to chat"
                    size="sm"
                    variant="toolbar"
                    disabled={activeTabKind !== 'terminal' || !activeTerminalOutput.trim()}
                    dataTestId="terminal-add-output-to-chat"
                    onClick={addActiveTerminalOutputToChat}
                  />
                  <ToolbarButton
                    icon="copy"
                    label="Add selected terminal output to chat"
                    size="sm"
                    variant="toolbar"
                    disabled={activeTabKind !== 'terminal' || !activeTerminalSelection.trim()}
                    dataTestId="terminal-add-selected-output-to-chat"
                    onClick={addActiveTerminalSelectionToChat}
                  />
                  <ToolbarButton
                    icon="terminal"
                    label="Add latest command output to chat"
                    size="sm"
                    variant="toolbar"
                    disabled={activeTabKind !== 'terminal' || !activeCommandState || !activeCommandOutput.trim()}
                    dataTestId="terminal-add-command-output-to-chat"
                    onClick={addActiveTerminalCommandOutputToChat}
                  />
                  <ToolbarButton
                    icon="eraser"
                    label="Clear terminal"
                    size="sm"
                    variant="toolbar"
                    disabled={activeTabKind !== 'terminal'}
                    onClick={clearActiveTerminal}
                  />
                  <ToolbarButton
                    icon="close"
                    label="Hide bottom panel"
                    size="sm"
                    variant="toolbar"
                    onClick={() => {
                      setTerminalMenu(null)
                      setShowTerminal(session.id, false)
                      window.requestAnimationFrame(() => {
                        document.querySelector<HTMLButtonElement>('[data-testid="titlebar-toggle-terminal"]')?.focus({ preventScroll: true })
                      })
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
              data-panel-tab-transfer-kind={terminalMenu ? bottomPanelTabKind(terminalMenu.tabId) : 'unknown'}
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
                <MenuSectionLabel>{terminalMenu ? bottomPanelTabLabel(terminalMenu.tabId, 0, [terminalMenu.tabId]) : 'Tab'}</MenuSectionLabel>
                <MenuItem
                  icon="panelRight"
                  label="Move tab to right panel"
                  onClick={() => moveTabToRight(terminalMenu.tabId)}
                />
              </MenuSection>
              <MenuSection dataTestId="terminal-tab-context-menu-manage-section">
                <MenuSectionLabel>Manage</MenuSectionLabel>
                <MenuItem
                  icon="close"
                  label="Close tab"
                  disabled={!canCloseBottomPanelTab(terminalMenu.tabId, tabs)}
                  onClick={() => closeTab(terminalMenu.tabId)}
                />
              </MenuSection>
            </MenuSurface>
          )}

          <div
            id={panelTabPanelDomId('bottom', activeTab)}
            role="tabpanel"
            tabIndex={-1}
            aria-label={terminalTabs.find((tab) => tab.id === activeTab)?.label ?? 'Bottom panel'}
            aria-labelledby={panelTabDomId('bottom', activeTab)}
            data-app-shell-focus-area="bottom-panel"
            data-app-shell-tab-panel-controller="bottom"
            data-tab-id={activeTab}
            data-tab-kind={activeTabKind}
            data-bottom-panel-content-height={terminalHeight}
            data-bottom-panel-chrome-height={terminalChromeHeight}
            data-bottom-panel-total-height={terminalPanelTotalHeight}
            style={{ height: terminalHeight, flexShrink: 0, overflow: 'hidden', background: 'var(--surface-bg)' }}
          >
            {typeof activeTab === 'number' ? (
              <TerminalView
                key={terminalId(activeTab)}
                terminalId={terminalId(activeTab)}
                workDir={session.workDir}
                onNewTab={addTab}
                onOpenUrl={openTerminalUrl}
                onOutputChange={handleTerminalOutputChange}
                onSelectionChange={handleTerminalSelectionChange}
                onCommandSubmitted={handleTerminalCommandSubmitted}
              />
            ) : (
              <PlanPanel session={session} embedded />
            )}
          </div>
        </>
      )}
    </AppShellPanel>
  )
}

function bottomPanelTabKind(tabId: BottomPanelTabId): BottomPanelTabKind {
  return typeof tabId === 'number' ? 'terminal' : 'plan'
}

function bottomPanelTabIcon(tabId: BottomPanelTabId): 'terminal' | 'plan' {
  return typeof tabId === 'number' ? 'terminal' : 'plan'
}

function bottomPanelTabLabel(tabId: BottomPanelTabId, index: number, tabs: BottomPanelTabId[]): string {
  if (tabId === 'plan') return 'Plan'
  const terminalTabs = tabs.filter((tab): tab is number => typeof tab === 'number')
  const terminalOrdinal = terminalTabs.findIndex((tab) => tab === tabId) + 1
  return terminalTabs.length <= 1 ? 'Terminal' : `Terminal ${terminalOrdinal > 0 ? terminalOrdinal : index + 1}`
}

function bottomPanelTabCloseLabel(tabId: BottomPanelTabId): string {
  return tabId === 'plan' ? 'Close plan tab' : 'Close terminal'
}

function focusBottomPanelToggle(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="titlebar-toggle-terminal"]')?.focus({ preventScroll: true })
  })
}
