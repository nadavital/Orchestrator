#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, providerSpawnEnv, resolveProviderCommand } = await import(providersModulePath)

const provider = PROVIDERS.codex
const artifactRoot = process.env.CODEX_REVIEW_PROOF_ARTIFACT_DIR
  ? process.env.CODEX_REVIEW_PROOF_ARTIFACT_DIR
  : join(repoRoot, 'tmp', 'codex-review-appserver-live-proof')
const workspaceDir = process.env.CODEX_REVIEW_PROOF_CWD ?? join(artifactRoot, 'workspace')
const timeoutMs = Number(process.env.CODEX_REVIEW_PROOF_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_REVIEW_PROOF_MODEL ?? 'gpt-5.4-mini'
const ephemeral = process.env.CODEX_REVIEW_PROOF_EPHEMERAL === 'true'
const archiveThread = process.env.CODEX_REVIEW_PROOF_ARCHIVE_THREAD !== 'false'
const expectedToken = 'CODEX_REVIEW_LIVE_OK'
const prompt = process.env.CODEX_REVIEW_PROOF_PROMPT ?? [
  'This is a live Orchestrator/Codex app-server Review proof in a disposable git workspace.',
  'Edit only live-review-proof.txt.',
  'Replace the text EXACT_ORIGINAL_TOKEN with CODEX_LIVE_REVIEW_DIFF_OK.',
  `After the edit succeeds, reply with exactly ${expectedToken}.`
].join(' ')

const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
if (!resolved) {
  console.error('codex CLI is not available.')
  process.exit(1)
}

resetArtifacts()
setupWorkspace()

const child = spawn(resolved.binary, resolved.args, {
  cwd: workspaceDir,
  env: providerSpawnEnv('codex'),
  stdio: ['pipe', 'pipe', 'pipe']
})

let nextId = 1
let buffer = ''
let stderr = ''
let assistantText = ''
let completed = false
let turnStatus = null
let failed = false
let threadId = null
let turnStartResult = null
let archiveAttempt = null
const pending = new Map()
const methods = []
const rawLines = []
const parseErrors = []
const events = []
const serverRequests = []
const diffNotifications = []
const turnIds = new Set()
const rollbackAttempts = []

const timeout = setTimeout(() => {
  finish(false, `timed out after ${timeoutMs}ms`)
}, timeoutMs)

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8')
})

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) handleLine(line.trim())
})

child.on('error', (error) => {
  finish(false, error.message)
})

child.on('exit', (code, signal) => {
  if (failed || completed) return
  finish(false, `codex app-server exited before completion (${signal ?? code ?? 'unknown'})`)
})

try {
  await request('initialize', {
    clientInfo: {
      name: 'orchestrator-review-live-proof',
      title: 'Orchestrator Review Live Proof',
      version: '1.0.0'
    },
    capabilities: { experimentalApi: true }
  })
  notify('initialized')
  const threadResult = await request('thread/start', {
    model,
    cwd: workspaceDir,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    serviceName: 'orchestrator-review-live-proof',
    ephemeral,
    sessionStartSource: 'startup'
  })
  threadId = threadResult?.thread?.id ?? null
  if (!threadId) throw new Error('thread/start did not return a thread id')

  turnStartResult = await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    cwd: workspaceDir,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    model
  })
  if (turnStartResult?.turn?.id) turnIds.add(turnStartResult.turn.id)

  await waitForCompletion()
  const primaryTurnId = [...turnIds].at(-1) ?? turnStartResult?.turn?.id ?? null
  const normalizedDiffEvents = events.filter((event) => event.type === 'diff.updated')
  const checkpointIds = [...new Set(normalizedDiffEvents.map((event) => event.checkpointId).filter(Boolean))]
  const fileText = readProofFile()
  const gitDiff = runGit(['diff', '--', 'live-review-proof.txt'])
  const editApplied = fileText.includes('CODEX_LIVE_REVIEW_DIFF_OK') && gitDiff.includes('CODEX_LIVE_REVIEW_DIFF_OK')
  const assistantSawOk = assistantText.includes(expectedToken)

  if (process.env.CODEX_REVIEW_PROOF_PROBE_ROLLBACK !== 'false') {
    await probeRollback({ primaryTurnId, checkpointIds })
  }
  if (!ephemeral && archiveThread) {
    await archiveProofThread()
  }

  if (editApplied && normalizedDiffEvents.length > 0 && assistantSawOk) {
    finish(true, checkpointIds.length > 0
      ? 'live Codex app-server emitted diff.updated with checkpoint metadata'
      : 'live Codex app-server emitted diff.updated without checkpoint metadata')
  } else if (!editApplied) {
    finish(false, 'live Codex app-server completed but did not leave the requested file edit in git diff')
  } else if (normalizedDiffEvents.length === 0) {
    finish(false, 'live Codex app-server completed the edit but emitted no normalized diff.updated events')
  } else {
    finish(false, `live Codex app-server edit/diff succeeded but assistant token was missing: ${assistantText.trim()}`)
  }
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

