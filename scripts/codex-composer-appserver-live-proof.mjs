#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, codexRuntimePolicyConfig, providerSpawnEnv, resolveProviderCommand } = await import(providersModulePath)

const provider = PROVIDERS.codex
const artifactRoot = resolve(process.env.CODEX_COMPOSER_PROOF_ARTIFACT_DIR
  ? process.env.CODEX_COMPOSER_PROOF_ARTIFACT_DIR
  : join(repoRoot, 'tmp', 'codex-composer-appserver-live-proof'))
const workspaceDir = resolve(process.env.CODEX_COMPOSER_PROOF_CWD ?? join(artifactRoot, 'workspace'))
const timeoutMs = Number(process.env.CODEX_COMPOSER_PROOF_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_COMPOSER_PROOF_MODEL ?? 'gpt-5.4-mini'
const effort = process.env.CODEX_COMPOSER_PROOF_EFFORT ?? 'low'
const executionPolicy = process.env.CODEX_COMPOSER_PROOF_POLICY ?? 'default'
const requireApproval = process.env.CODEX_COMPOSER_PROOF_REQUIRE_APPROVAL === '1'
const requireUserInput = process.env.CODEX_COMPOSER_PROOF_REQUIRE_USER_INPUT === '1'
const expectedToken = 'CODEX_COMPOSER_LIVE_OK'
const proofFileName = requireUserInput
  ? 'live-composer-user-input-proof.txt'
  : requireApproval
    ? 'live-composer-approval-proof.txt'
    : 'live-composer-permission-proof.txt'
const proofToken = requireUserInput
  ? 'CODEX_COMPOSER_USER_INPUT_OK'
  : requireApproval
    ? 'CODEX_COMPOSER_APPROVAL_OK'
    : 'CODEX_COMPOSER_PERMISSION_OK'
const proofFilePath = requireApproval ? join(artifactRoot, proofFileName) : join(workspaceDir, proofFileName)
const workspaceSeedFileName = 'live-composer-permission-proof.txt'
const commandText = requireApproval
  ? `printf '${proofToken}\\n' > ../${proofFileName}`
  : `printf '${proofToken}\\n' > ${proofFileName}`
const prompt = process.env.CODEX_COMPOSER_PROOF_PROMPT ?? [
  requireUserInput
    ? 'This is a live Orchestrator/Codex app-server user-input proof in a disposable git workspace.'
    : requireApproval
      ? 'This is a live Orchestrator/Codex app-server approval-card proof in a disposable git workspace.'
      : 'This is a live Orchestrator/Codex app-server Composer model and permission proof in a disposable git workspace.',
  requireUserInput
    ? 'First use the native user-input request tool to ask exactly this question: Which proof token should I write? Use a single question id named proof-token if the tool allows ids. After the client answers, use command execution to write exactly the answer you received followed by a newline to live-composer-user-input-proof.txt in the current workspace.'
    : `Use command execution to run exactly this command: ${commandText}`,
  'Do not edit any other file.',
  `After the command succeeds, reply with exactly ${expectedToken}.`
].join(' ')

const policy = codexRuntimePolicyConfig(executionPolicy)
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
let threadStartResult = null
let turnStartResult = null
let threadStartParams = null
let turnStartParams = null
const pending = new Map()
const methods = []
const rawLines = []
const parseErrors = []
const events = []
const serverRequests = []
const permissionRequests = []
const permissionResponses = []
const userInputRequests = []
const userInputResponses = []
const commandExecutions = []
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
      name: 'orchestrator-composer-live-proof',
      title: 'Orchestrator Composer Live Proof',
      version: '1.0.0'
    },
    capabilities: { experimentalApi: true }
  })
  notify('initialized')

  threadStartParams = {
    model,
    cwd: workspaceDir,
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer,
    sandbox: policy.sandboxMode,
    config: effort ? { model_reasoning_effort: effort } : {},
    serviceName: 'orchestrator-composer-live-proof',
    personality: 'friendly',
    ephemeral: true,
    sessionStartSource: 'startup'
  }
  threadStartResult = await request('thread/start', threadStartParams)
  threadId = threadStartResult?.thread?.id ?? null
  if (!threadId) throw new Error('thread/start did not return a thread id')

  turnStartParams = {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    cwd: workspaceDir,
    model,
    effort,
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer
  }
  turnStartResult = await request('turn/start', turnStartParams)
  if (turnStartResult?.turn?.id) turnIds.add(turnStartResult.turn.id)

  await waitForCompletion()
  const fileText = safeReadProofFile()
  const gitDiff = requireApproval ? '' : runGit(['diff', '--', proofFileName])
  const assistantSawOk = assistantText.includes(expectedToken)
  const editApplied = fileText.includes(proofToken) && (requireApproval || gitDiff.includes(proofToken))
  const commandCompleted = commandExecutions.some((execution) =>
    execution.method === 'item/completed' &&
    execution.status === 'completed' &&
    execution.command.includes(proofToken)
  )
  const approvalRoundTrip = !requireApproval || (
    permissionRequests.length > 0 &&
    permissionResponses.length > 0 &&
    permissionRequests.some((request) => request.method === 'item/commandExecution/requestApproval')
  )
  const userInputRoundTrip = !requireUserInput || (
    userInputRequests.length > 0 &&
    userInputResponses.length > 0 &&
    userInputRequests.some((request) => request.method === 'item/tool/requestUserInput')
  )
  const threadPolicyMatches = threadStartResult?.model === model &&
    threadStartResult?.approvalPolicy === policy.approvalPolicy &&
    threadStartResult?.approvalsReviewer === policy.approvalsReviewer &&
    sandboxMatches(threadStartResult?.sandbox, policy.sandboxMode) &&
    (effort ? threadStartResult?.reasoningEffort === effort : true)
  const userInputUnavailable = requireUserInput &&
    /request_user_input is unavailable/i.test(`${stderr}\n${assistantText}`)

  if (editApplied && assistantSawOk && commandCompleted && threadPolicyMatches && approvalRoundTrip && userInputRoundTrip) {
    finish(true, requireUserInput
      ? 'live Codex app-server requested user input, accepted the client answer, and completed the answer-dependent command'
      : requireApproval
        ? 'live Codex app-server requested command approval, accepted the client response, and completed the approved command'
        : 'live Codex app-server accepted composer model/policy config and completed command execution under the managed permission profile')
  } else if (!threadPolicyMatches) {
    finish(false, 'live Codex app-server thread/start response did not match the requested model/policy config')
  } else if (!approvalRoundTrip) {
    finish(false, 'live Codex app-server did not complete a command approval request/response round trip')
  } else if (userInputUnavailable) {
    finish(false, 'live Codex app-server reported request_user_input is unavailable in Default mode')
  } else if (!userInputRoundTrip) {
    finish(false, 'live Codex app-server did not complete a user-input request/response round trip')
  } else if (!commandCompleted) {
    finish(false, 'live Codex app-server completed without a completed commandExecution item for the proof command')
  } else if (!editApplied) {
    finish(false, 'live Codex app-server completed but did not leave the requested file edit in git diff')
  } else {
    finish(false, `live Codex app-server edit/command succeeded but assistant token was missing: ${assistantText.trim()}`)
  }
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

