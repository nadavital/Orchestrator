#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = resolve(readArg('--out') ?? join(root, 'tmp', 'side-panel-visual-inventory'))
const full = process.argv.includes('--full')
const onlyIds = new Set((readArg('--only') ?? '').split(',').map((item) => item.trim()).filter(Boolean))
const appMode = process.argv.includes('--installed') ? 'installed' : process.argv.includes('--packaged') ? 'packaged' : 'dev'
if (process.argv.includes('--installed') && process.argv.includes('--packaged')) {
  console.error('Use either --packaged or --installed, not both.')
  process.exit(1)
}
const smokeTimeoutMs = Number.parseInt(process.env.ORCHESTRATOR_VISUAL_INVENTORY_TIMEOUT_MS ?? '120000', 10)

const coreViews = [
  { id: 'chat-sidebar', surface: 'Chat Sidebar', state: 'normal and menu', flag: '--sidebar' },
  { id: 'header', surface: 'Header / Main Shell', state: 'titlebar and profile controls', flag: '--header' },
  { id: 'workbench-right-panel', surface: 'Workbench Right Panel', state: 'normal and narrow overlay checks', flag: '--right-panel' },
  { id: 'review-entry', surface: 'Review', state: 'entry and metadata', flag: '--diff-entry' },
  { id: 'files', surface: 'Files / File Viewer', state: 'tree and file tab', flag: '--files' },
  { id: 'browser', surface: 'Browser', state: 'tabs, toolbar, device presets', flag: '--browser' },
  { id: 'terminal-bottom-panel', surface: 'Terminal Bottom Panel', state: 'tabs and toolbar', flag: '--terminal-visual' },
  { id: 'settings', surface: 'Settings', state: 'main settings pages', flag: '--settings' }
]

const fullViews = [
  { id: 'workbench-new-tab', surface: 'Workbench Right Panel', state: 'new tab action surface', flag: '--workbench-new-tab' },
  { id: 'environment', surface: 'Workbench Environment', state: 'git and PR action rows', flag: '--environment' },
  { id: 'review-empty', surface: 'Review', state: 'empty no-change state', flag: '--diff-empty' },
  { id: 'review-loading', surface: 'Review', state: 'loading diff content', flag: '--diff-loading' },
  { id: 'review-narrow', surface: 'Review', state: 'narrow right-panel overlay', flag: '--diff-narrow' },
  { id: 'review-core', surface: 'Review', state: 'diff renderer core', flag: '--diff-core' },
  { id: 'review-last-turn', surface: 'Review', state: 'transcript Last turn open state', flag: '--diff-last-turn' },
  { id: 'review-source', surface: 'Review', state: 'source mode', flag: '--diff-source' },
  { id: 'review-preview', surface: 'Review', state: 'rich preview and binary', flag: '--diff-preview' },
  { id: 'terminal-behavior', surface: 'Terminal Bottom Panel', state: 'transfer behavior and shortcuts', flag: '--terminal' },
  { id: 'multi-window-focus', surface: 'App Shell / Window Lifecycle', state: 'multi-window focus and menu command routing', flag: '--multi-window-focus' },
  { id: 'settings-providers', surface: 'Settings', state: 'provider settings', flag: '--settings-providers' },
  { id: 'side-chat', surface: 'Workbench Side Chat', state: 'side chat tabs and composer', flag: '--side-chat' },
  { id: 'plan', surface: 'Plan Panel', state: 'plan rows and agent tab', flag: '--plan' },
  { id: 'extensions', surface: 'Extensions Panel', state: 'tabs and copy surface', flag: '--extensions' },
  { id: 'composer', surface: 'Composer', state: 'menus and responsive toolbar', flag: '--composer' },
  { id: 'capabilities', surface: 'Capabilities', state: 'menus and sheets', flag: '--capabilities' },
  { id: 'pets', surface: 'Pets Settings', state: 'personalization page', flag: '--pets' },
  { id: 'transcript-narrow', surface: 'Transcript / Main Shell', state: 'narrow width', flag: '--transcript-layout' }
]

const allViews = full ? [...coreViews, ...fullViews] : coreViews
const views = onlyIds.size > 0
  ? allViews.filter((view) => onlyIds.has(view.id) || onlyIds.has(view.flag.replace(/^--/, '')))
  : allViews
