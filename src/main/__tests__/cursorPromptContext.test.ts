import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectTrailingUnansweredUserMessages,
  promptWithCursorSdkUnansweredContext
} from '../cursorPromptContext'
import type { ChatMessage, Session } from '../../types'

function text(id: string, role: 'user' | 'assistant' | 'system', content: string): ChatMessage {
  return {
    id,
    role,
    type: 'text',
    content,
    timestamp: Date.now()
  }
}

function session(messages: ChatMessage[], patch: Partial<Session> = {}): Pick<Session, 'provider' | 'runtime' | 'messages'> {
  return {
    provider: 'cursor',
    runtime: 'sdk',
    messages,
    ...patch
  }
}

test('cursor sdk context collects consecutive unanswered user messages', () => {
  const messages = [
    text('u1', 'user', 'first'),
    text('a1', 'assistant', 'answer'),
    text('u2', 'user', 'unanswered'),
    {
      id: 'err',
      role: 'system',
      type: 'result',
      content: 'run failed',
      subtype: 'error_during_execution',
      timestamp: Date.now()
    },
    text('u3', 'user', 'follow up')
  ] satisfies ChatMessage[]

  assert.deepEqual(collectTrailingUnansweredUserMessages(messages).map((message) => message.id), ['u2', 'u3'])
})

test('cursor sdk prompt wraps unanswered local context only for cursor sdk runs', () => {
  const messages = [
    text('u1', 'user', 'inspect the file'),
    text('u2', 'user', 'also explain why it failed')
  ]
  const prompt = promptWithCursorSdkUnansweredContext(session(messages), 'also explain why it failed')

  assert.match(prompt, /orchestrator_unanswered_user_messages/)
  assert.match(prompt, /inspect the file/)
  assert.match(prompt, /latest="true"/)
  assert.equal(promptWithCursorSdkUnansweredContext(session(messages, { runtime: 'headless' }), 'plain'), 'plain')
  assert.equal(promptWithCursorSdkUnansweredContext(session([messages[1]]), 'plain'), 'plain')
})
