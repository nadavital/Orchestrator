import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChatMessage } from '../../types'
import { buildTranscriptTurnGroups, transcriptTurnIdForMessage } from '../../types/transcriptView'

function user(id: string, content = `user ${id}`): ChatMessage {
  return { id, role: 'user', type: 'text', content, timestamp: Number(id.replace(/\D/g, '')) || 1 }
}

function assistant(id: string, content = `assistant ${id}`, isStreaming = false): ChatMessage {
  return { id, role: 'assistant', type: 'text', content, timestamp: Number(id.replace(/\D/g, '')) || 1, isStreaming }
}

function tool(id: string): ChatMessage {
  return { id, role: 'assistant', type: 'tool_use', toolName: 'Read', toolInput: { file_path: 'README.md' }, timestamp: Number(id.replace(/\D/g, '')) || 1 }
}

test('transcript turn groups collapse older completed turns but keep latest expanded', () => {
  const groups = buildTranscriptTurnGroups([
    user('u1', 'first request'),
    assistant('a1', 'first answer'),
    tool('t1'),
    user('u2', 'second request'),
    assistant('a2', 'second answer')
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0].isCollapsible, true)
  assert.equal(groups[0].summary.userPreview, 'first request')
  assert.equal(groups[0].summary.toolCount, 1)
  assert.equal(groups[1].isLatest, true)
  assert.equal(groups[1].isCollapsible, false)
})

test('transcript turn groups keep streaming and pending interaction turns expanded', () => {
  const groups = buildTranscriptTurnGroups([
    user('u1'),
    assistant('a1', 'still going', true),
    user('u2'),
    {
      id: 'permission',
      role: 'system',
      type: 'result',
      content: 'Need approval',
      subtype: 'permission',
      permissionDenials: [{ tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: {} }],
      timestamp: 3
    }
  ])

  assert.equal(groups[0].hasStreaming, true)
  assert.equal(groups[0].isCollapsible, false)
  assert.equal(groups[1].hasPendingInteraction, true)
  assert.equal(groups[1].isCollapsible, false)
})

test('transcript turn groups do not collapse provider preamble without a user message', () => {
  const groups = buildTranscriptTurnGroups([
    {
      id: 'notice',
      role: 'system',
      type: 'result',
      content: 'Session started',
      subtype: 'success',
      timestamp: 1
    },
    assistant('a1', 'context loaded'),
    user('u2'),
    assistant('a2')
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0].summary.userPreview, '')
  assert.equal(groups[0].isCollapsible, false)
})

test('transcript turn groups keep error and recovery turns expanded', () => {
  const groups = buildTranscriptTurnGroups([
    user('u1', 'fix this failure'),
    assistant('a1', 'attempting fix'),
    {
      id: 'failed',
      role: 'system',
      type: 'result',
      content: 'Run failed',
      subtype: 'error_during_execution',
      timestamp: 3
    },
    user('u2'),
    assistant('a2')
  ])

  assert.equal(groups[0].isCollapsible, false)
})

test('transcript turn groups prefer native provider turn ids when present', () => {
  const messages = [
    { ...user('u1'), providerTurnId: 'provider-turn-1' } as unknown as ChatMessage,
    assistant('a1'),
    user('u2'),
    assistant('a2')
  ]

  const groups = buildTranscriptTurnGroups(messages)

  assert.equal(groups[0].id, 'turn-provider-turn-1')
  assert.equal(transcriptTurnIdForMessage(messages, 'a1'), 'turn-provider-turn-1')
})

test('transcriptTurnIdForMessage returns the derived provider-agnostic turn id', () => {
  const messages = [user('u1'), assistant('a1'), user('u2'), assistant('a2')]

  assert.equal(transcriptTurnIdForMessage(messages, 'a1'), 'turn-u1')
  assert.equal(transcriptTurnIdForMessage(messages, 'u2'), 'turn-u2')
  assert.equal(transcriptTurnIdForMessage(messages, 'missing'), null)
})
