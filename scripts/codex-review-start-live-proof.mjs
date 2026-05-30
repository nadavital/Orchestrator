#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, providerSpawnEnv, resolveProviderCommand } = await import(providersModulePath)

const provider = PROVIDERS.codex
const artifactRoot = process.env.CODEX_REVIEW_START_PROOF_ARTIFACT_DIR
  ? absolutePath(process.env.CODEX_REVIEW_START_PROOF_ARTIFACT_DIR)
  : join(repoRoot, 'tmp', 'codex-review-start-live-proof')
const workspaceDir = process.env.CODEX_REVIEW_START_PROOF_CWD
  ? absolutePath(process.env.CODEX_REVIEW_START_PROOF_CWD)
  : join(artifactRoot, 'workspace')
const timeoutMs = Number(process.env.CODEX_REVIEW_START_PROOF_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_REVIEW_START_PROOF_MODEL ?? 'gpt-5.4-mini'
const delivery = process.env.CODEX_REVIEW_START_PROOF_DELIVERY ?? 'inline'
const targetMode = process.env.CODEX_REVIEW_START_PROOF_TARGET ?? 'uncommittedChanges'
const ephemeral = process.env.CODEX_REVIEW_START_PROOF_EPHEMERAL !== 'false'
const archiveThread = process.env.CODEX_REVIEW_START_PROOF_ARCHIVE_THREAD !== 'false'

const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
if (!resolved) {
  console.error('codex CLI is not available.')
  process.exit(1)
}

resetArtifacts()
setupWorkspace()

function absolutePath(path) {
  return isAbsolute(path) ? path : resolve(repoRoot, path)
}

const child = spawn(resolved.binary, resolved.args, {
  cwd: workspaceDir,
  env: providerSpawnEnv('codex'),
  stdio: ['pipe', 'pipe', 'pipe']
})

let nextId = 1
let buffer = ''
let stderr = ''
let completed = false
let failed = false
let threadId = null
let reviewStartResult = null
let archiveAttempt = null
let assistantText = ''
let turnStatus = null
const pending = new Map()
const methods = []
const rawLines = []
const parseErrors = []
const events = []
const serverRequests = []
const reviewModeEvents = []
const itemTypes = []
const turnIds = new Set()

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
      name: 'orchestrator-review-start-live-proof',
      title: 'Orchestrator Review Start Live Proof',
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
    serviceName: 'orchestrator-review-start-live-proof',
    ephemeral,
    sessionStartSource: 'startup'
  })
  threadId = threadResult?.thread?.id ?? null
  if (!threadId) throw new Error('thread/start did not return a thread id')

  const reviewTarget = makeReviewTarget()
  reviewStartResult = await request('review/start', {
    threadId,
    target: reviewTarget,
    delivery
  })
  if (reviewStartResult?.turn?.id) turnIds.add(reviewStartResult.turn.id)

  await waitForCompletion()
  if (!ephemeral && archiveThread) await archiveProofThread()

  const normalizedReviewEvents = events.filter((event) => event.type === 'review.mode.changed')
  const sawEnteredItem = itemTypes.includes('enteredReviewMode')
  const sawExitedItem = itemTypes.includes('exitedReviewMode')
  const sawReviewThread = reviewStartResult?.reviewThreadId === threadId || typeof reviewStartResult?.reviewThreadId === 'string'
  const reviewCompleted = turnStatus === 'completed'

  if (reviewCompleted && sawReviewThread && sawEnteredItem && normalizedReviewEvents.length > 0) {
    finish(true, sawExitedItem
      ? 'live Codex review/start completed with entered/exited review-mode items'
      : 'live Codex review/start completed with entered review-mode item')
  } else if (!reviewCompleted) {
    finish(false, `review turn did not complete; status=${String(turnStatus)}`)
  } else if (!sawReviewThread) {
    finish(false, 'review/start did not return a reviewThreadId')
  } else if (!sawEnteredItem) {
    finish(false, 'review/start completed but emitted no enteredReviewMode item')
  } else {
    finish(false, 'review/start emitted review-mode item but provider normalization did not expose review.mode.changed')
  }
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

