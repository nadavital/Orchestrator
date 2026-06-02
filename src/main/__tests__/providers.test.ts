import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunEvent, RunRequest } from '../../types'
import { AGENT_THREAD_ADAPTER_CONTRACTS, PROVIDER_DEFS, deriveAgentNodes, deriveAgentThreadGraph, derivePlanStatesFromMessages, getDefaultPermissionMode, getPrimaryPermissionModes, getProviderPermissionPresets, parseClaudeAgentsOutput, permissionRequestDetail } from '../../types'
import { buildProviderCommandForRuntime, claudeMcpServerNames, codexRuntimePolicyConfig, getProviderDiagnostics, getProviderDiagnosticsAsync, getProviderRuntimeInfo, providerAuthFailureMessage, PROVIDERS, providerSpawnEnv, resolveProviderBinary, resolveProviderPermissionRuntimeContext, runProviderCommandSurface, runProviderCommandSurfaceAsync } from '../providers'
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
  'checkpointUndo',
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
  assert.ok(runtimeInfo.claude.registry.probes.some((probe) => probe.id === 'auto-mode-defaults' && probe.quota === 'none'))
  assert.ok(runtimeInfo.codex.registry.features.some((feature) => feature.id === 'multi-agent'))
  assert.ok(runtimeInfo.copilot.registry.features.some((feature) => feature.id === 'subagents'))
  assert.ok(runtimeInfo.cursor.registry.features.some((feature) => feature.id === 'worktrees'))
  assert.ok(runtimeInfo.claude.registry.gaps.some((gap) => gap.id === 'claude-rich-permission-controls' && gap.status === 'partial'))
  assert.ok(runtimeInfo.claude.registry.gaps.some((gap) => gap.id === 'claude-cli-management' && gap.status === 'partial'))
  assert.ok(runtimeInfo.claude.registry.gaps.some((gap) => gap.id === 'claude-worktree-launch' && gap.status === 'partial'))
  assert.ok(runtimeInfo.codex.registry.features.some((feature) => feature.id === 'app-server' && feature.support === 'supported'))
  assert.ok(runtimeInfo.codex.registry.features.some((feature) => feature.id === 'mcp-elicitation' && feature.support === 'supported'))
  assert.ok(runtimeInfo.codex.registry.commandSurfaces.some((surface) => surface.id === 'appserver-models' && surface.runtime === 'app-server'))
  assert.ok(runtimeInfo.codex.registry.commandSurfaces.some((surface) => surface.id === 'appserver-skills' && surface.quota === 'none'))
  assert.ok(runtimeInfo.codex.registry.commandSurfaces.some((surface) => surface.id === 'appserver-mcp-status' && surface.area === 'mcp'))
  assert.ok(runtimeInfo.codex.registry.gaps.some((gap) => gap.id === 'codex-auto-review-mode' && gap.status === 'partial'))
  assert.ok(runtimeInfo.copilot.registry.gaps.some((gap) => gap.id === 'copilot-cli-keychain' && gap.status === 'partial'))
  assert.ok(runtimeInfo.copilot.registry.features.some((feature) => feature.id === 'sdk-runtime' && feature.support === 'supported'))
  assert.ok(runtimeInfo.copilot.registry.gaps.some((gap) => gap.id === 'copilot-sdk-runtime-lane' && gap.status === 'partial'))
  assert.ok(runtimeInfo.antigravity.registry.features.some((feature) => feature.id === 'python-sdk' && feature.support === 'supported'))
  assert.ok(runtimeInfo.antigravity.registry.features.some((feature) => feature.id === 'sdk-agent' && feature.support === 'supported'))
  assert.ok(runtimeInfo.antigravity.registry.gaps.some((gap) => gap.id === 'antigravity-python-sdk-not-installed' && gap.status === 'blocked'))
  assert.ok(runtimeInfo.cursor.registry.gaps.some((gap) => gap.id === 'cursor-keychain-models' && gap.status === 'blocked'))
  assert.ok(runtimeInfo.codex.registry.slashCommands.some((command) => command.name === '/review' && command.runtime === 'headless'))
  assert.ok(runtimeInfo.cursor.registry.slashCommands.some((command) => command.name === '/plan' && command.prompt))
})

test('provider auth diagnostics recognize API credential failures from no-quota probes', () => {
  assert.equal(
    providerAuthFailureMessage('Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}'),
    'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}'
  )
  assert.equal(providerAuthFailureMessage('2.1.51 (Claude Code)'), null)
})

test('provider CLI spec covers every configured provider with evidence levels', () => {
  const spec = readFileSync(join(process.cwd(), 'docs/provider-cli-spec.md'), 'utf8')

  for (const providerName of ['Claude Code', 'Codex CLI', 'Cursor Agent', 'GitHub Copilot CLI', 'Google Antigravity SDK']) {
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
  const codexAppServer = runProviderCommandSurface('codex', 'appserver-models')

  assert.equal(mutating.status, 'blocked')
  assert.match(mutating.output, /not safe/i)
  assert.equal(quota.status, 'blocked')
  assert.match(quota.output, /not safe/i)
  assert.equal(unknown.status, 'blocked')
  assert.match(unknown.output, /unknown provider command/i)
  assert.equal(codexAppServer.status, 'blocked')
  assert.match(codexAppServer.output, /async command runner/i)
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
  const originalProviderEnvPath = process.env.ORCHESTRATOR_PROVIDER_ENV_PATH
  const originalDisableProviderKeychain = process.env.ORCHESTRATOR_DISABLE_PROVIDER_KEYCHAIN
  const tmpRoot = join(tmpdir(), `orchestrator-provider-env-${Date.now()}`)
  const claudeDir = join(tmpRoot, '.claude')
  const cursorDir = join(tmpRoot, '.cursor')
  const orchestratorEnvPath = join(tmpRoot, 'orchestrator-provider-env.json')

  try {
    process.env.HOME = tmpRoot
    process.env.ORCHESTRATOR_PROVIDER_ENV_PATH = orchestratorEnvPath
    process.env.ORCHESTRATOR_DISABLE_PROVIDER_KEYCHAIN = '1'
    mkdirSync(claudeDir, { recursive: true })
    mkdirSync(cursorDir, { recursive: true })
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
      env: {
        NPM_CONFIG_REGISTRY: 'https://example.invalid/npm/',
        ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic/',
        IGNORED_NON_STRING: 42
      }
    }))
    writeFileSync(join(cursorDir, 'cli-config.json'), JSON.stringify({
      env: {
        CURSOR_API_BASE_URL: 'https://example.invalid/cursor/',
        CURSOR_API_KEY: 'provider-config-key'
      }
    }))
    writeFileSync(orchestratorEnvPath, JSON.stringify({
      cursor: {
        env: {
          CURSOR_API_KEY: 'orchestrator-managed-key'
        }
      }
    }))

    const claudeEnv = providerSpawnEnv('claude')
    const cursorEnv = providerSpawnEnv('cursor')
    const codexEnv = providerSpawnEnv('codex')
    assert.equal(claudeEnv.NPM_CONFIG_REGISTRY, 'https://example.invalid/npm/')
    assert.equal(claudeEnv.ANTHROPIC_BASE_URL, 'https://example.invalid/anthropic/')
    assert.equal(claudeEnv.IGNORED_NON_STRING, undefined)
    assert.equal(cursorEnv.CURSOR_API_BASE_URL, 'https://example.invalid/cursor/')
    assert.equal(cursorEnv.CURSOR_API_KEY, 'orchestrator-managed-key')
    assert.equal(codexEnv.NPM_CONFIG_REGISTRY, undefined)
  } finally {
    process.env.HOME = originalHome
    if (originalProviderEnvPath === undefined) delete process.env.ORCHESTRATOR_PROVIDER_ENV_PATH
    else process.env.ORCHESTRATOR_PROVIDER_ENV_PATH = originalProviderEnvPath
    if (originalDisableProviderKeychain === undefined) delete process.env.ORCHESTRATOR_DISABLE_PROVIDER_KEYCHAIN
    else process.env.ORCHESTRATOR_DISABLE_PROVIDER_KEYCHAIN = originalDisableProviderKeychain
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
  assert.deepEqual(runtimeInfo.codex.policies.default.execution, {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
    configSource: 'mixed'
  })

  assert.equal(runtimeInfo.cursor.policies.default.intent, 'workspaceSandbox')
  assert.ok(runtimeInfo.cursor.policies.default.controls?.some((control) => control.kind === 'config'))
  assert.equal(runtimeInfo.cursor.policies.default.execution?.sandboxMode, 'enabled')
  assert.equal(runtimeInfo.cursor.policies.ask.intent, 'ask')
  assert.equal(runtimeInfo.cursor.policies.ask.execution?.sandboxMode, 'read-only')

  assert.equal(runtimeInfo.antigravity.policies.default.intent, 'ask')
  assert.equal(runtimeInfo.antigravity.policies.default.interaction, 'headless')
  assert.equal(runtimeInfo.antigravity.policies.sandbox.intent, 'workspaceSandbox')
  assert.equal(runtimeInfo.antigravity.policies.sandbox.execution?.sandboxMode, 'sdk-default')
  assert.equal(runtimeInfo.antigravity.policies.bypassPermissions.intent, 'bypass')
})

