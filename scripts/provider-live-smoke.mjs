import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHEAP_LIVE_MODELS, liveSmokeEffort, liveSmokeModel } from './provider-smoke-config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, resolveProviderCommand } = await import(providersModulePath)

const DEFAULT_PROVIDERS = ['claude', 'codex', 'copilot', 'cursor']
const selectedProviders = (process.env.LIVE_PROVIDERS ?? DEFAULT_PROVIDERS.join(','))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

const timeoutMs = Number(process.env.LIVE_PROVIDER_TIMEOUT_MS ?? 90_000)
const expectedAssistantText = 'ORCHESTRATOR_LIVE_OK'
const prompt = [
  'You are running a tiny Orchestrator provider smoke test.',
  'Do not edit files.',
  'Do not run shell commands.',
  'Read the file SMOKE.md if it is available.',
  `Reply with exactly: ${expectedAssistantText}`
].join(' ')

function makeRequest(cwd, providerId) {
  return {
    prompt,
    cwd,
    model: liveSmokeModel(providerId),
    effort: liveSmokeEffort(providerId),
    providerSessionId: null,
    executionPolicy: 'default',
    allowedTools: []
  }
}

function smokeCommandForProvider(providerId, provider, cwd) {
  const baseCommand = provider.buildStartCommand(makeRequest(cwd, providerId))
  if (providerId !== 'codex') return baseCommand

  const args = [...baseCommand.args]
  const execIndex = args.indexOf('exec')
  if (execIndex >= 0) {
    args.splice(execIndex + 1, 0, '--ignore-user-config', '--ignore-rules', '--ephemeral')
  }
  return { ...baseCommand, args }
}

function runProvider(providerId) {
  const provider = PROVIDERS[providerId]
  if (!provider) return Promise.resolve({ providerId, ok: false, reason: 'missing adapter' })

  const cwd = mkdtempSync(join(tmpdir(), `orchestrator-live-${providerId}-`))
  writeFileSync(join(cwd, 'SMOKE.md'), 'This is a safe smoke-test workspace. Do not edit files.\n')

  const baseCommand = smokeCommandForProvider(providerId, provider, cwd)
  const command = resolveProviderCommand(provider, baseCommand)
  if (!command) {
    rmSync(cwd, { recursive: true, force: true })
    return Promise.resolve({ providerId, ok: false, reason: 'missing binary' })
  }

  return new Promise((resolve) => {
    const child = spawn(command.binary, command.args, {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stdoutBuffer = ''
    let stderr = ''
    const events = []
    const timer = setTimeout(() => {
      child.kill()
      flushPendingLine()
      finish(false, `timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    let finished = false
    function finish(ok, reason) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      rmSync(cwd, { recursive: true, force: true })
      resolve({ providerId, ok, reason, events, stdout, stderr })
    }

    function parseCompleteLines(chunk) {
      stdout += chunk
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = provider.parseOutputLine(line)
          events.push(...parsed)
          const repeatedReconnect = parsed.find((event) =>
            (event.type === 'connection.reconnecting' || event.type === 'connection.retrying') &&
            typeof event.attempt === 'number' &&
            event.attempt >= 2
          )
          if (providerId === 'cursor' && repeatedReconnect) {
            child.kill()
            finish(false, `repeated Cursor reconnect attempt ${repeatedReconnect.attempt}`)
            return
          }
        } catch (error) {
          events.push({ type: 'parse.error', content: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    function flushPendingLine() {
      const line = stdoutBuffer.trim()
      if (!line) return
      stdoutBuffer = ''
      try {
        events.push(...provider.parseOutputLine(line))
      } catch (error) {
        events.push({ type: 'parse.error', content: error instanceof Error ? error.message : String(error) })
      }
    }

    child.stdout.on('data', (chunk) => parseCompleteLines(chunk.toString('utf8')))
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => finish(false, error.message))
    child.on('exit', (code) => {
      flushPendingLine()
      const assistantText = events
        .filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta')
        .map((event) => event.content)
        .join('')
      const parsedEventTypes = new Set(events.map((event) => event.type))
      const failedEvent = events.find((event) => event.type === 'run.failed')
      const parseError = events.find((event) => event.type === 'parse.error')
      const missing = []
      if (!parsedEventTypes.has('assistant.text') && !parsedEventTypes.has('assistant.text.delta')) missing.push('assistant text')
      if (!parsedEventTypes.has('run.completed')) missing.push('run.completed')
      if (!assistantText.includes(expectedAssistantText)) missing.push('expected assistant text')

      if (parseError) {
        finish(false, `parse error: ${parseError.content}`)
        return
      }
      if (code !== 0) {
        finish(false, failedEvent?.content ?? stderr.trim().split('\n')[0] ?? `exit ${code}`)
        return
      }
      if (missing.length > 0) {
        finish(false, `missing parsed ${missing.join(', ')}`)
        return
      }
      finish(true, 'parsed assistant response and completion')
    })
  })
}

console.log(`Running live provider smoke for: ${selectedProviders.join(', ')}`)
console.log('This may use provider quota. Defaults are pinned to cheap smoke-test models.')
for (const providerId of selectedProviders) {
  const model = liveSmokeModel(providerId)
  const effort = liveSmokeEffort(providerId)
  const defaultModel = CHEAP_LIVE_MODELS[providerId]
  const suffix = defaultModel && model !== defaultModel ? ' (override)' : ''
  console.log(`  ${providerId}: model=${model || 'provider-default'} effort=${effort}${suffix}`)
}
console.log('')

const results = []
for (const providerId of selectedProviders) {
  const result = await runProvider(providerId)
  results.push(result)
  const eventSummary = result.events
    ? [...new Set(result.events.map((event) => event.type))].join(', ') || 'none'
    : 'none'
  const assistantPreview = result.events
    ?.filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta')
    .map((event) => event.content)
    .join('')
    .slice(0, 120)
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${providerId}: ${result.reason}`)
  console.log(`  events: ${eventSummary}`)
  if (assistantPreview) console.log(`  assistant: ${assistantPreview}`)
  if (!result.ok) {
    const stderrPreview = result.stderr?.trim().split('\n').slice(-3).join('\n')
    const stdoutPreview = result.stdout?.trim().split('\n').slice(-3).join('\n')
    if (stderrPreview) console.log(`  stderr: ${stderrPreview}`)
    if (stdoutPreview) console.log(`  stdout: ${stdoutPreview}`)
  }
}

const failures = results.filter((result) => !result.ok)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures) {
    console.log(`  - ${failure.providerId}: ${failure.reason}`)
  }
  process.exit(1)
}

console.log('\nAll selected live provider smokes passed.')
