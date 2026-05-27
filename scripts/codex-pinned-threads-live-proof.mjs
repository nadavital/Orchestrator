#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, providerSpawnEnv, resolveProviderCommand } = await import(providersModulePath)

const provider = PROVIDERS.codex
const artifactRoot = process.env.CODEX_PINNED_THREADS_PROOF_ARTIFACT_DIR
  ? process.env.CODEX_PINNED_THREADS_PROOF_ARTIFACT_DIR
  : join(repoRoot, 'tmp', 'codex-pinned-threads-live-proof')
const workspaceRoot = process.env.CODEX_PINNED_THREADS_PROOF_CWD
  ? process.env.CODEX_PINNED_THREADS_PROOF_CWD
  : join(artifactRoot, 'workspace')
const timeoutMs = Number(process.env.CODEX_PINNED_THREADS_PROOF_TIMEOUT_MS ?? 60_000)
const model = process.env.CODEX_PINNED_THREADS_PROOF_MODEL ?? 'gpt-5.4-mini'

const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
if (!resolved) {
  console.error('codex CLI is not available.')
  process.exit(1)
}

resetArtifacts()

const child = spawn(resolved.binary, resolved.args, {
  cwd: workspaceRoot,
  env: providerSpawnEnv('codex'),
  stdio: ['pipe', 'pipe', 'pipe']
})

let nextId = 1
let stdoutBuffer = ''
let stderr = ''
let finished = false
let failed = false
const pending = new Map()
const methods = []
const unsupportedMethods = []
const rawLines = []
const createdThreadIds = []
let beforePinnedThreadIds = []
let afterPinThreadIds = []
let afterOrderThreadIds = []
let cleanupPinnedThreadIds = []
let pinRoundTrip = false
let orderRoundTrip = false
let cleanupRemoved = false

const timeout = setTimeout(() => {
  finish(false, `timed out after ${timeoutMs}ms`)
}, timeoutMs)

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8')
})

child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString('utf8')
  const lines = stdoutBuffer.split('\n')
  stdoutBuffer = lines.pop() ?? ''
  for (const line of lines) handleLine(line.trim())
})

child.on('error', (error) => {
  finish(false, error.message)
})

child.on('exit', (code, signal) => {
  if (failed || finished) return
  finish(false, `codex app-server exited before proof completed (${signal ?? code ?? 'unknown'})`)
})

try {
  await request('initialize', {
    clientInfo: {
      name: 'orchestrator-pinned-threads-live-proof',
      title: 'Orchestrator Pinned Threads Live Proof',
      version: '1.0.0'
    },
    capabilities: { experimentalApi: true }
  })
  notify('initialized')

  beforePinnedThreadIds = pinnedThreadIdsFromList(await request('list-pinned-threads', {}))
  const first = await startDisposableThread('first')
  const second = await startDisposableThread('second')
  createdThreadIds.push(first, second)

  await request('set-thread-pinned', { threadId: first, pinned: true })
  await request('set-thread-pinned', { threadId: second, pinned: true })
  afterPinThreadIds = pinnedThreadIdsFromList(await request('list-pinned-threads', {}))
  pinRoundTrip = afterPinThreadIds.includes(first) && afterPinThreadIds.includes(second)
  if (!pinRoundTrip) {
    throw new Error(`Pinned list did not include disposable threads after pinning: ${JSON.stringify(afterPinThreadIds)}`)
  }

  const preservedPinnedIds = afterPinThreadIds.filter((threadId) => threadId !== first && threadId !== second)
  await request('set-pinned-threads-order', { threadIds: [...preservedPinnedIds, second, first] })
  afterOrderThreadIds = pinnedThreadIdsFromList(await request('list-pinned-threads', {}))
  orderRoundTrip = disposableOrder(afterOrderThreadIds, first, second).join('|') === [second, first].join('|')
  if (!orderRoundTrip) {
    throw new Error(`Pinned list did not preserve requested disposable order: ${JSON.stringify(afterOrderThreadIds)}`)
  }

  await cleanupDisposableThreads()
  cleanupRemoved = createdThreadIds.every((threadId) => !cleanupPinnedThreadIds.includes(threadId))
  if (!cleanupRemoved) {
    throw new Error(`Cleanup left disposable pinned threads behind: ${JSON.stringify(cleanupPinnedThreadIds)}`)
  }

  finish(true, 'live Codex app-server pinned thread pin/list/order proof completed with disposable threads')
} catch (error) {
  await cleanupDisposableThreads().catch(() => {})
  finish(false, error instanceof Error ? error.message : String(error))
}