test('runtime info distinguishes interactive permission support from forced unattended modes', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  assert.equal(
    runtimeInfo.claude.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'supported'
  )
  assert.equal(
    runtimeInfo.codex.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'supported',
    'Codex app-server exposes structured approval prompts'
  )
  assert.equal(
    runtimeInfo.cursor.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'forced'
  )
  assert.equal(
    runtimeInfo.copilot.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'supported'
  )
  assert.equal(
    runtimeInfo.antigravity.abstractCapabilities.find((capability) => capability.key === 'interactivePermissions')?.support,
    'unsupported'
  )
})

test('interactive CLI capability is exposed separately from structured output', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  assert.equal(runtimeInfo.claude.capabilities.interactiveCli, false)
  assert.equal(runtimeInfo.codex.capabilities.interactiveCli, true)
  assert.equal(runtimeInfo.cursor.capabilities.interactiveCli, true)
  assert.equal(runtimeInfo.copilot.capabilities.interactiveCli, true)
  assert.equal(runtimeInfo.antigravity.capabilities.interactiveCli, false)
  assert.equal(
    runtimeInfo.claude.abstractCapabilities.find((capability) => capability.key === 'interactiveCli')?.support,
    'unsupported'
  )
  assert.equal(
    runtimeInfo.copilot.abstractCapabilities.find((capability) => capability.key === 'interactiveCli')?.support,
    'supported'
  )
})

test('checkpoint undo is an explicit provider capability and remains disabled without adapter support', () => {
  const runtimeInfo = getProviderRuntimeInfo()

  for (const [providerId, runtime] of Object.entries(runtimeInfo)) {
    const checkpointUndo = runtime.abstractCapabilities.find((capability) => capability.key === 'checkpointUndo')
    assert.equal(runtime.capabilities.checkpointUndo, false, `${providerId} should not claim checkpoint undo support yet`)
    assert.equal(checkpointUndo?.support, 'unsupported')
    assert.match(checkpointUndo?.note ?? '', /checkpoint id/)
  }
})

test('providers expose native interactive CLI launch commands without headless output flags', () => {
  const codexCommand = PROVIDERS.codex.buildInteractiveCommand!(request({
    prompt: 'hello',
    executionPolicy: 'untrusted',
    model: 'gpt-5.4'
  }))
  assert.equal(codexCommand.args[0], '--model')
  assert.equal(codexCommand.args.includes('exec'), false)
  assert.equal(codexCommand.args.includes('--json'), false)
  assert.equal(codexCommand.args.includes('--ask-for-approval'), true)
  assert.equal(codexCommand.args[codexCommand.args.indexOf('--ask-for-approval') + 1], 'untrusted')

  const cursorCommand = PROVIDERS.cursor.buildInteractiveCommand!(request({
    prompt: 'hello',
    executionPolicy: 'default',
    model: 'auto'
  }))
  assert.equal(cursorCommand.args.includes('--print'), false)
  assert.equal(cursorCommand.args.includes('--output-format'), false)
  assert.equal(cursorCommand.args.includes('--trust'), false)
  assert.equal(cursorCommand.args.includes('--workspace'), true)

  const copilotCommand = PROVIDERS.copilot.buildInteractiveCommand!(request({
    prompt: 'hello',
    executionPolicy: 'default',
    model: 'gpt-5.4-mini'
  }))
  assert.equal(copilotCommand.args.includes('-p'), false)
  assert.equal(copilotCommand.args.includes('--output-format'), false)
  assert.equal(copilotCommand.args.includes('--allow-all-tools'), false)
  assert.deepEqual(copilotCommand.args.slice(-2), ['-i', 'hello'])

  const antigravityCommand = PROVIDERS.antigravity.buildStartCommand!(request({
    prompt: 'hello',
    executionPolicy: 'sandbox',
    providerSessionId: 'sdk-conversation-123'
  }))
  assert.match(antigravityCommand.binary, /python3/)
  assert.match(antigravityCommand.args[0], /antigravity_sdk_bridge\.py$/)
  assert.equal(antigravityCommand.args.includes('--conversation-id'), true)
  assert.equal(antigravityCommand.args[antigravityCommand.args.indexOf('--conversation-id') + 1], 'sdk-conversation-123')
  assert.equal(antigravityCommand.args.includes('--execution-policy'), true)
  assert.equal(antigravityCommand.args[antigravityCommand.args.indexOf('--execution-policy') + 1], 'sandbox')
  assert.equal(antigravityCommand.args[antigravityCommand.args.indexOf('--prompt') + 1], 'hello')
})

