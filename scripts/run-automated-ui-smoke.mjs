#!/usr/bin/env node
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const captureView = process.argv.includes('--settings')
  ? 'settings'
  : process.argv.includes('--resources')
    ? 'resources'
  : process.argv.includes('--terminal')
    ? 'terminal'
    : 'main'
const profile = 'automated-ui-smoke'
const userDataDir = join(tmpdir(), 'orchestrator-profiles', profile)
const workspaceDir = join(tmpdir(), 'orchestrator-automated-ui-workspace')
const outputPath = join(tmpdir(), `orchestrator-automated-ui-smoke-${captureView}-${Date.now()}.json`)
const screenshotPath = join(tmpdir(), `orchestrator-automated-ui-smoke-${captureView}-${Date.now()}.png`)

rmSync(userDataDir, { recursive: true, force: true })
mkdirSync(userDataDir, { recursive: true })
mkdirSync(workspaceDir, { recursive: true })

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: root,
  env: {
    ...process.env,
    ORCHESTRATOR_PROFILE: profile,
    ORCHESTRATOR_USER_DATA_DIR: userDataDir,
    ORCHESTRATOR_SMOKE_WORKSPACE_DIR: workspaceDir,
    ORCHESTRATOR_DISABLE_PET_OVERLAY: '1',
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT: outputPath,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_SCREENSHOT: screenshotPath,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW: captureView
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let log = ''
child.stdout.on('data', (chunk) => { log += chunk.toString() })
child.stderr.on('data', (chunk) => { log += chunk.toString() })

const timeout = setTimeout(() => {
  child.kill('SIGTERM')
  console.error('Automated UI smoke timed out.')
  console.error(log.slice(-4000))
  process.exit(1)
}, 45_000)

child.on('exit', (code) => {
  clearTimeout(timeout)
  if (!existsSync(outputPath)) {
    console.error('Automated UI smoke did not produce an output file.')
    console.error(log.slice(-4000))
    process.exit(code ?? 1)
  }

  const report = JSON.parse(readFileSync(outputPath, 'utf8'))
  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const result = report.result ?? {}
  const checks = {
    isolatedProfile: result.profile?.isIsolated === true,
    profileBadge: result.hasProfileBadge === true,
    composer: result.hasComposer === true,
    sidebarNavigation: result.hasSidebarNavigation === true,
    sideQuestionCommand: captureView === 'terminal' || result.hasSideQuestionCommandText === true,
    buttons: Number(result.buttonCount ?? 0) > 0
  }
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length > 0) {
    console.error(JSON.stringify({ outputPath, checks, result }, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify({ outputPath, screenshotPath: report.screenshotPath, view: captureView, checks, profile: result.profile }, null, 2))
})