async function archiveProofThread() {
  if (!threadId) return
  try {
    const result = await request('thread/archive', { threadId })
    archiveAttempt = { ok: true, result: preview(result) }
  } catch (error) {
    archiveAttempt = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function request(method, params) {
  const id = `review-proof-${nextId++}`
  send({ method, id, params })
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method })
  })
}

function notify(method, params) {
  send(params === undefined ? { method } : { method, params })
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

function handleLine(line) {
  if (!line) return
  rawLines.push(line)
  let message
  try {
    message = JSON.parse(line)
  } catch {
    parseErrors.push({ line, error: 'invalid json' })
    return
  }

  if (message.method) methods.push(message.method)

  try {
    const parsedEvents = provider.parseOutputLine(line)
    events.push(...parsedEvents)
  } catch (error) {
    parseErrors.push({ line, error: error instanceof Error ? error.message : String(error) })
  }

  if (message.method === 'turn/started') {
    const turnId = message.params?.turn?.id ?? message.params?.turnId
    if (turnId) turnIds.add(turnId)
  }
  if (message.method === 'turn/diff/updated') {
    diffNotifications.push(message.params ?? {})
    const turnId = message.params?.turnId
    if (turnId) turnIds.add(turnId)
  }

  if (message.id && !message.method) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
    return
  }

  if (message.id && message.method) {
    serverRequests.push({
      id: message.id,
      method: message.method,
      paramsPreview: preview(message.params)
    })
    answerServerRequest(message)
    return
  }

  if (message.method === 'item/agentMessage/delta') {
    assistantText += message.params?.delta ?? ''
  } else if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage' && !assistantText) {
    assistantText += message.params.item.text ?? ''
  } else if (message.method === 'turn/completed') {
    turnStatus = message.params?.turn?.status ?? null
    const turnId = message.params?.turn?.id ?? message.params?.turnId
    if (turnId) turnIds.add(turnId)
    if (turnStatus && turnStatus !== 'completed') {
      finish(false, `turn completed with status ${turnStatus}`)
      return
    }
    completed = true
  }
}

function answerServerRequest(message) {
  if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
    send({ id: message.id, result: { decision: 'accept' } })
    return
  }
  if (message.method === 'item/permissions/requestApproval') {
    send({ id: message.id, result: { permissions: message.params?.permissions ?? {}, scope: 'turn' } })
    return
  }
  if (message.method === 'mcpServer/elicitation/request') {
    send({ id: message.id, result: { action: 'decline', content: null, _meta: null } })
    return
  }
  send({ id: message.id, error: { code: -32601, message: 'Orchestrator review live proof does not implement this client request.' } })
}

