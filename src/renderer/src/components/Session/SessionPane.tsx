import { useState, useRef, useCallback, useEffect, type MutableRefObject } from 'react'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import type { Session } from '../../types'
import ChatView from './ChatView'
import TerminalView from './TerminalView'
import InputBar from './InputBar'
import ContextSidebar from './ContextSidebar'
import RunningAgentsStrip from './RunningAgentsStrip'
import Icon from '../shared/Icon'

const MIN_TERMINAL_HEIGHT = 120
const MAX_TERMINAL_HEIGHT = 600
const DEFAULT_TERMINAL_HEIGHT = 260

export default function SessionPane(): JSX.Element | null {
  const { sessions, activeSessionId, uiState, setShowTerminal } = useSessionStore()
  const { projects } = useProjectStore()
  const session = sessions.find((s) => s.id === activeSessionId)
  const [promptInjectorRef] = useState<MutableRefObject<((text: string) => void) | null>>({ current: null })
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)

  // Tab state: array of tab indices, active tab index
  const [tabs, setTabs] = useState<number[]>([0])
  const [activeTab, setActiveTab] = useState(0)
  const nextTabId = useRef(1)

  // Reset tabs when session changes
  const sessionIdRef = useRef(session?.id)
  useEffect(() => {
    if (session?.id !== sessionIdRef.current) {
      sessionIdRef.current = session?.id
      setTabs([0])
      setActiveTab(0)
      nextTabId.current = 1
    }
  }, [session?.id])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartRef.current = { y: e.clientY, h: terminalHeight }

    const onMove = (me: MouseEvent): void => {
      if (!dragStartRef.current) return
      const delta = dragStartRef.current.y - me.clientY
      const next = Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, dragStartRef.current.h + delta))
      setTerminalHeight(next)
    }
    const onUp = (): void => {
      dragStartRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [terminalHeight])

  if (!session) return null

  const isNew = session.messages.length === 0 && session.status !== 'running'
  const project = projects.find((p) => p.id === session.projectId)
  const ui = uiState[session.id] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showExtensions: false, showSideQuestions: false, showUsage: false, hasUnread: false }

  const terminalId = (tab: number): string => `${session.id}-${tab}`

  const addTab = (): void => {
    const id = nextTabId.current++
    setTabs((prev) => [...prev, id])
    setActiveTab(id)
  }

  const closeTab = (tabId: number): void => {
    window.api.terminal.kill(terminalId(tabId))
    const remaining = tabs.filter((t) => t !== tabId)
    if (remaining.length === 0) {
      setShowTerminal(session.id, false)
      setTabs([0])
      setActiveTab(0)
      nextTabId.current = 1
    } else {
      setTabs(remaining)
      if (activeTab === tabId) setActiveTab(remaining[remaining.length - 1])
    }
  }

  const handleSuggestedPrompt = (text: string): void => {
    promptInjectorRef.current?.(text)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
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
      {ui.showTerminal && (
        <>
          <div
            onMouseDown={handleResizeStart}
            style={{
              height: 4,
              background: 'var(--surface-bg)',
              cursor: 'ns-resize',
              flexShrink: 0,
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--control-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-bg)')}
          />

          <div
            className="flex items-center shrink-0"
            style={{
              height: 42,
              background: 'var(--surface-bg)',
              borderTop: '1px solid var(--border-subtle)'
            }}
          >
            <div className="flex items-center gap-1 flex-1 overflow-x-auto h-full px-3">
              {tabs.map((tabId, idx) => {
                const active = tabId === activeTab
                return (
                  <div
                    key={tabId}
                    className="flex items-center shrink-0 rounded-lg"
                    style={{
                      height: 30,
                      background: active ? 'var(--control-bg)' : 'transparent'
                    }}
                  >
                    <button
                      onClick={() => setActiveTab(tabId)}
                      className="flex items-center gap-2 h-full text-sm"
                      style={{
                        padding: '0 12px',
                        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                        fontWeight: active ? 500 : 400
                      }}
                    >
                      <Icon name="terminal" size={15} />
                      {tabs.length === 1 ? 'Terminal' : `Terminal ${idx + 1}`}
                    </button>
                    {tabs.length > 1 && (
                      <button
                        onClick={() => closeTab(tabId)}
                        className="h-full flex items-center"
                        style={{ color: 'var(--color-text-muted)' }}
                        title="Close terminal"
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              <button
                onClick={addTab}
                title="New terminal"
                className="rounded-lg flex items-center justify-center"
                style={{
                  width: 30,
                  height: 30,
                  color: 'var(--color-text-muted)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-text)'
                  e.currentTarget.style.background = 'var(--control-bg-hover)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>

            <div className="flex items-center gap-0.5 px-2 shrink-0">
              <button
                onClick={() => window.api.terminal.clear(terminalId(activeTab))}
                title="Clear"
                className="rounded-lg px-2 py-1 text-xs"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                Clear
              </button>
              <button
                onClick={() => setShowTerminal(session.id, false)}
                title="Hide terminal"
                className="rounded-lg flex items-center justify-center"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          </div>

          <div style={{ height: terminalHeight, flexShrink: 0, overflow: 'hidden', background: 'var(--surface-bg)' }}>
            <TerminalView terminalId={terminalId(activeTab)} workDir={session.workDir} />
          </div>
        </>
      )}
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
