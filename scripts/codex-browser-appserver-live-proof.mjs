#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as asar from '@electron/asar'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const { PROVIDERS, providerSpawnEnv, resolveProviderCommand } = await import(providersModulePath)

const provider = PROVIDERS.codex
const artifactRoot = process.env.CODEX_BROWSER_PROOF_ARTIFACT_DIR
  ? process.env.CODEX_BROWSER_PROOF_ARTIFACT_DIR
  : join(repoRoot, 'tmp', 'codex-browser-appserver-live-proof')
const timeoutMs = Number(process.env.CODEX_BROWSER_PROOF_TIMEOUT_MS ?? 180_000)
const model = process.env.CODEX_BROWSER_PROOF_MODEL ?? 'gpt-5.4-mini'
const cwd = process.env.CODEX_BROWSER_PROOF_CWD ?? repoRoot
const browserProofUrl = process.env.CODEX_BROWSER_PROOF_URL ??
  'data:text/html,<title>Orchestrator Browser Proof</title><h1>ORCHESTRATOR_BROWSER_PROOF_PAGE</h1>'
const codexAppAsarPath = process.env.CODEX_APP_ASAR_PATH ?? '/Applications/Codex.app/Contents/Resources/app.asar'
const expectedToken = 'CODEX_BROWSER_LIVE_OK'
const noBrowserToken = 'CODEX_BROWSER_LIVE_NO_BROWSER'
const prompt = process.env.CODEX_BROWSER_PROOF_PROMPT ?? [
  'This is a live Orchestrator/Codex app-server browser integration proof.',
  'Do not edit files.',
  'Do not run shell commands.',
  `If a browser or browser-use tool is available, use it to inspect this URL: ${browserProofUrl}`,
  `After using the browser, reply with exactly ${expectedToken}.`,
  `If no browser/browser-use tool is available, reply with exactly ${noBrowserToken}.`
].join(' ')

const resolved = resolveProviderCommand(provider, { binary: provider.binary, args: ['app-server', '--listen', 'stdio://'] })
if (!resolved) {
  console.error('codex CLI is not available.')
  process.exit(1)
}

resetArtifacts()

const child = spawn(resolved.binary, resolved.args, {
  cwd,
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
const pending = new Map()
const methods = []
const rawLines = []
const parseErrors = []
const events = []
const serverRequests = []

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
      name: 'orchestrator-browser-live-proof',
      title: 'Orchestrator Browser Live Proof',
      version: '1.0.0'
    },
    capabilities: { experimentalApi: true }
  })
  notify('initialized')
  const threadResult = await request('thread/start', {
    model,
    cwd,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    serviceName: 'orchestrator-browser-live-proof',
    ephemeral: true,
    sessionStartSource: 'startup'
  })
  const threadId = threadResult?.thread?.id
  if (!threadId) throw new Error('thread/start did not return a thread id')

  await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    cwd,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    model
  })

  await waitForCompletion()
  const browserEvents = events.filter((event) => event.type === 'browser.manager_state')
  const unsupportedClientTools = serverRequests.filter((request) =>
    request.method === 'item/tool/call' ||
    request.method === 'browser/open' ||
    request.method?.includes?.('browser')
  )
  const assistantSawNoBrowser = assistantText.includes(noBrowserToken)
  const assistantSawOk = assistantText.includes(expectedToken)

  if (browserEvents.length > 0 && assistantSawOk) {
    finish(true, 'live Codex app-server emitted browser.manager_state and completed browser proof')
  } else if (unsupportedClientTools.length > 0) {
    finish(false, `blocked: Codex app-server requested unsupported client browser/tool call(s): ${unsupportedClientTools.map((request) => request.method).join(', ')}`)
  } else if (assistantSawNoBrowser) {
    finish(false, 'blocked: live Codex app-server completed but did not expose a browser/browser-use tool to this client')
  } else if (browserEvents.length === 0) {
    finish(false, 'no browser.manager_state events observed from live Codex app-server run')
  } else {
    finish(false, `browser events observed but expected assistant token was missing: ${assistantText.trim()}`)
  }
} catch (error) {
  finish(false, error instanceof Error ? error.message : String(error))
}

