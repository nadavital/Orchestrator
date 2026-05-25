#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = resolve(readArg('--out') ?? join(root, 'tmp', 'side-panel-visual-inventory'))
const full = process.argv.includes('--full')

const coreViews = [
  { id: 'chat-sidebar', surface: 'Chat Sidebar', state: 'normal and menu', flag: '--sidebar' },
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
  { id: 'review-source', surface: 'Review', state: 'source mode', flag: '--diff-source' },
  { id: 'review-preview', surface: 'Review', state: 'rich preview and binary', flag: '--diff-preview' },
  { id: 'settings-providers', surface: 'Settings', state: 'provider settings', flag: '--settings-providers' },
  { id: 'side-chat', surface: 'Workbench Side Chat', state: 'side chat tabs and composer', flag: '--side-chat' },
  { id: 'plan', surface: 'Plan Panel', state: 'plan rows and agent tab', flag: '--plan' },
  { id: 'extensions', surface: 'Extensions Panel', state: 'tabs and copy surface', flag: '--extensions' },
  { id: 'composer', surface: 'Composer', state: 'menus and responsive toolbar', flag: '--composer' },
  { id: 'capabilities', surface: 'Capabilities', state: 'menus and sheets', flag: '--capabilities' },
  { id: 'pets', surface: 'Pets Settings', state: 'personalization page', flag: '--pets' },
  { id: 'transcript-narrow', surface: 'Transcript / Main Shell', state: 'narrow width', flag: '--transcript-layout' }
]

const views = full ? [...coreViews, ...fullViews] : coreViews
mkdirSync(outDir, { recursive: true })

const captures = []
for (const view of views) {
  const args = ['run', 'smoke:ui:auto', '--', view.flag]
  const startedAt = new Date().toISOString()
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
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
  captures.push({
    ...view,
    ok: result.status === 0 && screenshotSize > 0,
    exitCode: result.status,
    startedAt,
    completedAt: new Date().toISOString(),
    outputPath: parsed?.outputPath ?? null,
    originalScreenshotPath: originalScreenshotPath ?? null,
    screenshotPath: screenshotSize > 0 ? localScreenshotPath : null,
    screenshotSize,
    logPath,
    checks: parsed?.checks ?? null
  })
}

const failed = captures.filter((capture) => !capture.ok)
const manifestPath = join(outDir, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  mode: full ? 'full' : 'core',
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
  captures: captures.length,
  screenshots: captures.map((capture) => ({ id: capture.id, path: capture.screenshotPath }))
}, null, 2))

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
