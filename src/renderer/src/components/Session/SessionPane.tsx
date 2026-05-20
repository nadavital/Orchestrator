import { memo, useState, useRef, useCallback } from 'react'
import { defaultUI, useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import type { Session } from '../../types'
import ChatView from './ChatView'
import TerminalView from './TerminalView'
import InputBar from './InputBar'
import ContextSidebar from './ContextSidebar'
import RunningAgentsStrip from './RunningAgentsStrip'
import { IconButton, MenuItem, MenuSurface, MotionPanel, PanelResizeHandle, TabButton, ToolbarButton } from '../shared/designSystem'

const MIN_TERMINAL_HEIGHT = 120
const MAX_TERMINAL_HEIGHT = 600
const DEFAULT_TERMINAL_HEIGHT = 260

interface SessionPaneProps {
  sessionId: string
}

function SessionPane({ sessionId }: SessionPaneProps): JSX.Element | null {
  const sessions = useSessionStore((state) => state.sessions)
  const ui = useSessionStore((state) => state.uiState[sessionId] ?? defaultUI)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const setTerminalHeight = useSessionStore((state) => state.setTerminalHeight)
  const addTerminalTab = useSessionStore((state) => state.addTerminalTab)
  const setActiveTerminalTab = useSessionStore((state) => state.setActiveTerminalTab)
  const moveTerminalTab = useSessionStore((state) => state.moveTerminalTab)
  const closeTerminalTab = useSessionStore((state) => state.closeTerminalTab)
  const { projects } = useProjectStore()
  const session = sessions.find((s) => s.id === sessionId)
  const [isTerminalResizing, setIsTerminalResizing] = useState(false)
  const [terminalMenu, setTerminalMenu] = useState<{ tabId: number; x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)

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
  const project = projects.find((p) => p.id === session.projectId)
  const terminalPanel = ui.terminalPanel ?? { height: DEFAULT_TERMINAL_HEIGHT, tabs: [0], activeTabId: 0, nextTabId: 1 }
  const terminalHeight = terminalPanel.height
  const tabs = terminalPanel.tabs
  const activeTab = terminalPanel.activeTabId

  const terminalId = (tab: number): string => `${session.id}-${tab}`

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
            <ChatView session={session} projectName={project?.name} />
          </div>
          <RunningAgentsStrip session={session} />
          <InputBar session={session} isNew={isNew} />
        </div>

        <ContextSidebar session={session} />
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
            className="flex items-center shrink-0"
            data-testid="session-bottom-panel"
            data-app-shell-focus-area="bottom-panel"
            data-bottom-panel-height={terminalHeight}
            data-bottom-panel-tabs={tabs.join(',')}
            data-bottom-panel-active-tab={activeTab}
            style={{
              height: 42,
              background: 'var(--surface-bg)',
              borderBottom: '1px solid var(--border-subtle)'
            }}
          >
            <div className="right-panel-tab-bar-header-spacer h-full w-2 shrink-0" />
            <div className="flex items-center gap-1 flex-1 overflow-x-auto h-full px-3">
              {tabs.map((tabId, idx) => {
                const active = tabId === activeTab
                return (
                  <div
                    key={tabId}
                    className="flex items-center shrink-0"
                  >
                    <TabButton
                      active={active}
                      onClick={() => setActiveTerminalTab(session.id, tabId)}
                      onClose={tabs.length > 1 ? () => closeTab(tabId) : undefined}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setTerminalMenu({ tabId, x: event.clientX, y: event.clientY })
                      }}
                      closeLabel="Close terminal"
                    >
                      <Icon name="terminal" size={15} />
                      {tabs.length === 1 ? 'Terminal' : `Terminal ${idx + 1}`}
                    </TabButton>
                  </div>
                )
              })}
              <IconButton icon="plus" label="New terminal" onClick={addTab} />
            </div>

            <div className="flex items-center gap-0.5 px-2 shrink-0">
              <ToolbarButton
                icon="eraser"
                label="Clear terminal"
                onClick={() => window.api.terminal.clear(terminalId(activeTab))}
              />
              <ToolbarButton
                icon="close"
                label="Hide terminal"
                onClick={() => {
                  setTerminalMenu(null)
                  setShowTerminal(session.id, false)
                }}
              />
            </div>
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
