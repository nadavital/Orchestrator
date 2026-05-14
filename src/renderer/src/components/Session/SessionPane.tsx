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
          {/* Drag handle */}
          <div
            onMouseDown={handleResizeStart}
            style={{
              height: 6,
              background: 'var(--border-subtle)',
              cursor: 'ns-resize',
              flexShrink: 0,
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--border-subtle)')}
          />

          {/* Tab bar */}
          <div
            className="flex items-center shrink-0"
            style={{
              height: 36,
              background: 'var(--panel-bg)',
              borderBottom: '1px solid var(--border-subtle)',
              borderTop: '1px solid var(--border-subtle)'
            }}
          >
            {/* Tabs */}
            <div className="flex items-stretch flex-1 overflow-x-auto h-full">
              {tabs.map((tabId, idx) => {
                const active = tabId === activeTab
                return (
                  <div
                    key={tabId}
                    className="flex items-center shrink-0"
                    style={{
                      borderRight: '1px solid var(--border-subtle)',
                      background: active ? 'var(--control-bg-active)' : 'transparent'
                    }}
                  >
                    <button
                      onClick={() => setActiveTab(tabId)}
                      className="flex items-center gap-1.5 px-3 h-full text-xs"
                      style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
                        <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM4.28 5.22a.75.75 0 0 0-1.06 1.06L5.44 8.5 3.22 10.72a.75.75 0 1 0 1.06 1.06l2.75-2.75a.75.75 0 0 0 0-1.06Zm3.47 5.28a.75.75 0 0 1 0-1.5h3a.75.75 0 0 1 0 1.5Z" />
                      </svg>
                      Shell {idx + 1}
                    </button>
                    {tabs.length > 1 && (
                      <button
                        onClick={() => closeTab(tabId)}
                        className="px-1.5 h-full flex items-center"
                        style={{ color: 'var(--color-text-muted)' }}
                        title="Close terminal"
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                      >
                        <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Right-side actions */}
            <div className="flex items-center gap-0.5 px-2 shrink-0">
              <button
                onClick={() => window.api.terminal.clear(terminalId(activeTab))}
                title="Clear"
                className="rounded-md px-2 py-1 text-xs"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                Clear
              </button>
              <button
                onClick={addTab}
                title="New terminal"
                className="rounded-md px-2 py-1 text-xs"
                style={{ color: 'var(--color-text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
              >
                +
              </button>
            </div>
          </div>

          <div style={{ height: terminalHeight, flexShrink: 0, overflow: 'hidden' }}>
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
