import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn as spawnPty } from 'node-pty'
import { liveSmokeEffort, liveSmokeModel } from './provider-smoke-config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const jsonlTailerModulePath = join(repoRoot, 'out-test/src/main/jsonlTailer.js')

const { PROVIDERS, buildProviderCommandForRuntime, resolveProviderCommand, providerSpawnEnv } = await import(providersModulePath)
const { claudeProjectDir, collectJsonlFiles, createJsonlTailer } = await import(jsonlTailerModulePath)

const provider = PROVIDERS.claude
const timeoutMs = Number(process.env.CLAUDE_CAPABILITY_TIMEOUT_MS ?? 120_000)
const artifactRoot = process.env.CLAUDE_CAPABILITY_ARTIFACT_DIR
  ? process.env.CLAUDE_CAPABILITY_ARTIFACT_DIR
  : join(repoRoot, 'tmp', 'claude-live-capabilities')
const selectedScenarioIds = (process.env.CLAUDE_CAPABILITY_SCENARIOS ?? 'plain,file_ops,plan_mode,streaming')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(artifactRoot, { recursive: true })
}

function safeJson(value) {
  return JSON.stringify(value, null, 2)
}

function writeArtifact(scenarioId, name, value) {
  const dir = join(artifactRoot, scenarioId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), typeof value === 'string' ? value : `${safeJson(value)}\n`)
}

function makeWorkspace(scenarioId) {
  const cwd = join(artifactRoot, '_workspaces', `orchestrator-claude-cap-${scenarioId}-${Date.now()}`)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(cwd, 'README.md'), `# ${scenarioId}\n\nDisposable Orchestrator Claude capability test workspace.\n`)
  return cwd
}

function makeRequest(cwd, prompt, patch = {}) {
  return {
    prompt,
    cwd,
    model: liveSmokeModel('claude'),
    effort: liveSmokeEffort('claude'),
    providerSessionId: null,
    executionPolicy: patch.executionPolicy ?? 'default',
    allowedTools: patch.allowedTools ?? [],
    disallowedTools: patch.disallowedTools ?? [],
    availableTools: patch.availableTools ?? [],
    additionalDirs: patch.additionalDirs ?? [],
    runtime: patch.runtime ?? 'headless'
  }
}

function summarizeEvents(events) {
  return [...new Set(events.map((event) => event.type))].join(', ') || 'none'
}

function assistantText(events) {
  return events
    .filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta')
    .map((event) => event.content)
    .join('')
}

function collectJsonlArtifacts(cwd) {
  const dir = claudeProjectDir(cwd)
  return collectJsonlFiles(dir).map((file) => ({
    file,
    name: basename(file),
    size: statSync(file).size,
    lines: readFileSync(file, 'utf8').split('\n').filter(Boolean)
  }))
}

function parseJsonlLines(artifacts) {
  const events = []
  for (const artifact of artifacts) {
    for (const line of artifact.lines) {
      events.push(...provider.parseOutputLine(line))
    }
  }
  return events
}

function commandForLiveScenario(command, prompt) {
  if (process.env.CLAUDE_CAPABILITY_STRICT_EMPTY_MCP !== '1') return command
  if (!prompt) return command
  const promptIndex = command.args.lastIndexOf(prompt)
  const insertionIndex = promptIndex >= 0 ? promptIndex : command.args.length
  const args = [...command.args]
  args.splice(insertionIndex, 0, '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config={"mcpServers":{}}')
  return { ...command, args }
}

