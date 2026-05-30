#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, codexRuntimePolicyConfig, providerSpawnEnv, resolveProviderCommand } = await import(providersModulePath)

const provider = PROVIDERS.codex
const artifactRoot = resolve(process.env.CODEX_COMPOSER_RESUME_ARTIFACT_DIR ?? join(repoRoot, 'tmp', 'codex-composer-resume-live-proof'))
const workspaceDir = resolve(process.env.CODEX_COMPOSER_RESUME_CWD ?? join(artifactRoot, 'workspace'))
const timeoutMs = Number(process.env.CODEX_COMPOSER_RESUME_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_COMPOSER_RESUME_MODEL ?? 'gpt-5.4-mini'
const effort = process.env.CODEX_COMPOSER_RESUME_EFFORT ?? 'low'
const executionPolicy = process.env.CODEX_COMPOSER_RESUME_POLICY ?? 'default'
const firstToken = 'CODEX_RESUME_FIRST_OK'
const secondToken = 'CODEX_RESUME_SECOND_OK'
const memoryToken = 'ORCH_RESUME_MEMORY_741'
const firstPrompt = process.env.CODEX_COMPOSER_RESUME_FIRST_PROMPT ?? [
  'This is a live Orchestrator/Codex app-server resume proof.',
  'Do not run tools.',
  `Remember this proof key for the next turn: ${memoryToken}.`,
  `Reply with exactly ${firstToken}.`
].join(' ')
const secondPrompt = process.env.CODEX_COMPOSER_RESUME_SECOND_PROMPT ?? [
  'This is the resumed turn in the same provider thread.',
  'Do not run tools.',
  `Reply with exactly ${secondToken}: followed by the proof key I asked you to remember in the previous turn.`
].join(' ')

const policy = codexRuntimePolicyConfig(executionPolicy)
const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
if (!resolved) {
  console.error('codex CLI is not available.')
  process.exit(1)
}

resetArtifacts()

let firstRun = null
let secondRun = null
let archiveAttempt = null

try {
  firstRun = await runPhase({
    phase: 'start',
    method: 'thread/start',
    prompt: firstPrompt,
    expectedText: firstToken
  })
  if (!firstRun.threadId) throw new Error('first phase did not return a thread id')
  secondRun = await runPhase({
    phase: 'resume',
    method: 'thread/resume',
    threadId: firstRun.threadId,
    prompt: secondPrompt,
    expectedText: `${secondToken}:${memoryToken}`
  })
  archiveAttempt = await archiveProofThread(firstRun.threadId)

  const resumedSameThread = secondRun.threadId === firstRun.threadId
  const sawResumeMethod = secondRun.methods.includes('thread/resumed') || secondRun.requestMethods.includes('thread/resume')
  const firstOk = firstRun.assistantText.includes(firstToken)
  const secondOk = new RegExp(`${escapeRegExp(secondToken)}\\s*:\\s*${escapeRegExp(memoryToken)}`).test(secondRun.assistantText)
  if (firstOk && secondOk && resumedSameThread && sawResumeMethod) {
    finish(true, 'live Codex app-server resumed an existing provider thread from a fresh process and preserved turn context')
  } else if (!resumedSameThread) {
    finish(false, 'thread/resume did not return the original thread id')
  } else if (!sawResumeMethod) {
    finish(false, 'resume phase did not record thread/resume activity')
  } else if (!firstOk) {
    finish(false, `first turn did not include ${firstToken}: ${firstRun.assistantText.trim()}`)
  } else {
    finish(false, `resumed turn did not include ${secondToken}:${memoryToken}: ${secondRun.assistantText.trim()}`)
  }
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

async function runPhase({ phase, method, threadId, prompt, expectedText }) {
  const child = spawn(resolved.binary, resolved.args, {
    cwd: workspaceDir,
    env: providerSpawnEnv('codex'),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const state = {
    phase,
    method,
    expectedText,
    child,
    nextId: 1,
    buffer: '',
    stderr: '',
    assistantText: '',
    completed: false,
    failed: false,
    threadId: threadId ?? null,
    turnStatus: null,
    turnStartResult: null,
    threadResult: null,
    pending: new Map(),
    requestMethods: [],
    methods: [],
    rawLines: [],
    parseErrors: [],
    events: [],
    serverRequests: [],
    turnIds: new Set()
  }
  const abortPromise = new Promise((_, reject) => {
    state.rejectPhase = reject
  })

  const phaseTimeout = setTimeout(() => {
    rejectPhase(state, `timed out after ${timeoutMs}ms`)
  }, timeoutMs)

  child.stderr.on('data', (chunk) => {
    state.stderr += chunk.toString('utf8')
  })
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk.toString('utf8')
    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(state, line.trim())
  })
  child.on('error', (error) => {
    rejectPhase(state, error.message)
  })
  child.on('exit', (code, signal) => {
    if (state.failed || state.completed) return
    rejectPhase(state, `codex app-server exited before completion (${signal ?? code ?? 'unknown'})`)
  })

  try {
    await request(state, 'initialize', {
      clientInfo: {
        name: `orchestrator-composer-resume-proof-${phase}`,
        title: 'Orchestrator Composer Resume Proof',
        version: '1.0.0'
      },
      capabilities: { experimentalApi: true }
    })
    notify(state, 'initialized')
    const threadConfig = {
      model,
      cwd: workspaceDir,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandbox: policy.sandboxMode,
      config: effort ? { model_reasoning_effort: effort } : {},
      serviceName: 'orchestrator-composer-resume-proof',
      personality: 'friendly'
    }
    const threadParams = method === 'thread/resume'
      ? { ...threadConfig, threadId, excludeTurns: true }
      : { ...threadConfig, ephemeral: false, sessionStartSource: 'startup' }
    state.threadResult = await request(state, method, threadParams)
    const resultThreadId = state.threadResult?.thread?.id ?? state.threadResult?.threadId ?? threadId ?? null
    if (!resultThreadId) throw new Error(`${method} did not return a thread id`)
    state.threadId = resultThreadId

    state.turnStartResult = await request(state, 'turn/start', {
      threadId: resultThreadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      cwd: workspaceDir,
      model,
      effort,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer
    })
    if (state.turnStartResult?.turn?.id) state.turnIds.add(state.turnStartResult.turn.id)

    await Promise.race([waitForCompletion(state), abortPromise])
    clearTimeout(phaseTimeout)
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
    return summarizePhase(state)
  } catch (error) {
    clearTimeout(phaseTimeout)
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
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
  const state = {
    phase: 'archive',
    method: 'thread/archive',
    expectedText: '',
    child,
    nextId: 1,
    buffer: '',
    stderr: '',
    assistantText: '',
    completed: false,
    failed: false,
    threadId,
    turnStatus: null,
    turnStartResult: null,
    threadResult: null,
    pending: new Map(),
    requestMethods: [],
    methods: [],
    rawLines: [],
    parseErrors: [],
    events: [],
    serverRequests: [],
    turnIds: new Set()
  }
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk.toString('utf8')
  })
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk.toString('utf8')
    const lines = state.buffer.split('\n')
    state.buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(state, line.trim())
  })
  try {
    await request(state, 'initialize', {
      clientInfo: {
        name: 'orchestrator-composer-resume-proof-archive',
        title: 'Orchestrator Composer Resume Proof',
        version: '1.0.0'
      },
      capabilities: { experimentalApi: true }
    })
    notify(state, 'initialized')
    const result = await request(state, 'thread/archive', { threadId })
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
    return { ok: true, result: preview(result), stderr: state.stderr.trim() }
  } catch (error) {
    try { child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
    return { ok: false, error: error instanceof Error ? error.message : String(error), stderr: state.stderr.trim() }
  }
}

