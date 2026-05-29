import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../store/sessions'
import ChatView from './ChatView'
import InputBar from './InputBar'
import ContextSidebar from './ContextSidebar'
import RunningAgentsStrip from './RunningAgentsStrip'
import TerminalPanel from './TerminalPanel'
import Titlebar from '../Titlebar'
import { Button, PanelNotice } from '../shared/designSystem'
import { useShallow } from 'zustand/react/shallow'
import type { CSSProperties } from 'react'
import type { Session } from '../../types'

const SESSION_PANE_EMPTY_MESSAGES: Session['messages'] = []

interface SessionPaneProps {
  sessionId: string
}

function SessionPane({ sessionId }: SessionPaneProps): JSX.Element | null {
  const primaryContentRef = useRef<HTMLDivElement | null>(null)
  const composerReserveRef = useRef<HTMLDivElement | null>(null)
  const [composerReserveHeight, setComposerReserveHeight] = useState(0)
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
      worktreeState: current.worktreeState,
      repoRoot: current.repoRoot,
      forkedFromSessionName: current.forkedFromSessionName,
      forkMode: current.forkMode,
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
  const hydrateSession = useSessionStore((state) => state.hydrateSession)
  useEffect(() => {
    const globals = window as typeof window & { __orchestratorSessionPaneCommitCount?: number }
    if (typeof globals.__orchestratorSessionPaneCommitCount === 'number') {
      globals.__orchestratorSessionPaneCommitCount += 1
    }
  })

  useLayoutEffect(() => {
    const composerReserve = composerReserveRef.current
    if (!composerReserve) return
    const updateComposerReserve = (): void => {
      const nextHeight = Math.max(0, Math.ceil(composerReserve.getBoundingClientRect().height))
      setComposerReserveHeight((current) => current === nextHeight ? current : nextHeight)
      window.dispatchEvent(new CustomEvent('orchestrator:composer-reserve-changed', {
        detail: { sessionId, height: nextHeight }
      }))
    }
    updateComposerReserve()
    const observer = new ResizeObserver(updateComposerReserve)
    observer.observe(composerReserve)
    return () => observer.disconnect()
  }, [sessionId])

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
        <div
          ref={primaryContentRef}
          className="flex-1 min-w-0 flex flex-col overflow-hidden"
          data-testid="session-primary-content"
          data-composer-reserve-height={composerReserveHeight}
          data-composer-reserve-ready={composerReserveHeight > 0 ? 'true' : 'false'}
          style={{
            '--composer-reserve-height': `${composerReserveHeight}px`
          } as CSSProperties}
        >
          <Titlebar />
          <WorktreeLifecycleNotice session={session} onHydrate={hydrateSession} />
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <ChatView sessionId={session.id} />
          </div>
          <RunningAgentsStrip sessionId={session.id} />
          <div
            ref={composerReserveRef}
            data-testid="composer-reserve"
            data-composer-reserve-height={composerReserveHeight}
            className="shrink-0"
          >
            <InputBar session={session} isNew={isNew} />
          </div>
        </div>

        <ContextSidebar sessionId={session.id} />
      </div>

      <TerminalPanel session={session} />
    </div>
  )
}

export default memo(SessionPane)

function WorktreeLifecycleNotice({
  session,
  onHydrate
}: {
  session: Session
  onHydrate: (session: Session) => void
}): JSX.Element | null {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const worktreeState = session.worktreeState
  const visible = session.useWorktree && worktreeState && worktreeState !== 'ready'
  const retry = useCallback(async (): Promise<void> => {
    if (retrying) return
    setRetrying(true)
    setRetryError(null)
    try {
      const retried = await window.api.sessions.retryPendingWorktree(session.id)
      onHydrate(retried)
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'Could not retry worktree creation.')
    } finally {
      setRetrying(false)
    }
  }, [onHydrate, retrying, session.id])

  if (!visible) return null

  const failed = worktreeState === 'failed'
  const sourceLabel = session.forkedFromSessionName
    ? `Forked from ${session.forkedFromSessionName}.`
    : 'The chat is waiting for its isolated workspace.'

  return (
    <div className="shrink-0 px-6 pt-2">
      <PanelNotice
        dataTestId="worktree-lifecycle-notice"
        state={worktreeState}
        tone={failed ? 'danger' : 'warning'}
        title={failed ? 'Worktree setup failed' : 'Preparing worktree'}
        description={failed
          ? `${sourceLabel} Retry when the repository is ready.`
          : `${sourceLabel} You can inspect the transcript while Orchestrator prepares the workspace.`}
        code={session.workDir}
        rootAttrs={{
          role: failed ? 'alert' : 'status',
          'aria-live': failed ? 'assertive' : 'polite',
          'aria-atomic': 'true',
          'data-worktree-lifecycle-state': worktreeState,
          'data-worktree-lifecycle-fork-mode': session.forkMode ?? undefined
        }}
        actions={failed ? (
          <Button
            variant="secondary"
            onClick={() => void retry()}
            disabled={retrying}
            dataTestId="worktree-lifecycle-retry"
          >
            {retrying ? 'Retrying...' : 'Retry worktree'}
          </Button>
        ) : undefined}
      >
        {retryError && (
          <div
            className="mt-2 text-xs"
            role="status"
            aria-live="polite"
            data-testid="worktree-lifecycle-error"
            style={{ color: 'var(--color-red)' }}
          >
            {retryError}
          </div>
        )}
      </PanelNotice>
    </div>
  )
}
