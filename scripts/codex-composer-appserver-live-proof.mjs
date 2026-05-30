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
const requirePlan = process.env.CODEX_COMPOSER_PROOF_REQUIRE_PLAN === '1'
const requireGoal = process.env.CODEX_COMPOSER_PROOF_REQUIRE_GOAL === '1'
const expectedToken = 'CODEX_COMPOSER_LIVE_OK'
const goalObjective = process.env.CODEX_COMPOSER_PROOF_GOAL_OBJECTIVE ?? 'Record live Codex goal evidence'
const enabledProofModes = [requireApproval, requireUserInput, requirePlan, requireGoal].filter(Boolean).length
if (enabledProofModes > 1) {
  console.error('Only one CODEX_COMPOSER_PROOF_REQUIRE_* mode can be enabled at a time.')
  process.exit(1)
}
const proofFileName = requireGoal
  ? 'live-composer-goal-proof.txt'
  : requirePlan
  ? 'live-composer-plan-proof.txt'
  : requireUserInput
  ? 'live-composer-user-input-proof.txt'
  : requireApproval
    ? 'live-composer-approval-proof.txt'
    : 'live-composer-permission-proof.txt'
const proofToken = requireGoal
  ? 'CODEX_COMPOSER_GOAL_OK'
  : requirePlan
  ? 'CODEX_COMPOSER_PLAN_OK'
  : requireUserInput
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
  requireGoal
    ? `/goal ${goalObjective}`
    : requirePlan
    ? 'This is a live Orchestrator/Codex app-server plan-update proof in a disposable git workspace.'
    : requireUserInput
    ? 'This is a live Orchestrator/Codex app-server user-input proof in a disposable git workspace.'
    : requireApproval
      ? 'This is a live Orchestrator/Codex app-server approval-card proof in a disposable git workspace.'
      : 'This is a live Orchestrator/Codex app-server Composer model and permission proof in a disposable git workspace.',
  requireGoal
    ? ''
    : requirePlan
    ? 'Create a native plan update with exactly two steps: Inspect app-server plan surface, and Record live plan evidence. Do not edit files and do not run shell commands.'
    : requireUserInput
    ? 'First use the native user-input request tool to ask exactly this question: Which proof token should I write? Use a single question id named proof-token if the tool allows ids. After the client answers, use command execution to write exactly the answer you received followed by a newline to live-composer-user-input-proof.txt in the current workspace.'
    : `Use command execution to run exactly this command: ${commandText}`,
  requireGoal ? '' : 'Do not edit any other file.',
  requireGoal ? '' : `After the required action succeeds, reply with exactly ${expectedToken}.`
].filter(Boolean).join(' ')

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
const turnStartResults = []
const turnStartParamList = []
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
const planUpdates = []
const planDeltas = []
const goalUpdates = []
const goalClears = []
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

  await startTurn(prompt)

  if (requireGoal) {
    await waitForCompletion()
    resetTurnCompletion()
    await startTurn('/goal clear')
  }

  await waitForCompletion()
  const fileText = safeReadProofFile()
  const gitDiff = requireApproval || requirePlan || requireGoal ? '' : runGit(['diff', '--', proofFileName])
  const assistantSawOk = requireGoal || assistantText.includes(expectedToken)
  const editApplied = requirePlan || requireGoal || (fileText.includes(proofToken) && (requireApproval || gitDiff.includes(proofToken)))
  const commandCompleted = requirePlan || requireGoal || commandExecutions.some((execution) =>
    execution.method === 'item/completed' &&
    execution.status === 'completed' &&
    execution.command.includes(proofToken)
  )
  const planUpdated = !requirePlan || planUpdates.length > 0 || planDeltas.length > 0 || events.some((event) => event.type === 'plan.updated')
  const goalRoundTrip = !requireGoal || (
    goalUpdates.some((params) => params.goal?.objective === goalObjective) &&
    goalClears.some((params) => params.threadId === threadId) &&
    events.some((event) => event.type === 'goal.updated') &&
    events.some((event) => event.type === 'goal.cleared')
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

  if (editApplied && assistantSawOk && commandCompleted && threadPolicyMatches && approvalRoundTrip && userInputRoundTrip && planUpdated && goalRoundTrip) {
    finish(true, requireGoal
      ? 'live Codex app-server updated and cleared a thread goal through native goal commands'
      : requirePlan
      ? 'live Codex app-server emitted a native plan update during a real turn'
      : requireUserInput
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
  } else if (!planUpdated) {
    finish(false, 'live Codex app-server did not emit a native plan update')
  } else if (!goalRoundTrip) {
    finish(false, 'live Codex app-server did not update and clear a thread goal')
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

async function startTurn(inputText) {
  turnStatus = null
  completed = false
  turnStartParams = {
    threadId,
    input: [{ type: 'text', text: inputText, text_elements: [] }],
    cwd: workspaceDir,
    model,
    effort,
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer
  }
  turnStartParamList.push(turnStartParams)
  turnStartResult = await request('turn/start', turnStartParams)
  turnStartResults.push(turnStartResult)
  if (turnStartResult?.turn?.id) turnIds.add(turnStartResult.turn.id)
}

function resetTurnCompletion() {
  completed = false
  turnStatus = null
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
  if (message.method === 'turn/plan/updated') {
    planUpdates.push(message.params ?? {})
  }
  if (message.method === 'item/plan/delta') {
    planDeltas.push(message.params ?? {})
  }
  if (message.method === 'thread/goal/updated') {
    goalUpdates.push(message.params ?? {})
  }
  if (message.method === 'thread/goal/cleared') {
    goalClears.push(message.params ?? {})
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
    requirePlan,
    requireGoal,
    goalObjective,
    policy,
    prompt,
    threadId,
    threadStartParams,
    threadStartResult,
    turnStartParams,
    turnStartResult,
    turnStartParamList,
    turnStartResults,
    observedTurnIds: [...turnIds],
    methods: [...new Set(methods)],
    methodCounts: methods.reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {}),
    serverRequests,
    permissionRequests,
    permissionResponses,
    userInputRequests,
    userInputResponses,
    commandExecutions,
    planUpdates,
    planDeltas,
    goalUpdates,
    goalClears,
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
    requirePlan: result.requirePlan,
    requireGoal: result.requireGoal,
    goalObjective: result.goalObjective,
    permissionRequestCount: result.permissionRequests.length,
    userInputRequestCount: result.userInputRequests.length,
    commandExecutionCount: result.commandExecutions.length,
    planUpdateCount: result.planUpdates.length,
    planDeltaCount: result.planDeltas.length,
    goalUpdateCount: result.goalUpdates.length,
    goalClearCount: result.goalClears.length,
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
