import test from 'node:test'
import assert from 'node:assert/strict'
import { canStopSession, finalizeInterruptedMessages, getComposerSendState, type ChatMessage } from '../../types'

test('composer queues a message while a session is running', () => {
  assert.deepEqual(
    getComposerSendState({
      text: 'Use the config file I just found.',
      status: 'running',
      canUsePermission: true
    }),
    { canSend: true, willQueue: true }
  )
})

test('composer does not send empty or unsupported-policy messages', () => {
  assert.deepEqual(
    getComposerSendState({ text: '   ', status: 'running', canUsePermission: true }),
    { canSend: false, willQueue: false }
  )
  assert.deepEqual(
    getComposerSendState({ text: 'hello', status: 'idle', canUsePermission: false }),
    { canSend: false, willQueue: false }
  )
})

test('composer normal send does not mark idle sessions as queued', () => {
  assert.deepEqual(
    getComposerSendState({ text: 'hello', status: 'idle', canUsePermission: true }),
    { canSend: true, willQueue: false }
  )
})

test('interrupted runs settle streaming and queued text messages', () => {
  const messages: ChatMessage[] = [
    {
      id: 'assistant-stream',
      role: 'assistant',
      type: 'text',
      content: 'partial',
      timestamp: 1,
      isStreaming: true
    },
    {
      id: 'queued-user',
      role: 'user',
      type: 'text',
      content: 'follow up',
      timestamp: 2,
      queueState: 'queued'
    }
  ]

  assert.deepEqual(finalizeInterruptedMessages(messages), [
    {
      id: 'assistant-stream',
      role: 'assistant',
      type: 'text',
      content: 'partial',
      timestamp: 1,
      isStreaming: false,
      queueState: undefined
    },
    {
      id: 'queued-user',
      role: 'user',
      type: 'text',
      content: 'follow up',
      timestamp: 2,
      isStreaming: false,
      queueState: undefined
    }
  ])
})

test('stop control is available for active and paused runs', () => {
  assert.equal(canStopSession('running'), true)
  assert.equal(canStopSession('waiting_for_permission'), true)
  assert.equal(canStopSession('waiting_for_user'), true)
  assert.equal(canStopSession('idle'), false)
  assert.equal(canStopSession('error'), false)
})
