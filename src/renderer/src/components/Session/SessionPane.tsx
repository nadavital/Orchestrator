import { memo, useEffect } from 'react'
import { useSessionStore } from '../../store/sessions'
import ChatView from './ChatView'
import InputBar from './InputBar'
import ContextSidebar from './ContextSidebar'
import RunningAgentsStrip from './RunningAgentsStrip'
import TerminalPanel from './TerminalPanel'
import Titlebar from '../Titlebar'
import { useShallow } from 'zustand/react/shallow'
import type { Session } from '../../types'

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
  useEffect(() => {
    const globals = window as typeof window & { __orchestratorSessionPaneCommitCount?: number }
    if (typeof globals.__orchestratorSessionPaneCommitCount === 'number') {
      globals.__orchestratorSessionPaneCommitCount += 1
    }
  })

  if (!session) return null

  const isNew = (session.messageCount ?? session.messages.length) === 0 && session.status !== 'running'

  return (
    <div
      className="relative flex flex-col h-full overflow-hidden"
      data-testid="session-shell"
      style={{ background: 'var(--canvas-bg)' }}
    >
      {/* Main content row: chat + optional side panels */}
      <div className="relative flex-1 flex min-w-0 overflow-hidden" data-testid="session-main-row">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" data-testid="session-primary-content">
          <Titlebar />
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <ChatView sessionId={session.id} />
          </div>
          <RunningAgentsStrip sessionId={session.id} />
          <InputBar session={session} isNew={isNew} />
        </div>

        <ContextSidebar sessionId={session.id} />
      </div>

      <TerminalPanel session={session} />
    </div>
  )
}

export default memo(SessionPane)
