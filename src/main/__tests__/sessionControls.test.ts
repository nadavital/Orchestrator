import test from 'node:test'
import assert from 'node:assert/strict'
import { getComposerSendState } from '../../types'

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
