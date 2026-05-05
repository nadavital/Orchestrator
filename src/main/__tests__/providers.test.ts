import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunEvent, RunRequest } from '../../types'
import { PROVIDER_DEFS } from '../../types'
import { getProviderRuntimeInfo, PROVIDERS } from '../providers'
import { eventsToMessages } from '../runEvents'

const ABSTRACT_CAPABILITY_KEYS = [
  'resume',
  'structuredOutput',
  'streamEvents',
  'interactivePermissions',
  'toolAllowlist',
  'workspaceSandbox',
  'fullAccess',
  'bypassAll'
]

function request(patch: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: 'hello',
    cwd: '/tmp/orchestrator-test',
    model: '',
    effort: 'normal',
    providerSessionId: null,
    executionPolicy: 'default',
    allowedTools: [],
    ...patch
  }
}

function readFixture(providerId: string, fixtureName: string): string[] {
  const fixturePath = join(
    process.cwd(),
    'src/main/__fixtures__/providers',
    providerId,
    fixtureName
  )

  return readFileSync(fixturePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseFixture(providerId: string, fixtureName: string): RunEvent[] {
  const provider = PROVIDERS[providerId]
  assert.ok(provider, `Missing provider adapter for ${providerId}`)
  return readFixture(providerId, fixtureName).flatMap((line) => provider.parseOutputLine(line))
}

function firstEvent<T extends RunEvent['type']>(
  events: RunEvent[],
  type: T
): Extract<RunEvent, { type: T }> {
  const event = events.find((candidate) => candidate.type === type)
  assert.ok(event, `Expected ${type} event`)
  return event as Extract<RunEvent, { type: T }>
}

test('every provider definition has an adapter and runtime info', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  for (const providerId of Object.keys(PROVIDER_DEFS)) {
    assert.ok(PROVIDERS[providerId], `Missing adapter for ${providerId}`)
    assert.ok(runtimeInfo[providerId], `Missing runtime info for ${providerId}`)
  }
})

test('runtime info exposes the same abstract capability matrix for every provider', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  for (const [providerId, runtime] of Object.entries(runtimeInfo)) {
    assert.deepEqual(
      runtime.abstractCapabilities.map((capability) => capability.key),
      ABSTRACT_CAPABILITY_KEYS,
      `${providerId} should expose the shared capability keys`
    )

    for (const capability of runtime.abstractCapabilities) {
      assert.equal(typeof capability.label, 'string')
      assert.equal(capability.source, 'adapter')
      assert.ok(['supported', 'partial', 'unsupported', 'forced'].includes(capability.support))
    }
  }
})

test('runtime info resolves every configured permission mode', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  for (const [providerId, providerDef] of Object.entries(PROVIDER_DEFS)) {
    const provider = PROVIDERS[providerId]
    assert.ok(provider, `Missing provider adapter for ${providerId}`)

    for (const mode of providerDef.permissionModes) {
      const resolved = runtimeInfo[providerId]?.policies[mode.id]
      assert.ok(resolved, `Missing ${providerId} policy ${mode.id}`)
      assert.deepEqual(resolved, provider.resolveExecutionPolicy(mode.id))
    }
  }
})

test('claude default permission mode asks instead of auto-accepting edits', () => {
  const command = PROVIDERS.claude.buildStartCommand(request())
  const permissionIndex = command.args.indexOf('--permission-mode')

  assert.notEqual(permissionIndex, -1)
  assert.equal(command.args[permissionIndex + 1], 'default')
  assert.equal(command.args.includes('acceptEdits'), false)
})

test('claude explicit acceptEdits remains opt-in', () => {
  const command = PROVIDERS.claude.buildStartCommand(
    request({ executionPolicy: 'acceptEdits' })
  )
  const permissionIndex = command.args.indexOf('--permission-mode')

  assert.equal(command.args[permissionIndex + 1], 'acceptEdits')
})

test('claude resume includes captured session id and granted tools', () => {
  const command = PROVIDERS.claude.buildResumeCommand(
    request({
      prompt: 'continue',
      providerSessionId: 'claude-session-123',
      allowedTools: ['Read', 'Edit']
    })
  )

  assert.equal(command.args.includes('--resume'), true)
  assert.equal(command.args[command.args.indexOf('--resume') + 1], 'claude-session-123')
  assert.equal(command.args.includes('--allowedTools'), true)
  assert.equal(command.args[command.args.indexOf('--allowedTools') + 1], 'Read,Edit')
})

test('claude fixture normalizes session, tool, and permission events', () => {
  const events = parseFixture('claude', 'permission-denied.jsonl')
  const messages = eventsToMessages(events)
  const started = firstEvent(events, 'session.started')
  const assistant = firstEvent(events, 'assistant.text')
  const tool = firstEvent(events, 'tool.started')
  const permission = firstEvent(events, 'permission.requested')

  assert.equal(started.providerSessionId, 'claude-session-123')
  assert.equal(assistant.content, 'I will edit the file.')
  assert.equal(tool.toolName, 'Edit')
  assert.equal(tool.toolInput.file_path, '/tmp/example.ts')
  assert.equal(permission.denials[0]?.tool_name, 'Edit')

  const resultMessage = messages.find((message) => message.type === 'result')
  assert.ok(resultMessage)
  if (resultMessage.type === 'result') {
    assert.equal(resultMessage.permissionDenials?.[0]?.tool_input.file_path, '/tmp/example.ts')
  }
})

