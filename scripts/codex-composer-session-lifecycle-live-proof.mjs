#!/usr/bin/env node
import Module from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const artifactRoot = resolve(process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_ARTIFACT_DIR ?? join(repoRoot, 'tmp', 'codex-composer-session-lifecycle-live-proof'))
const workspaceDir = resolve(process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_CWD ?? join(artifactRoot, 'workspace'))
const userDataDir = resolve(process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_USER_DATA ?? join(artifactRoot, 'user-data'))
const timeoutMs = Number(process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_MODEL ?? 'gpt-5.4-mini'
const effort = process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_EFFORT ?? 'low'
const executionPolicy = process.env.CODEX_COMPOSER_SESSION_LIFECYCLE_POLICY ?? 'default'
const firstToken = 'CODEX_SESSION_LIFECYCLE_FIRST_OK'
const continueToken = 'CODEX_SESSION_LIFECYCLE_CONTINUE_OK'
const retryToken = 'CODEX_SESSION_LIFECYCLE_RETRY_OK'
const memoryToken = 'ORCH_SESSION_LIFECYCLE_MEMORY_427'
const firstPrompt = [
  'This is a live Orchestrator sessionManager lifecycle proof.',
  'Do not run tools.',
  `Remember this proof key: ${memoryToken}.`,
  `If I ask "Continue from where you left off.", reply exactly ${continueToken}:${memoryToken}.`,
  `If I ask "Retry continuation proof.", reply exactly ${retryToken}:${memoryToken}.`,
  `For this turn, reply exactly ${firstToken}.`
].join(' ')

process.env.ORCHESTRATOR_USER_DATA_DIR = userDataDir
process.env.ORCHESTRATOR_PROFILE = 'codex-session-lifecycle-proof'
process.env.ORCHESTRATOR_DISABLE_PET_OVERLAY = '1'

resetArtifacts()
installElectronMock()

const require = createRequire(import.meta.url)
const sessionsModule = require('../out-test/src/main/sessions.js')
const settingsModule = require('../out-test/src/main/settings.js')
const diagnosticsModule = require('../out-test/src/main/providerRuntimeDiagnostics.js')
const providersModule = require('../out-test/src/main/providers.js')
const { sessionManager } = sessionsModule
const { settingsStore } = settingsModule
const { listProviderRuntimeDebugEvents, listProviderRuntimeConnections } = diagnosticsModule
const { providerSpawnEnv, resolveProviderCommand, PROVIDERS } = providersModule

settingsStore.set('defaultProvider', 'codex')
settingsStore.set('defaultModels', { codex: model })
settingsStore.set('defaultEfforts', { codex: effort })
settingsStore.set('defaultPermissionModes', { codex: executionPolicy })
settingsStore.set('personalizationEnabled', false)

let session = null
let archiveAttempt = null

try {
  session = await sessionManager.create({
    projectId: 'codex-session-lifecycle-proof',
    workDir: workspaceDir,
    useWorktree: false,
    repoRoot: workspaceDir
  })
  sessionManager.updateSettings(session.id, {
    provider: 'codex',
    runtime: 'app-server',
    model,
    effort,
    permissionMode: executionPolicy,
    allowedTools: [],
    disallowedTools: [],
    availableTools: [],
    additionalDirs: []
  })

  const sendStarted = await sessionManager.sendMessage(session.id, firstPrompt)
  if (!sendStarted) throw new Error('sendMessage did not start the live Codex session')
  const afterSend = await waitForSession(session.id, {
    phase: 'sendMessage',
    expectedText: firstToken,
    requireProviderSessionId: true
  })

  const continueStarted = await sessionManager.continueLastTurn(session.id)
  if (!continueStarted) throw new Error('continueLastTurn did not start the live Codex resume run')
  const afterContinue = await waitForSession(session.id, {
    phase: 'continueLastTurn',
    expectedPattern: new RegExp(`${escapeRegExp(continueToken)}\\s*:\\s*${escapeRegExp(memoryToken)}`),
    providerSessionId: afterSend.providerSessionId
  })

  sessionManager.appendMessage(session.id, [{
    id: 'session-lifecycle-retry-proof-user',
    role: 'user',
    type: 'text',
    content: 'Retry continuation proof.',
    timestamp: Date.now()
  }])
  sessionManager.updateStatus(session.id, 'error')
  const retryStarted = await sessionManager.retryLastUserMessage(session.id)
  if (!retryStarted) throw new Error('retryLastUserMessage did not start the live Codex resume run')
  const afterRetry = await waitForSession(session.id, {
    phase: 'retryLastUserMessage',
    expectedPattern: new RegExp(`${escapeRegExp(retryToken)}\\s*:\\s*${escapeRegExp(memoryToken)}`),
    providerSessionId: afterSend.providerSessionId
  })

  archiveAttempt = await archiveProofThread(afterSend.providerSessionId)
  const debugEvents = listProviderRuntimeDebugEvents({ sessionId: session.id, includeNoisy: true, limit: 1000 })
  const runtimeConnections = listProviderRuntimeConnections({ sessionId: session.id, limit: 100 })
  const resumeMethodCount = debugEvents.filter((event) => event.method === 'thread/resume').length
  const startMethodCount = debugEvents.filter((event) => event.method === 'thread/start').length
  const finalSession = sessionManager.get(session.id)
  const ok = Boolean(
    finalSession &&
    afterSend.providerSessionId &&
    afterContinue.providerSessionId === afterSend.providerSessionId &&
    afterRetry.providerSessionId === afterSend.providerSessionId &&
    startMethodCount >= 1 &&
    resumeMethodCount >= 2 &&
    archiveAttempt?.ok
  )
  finish(ok, ok
    ? 'Orchestrator sessionManager send, continue, and retry all used a live Codex app-server provider session'
    : 'sessionManager lifecycle proof did not satisfy all expected start/resume checks', {
      sendStarted,
      continueStarted,
      retryStarted,
      afterSend,
      afterContinue,
      afterRetry,
      finalSession,
      runtimeDebugEvents: debugEvents,
      runtimeConnections,
      startMethodCount,
      resumeMethodCount
    })
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error), {
    session: session ? sessionManager.get(session.id) : null,
    runtimeDebugEvents: session ? listProviderRuntimeDebugEvents({ sessionId: session.id, includeNoisy: true, limit: 1000 }) : [],
    runtimeConnections: session ? listProviderRuntimeConnections({ sessionId: session.id, limit: 100 }) : []
  })
}

