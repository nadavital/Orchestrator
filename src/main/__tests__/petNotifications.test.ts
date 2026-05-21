import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage, Session, SessionRunEventRecord } from '../../types'
import {
  buildPetNotification,
  isPetNotificationExpired,
  petStatusForSession,
} from '../../types/petNotifications'

function snapshot(patch: Partial<Session> & {
  messages?: ChatMessage[]
  events?: SessionRunEventRecord[]
  hasUnread?: boolean
  activitySeq?: number
  lastActivityAt?: number
} = {}) {
  return {
    id: patch.id ?? 'session-1',
    name: patch.name ?? 'Implement feature',
    provider: patch.provider ?? 'claude',
    status: patch.status ?? 'idle',
    messages: patch.messages ?? [],
    events: patch.events ?? [],
    hasUnread: patch.hasUnread ?? false,
    activitySeq: patch.activitySeq ?? 0,
    lastActivityAt: patch.lastActivityAt ?? 1_000,
  }
}

test('pet status maps rich session states to Codex-style notification states', () => {
  assert.equal(petStatusForSession({ status: 'waiting_for_permission', hasUnread: false }), 'waiting')
  assert.equal(petStatusForSession({ status: 'waiting_for_user', hasUnread: false }), 'waiting')
  assert.equal(petStatusForSession({ status: 'provider_error', hasUnread: false }), 'failed')
  assert.equal(petStatusForSession({ status: 'auth_error', hasUnread: false }), 'failed')
  assert.equal(petStatusForSession({ status: 'quota_error', hasUnread: false }), 'failed')
  assert.equal(petStatusForSession({ status: 'rate_limit_error', hasUnread: false }), 'failed')
  assert.equal(petStatusForSession({ status: 'reconnecting', hasUnread: false }), 'running')
  assert.equal(petStatusForSession({ status: 'idle', hasUnread: true }), 'review')
  assert.equal(petStatusForSession({ status: 'idle', hasUnread: false }), 'idle')
})

test('permission notifications expose a waiting card with explicit allow/deny action data', () => {
  const notification = buildPetNotification(snapshot({
    status: 'waiting_for_permission',
    events: [{
      id: 'event-1',
      timestamp: 5_000,
      event: {
        type: 'permission.requested',
        denials: [{
          tool_name: 'Edit',
          tool_use_id: 'tool-1',
          tool_input: { file_path: '/tmp/example.ts' }
        }]
      }
    }]
  }))

  assert.ok(notification)
  assert.equal(notification.status, 'waiting')
  assert.equal(notification.level, 'warning')
  assert.equal(notification.title, 'File Approval · Implement feature')
  assert.equal(notification.body, 'Permission: Edit /tmp/example.ts')
  assert.equal(notification.replyTarget, null)
  assert.equal(notification.waitingRequest?.kind, 'patch')
  assert.deepEqual(notification.waitingRequest?.toolNames, ['Edit'])
  assert.deepEqual(notification.waitingRequest?.actions.map((action) => action.label), ['Allow Once', 'Allow Session', 'Deny'])
  assert.equal(notification.canDismiss, true)
})

test('user input notifications can reply without pretending to resolve permissions', () => {
  const notification = buildPetNotification(snapshot({
    status: 'waiting_for_user',
    events: [{
      id: 'event-2',
      timestamp: 6_000,
      event: { type: 'user_input.requested', content: 'Which file should I update?' }
    }]
  }))

  assert.ok(notification)
  assert.equal(notification.status, 'waiting')
  assert.equal(notification.body, 'Which file should I update?')
  assert.deepEqual(notification.replyTarget, { conversationId: 'session-1' })
  assert.equal(notification.waitingRequest?.kind, 'question')
  assert.deepEqual(notification.waitingRequest?.actions.map((action) => action.kind), ['reply'])
})

test('running notifications prefer normalized tool activity over generic text', () => {
  const notification = buildPetNotification(snapshot({
    status: 'running',
    events: [{
      id: 'event-3',
      timestamp: 7_000,
      event: {
        type: 'tool.started',
        id: 'tool-1',
        toolName: 'Bash',
        toolInput: { command: 'npm test -- --runInBand' }
      }
    }]
  }))

  assert.ok(notification)
  assert.equal(notification.status, 'running')
  assert.equal(notification.isLoading, true)
  assert.equal(notification.body, 'Running $ npm test -- --runInBand')
  assert.equal(notification.canDismiss, false)
})

test('review notifications use unread assistant turns and keep stable dismiss keys', () => {
  const notification = buildPetNotification(snapshot({
    hasUnread: true,
    messages: [{
      id: 'msg-1',
      role: 'assistant',
      type: 'text',
      content: 'Done. I updated the provider picker.',
      timestamp: 8_000
    }]
  }))

  assert.ok(notification)
  assert.equal(notification.status, 'review')
  assert.equal(notification.body, 'Done. I updated the provider picker.')
  assert.equal(notification.dismissKey, 'session-1:msg-1')
})

test('notification expiry follows Codex-style status TTLs', () => {
  const notification = buildPetNotification(snapshot({
    status: 'running',
    lastActivityAt: 10_000,
    activitySeq: 4
  }))

  assert.ok(notification)
  assert.equal(isPetNotificationExpired(notification, 10_000 + 179_999), false)
  assert.equal(isPetNotificationExpired(notification, 10_000 + 180_001), true)
})
