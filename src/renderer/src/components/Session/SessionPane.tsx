import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { defaultUI, useSessionStore } from '../../store/sessions'
import ChatView from './ChatView'
import TerminalView from './TerminalView'
import InputBar from './InputBar'
import ContextSidebar from './ContextSidebar'
import RunningAgentsStrip from './RunningAgentsStrip'
import { IconButton, MenuItem, MenuSurface, MotionPanel, PanelResizeHandle, PanelTabStrip, ToolbarButton } from '../shared/designSystem'
import { useShallow } from 'zustand/react/shallow'
import type { Session } from '../../types'

const MIN_TERMINAL_HEIGHT = 120
const MAX_TERMINAL_HEIGHT = 600
const DEFAULT_TERMINAL_HEIGHT = 260
const SESSION_PANE_EMPTY_MESSAGES: Session['messages'] = []

interface SessionPaneProps {
  sessionId: string
}

function SessionPane({ sessionId }: SessionPaneProps): JSX.Element | null {
  const session = useSessionStore(useShallow((state): Session | null => {
    const current = state.sessions.find((candidate) => candidate.id === sessionId)
    if (!current) return null
    return {
      id: current.id,
      name: current.name,
      pinned: current.pinned,
      pinOrder: current.pinOrder,
      projectId: current.projectId,
      workDir: current.workDir,
      useWorktree: current.useWorktree,
      repoRoot: current.repoRoot,
      providerSessionId: current.providerSessionId,
      claudeSessionId: current.claudeSessionId,
      status: current.status,
      messages: SESSION_PANE_EMPTY_MESSAGES,
      messageCount: current.messageCount ?? current.messages.length,
      messagesLoaded: current.messagesLoaded,
      previewText: current.previewText,
      latestMessageAt: current.latestMessageAt,
      archivedAt: current.archivedAt,
      createdAt: current.createdAt,
      provider: current.provider,
      model: current.model,
      effort: current.effort,
      agentName: current.agentName,
      permissionMode: current.permissionMode,
      allowedTools: current.allowedTools,
      disallowedTools: current.disallowedTools,
      availableTools: current.availableTools,
      additionalDirs: current.additionalDirs,
      runtime: current.runtime,
      useThinking: current.useThinking,
      useFast: current.useFast,
      usageSummary: current.usageSummary
    }
  }))
  const ui = useSessionStore(useShallow((state) => {
    const current = state.uiState[sessionId] ?? defaultUI
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
  const closeTerminalTab = useSessionStore((state) => state.closeTerminalTab)
  const [isTerminalResizing, setIsTerminalResizing] = useState(false)
  const [terminalMenu, setTerminalMenu] = useState<{ tabId: number; x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)

  useEffect(() => {
    const globals = window as typeof window & { __orchestratorSessionPaneCommitCount?: number }
    if (typeof globals.__orchestratorSessionPaneCommitCount === 'number') {
      globals.__orchestratorSessionPaneCommitCount += 1
    }
  })

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!session) return
    const currentPanel = useSessionStore.getState().uiState[session.id]?.terminalPanel
    const currentHeight = currentPanel?.height ?? DEFAULT_TERMINAL_HEIGHT
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragStartRef.current = { y: e.clientY, h: currentHeight }
    setIsTerminalResizing(true)

    const onMove = (me: PointerEvent): void => {
      if (!dragStartRef.current) return
      const delta = dragStartRef.current.y - me.clientY
      const next = Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, dragStartRef.current.h + delta))
      setTerminalHeight(session.id, next)
    }
    const onUp = (): void => {
      dragStartRef.current = null
      setIsTerminalResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [session, setTerminalHeight])

  if (!session) return null

  const isNew = (session.messageCount ?? session.messages.length) === 0 && session.status !== 'running'
  const terminalPanel = ui.terminalPanel ?? { height: DEFAULT_TERMINAL_HEIGHT, tabs: [0], activeTabId: 0, nextTabId: 1 }
  const terminalHeight = terminalPanel.height
  const tabs = terminalPanel.tabs
  const activeTab = terminalPanel.activeTabId

  const terminalId = (tab: number): string => `${session.id}-${tab}`
  const terminalTabs = tabs.map((tabId, idx) => ({
    id: tabId,
    label: tabs.length === 1 ? 'Terminal' : `Terminal ${idx + 1}`,
    icon: 'terminal' as const,
    closeLabel: 'Close terminal'
  }))

  const addTab = (): void => {
    addTerminalTab(session.id)
  }

  const closeTab = (tabId: number): void => {
    window.api.terminal.kill(terminalId(tabId))
    closeTerminalTab(session.id, tabId)
    setTerminalMenu(null)
  }

  const moveTab = (tabId: number, direction: 'left' | 'right'): void => {
    moveTerminalTab(session.id, tabId, direction)
    setTerminalMenu(null)
  }

  const terminalMenuIndex = terminalMenu ? tabs.findIndex((tabId) => tabId === terminalMenu.tabId) : -1

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
      {/* Main content row: chat + optional side panels */}
      <div className="relative flex-1 flex min-w-0 overflow-hidden" data-testid="session-main-row">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="session-primary-content">
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <ChatView sessionId={session.id} />
          </div>
          <RunningAgentsStrip sessionId={session.id} />
          <InputBar session={session} isNew={isNew} />
        </div>

        <ContextSidebar sessionId={session.id} />
      </div>

      {/* Terminal bottom panel */}
      <MotionPanel
        open={ui.showTerminal}
        side="bottom"
        size={terminalHeight + 50}
        className="flex flex-col"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <PanelResizeHandle
          orientation="horizontal"
          label="Resize terminal"
          active={isTerminalResizing}
          onPointerDown={handleResizeStart}
        />
        {ui.showTerminal && (
          <>
          <div
            className="terminal-panel-header"
            data-testid="session-bottom-panel"
            data-app-shell-focus-area="bottom-panel"
            data-bottom-panel-height={terminalHeight}
            data-bottom-panel-tabs={tabs.join(',')}
            data-bottom-panel-active-tab={activeTab}
          >
            <PanelTabStrip
              tabs={terminalTabs}
              activeTabId={activeTab}
              onActivate={(tabId) => setActiveTerminalTab(session.id, tabId)}
              onClose={tabs.length > 1 ? closeTab : undefined}
              onContextMenu={(event, tabId) => {
                event.preventDefault()
                setTerminalMenu({ tabId, x: event.clientX, y: event.clientY })
              }}
              className="terminal-panel-tabstrip"
              tabRowTestId="terminal-panel-tab-row"
              actions={(
                <>
              <IconButton icon="plus" label="New terminal" size="sm" onClick={addTab} />
              <ToolbarButton
                icon="eraser"
                label="Clear terminal"
                size="sm"
                onClick={() => window.api.terminal.clear(terminalId(activeTab))}
              />
              <ToolbarButton
                icon="close"
                label="Hide terminal"
                size="sm"
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
              onClose={() => setTerminalMenu(null)}
              style={{
                position: 'fixed',
                left: Math.max(8, Math.min(terminalMenu.x, window.innerWidth - 190)),
                top: Math.max(8, Math.min(terminalMenu.y, window.innerHeight - 130)),
                width: 180,
                zIndex: 80
              }}
            >
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
              <MenuItem
                icon="close"
                label="Close terminal tab"
                disabled={tabs.length <= 1}
                onClick={() => closeTab(terminalMenu.tabId)}
              />
            </MenuSurface>
          )}

          <div style={{ height: terminalHeight, flexShrink: 0, overflow: 'hidden', background: 'var(--surface-bg)' }}>
            <TerminalView terminalId={terminalId(activeTab)} workDir={session.workDir} />
          </div>
          </>
        )}
      </MotionPanel>
    </div>
  )
}

export default memo(SessionPane)
