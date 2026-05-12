import { spawn as spawnChild } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn as spawnPty } from 'node-pty'
import { liveSmokeEffort, liveSmokeModel } from './provider-smoke-config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const jsonlTailerModulePath = join(repoRoot, 'out-test/src/main/jsonlTailer.js')
const nativePromptsModulePath = join(repoRoot, 'out-test/src/types/nativeCliPrompts.js')
const nativeTerminalControlModulePath = join(repoRoot, 'out-test/src/types/nativeTerminalControl.js')
const nativeTerminalModulePath = join(repoRoot, 'out-test/src/types/nativeTerminalEvents.js')
const { PROVIDERS, buildProviderCommandForRuntime, resolveProviderCommand, providerSpawnEnv } = await import(providersModulePath)
const { claudeProjectDir, createJsonlTailer } = await import(jsonlTailerModulePath)
const { detectNativeCliPrompt, nativeCliPromptSubmitSequence } = await import(nativePromptsModulePath)
const { nativeTerminalControlResponses } = await import(nativeTerminalControlModulePath)
const { parseClaudeTerminalSnapshot } = await import(nativeTerminalModulePath)

const expectedAssistantText = 'ORCHESTRATOR_RUNTIME_PARITY_OK'
const timeoutMs = Number(process.env.CLAUDE_RUNTIME_PARITY_TIMEOUT_MS ?? 90_000)
const provider = PROVIDERS.claude
const selectedLanes = (process.env.CLAUDE_RUNTIME_PARITY_LANES ?? 'headless,interactive')
  .split(',')
  .map((lane) => lane.trim())
  .filter(Boolean)
const autoTrust = process.env.CLAUDE_RUNTIME_PARITY_AUTO_TRUST !== '0'

function makeWorkspace(lane) {
  const cwd = mkdtempSync(join(tmpdir(), `orchestrator-claude-${lane}-`))
  writeFileSync(join(cwd, 'SMOKE.md'), 'Safe Orchestrator runtime parity workspace. Do not edit files.\n')
  return cwd
}

function makeRequest(cwd, runtime) {
  return {
    prompt: [
      'You are running a tiny Orchestrator Claude runtime parity smoke test.',
      'Do not edit files.',
      'Do not run shell commands.',
      `Reply with exactly: ${expectedAssistantText}`
    ].join(' '),
    cwd,
    model: liveSmokeModel('claude'),
    effort: liveSmokeEffort('claude'),
    providerSessionId: null,
    executionPolicy: 'default',
    allowedTools: [],
    disallowedTools: [],
    availableTools: [],
    additionalDirs: [],
    runtime
  }
}