test('runtime command selection removes Claude CLI launch commands and keeps other interactive sessions on native lanes', () => {
  const interactiveClaude = buildProviderCommandForRuntime(
    PROVIDERS.claude,
    request({
      runtime: 'interactive',
      prompt: 'hello',
      executionPolicy: 'default',
      model: 'claude-sonnet-4-6'
    })
  )
  assert.equal(interactiveClaude, null)

  const headlessClaude = buildProviderCommandForRuntime(
    PROVIDERS.claude,
    request({
      runtime: 'headless',
      prompt: 'hello',
      executionPolicy: 'default',
      model: 'claude-sonnet-4-6'
    })
  )
  assert.equal(headlessClaude, null)

  const interactiveCopilot = buildProviderCommandForRuntime(
    PROVIDERS.copilot,
    request({ runtime: 'interactive', prompt: 'hello' })
  )
  assert.ok(interactiveCopilot)
  assert.equal(interactiveCopilot.args.includes('--output-format'), false)
  assert.deepEqual(interactiveCopilot.args.slice(-2), ['-i', 'hello'])
})

test('claude product default permission modes are preserved for SDK mapping', () => {
  assert.equal(getDefaultPermissionMode(PROVIDER_DEFS.claude), 'auto')
  assert.deepEqual(getPrimaryPermissionModes(PROVIDER_DEFS.claude).map((mode) => mode.id), ['auto', 'plan', 'default'])
  assert.equal(PROVIDERS.claude.resolveExecutionPolicy('default').execution?.nativeMode, 'default')
  assert.equal(PROVIDERS.claude.resolveExecutionPolicy('auto').execution?.nativeMode, 'auto')
  assert.equal(PROVIDERS.claude.resolveExecutionPolicy('acceptEdits').execution?.nativeMode, 'acceptEdits')
  assert.equal(PROVIDERS.claude.resolveExecutionPolicy('bypassPermissions').execution?.nativeMode, 'bypassPermissions')
})

test('product permission presets expose simple provider-aware controls', () => {
  assert.deepEqual(getProviderPermissionPresets(PROVIDER_DEFS.codex).map((preset) => [preset.id, preset.modeId]), [
    ['default', 'default'],
    ['autoReview', 'autoReview'],
    ['fullAccess', 'fullAccess']
  ])
  assert.deepEqual(getProviderPermissionPresets(PROVIDER_DEFS.claude).map((preset) => [preset.id, preset.modeId]), [
    ['default', 'auto'],
    ['fullAccess', 'bypassPermissions']
  ])
  assert.deepEqual(getProviderPermissionPresets(PROVIDER_DEFS.cursor).map((preset) => [preset.id, preset.modeId]), [
    ['default', 'default'],
    ['fullAccess', 'yolo']
  ])
  assert.deepEqual(getProviderPermissionPresets(PROVIDER_DEFS.copilot).map((preset) => [preset.id, preset.modeId]), [
    ['default', 'allowEdits'],
    ['fullAccess', 'yolo']
  ])
  assert.deepEqual(getProviderPermissionPresets(PROVIDER_DEFS.antigravity).map((preset) => [preset.id, preset.modeId]), [
    ['default', 'default'],
    ['fullAccess', 'bypassPermissions']
  ])
})

test('claude agents output parses configured launch agents', () => {
  const agents = parseClaudeAgentsOutput([
    '4 active agents',
    'Built-in agents:',
    'Explore · haiku',
    'general-purpose · inherit',
    '- Plan · inherit',
    'Explore · haiku'
  ].join('\n'))

  assert.deepEqual(agents, [
    { id: 'Explore', name: 'Explore', model: 'haiku' },
    { id: 'general-purpose', name: 'general-purpose', model: 'inherit' },
    { id: 'Plan', name: 'Plan', model: 'inherit' }
  ])
})

