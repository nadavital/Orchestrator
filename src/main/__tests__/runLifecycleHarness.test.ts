import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, ProviderRuntimeKind, RunEvent, SessionStatus } from '../../types'
import { PROVIDERS } from '../providers'
import { eventsToMessages } from '../runEvents'
import { decideRunLifecycle, type RunLifecycleSession } from '../runLifecycle'

interface HarnessResult {
  state: RunLifecycleSession & {
    providerSessionId: string | null
    claudeSessionId: string | null
  }
  events: RunEvent[]
  messages: ChatMessage[]
  killedPty: boolean
}

function readFixture(providerId: string, fixtureName: string): string[] {
  return readFileSync(
    join(process.cwd(), 'src/main/__fixtures__/providers', providerId, fixtureName),
    'utf8'
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function runLifecycleHarness(
  providerId: string,
  lines: string[],
  options: {
    runtime?: ProviderRuntimeKind
    initialStatus?: SessionStatus
  } = {}
): HarnessResult {
  const provider = PROVIDERS[providerId]
  assert.ok(provider, `Missing provider ${providerId}`)

  const state: HarnessResult['state'] = {
    id: 'session-under-test',
    provider: providerId,
    runtime: options.runtime ?? 'headless',
    status: options.initialStatus ?? 'running',
    providerSessionId: null,
    claudeSessionId: null
  }
  const events: RunEvent[] = []
  const messages: ChatMessage[] = []
  let killedPty = false

  for (const line of lines) {
    const parsed = provider.parseOutputLine(line)
    events.push(...parsed)

    const decision = decideRunLifecycle(state, parsed)
    if (decision.providerSessionId) {
      state.providerSessionId = decision.providerSessionId
      state.claudeSessionId = decision.claudeSessionId ?? decision.providerSessionId
    }
    if (decision.shouldKillPty) killedPty = true
    if (decision.status) state.status = decision.status

    messages.push(...decision.systemMessages)
    messages.push(...eventsToMessages(parsed))
  }

  return { state, events, messages, killedPty }
}

function hasEvent(events: RunEvent[], type: RunEvent['type']): boolean {
  return events.some((event) => event.type === type)
}

test('harness proves fast Claude interactive JSONL reaches assistant text and idle', () => {
  const result = runLifecycleHarness('claude', [
    '{"type":"permission-mode","permissionMode":"default","sessionId":"claude-fast-session"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"orchestrator smoke ok"}]}}',
    '{"type":"system","subtype":"turn_duration","durationMs":2910,"messageCount":3}'
  ], { runtime: 'interactive' })

  assert.equal(result.state.providerSessionId, 'claude-fast-session')
  assert.equal(result.state.status, 'idle')
  assert.equal(result.killedPty, false)
  assert.equal(hasEvent(result.events, 'assistant.text'), true)
  assert.equal(hasEvent(result.events, 'run.completed'), true)
  assert.ok(result.messages.some((message) => message.type === 'text' && message.content === 'orchestrator smoke ok'))
  assert.ok(result.messages.some((message) => message.type === 'result' && message.subtype === 'success'))
})

test('harness keeps interactive user questions alive but stops headless runs', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu-question',
          name: 'AskUserQuestion',
          input: { question: 'Which branch?', options: ['main', 'feature'] }
        }]
      }
    })
  ]

  const interactive = runLifecycleHarness('claude', lines, { runtime: 'interactive' })
  const headless = runLifecycleHarness('claude', lines, { runtime: 'headless' })

  assert.equal(interactive.state.status, 'waiting_for_user')
  assert.equal(interactive.killedPty, false)
  assert.equal(headless.state.status, 'waiting_for_user')
  assert.equal(headless.killedPty, true)
  assert.ok(interactive.messages.some((message) => message.type === 'result' && message.subtype === 'waiting_for_user'))
})

test('harness maps permission requests to waiting_for_permission without killing PTY', () => {
  const result = runLifecycleHarness('codex', readFixture('codex', 'permission-request.jsonl'))

  assert.equal(result.state.status, 'waiting_for_permission')
  assert.equal(result.killedPty, false)
  assert.equal(hasEvent(result.events, 'permission.requested'), true)
  assert.ok(result.messages.some((message) => message.type === 'result' && message.permissionDenials?.[0]?.tool_name === 'shell'))
})

test('harness classifies auth failures and model failures from provider output', () => {
  const auth = runLifecycleHarness('claude', [
    '\u001B[0m\u001B[31mapiKeyHelper failed: exited 127: /bin/sh: npx: command not found\u001B[0m'
  ])
  const model = runLifecycleHarness('claude', [
    '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"model unavailable: claude-haiku"}'
  ])

  assert.equal(auth.state.status, 'auth_error')
  assert.equal(auth.killedPty, true)
  assert.equal(model.state.status, 'model_error')
  assert.equal(model.killedPty, true)
})

test('harness stops repeated Cursor reconnect loops with a user-visible message', () => {
  const result = runLifecycleHarness('cursor', readFixture('cursor', 'reconnecting.jsonl'))

  assert.equal(result.state.status, 'provider_error')
  assert.equal(result.killedPty, true)
  assert.ok(result.messages.some((message) =>
    message.type === 'result' &&
    /reconnecting repeatedly/i.test(message.content)
  ))
})