async function probeRollback({ primaryTurnId, checkpointIds }) {
  if (!threadId) return
  const candidates = []
  if (checkpointIds[0]) candidates.push({ label: 'checkpointId', params: { threadId, checkpointId: checkpointIds[0] } })
  if (primaryTurnId && checkpointIds[0]) candidates.push({ label: 'turnId+checkpointId', params: { threadId, turnId: primaryTurnId, checkpointId: checkpointIds[0] } })
  candidates.push({ label: 'numTurns:1', params: { threadId, numTurns: 1 } })
  if (primaryTurnId) candidates.push({ label: 'turnId', params: { threadId, turnId: primaryTurnId } })
  if (primaryTurnId) candidates.push({ label: 'rollbackToTurnId', params: { threadId, rollbackToTurnId: primaryTurnId } })
  if (primaryTurnId) candidates.push({ label: 'targetTurnId', params: { threadId, targetTurnId: primaryTurnId } })
  for (const candidate of candidates) {
    try {
      const result = await request('thread/rollback', candidate.params)
      rollbackAttempts.push({
        ...candidate,
        ok: true,
        result: preview(result),
        fileTextAfter: readProofFile(),
        gitDiffAfter: runGit(['diff', '--', 'live-review-proof.txt'])
      })
      break
    } catch (error) {
      rollbackAttempts.push({
        ...candidate,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

function waitForCompletion() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!completed) return
      clearInterval(interval)
      resolve()
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
}

function setupWorkspace() {
  writeFileSync(join(workspaceDir, 'live-review-proof.txt'), [
    'Live Codex Review proof fixture.',
    'Token: EXACT_ORIGINAL_TOKEN',
    ''
  ].join('\n'))
  runGit(['init'])
  runGit(['config', 'user.email', 'orchestrator-live-proof@example.invalid'])
  runGit(['config', 'user.name', 'Orchestrator Live Proof'])
  runGit(['add', 'live-review-proof.txt'])
  runGit(['commit', '-m', 'Initial proof fixture'])
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: process.env
  })
}

function readProofFile() {
  return readFileSync(join(workspaceDir, 'live-review-proof.txt'), 'utf8')
}

function writeArtifacts(result) {
  const normalizedDiffEvents = events.filter((event) => event.type === 'diff.updated')
  const payload = {
    ...result,
    createdAt: new Date().toISOString(),
    artifactRoot,
    workspaceDir,
    model,
    ephemeral,
    prompt,
    threadId,
    turnStartResult,
    observedTurnIds: [...turnIds],
    methods: [...new Set(methods)],
    methodCounts: methods.reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {}),
    serverRequests,
    eventTypes: [...new Set(events.map((event) => event.type))],
    diffNotifications,
    normalizedDiffEvents,
    rollbackAttempts,
    archiveAttempt,
    assistantText,
    turnStatus,
    finalFileText: safeReadProofFile(),
    finalGitDiff: safeGitDiff(),
    parseErrors,
    stderr: stderr.trim()
  }
  writeFileSync(join(artifactRoot, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(artifactRoot, 'raw.jsonl'), `${rawLines.join('\n')}\n`)
  return payload
}

function safeReadProofFile() {
  try {
    return readProofFile()
  } catch {
    return ''
  }
}

function safeGitDiff() {
  try {
    return runGit(['diff', '--', 'live-review-proof.txt'])
  } catch {
    return ''
  }
}

function finish(ok, reason) {
  if (failed) return
  failed = true
  clearTimeout(timeout)
  try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
  const result = writeArtifacts({ ok, reason })
  const summary = {
    ok,
    reason,
    artifactPath: join(artifactRoot, 'result.json'),
    rawPath: join(artifactRoot, 'raw.jsonl'),
    normalizedDiffEventCount: result.normalizedDiffEvents.length,
    checkpointIds: [...new Set(result.normalizedDiffEvents.map((event) => event.checkpointId).filter(Boolean))],
    rollbackAttempts: result.rollbackAttempts.map((attempt) => ({ label: attempt.label, ok: attempt.ok, error: attempt.error ?? null })),
    methods: result.methods
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(ok ? 0 : 1)
}

process.on('exit', () => {
  if (!failed && existsSync(artifactRoot)) {
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
  }
})
