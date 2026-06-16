import test from 'node:test'
import assert from 'node:assert/strict'
import type { RunEvent } from '../../types'
import { coalesceRunEvents } from '../runEventCoalescer'

test('run event coalescer merges adjacent assistant text deltas for the same stream', () => {
  const events: RunEvent[] = [
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'hel' },
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'lo' },
    { type: 'assistant.text.delta', streamId: 'message-1', content: '!' }
  ]

  const result = coalesceRunEvents(events)

  assert.equal(result.coalescedDeltas, 2)
  assert.deepEqual(result.events, [
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'hello!' }
  ])
})

test('run event coalescer keeps non-delta events as ordering boundaries', () => {
  const events: RunEvent[] = [
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'a' },
    { type: 'tool.started', id: 'tool-1', toolName: 'Read', toolInput: { file: 'a.ts' } },
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'b' }
  ]

  const result = coalesceRunEvents(events)

  assert.equal(result.coalescedDeltas, 0)
  assert.equal(result.events, events)
})

test('run event coalescer keeps replacement semantics for mixed replacement and append deltas', () => {
  const events: RunEvent[] = [
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'old' },
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'full', replace: true },
    { type: 'assistant.text.delta', streamId: 'message-1', content: ' text' }
  ]

  const result = coalesceRunEvents(events)

  assert.equal(result.coalescedDeltas, 2)
  assert.deepEqual(result.events, [
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'full text', replace: true }
  ])
})

test('run event coalescer does not merge different assistant streams', () => {
  const events: RunEvent[] = [
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'a' },
    { type: 'assistant.text.delta', streamId: 'message-2', content: 'b' },
    { type: 'assistant.text.delta', streamId: 'message-1', content: 'c' }
  ]

  const result = coalesceRunEvents(events)

  assert.equal(result.coalescedDeltas, 0)
  assert.equal(result.events, events)
})