function request(method, params) {
  const id = `browser-proof-${nextId++}`
  send({ method, id, params })
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
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
    events.push(...provider.parseOutputLine(line))
  } catch (error) {
    parseErrors.push({ line, error: error instanceof Error ? error.message : String(error) })
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
    if (turnStatus && turnStatus !== 'completed') {
      finish(false, `turn completed with status ${turnStatus}`)
      return
    }
    completed = true
  }
}

function answerServerRequest(message) {
  if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
    send({ id: message.id, result: { decision: 'decline' } })
    return
  }
  if (message.method === 'item/permissions/requestApproval') {
    send({ id: message.id, error: { code: -32000, message: 'Permission request declined by browser live proof.' } })
    return
  }
  if (message.method === 'item/tool/requestUserInput') {
    send({ id: message.id, result: { answers: { answer: { answers: [noBrowserToken] } } } })
    return
  }
  if (message.method === 'mcpServer/elicitation/request') {
    send({ id: message.id, result: { action: 'decline', content: noBrowserToken, _meta: null } })
    return
  }
  send({ id: message.id, error: { code: -32601, message: 'Orchestrator browser live proof does not implement client-side dynamic tools.' } })
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
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(artifactRoot, { recursive: true })
}

function writeArtifacts(result) {
  const browserEvents = events.filter((event) => event.type === 'browser.manager_state')
  const payload = {
    ...result,
    createdAt: new Date().toISOString(),
    cwd,
    model,
    prompt,
    methods: [...new Set(methods)],
    methodCounts: methods.reduce((counts, method) => ({ ...counts, [method]: (counts[method] ?? 0) + 1 }), {}),
    serverRequests,
    eventTypes: [...new Set(events.map((event) => event.type))],
    browserEvents,
    codexBrowserBoundaryEvidence: collectCodexBrowserBoundaryEvidence(),
    assistantText,
    turnStatus,
    parseErrors,
    stderr: stderr.trim()
  }
  writeFileSync(join(artifactRoot, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(artifactRoot, 'raw.jsonl'), `${rawLines.join('\n')}\n`)
  return payload
}

function collectCodexBrowserBoundaryEvidence() {
  const terms = [
    'dynamic-tools-for-thread-start-requested',
    'dynamic-tool-call-requested',
    'item/tool/call',
    'capture-browser-use-turn-route',
    'browser-use-turn-route-capture',
    'browser-use-turn-route-release',
    'codex/browserUse',
    'browser-sidebar-browser-use-state',
    'browser-sidebar-browser-use-viewport',
    'browser-sidebar-browser-use-capture-surface',
    'browser-sidebar-browser-use-cursor-state'
  ]
  const evidence = {
    appAsarPath: codexAppAsarPath,
    available: false,
    chunks: [],
    terms: Object.fromEntries(terms.map((term) => [term, []])),
    conclusion: 'Codex app bundle was unavailable for boundary inspection.'
  }
  if (!existsSync(codexAppAsarPath)) return evidence

  try {
    const packageFiles = asar.listPackage(codexAppAsarPath)
    const relevantFiles = packageFiles.filter((file) => {
      const basename = file.split('/').pop() ?? ''
      return /^(app-server-manager-signals|browser-sidebar-manager|thread-management-dynamic-tools)-.*\.js$/.test(basename)
    })
    evidence.available = true
    evidence.chunks = relevantFiles.map((file) => file.split('/').pop())

    for (const file of relevantFiles) {
      const basename = file.split('/').pop() ?? file
      const text = asar.extractFile(codexAppAsarPath, file.slice(1)).toString('utf8')
      for (const term of terms) {
        const count = countOccurrences(text, term)
        if (count > 0) evidence.terms[term].push({ chunk: basename, count })
      }
    }

    evidence.conclusion = [
      'Codex desktop contains browser-use sidebar state and turn-route capture/release code in the webview bundle.',
      'The live stdio app-server proof must still see server requests or browser.manager_state events before Orchestrator can claim provider-backed browser-use parity.'
    ].join(' ')
  } catch (error) {
    evidence.conclusion = `Codex app bundle boundary inspection failed: ${error instanceof Error ? error.message : String(error)}`
  }
  return evidence
}

function countOccurrences(text, term) {
  let count = 0
  let index = -1
  while ((index = text.indexOf(term, index + 1)) >= 0) count += 1
  return count
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
    eventTypes: result.eventTypes,
    browserEventCount: result.browserEvents.length,
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
