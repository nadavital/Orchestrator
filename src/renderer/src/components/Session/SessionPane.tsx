import { useState, useRef, useCallback, type MutableRefObject } from 'react'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import type { Session } from '../../types'
import ChatView from './ChatView'
import TerminalView from './TerminalView'
import InputBar from './InputBar'
import ContextSidebar from './ContextSidebar'
import RunningAgentsStrip from './RunningAgentsStrip'
import Icon from '../shared/Icon'
import { IconButton, MotionPanel, PanelResizeHandle, TabButton, ToolbarButton } from '../shared/designSystem'

const MIN_TERMINAL_HEIGHT = 120
const MAX_TERMINAL_HEIGHT = 600
const DEFAULT_TERMINAL_HEIGHT = 260

export default function SessionPane(): JSX.Element | null {
  const {
    sessions,
    activeSessionId,
    uiState,
    setShowTerminal,
    setTerminalHeight,
    addTerminalTab,
    setActiveTerminalTab,
    closeTerminalTab
  } = useSessionStore()
  const { projects } = useProjectStore()
  const session = sessions.find((s) => s.id === activeSessionId)
  const [promptInjectorRef] = useState<MutableRefObject<((text: string) => void) | null>>({ current: null })
  const [isTerminalResizing, setIsTerminalResizing] = useState(false)
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
  const ui = uiState[session.id] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showExtensions: false, showSideQuestions: false, hasUnread: false }
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
  }

  const handleSuggestedPrompt = (text: string): void => {
    promptInjectorRef.current?.(text)
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
      {/* Main content row: chat + optional side panels */}
      <div className="flex-1 flex min-w-0 overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Project label shown when new */}
          {isNew && project && (
            <div
              className="flex items-center gap-2 px-6 pt-6 shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <Icon name="folder" size={13} />
              <span className="text-xs">{project.name}</span>
            </div>
          )}
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <ChatView session={session} projectName={project?.name} onSuggestedPrompt={handleSuggestedPrompt} />
          </div>
          <RunningAgentsStrip session={session} />
          <InputBarWithInjector session={session} isNew={isNew} injectorRef={promptInjectorRef} />
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
                onClick={() => setShowTerminal(session.id, false)}
              />
            </div>
          </div>

          <div style={{ height: terminalHeight, flexShrink: 0, overflow: 'hidden', background: 'var(--surface-bg)' }}>
            <TerminalView terminalId={terminalId(activeTab)} workDir={session.workDir} />
          </div>
          </>
        )}
      </MotionPanel>
    </div>
  )
}

function InputBarWithInjector({
  session,
  isNew,
  injectorRef
}: {
  session: Session
  isNew: boolean
  injectorRef: MutableRefObject<((text: string) => void) | null>
}): JSX.Element {
  const [injectedText, setInjectedText] = useState('')
  injectorRef.current = setInjectedText
  return (
    <InputBar
      session={session}
      isNew={isNew}
      injectedText={injectedText}
      onInjectedConsumed={() => setInjectedText('')}
    />
  )
}
