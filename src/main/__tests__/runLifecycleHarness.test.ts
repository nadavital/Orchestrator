import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatMessage, ProviderRuntimeKind, RunEvent, SessionStatus } from '../../types'
import { PROVIDERS } from '../providers'
import { eventsToMessages } from '../runEvents'
import { classifyFailure, decideRunLifecycle, eventsForLifecycleDecision, type RunLifecycleSession } from '../runLifecycle'

interface HarnessResult {
  state: RunLifecycleSession & {
    providerSessionId: string | null
    claudeSessionId: string | null
  }
  events: RunEvent[]
  messages: ChatMessage[]
  interruptedProcess: boolean
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
  let interruptedProcess = false

  for (const line of lines) {
    const parsed = provider.parseOutputLine(line)
    events.push(...parsed)

    const decision = decideRunLifecycle(state, parsed)
    if (decision.providerSessionId) {
      state.providerSessionId = decision.providerSessionId
      state.claudeSessionId = decision.claudeSessionId ?? decision.providerSessionId
    }
    if (decision.shouldInterruptProcess) interruptedProcess = true
    if (decision.status) state.status = decision.status

    messages.push(...decision.systemMessages)
    messages.push(...eventsToMessages(parsed))
  }

  return { state, events, messages, interruptedProcess }
}

function hasEvent(events: RunEvent[], type: RunEvent['type']): boolean {
  return events.some((event) => event.type === type)
}

test('harness proves fast Claude structured JSON reaches assistant text and idle', () => {
  const result = runLifecycleHarness('claude', [
    '{"type":"permission-mode","permissionMode":"default","sessionId":"claude-fast-session"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"orchestrator smoke ok"}]}}',
    '{"type":"system","subtype":"turn_duration","durationMs":2910,"messageCount":3}'
  ], { runtime: 'headless' })

  assert.equal(result.state.providerSessionId, 'claude-fast-session')
  assert.equal(result.state.status, 'idle')
  assert.equal(result.interruptedProcess, true)
  assert.equal(hasEvent(result.events, 'assistant.text'), true)
  assert.equal(hasEvent(result.events, 'run.completed'), true)
  assert.ok(result.messages.some((message) => message.type === 'text' && message.content === 'orchestrator smoke ok'))
  assert.ok(result.messages.some((message) => message.type === 'result' && message.subtype === 'success'))
})

test('harness pauses structured Claude user questions and interrupts the completed subprocess', () => {
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

  const headless = runLifecycleHarness('claude', lines, { runtime: 'headless' })

  assert.equal(headless.state.status, 'waiting_for_user')
  assert.equal(headless.interruptedProcess, true)
  assert.ok(headless.messages.some((message) => message.type === 'result' && message.subtype === 'waiting_for_user'))
})

test('lifecycle keeps generic interactive user questions alive', () => {
  const state: RunLifecycleSession = {
    id: 'session-under-test',
    provider: 'cursor',
    runtime: 'interactive',
    status: 'running'
  }
  const decision = decideRunLifecycle(state, [{ type: 'user_input.requested', content: 'Which branch?' }])

  assert.equal(decision.status, 'waiting_for_user')
  assert.equal(decision.shouldInterruptProcess, false)
})

test('harness maps permission requests to waiting_for_permission without interrupting the interactive process', () => {
  const result = runLifecycleHarness('codex', readFixture('codex', 'permission-request.jsonl'))

  assert.equal(result.state.status, 'waiting_for_permission')
  assert.equal(result.interruptedProcess, false)
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
  assert.equal(auth.interruptedProcess, true)
  assert.equal(model.state.status, 'model_error')
  assert.equal(model.interruptedProcess, true)
})

test('failure classifier distinguishes quota and rate-limit failures', () => {
  assert.equal(classifyFailure('quota exceeded for this account'), 'quota_error')
  assert.equal(classifyFailure('rate limit exceeded: too many requests'), 'rate_limit_error')
})

test('harness stops repeated Cursor reconnect loops with a user-visible message', () => {
  const result = runLifecycleHarness('cursor', readFixture('cursor', 'reconnecting.jsonl'))

  assert.equal(result.state.status, 'provider_error')
  assert.equal(result.interruptedProcess, true)
  assert.ok(result.messages.some((message) =>
    message.type === 'result' &&
    /reconnecting repeatedly/i.test(message.content)
  ))
})

test('steered follow-up suppresses expected interrupt failure events', () => {
  const state: RunLifecycleSession = {
    id: 'session-under-test',
    provider: 'claude',
    runtime: 'headless',
    status: 'running'
  }
  const interrupted: RunEvent[] = [{ type: 'run.failed', content: 'Interrupted by user' }]
  const lifecycleEvents = eventsForLifecycleDecision(interrupted, { suppressFailure: true })
  const decision = decideRunLifecycle(state, lifecycleEvents)

  assert.equal(lifecycleEvents.length, 0)
  assert.equal(decision.status, undefined)
  assert.equal(decision.shouldInterruptProcess, false)
  assert.equal(eventsToMessages(lifecycleEvents).some((message) => message.type === 'result' && message.subtype === 'error_during_execution'), false)
})
