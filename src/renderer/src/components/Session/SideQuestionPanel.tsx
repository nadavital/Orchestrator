import { useState } from 'react'
import type { Session } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { Button, InspectorCard } from '../shared/designSystem'

interface Props {
  session: Session
  embedded?: boolean
}

export default function SideQuestionPanel({ session, embedded }: Props): JSX.Element {
  const { uiState, appendSideQuestion, updateSideQuestion } = useSessionStore()
  const [question, setQuestion] = useState('')
  const messages = uiState[session.id]?.sideQuestions ?? []
  const pending = messages.some((message) => message.status === 'pending')

  const submit = async (): Promise<void> => {
    const trimmed = question.trim()
    if (!trimmed || pending) return
    setQuestion('')
    const userId = crypto.randomUUID()
    const answerId = crypto.randomUUID()
    appendSideQuestion(session.id, { id: userId, role: 'user', content: trimmed, status: 'complete' })
    appendSideQuestion(session.id, { id: answerId, role: 'assistant', content: 'Thinking...', status: 'pending' })
    try {
      const result = await window.api.sessions.answerSideQuestion(session.id, trimmed)
      updateSideQuestion(session.id, answerId, {
        content: result.ok ? result.answer : (result.error ?? 'Side question failed.'),
        status: result.ok ? 'complete' : 'error',
        usage: result.usage
      })
    } catch (error) {
      updateSideQuestion(session.id, answerId, {
        content: error instanceof Error ? error.message : 'Side question failed.',
        status: 'error'
      })
    }
  }

  return (
    <div
      className={embedded ? 'h-full min-h-0 flex flex-col p-4' : 'flex flex-col'}
      style={{ color: 'var(--color-text)' }}
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
        {messages.length === 0 ? (
          <InspectorCard className="p-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            No side questions yet.
          </InspectorCard>
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
              <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-muted)' }}>
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
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask a side question..."
          disabled={pending}
          className="min-w-0 flex-1 px-3 py-2 text-sm outline-none"
          style={{
            background: 'var(--control-bg)',
            color: 'var(--color-text)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)'
          }}
        />
        <Button
          type="submit"
          disabled={!question.trim() || pending}
          variant="primary"
        >
          Ask
        </Button>
      </form>
    </div>
  )
}