function request(method, params) {
  const id = `composer-proof-${nextId++}`
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
  if ((message.method === 'item/started' || message.method === 'item/completed') && message.params?.item?.type === 'commandExecution') {
    commandExecutions.push({
      method: message.method,
      id: message.params.item.id ?? null,
      command: message.params.item.command ?? '',
      status: message.params.item.status ?? null,
      exitCode: message.params.item.exitCode ?? null,
      cwd: message.params.item.cwd ?? null
    })
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
    const requestSummary = {
      id: message.id,
      method: message.method,
      paramsPreview: preview(message.params)
    }
    serverRequests.push(requestSummary)
    answerServerRequest(message, requestSummary)
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

function answerServerRequest(message, requestSummary) {
  if (
    message.method === 'item/commandExecution/requestApproval' ||
    message.method === 'item/fileChange/requestApproval' ||
    message.method === 'item/permissions/requestApproval' ||
    message.method === 'applyPatchApproval' ||
    message.method === 'execCommandApproval'
  ) {
    permissionRequests.push(requestSummary)
    const result = message.method === 'item/permissions/requestApproval'
      ? { permissions: message.params?.permissions ?? {}, scope: 'turn' }
      : { decision: 'accept' }
    permissionResponses.push({ id: message.id, result })
    send({ id: message.id, result })
    return
  }
  if (message.method === 'mcpServer/elicitation/request') {
    send({ id: message.id, result: { action: 'decline', content: null, _meta: null } })
    return
  }
  if (message.method === 'item/tool/requestUserInput') {
    userInputRequests.push(requestSummary)
    const questions = Array.isArray(message.params?.questions) ? message.params.questions : []
    const answers = {}
    for (const question of questions) {
      const id = typeof question?.id === 'string' && question.id.length > 0
        ? question.id
        : typeof question?.question === 'string' && question.question.length > 0
          ? question.question
          : 'answer'
      answers[id] = { answers: [proofToken] }
    }
    if (Object.keys(answers).length === 0) answers.answer = { answers: [proofToken] }
    const result = { answers }
    userInputResponses.push({ id: message.id, result })
    send({ id: message.id, result })
    return
  }
  send({ id: message.id, error: { code: -32601, message: 'Orchestrator composer live proof does not implement this client request.' } })
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

function sandboxMatches(actual, expected) {
  if (expected === 'workspace-write') return actual === 'workspace-write' || actual?.type === 'workspaceWrite'
  if (expected === 'danger-full-access') return actual === 'danger-full-access' || actual?.type === 'dangerFullAccess'
  return actual === expected || actual?.type === expected
}

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(workspaceDir, { recursive: true })
}

function setupWorkspace() {
  writeFileSync(join(workspaceDir, workspaceSeedFileName), [
    'Live Codex Composer proof fixture.',
    'Token: EXACT_ORIGINAL_TOKEN',
    ''
  ].join('\n'))
  runGit(['init'])
  runGit(['config', 'user.email', 'orchestrator-live-proof@example.invalid'])
  runGit(['config', 'user.name', 'Orchestrator Live Proof'])
  runGit(['add', workspaceSeedFileName])
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
  return readFileSync(proofFilePath, 'utf8')
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
    requireApproval,
    requireUserInput,
    policy,
    prompt,
    threadId,
    threadStartParams,
    threadStartResult,
    turnStartParams,
    turnStartResult,
    observedTurnIds: [...turnIds],
    methods: [...new Set(methods)],
    methodCounts: methods.reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {}),
    serverRequests,
    permissionRequests,
    permissionResponses,
    userInputRequests,
    userInputResponses,
    commandExecutions,
    eventTypes: [...new Set(events.map((event) => event.type))],
    events,
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
    return runGit(['diff', '--', proofFileName])
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
    model: result.model,
    effort: result.effort,
    executionPolicy: result.executionPolicy,
    requireApproval: result.requireApproval,
    requireUserInput: result.requireUserInput,
    permissionRequestCount: result.permissionRequests.length,
    userInputRequestCount: result.userInputRequests.length,
    commandExecutionCount: result.commandExecutions.length,
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