test('claude brief fixture maps SendUserMessage to status and preserves usage summary', () => {
  const events = parseFixture('claude', 'brief-usage.jsonl')
  const messages = eventsToMessages(events)
  const status = firstEvent(events, 'assistant.status')
  const completed = firstEvent(events, 'run.completed')

  assert.match(status.content, /checking the fixture shape/)
  assert.equal(completed.usage?.inputTokens, 10)
  assert.equal(completed.usage?.outputTokens, 40)
  assert.equal(completed.usage?.cacheCreationInputTokens, 20)
  assert.equal(completed.usage?.cacheReadInputTokens, 30)
  assert.equal(completed.usage?.totalTokens, 100)
  assert.equal(completed.usage?.totalCostUsd, 0.0123)

  const statusMessage = messages.find((message) => message.type === 'result' && message.subtype === 'status')
  const successMessage = messages.find((message) => message.type === 'result' && message.subtype === 'success')
  assert.ok(statusMessage)
  assert.ok(successMessage)
  if (successMessage?.type === 'result') {
    assert.equal(successMessage.usageSummary?.totalCostUsd, 0.0123)
  }
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
  assert.equal(started.agent.source, 'provider-event')
  assert.equal(started.agent.providerItemId, 'tool-task-1')
  assert.equal(started.agent.name, 'explorer')
  assert.equal(started.agent.status, 'running')
  assert.equal(completed.agent.status, 'completed')
  assert.match(completed.agent.summary ?? '', /provider fixtures/)
  assert.equal(tool.toolName, 'Task')
  assert.equal(toolResult.toolUseId, 'tool-task-1')
  assert.ok(events.some((event) => event.type === 'run.completed'))

  const graph = deriveAgentThreadGraph({
    id: 'session-under-test',
    provider: 'claude',
    providerSessionId: 'claude-task-session',
    messages: []
  }, records(events))
  assert.equal(graph.threads[0]?.evidence.source, 'provider-event')
  assert.equal(graph.threads[0]?.transcript.kind, 'derived-summary')
  assert.equal(graph.threads[0]?.capabilities.openProviderThread.status, 'unavailable')
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
  const derived = deriveAgentNodes({ id: 'session-under-test', provider: 'claude' }, records(events))
  assert.equal(derived[0]!.name, 'Find TodoWrite parsing code and test patterns')
  assert.match(derived[0]!.role ?? '', /Find TodoWrite parsing/)
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

test('claude real sidechain fixture streams tool and final text into one agent transcript', () => {
  const events = parseFixture('claude', 'sidechain-real.jsonl')
  const session = { id: 'session-under-test', provider: 'claude' }
  const agents = deriveAgentNodes(session, records(events))

  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'agent-real-sidechain-1')
  assert.equal(agents[0].status, 'completed')
  assert.match(agents[0].transcript ?? '', /first sentence of the README/)
  assert.ok(events.some((event) => event.type === 'tool.started' && event.toolName === 'Read'))
  assert.ok(events.some((event) => event.type === 'tool.completed' && event.toolUseId === 'tool-sidechain-read-1'))
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
  assert.match(plans[1].plan.summary ?? '', /Run the targeted parser test/)
  const savedPlans = derivePlanStatesFromMessages({ id: 'session-under-test', provider: 'claude' }, messages)
  assert.match(savedPlans.at(-1)?.summary ?? '', /Run the targeted parser test/)
  assert.equal(permission.denials[0]?.tool_name, 'ExitPlanMode')
  assert.equal(events.some((event) => event.type === 'tool.completed' && event.isError), false)
  assert.equal(messages.some((message) => message.type === 'tool_result' && message.isError), false)
  assert.equal(messages.some((message) => message.type === 'result' && message.permissionDenials?.[0]?.tool_name === 'ExitPlanMode'), true)
})

test('claude MCP and web approval fixture normalizes both denials', () => {
  const events = parseFixture('claude', 'mcp-web-approval.jsonl')
  const permission = firstEvent(events, 'permission.requested')

  assert.equal(permission.denials.length, 2)
  assert.equal(permission.denials[0].tool_name, 'mcp__linear__create_issue')
  assert.equal(permission.denials[1].tool_name, 'WebFetch')
  assert.match(permission.content ?? '', /Permission approval required/)
})

test('claude failure category fixture preserves auth, model, quota, and rate-limit text', () => {
  const failures = parseFixture('claude', 'failure-categories.jsonl')
    .filter((event): event is Extract<RunEvent, { type: 'run.failed' }> => event.type === 'run.failed')

  assert.equal(failures.length, 4)
  assert.match(failures[0].content ?? '', /authentication failed/i)
  assert.match(failures[1].content ?? '', /model unavailable/i)
  assert.match(failures[2].content ?? '', /quota exceeded/i)
  assert.match(failures[3].content ?? '', /rate limit exceeded/i)
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

test('claude structured turn duration marks the run complete', () => {
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
      providerId: 'claude',
      fixture: 'hook-approval.jsonl',
      types: ['session.started', 'tool.started', 'tool.completed', 'assistant.text', 'run.completed']
    },
    {
      providerId: 'claude',
      fixture: 'mcp-web-approval.jsonl',
      types: ['session.started', 'permission.requested']
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
      fixture: 'exec-item-agent-message.jsonl',
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
      providerId: 'codex',
      fixture: 'app-server-approval-question.jsonl',
      types: ['session.started', 'assistant.text', 'permission.requested', 'user_input.requested', 'user_input.requested', 'run.completed']
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

test('permission request details classify command file network and MCP approvals', () => {
  const command = permissionRequestDetail({
    tool_name: 'Bash',
    tool_use_id: 'tool-command',
    tool_input: { command: 'npm install', cwd: '/tmp/project' }
  })
  assert.equal(command.kind, 'command')
  assert.equal(command.title, 'Command Approval')
  assert.equal(command.fields[0]?.label, 'Command')
  assert.equal(command.fields[0]?.mono, true)

  const file = permissionRequestDetail({
    tool_name: 'Edit',
    tool_use_id: 'tool-file',
    tool_input: { file_path: '/tmp/project/src/index.ts' }
  })
  assert.equal(file.kind, 'file')
  assert.equal(file.title, 'File Approval')
  assert.equal(file.fields[0]?.value, '/tmp/project/src/index.ts')

  const network = permissionRequestDetail({
    tool_name: 'WebFetch',
    tool_use_id: 'tool-web',
    tool_input: { url: 'https://example.com', prompt: 'Summarize' }
  })
  assert.equal(network.kind, 'network')
  assert.equal(network.title, 'Network Approval')
  assert.equal(network.fields.some((field) => field.label === 'URL'), true)

  const mcp = permissionRequestDetail({
    tool_name: 'mcp__linear__create_issue',
    tool_use_id: 'tool-mcp',
    tool_input: { title: 'Smoke issue' }
  })
  assert.equal(mcp.kind, 'mcp')
  assert.equal(mcp.title, 'MCP Approval')
  assert.equal(mcp.fields.some((field) => field.label === 'Server' && field.value === 'linear'), true)

  const profile = permissionRequestDetail({
    tool_name: 'permissions',
    tool_use_id: 'tool-profile',
    tool_input: {
      cwd: '/tmp/project',
      reason: 'Need temporary network and write access.',
      permissions: {
        fileSystem: {
          entries: [{
            access: 'write',
            path: { type: 'path', path: '/tmp/project/generated' }
          }]
        },
        network: { enabled: true }
      }
    }
  })
  assert.equal(profile.kind, 'profile')
  assert.equal(profile.title, 'Permission Profile')
  assert.equal(profile.fields.find((field) => field.label === 'Filesystem')?.value, 'write /tmp/project/generated')
  assert.equal(profile.fields.find((field) => field.label === 'Network')?.value, 'enabled')
  assert.equal(profile.fields.find((field) => field.label === 'Working dir')?.value, '/tmp/project')
})

test('permission request details stay stable across provider fixtures', () => {
  const copilot = permissionRequestDetail(firstEvent(parseFixture('copilot', 'permission-request.jsonl'), 'permission.requested').denials[0]!)
  const codex = permissionRequestDetail(firstEvent(parseFixture('codex', 'permission-request.jsonl'), 'permission.requested').denials[0]!)
  const cursor = permissionRequestDetail(firstEvent(parseFixture('cursor', 'permission-request.jsonl'), 'permission.requested').denials[0]!)
  const claudeDenials = firstEvent(parseFixture('claude', 'mcp-web-approval.jsonl'), 'permission.requested').denials
  const claudeMcp = permissionRequestDetail(claudeDenials[0]!)
  const claudeWeb = permissionRequestDetail(claudeDenials[1]!)

  assert.equal(copilot.kind, 'command')
  assert.equal(copilot.fields.find((field) => field.label === 'Command')?.value, 'git push')
  assert.equal(codex.kind, 'command')
  assert.equal(codex.fields.find((field) => field.label === 'Command')?.value, 'npm install')
  assert.equal(cursor.kind, 'file')
  assert.equal(cursor.fields.find((field) => field.label === 'Path')?.value, 'src/index.ts')
  assert.equal(claudeMcp.kind, 'mcp')
  assert.equal(claudeMcp.fields.find((field) => field.label === 'Server')?.value, 'linear')
  assert.equal(claudeWeb.kind, 'network')
  assert.equal(claudeWeb.fields.find((field) => field.label === 'URL')?.value, 'https://example.com')
})

test('codex app-server protocol messages normalize approval and question semantics', () => {
  const events = parseFixture('codex', 'app-server-approval-question.jsonl')
  const permission = firstEvent(events, 'permission.requested')
  const questions = events.filter((event): event is Extract<RunEvent, { type: 'user_input.requested' }> => event.type === 'user_input.requested')

  assert.equal(firstEvent(events, 'session.started').providerSessionId, 'codex-app-thread-123')
  assert.equal(firstEvent(events, 'assistant.text').content, 'I need one approval and one answer.')
  assert.equal(permission.denials[0]?.tool_name, 'shell')
  assert.equal(permission.denials[0]?.tool_use_id, 'approval-cmd-1')
  assert.equal(permission.denials[0]?.tool_input.command, 'touch codex_p8_should_not_exist.txt')
  assert.equal(permission.denials[0]?.tool_input.cwd, '/private/tmp/orchestrator-codex-p8')
  assert.equal(questions[0]?.content, 'Pick a deployment target')
  assert.equal(questions[0]?.questions?.[0]?.options?.[1]?.label, 'production')
  assert.equal(questions[0]?.questions?.[0]?.isOther, false)
  assert.equal(questions[0]?.questions?.[0]?.isSecret, false)
  assert.equal(questions[1]?.content, 'Confirm the deploy window')
  assert.equal(questions[1]?.questions?.[0]?.header, 'deploy')
})

test('codex app-server user input preserves other and secret metadata', () => {
  const provider = PROVIDERS.codex
  const events = provider.parseOutputLine(JSON.stringify({
    jsonrpc: '2.0',
    id: 'question-secret',
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'codex-app-thread-123',
      turnId: 'turn-1',
      itemId: 'question-secret',
      questions: [{
        id: 'deploy-token',
        header: 'Secret',
        question: 'Provide deploy token',
        isOther: true,
        isSecret: true
      }]
    }
  }))
  const question = firstEvent(events, 'user_input.requested').questions?.[0]

  assert.equal(question?.id, 'deploy-token')
  assert.equal(question?.isOther, true)
  assert.equal(question?.isSecret, true)
})

test('codex app-server protocol messages normalize file and permission profile approvals', () => {
  const provider = PROVIDERS.codex
  const events = [
    ...provider.parseOutputLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 'file-approval-1',
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'codex-app-thread-file-profile',
        turnId: 'turn-1',
        itemId: 'item-file-1',
        reason: 'Need write access for generated files.',
        grantRoot: '/private/tmp/orchestrator-codex-generated'
      }
    })),
    ...provider.parseOutputLine(JSON.stringify({
      jsonrpc: '2.0',
      id: 'profile-approval-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'codex-app-thread-file-profile',
        turnId: 'turn-1',
        itemId: 'item-profile-1',
        cwd: '/private/tmp/orchestrator-codex-generated',
        reason: 'Need temporary network access.',
        permissions: {
          fileSystem: {
            entries: [{
              access: 'write',
              path: { type: 'path', path: '/private/tmp/orchestrator-codex-generated' }
            }]
          },
          network: { enabled: true }
        }
      }
    }))
  ]

  const approvals = events.filter((event): event is Extract<RunEvent, { type: 'permission.requested' }> => event.type === 'permission.requested')
  assert.equal(approvals.length, 2)

  const file = permissionRequestDetail(approvals[0]!.denials[0]!)
  assert.equal(file.kind, 'file')
  assert.equal(file.title, 'File Approval')
  assert.equal(file.fields.find((field) => field.label === 'Root')?.value, '/private/tmp/orchestrator-codex-generated')
  assert.equal(file.fields.find((field) => field.label === 'Reason')?.value, 'Need write access for generated files.')

  const profile = permissionRequestDetail(approvals[1]!.denials[0]!)
  assert.equal(profile.kind, 'profile')
  assert.equal(profile.title, 'Permission Profile')
  assert.equal(profile.fields.find((field) => field.label === 'Filesystem')?.value, 'write /private/tmp/orchestrator-codex-generated')
  assert.equal(profile.fields.find((field) => field.label === 'Network')?.value, 'enabled')
  assert.equal(profile.fields.find((field) => field.label === 'Working dir')?.value, '/private/tmp/orchestrator-codex-generated')
})

