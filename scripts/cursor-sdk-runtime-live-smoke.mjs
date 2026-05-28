#!/usr/bin/env node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyLocalEnv } from './local-env.mjs'
import { liveSmokeEffort } from './provider-smoke-config.mjs'

applyLocalEnv()

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providerRuntimeModulePath = join(repoRoot, 'out-test/src/main/providerRuntime.js')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')

const { ProviderRuntimeManager } = await import(providerRuntimeModulePath)
const { PROVIDERS } = await import(providersModulePath)

const timeoutMs = Number(process.env.CURSOR_SDK_RUNTIME_SMOKE_TIMEOUT_MS ?? 90_000)
const expected = 'ORCHESTRATOR_CURSOR_SDK_RUNTIME_OK'
const artifactDir = process.env.CURSOR_SDK_LIVE_ARTIFACT_DIR || tmpdir()
const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-cursor-sdk-runtime-'))
mkdirSync(artifactDir, { recursive: true })
writeFileSync(join(cwd, 'README.md'), 'Disposable Cursor SDK runtime smoke workspace.\n')

const sessionId = `cursor-sdk-runtime-smoke-${Date.now()}`
const provider = PROVIDERS.cursor
const runtime = new ProviderRuntimeManager()
const events = []
let raw = ''
let exited = false
let finished = false

const session = {
  id: sessionId,
  name: 'Cursor SDK runtime smoke',
  provider: 'cursor',
  runtime: 'sdk',
  workDir: cwd,
  model: process.env.CURSOR_SDK_LIVE_MODEL || 'composer-2.5-fast',
  effort: liveSmokeEffort('cursor'),
  status: 'running',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now()
}

const request = {
  prompt: [
    `Reply with ${expected} only.`,
    'Do not edit files or run commands.'
  ].join(' '),
  cwd,
  model: process.env.CURSOR_SDK_LIVE_MODEL || 'composer-2.5-fast',
  effort: liveSmokeEffort('cursor'),
  providerSessionId: null,
  executionPolicy: 'sandbox',
  allowedTools: [],
  disallowedTools: [],
  availableTools: [],
  additionalDirs: [],
  runtime: 'sdk'
}

const timer = setTimeout(() => {
  runtime.stop(sessionId)
  finish(false, `Timed out after ${timeoutMs}ms waiting for Cursor SDK runtime smoke.`)
}, timeoutMs)

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
    const text = assistantTextFromEvents(events)
    if (text.includes(expected)) finish(true, 'Cursor SDK runtime emitted the expected assistant marker.')
  },
  onData: () => {},
  onExit: () => {
    exited = true
    const text = assistantTextFromEvents(events)
    const completed = events.some((event) => event.type === 'run.completed')
    finish(
      text.includes(expected) || completed,
      text.includes(expected)
        ? 'Cursor SDK runtime emitted the expected assistant marker.'
        : completed
          ? 'Cursor SDK runtime completed, but marker was only present in raw/result output.'
          : 'Cursor SDK runtime exited without completing.'
    )
  }
})

if (!started.ok) finish(false, started.message ?? 'Cursor SDK runtime failed to start.')

function handleEvents(nextEvents) {
  events.push(...nextEvents)
}

function assistantTextFromEvents(source) {
  return source
    .filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta' || event.type === 'run.completed')
    .map((event) => event.content ?? '')
    .join('\n')
}

function finish(ok, message) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  const checks = {
    started: started?.ok === true,
    exited,
    sessionStarted: events.some((event) => event.type === 'session.started'),
    assistantText: events.some((event) => event.type === 'assistant.text'),
    runCompleted: events.some((event) => event.type === 'run.completed'),
    expectedMarker: assistantTextFromEvents(events).includes(expected)
  }
  const reportPath = join(artifactDir, `cursor-sdk-runtime-live-smoke-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify({
    ok,
    message,
    checks,
    cwd,
    events,
    raw: raw.split('\n').filter(Boolean)
  }, null, 2))
  console.log(JSON.stringify({
    ok,
    message,
    checks,
    rawLines: raw.split('\n').filter(Boolean).length,
    reportPath
  }, null, 2))
  process.exitCode = ok ? 0 : 1
  setTimeout(() => process.exit(process.exitCode), 25)
}