function commandForLiveScenario(command, prompt) {
  if (process.env.CLAUDE_RUNTIME_PARITY_STRICT_EMPTY_MCP !== '1') return command
  if (!prompt) return command
  const promptIndex = command.args.lastIndexOf(prompt)
  const insertionIndex = promptIndex >= 0 ? promptIndex : command.args.length
  const args = [...command.args]
  args.splice(insertionIndex, 0, '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config={"mcpServers":{}}')
  return { ...command, args }
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

function answerTerminalCapabilityRequests(pty, data) {
  for (const response of nativeTerminalControlResponses(data)) pty.write(response)
}

function resultFor(lane, events, stdout = '', stderr = '') {
  const text = assistantText(events)
  const hasCompletion = events.some((event) => event.type === 'run.completed')
  const failed = events.find((event) => event.type === 'run.failed')
  const ok = text.includes(expectedAssistantText) && hasCompletion && !failed
  return {
    lane,
    ok,
    reason: ok
      ? 'assistant text and completion captured'
      : failed?.content ?? `missing ${[
        text.includes(expectedAssistantText) ? null : 'expected text',
        hasCompletion ? null : 'completion'
      ].filter(Boolean).join(', ')}`,
    events,
    stdout,
    stderr
  }
}

function parseStdoutLines(chunk, state) {
  state.stdout += chunk
  state.buffer += chunk
  const lines = state.buffer.split('\n')
  state.buffer = lines.pop() ?? ''
  for (const line of lines) {
    if (line.trim()) state.events.push(...provider.parseOutputLine(line))
  }
}

function flushStdoutLine(state) {
  const line = state.buffer.trim()
  if (!line) return
  state.buffer = ''
  state.events.push(...provider.parseOutputLine(line))
}

function runHeadless() {
  const cwd = makeWorkspace('headless')
  const request = makeRequest(cwd, 'headless')
  const resolvedCommand = resolveProviderCommand(
    provider,
    buildProviderCommandForRuntime(provider, request)
  )
  if (!resolvedCommand) return Promise.resolve({ lane: 'headless', ok: false, reason: 'missing binary', events: [] })
  const command = commandForLiveScenario(resolvedCommand, request.prompt)

  return new Promise((resolve) => {
    const state = { events: [], stdout: '', stderr: '', buffer: '' }
    const child = spawnChild(command.binary, command.args, {
      cwd,
      env: providerSpawnEnv('claude'),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const timer = setTimeout(() => {
      child.kill()
      flushStdoutLine(state)
      resolve({ ...resultFor('headless', state.events, state.stdout, state.stderr), reason: `timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => parseStdoutLines(chunk.toString('utf8'), state))
    child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ lane: 'headless', ok: false, reason: error.message, events: state.events, stdout: state.stdout, stderr: state.stderr })
    })
    child.on('exit', () => {
      clearTimeout(timer)
      flushStdoutLine(state)
      rmSync(cwd, { recursive: true, force: true })
      resolve(resultFor('headless', state.events, state.stdout, state.stderr))
    })
  })
}

function runInteractive() {
  const cwd = makeWorkspace('interactive')
  const request = makeRequest(cwd, 'interactive')
  const resolvedCommand = resolveProviderCommand(
    provider,
    buildProviderCommandForRuntime(provider, request)
  )
  if (!resolvedCommand) return Promise.resolve({ lane: 'interactive', ok: false, reason: 'missing binary', events: [] })
  const command = commandForLiveScenario(resolvedCommand, request.prompt)

  return new Promise((resolve) => {
    const events = []
    let raw = ''
    const answeredNativePrompts = new Set()
    let parsedTerminalCompletion = false
    let finished = false
    const tailer = createJsonlTailer(claudeProjectDir(cwd), (line) => {
      events.push(...provider.parseOutputLine(line))
      const result = resultFor('interactive', events, raw, '')
      if (result.ok) finish(result)
    }, { intervalMs: 250 })
    const pty = spawnPty(command.binary, command.args, {
      name: 'xterm-color',
      cwd,
      env: providerSpawnEnv('claude'),
      cols: 160,
      rows: 40
    })
    tailer.start()

    const timer = setTimeout(() => {
      finish({ ...resultFor('interactive', events, raw, ''), reason: `timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    function finish(result) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      tailer.poll()
      tailer.stop()
      try { pty.kill() } catch { /* already exited */ }
      rmSync(cwd, { recursive: true, force: true })
      resolve(result)
    }

    pty.onData((data) => {
      raw += data
      answerTerminalCapabilityRequests(pty, data)
      const nativePrompt = detectNativeCliPrompt('claude', raw)
      if (autoTrust && nativePrompt && !answeredNativePrompts.has(nativePrompt)) {
        answeredNativePrompts.add(nativePrompt)
        setTimeout(() => {
          if (!finished) pty.write(nativeCliPromptSubmitSequence(nativePrompt, 'Enable selected'))
        }, 300)
      }
      if (!parsedTerminalCompletion) {
        const snapshot = parseClaudeTerminalSnapshot(raw)
        if (snapshot.completed && snapshot.assistantText) {
          parsedTerminalCompletion = true
          events.push({ type: 'assistant.text', content: snapshot.assistantText })
          events.push({ type: 'run.completed' })
          finish(resultFor('interactive', events, raw, ''))
        }
      }
    })
    pty.onExit(() => {
      tailer.poll()
      finish(resultFor('interactive', events, raw, ''))
    })
  })
}

console.log('Running Claude runtime parity smoke. This may use Claude quota.')
console.log(`  model=${liveSmokeModel('claude')} effort=${liveSmokeEffort('claude')}`)
console.log(`  lanes=${selectedLanes.join(', ')}`)
if (autoTrust) console.log('  native prompts: auto-trust enabled for smoke verification')
console.log('')

const laneRunners = {
  headless: runHeadless,
  interactive: runInteractive
}
const results = []
for (const lane of selectedLanes) {
  const run = laneRunners[lane]
  if (!run) {
    results.push({ lane, ok: false, reason: 'unknown lane', events: [] })
    continue
  }
  results.push(await run())
}
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.lane}: ${result.reason}`)
  console.log(`  events: ${summarizeEvents(result.events)}`)
  const preview = assistantText(result.events).slice(0, 160)
  if (preview) console.log(`  assistant: ${preview}`)
  const rawPreview = (result.stdout || result.stderr || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim().slice(-600)
  if (!result.ok && rawPreview) console.log(`  raw: ${rawPreview}`)
}

const failures = results.filter((result) => !result.ok)
if (failures.length > 0) process.exit(1)