test('codex app-server protocol messages normalize plan, goal, and subagent semantics', () => {
  const lines = [
    {
      jsonrpc: '2.0',
      method: 'turn/plan/updated',
      params: {
        threadId: 'codex-thread-rich',
        turnId: 'turn-1',
        explanation: 'I will do this in two steps.',
        plan: [
          { step: 'Inspect the repo', status: 'completed' },
          { step: 'Patch the runtime', status: 'inProgress' }
        ]
      }
    },
    {
      jsonrpc: '2.0',
      method: 'thread/goal/updated',
      params: {
        threadId: 'codex-thread-rich',
        turnId: 'turn-1',
        goal: {
          threadId: 'codex-thread-rich',
          objective: 'Finish the app-server integration',
          status: 'active',
          tokenBudget: 100000,
          tokensUsed: 1234,
          timeUsedSeconds: 42,
          createdAt: 1,
          updatedAt: 2
        }
      }
    },
    {
      jsonrpc: '2.0',
      method: 'item/started',
      params: {
        threadId: 'codex-thread-rich',
        turnId: 'turn-1',
        item: {
          type: 'collabAgentToolCall',
          id: 'agent-call-1',
          tool: { type: 'spawn_agent' },
          status: 'inProgress',
          senderThreadId: 'codex-thread-rich',
          receiverThreadIds: ['child-thread-1'],
          prompt: 'Inspect provider wiring',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          agentsStates: {}
        }
      }
    },
    {
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-rich',
        turnId: 'turn-1',
        item: {
          type: 'collabAgentToolCall',
          id: 'agent-call-1',
          tool: { type: 'spawn_agent' },
          status: 'completed',
          senderThreadId: 'codex-thread-rich',
          receiverThreadIds: ['child-thread-1'],
          prompt: 'Inspect provider wiring',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          agentsStates: {}
        }
      }
    }
  ]
  const events = lines.flatMap((line) => PROVIDERS.codex.parseOutputLine(JSON.stringify(line)))
  const plan = firstEvent(events, 'plan.updated')
  const goal = firstEvent(events, 'goal.updated')
  const started = firstEvent(events, 'agent.started')
  const completed = firstEvent(events, 'agent.completed')

  assert.equal(plan.plan.providerId, 'codex')
  assert.equal(plan.plan.items[1]?.status, 'in_progress')
  assert.equal(goal.goal.objective, 'Finish the app-server integration')
  assert.equal(goal.goal.tokensUsed, 1234)
  assert.equal(started.agent.id, 'agent-call-1')
  assert.equal(started.agent.status, 'running')
  assert.equal(started.agent.providerItemId, 'agent-call-1')
  assert.equal(started.agent.providerThreadId, 'child-thread-1')
  assert.deepEqual(started.agent.receiverThreadIds, ['child-thread-1'])
  assert.equal(started.agent.parentThreadId, 'codex-thread-rich')
  assert.equal(started.agent.providerTurnId, 'turn-1')
  assert.equal(started.agent.reasoningEffort, 'high')
  assert.equal(started.agent.source, 'provider-thread')
  assert.equal(completed.agent.id, 'agent-call-1')
  assert.equal(completed.agent.status, 'completed')

  const graph = deriveAgentThreadGraph({
    id: 'session-under-test',
    provider: 'codex',
    providerSessionId: 'codex-thread-rich',
    messages: []
  }, records(events))
  assert.equal(graph.rootProviderThreadId, 'codex-thread-rich')
  assert.equal(graph.threads[0]?.id, 'agent-call-1')
  assert.equal(graph.threads[0]?.identity.providerItemId, 'agent-call-1')
  assert.equal(graph.threads[0]?.identity.providerThreadId, 'child-thread-1')
  assert.equal(graph.threads[0]?.membership.parentThreadId, 'codex-thread-rich')
  assert.equal(graph.threads[0]?.progress.reasoningEffort, 'high')
  assert.equal(graph.threads[0]?.transcript.kind, 'provider-thread')
  assert.equal(graph.threads[0]?.capabilities.openProviderThread.status, 'available')
})

