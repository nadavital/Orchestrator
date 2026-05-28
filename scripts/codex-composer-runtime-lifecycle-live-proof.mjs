#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const runtimeModulePath = join(repoRoot, 'out-test/src/main/codexAppServerRuntime.js')
const diagnosticsModulePath = join(repoRoot, 'out-test/src/main/providerRuntimeDiagnostics.js')
const providersModule = await import(pathToFileURL(providersModulePath))
const runtimeModule = await import(pathToFileURL(runtimeModulePath))
const diagnosticsModule = await import(pathToFileURL(diagnosticsModulePath))
const { PROVIDERS, codexRuntimePolicyConfig, providerSpawnEnv, resolveProviderCommand } = providersModule.default ?? providersModule
const { CodexAppServerRuntimeManager } = runtimeModule.default ?? runtimeModule
const { listProviderRuntimeDebugEvents, listProviderRuntimeConnections } = diagnosticsModule.default ?? diagnosticsModule

const provider = PROVIDERS.codex
const artifactRoot = resolve(process.env.CODEX_COMPOSER_RUNTIME_LIFECYCLE_ARTIFACT_DIR ?? join(repoRoot, 'tmp', 'codex-composer-runtime-lifecycle-live-proof'))
const workspaceDir = resolve(process.env.CODEX_COMPOSER_RUNTIME_LIFECYCLE_CWD ?? join(artifactRoot, 'workspace'))
const timeoutMs = Number(process.env.CODEX_COMPOSER_RUNTIME_LIFECYCLE_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_COMPOSER_RUNTIME_LIFECYCLE_MODEL ?? 'gpt-5.4-mini'
const effort = process.env.CODEX_COMPOSER_RUNTIME_LIFECYCLE_EFFORT ?? 'low'
const executionPolicy = process.env.CODEX_COMPOSER_RUNTIME_LIFECYCLE_POLICY ?? 'default'
const firstToken = 'CODEX_RUNTIME_LIFECYCLE_FIRST_OK'
const continueToken = 'CODEX_RUNTIME_LIFECYCLE_CONTINUE_OK'
const memoryToken = 'ORCH_RUNTIME_LIFECYCLE_MEMORY_913'
const firstPrompt = [
  'This is a live Orchestrator Codex runtime lifecycle proof.',
  'Do not run tools.',
  `Remember this proof key for the next turn: ${memoryToken}.`,
  `Reply with exactly ${firstToken}.`
].join(' ')
const continuePrompt = [
  'Continue from where you left off.',
  `Reply with ${continueToken}: followed by the proof key I asked you to remember.`
].join(' ')
const policy = codexRuntimePolicyConfig(executionPolicy)
const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
if (!resolved) {
  console.error('codex CLI is not available.')
  process.exit(1)
}

resetArtifacts()

let startRun = null
let resumeRun = null
let archiveAttempt = null

try {
  startRun = await runRuntimePhase({
    phase: 'start',
    mode: 'start',
    prompt: firstPrompt,
    expectedPattern: new RegExp(escapeRegExp(firstToken))
  })
  if (!startRun.providerSessionId) throw new Error('start phase did not expose a provider session id')

  resumeRun = await runRuntimePhase({
    phase: 'continue',
    mode: 'resume',
    providerSessionId: startRun.providerSessionId,
    prompt: continuePrompt,
    expectedPattern: new RegExp(`${escapeRegExp(continueToken)}\\s*:\\s*${escapeRegExp(memoryToken)}`)
  })
  archiveAttempt = await archiveProofThread(startRun.providerSessionId)

  const sameThread = resumeRun.providerSessionId === startRun.providerSessionId
  const sawStartMethod = startRun.connectionMethods.includes('thread/start')
  const sawResumeMethod = resumeRun.connectionMethods.includes('thread/resume')
  const startTextOk = startRun.assistantText.includes(firstToken)
  const resumeTextOk = new RegExp(`${escapeRegExp(continueToken)}\\s*:\\s*${escapeRegExp(memoryToken)}`).test(resumeRun.assistantText)
  if (sameThread && sawStartMethod && sawResumeMethod && startTextOk && resumeTextOk) {
    finish(true, 'Orchestrator Codex runtime started and resumed a live app-server thread with prior-turn context')
  } else if (!sameThread) {
    finish(false, 'runtime resume did not preserve the provider session id')
  } else if (!sawStartMethod) {
    finish(false, 'runtime start phase did not record thread/start')
  } else if (!sawResumeMethod) {
    finish(false, 'runtime resume phase did not record thread/resume')
  } else if (!startTextOk) {
    finish(false, `start assistant text did not include ${firstToken}: ${startRun.assistantText.trim()}`)
  } else {
    finish(false, `resume assistant text did not include ${continueToken}:${memoryToken}: ${resumeRun.assistantText.trim()}`)
  }
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

async function runRuntimePhase({ phase, mode, providerSessionId = null, prompt, expectedPattern }) {
  const sessionId = `codex-runtime-lifecycle-${phase}-${Date.now()}`
  const manager = new CodexAppServerRuntimeManager()
  const rawLines = []
  const events = []
  const assistantDeltas = []
  const connectionMethods = []
  let completed = false
  let failed = null
  let exposedProviderSessionId = providerSessionId
  let exitSeen = false

  const session = {
    id: sessionId,
    name: `Codex runtime lifecycle ${phase}`,
    pinned: false,
    projectId: 'codex-runtime-lifecycle-proof',
    workDir: workspaceDir,
    useWorktree: false,
    repoRoot: workspaceDir,
    providerSessionId,
    status: 'idle',
    messages: [],
    createdAt: Date.now(),
    provider: 'codex',
    model,
    effort,
    agentName: null,
    permissionMode: executionPolicy,
    allowedTools: [],
    disallowedTools: [],
    availableTools: [],
    additionalDirs: [],
    runtime: 'app-server'
  }
  const request = {
    prompt,
    cwd: workspaceDir,
    model,
    effort,
    providerSessionId,
    executionPolicy,
    allowedTools: [],
    disallowedTools: [],
    availableTools: [],
    additionalDirs: [],
    runtime: 'app-server',
    attachments: []
  }

  const timeout = setTimeout(() => {
    failed = new Error(`${phase}: timed out after ${timeoutMs}ms`)
    manager.stop(sessionId)
  }, timeoutMs)

  try {
    const result = manager.start({
      sessionId,
      session,
      provider,
      request,
      mode,
      onRawData: (data) => {
        for (const line of data.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          rawLines.push(trimmed)
          try {
            const message = JSON.parse(trimmed)
            const method = typeof message.method === 'string' ? message.method : null
            if (method === 'thread/started') connectionMethods.push('thread/start')
          } catch {
            // Stderr is also routed through onRawData; keep it in raw output but do not parse it.
          }
        }
      },
      onParsedEvents: (nextEvents) => {
        events.push(...nextEvents)
        for (const event of nextEvents) {
          if (event.type === 'session.started') {
            exposedProviderSessionId = event.providerSessionId
          }
          if (event.type === 'assistant.text') assistantDeltas.push(event.content)
          if (event.type === 'assistant.text.delta') assistantDeltas.push(event.content)
          if (event.type === 'run.completed') completed = true
          if (event.type === 'run.failed') failed = new Error(event.content ?? `${phase}: run failed`)
        }
      },
      onExit: () => {
        exitSeen = true
      }
    })
    if (!result.ok) throw new Error(`${phase}: ${result.message ?? 'runtime failed to start'}`)

    await waitUntil(() => completed || failed !== null || exitSeen, timeoutMs)
    if (failed) throw failed
    if (!completed) throw new Error(`${phase}: runtime exited before run.completed`)
    const assistantText = assistantDeltas.join('')
    if (!expectedPattern.test(assistantText)) {
      throw new Error(`${phase}: assistant text did not match ${expectedPattern}: ${assistantText.trim()}`)
    }

    const debugEvents = listProviderRuntimeDebugEvents({ sessionId, includeNoisy: true, limit: 500 })
    const runtimeConnections = listProviderRuntimeConnections({ sessionId, limit: 20 })
    for (const event of debugEvents) {
      if (event.method === 'thread/start' || event.method === 'thread/resume') connectionMethods.push(event.method)
    }
    for (const connection of runtimeConnections) {
      if (connection.method === 'thread/start' || connection.method === 'thread/resume') connectionMethods.push(connection.method)
    }

    manager.stop(sessionId)
    clearTimeout(timeout)
    const rawPath = join(artifactRoot, `${phase}.raw.jsonl`)
    writeFileSync(rawPath, `${rawLines.join('\n')}\n`)
    return {
      phase,
      mode,
      sessionId,
      providerSessionId: exposedProviderSessionId,
      connectionMethods: [...new Set(connectionMethods)],
      eventTypes: [...new Set(events.map((event) => event.type))],
      runtimeDebugEvents: debugEvents,
      runtimeConnections,
      events,
      assistantText,
      completed,
      exitSeen,
      rawPath
    }
  } catch (error) {
    manager.stop(sessionId)
    clearTimeout(timeout)
    throw error
  }
}

async function archiveProofThread(threadId) {
  if (!threadId) return null
  const child = spawn(resolved.binary, resolved.args, {
    cwd: workspaceDir,
    env: providerSpawnEnv('codex'),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const state = { nextId: 1, buffer: '', stderr: '', pending: new Map(), rawLines: [] }
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8') })
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk.toString('utf8')
    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() ?? ''
    for (const line of lines) handleArchiveLine(state, line.trim())
  })
  try {
    await archiveRequest(state, 'initialize', {
      clientInfo: {
        name: 'orchestrator-runtime-lifecycle-proof-archive',
        title: 'Orchestrator Runtime Lifecycle Proof',
        version: '1.0.0'
      },
      capabilities: { experimentalApi: true }
    })
    archiveNotify(state, 'initialized')
    const result = await archiveRequest(state, 'thread/archive', { threadId })
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
    return { ok: true, result: preview(result), stderr: state.stderr.trim() }
  } catch (error) {
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
    return { ok: false, error: error instanceof Error ? error.message : String(error), stderr: state.stderr.trim() }
  }

  function archiveRequest(target, method, params) {
    const id = `archive-${target.nextId++}`
    archiveSend(target, { method, id, params })
    return new Promise((resolve, reject) => {
      target.pending.set(id, { resolve, reject })
    })
  }

  function archiveNotify(target, method, params) {
    archiveSend(target, params === undefined ? { method } : { method, params })
  }

  function archiveSend(target, message) {
    child.stdin.write(`${JSON.stringify(message)}\n`)
    target.rawLines.push(JSON.stringify(message))
  }

  function handleArchiveLine(target, line) {
    if (!line) return
    target.rawLines.push(line)
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.id == null || message.method) return
    const waiter = target.pending.get(message.id)
    if (!waiter) return
    target.pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  }
}

function waitUntil(predicate, deadlineMs) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval)
        resolve()
      } else if (Date.now() - startedAt >= deadlineMs) {
        clearInterval(interval)
        reject(new Error(`timed out after ${deadlineMs}ms`))
      }
    }, 100)
  })
}

