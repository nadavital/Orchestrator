import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunEvent, RunRequest } from '../../types'
import { PROVIDER_DEFS, deriveAgentNodes } from '../../types'
import { buildProviderCommandForRuntime, claudeMcpServerNames, getProviderDiagnostics, getProviderDiagnosticsAsync, getProviderRuntimeInfo, PROVIDERS, providerSpawnEnv, resolveProviderBinary, runProviderCommandSurface, runProviderCommandSurfaceAsync } from '../providers'
import { eventsToMessages } from '../runEvents'

const ABSTRACT_CAPABILITY_KEYS = [
  'resume',
  'interactiveCli',
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

function records(events: RunEvent[]) {
  return events.map((event, index) => ({
    id: `event-${index}`,
    timestamp: index,
    event
  }))
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

test('runtime info exposes provider-specific capability registry and no-quota probes', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  for (const providerId of Object.keys(PROVIDER_DEFS)) {
    const registry = runtimeInfo[providerId]?.registry
    assert.ok(registry, `Missing ${providerId} registry`)
    assert.equal(registry.providerId, providerId)
    assert.ok(registry.features.length > 0, `${providerId} should expose feature metadata`)
    assert.ok(registry.gaps.length > 0, `${providerId} should expose known coverage gaps`)
    assert.ok(registry.probes.length > 0, `${providerId} should expose probe metadata`)
    assert.ok(Array.isArray(registry.commandSurfaces), `${providerId} should expose command surface metadata`)
    assert.ok(Array.isArray(registry.slashCommands), `${providerId} should expose slash command metadata`)

    for (const probe of registry.probes) {
      assert.equal(probe.quota, 'none', `${providerId}/${probe.id} should not spend model quota`)
      assert.equal(probe.safeByDefault, true, `${providerId}/${probe.id} should be safe to run from settings`)
    }

    for (const command of registry.slashCommands) {
      assert.equal(command.providerId, providerId)
      assert.match(command.name, /^\//)
      assert.ok(['app-action', 'send-to-provider', 'insert-prompt', 'sdk-command'].includes(command.handler))
    }
  }

  assert.ok(runtimeInfo.claude.registry.features.some((feature) => feature.id === 'agents'))
  assert.ok(runtimeInfo.claude.registry.commandSurfaces.some((surface) => surface.id === 'agents-list' && surface.quota === 'none'))
  assert.ok(runtimeInfo.claude.registry.commandSurfaces.some((surface) => surface.id === 'mcp-details' && surface.command.join(' ') === 'mcp get'))
  assert.ok(runtimeInfo.claude.registry.commandSurfaces.some((surface) => surface.id === 'plugin-list' && surface.command.join(' ') === 'plugin list --json'))
  assert.ok(runtimeInfo.claude.registry.commandSurfaces.some((surface) => surface.id === 'ultrareview-json' && surface.quota === 'may-use-quota'))
  assert.ok(runtimeInfo.codex.registry.features.some((feature) => feature.id === 'multi-agent'))
  assert.ok(runtimeInfo.copilot.registry.features.some((feature) => feature.id === 'subagents'))
  assert.ok(runtimeInfo.cursor.registry.features.some((feature) => feature.id === 'worktrees'))
  assert.ok(runtimeInfo.claude.registry.gaps.some((gap) => gap.id === 'claude-rich-permission-controls' && gap.status === 'partial'))
  assert.ok(runtimeInfo.claude.registry.gaps.some((gap) => gap.id === 'claude-cli-management' && gap.status === 'partial'))
  assert.ok(runtimeInfo.claude.registry.gaps.some((gap) => gap.id === 'claude-worktree-launch' && gap.status === 'partial'))
  assert.ok(runtimeInfo.codex.registry.gaps.some((gap) => gap.id === 'codex-interactive-approvals' && gap.status === 'missing'))
  assert.ok(runtimeInfo.codex.registry.gaps.some((gap) => gap.id === 'codex-auto-review-mode' && gap.status === 'blocked'))
  assert.ok(runtimeInfo.copilot.registry.gaps.some((gap) => gap.id === 'copilot-cli-keychain' && gap.status === 'partial'))
  assert.ok(runtimeInfo.cursor.registry.gaps.some((gap) => gap.id === 'cursor-keychain-models' && gap.status === 'blocked'))
  assert.ok(runtimeInfo.codex.registry.slashCommands.some((command) => command.name === '/review' && command.runtime === 'headless'))
  assert.ok(runtimeInfo.cursor.registry.slashCommands.some((command) => command.name === '/plan' && command.prompt))
})

test('provider CLI spec covers every configured provider with evidence levels', () => {
  const spec = readFileSync(join(process.cwd(), 'docs/provider-cli-spec.md'), 'utf8')

  for (const providerName of ['Claude Code', 'Codex CLI', 'Cursor Agent', 'GitHub Copilot CLI']) {
    assert.match(spec, new RegExp(`## ${providerName}`), `Missing ${providerName} section`)
  }

  for (const evidenceLevel of ['verified-cli', 'verified-config', 'verified-package', 'inferred', 'unknown']) {
    assert.equal(spec.includes(`\`${evidenceLevel}\``), true, `Missing ${evidenceLevel} evidence level`)
  }

  assert.match(spec, /Auto-review approval mode|auto review/i)
  assert.match(spec, /SecItemCopyMatching failed -50/)
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
    assert.ok(diagnostic.probes.length > 0, `${providerId} should include no-quota probe results`)
    for (const probe of diagnostic.probes) {
      assert.equal(probe.quota, 'none')
      assert.ok(['ok', 'error', 'missing', 'skipped'].includes(probe.status))
    }
  }
})

test('provider diagnostics can load one provider asynchronously for settings', async () => {
  const diagnostics = await getProviderDiagnosticsAsync('claude')

  assert.deepEqual(Object.keys(diagnostics), ['claude'])
  assert.equal(diagnostics.claude.id, 'claude')
  assert.ok(diagnostics.claude.probes.length > 0)
})

test('provider command surfaces only auto-run no-quota non-mutating commands', () => {
  const mutating = runProviderCommandSurface('claude', 'project-purge')
  const quota = runProviderCommandSurface('claude', 'ultrareview-json')
  const unknown = runProviderCommandSurface('claude', 'missing-surface')

  assert.equal(mutating.status, 'blocked')
  assert.match(mutating.output, /not safe/i)
  assert.equal(quota.status, 'blocked')
  assert.match(quota.output, /not safe/i)
  assert.equal(unknown.status, 'blocked')
  assert.match(unknown.output, /unknown provider command/i)
})

test('claude mcp details parser ignores health banners and keeps server names', () => {
  const output = [
    'Checking MCP server health...',
    'git: node /Users/me/claude-mcp/dist/servers/git-server.js - ✗ Failed to connect',
    'wiki-server: node /Users/me/wiki-server/build/index.js - ✗ Failed to connect',
    'jira: node /Users/me/claude-mcp/dist/servers/jira-server.js - ✗ Failed to connect',
    'confluence: node /Users/me/claude-mcp/dist/servers/confluence-server.js - ✗ Failed to connect'
  ].join('\n')

  assert.deepEqual(claudeMcpServerNames(output), ['git', 'wiki-server', 'jira', 'confluence'])
})

test('provider command surfaces can run through async settings IPC path', async () => {
  const blocked = await runProviderCommandSurfaceAsync('claude', 'project-purge')
  const unknown = await runProviderCommandSurfaceAsync('claude', 'missing-surface')

  assert.equal(blocked.status, 'blocked')
  assert.equal(unknown.status, 'blocked')
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

test('provider spawn env keeps desktop CLI directories available to provider helpers', () => {
  const originalPath = process.env.PATH
  const originalHome = process.env.HOME
  const tmpRoot = join(tmpdir(), `orchestrator-provider-env-${Date.now()}`)

  try {
    process.env.HOME = tmpRoot
    process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
    const pathEntries = (providerSpawnEnv().PATH ?? '').split(':')
    assert.ok(pathEntries.includes(join(tmpRoot, '.local/bin')))
    assert.ok(pathEntries.includes('/opt/homebrew/bin'))
    assert.equal(providerSpawnEnv().TERM, 'xterm-256color')
  } finally {
    process.env.PATH = originalPath
    process.env.HOME = originalHome
    rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('provider spawn env merges generic env overrides from provider settings', () => {
  const originalHome = process.env.HOME
  const tmpRoot = join(tmpdir(), `orchestrator-provider-env-${Date.now()}`)
  const claudeDir = join(tmpRoot, '.claude')
  const cursorDir = join(tmpRoot, '.cursor')

  try {
    process.env.HOME = tmpRoot
    mkdirSync(claudeDir, { recursive: true })
    mkdirSync(cursorDir, { recursive: true })
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      env: {
        NPM_CONFIG_REGISTRY: 'https://example.invalid/npm/',
        ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic/',
        IGNORED_NON_STRING: 42
      }
    }))
    writeFileSync(join(cursorDir, 'agent-config.json'), JSON.stringify({
      env: {
        CURSOR_API_BASE_URL: 'https://example.invalid/cursor/'
      }
    }))

    const claudeEnv = providerSpawnEnv('claude')
    const cursorEnv = providerSpawnEnv('cursor')
    const codexEnv = providerSpawnEnv('codex')
    assert.equal(claudeEnv.NPM_CONFIG_REGISTRY, 'https://example.invalid/npm/')
    assert.equal(claudeEnv.ANTHROPIC_BASE_URL, 'https://example.invalid/anthropic/')
    assert.equal(claudeEnv.IGNORED_NON_STRING, undefined)
    assert.equal(cursorEnv.CURSOR_API_BASE_URL, 'https://example.invalid/cursor/')
    assert.equal(codexEnv.NPM_CONFIG_REGISTRY, undefined)
  } finally {
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

  assert.equal(runtimeInfo.codex.policies.default.intent, 'ask')
  assert.ok(runtimeInfo.codex.policies.default.controls?.some((control) => control.kind === 'sandbox'))
  assert.ok(runtimeInfo.codex.policies.default.controls?.some((control) => control.kind === 'mode' && control.support === 'available'))

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
    'supported'
  )
})

test('interactive CLI capability is exposed separately from structured output', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  assert.equal(runtimeInfo.claude.capabilities.interactiveCli, true)
  assert.equal(runtimeInfo.codex.capabilities.interactiveCli, true)
  assert.equal(runtimeInfo.cursor.capabilities.interactiveCli, true)
  assert.equal(runtimeInfo.copilot.capabilities.interactiveCli, true)
  assert.equal(
    runtimeInfo.claude.abstractCapabilities.find((capability) => capability.key === 'interactiveCli')?.support,
    'supported'
  )
  assert.equal(
    runtimeInfo.copilot.abstractCapabilities.find((capability) => capability.key === 'interactiveCli')?.support,
    'supported'
  )
})

test('providers expose native interactive CLI launch commands without headless output flags', () => {
  const claudeCommand = PROVIDERS.claude.buildInteractiveCommand(request({
    prompt: 'hello',
    executionPolicy: 'default',
    model: 'claude-sonnet-4-6'
  }))
  assert.equal(claudeCommand.args.includes('-p'), false)
  assert.equal(claudeCommand.args.includes('--output-format'), false)
  assert.equal(claudeCommand.args.at(-1), 'hello')
  assert.equal(claudeCommand.args.includes('--permission-mode'), true)
  assert.equal(claudeCommand.args[claudeCommand.args.indexOf('--permission-mode') + 1], 'default')

  const codexCommand = PROVIDERS.codex.buildInteractiveCommand(request({
    prompt: 'hello',
    executionPolicy: 'untrusted',
    model: 'gpt-5.4'
  }))
  assert.equal(codexCommand.args[0], '--model')
  assert.equal(codexCommand.args.includes('exec'), false)
  assert.equal(codexCommand.args.includes('--json'), false)
  assert.equal(codexCommand.args.includes('--ask-for-approval'), true)
  assert.equal(codexCommand.args[codexCommand.args.indexOf('--ask-for-approval') + 1], 'untrusted')

  const cursorCommand = PROVIDERS.cursor.buildInteractiveCommand(request({
    prompt: 'hello',
    executionPolicy: 'default',
    model: 'auto'
  }))
  assert.equal(cursorCommand.args.includes('--print'), false)
  assert.equal(cursorCommand.args.includes('--output-format'), false)
  assert.equal(cursorCommand.args.includes('--trust'), false)
  assert.equal(cursorCommand.args.includes('--workspace'), true)

  const copilotCommand = PROVIDERS.copilot.buildInteractiveCommand(request({
    prompt: 'hello',
    executionPolicy: 'default',
    model: 'gpt-5.4-mini'
  }))
  assert.equal(copilotCommand.args.includes('-p'), false)
  assert.equal(copilotCommand.args.includes('--output-format'), false)
  assert.equal(copilotCommand.args.includes('--allow-all-tools'), false)
  assert.deepEqual(copilotCommand.args.slice(-2), ['-i', 'hello'])
})

test('runtime command selection keeps interactive sessions on the native CLI lane', () => {
  const interactiveClaude = buildProviderCommandForRuntime(
    PROVIDERS.claude,
    request({
      runtime: 'interactive',
      prompt: 'hello',
      executionPolicy: 'default',
      model: 'claude-sonnet-4-6'
    })
  )
  assert.equal(interactiveClaude.args.includes('-p'), false)
  assert.equal(interactiveClaude.args.includes('--output-format'), false)

  const headlessClaude = buildProviderCommandForRuntime(
    PROVIDERS.claude,
    request({
      runtime: 'headless',
      prompt: 'hello',
      executionPolicy: 'default',
      model: 'claude-sonnet-4-6'
    })
  )
  assert.equal(headlessClaude.args.includes('-p'), true)
  assert.equal(headlessClaude.args.includes('--output-format'), true)

  const interactiveCopilot = buildProviderCommandForRuntime(
    PROVIDERS.copilot,
    request({ runtime: 'interactive', prompt: 'hello' })
  )
  assert.equal(interactiveCopilot.args.includes('--output-format'), false)
  assert.deepEqual(interactiveCopilot.args.slice(-2), ['-i', 'hello'])
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

test('claude exposes every native safe permission mode in command construction', () => {
  for (const mode of ['default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions']) {
    const command = PROVIDERS.claude.buildInteractiveCommand(
      request({ runtime: 'interactive', executionPolicy: mode })
    )
    const permissionIndex = command.args.indexOf('--permission-mode')

    assert.notEqual(permissionIndex, -1)
    assert.equal(command.args[permissionIndex + 1], mode)
  }
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

test('claude command maps denied tools, tool set, and extra directories to native CLI flags', () => {
  const command = PROVIDERS.claude.buildStartCommand(
    request({
      allowedTools: ['Read'],
      disallowedTools: ['Bash(git push)', 'WebFetch'],
      availableTools: ['Read', 'Edit', 'Bash'],
      additionalDirs: ['/tmp/shared', '/tmp/other']
    })
  )

  assert.equal(command.args[command.args.indexOf('--allowedTools') + 1], 'Read')
  assert.equal(command.args[command.args.indexOf('--disallowedTools') + 1], 'Bash(git push),WebFetch')
  assert.equal(command.args[command.args.indexOf('--tools') + 1], 'Read,Edit,Bash')
  assert.equal(command.args.includes('--add-dir'), true)
  const addDirIndex = command.args.indexOf('--add-dir')
  assert.deepEqual(command.args.slice(addDirIndex + 1, addDirIndex + 3), ['/tmp/shared', '/tmp/other'])
})

test('claude structured command carries per-run orchestrator hook settings', () => {
  const command = PROVIDERS.claude.buildStartCommand(
    request({
      runtime: 'headless',
      providerContext: {
        settingsPath: '/tmp/orchestrator-claude-hooks/settings.json',
        includeHookEvents: true
      }
    })
  )

  assert.equal(command.args.includes('--include-hook-events'), true)
  assert.equal(command.args[command.args.indexOf('--settings') + 1], '/tmp/orchestrator-claude-hooks/settings.json')
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
  assert.equal(
    events.some((event) => event.type === 'tool.completed' && event.toolUseId === 'tool-1' && event.isError),
    false
  )

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
  assert.equal(userInput.questions?.[0]?.options?.[0]?.label, 'example/review-provider-output')
  assert.equal(events.some((event) => event.type === 'tool.started'), false)
  assert.equal(events.some((event) => event.type === 'tool.completed'), false)

  const resultMessage = messages.find((message) => message.type === 'result')
  assert.ok(resultMessage)
  if (resultMessage.type === 'result') {
    assert.equal(resultMessage.subtype, 'waiting_for_user')
    assert.equal(resultMessage.userInputQuestions?.[0]?.options?.length, 3)
  }
})

test('claude Task tool normalizes subagent activity alongside tool events', () => {
  const events = parseFixture('claude', 'task-agent.jsonl')
  const session = firstEvent(events, 'session.started')
  const started = firstEvent(events, 'agent.started')
  const completed = firstEvent(events, 'agent.completed')
  const tool = firstEvent(events, 'tool.started')
  const toolResult = firstEvent(events, 'tool.completed')

  assert.equal(session.providerSessionId, 'claude-task-session')
  assert.equal(started.agent.id, 'tool-task-1')
  assert.equal(started.agent.providerId, 'claude')
  assert.equal(started.agent.sessionId, 'claude-task-session')
  assert.equal(started.agent.name, 'explorer')
  assert.equal(started.agent.status, 'running')
  assert.equal(completed.agent.status, 'completed')
  assert.match(completed.agent.summary ?? '', /provider fixtures/)
  assert.equal(tool.toolName, 'Task')
  assert.equal(toolResult.toolUseId, 'tool-task-1')
  assert.ok(events.some((event) => event.type === 'run.completed'))
})

test('claude Agent tool normalizes subagent activity alongside tool events', () => {
  const events = parseFixture('claude', 'agent-tool.jsonl')
  const started = firstEvent(events, 'agent.started')
  const completed = firstEvent(events, 'agent.completed')
  const tool = firstEvent(events, 'tool.started')
  const toolResult = firstEvent(events, 'tool.completed')

  assert.equal(started.agent.id, 'tool-agent-1')
  assert.equal(started.agent.providerId, 'claude')
  assert.equal(started.agent.sessionId, 'claude-agent-session')
  assert.equal(started.agent.name, 'Explore')
  assert.equal(completed.agent.status, 'completed')
  assert.match(completed.agent.summary ?? '', /README.md/)
  assert.equal(tool.toolName, 'Agent')
  assert.equal(toolResult.toolUseId, 'tool-agent-1')
})

test('claude system task lifecycle updates the subagent node from live stream-json events', () => {
  const events = parseFixture('claude', 'task-progress.jsonl')
  const startedEvents = events.filter((event): event is Extract<RunEvent, { type: 'agent.started' }> => event.type === 'agent.started')
  const updated = firstEvent(events, 'agent.updated')
  const completedEvents = events.filter((event): event is Extract<RunEvent, { type: 'agent.completed' }> => event.type === 'agent.completed')
  const completed = firstEvent(events, 'agent.completed')

  assert.equal(startedEvents.length, 2, 'assistant Agent tool and system task_started both identify the same subagent')
  assert.equal(completedEvents.length, 1, 'task_notification should complete the subagent without duplicating the parent Agent tool_result')
  assert.equal(startedEvents[0].agent.id, 'tool-live-agent-1')
  assert.equal(startedEvents[1].agent.id, 'tool-live-agent-1')
  assert.equal(startedEvents[1].agent.name, 'local_agent')
  assert.match(startedEvents[1].agent.role ?? '', /Find TodoWrite parsing/)
  assert.equal(updated.agent.id, 'tool-live-agent-1')
  assert.match(updated.agent.summary ?? '', /Running grep/)
  assert.match(updated.agent.summary ?? '', /Grep/)
  assert.match(updated.agent.summary ?? '', /14118 tokens/)
  assert.equal(completed.agent.status, 'completed')
  assert.match(completed.agent.summary ?? '', /Found TodoWrite parser test patterns/)
})

test('claude run failure finalizes active subagent nodes as failed', () => {
  const events = parseFixture('claude', 'task-permission-denied.jsonl')
  const session = { id: 'session-under-test', provider: 'claude' }
  const agents = deriveAgentNodes(session, records(events))
  const failed = firstEvent(events, 'run.failed')

  assert.match(failed.content ?? '', /Permission denied by user/)
  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'tool-denied-agent-1')
  assert.equal(agents[0].status, 'failed')
  assert.match(agents[0].summary ?? '', /Running Write P4_SHOULD_NOT_RUN/)
})

test('claude partial text streams normalize without duplicating finalized assistant blocks', () => {
  const events = parseFixture('claude', 'partial-message.jsonl')
  const deltas = events.filter((event): event is Extract<RunEvent, { type: 'assistant.text.delta' }> => event.type === 'assistant.text.delta')
  const completed = firstEvent(events, 'assistant.text.completed')

  assert.deepEqual(deltas.map((event) => event.content), ['Hello', ' world'])
  assert.equal(completed.streamId, 'msg-partial-1:0')
  assert.equal(events.some((event) => event.type === 'assistant.text'), false)
  assert.ok(events.some((event) => event.type === 'run.completed'))
})

test('claude nested agent text streams into agent transcript state', () => {
  const events = parseFixture('claude', 'agent-partial-message.jsonl')
  const session = { id: 'session-under-test', provider: 'claude' }
  const agents = deriveAgentNodes(session, records(events))
  const deltas = events.filter((event): event is Extract<RunEvent, { type: 'agent.text.delta' }> => event.type === 'agent.text.delta')

  assert.deepEqual(deltas.map((event) => event.content), ['Found src', ' and docs'])
  assert.equal(events.some((event) => event.type === 'assistant.text'), false)
  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'tool-agent-partial-1')
  assert.equal(agents[0].status, 'completed')
  assert.equal(agents[0].transcript, 'Found src and docs')
})

test('claude sidechain agent jsonl streams into agent transcript state', () => {
  const events = parseFixture('claude', 'sidechain-agent.jsonl')
  const session = { id: 'session-under-test', provider: 'claude' }
  const agents = deriveAgentNodes(session, records(events))

  assert.deepEqual(
    events
      .filter((event): event is Extract<RunEvent, { type: 'agent.text.delta' }> => event.type === 'agent.text.delta')
      .map((event) => event.agentId),
    ['agent-sidechain-1', 'agent-sidechain-1']
  )
  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'agent-sidechain-1')
  assert.equal(agents[0].status, 'completed')
  assert.equal(agents[0].transcript, 'I found README.md.\nThe repo also has docs.')
})

test('claude plan mode and TodoWrite normalize into plan updates', () => {
  const events = parseFixture('claude', 'plan-todos.jsonl')
  const plans = events.filter((event): event is Extract<RunEvent, { type: 'plan.updated' }> => event.type === 'plan.updated')
  const planMode = plans.find((event) => event.plan.mode === 'plan')
  const todoPlan = plans.find((event) => event.plan.items.length === 3)

  assert.ok(planMode)
  assert.equal(planMode.plan.sessionId, 'claude-plan-session')
  assert.match(planMode.plan.summary ?? '', /Plan the change/)
  assert.ok(todoPlan)
  assert.equal(todoPlan.plan.title, 'Tasks')
  assert.equal(todoPlan.plan.items[0].status, 'completed')
  assert.equal(todoPlan.plan.items[1].status, 'in_progress')
  assert.equal(todoPlan.plan.items[1].content, 'Map permission events')
  assert.equal(todoPlan.plan.items[2].status, 'pending')
})

test('claude ExitPlanMode confirmation is a permission prompt, not a red tool error', () => {
  const events = parseFixture('claude', 'exit-plan-denial.jsonl')
  const messages = eventsToMessages(events)
  const plans = events.filter((event): event is Extract<RunEvent, { type: 'plan.updated' }> => event.type === 'plan.updated')
  const permission = firstEvent(events, 'permission.requested')

  assert.equal(plans[0].plan.mode, 'execute')
  assert.equal(plans[1].plan.mode, 'plan')
  assert.equal(permission.denials[0]?.tool_name, 'ExitPlanMode')
  assert.equal(events.some((event) => event.type === 'tool.completed' && event.isError), false)
  assert.equal(messages.some((message) => message.type === 'tool_result' && message.isError), false)
  assert.equal(messages.some((message) => message.type === 'result' && message.permissionDenials?.[0]?.tool_name === 'ExitPlanMode'), true)
})

test('claude AskUserQuestion permission denial becomes user input, not permission UI', () => {
  const events = PROVIDERS.claude.parseOutputLine(JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    result: 'Permission denied',
    permission_denials: [{
      tool_name: 'AskUserQuestion',
      tool_use_id: 'tool-question-1',
      tool_input: {
        questions: [{
          question: 'Which branch name should I use?',
          header: 'Branch name',
          options: [{ label: 'example/branch' }]
        }]
      }
    }]
  }))
  const userInput = firstEvent(events, 'user_input.requested')

  assert.equal(userInput.content, 'Which branch name should I use?')
  assert.equal(userInput.questions?.[0]?.options?.[0]?.label, 'example/branch')
  assert.equal(events.some((event) => event.type === 'permission.requested'), false)
})

test('claude auth retry output fails fast instead of spinning through retries', () => {
  const helperEvents = PROVIDERS.claude.parseOutputLine(
    '\u001B[0m\u001B[31mapiKeyHelper failed: exited 127: /bin/sh: npx: command not found\u001B[0m'
  )
  const retryEvents = PROVIDERS.claude.parseOutputLine(
    '{"type":"system","subtype":"api_retry","attempt":1,"error_status":401,"error":"authentication_failed"}'
  )

  const helperFailure = firstEvent(helperEvents, 'run.failed')
  const retryFailure = firstEvent(retryEvents, 'run.failed')

  assert.match(helperFailure.content ?? '', /apiKeyHelper failed/)
  assert.doesNotMatch(helperFailure.content ?? '', /\u001B/)
  assert.match(retryFailure.content ?? '', /authentication failed/i)
})

test('claude interactive turn duration marks the run complete', () => {
  const events = PROVIDERS.claude.parseOutputLine(JSON.stringify({
    type: 'system',
    subtype: 'turn_duration',
    durationMs: 2910,
    messageCount: 3
  }))

  assert.ok(events.some((event) => event.type === 'run.completed'))
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
      types: ['session.started', 'assistant.text', 'user_input.requested']
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
      providerId: 'copilot',
      fixture: 'user-input.jsonl',
      types: ['user_input.requested']
    },
    {
      providerId: 'copilot',
      fixture: 'permission-request.jsonl',
      types: ['permission.requested']
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
      providerId: 'codex',
      fixture: 'user-input.jsonl',
      types: ['user_input.requested']
    },
    {
      providerId: 'codex',
      fixture: 'permission-request.jsonl',
      types: ['permission.requested']
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
    },
    {
      providerId: 'cursor',
      fixture: 'user-input.jsonl',
      types: ['user_input.requested']
    },
    {
      providerId: 'cursor',
      fixture: 'permission-request.jsonl',
      types: ['permission.requested']
    }
  ]

  for (const { providerId, fixture, types } of cases) {
    assert.deepEqual(eventTypes(parseFixture(providerId, fixture)), types, `${providerId}/${fixture}`)
  }
})