test('codex app-server protocol messages normalize lifecycle, review, diff, and rich item semantics', () => {
  const lines = [
    { jsonrpc: '2.0', method: 'thread/status/changed', params: { threadId: 'codex-thread-rich', status: 'running' } },
    { jsonrpc: '2.0', method: 'turn/started', params: { threadId: 'codex-thread-rich', turn: { id: 'turn-1', status: 'running' } } },
    { jsonrpc: '2.0', method: 'hook/started', params: { threadId: 'codex-thread-rich', turnId: 'turn-1', name: 'preToolUse' } },
    { jsonrpc: '2.0', method: 'hook/completed', params: { threadId: 'codex-thread-rich', turnId: 'turn-1', name: 'preToolUse' } },
    { jsonrpc: '2.0', method: 'turn/diff/updated', params: { threadId: 'codex-thread-rich', turnId: 'turn-1', diff: 'diff --git a/a b/a' } },
    { jsonrpc: '2.0', method: 'item/autoApprovalReview/started', params: { threadId: 'codex-thread-rich', turnId: 'turn-1', reviewId: 'review-1' } },
    { jsonrpc: '2.0', method: 'item/autoApprovalReview/completed', params: { threadId: 'codex-thread-rich', turnId: 'turn-1', reviewId: 'review-1', action: { type: 'approve' } } },
    { jsonrpc: '2.0', method: 'item/started', params: { item: { type: 'webSearch', id: 'web-1', query: 'codex app server', action: null } } },
    { jsonrpc: '2.0', method: 'item/completed', params: { item: { type: 'webSearch', id: 'web-1', query: 'codex app server', action: { type: 'search' } } } },
    { jsonrpc: '2.0', method: 'item/completed', params: { item: { type: 'imageGeneration', id: 'img-1', status: 'completed', revisedPrompt: 'a diagram', result: 'ok', savedPath: '/tmp/image.png' } } },
    { jsonrpc: '2.0', method: 'item/completed', params: { threadId: 'codex-thread-rich', item: { type: 'enteredReviewMode', id: 'review-mode-1', review: 'Review current diff' } } },
    { jsonrpc: '2.0', method: 'item/completed', params: { item: { type: 'contextCompaction', id: 'compact-1' } } },
    { jsonrpc: '2.0', method: 'command/exec/outputDelta', params: { callId: 'cmd-1', delta: 'stdout chunk' } },
    { jsonrpc: '2.0', method: 'item/reasoning/summaryTextDelta', params: { itemId: 'reasoning-1', delta: 'thinking summary' } },
    { jsonrpc: '2.0', method: 'mcpServer/startupStatus/updated', params: { server: 'jira', status: 'ready' } },
    { jsonrpc: '2.0', method: 'warning', params: { threadId: 'codex-thread-rich', message: 'watch out' } },
    { jsonrpc: '2.0', method: 'thread/closed', params: { threadId: 'codex-thread-rich' } }
  ]
  const events = lines.flatMap((line) => PROVIDERS.codex.parseOutputLine(JSON.stringify(line)))
  const messages = eventsToMessages(events)

  const diffUpdated = firstEvent(events, 'diff.updated')
  const reviewMode = firstEvent(events, 'review.mode.changed')
  assert.equal(diffUpdated.providerSessionId, 'codex-thread-rich')
  assert.equal(diffUpdated.providerTurnId, 'turn-1')
  assert.equal(diffUpdated.checkpointId, undefined)
  assert.equal(diffUpdated.checkpointUndoSupported, false)
  assert.equal(reviewMode.active, true)
  assert.equal(reviewMode.sessionId, 'codex-thread-rich')
  assert.equal(reviewMode.review, 'Review current diff')
  assert.ok(events.some((event) => event.type === 'tool.started' && event.toolName === 'web_search'))
  assert.ok(events.some((event) => event.type === 'tool.completed' && event.toolUseId === 'img-1'))
  assert.ok(events.some((event) => event.type === 'assistant.text.delta' && event.content === 'stdout chunk'))
  assert.ok(events.some((event) => event.type === 'assistant.text.delta' && event.content === 'thinking summary'))
  assert.ok(messages.some((message) => 'content' in message && message.content.includes('Diff updated')))
  assert.ok(messages.some((message) => 'content' in message && message.content.includes('Auto-review completed')))
  assert.ok(messages.some((message) => 'content' in message && message.content.includes('Review mode: active')))
  assert.ok(messages.some((message) => 'content' in message && message.content.includes('watch out')))
  assert.ok(messages.some((message) => 'content' in message && message.content.includes('Thread closed')))
})

test('codex app-server diff updates preserve provider turn and checkpoint metadata without claiming restore support', () => {
  const events = PROVIDERS.codex.parseOutputLine(JSON.stringify({
    jsonrpc: '2.0',
    method: 'turn/diff/updated',
    params: {
      threadId: 'codex-thread-checkpoint',
      turnId: 'turn-checkpoint-1',
      checkpoint: { id: 'checkpoint-1' },
      diff: 'diff --git a/a b/a'
    }
  }))
  const diffUpdated = firstEvent(events, 'diff.updated')

  assert.equal(diffUpdated.providerSessionId, 'codex-thread-checkpoint')
  assert.equal(diffUpdated.providerTurnId, 'turn-checkpoint-1')
  assert.equal(diffUpdated.checkpointId, 'checkpoint-1')
  assert.equal(diffUpdated.checkpointUndoSupported, false)
})