async function startDisposableThread(label) {
  const result = await request('thread/start', {
    model,
    cwd: workspaceRoot,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    serviceName: 'orchestrator-pinned-threads-live-proof',
    ephemeral: true,
    sessionStartSource: 'startup',
    initialMessages: [{
      type: 'user',
      content: [{
        type: 'input_text',
        text: `Disposable pinned thread proof ${label}. No turn will be started.`
      }]
    }]
  })
  const threadId = result?.thread?.id
  if (typeof threadId !== 'string' || threadId.trim().length === 0) {
    throw new Error(`thread/start did not return a thread id for ${label}`)
  }
  return threadId
}

async function cleanupDisposableThreads() {
  if (createdThreadIds.length === 0) return
  for (const threadId of createdThreadIds) {
    await request('set-thread-pinned', { threadId, pinned: false }).catch(() => {})
  }
  const currentIds = pinnedThreadIdsFromList(await request('list-pinned-threads', {}).catch(() => []))
  const restoredOrder = currentIds.filter((threadId) => !createdThreadIds.includes(threadId))
  if (restoredOrder.length > 0) {
    await request('set-pinned-threads-order', { threadIds: restoredOrder }).catch(() => {})
  }
  cleanupPinnedThreadIds = pinnedThreadIdsFromList(await request('list-pinned-threads', {}).catch(() => restoredOrder))
}

function request(method, params) {
  const id = `pinned-proof-${nextId++}`
  methods.push(method)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method })
  })
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params })}\n`)
}

function handleLine(line) {
  if (!line) return
  rawLines.push(line)
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) {
    const messageText = JSON.stringify(message.error)
    if (messageText.includes('unknown variant')) unsupportedMethods.push(waiter.method)
    waiter.reject(new Error(messageText))
  } else {
    waiter.resolve(message.result)
  }
}

function pinnedThreadIdsFromList(result) {
  const values = Array.isArray(result)
    ? result
    : Array.isArray(result?.threadIds)
      ? result.threadIds
      : Array.isArray(result?.threads)
        ? result.threads.map((thread) => typeof thread === 'object' && thread !== null ? thread.id : thread)
        : Array.isArray(result?.data)
          ? result.data.map((thread) => typeof thread === 'object' && thread !== null ? thread.id : thread)
          : []
  const seen = new Set()
  const ids = []
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function disposableOrder(ids, first, second) {
  return ids.filter((threadId) => threadId === first || threadId === second)
}

function finish(ok, message) {
  if (finished) return
  finished = true
  failed = !ok
  clearTimeout(timeout)
  const result = {
    ok,
    message,
    createdAt: new Date().toISOString(),
    model,
    workspaceRoot,
    methods,
    unsupportedMethods: [...new Set(unsupportedMethods)],
    createdThreadIds,
    beforePinnedThreadIds,
    afterPinThreadIds,
    afterOrderThreadIds,
    cleanupPinnedThreadIds,
    pinRoundTrip,
    orderRoundTrip,
    cleanupRemoved,
    stderr: stderr.trim().slice(-4000),
    rawLineCount: rawLines.length
  }
  writeFileSync(join(artifactRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  try { child.kill('SIGTERM') } catch { /* ignore */ }
  if (ok) {
    console.log(message)
    console.log(join(artifactRoot, 'result.json'))
    process.exit(0)
  }
  console.error(message)
  console.error(join(artifactRoot, 'result.json'))
  process.exit(1)
}

function resetArtifacts() {
  if (existsSync(artifactRoot)) rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, 'README.md'), 'Disposable workspace for Orchestrator Codex pinned thread live proof.\n')
}
