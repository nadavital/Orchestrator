#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CopilotClient } from '@github/copilot-sdk'
import { applyLocalEnv } from './local-env.mjs'

applyLocalEnv()

const timeoutMs = Number(process.env.COPILOT_SDK_PROBE_TIMEOUT_MS || 45_000)
const workDir = process.env.COPILOT_SDK_PROBE_WORKDIR || process.cwd()
const artifactDir = process.env.COPILOT_SDK_PROBE_ARTIFACT_DIR || tmpdir()
mkdirSync(artifactDir, { recursive: true })

const checks = {
  sdkImported: true,
  runtimeStarted: false,
  statusRead: false,
  authRead: false,
  authenticated: false,
  modelsRead: false,
  sessionsListed: false,
  stopped: false
}
const raw = []

let client
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
  raw.push({ type: 'timeout', message: `Copilot SDK probe timed out after ${timeoutMs}ms.` })
  void client?.forceStop().catch(() => {})
  writeReport(false)
  process.exit(1)
}, timeoutMs)

try {
  client = new CopilotClient({
    workingDirectory: workDir,
    env: process.env,
    logLevel: process.env.COPILOT_SDK_PROBE_LOG_LEVEL || 'error'
  })

  await client.start()
  checks.runtimeStarted = true

  const status = await client.getStatus()
  raw.push({ type: 'status', status })
  checks.statusRead = true

  const auth = await client.getAuthStatus()
  raw.push({ type: 'auth', auth: redactAuth(auth) })
  checks.authRead = true
  checks.authenticated = auth?.isAuthenticated === true

  if (checks.authenticated) {
    const models = await client.listModels()
    raw.push({
      type: 'models',
      count: models.length,
      ids: models.map((model) => model.id).slice(0, 25)
    })
    checks.modelsRead = true

    const sessions = await client.listSessions({ cwd: workDir })
    raw.push({
      type: 'sessions',
      count: sessions.length,
      ids: sessions.map((session) => session.sessionId).slice(0, 25)
    })
    checks.sessionsListed = true
  } else {
    raw.push({
      type: 'auth_blocked',
      message: 'Copilot SDK runtime started, but the account is not authenticated; model and session probes were skipped.'
    })
  }
} catch (error) {
  raw.push({ type: 'error', ...errorPayload(error) })
} finally {
  clearTimeout(timeout)
  try {
    const stopErrors = await client?.stop()
    raw.push({ type: 'stop', errors: stopErrors?.map((error) => errorPayload(error)) ?? [] })
    checks.stopped = true
  } catch (error) {
    raw.push({ type: 'stop_error', ...errorPayload(error) })
  }
}

writeReport(
  checks.sdkImported &&
  checks.runtimeStarted &&
  checks.statusRead &&
  checks.authRead &&
  checks.stopped &&
  (checks.authenticated ? checks.modelsRead && checks.sessionsListed : true)
)

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
  const reportPath = join(artifactDir, `copilot-sdk-live-probe-${Date.now()}.json`)
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
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

function redactAuth(auth) {
  if (!auth || typeof auth !== 'object') return auth
  return JSON.parse(JSON.stringify(auth, (_key, value) => {
    if (typeof value === 'string' && value.length > 32) return '[redacted]'
    return value
  }))
}