function request(state, method, params) {
  const id = `${state.phase}-proof-${state.nextId++}`
  state.requestMethods.push(method)
  send(state, { method, id, params })
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject, method })
  })
}

function notify(state, method, params) {
  send(state, params === undefined ? { method } : { method, params })
}

function send(state, message) {
  state.child.stdin.write(`${JSON.stringify(message)}\n`)
}

function handleLine(state, line) {
  if (!line) return
  state.rawLines.push(line)
  let message
  try {
    message = JSON.parse(line)
  } catch {
    state.parseErrors.push({ line, error: 'invalid json' })
    return
  }

  if (message.method) state.methods.push(message.method)
  try {
    const parsedEvents = provider.parseOutputLine(line)
    state.events.push(...parsedEvents)
  } catch (error) {
    state.parseErrors.push({ line, error: error instanceof Error ? error.message : String(error) })
  }

  if (message.method === 'turn/started') {
    const turnId = message.params?.turn?.id ?? message.params?.turnId
    if (turnId) state.turnIds.add(turnId)
  }
  if (message.id != null && !message.method) {
    const waiter = state.pending.get(message.id)
    if (!waiter) return
    state.pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
    return
  }
  if (message.id != null && message.method) {
    state.serverRequests.push({
      id: message.id,
      method: message.method,
      paramsPreview: preview(message.params)
    })
    answerServerRequest(state, message)
    return
  }
  if (message.method === 'item/agentMessage/delta') {
    state.assistantText += message.params?.delta ?? ''
  } else if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage' && !state.assistantText) {
    state.assistantText += message.params.item.text ?? ''
  } else if (message.method === 'turn/completed') {
    state.turnStatus = message.params?.turn?.status ?? null
    const turnId = message.params?.turn?.id ?? message.params?.turnId
    if (turnId) state.turnIds.add(turnId)
    if (state.turnStatus && state.turnStatus !== 'completed') {
      rejectPhase(state, `turn completed with status ${state.turnStatus}`)
      return
    }
    state.completed = true
  }
}

