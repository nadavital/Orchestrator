import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunEvent, RunRequest } from '../../types'
import { PROVIDER_DEFS } from '../../types'
import { getProviderDiagnostics, getProviderRuntimeInfo, PROVIDERS, resolveProviderBinary } from '../providers'
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

function eventTypes(events: RunEvent[]): RunEvent['type'][] {
  return events.map((event) => event.type)
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

test('provider diagnostics expose local readiness without claiming unavailable usage', () => {
  const diagnostics = getProviderDiagnostics()

  for (const providerId of Object.keys(PROVIDER_DEFS)) {
    const diagnostic = diagnostics[providerId]
    assert.ok(diagnostic, `Missing diagnostics for ${providerId}`)
    assert.equal(diagnostic.id, providerId)
    assert.ok(['found', 'missing'].includes(diagnostic.binary.status))
    assert.ok(['ok', 'error', 'unknown'].includes(diagnostic.version.status))
    assert.ok(['ok', 'error', 'unknown'].includes(diagnostic.auth.status))
    assert.ok(['configured', 'available', 'empty', 'unknown'].includes(diagnostic.models.status))
    assert.equal(diagnostic.usage.status, 'unavailable')
    assert.equal(diagnostic.liveSmoke.status, 'not-run')
  }
})

test('provider binary detection searches common desktop CLI locations beyond inherited PATH', () => {
  const originalPath = process.env.PATH
  const originalHome = process.env.HOME
  const tmpRoot = join(tmpdir(), `orchestrator-provider-path-${Date.now()}`)
  const binDir = join(tmpRoot, '.local/bin')
  mkdirSync(binDir, { recursive: true })
  const fakeClaude = join(binDir, 'claude')
  writeFileSync(fakeClaude, '#!/bin/sh\necho fake claude\n')
  chmodSync(fakeClaude, 0o755)

  try {
    process.env.HOME = tmpRoot
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
    assert.equal(resolveProviderBinary(PROVIDERS.claude), fakeClaude)
  } finally {
    process.env.PATH = originalPath
    process.env.HOME = originalHome
    rmSync(tmpRoot, { recursive: true, force: true })
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

test('resolved permission policies expose GUI metadata for adaptive controls', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  assert.equal(runtimeInfo.claude.policies.default.intent, 'ask')
  assert.equal(runtimeInfo.claude.policies.default.interaction, 'structured')
  assert.ok(runtimeInfo.claude.policies.default.controls?.some((control) => control.kind === 'tool'))

  assert.equal(runtimeInfo.copilot.policies.default.intent, 'ask')
  assert.equal(runtimeInfo.copilot.policies.default.interaction, 'headless')
  assert.ok(runtimeInfo.copilot.policies.default.controls?.some((control) => control.kind === 'url'))
  assert.ok(runtimeInfo.copilot.policies.default.controls?.some((control) => control.kind === 'path'))

  assert.equal(runtimeInfo.codex.policies.default.intent, 'workspaceSandbox')
  assert.ok(runtimeInfo.codex.policies.default.controls?.some((control) => control.kind === 'sandbox'))
  assert.ok(runtimeInfo.codex.policies.default.controls?.some((control) => control.support === 'planned'))

  assert.equal(runtimeInfo.cursor.policies.sandbox.intent, 'workspaceSandbox')
  assert.ok(runtimeInfo.cursor.policies.sandbox.controls?.some((control) => control.kind === 'config'))
})

test('runtime info distinguishes interactive permission support from forced unattended modes', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  assert.equal(
    runtimeInfo.claude.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'supported'
  )
  assert.equal(
    runtimeInfo.codex.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'unsupported',
    'Codex exec does not expose an interactive approval prompt surface'
  )
  assert.equal(
    runtimeInfo.cursor.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'forced'
  )
  assert.equal(
    runtimeInfo.copilot.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'forced'
  )
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

test('claude bypass permissions uses the explicit permission mode, not granted tools', () => {
  const command = PROVIDERS.claude.buildStartCommand(
    request({ executionPolicy: 'bypassPermissions', allowedTools: [] })
  )
  const permissionIndex = command.args.indexOf('--permission-mode')

  assert.equal(command.args[permissionIndex + 1], 'bypassPermissions')
  assert.equal(command.args.includes('--allowedTools'), false)
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
  assert.equal(events.some((event) => event.type === 'run.failed'), false)

  const resultMessage = messages.find((message) => message.type === 'result')
  assert.ok(resultMessage)
  if (resultMessage.type === 'result') {
    assert.equal(resultMessage.subtype, 'error_during_execution')
    assert.equal(resultMessage.content, 'Permission denied')
    assert.equal(resultMessage.permissionDenials?.[0]?.tool_input.file_path, '/tmp/example.ts')
  }
})

test('claude AskUserQuestion tool result becomes a structured user-input request', () => {
  const events = parseFixture('claude', 'ask-user-question.jsonl')
  const messages = eventsToMessages(events)
  const userInput = firstEvent(events, 'user_input.requested')

  assert.equal(userInput.content, 'What should the branch name be?')
  assert.equal(userInput.questions?.[0]?.header, 'Branch name')
  assert.equal(userInput.questions?.[0]?.options?.[0]?.label, 'navital/cbcc-cobranded-card-detection')
  assert.equal(events.some((event) => event.type === 'tool.completed'), false)

  const resultMessage = messages.find((message) => message.type === 'result')
  assert.ok(resultMessage)
  if (resultMessage.type === 'result') {
    assert.equal(resultMessage.subtype, 'waiting_for_user')
    assert.equal(resultMessage.userInputQuestions?.[0]?.options?.length, 3)
  }
})

test('provider fixtures expose expected normalized event contracts', () => {
  const cases: Array<{
    providerId: string
    fixture: string
    types: RunEvent['type'][]
  }> = [
    {
      providerId: 'claude',
      fixture: 'plain-answer.jsonl',
      types: ['session.started', 'assistant.text', 'run.completed']
    },
    {
      providerId: 'claude',
      fixture: 'permission-denied.jsonl',
      types: ['session.started', 'assistant.text', 'tool.started', 'permission.requested']
    },
    {
      providerId: 'claude',
      fixture: 'ask-user-question.jsonl',
      types: ['session.started', 'assistant.text', 'tool.started', 'user_input.requested']
    },
    {
      providerId: 'copilot',
      fixture: 'plain-answer.jsonl',
      types: ['assistant.text', 'session.started', 'run.completed']
    },
    {
      providerId: 'copilot',
      fixture: 'tool-flow.jsonl',
      types: ['assistant.text', 'tool.started', 'tool.completed', 'session.started', 'run.completed']
    },
    {
      providerId: 'copilot',
      fixture: 'auth-error.jsonl',
      types: ['session.started', 'run.failed']
    },
    {
      providerId: 'codex',
      fixture: 'plain-answer.jsonl',
      types: ['session.started', 'assistant.text', 'run.completed']
    },
    {
      providerId: 'codex',
      fixture: 'tool-flow.jsonl',
      types: ['session.started', 'assistant.text', 'tool.started', 'tool.completed', 'run.completed']
    },
    {
      providerId: 'codex',
      fixture: 'error.jsonl',
      types: ['session.started', 'run.failed']
    },
    {
      providerId: 'cursor',
      fixture: 'plain-answer.jsonl',
      types: ['session.started', 'assistant.text', 'run.completed']
    },
    {
      providerId: 'cursor',
      fixture: 'tool-flow.jsonl',
      types: ['session.started', 'assistant.text', 'tool.started', 'tool.completed']
    },
    {
      providerId: 'cursor',
      fixture: 'reconnecting.jsonl',
      types: ['session.started', 'connection.retrying', 'connection.reconnecting']
    },
    {
      providerId: 'cursor',
      fixture: 'auth-error.jsonl',
      types: ['run.failed']
    }
  ]

  for (const { providerId, fixture, types } of cases) {
    assert.deepEqual(eventTypes(parseFixture(providerId, fixture)), types, `${providerId}/${fixture}`)
  }
})

test('cursor reconnecting fixture preserves retry attempts', () => {
  const events = parseFixture('cursor', 'reconnecting.jsonl')
  const retry = firstEvent(events, 'connection.retrying')
  const reconnecting = firstEvent(events, 'connection.reconnecting')

  assert.equal(retry.attempt, 2)
  assert.equal(reconnecting.attempt, 3)
  assert.match(reconnecting.content ?? '', /attempt 3/)
})

test('provider failure fixtures preserve useful error text', () => {
  const copilotFailure = firstEvent(parseFixture('copilot', 'auth-error.jsonl'), 'run.failed')
  const codexFailure = firstEvent(parseFixture('codex', 'error.jsonl'), 'run.failed')
  const cursorFailure = firstEvent(parseFixture('cursor', 'auth-error.jsonl'), 'run.failed')

  assert.match(copilotFailure.content ?? '', /authentication required/)
  assert.match(codexFailure.content ?? '', /model unavailable/)
  assert.match(cursorFailure.content ?? '', /Authentication required/)
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

test('codex exec policy does not claim interactive approval prompting', () => {
  const resolved = PROVIDERS.codex.resolveExecutionPolicy('default')
  const command = PROVIDERS.codex.buildStartCommand(request({ executionPolicy: 'default' }))

  assert.equal(resolved.support, 'exact')
  assert.match(resolved.warning ?? '', /does not expose interactive approval prompts/)
  assert.equal(command.args.includes('--ask-for-approval'), false)
  assert.equal(PROVIDERS.codex.capabilities.interactivePermissions, false)
  assert.equal(PROVIDERS.codex.binaryCandidates?.includes('/Applications/Codex.app/Contents/Resources/codex'), true)
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

test('cursor default policy uses read-only ask mode', () => {
  const resolved = PROVIDERS.cursor.resolveExecutionPolicy('default')
  const command = PROVIDERS.cursor.buildStartCommand(request({ model: 'auto' }))

  assert.equal(resolved.support, 'exact')
  assert.equal(resolved.intent, 'ask')
  assert.equal(command.args.includes('--print'), true)
  assert.equal(command.args[command.args.indexOf('--mode') + 1], 'ask')
  assert.equal(command.args.includes('--force'), false)
  assert.equal(command.args.includes('--trust'), true)
  assert.equal(command.args[command.args.indexOf('--workspace') + 1], '/tmp/orchestrator-test')
})

test('cursor sandbox policy requests sandbox without forced all-tools mode', () => {
  const resolved = PROVIDERS.cursor.resolveExecutionPolicy('sandbox')
  const command = PROVIDERS.cursor.buildStartCommand(request({ model: 'auto', executionPolicy: 'sandbox' }))

  assert.equal(resolved.support, 'exact')
  assert.deepEqual(command.args.slice(0, 3), ['--print', '--output-format', 'stream-json'])
  assert.equal(command.args.includes('--force'), false)
  assert.equal(command.args.includes('--trust'), true)
  assert.equal(command.args[command.args.indexOf('--sandbox') + 1], 'enabled')
})