test('codex app-server browser-use notifications normalize to Browser manager state events', () => {
  const lines = [
    {
      jsonrpc: '2.0',
      method: 'browser-sidebar-browser-use-state',
      params: { conversationId: 'codex-thread-browser', isActive: true, turnId: 'turn-browser-1' }
    },
    {
      jsonrpc: '2.0',
      method: 'browser-sidebar-browser-use-viewport',
      params: { conversationId: 'codex-thread-browser', viewportSize: { width: 390.4, height: 843.6 } }
    },
    {
      jsonrpc: '2.0',
      method: 'browser-sidebar-browser-use-capture-surface',
      params: {
        conversationId: 'codex-thread-browser',
        surfaceSize: { width: 800, height: 600 },
        bounds: { x: 12, y: 34, width: 800, height: 600, scale: 0.75 }
      }
    },
    {
      jsonrpc: '2.0',
      method: 'browser-sidebar-browser-use-cursor-state',
      params: { conversationId: 'codex-thread-browser', visible: true, x: 48, y: 64, animateMovement: true, moveSequence: 3 }
    },
    {
      jsonrpc: '2.0',
      method: 'browser-sidebar-local-servers',
      params: {
        conversationId: 'codex-thread-browser',
        state: {
          servers: [{
            url: 'http://127.0.0.1:5173/',
            routes: [
              { url: 'http://127.0.0.1:5173/', title: 'Home' },
              { url: 'http://127.0.0.1:5173/dashboard', title: 'Dashboard' }
            ]
          }],
          hiddenServers: [{
            url: 'http://127.0.0.1:5173/',
            routes: [{ url: 'http://127.0.0.1:5173/hidden' }]
          }]
        }
      }
    },
    {
      jsonrpc: '2.0',
      method: 'browser-sidebar-browser-use-state',
      params: { conversationId: 'codex-thread-browser', isActive: false, turnId: 'turn-browser-1' }
    }
  ]
  const events = lines.flatMap((line) => PROVIDERS.codex.parseOutputLine(JSON.stringify(line)))
  const browserEvents = events.filter((event): event is Extract<RunEvent, { type: 'browser.manager_state' }> => event.type === 'browser.manager_state')

  assert.equal(browserEvents.length, 6)
  assert.deepEqual(browserEvents[0], {
    type: 'browser.manager_state',
    open: undefined,
    active: true,
    turnId: 'turn-browser-1'
  })
  assert.deepEqual(browserEvents[1], {
    type: 'browser.manager_state',
    open: undefined,
    viewportSize: { width: 390.4, height: 843.6 }
  })
  assert.deepEqual(browserEvents[2], {
    type: 'browser.manager_state',
    open: undefined,
    captureSurfaceSize: { width: 800, height: 600 },
    captureBounds: { x: 12, y: 34, width: 800, height: 600, scale: 0.75 }
  })
  assert.deepEqual(browserEvents[3], {
    type: 'browser.manager_state',
    open: undefined,
    cursorState: { visible: true, x: 48, y: 64, animateMovement: true, moveSequence: 3 }
  })
  assert.deepEqual(browserEvents[4], {
    type: 'browser.manager_state',
    open: undefined,
    localServerRoutes: [
      { serverUrl: 'http://127.0.0.1:5173/', url: 'http://127.0.0.1:5173/', title: 'Home', source: 'provider' },
      { serverUrl: 'http://127.0.0.1:5173/', url: 'http://127.0.0.1:5173/dashboard', title: 'Dashboard', source: 'provider' }
    ],
    hiddenLocalServerRoutes: ['http://127.0.0.1:5173/hidden']
  })
  assert.deepEqual(browserEvents[5], {
    type: 'browser.manager_state',
    open: false,
    active: false,
    turnId: 'turn-browser-1'
  })
})

test('codex app-server legacy approval requests normalize to Orchestrator permissions', () => {
  const lines = [
    {
      jsonrpc: '2.0',
      id: 'exec-approval',
      method: 'execCommandApproval',
      params: {
        conversationId: 'codex-thread-rich',
        callId: 'cmd-legacy',
        approvalId: 'approval-legacy',
        command: ['git', 'status'],
        cwd: '/tmp/project',
        reason: 'Need status',
        parsedCmd: []
      }
    },
    {
      jsonrpc: '2.0',
      id: 'patch-approval',
      method: 'applyPatchApproval',
      params: {
        conversationId: 'codex-thread-rich',
        callId: 'patch-legacy',
        fileChanges: { 'a.txt': { type: 'add' } },
        reason: 'Need patch',
        grantRoot: '/tmp/project'
      }
    }
  ]
  const events = lines.flatMap((line) => PROVIDERS.codex.parseOutputLine(JSON.stringify(line)))
  const permissions = events.filter((event): event is Extract<RunEvent, { type: 'permission.requested' }> => event.type === 'permission.requested')

  assert.equal(permissions[0]?.denials[0]?.tool_name, 'shell')
  assert.equal(permissions[0]?.denials[0]?.tool_input.command, 'git status')
  assert.equal(permissions[1]?.denials[0]?.tool_name, 'apply_patch')
  assert.equal(permissions[1]?.denials[0]?.tool_input.grantRoot, '/tmp/project')
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
  const command = PROVIDERS.copilot.buildStartCommand!(request({ model: 'gpt-5.5' }))

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
      data: {
        id: 'agent-1',
        name: 'Research',
        role: 'explore repo',
        model: 'gpt-5.5',
        threadId: 'copilot-cloud-thread-1',
        parentThreadId: 'copilot-session-123',
        turnId: 'copilot-turn-1'
      }
    })),
    PROVIDERS.copilot.parseOutputLine(JSON.stringify({
      type: 'subagent.completed',
      sessionId: 'copilot-session-123',
      data: {
        id: 'agent-1',
        name: 'Research',
        threadId: 'copilot-cloud-thread-1',
        parentThreadId: 'copilot-session-123',
        summary: 'Found the parser path.'
      }
    }))
  ].flat()
  const started = firstEvent(events, 'agent.started')
  const completed = firstEvent(events, 'agent.completed')

  assert.equal(started.agent.id, 'agent-1')
  assert.equal(started.agent.providerId, 'copilot')
  assert.equal(started.agent.sessionId, 'copilot-session-123')
  assert.equal(started.agent.providerThreadId, 'copilot-cloud-thread-1')
  assert.equal(started.agent.parentThreadId, 'copilot-session-123')
  assert.equal(started.agent.providerTurnId, 'copilot-turn-1')
  assert.equal(started.agent.source, 'provider-thread')
  assert.equal(started.agent.status, 'running')
  assert.equal(completed.agent.status, 'completed')
  assert.equal(completed.agent.summary, 'Found the parser path.')

  const graph = deriveAgentThreadGraph({
    id: 'session-under-test',
    provider: 'copilot',
    providerSessionId: 'copilot-session-123',
    messages: []
  }, records(events))
  assert.equal(graph.threads[0]?.identity.providerThreadId, 'copilot-cloud-thread-1')
  assert.equal(graph.threads[0]?.transcript.kind, 'provider-thread')
  assert.equal(graph.threads[0]?.evidence.source, 'provider-thread')
  assert.equal(AGENT_THREAD_ADAPTER_CONTRACTS.copilot?.supportedActions.openProviderThread, 'planned')
  assert.equal(AGENT_THREAD_ADAPTER_CONTRACTS.antigravity?.runtimeKinds.includes('python-sdk'), true)
})

test('antigravity fixture normalizes conversation and agent thread identity', () => {
  const events = parseFixture('antigravity', 'tool-flow.jsonl')
  const assistant = firstEvent(events, 'assistant.text.delta')
  const toolStarted = firstEvent(events, 'tool.started')
  const toolCompleted = firstEvent(events, 'tool.completed')
  const started = firstEvent(events, 'agent.started')
  const completed = firstEvent(events, 'agent.completed')
  const session = firstEvent(events, 'session.started')
  const runCompleted = firstEvent(events, 'run.completed')

  assert.equal(assistant.content, 'I will inspect the workspace.')
  assert.equal(toolStarted.toolName, 'list_directory')
  assert.equal(toolCompleted.toolUseId, 'tool-1')
  assert.equal(started.agent.providerId, 'antigravity')
  assert.equal(started.agent.sessionId, 'sdk-conversation-123')
  assert.equal(started.agent.providerThreadId, 'sdk-thread-1')
  assert.equal(started.agent.parentThreadId, 'sdk-conversation-123')
  assert.equal(started.agent.providerTurnId, 'sdk-turn-1')
  assert.equal(started.agent.source, 'provider-thread')
  assert.equal(completed.agent.summary, 'Found the provider adapter.')
  assert.equal(session.providerSessionId, 'sdk-conversation-123')
  assert.equal(runCompleted.usage?.totalTokens, 20)

  const graph = deriveAgentThreadGraph({
    id: 'session-under-test',
    provider: 'antigravity',
    providerSessionId: 'sdk-conversation-123',
    messages: []
  }, records(events))
  assert.equal(graph.threads[0]?.identity.providerThreadId, 'sdk-thread-1')
  assert.equal(graph.threads[0]?.transcript.kind, 'provider-thread')
  assert.equal(graph.threads[0]?.evidence.source, 'provider-thread')
  assert.equal(graph.threads[0]?.capabilities.open.status, 'available')
  assert.equal(graph.threads[0]?.capabilities.openProviderThread.status, 'planned')
})