if (views.length === 0) {
  console.error(JSON.stringify({
    error: 'No visual-inventory views matched --only',
    only: [...onlyIds],
    available: allViews.map((view) => view.id)
  }, null, 2))
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const captures = []
for (const [viewIndex, view] of views.entries()) {
  const args = ['scripts/run-automated-ui-smoke.mjs', view.flag]
  if (appMode === 'packaged') args.push('--packaged')
  if (appMode === 'installed') args.push('--installed')
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  console.error(`[visual-inventory] ${viewIndex + 1}/${views.length} start ${view.id} ${view.flag}`)
  const result = await runSmokeCapture(args)
  const logPath = join(outDir, `${view.id}.log`)
  writeFileSync(logPath, `${result.stdout}\n${result.stderr}`)
  const parsed = safeParseLastJson(result.stdout) ?? safeParseLastJson(result.stderr)
  const outputPayload = parsed?.screenshotPath ? parsed : readJsonFile(parsed?.outputPath)
  const originalScreenshotPath = outputPayload?.screenshotPath
  const localScreenshotPath = join(outDir, `${view.id}.png`)
  let screenshotSize = 0
  if (originalScreenshotPath && existsSync(originalScreenshotPath)) {
    copyFileSync(originalScreenshotPath, localScreenshotPath)
    screenshotSize = statSync(localScreenshotPath).size
  }
  const checks = parsed?.checks ?? outputPayload?.checks ?? null
  const completedWithPassingChecks = screenshotSize > 0 && checksPass(checks)
  captures.push({
    ...view,
    ok: completedWithPassingChecks && (result.status === 0 || result.error?.code === 'ETIMEDOUT'),
    exitCode: result.status,
    signal: result.signal ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    failureKind: classifyFailure(result, parsed, outputPayload, screenshotSize),
    failureSummary: summarizeFailure(result, parsed, outputPayload, screenshotSize),
    startedAt,
    completedAt: new Date().toISOString(),
    outputPath: parsed?.outputPath ?? null,
    originalScreenshotPath: originalScreenshotPath ?? null,
    screenshotPath: screenshotSize > 0 ? localScreenshotPath : null,
    screenshotSize,
    logPath,
    checks
  })
  const latestCapture = captures[captures.length - 1]
  console.error(`[visual-inventory] ${viewIndex + 1}/${views.length} done ${view.id} ok=${latestCapture.ok} exit=${latestCapture.exitCode ?? 'null'} elapsedMs=${Date.now() - startedMs}`)
}

const failed = captures.filter((capture) => !capture.ok)
const manifestPath = join(outDir, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  mode: full ? 'full' : 'core',
  appMode,
  captures,
  failed: failed.map((capture) => capture.id)
}, null, 2))

if (failed.length > 0) {
  console.error(JSON.stringify({ manifestPath, failed: failed.map((capture) => ({ id: capture.id, exitCode: capture.exitCode, logPath: capture.logPath })) }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({
  manifestPath,
  mode: full ? 'full' : 'core',
  appMode,
  captures: captures.length,
  screenshots: captures.map((capture) => ({ id: capture.id, path: capture.screenshotPath }))
}, null, 2))

function runSmokeCapture(args) {
  return new Promise((resolveCapture) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killTimer = null
    const settle = (code, signal, error = null) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      resolveCapture({
        status: code,
        signal,
        error,
        stdout,
        stderr
      })
    }
    const timeoutMs = Number.isFinite(smokeTimeoutMs) && smokeTimeoutMs > 0 ? smokeTimeoutMs : null
    const timeout = timeoutMs == null
      ? null
      : setTimeout(() => {
        timedOut = true
        terminateProcessTree(child)
        killTimer = setTimeout(() => terminateProcessTree(child, 'SIGKILL'), 2500)
      }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      settle(null, null, error)
    })
    child.on('exit', (code, signal) => {
      settle(code, signal, timedOut ? { code: 'ETIMEDOUT' } : null)
    })
    child.on('close', (code, signal) => {
      settle(code, signal, timedOut ? { code: 'ETIMEDOUT' } : null)
    })
  })
}

function terminateProcessTree(child, signal = 'SIGTERM') {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
      return
    }
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // The process may already have exited.
    }
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function safeParseLastJson(stdout) {
  const lines = stdout.trim().split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines.slice(index).join('\n')
    try {
      return JSON.parse(candidate)
    } catch {
      // keep scanning
    }
  }
  return null
}

function readJsonFile(path) {
  if (!path || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function classifyFailure(result, parsed, outputPayload, screenshotSize) {
  const checks = parsed?.checks ?? outputPayload?.checks ?? null
  if (screenshotSize > 0 && checksPass(checks) && (result.status === 0 || result.error?.code === 'ETIMEDOUT')) return null
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  if (
    combinedOutput.includes('listen EPERM') ||
    combinedOutput.includes('EADDRINUSE') ||
    combinedOutput.includes('error during start dev server and electron app')
  ) {
    return 'infrastructure'
  }
  if (parsed?.checks || outputPayload?.checks) return 'assertion'
  if (!parsed && !outputPayload) return 'infrastructure'
  return 'unknown'
}

function summarizeFailure(result, parsed, outputPayload, screenshotSize) {
  const checks = parsed?.checks ?? outputPayload?.checks ?? null
  if (screenshotSize > 0 && checksPass(checks) && (result.status === 0 || result.error?.code === 'ETIMEDOUT')) return null
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  const interestingLine = combinedOutput
    .split('\n')
    .map((line) => line.trim())
    .find((line) =>
      line.includes('listen EPERM') ||
      line.includes('EADDRINUSE') ||
      line.includes('error during start dev server and electron app') ||
      line.includes('Automated UI smoke did not produce an output file')
    )
  if (interestingLine) return interestingLine
  if (parsed?.checks || outputPayload?.checks) return 'Smoke completed with failing assertions.'
  if (result.status !== 0) return `Smoke exited with code ${result.status}.`
  return 'Smoke did not produce a screenshot.'
}

function checksPass(checks) {
  if (!checks || typeof checks !== 'object') return false
  return Object.values(checks).every((value) => value === true)
}
