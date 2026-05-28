#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveSmokeEffort, liveSmokeModel } from './provider-smoke-config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providerRuntimeModulePath = join(repoRoot, 'out-test/src/main/providerRuntime.js')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const approvalBrokerModulePath = join(repoRoot, 'out-test/src/main/approvalBroker.js')

const { ProviderRuntimeManager } = await import(providerRuntimeModulePath)
const { PROVIDERS } = await import(providersModulePath)
const { approvalBroker } = await import(approvalBrokerModulePath)

const timeoutMs = Number(process.env.CLAUDE_SDK_RUNTIME_SMOKE_TIMEOUT_MS ?? 90_000)
const expected = 'ORCHESTRATOR_CLAUDE_SDK_RUNTIME_OK'
const scenario = process.env.CLAUDE_SDK_RUNTIME_SMOKE_SCENARIO ?? 'basic'
const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-claude-sdk-runtime-'))
writeFileSync(join(cwd, 'README.md'), 'Disposable Claude SDK runtime smoke workspace.\n')
const approvedPath = join(cwd, 'approval-allowed.txt')
const deniedPath = join(cwd, 'approval-denied.txt')

const sessionId = `claude-sdk-runtime-smoke-${Date.now()}`
const provider = PROVIDERS.claude
const fakeBrowserBridge = {
  dynamicTools: [{
    namespace: 'orchestrator',
    name: 'browser_read',
    description: 'Read the current Orchestrator Browser page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }],
  isSupported(namespace, tool) {
    return namespace === 'orchestrator' && tool === 'browser_read'
  },
  async call() {
    return {
      success: true,
      contentItems: [{
        type: 'inputText',
        text: JSON.stringify({
          ok: true,
          title: 'SDK Browser Tool Fixture',
          marker: 'SDK_BROWSER_TOOL_BRIDGE_OK'
        })
      }]
    }
  }
}
const runtime = scenario === 'browser_tool'
  ? new ProviderRuntimeManager(undefined, fakeBrowserBridge)
  : new ProviderRuntimeManager()
const events = []
let raw = ''
let exited = false
let finished = false

const session = {
  id: sessionId,
  name: 'Claude SDK runtime smoke',
  provider: 'claude',
  runtime: 'sdk',
  workDir: cwd,
  model: liveSmokeModel('claude'),
  effort: liveSmokeEffort('claude'),
  status: 'running',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now()
}

const request = {
  prompt: promptForScenario(scenario),
  cwd,
  model: liveSmokeModel('claude'),
  effort: liveSmokeEffort('claude'),
  providerSessionId: null,
  executionPolicy: executionPolicyForScenario(scenario),
  allowedTools: allowedToolsForScenario(scenario),
  disallowedTools: [],
  availableTools: availableToolsForScenario(scenario),
  additionalDirs: [],
  runtime: 'sdk'
}

const timer = setTimeout(() => {
  runtime.stop(sessionId)
  finish(false, `Timed out after ${timeoutMs}ms waiting for Claude SDK runtime smoke.`)
}, timeoutMs)

let providerSessionId = null
let resumedAfterQuestion = false
let permissionRequested = false
let permissionResolved = false
let stopRequested = false
let stopTimer = null

const prepared = await runtime.prepareRunRequest(sessionId, provider, request, (_id, nextEvents) => {
  handleEvents(nextEvents)
})
const started = runtime.startRun({
  sessionId,
  session,
  provider,
  request: prepared,
  mode: 'start',
  onRawData: (data) => { raw += data },
  onParsedEvents: (nextEvents) => {
    handleEvents(nextEvents)
    const started = nextEvents.find((event) => event.type === 'session.started')
    if (started?.type === 'session.started') providerSessionId = started.providerSessionId
    if (scenario === 'stop' && !stopRequested && (
      nextEvents.some((event) => event.type === 'tool.started') ||
      nextEvents.some((event) => event.type === 'session.started')
    )) {
      stopRequested = true
      stopTimer = setTimeout(() => runtime.stop(sessionId), 500)
    }
    if (scenario === 'browser_tool') {
      const text = assistantTextFromEvents(events)
      const sawTool = events.some((event) => event.type === 'tool.completed' && /SDK_BROWSER_TOOL_BRIDGE_OK/.test(event.content))
      if (sawTool && text.includes('SDK_BROWSER_TOOL_OK')) {
        finish(true, 'Claude SDK runtime called an Orchestrator Browser host tool.')
      }
    }
    if (scenario === 'permission_allow') {
      const text = assistantTextFromEvents(events)
      if (permissionRequested && permissionResolved && existsSync(approvedPath) && text.includes('SDK_PERMISSION_ALLOW_OK')) {
        finish(true, 'Claude SDK runtime paused for permission, accepted approval, and completed the tool call.')
      }
    }
    if (scenario === 'permission_deny') {
      const denied = permissionRequested && permissionResolved && !existsSync(deniedPath)
      const failed = nextEvents.some((event) => event.type === 'run.failed')
      if (denied && failed) finish(true, 'Claude SDK runtime denied a permission request without running the tool.')
    }
    if (scenario === 'user_question' && nextEvents.some((event) => event.type === 'user_input.requested')) {
      finish(true, 'Claude SDK runtime emitted user_input.requested for AskUserQuestion.')
    }
    if (scenario === 'user_question_resume' && !resumedAfterQuestion && nextEvents.some((event) => event.type === 'user_input.requested')) {
      resumedAfterQuestion = true
      runtime.stop(sessionId)
      setTimeout(() => {
        const resumeRequest = {
          ...request,
          prompt: 'User answered the pending question:\n\nALPHA_SDK_QUESTION\n\nPlease continue from where you stopped.',
          providerSessionId,
          allowedTools: [],
          availableTools: []
        }
        const resumeSession = {
          ...session,
          providerSessionId
        }
        const resumed = runtime.startRun({
          sessionId,
          session: resumeSession,
          provider,
          request: resumeRequest,
          mode: 'resume',
          onRawData: (data) => { raw += data },
          onParsedEvents: (resumeEvents) => {
            handleEvents(resumeEvents)
            const text = assistantTextFromEvents(events)
            if (text.includes('SDK_QUESTION_RESUME_OK') && text.includes('ALPHA_SDK_QUESTION')) {
              finish(true, 'Claude SDK runtime resumed after AskUserQuestion answer.')
            }
          },
          onData: () => {},
          onExit: () => {
            exited = true
            const text = assistantTextFromEvents(events)
            finish(
              text.includes('SDK_QUESTION_RESUME_OK') && text.includes('ALPHA_SDK_QUESTION'),
              text.includes('SDK_QUESTION_RESUME_OK')
                ? 'Claude SDK runtime resumed after AskUserQuestion answer.'
                : 'Missing resumed answer marker after AskUserQuestion.'
            )
          }
        })
        if (!resumed.ok) finish(false, resumed.message ?? 'Claude SDK runtime failed to resume after AskUserQuestion.')
      }, 100)
    }
  },
  onData: () => {},
  onExit: () => {
    exited = true
    if (scenario === 'user_question_resume' && resumedAfterQuestion && !finished) return
    if (scenario === 'user_question') {
      const userInput = events.find((event) => event.type === 'user_input.requested')
      finish(Boolean(userInput), userInput
        ? 'Claude SDK runtime emitted user_input.requested for AskUserQuestion.'
        : 'Missing user_input.requested for AskUserQuestion.')
      return
    }
    if (scenario === 'browser_tool') {
      const text = assistantTextFromEvents(events)
      const sawTool = events.some((event) => event.type === 'tool.completed' && /SDK_BROWSER_TOOL_BRIDGE_OK/.test(event.content))
      finish(
        sawTool && text.includes('SDK_BROWSER_TOOL_OK'),
        sawTool ? 'Claude SDK runtime called an Orchestrator Browser host tool.' : 'Missing SDK Browser host tool result.'
      )
      return
    }
    if (scenario === 'permission_allow') {
      const text = assistantTextFromEvents(events)
      const fileOk = existsSync(approvedPath) && readFileSync(approvedPath, 'utf8').includes('SDK_PERMISSION_ALLOW_FILE')
      finish(
        permissionRequested && permissionResolved && fileOk && text.includes('SDK_PERMISSION_ALLOW_OK'),
        fileOk ? 'Claude SDK runtime completed after approval.' : 'Missing approved tool file.'
      )
      return
    }
    if (scenario === 'permission_deny') {
      finish(
        permissionRequested && permissionResolved && !existsSync(deniedPath),
        permissionRequested ? 'Claude SDK runtime denied a permission request without running the tool.' : 'Missing permission request.'
      )
      return
    }
    if (scenario === 'stop') {
      const text = assistantTextFromEvents(events)
      finish(
        stopRequested && !text.includes('SDK_STOP_SHOULD_NOT_APPEAR'),
        stopRequested ? 'Claude SDK runtime stopped an active run.' : 'Stop was not requested before exit.'
      )
      return
    }
    const assistantText = assistantTextFromEvents(events)
    const hasCompletion = events.some((event) => event.type === 'run.completed')
    if (assistantText.includes(expected) && hasCompletion) {
      finish(true, 'Claude SDK runtime produced assistant text and run.completed.')
    } else {
      finish(false, `Missing expected runtime output. assistant=${JSON.stringify(assistantText)} completed=${hasCompletion}`)
    }
  }
})

if (!started.ok) {
  finish(false, started.message ?? 'Claude SDK runtime failed to start.')
}

function finish(ok, reason) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  if (stopTimer) clearTimeout(stopTimer)
  runtime.cleanupSession(sessionId)
  rmSync(cwd, { recursive: true, force: true })
  const userInput = events.find((event) => event.type === 'user_input.requested')
  const summary = {
    ok,
    reason,
    scenario,
    exited,
    eventTypes: [...new Set(events.map((event) => event.type))],
    userInput,
    permissionRequested,
    permissionResolved,
    stopped: stopRequested,
    assistantText: assistantTextFromEvents(events),
    rawPreview: raw.slice(-2000)
  }
  console.log(JSON.stringify(summary, null, 2))
  process.exit(ok ? 0 : 1)
}

function handleEvents(nextEvents) {
  events.push(...nextEvents)
  const hasPendingApproval = approvalBroker.hasPendingApproval(sessionId)
  if (scenario === 'permission_allow' && hasPendingApproval && nextEvents.some((event) => event.type === 'permission.requested')) {
    permissionRequested = true
    permissionResolved = approvalBroker.resolveSessionApproval(sessionId, true) || permissionResolved
  }
  if (scenario === 'permission_deny' && hasPendingApproval && nextEvents.some((event) => event.type === 'permission.requested')) {
    permissionRequested = true
    permissionResolved = approvalBroker.resolveSessionApproval(sessionId, false, 'Denied by runtime live smoke.') || permissionResolved
  }
}

function promptForScenario(nextScenario) {
  if (nextScenario === 'user_question' || nextScenario === 'user_question_resume') {
    return [
      'Use the AskUserQuestion tool exactly once.',
      'Ask "Which marker should I use?" with options ALPHA_SDK_QUESTION and BETA_SDK_QUESTION.',
      nextScenario === 'user_question_resume'
        ? 'After the user answers, continue and reply with SDK_QUESTION_RESUME_OK followed by the selected option.'
        : 'Do not use any other tools.'
    ].join(' ')
  }
  if (nextScenario === 'browser_tool') {
    return [
      'Use the mcp__orchestrator__browser_read tool exactly once.',
      'After reading the tool result, reply with SDK_BROWSER_TOOL_OK and include SDK_BROWSER_TOOL_BRIDGE_OK.'
    ].join(' ')
  }
  if (nextScenario === 'permission_allow') {
    return [
      'Use the Bash tool exactly once to run this command:',
      'printf SDK_PERMISSION_ALLOW_FILE > approval-allowed.txt',
      'After the command succeeds, reply with exactly SDK_PERMISSION_ALLOW_OK.'
    ].join(' ')
  }
  if (nextScenario === 'permission_deny') {
    return [
      'Use the Bash tool exactly once to run this command:',
      'printf SDK_PERMISSION_DENY_FILE > approval-denied.txt',
      'If permission is denied, do not try another tool.'
    ].join(' ')
  }
  if (nextScenario === 'stop') {
    return [
      'Use the Bash tool exactly once to run: sleep 20',
      'After it finishes, reply with SDK_STOP_SHOULD_NOT_APPEAR.'
    ].join(' ')
  }
  return `Reply with exactly: ${expected}`
}

function executionPolicyForScenario(nextScenario) {
  if (nextScenario === 'permission_allow' || nextScenario === 'permission_deny') return 'default'
  if (nextScenario === 'stop') return 'bypassPermissions'
  return 'dontAsk'
}

function allowedToolsForScenario(nextScenario) {
  if (nextScenario === 'user_question' || nextScenario === 'user_question_resume') return ['AskUserQuestion']
  if (nextScenario === 'browser_tool') return ['mcp__orchestrator__browser_read']
  return []
}

function availableToolsForScenario(nextScenario) {
  if (nextScenario === 'user_question' || nextScenario === 'user_question_resume') return ['AskUserQuestion']
  if (nextScenario === 'browser_tool') return ['mcp__orchestrator__browser_read']
  if (nextScenario === 'permission_allow' || nextScenario === 'permission_deny' || nextScenario === 'stop') return ['Bash']
  return []
}

function assistantTextFromEvents(nextEvents) {
  return nextEvents
    .filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta')
    .map((event) => event.content)
    .join('')
}