test('codex approval modes map to native approval policy config', () => {
  const askCommand = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'default' })
  )
  assert.equal(askCommand.args.includes('--sandbox'), true)
  assert.equal(askCommand.args[askCommand.args.indexOf('--sandbox') + 1], 'workspace-write')
  assert.equal(askCommand.args.includes('approval_policy="on-request"'), true)

  const untrustedCommand = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'untrusted' })
  )
  assert.equal(untrustedCommand.args.includes('approval_policy="untrusted"'), true)

  const neverCommand = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'never' })
  )
  assert.equal(neverCommand.args.includes('approval_policy="never"'), true)

  const autoReviewCommand = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'autoReview' })
  )
  assert.equal(autoReviewCommand.args.includes('approval_policy="on-request"'), true)
  assert.equal(autoReviewCommand.args.includes('approvals_reviewer="auto_review"'), true)

  const interactiveAutoReviewCommand = PROVIDERS.codex.buildInteractiveCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'autoReview' })
  )
  assert.equal(interactiveAutoReviewCommand.args.includes('--ask-for-approval'), true)
  assert.equal(interactiveAutoReviewCommand.args[interactiveAutoReviewCommand.args.indexOf('--ask-for-approval') + 1], 'on-request')
  assert.equal(interactiveAutoReviewCommand.args.includes('approvals_reviewer="auto_review"'), true)

  const fullAccessCommand = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'fullAccess' })
  )
  assert.equal(fullAccessCommand.args[fullAccessCommand.args.indexOf('--sandbox') + 1], 'danger-full-access')

  const yoloCommand = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'yolo' })
  )
  assert.equal(yoloCommand.args.includes('--dangerously-bypass-approvals-and-sandbox'), true)
  assert.deepEqual(codexRuntimePolicyConfig('autoReview'), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
    configSource: 'app-server'
  })
  assert.deepEqual(codexRuntimePolicyConfig('fullAccess'), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
    configSource: 'cli'
  })
})

test('codex permission runtime context maps app-server config requirements to visible policies', () => {
  const context = resolveProviderPermissionRuntimeContext('codex', {
    cwd: '/tmp/project',
    configResult: {
      providerId: 'codex',
      surfaceId: 'appserver-config',
      status: 'ok',
      output: JSON.stringify({
        config: {
          approval_policy: 'on-request',
          approvals_reviewer: 'auto_review',
          sandbox_mode: 'workspace-write'
        }
      })
    },
    requirementsResult: {
      providerId: 'codex',
      surfaceId: 'appserver-config-requirements',
      status: 'ok',
      output: JSON.stringify({
        requirements: {
          allowedApprovalPolicies: ['on-request', 'untrusted'],
          allowedSandboxModes: ['workspace-write']
        }
      })
    }
  })

  assert.equal(context.status, 'ok')
  assert.equal(context.source, 'app-server')
  assert.equal(context.defaultPolicy, 'autoReview')
  assert.deepEqual(context.effective, {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandboxMode: 'workspace-write',
    configSource: 'app-server'
  })
  assert.equal(context.visiblePolicies?.includes('fullAccess'), false)
  assert.equal(context.disabledPolicies?.fullAccess, 'Requires sandbox danger-full-access')
})

test('codex policy supports app-server approvals while exec stays config-driven', () => {
  const resolved = PROVIDERS.codex.resolveExecutionPolicy('default')
  const command = PROVIDERS.codex.buildStartCommand!(request({ executionPolicy: 'default' }))

  assert.equal(resolved.support, 'approximate')
  assert.match(resolved.warning ?? '', /app-server surfaces native approvals/)
  assert.equal(command.args.includes('--ask-for-approval'), false)
  assert.equal(command.args.includes('approval_policy="on-request"'), true)
  assert.equal(PROVIDERS.codex.capabilities.interactivePermissions, true)
  assert.equal(PROVIDERS.codex.binaryCandidates?.includes('/Applications/Codex.app/Contents/Resources/codex'), true)
})

test('unsupported execution policies fall back to provider defaults when launching', () => {
  const resolved = PROVIDERS.codex.resolveExecutionPolicy('allowEdits')
  const command = PROVIDERS.codex.buildStartCommand!(
    request({ model: 'gpt-5.4', executionPolicy: 'allowEdits' })
  )

  assert.equal(resolved.support, 'unsupported')
  assert.equal(command.args[command.args.indexOf('--sandbox') + 1], 'workspace-write')
})

test('codex resume preserves model, effort, sandbox, and session id', () => {
  const command = PROVIDERS.codex.buildResumeCommand!(request({
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

test('cursor default policy uses edit-capable sandbox mode', () => {
  const resolved = PROVIDERS.cursor.resolveExecutionPolicy('default')
  const command = PROVIDERS.cursor.buildStartCommand!(request({ model: 'auto' }))

  assert.equal(resolved.support, 'exact')
  assert.equal(resolved.intent, 'workspaceSandbox')
  assert.equal(command.args.includes('--print'), true)
  assert.equal(command.args[command.args.indexOf('--sandbox') + 1], 'enabled')
  assert.equal(command.args.includes('--force'), false)
  assert.equal(command.args.includes('--trust'), true)
  assert.equal(command.args[command.args.indexOf('--workspace') + 1], '/tmp/orchestrator-test')
})

test('cursor ask policy is explicitly read-only', () => {
  const resolved = PROVIDERS.cursor.resolveExecutionPolicy('ask')
  const command = PROVIDERS.cursor.buildStartCommand!(request({ model: 'auto', executionPolicy: 'ask' }))

  assert.equal(resolved.support, 'exact')
  assert.equal(resolved.intent, 'ask')
  assert.equal(command.args[command.args.indexOf('--mode') + 1], 'ask')
  assert.equal(command.args.includes('--force'), false)
})

test('cursor sandbox policy requests sandbox without forced all-tools mode', () => {
  const resolved = PROVIDERS.cursor.resolveExecutionPolicy('sandbox')
  const command = PROVIDERS.cursor.buildStartCommand!(request({ model: 'auto', executionPolicy: 'sandbox' }))

  assert.equal(resolved.support, 'exact')
  assert.deepEqual(command.args.slice(0, 3), ['--print', '--output-format', 'stream-json'])
  assert.equal(command.args.includes('--force'), false)
  assert.equal(command.args.includes('--trust'), true)
  assert.equal(command.args[command.args.indexOf('--sandbox') + 1], 'enabled')
})