test('copilot exposes forced all-tools policy for programmatic mode', () => {
  const resolved = PROVIDERS.copilot.resolveExecutionPolicy('default')
  const command = PROVIDERS.copilot.buildStartCommand(request({ model: 'gpt-5.5' }))

  assert.equal(resolved.support, 'forced')
  assert.equal(command.args.includes('--allow-all-tools'), true)
  assert.equal(command.args.includes('--output-format'), true)
  assert.equal(command.args[command.args.indexOf('--output-format') + 1], 'json')
})

test('copilot fixture normalizes assistant, tool, session, and completion events', () => {
  const events = parseFixture('copilot', 'tool-flow.jsonl')
  const assistant = firstEvent(events, 'assistant.text')
  const started = firstEvent(events, 'tool.started')
  const completed = firstEvent(events, 'tool.completed')
  const session = firstEvent(events, 'session.started')

  assert.equal(assistant.content, 'I will inspect the repo.')
  assert.equal(started.toolName, 'shell')
  assert.equal(started.toolInput.command, 'ls')
  assert.equal(completed.toolUseId, 'tool-1')
  assert.equal(completed.content, 'README.md\nsrc')
  assert.equal(session.providerSessionId, 'copilot-session-123')
  assert.ok(events.some((event) => event.type === 'run.completed'))
})

test('codex permission modes map to sandbox arguments', () => {
  const workspaceCommand = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'default' })
  )
  assert.equal(workspaceCommand.args.includes('--sandbox'), true)
  assert.equal(workspaceCommand.args[workspaceCommand.args.indexOf('--sandbox') + 1], 'workspace-write')

  const fullAccessCommand = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'fullAccess' })
  )
  assert.equal(fullAccessCommand.args[fullAccessCommand.args.indexOf('--sandbox') + 1], 'danger-full-access')

  const yoloCommand = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'yolo' })
  )
  assert.equal(yoloCommand.args.includes('--dangerously-bypass-approvals-and-sandbox'), true)
})

test('unsupported execution policies fall back to provider defaults when launching', () => {
  const resolved = PROVIDERS.codex.resolveExecutionPolicy('allowEdits')
  const command = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'allowEdits' })
  )

  assert.equal(resolved.support, 'unsupported')
  assert.equal(command.args[command.args.indexOf('--sandbox') + 1], 'workspace-write')
})

test('codex resume preserves model, effort, sandbox, and session id', () => {
  const command = PROVIDERS.codex.buildResumeCommand(request({
    prompt: 'continue',
    model: 'gpt-5.5',
    effort: 'high',
    providerSessionId: 'codex-thread-123',
    executionPolicy: 'fullAccess'
  }))

  assert.deepEqual(command.args.slice(0, 3), ['exec', 'resume', '--json'])
  assert.equal(command.args.includes('codex-thread-123'), true)
  assert.equal(command.args[command.args.indexOf('--model') + 1], 'gpt-5.5')
  assert.equal(command.args[command.args.indexOf('--sandbox') + 1], 'danger-full-access')
  assert.equal(command.args.includes('model_reasoning_effort="high"'), true)
})

test('codex fixture normalizes thread, assistant, command, and completion events', () => {
  const events = parseFixture('codex', 'tool-flow.jsonl')
  const session = firstEvent(events, 'session.started')
  const assistant = firstEvent(events, 'assistant.text')
  const started = firstEvent(events, 'tool.started')
  const completed = firstEvent(events, 'tool.completed')

  assert.equal(session.providerSessionId, 'codex-thread-123')
  assert.equal(assistant.content, 'I will inspect the repo.')
  assert.equal(started.toolName, 'shell')
  assert.equal(started.toolInput.command, 'bash -lc ls')
  assert.equal(completed.toolUseId, 'item-1')
  assert.equal(completed.content, 'README.md\nsrc')
  assert.ok(events.some((event) => event.type === 'run.completed'))
})

test('cursor fixture normalizes anthropic-style and cursor tool-call events', () => {
  const events = parseFixture('cursor', 'tool-flow.jsonl')
  const session = firstEvent(events, 'session.started')
  const assistant = firstEvent(events, 'assistant.text')
  const started = firstEvent(events, 'tool.started')
  const completed = firstEvent(events, 'tool.completed')

  assert.equal(session.providerSessionId, 'cursor-session-123')
  assert.equal(assistant.content, 'I will read the README.')
  assert.equal(started.toolName, 'read')
  assert.equal(started.toolInput.path, 'README.md')
  assert.equal(completed.toolUseId, 'tool-1')
  assert.equal(completed.content, 'README contents')
})

test('cursor default policy is marked as forced because print mode is force/trust', () => {
  const resolved = PROVIDERS.cursor.resolveExecutionPolicy('default')
  const command = PROVIDERS.cursor.buildStartCommand(request({ model: 'auto' }))

  assert.equal(resolved.support, 'forced')
  assert.equal(command.args.includes('--print'), true)
  assert.equal(command.args.includes('--force'), true)
  assert.equal(command.args.includes('--trust'), true)
})