async function runStructuredScenario(scenario) {
  const cwd = makeWorkspace(scenario.id)
  scenario.setup?.(cwd)
  const request = makeRequest(cwd, scenario.prompt, scenario.request)
  const resolvedCommand = resolveProviderCommand(provider, buildProviderCommandForRuntime(provider, request))
  if (!resolvedCommand) return { id: scenario.id, ok: false, reason: 'missing claude binary', events: [], cwd }
  const command = commandForLiveScenario(resolvedCommand, request.prompt)

  const events = []
  let raw = ''
  let stdoutLineBuffer = ''
  let finished = false
  const tailer = createJsonlTailer(claudeProjectDir(cwd), (line) => {
    events.push(...provider.parseOutputLine(line))
  }, { intervalMs: 250 })

  const pty = spawnPty(command.binary, command.args, {
    name: 'xterm-color',
    cwd,
    env: providerSpawnEnv('claude'),
    cols: 180,
    rows: 50
  })
  tailer.start()

  return await new Promise((resolve) => {
    const timer = setTimeout(() => finish('timed out'), timeoutMs)

    function finish(reason) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      tailer.poll()
      tailer.stop()
      try { pty.kill() } catch { /* already exited */ }

      const jsonl = collectJsonlArtifacts(cwd)
      const parsedJsonlEvents = parseJsonlLines(jsonl)
      const allEvents = [...parsedJsonlEvents, ...events]
      const text = assistantText(allEvents)
      const assertions = scenario.assert?.({ cwd, events: allEvents, raw, text }) ?? []
      const failures = assertions.filter((assertion) => !assertion.ok)
      const ok = failures.length === 0
      const result = {
        id: scenario.id,
        ok,
        reason: ok ? 'passed' : failures.map((failure) => failure.message).join('; ') || reason,
        events: allEvents,
        eventTypes: [...new Set(allEvents.map((event) => event.type))],
        assistantText: text,
        rawPreview: raw.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim().slice(-1200),
        jsonlFiles: jsonl.map((artifact) => ({ name: artifact.name, size: artifact.size, lines: artifact.lines.length })),
        workspace: scenario.captureWorkspace?.(cwd) ?? {}
      }
      writeArtifact(scenario.id, 'result.json', result)
      writeArtifact(scenario.id, 'terminal.txt', raw)
      for (const artifact of jsonl) writeArtifact(scenario.id, artifact.name, artifact.lines.join('\n'))
      rmSync(cwd, { recursive: true, force: true })
      resolve(result)
    }

    pty.onData((data) => {
      raw += data
      stdoutLineBuffer += data
      const lines = stdoutLineBuffer.split('\n')
      stdoutLineBuffer = lines.pop() ?? ''
      for (const line of lines) events.push(...provider.parseOutputLine(line))
      if (scenario.finishWhen?.({ raw, events, cwd })) {
        finish('scenario finish condition met')
      }
    })
    pty.onExit(() => finish('pty exited'))
  })
}

function exists(path) {
  return existsSync(path)
}

function fileText(path) {
  return exists(path) ? readFileSync(path, 'utf8') : ''
}

const scenarios = [
  {
    id: 'plain',
    prompt: 'Reply with exactly: ORCHESTRATOR_CAPABILITY_PLAIN_OK',
    assert: ({ text }) => [
      { ok: text.includes('ORCHESTRATOR_CAPABILITY_PLAIN_OK'), message: 'plain assistant response was not captured' }
    ]
  },
  {
    id: 'file_ops',
    request: { executionPolicy: 'acceptEdits' },
    setup(cwd) {
      writeFileSync(join(cwd, 'delete-me.txt'), 'delete me\n')
    },
    prompt: [
      'This is a disposable test repository.',
      'Create a file named created-by-claude.txt with exactly two lines: ORCHESTRATOR_FILE_CREATE_OK and ORCHESTRATOR_FILE_APPEND_OK.',
      'Delete delete-me.txt.',
      'When done, reply with exactly ORCHESTRATOR_FILE_OPS_OK.'
    ].join(' '),
    captureWorkspace(cwd) {
      return {
        createdExists: exists(join(cwd, 'created-by-claude.txt')),
        createdText: fileText(join(cwd, 'created-by-claude.txt')),
        deleteMeExists: exists(join(cwd, 'delete-me.txt')),
        entries: readdirSync(cwd).sort()
      }
    },
    assert: ({ cwd, text }) => [
      { ok: exists(join(cwd, 'created-by-claude.txt')), message: 'created file is missing' },
      { ok: fileText(join(cwd, 'created-by-claude.txt')).includes('ORCHESTRATOR_FILE_CREATE_OK'), message: 'created file content missing create marker' },
      { ok: fileText(join(cwd, 'created-by-claude.txt')).includes('ORCHESTRATOR_FILE_APPEND_OK'), message: 'created file content missing append marker' },
      { ok: !exists(join(cwd, 'delete-me.txt')), message: 'delete-me.txt was not deleted' },
      { ok: /O?RCHESTRATOR_FILE_OPS_OK/.test(text), message: 'file ops assistant completion was not captured' }
    ]
  },
  {
    id: 'plan_mode',
    request: { executionPolicy: 'plan' },
    prompt: 'Make a short plan for adding a README badge. Do not edit files. Reply with ORCHESTRATOR_PLAN_MODE_OK when the plan is ready.',
    assert: ({ raw, text, events }) => [
      { ok: /plan/i.test(raw) || events.some((event) => event.type === 'plan.updated'), message: 'plan mode signal was not observed' },
      { ok: text.includes('ORCHESTRATOR_PLAN_MODE_OK') || text.includes('Plan updated in Claude Code'), message: 'plan mode assistant completion was not captured' }
    ]
  },
  {
    id: 'streaming',
    prompt: [
      'Reply with eight short lines.',
      'The first line must be ORCHESTRATOR_STREAMING_OK.',
      'Use numbered lines 1 through 8 and no markdown table.'
    ].join(' '),
    assert: ({ text, events }) => [
      { ok: text.includes('ORCHESTRATOR_STREAMING_OK'), message: 'streaming assistant response was not captured' },
      { ok: events.some((event) => event.type === 'assistant.text.delta'), message: 'structured assistant deltas were not emitted' },
      { ok: events.some((event) => event.type === 'assistant.text.completed' || event.type === 'assistant.text'), message: 'structured assistant completion was not emitted' }
    ]
  }
]

