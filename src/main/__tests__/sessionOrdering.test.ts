import test from 'node:test'
import assert from 'node:assert/strict'
import { comparePinnedSessions, ensurePinnedSessionOrders, nextPinOrder } from '../../types'
import type { PinOrderedSession } from '../../types'

test('pin order migration preserves the previous visible recency order once', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'older', pinned: true, createdAt: 10, latestMessageAt: 100 },
    { id: 'recent', pinned: true, createdAt: 20, latestMessageAt: 500 },
    { id: 'newest-unpinned', pinned: false, createdAt: 30, latestMessageAt: 1000 }
  ]

  ensurePinnedSessionOrders(sessions)

  assert.equal(sessions.find((session) => session.id === 'recent')?.pinOrder, 1)
  assert.equal(sessions.find((session) => session.id === 'older')?.pinOrder, 2)
  assert.equal(sessions.find((session) => session.id === 'newest-unpinned')?.pinOrder, undefined)
})

test('newly pinned sessions append after existing pinned sessions', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'second', pinned: true, pinOrder: 2, createdAt: 20, latestMessageAt: 20 },
    { id: 'candidate', pinned: false, createdAt: 30, latestMessageAt: 3000 }
  ]

  const candidate = sessions.find((session) => session.id === 'candidate')
  assert.ok(candidate)
  candidate.pinned = true
  candidate.pinOrder = nextPinOrder(sessions)

  assert.deepEqual(
    sessions.filter((session) => session.pinned).sort(comparePinnedSessions).map((session) => session.id),
    ['first', 'second', 'candidate']
  )
})

test('message recency does not reorder pinned sessions after pinOrder exists', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'second', pinned: true, pinOrder: 2, createdAt: 20, latestMessageAt: 2000 }
  ]

  sessions[0].latestMessageAt = 9000

  assert.deepEqual(
    [...sessions].sort(comparePinnedSessions).map((session) => session.id),
    ['first', 'second']
  )
})

test('unpinning clears pin order and excludes the session from pinned sort', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'removed', pinned: true, pinOrder: 2, createdAt: 20, latestMessageAt: 20 }
  ]

  const removed = sessions.find((session) => session.id === 'removed')
  assert.ok(removed)
  removed.pinned = false
  removed.pinOrder = undefined

  assert.deepEqual(
    sessions.filter((session) => session.pinned).sort(comparePinnedSessions).map((session) => session.id),
    ['first']
  )
  assert.equal(removed.pinOrder, undefined)
})