async function waitForSession(sessionId, { phase, expectedText, expectedPattern, requireProviderSessionId = false, providerSessionId = null }) {
  const startedAt = Date.now()
  let lastSession = null
  while (Date.now() - startedAt < timeoutMs) {
    const current = sessionManager.get(sessionId)
    lastSession = current
    if (!current) throw new Error(`${phase}: session disappeared`)
    const transcript = transcriptText(current)
    const hasExpectedText = expectedPattern ? expectedPattern.test(transcript) : transcript.includes(expectedText)
    const providerOk = providerSessionId
      ? current.providerSessionId === providerSessionId
      : !requireProviderSessionId || Boolean(current.providerSessionId)
    if (current.status === 'idle' && hasExpectedText && providerOk) {
      return {
        phase,
        status: current.status,
        providerSessionId: current.providerSessionId ?? null,
        messageCount: current.messages.length,
        transcript,
        assistantMessages: current.messages.filter((message) => message.type === 'text' && message.role === 'assistant').map((message) => message.content),
        userMessages: current.messages.filter((message) => message.type === 'text' && message.role === 'user').map((message) => message.content)
      }
    }
    if (current.status === 'error' && transcript.includes('error_during_execution')) break
    await delay(250)
  }
  throw new Error(`${phase}: timed out waiting for expected session state. Last state: ${JSON.stringify({
    status: lastSession?.status,
    providerSessionId: lastSession?.providerSessionId,
    transcript: lastSession ? transcriptText(lastSession).slice(-2000) : null
  })}`)
}

async function archiveProofThread(threadId) {
  if (!threadId) return null
  const provider = PROVIDERS.codex
  const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
  if (!resolved) return { ok: false, error: 'codex CLI is not available' }
  const { spawn } = await import('node:child_process')
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
        name: 'orchestrator-session-lifecycle-proof-archive',
        title: 'Orchestrator Session Lifecycle Proof',
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

function transcriptText(targetSession) {
  return targetSession.messages
    .filter((message) => message.type === 'text' || message.type === 'result')
    .map((message) => 'content' in message ? String(message.content) : '')
    .join('\n')
}

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(workspaceDir, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'session-lifecycle-proof-workspace.txt'), 'Live Orchestrator sessionManager lifecycle proof workspace.\n')
}

function installElectronMock() {
  const paths = new Map([
    ['userData', userDataDir],
    ['appData', join(artifactRoot, 'app-data')]
  ])
  const electronMock = {
    app: {
      getPath(name) {
        return paths.get(name) ?? userDataDir
      },
      setPath(name, value) {
        paths.set(name, value)
        mkdirSync(value, { recursive: true })
      },
      setName() {},
      getName() {
        return 'Orchestrator Session Lifecycle Proof'
      },
      getVersion() {
        return '1.0.0'
      },
      isReady() {
        return true
      },
      whenReady() {
        return Promise.resolve()
      }
    },
    BrowserWindow: {
      getAllWindows() {
        return []
      }
    },
    ipcMain: {
      handle() {},
      on() {}
    },
    nativeTheme: {},
    shell: {},
    dialog: {},
    clipboard: {
      writeText() {},
      readText() {
        return ''
      }
    }
  }
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronMock
    return originalLoad.call(this, request, parent, isMain)
  }
}

function writeArtifacts(result) {
  const payload = {
    ...result,
    createdAt: new Date().toISOString(),
    artifactRoot,
    workspaceDir,
    userDataDir,
    model,
    effort,
    executionPolicy,
    firstPrompt,
    firstToken,
    continueToken,
    retryToken,
    memoryToken,
    sessionId: session?.id ?? null,
    archiveAttempt
  }
  writeFileSync(join(artifactRoot, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`)
  return payload
}

function finish(ok, reason, details = {}) {
  const result = writeArtifacts({ ok, reason, ...details })
  const summary = {
    ok,
    reason,
    artifactPath: join(artifactRoot, 'result.json'),
    sessionId: result.sessionId,
    providerSessionId: result.finalSession?.providerSessionId ?? result.afterSend?.providerSessionId ?? null,
    startMethodCount: result.startMethodCount ?? null,
    resumeMethodCount: result.resumeMethodCount ?? null,
    archiveAttempt: result.archiveAttempt ? { ok: result.archiveAttempt.ok, error: result.archiveAttempt.error ?? null } : null
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(ok ? 0 : 1)
}

function preview(value) {
  const text = JSON.stringify(value ?? null)
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