function runNoQuotaProbe(id, args) {
  try {
    const output = execFileSync('claude', args, {
      cwd: repoRoot,
      env: providerSpawnEnv('claude'),
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    })
    return { id, ok: true, args, output: output.trim().slice(0, 4000) }
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr : error.stderr?.toString('utf8') ?? ''
    const stdout = typeof error.stdout === 'string' ? error.stdout : error.stdout?.toString('utf8') ?? ''
    return { id, ok: false, args, output: (stderr || stdout || error.message || '').trim().slice(0, 4000) }
  }
}

function parseProbeJson(probe) {
  try {
    return JSON.parse(probe.output)
  } catch {
    return null
  }
}

function shouldSkipStructuredScenarios(probes) {
  const authProbe = probes.find((probe) => probe.id === 'auth-status')
  if (!authProbe) return null
  const authStatus = parseProbeJson(authProbe)
  if (authStatus?.loggedIn === false) {
    return 'Claude CLI is installed but not authenticated.'
  }
  if (!authProbe.ok && /not logged in|not authenticated|login|loggedIn.+false/i.test(authProbe.output)) {
    return 'Claude CLI is installed but not authenticated.'
  }
  const authFailureProbe = probes.find((probe) =>
    /authentication_error|invalid authentication credentials|failed to authenticate/i.test(probe.output)
  )
  if (authFailureProbe) {
    return `Claude CLI authentication failed during ${authFailureProbe.id}.`
  }
  return null
}

function summarizeProbes(probes) {
  return probes.map((probe) => ({
    id: probe.id,
    ok: probe.ok,
    args: probe.args,
    outputPreview: probe.output.split('\n').slice(0, 8)
  }))
}

resetArtifacts()

console.log('Running live Claude capability suite. Structured scenarios may use Claude quota.')
console.log(`  model=${liveSmokeModel('claude')} effort=${liveSmokeEffort('claude')}`)
console.log(`  scenarios=${selectedScenarioIds.join(', ')}`)
console.log(`  artifacts=${artifactRoot}`)
console.log('')

const probes = [
  runNoQuotaProbe('version', ['--version']),
  runNoQuotaProbe('auth-status', ['auth', 'status']),
  runNoQuotaProbe('mcp-list', ['mcp', 'list']),
  runNoQuotaProbe('plugin-list-json', ['plugin', 'list', '--json']),
  runNoQuotaProbe('auto-mode-defaults', ['auto-mode', 'defaults']),
  runNoQuotaProbe('agents-list', ['agents'])
]

for (const probe of probes) {
  console.log(`${probe.ok ? 'PASS' : 'FAIL'} probe ${probe.id}`)
  if (!probe.ok) console.log(`  ${probe.output.split('\n')[0] ?? ''}`)
}

const structuredSkipReason = shouldSkipStructuredScenarios(probes)
if (structuredSkipReason) {
  console.log('')
  console.log(`SKIP structured scenarios: ${structuredSkipReason}`)
  const summary = {
    generatedAt: new Date().toISOString(),
    status: 'unavailable',
    reason: structuredSkipReason,
    scenarios: selectedScenarioIds.map((id) => ({ id, ok: false, reason: structuredSkipReason, skipped: true })),
    probes: summarizeProbes(probes)
  }
  writeArtifact('_summary', 'summary.json', summary)
  process.exit(1)
}

console.log('')

const selectedScenarios = scenarios.filter((scenario) => selectedScenarioIds.includes(scenario.id))
const scenarioResults = []
for (const scenario of selectedScenarios) {
  const result = await runStructuredScenario(scenario)
  scenarioResults.push(result)
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.id}: ${result.reason}`)
  console.log(`  events: ${summarizeEvents(result.events)}`)
  if (result.assistantText) console.log(`  assistant: ${result.assistantText.slice(0, 180)}`)
}

const summary = {
  generatedAt: new Date().toISOString(),
  status: 'complete',
  scenarios: scenarioResults.map((result) => ({
    id: result.id,
    ok: result.ok,
    reason: result.reason,
    eventTypes: result.eventTypes,
    jsonlFiles: result.jsonlFiles,
    workspace: result.workspace
  })),
  probes: summarizeProbes(probes)
}
writeArtifact('_summary', 'summary.json', summary)

const failures = [...scenarioResults.filter((result) => !result.ok), ...probes.filter((probe) => !probe.ok)]
if (failures.length > 0) process.exit(1)