function preview(value) {
  const text = JSON.stringify(value ?? null)
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text
}

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'runtime-lifecycle-proof-workspace.txt'), 'Live Orchestrator Codex runtime lifecycle proof workspace.\n')
}

function writeArtifacts(result) {
  const payload = {
    ...result,
    createdAt: new Date().toISOString(),
    artifactRoot,
    workspaceDir,
    model,
    effort,
    executionPolicy,
    policy,
    firstPrompt,
    continuePrompt,
    firstToken,
    continueToken,
    memoryToken,
    startRun,
    resumeRun,
    archiveAttempt
  }
  writeFileSync(join(artifactRoot, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`)
  return payload
}

function finish(ok, reason) {
  const result = writeArtifacts({ ok, reason })
  const summary = {
    ok,
    reason,
    artifactPath: join(artifactRoot, 'result.json'),
    startProviderSessionId: result.startRun?.providerSessionId ?? null,
    resumeProviderSessionId: result.resumeRun?.providerSessionId ?? null,
    startConnectionMethods: result.startRun?.connectionMethods ?? [],
    resumeConnectionMethods: result.resumeRun?.connectionMethods ?? [],
    archiveAttempt: result.archiveAttempt ? { ok: result.archiveAttempt.ok, error: result.archiveAttempt.error ?? null } : null
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(ok ? 0 : 1)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