test('generic CLI question events normalize across Copilot, Codex, and Cursor', () => {
  const copilotQuestion = firstEvent(parseFixture('copilot', 'user-input.jsonl'), 'user_input.requested')
  const codexQuestion = firstEvent(parseFixture('codex', 'user-input.jsonl'), 'user_input.requested')
  const cursorQuestion = firstEvent(parseFixture('cursor', 'user-input.jsonl'), 'user_input.requested')

  assert.equal(copilotQuestion.content, 'Which branch should I inspect?')
  assert.equal(copilotQuestion.questions?.[0]?.options?.[0]?.label, 'main')
  assert.equal(codexQuestion.content, 'Pick a deployment target')
  assert.equal(codexQuestion.questions?.[0]?.options?.[1]?.label, 'production')
  assert.equal(cursorQuestion.content, 'Which mode should Cursor use?')
  assert.equal(cursorQuestion.questions?.[0]?.options?.[1]?.label, 'Plan')
})

test('generic CLI permission events preserve tool identity and requested action', () => {
  const copilotPermission = firstEvent(parseFixture('copilot', 'permission-request.jsonl'), 'permission.requested')
  const codexPermission = firstEvent(parseFixture('codex', 'permission-request.jsonl'), 'permission.requested')
  const cursorPermission = firstEvent(parseFixture('cursor', 'permission-request.jsonl'), 'permission.requested')

  assert.equal(copilotPermission.denials[0]?.tool_name, 'shell')
  assert.equal(copilotPermission.denials[0]?.tool_input.command, 'git push')
  assert.equal(codexPermission.denials[0]?.tool_name, 'shell')
  assert.equal(codexPermission.denials[0]?.tool_input.command, 'npm install')
  assert.equal(cursorPermission.denials[0]?.tool_name, 'write')
  assert.equal(cursorPermission.denials[0]?.tool_input.path, 'src/index.ts')
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

test('copilot subagent events normalize into agent activity nodes', () => {
  const events = [
    PROVIDERS.copilot.parseOutputLine(JSON.stringify({
      type: 'subagent.started',
      sessionId: 'copilot-session-123',
      data: { id: 'agent-1', name: 'Research', role: 'explore repo', model: 'gpt-5.5' }
    })),
    PROVIDERS.copilot.parseOutputLine(JSON.stringify({
      type: 'subagent.completed',
      sessionId: 'copilot-session-123',
      data: { id: 'agent-1', name: 'Research', summary: 'Found the parser path.' }
    }))
  ].flat()
  const started = firstEvent(events, 'agent.started')
  const completed = firstEvent(events, 'agent.completed')

  assert.equal(started.agent.id, 'agent-1')
  assert.equal(started.agent.providerId, 'copilot')
  assert.equal(started.agent.sessionId, 'copilot-session-123')
  assert.equal(started.agent.status, 'running')
  assert.equal(completed.agent.status, 'completed')
  assert.equal(completed.agent.summary, 'Found the parser path.')
})

test('codex approval modes map to native approval policy config', () => {
  const askCommand = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'default' })
  )
  assert.equal(askCommand.args.includes('--sandbox'), true)
  assert.equal(askCommand.args[askCommand.args.indexOf('--sandbox') + 1], 'workspace-write')
  assert.equal(askCommand.args.includes('approval_policy="on-request"'), true)

  const untrustedCommand = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'untrusted' })
  )
  assert.equal(untrustedCommand.args.includes('approval_policy="untrusted"'), true)

  const neverCommand = PROVIDERS.codex.buildStartCommand(
    request({ model: 'gpt-5.4', executionPolicy: 'never' })
  )
  assert.equal(neverCommand.args.includes('approval_policy="never"'), true)

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

  assert.equal(resolved.support, 'approximate')
  assert.match(resolved.warning ?? '', /interactive CLI lane/)
  assert.equal(command.args.includes('--ask-for-approval'), false)
  assert.equal(command.args.includes('approval_policy="on-request"'), true)
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