function answerServerRequest(state, message) {
  if (
    message.method === 'item/commandExecution/requestApproval' ||
    message.method === 'item/fileChange/requestApproval'
  ) {
    send(state, { id: message.id, result: { decision: 'accept' } })
    return
  }
  if (message.method === 'item/permissions/requestApproval') {
    send(state, { id: message.id, result: { permissions: message.params?.permissions ?? {}, scope: 'turn' } })
    return
  }
  if (message.method === 'mcpServer/elicitation/request') {
    send(state, { id: message.id, result: { action: 'decline', content: null, _meta: null } })
    return
  }
  send(state, { id: message.id, error: { code: -32601, message: 'Orchestrator composer resume proof does not implement this client request.' } })
}

function waitForCompletion(state) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!state.completed) return
      clearInterval(interval)
      resolve()
    }, 100)
  })
}

function rejectPhase(state, reason) {
  if (state.failed) return
  state.failed = true
  try { state.child.kill('SIGTERM') } catch { /* ignore cleanup races */ }
  state.rejectPhase?.(new Error(`${state.phase}: ${reason}`))
}

function summarizePhase(state) {
  return {
    phase: state.phase,
    method: state.method,
    expectedText: state.expectedText,
    threadId: state.threadId,
    threadResult: state.threadResult,
    turnStartResult: state.turnStartResult,
    observedTurnIds: [...state.turnIds],
    requestMethods: state.requestMethods,
    methods: [...new Set(state.methods)],
    methodCounts: state.methods.reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {}),
    serverRequests: state.serverRequests,
    eventTypes: [...new Set(state.events.map((event) => event.type))],
    events: state.events,
    assistantText: state.assistantText,
    turnStatus: state.turnStatus,
    parseErrors: state.parseErrors,
    stderr: state.stderr.trim(),
    rawPath: writePhaseRaw(state)
  }
}

function writePhaseRaw(state) {
  const rawPath = join(artifactRoot, `${state.phase}.raw.jsonl`)
  writeFileSync(rawPath, `${state.rawLines.join('\n')}\n`)
  return rawPath
}

function preview(value) {
  const text = JSON.stringify(value ?? null)
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'resume-proof-workspace.txt'), 'Live Codex resume proof workspace.\n')
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
    secondPrompt,
    firstToken,
    secondToken,
    memoryToken,
    firstRun,
    secondRun,
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
    firstThreadId: result.firstRun?.threadId ?? null,
    secondThreadId: result.secondRun?.threadId ?? null,
    archiveAttempt: result.archiveAttempt ? { ok: result.archiveAttempt.ok, error: result.archiveAttempt.error ?? null } : null,
    firstMethods: result.firstRun?.methods ?? [],
    secondMethods: result.secondRun?.methods ?? []
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(ok ? 0 : 1)
}
