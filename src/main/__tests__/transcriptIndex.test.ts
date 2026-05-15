import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage } from '../../types'
import { searchTranscriptMessages, transcriptPageForMessages } from '../transcriptIndex'

function message(index: number, content = `message ${index}`): ChatMessage {
  return {
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    type: 'text',
    content,
    timestamp: 1000 + index
  }
}

test('transcript paging returns latest bounded page by default', () => {
  const messages = Array.from({ length: 125 }, (_, index) => message(index))
  const page = transcriptPageForMessages('session-1', messages, { limit: 40 })

  assert.equal(page.messages.length, 40)
  assert.equal(page.messages[0].id, 'm-85')
  assert.equal(page.messageCount, 125)
  assert.equal(page.hasMoreBefore, true)
  assert.equal(page.hasMoreAfter, false)
})

test('transcript paging can fetch before and around a cursor', () => {
  const messages = Array.from({ length: 20 }, (_, index) => message(index))

  const before = transcriptPageForMessages('session-1', messages, { beforeMessageId: 'm-10', limit: 4 })
  assert.deepEqual(before.messages.map((item) => item.id), ['m-6', 'm-7', 'm-8', 'm-9'])

  const around = transcriptPageForMessages('session-1', messages, { aroundMessageId: 'm-10', limit: 5 })
  assert.deepEqual(around.messages.map((item) => item.id), ['m-8', 'm-9', 'm-10', 'm-11', 'm-12'])
})

test('transcript search returns newest bounded matches with snippets', () => {
  const messages = [
    message(0, 'first apple match'),
    message(1, 'no match'),
    message(2, 'latest apple match')
  ]
  const results = searchTranscriptMessages('session-1', messages, 'apple', 1)

  assert.equal(results.length, 1)
  assert.equal(results[0].messageId, 'm-2')
  assert.match(results[0].snippet, /apple/)
})
