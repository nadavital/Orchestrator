import { useState } from 'react'
import type { Session } from '../../types'
import type { SideChatContextSnapshot } from '../../store/sessions'
import { sideChatContextSnapshot, useSessionStore } from '../../store/sessions'
import { Button, IconButton, InspectorCard } from '../shared/designSystem'

interface Props {
  session: Session
  chatId?: string
  embedded?: boolean
}

type SideChatActionStatus = {
  text: string
  tone: 'info' | 'danger'
}

export default function SideQuestionPanel({ session, chatId, embedded }: Props): JSX.Element {
  const { uiState, appendSideQuestion, updateSideQuestion, appendSideChatMessage, updateSideChatMessage, setSideChatDraft } = useSessionStore()
  const [legacyQuestion, setLegacyQuestion] = useState('')
  const [actionStatus, setActionStatus] = useState<SideChatActionStatus | null>(null)
  const ui = uiState[session.id]
  const sideChat = chatId ? ui?.sideChats?.find((chat) => chat.id === chatId) : null
  const messages = sideChat?.messages ?? ui?.sideQuestions ?? []
  const pending = messages.some((message) => message.status === 'pending')
  const errorCount = messages.filter((message) => message.status === 'error').length
  const question = chatId ? sideChat?.draft ?? '' : legacyQuestion
  const context = chatId ? sideChat?.context ?? sideChatContextSnapshot(session, 'restored') : null
  const visibleActionStatus = sideChatVisibleActionStatus(messages, actionStatus)

  const setQuestion = (value: string): void => {
    if (chatId) setSideChatDraft(session.id, chatId, value)
    else setLegacyQuestion(value)
  }

  const submit = async (): Promise<void> => {
    const trimmed = question.trim()
    if (!trimmed || pending) return
    setQuestion('')
    setActionStatus({ text: 'Question sent', tone: 'info' })
    const userId = crypto.randomUUID()
    const answerId = crypto.randomUUID()
    const append = chatId
      ? (message: Parameters<typeof appendSideChatMessage>[2]): void => appendSideChatMessage(session.id, chatId, message)
      : (message: Parameters<typeof appendSideQuestion>[1]): void => appendSideQuestion(session.id, message)
    append({ id: userId, role: 'user', content: trimmed, status: 'complete' })
    append({ id: answerId, role: 'assistant', content: 'Thinking...', status: 'pending' })
    try {
      const result = await window.api.sessions.answerSideQuestion(session.id, trimmed, messages)
      const patch = {
        content: result.ok ? result.answer : (result.error ?? 'Side question failed.'),
        status: result.ok ? 'complete' : 'error',
        usage: result.usage
      } as const
      setActionStatus({ text: result.ok ? 'Answer ready' : 'Answer failed', tone: result.ok ? 'info' : 'danger' })
      if (chatId) updateSideChatMessage(session.id, chatId, answerId, patch)
      else updateSideQuestion(session.id, answerId, patch)
    } catch (error) {
      const patch = {
        content: error instanceof Error ? error.message : 'Side question failed.',
        status: 'error'
      } as const
      setActionStatus({ text: 'Answer failed', tone: 'danger' })
      if (chatId) updateSideChatMessage(session.id, chatId, answerId, patch)
      else updateSideQuestion(session.id, answerId, patch)
    }
  }

  const retryAnswer = async (messageId: string, index: number): Promise<void> => {
    if (pending) return
    const previousUserMessage = [...messages.slice(0, index)]
      .reverse()
      .find((message) => message.role === 'user' && message.content.trim())
    const retryQuestion = previousUserMessage?.content.trim()
    if (!retryQuestion) return
    const pendingPatch = { content: 'Thinking...', status: 'pending' as const }
    setActionStatus({ text: 'Retrying answer', tone: 'info' })
    if (chatId) updateSideChatMessage(session.id, chatId, messageId, pendingPatch)
    else updateSideQuestion(session.id, messageId, pendingPatch)
    try {
      const result = await window.api.sessions.answerSideQuestion(session.id, retryQuestion, messages.slice(0, index))
      const patch = {
        content: result.ok ? result.answer : (result.error ?? 'Side question failed.'),
        status: result.ok ? 'complete' : 'error',
        usage: result.usage
      } as const
      setActionStatus({ text: result.ok ? 'Answer ready' : 'Retry failed', tone: result.ok ? 'info' : 'danger' })
      if (chatId) updateSideChatMessage(session.id, chatId, messageId, patch)
      else updateSideQuestion(session.id, messageId, patch)
    } catch (error) {
      const patch = {
        content: error instanceof Error ? error.message : 'Side question failed.',
        status: 'error'
      } as const
      setActionStatus({ text: 'Retry failed', tone: 'danger' })
      if (chatId) updateSideChatMessage(session.id, chatId, messageId, patch)
      else updateSideQuestion(session.id, messageId, patch)
    }
  }

  return (
    <div
      className={embedded ? 'h-full min-h-0 flex flex-col p-3' : 'flex flex-col'}
      data-testid={chatId ? 'side-chat-panel' : 'side-question-panel'}
      data-side-chat-id={chatId ?? ''}
      data-side-chat-message-count={messages.length}
      data-side-chat-pending={pending ? 'true' : 'false'}
      data-side-chat-errors={errorCount}
      data-side-chat-action-status={visibleActionStatus?.text ?? ''}
      data-side-chat-action-status-tone={visibleActionStatus?.tone ?? ''}
      style={{ color: 'var(--color-text)' }}
    >
      {chatId && (
        <div className="mb-2 flex shrink-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {sideChat?.title ?? 'Side chat'}
            </div>
            {context && (
              <div
                className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]"
                data-testid="side-chat-context-meta"
                data-side-chat-context-source={context.source}
                data-side-chat-context-message-count={context.messageCount}
                data-side-chat-context-provider={context.provider}
                data-side-chat-context-model={context.model}
                title={context.workDir}
                style={{ color: 'var(--text-tertiary)' }}
              >
                <span>{sideChatSourceLabel(context.source)}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate" style={{ maxWidth: 180 }}>{context.sessionName}</span>
                <span aria-hidden="true">·</span>
                <span>{providerModelLabel(context)}</span>
                <span aria-hidden="true">·</span>
                <span>{context.messageCount} msg{context.messageCount === 1 ? '' : 's'}</span>
                {context.questionPreview && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate" style={{ maxWidth: 220 }}>{context.questionPreview}</span>
                  </>
                )}
              </div>
            )}
            {(messages.length > 0 || pending || errorCount > 0) && (
              <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {messages.length} message{messages.length === 1 ? '' : 's'}
                {pending ? ' · answering' : ''}
                {errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? '' : 's'}` : ''}
              </div>
            )}
          </div>
        </div>
      )}
      <div
        className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1"
        role={chatId ? 'log' : undefined}
        aria-live={chatId ? 'polite' : undefined}
        aria-relevant={chatId ? 'additions text' : undefined}
        aria-label={chatId ? 'Side chat messages' : undefined}
        data-testid={chatId ? 'side-chat-message-log' : 'side-question-message-log'}
      >
        {messages.length === 0 ? (
          <div className="side-chat-empty" data-testid="side-chat-empty-state" role="status" aria-live="polite">
            No side chat yet.
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={message.id}
              role={chatId ? 'article' : undefined}
              aria-label={chatId ? `${message.role === 'user' ? 'You' : 'Side answer'}: ${message.status}` : undefined}
            >
              <InspectorCard
                className="p-3 text-sm"
                active={message.role === 'user'}
                style={{
                  color: message.status === 'error' ? 'var(--color-red)' : 'var(--color-text)'
                }}
              >
                <div
                  className="mb-1 text-[11px] font-semibold tracking-normal"
                  data-testid="side-chat-message-label"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {message.role === 'user' ? 'You' : message.status === 'pending' ? 'Answering' : 'Side answer'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.content}</div>
                {message.role === 'assistant' && message.status === 'error' && (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      variant="secondary"
                      className="h-7 px-2 py-1"
                      dataTestId={chatId ? 'side-chat-retry' : 'side-question-retry'}
                      onClick={() => { void retryAnswer(message.id, index) }}
                      disabled={pending}
                    >
                      Retry
                    </Button>
                  </div>
                )}
                {message.usage?.totalCostUsd !== undefined && (
                  <div className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    ${message.usage.totalCostUsd.toFixed(4)}
                  </div>
                )}
              </InspectorCard>
            </div>
          ))
        )}
      </div>
      <form
        className="side-chat-composer mt-3 flex items-center gap-2"
        data-testid={chatId ? 'side-chat-composer' : 'side-question-composer'}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <textarea
          data-testid={chatId ? 'side-chat-input' : 'side-question-input'}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            void submit()
          }}
          placeholder="Ask in side chat"
          disabled={pending}
          rows={1}
          className="side-chat-input min-w-0 flex-1 resize-none text-sm outline-none"
        />
        <span
          className="side-chat-action-status"
          data-testid={chatId ? 'side-chat-action-status' : 'side-question-action-status'}
          data-side-chat-action-status-tone={visibleActionStatus?.tone ?? ''}
          role={visibleActionStatus?.tone === 'danger' ? 'alert' : 'status'}
          aria-live={visibleActionStatus?.tone === 'danger' ? 'assertive' : 'polite'}
          aria-atomic="true"
          hidden={visibleActionStatus === null}
        >
          {visibleActionStatus?.text ?? ''}
        </span>
        <IconButton
          icon="send"
          label="Send side question"
          onClick={() => { void submit() }}
          disabled={!question.trim() || pending}
          size="sm"
          tone="accent"
          className="side-chat-send"
          dataTestId={chatId ? 'side-chat-send' : 'side-question-send'}
        />
      </form>
    </div>
  )
}

function sideChatVisibleActionStatus(
  messages: Array<{ role: string; status: string }>,
  fallback: SideChatActionStatus | null
): SideChatActionStatus | null {
  if (messages.some((message) => message.status === 'pending')) return { text: 'Answering', tone: 'info' }
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  if (lastAssistant?.status === 'error') return { text: 'Answer failed', tone: 'danger' }
  if (lastAssistant?.status === 'complete') return { text: 'Answer ready', tone: 'info' }
  return fallback
}

function sideChatSourceLabel(source: SideChatContextSnapshot['source']): string {
  if (source === 'composer-btw') return 'Composer /btw'
  if (source === 'slash-command') return 'Slash /btw'
  if (source === 'workbench-new-tab') return 'Workbench'
  return 'Main thread'
}

function providerModelLabel(context: SideChatContextSnapshot): string {
  const provider = displayContextValue(context.provider)
  const model = displayContextValue(context.model)
  if (provider && model) return `${provider} / ${model}`
  return provider || model || 'Provider'
}

function displayContextValue(value: string): string {
  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.length <= 2 ? part.toUpperCase() : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