function makeReviewTarget() {
  if (targetMode === 'baseBranch') return { type: 'baseBranch', branch: 'review-base-branch' }
  if (targetMode === 'commit') return { type: 'commit', sha: runGit(['rev-parse', 'HEAD']).trim(), title: 'Initial proof fixture' }
  if (targetMode === 'custom') return { type: 'custom', instructions: 'Review live-review-target.txt for regressions introduced by the local diff.' }
  return { type: 'uncommittedChanges' }
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
  const id = `review-start-proof-${nextId++}`
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
    reviewModeEvents.push(...parsedEvents.filter((event) => event.type === 'review.mode.changed'))
  } catch (error) {
    parseErrors.push({ line, error: error instanceof Error ? error.message : String(error) })
  }

  if (message.method === 'turn/started') {
    const turnId = message.params?.turn?.id ?? message.params?.turnId
    if (turnId) turnIds.add(turnId)
  }
  if (message.method === 'item/agentMessage/delta') {
    assistantText += message.params?.delta ?? ''
  }
  if (message.method === 'item/completed') {
    const itemType = message.params?.item?.type
    if (itemType) itemTypes.push(itemType)
    if (itemType === 'agentMessage' && !assistantText) assistantText += message.params.item.text ?? ''
  }
  if (message.method === 'turn/completed') {
    completed = true
    turnStatus = message.params?.turn?.status ?? null
    const turnId = message.params?.turn?.id ?? message.params?.turnId
    if (turnId) turnIds.add(turnId)
  }

  if (message.id != null && !message.method) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
    return
  }

  if (message.id != null && message.method) {
    serverRequests.push({
      id: message.id,
      method: message.method,
      paramsPreview: preview(message.params)
    })
    answerServerRequest(message)
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
  send({ id: message.id, error: { code: -32601, message: 'Orchestrator review/start live proof does not implement this client request.' } })
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
  writeFileSync(join(workspaceDir, 'live-review-target.txt'), [
    'Live Codex Review start proof fixture.',
    'Before: strict validation exists.',
    ''
  ].join('\n'))
  runGit(['init'])
  runGit(['config', 'user.email', 'orchestrator-live-proof@example.invalid'])
  runGit(['config', 'user.name', 'Orchestrator Live Proof'])
  runGit(['add', 'live-review-target.txt'])
  runGit(['commit', '-m', 'Initial proof fixture'])
  runGit(['branch', 'review-base-branch'])
  writeFileSync(join(workspaceDir, 'live-review-target.txt'), [
    'Live Codex Review start proof fixture.',
    'After: strict validation is accidentally skipped when the target has trailing whitespace.   ',
    ''
  ].join('\n'))
  if (targetMode === 'baseBranch' || targetMode === 'commit') {
    runGit(['add', 'live-review-target.txt'])
    runGit(['commit', '-m', targetMode === 'baseBranch' ? 'Base branch review target' : 'Commit review target'])
  }
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: process.env
  })
}

function writeArtifacts(result) {
  const payload = {
    ...result,
    createdAt: new Date().toISOString(),
    artifactRoot,
    workspaceDir,
    model,
    ephemeral,
    targetMode,
    delivery,
    target: safeTargetForArtifacts(),
    threadId,
    reviewStartResult,
    reviewThreadId: reviewStartResult?.reviewThreadId ?? null,
    observedTurnIds: [...turnIds],
    methods: [...new Set(methods)],
    methodCounts: methods.reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {}),
    serverRequests,
    itemTypes: [...new Set(itemTypes)],
    eventTypes: [...new Set(events.map((event) => event.type))],
    reviewModeEvents,
    assistantText,
    turnStatus,
    finalGitDiff: safeGitDiff(),
    finalBaseBranchDiff: safeBaseBranchDiff(),
    archiveAttempt,
    parseErrors,
    stderr: stderr.trim()
  }
  writeFileSync(join(artifactRoot, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(artifactRoot, 'raw.jsonl'), `${rawLines.join('\n')}\n`)
  return payload
}

function safeTargetForArtifacts() {
  try {
    return makeReviewTarget()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function safeGitDiff() {
  try {
    return runGit(['diff', '--', 'live-review-target.txt'])
  } catch {
    return ''
  }
}

function safeBaseBranchDiff() {
  try {
    return runGit(['diff', 'review-base-branch...HEAD', '--', 'live-review-target.txt'])
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
    targetMode,
    delivery,
    reviewThreadId: result.reviewThreadId,
    reviewModeEventCount: result.reviewModeEvents.length,
    itemTypes: result.itemTypes,
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
