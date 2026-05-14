#!/usr/bin/env node
import { spawn } from 'child_process'

const cwd = process.cwd()
const timeoutMs = Number(process.env.CODEX_APPSERVER_SMOKE_TIMEOUT_MS ?? 120_000)
const prompt = process.env.CODEX_APPSERVER_SMOKE_PROMPT ??
  'Reply with exactly CODEX_APPSERVER_SMOKE_OK. Do not run tools.'

let nextId = 1
let buffer = ''
let completed = false
let assistantText = ''
const pending = new Map()

const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
  cwd,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe']
})

const timeout = setTimeout(() => {
  fail(`Timed out after ${timeoutMs}ms waiting for Codex app-server turn completion.`)
}, timeoutMs)

child.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8').trim()
  if (text) process.stderr.write(`${text}\n`)
})

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) handleLine(line.trim())
})

child.on('exit', (code) => {
  if (!completed) fail(`Codex app-server exited before completion with code ${code}.`)
})

try {
  await request('initialize', {
    clientInfo: {
      name: 'orchestrator-live-smoke',
      title: 'Orchestrator Live Smoke',
      version: '1.0.0'
    },
    capabilities: { experimentalApi: true }
  })
  notify('initialized')
  const threadResult = await request('thread/start', {
    model: process.env.CODEX_APPSERVER_SMOKE_MODEL ?? 'gpt-5.4',
    cwd,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    serviceName: 'orchestrator-live-smoke',
    ephemeral: true,
    sessionStartSource: 'startup'
  })
  const threadId = threadResult?.thread?.id
  if (!threadId) fail('Codex app-server thread/start did not return a thread id.')

  await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    cwd,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    model: process.env.CODEX_APPSERVER_SMOKE_MODEL ?? 'gpt-5.4'
  })

  await waitForCompletion()
  if (!/CODEX_APPSERVER_SMOKE_OK/.test(assistantText)) {
    fail(`Codex app-server completed but assistant text did not contain smoke token. Text: ${assistantText}`)
  }

  clearTimeout(timeout)
  child.kill('SIGTERM')
  console.log(`Codex app-server live smoke passed. Assistant text: ${assistantText.trim()}`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

function request(method, params) {
  const id = `smoke-${nextId++}`
  child.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`)
}

function handleLine(line) {
  if (!line) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.id && !message.method) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
    return
  }

  if (message.method === 'item/agentMessage/delta') {
    assistantText += message.params?.delta ?? ''
  } else if (message.method === 'item/completed' && message.params?.item?.type === 'agentMessage' && !assistantText) {
    assistantText += message.params.item.text ?? ''
  } else if (message.method === 'turn/completed') {
    const status = message.params?.turn?.status
    if (status && status !== 'completed') fail(`Codex app-server turn ended with status ${status}.`)
    completed = true
  } else if (message.method === 'error') {
    fail(JSON.stringify(message.params ?? message))
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

function fail(message) {
  clearTimeout(timeout)
  try { child.kill('SIGTERM') } catch { /* ignore */ }
  console.error(message)
  process.exit(1)
}
