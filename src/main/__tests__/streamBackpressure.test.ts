import test from 'node:test'
import assert from 'node:assert/strict'
import { InactiveSessionStreamBuffer, streamingBufferKey } from '../../types/streamBackpressure'

interface Message {
  id: string
  content: string
}

interface EventRecord {
  id: string
}

test('inactive session stream buffer coalesces streaming message updates per session and message', () => {
  const buffer = new InactiveSessionStreamBuffer<Message, EventRecord>()

  buffer.bufferStreamingUpsert('background-a', 'message-1', { id: 'message-1', content: 'first' })
  buffer.bufferStreamingUpsert('background-a', 'message-1', { id: 'message-1', content: 'latest' })
  buffer.bufferStreamingUpsert('background-b', 'message-2', { id: 'message-2', content: 'other' })

  assert.equal(buffer.streamingUpsertCount(), 2)
  assert.equal(buffer.streamingUpsertCount('background-a'), 1)

  const flushedA = buffer.flush('background-a')
  assert.deepEqual(flushedA.streamingUpserts, [
    { sessionId: 'background-a', message: { id: 'message-1', content: 'latest' } }
  ])
  assert.deepEqual(flushedA.events, [])
  assert.equal(buffer.streamingUpsertCount(), 1)

  const flushedB = buffer.flush('background-b')
  assert.deepEqual(flushedB.streamingUpserts, [
    { sessionId: 'background-b', message: { id: 'message-2', content: 'other' } }
  ])
})

test('inactive session stream buffer keeps event buffers scoped and bounded', () => {
  const buffer = new InactiveSessionStreamBuffer<Message, EventRecord>(3)

  buffer.bufferEvents('background-a', [{ id: 'a1' }, { id: 'a2' }])
  buffer.bufferEvents('background-a', [{ id: 'a3' }, { id: 'a4' }])
  buffer.bufferEvents('background-b', [{ id: 'b1' }])

  assert.equal(buffer.eventCount(), 4)
  assert.equal(buffer.eventCount('background-a'), 3)
  assert.equal(buffer.eventCount('background-b'), 1)

  assert.deepEqual(buffer.flush('background-a').events, [{ id: 'a2' }, { id: 'a3' }, { id: 'a4' }])
  assert.equal(buffer.eventCount('background-a'), 0)
  assert.equal(buffer.eventCount('background-b'), 1)
})

test('inactive session stream buffer supports targeted deletion clear and stable keys', () => {
  const buffer = new InactiveSessionStreamBuffer<Message, EventRecord>()

  assert.equal(streamingBufferKey('session-1', 'message-1'), 'session-1:message-1')

  buffer.bufferStreamingUpsert('session-1', 'message-1', { id: 'message-1', content: 'one' })
  buffer.bufferEvents('session-1', [{ id: 'event-1' }])
  buffer.deleteStreamingUpsert('session-1', 'message-1')

  assert.equal(buffer.streamingUpsertCount(), 0)
  assert.equal(buffer.eventCount(), 1)

  buffer.clear()
  assert.equal(buffer.streamingUpsertCount(), 0)
  assert.equal(buffer.eventCount(), 0)
  assert.deepEqual(buffer.flush(null), { streamingUpserts: [], events: [] })
})
