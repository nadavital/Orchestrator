#!/usr/bin/env node
import { Agent, Cursor } from '@cursor/sdk'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyLocalEnv } from './local-env.mjs'

applyLocalEnv()

const timeoutMs = Number(process.env.CURSOR_SDK_LIVE_TIMEOUT_MS || 90_000)
const workDir = process.env.CURSOR_SDK_LIVE_WORKDIR || process.cwd()
const prompt = process.env.CURSOR_SDK_LIVE_PROMPT || [
  'Reply with CURSOR_SDK_PONG only.',
  'Do not edit files or run commands.'
].join(' ')
const artifactDir = process.env.CURSOR_SDK_LIVE_ARTIFACT_DIR || tmpdir()
mkdirSync(artifactDir, { recursive: true })

let agent
let run
let timedOut = false
const raw = []
const checks = {
  sdkImported: true,
  cursorApiKeyAvailable: Boolean(process.env.CURSOR_API_KEY),
  authOrLocalRuntimeAvailable: false,
  agentCreated: false,
  streamStarted: false,
  assistantTextSeen: false,
  runFinished: false,
  pongSeen: false
}
let finalized = false

process.on('unhandledRejection', (reason) => {
  raw.push({ type: 'unhandled_rejection', ...errorPayload(reason) })
  writeReport(false)
  process.exit(1)
})

process.on('uncaughtException', (error) => {
  raw.push({ type: 'uncaught_exception', ...errorPayload(error) })
  writeReport(false)
  process.exit(1)
})

const timeout = setTimeout(() => {
  timedOut = true
  void run?.cancel().catch(() => {})
}, timeoutMs)

try {
  try {
    await Cursor.me()
    checks.authOrLocalRuntimeAvailable = true
  } catch (error) {
    raw.push({ type: 'auth_probe_error', message: error instanceof Error ? error.message : String(error) })
  }

  agent = await Agent.create({
    ...(process.env.CURSOR_API_KEY ? { apiKey: process.env.CURSOR_API_KEY } : {}),
    model: cursorSdkLiveModelSelection(),
    local: {
      cwd: workDir,
      settingSources: ['project', 'user', 'plugins'],
      sandboxOptions: { enabled: true }
    }
  })
  checks.agentCreated = true
  checks.authOrLocalRuntimeAvailable = true

  run = await agent.send(prompt, {
    mode: 'agent',
    onDelta: ({ update }) => {
      raw.push({ type: 'delta', update })
    },
    onStep: ({ step }) => {
      raw.push({ type: 'step', step })
    }
  })
  for await (const message of run.stream()) {
    checks.streamStarted = true
    raw.push(message)
    if (message.type === 'assistant') {
      const text = message.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (text.trim()) checks.assistantTextSeen = true
      if (text.includes('CURSOR_SDK_PONG')) checks.pongSeen = true
    }
  }

  const result = await run.wait()
  raw.push({ type: 'result', ...result })
  checks.runFinished = result.status === 'finished'
  if (typeof result.result === 'string' && result.result.includes('CURSOR_SDK_PONG')) checks.pongSeen = true
  try {
    raw.push({ type: 'conversation', turns: await run.conversation() })
  } catch (error) {
    raw.push({ type: 'conversation_error', ...errorPayload(error) })
  }
  try {
    raw.push({ type: 'messages', messages: await Agent.messages.list(agent.agentId, { runtime: 'local', cwd: workDir }) })
  } catch (error) {
    raw.push({ type: 'messages_error', ...errorPayload(error) })
  }
} catch (error) {
  raw.push({
    type: 'error',
    timedOut,
    message: timedOut ? `Cursor SDK live probe timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  })
} finally {
  clearTimeout(timeout)
  try { agent?.close() } catch {}
}

writeReport(Object.values(checks).every(Boolean))

function writeReport(ok) {
  if (finalized) return
  finalized = true
  const report = {
    ok,
    checks,
    workDir,
    timeoutMs,
    raw
  }
  const reportPath = join(artifactDir, `cursor-sdk-live-probe-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ok: report.ok, checks, reportPath }, null, 2))
  process.exitCode = report.ok ? 0 : 1
}

function errorPayload(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : undefined,
    stack: error instanceof Error ? error.stack : undefined,
    cause: error instanceof Error && error.cause instanceof Error
      ? {
          name: error.cause.name,
          message: error.cause.message,
          stack: error.cause.stack
        }
      : undefined
  }
}

function cursorSdkLiveModelSelection() {
  const model = process.env.CURSOR_SDK_LIVE_MODEL || 'composer-2.5-fast'
  if (model === 'composer-2.5-fast') return { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] }
  if (model === 'composer-2.5') {
    return {
      id: 'composer-2.5',
      params: [{ id: 'fast', value: process.env.CURSOR_SDK_LIVE_FAST === '0' ? 'false' : 'true' }]
    }
  }
  return { id: model }
}
