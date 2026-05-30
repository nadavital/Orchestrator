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
const pinMutationMethods = [
  { method: 'list-pinned-threads', params: {} },
  { method: 'set-thread-pinned', params: { threadId: 'orchestrator-disposable-pin-boundary', pinned: true } },
  { method: 'set-pinned-threads-order', params: { threadIds: ['orchestrator-disposable-pin-boundary'] } }
]

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
const requestFailures = []
const rawLines = []
const unsupportedPinMethodResults = []
let threadListResult = null
let threadListThreadIds = []
let threadListSupported = false
let pinMutationBoundaryProven = false
let schemaAdvertisesThreadMetadataUpdate = false

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

  threadListResult = await request('thread/list', { limit: 5, cwd: workspaceRoot, useStateDbOnly: true })
  threadListThreadIds = threadIdsFromThreadList(threadListResult)
  threadListSupported = true

  for (const spec of pinMutationMethods) {
    await probeUnsupportedPinMethod(spec.method, spec.params)
  }

  const unsupportedPinMethods = new Set(
    unsupportedPinMethodResults
      .filter((result) => result.unsupported === true)
      .map((result) => result.method)
  )
  pinMutationBoundaryProven = pinMutationMethods.every((spec) => unsupportedPinMethods.has(spec.method))

  if (!pinMutationBoundaryProven) {
    throw new Error(`Codex app-server unexpectedly accepted a pinned-thread mutation method: ${JSON.stringify(unsupportedPinMethodResults)}`)
  }

  finish(true, 'live Codex app-server pinned-thread mutation boundary is unavailable; thread/list remains supported')
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

async function probeUnsupportedPinMethod(method, params) {
  const failureStart = requestFailures.length
  try {
    const result = await request(method, params)
    unsupportedPinMethodResults.push({
      method,
      unsupported: false,
      accepted: true,
      resultType: Array.isArray(result) ? 'array' : typeof result
    })
  } catch (error) {
    const failure = requestFailures.slice(failureStart).find((candidate) => candidate.method === method)
    const message = failure?.message ?? (error instanceof Error ? error.message : String(error))
    if (message.includes('thread/metadata/update')) schemaAdvertisesThreadMetadataUpdate = true
    unsupportedPinMethodResults.push({
      method,
      unsupported: isUnsupportedMethodError(message),
      accepted: false,
      error: failure?.error ?? message
    })
  }
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
    requestFailures.push({
      id: message.id,
      method: waiter.method,
      error: message.error,
      message: messageText
    })
    if (isUnsupportedMethodError(messageText)) unsupportedMethods.push(waiter.method)
    waiter.reject(new Error(messageText))
  } else {
    waiter.resolve(message.result)
  }
}

function threadIdsFromThreadList(result) {
  const values = Array.isArray(result)
    ? result.map((thread) => typeof thread === 'object' && thread !== null ? thread.id : thread)
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

function isUnsupportedMethodError(messageText) {
  const lower = messageText.toLowerCase()
  return lower.includes('unknown variant') ||
    lower.includes('method not found') ||
    lower.includes('unknown method') ||
    lower.includes('unsupported') ||
    lower.includes('not supported')
}

function finish(ok, message) {
  if (finished) return
  finished = true
  failed = !ok
  clearTimeout(timeout)
  const requestFailureMethods = [...new Set(requestFailures.map((failure) => failure.method))]
  const result = {
    ok,
    message,
    reason: message,
    createdAt: new Date().toISOString(),
    workspaceRoot,
    methods,
    status: ok && pinMutationBoundaryProven ? 'unavailable' : 'failed',
    threadListSupported,
    threadListThreadCount: threadListThreadIds.length,
    threadListThreadIds,
    schemaAdvertisesThreadMetadataUpdate,
    pinMutationBoundaryProven,
    unsupportedPinMethodResults,
    unsupportedMethods: [...new Set(unsupportedMethods)],
    failedMethod: requestFailureMethods[0] ?? null,
    requestFailureMethods,
    requestFailures,
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
  writeFileSync(join(workspaceRoot, 'README.md'), 'Disposable workspace for Orchestrator Codex pinned-thread boundary proof.\n')
}
