import { useState } from 'react'
import type { Session } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { IconButton, InspectorCard } from '../shared/designSystem'

interface Props {
  session: Session
  chatId?: string
  embedded?: boolean
}

export default function SideQuestionPanel({ session, chatId, embedded }: Props): JSX.Element {
  const { uiState, appendSideQuestion, updateSideQuestion, appendSideChatMessage, updateSideChatMessage, setSideChatDraft } = useSessionStore()
  const [legacyQuestion, setLegacyQuestion] = useState('')
  const ui = uiState[session.id]
  const sideChat = chatId ? ui?.sideChats?.find((chat) => chat.id === chatId) : null
  const messages = sideChat?.messages ?? ui?.sideQuestions ?? []
  const pending = messages.some((message) => message.status === 'pending')
  const errorCount = messages.filter((message) => message.status === 'error').length
  const question = chatId ? sideChat?.draft ?? '' : legacyQuestion

  const setQuestion = (value: string): void => {
    if (chatId) setSideChatDraft(session.id, chatId, value)
    else setLegacyQuestion(value)
  }

  const submit = async (): Promise<void> => {
    const trimmed = question.trim()
    if (!trimmed || pending) return
    setQuestion('')
    const userId = crypto.randomUUID()
    const answerId = crypto.randomUUID()
    const append = chatId
      ? (message: Parameters<typeof appendSideChatMessage>[2]): void => appendSideChatMessage(session.id, chatId, message)
      : (message: Parameters<typeof appendSideQuestion>[1]): void => appendSideQuestion(session.id, message)
    append({ id: userId, role: 'user', content: trimmed, status: 'complete' })
    append({ id: answerId, role: 'assistant', content: 'Thinking...', status: 'pending' })
    try {
      const result = await window.api.sessions.answerSideQuestion(session.id, trimmed)
      const patch = {
        content: result.ok ? result.answer : (result.error ?? 'Side question failed.'),
        status: result.ok ? 'complete' : 'error',
        usage: result.usage
      } as const
      if (chatId) updateSideChatMessage(session.id, chatId, answerId, patch)
      else updateSideQuestion(session.id, answerId, patch)
    } catch (error) {
      const patch = {
        content: error instanceof Error ? error.message : 'Side question failed.',
        status: 'error'
      } as const
      if (chatId) updateSideChatMessage(session.id, chatId, answerId, patch)
      else updateSideQuestion(session.id, answerId, patch)
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
      style={{ color: 'var(--color-text)' }}
    >
      {chatId && (
        <div className="mb-2 flex shrink-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {sideChat?.title ?? 'Side chat'}
            </div>
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
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
        {messages.length === 0 ? (
          <div className="side-chat-empty" data-testid="side-chat-empty-state">
            No side chat yet.
          </div>
        ) : (
          messages.map((message) => (
            <InspectorCard
              key={message.id}
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
              {message.usage?.totalCostUsd !== undefined && (
                <div className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  ${message.usage.totalCostUsd.toFixed(4)}
                </div>
              )}
            </InspectorCard>
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
        <input
          data-testid={chatId ? 'side-chat-input' : 'side-question-input'}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask in side chat"
          disabled={pending}
          className="side-chat-input min-w-0 flex-1 text-sm outline-none"
        />
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
