#!/usr/bin/env node
import { spawn } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { prepareMacSmokeBundle } from './lib/packaged-smoke-bundle.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const options = parseArgs(process.argv.slice(2))
const profile = sanitizeProfileName(options.profile ?? 'smoke')
const userDataDir = resolve(options.userDataDir ?? join(tmpdir(), 'orchestrator-profiles', profile))
const workspaceDir = resolve(options.workspaceDir ?? join(tmpdir(), 'orchestrator-ui-smoke-workspace'))

if (options.reset) {
  rmSync(userDataDir, { recursive: true, force: true })
}
mkdirSync(userDataDir, { recursive: true })
mkdirSync(workspaceDir, { recursive: true })

const env = {
  ...process.env,
  ORCHESTRATOR_PROFILE: profile,
  ORCHESTRATOR_USER_DATA_DIR: userDataDir,
  ORCHESTRATOR_DISABLE_PET_OVERLAY: options.pet ? '0' : '1',
  ORCHESTRATOR_SMOKE_WORKSPACE_DIR: workspaceDir
}

if (options.print) {
  console.log(JSON.stringify({
    mode: options.packaged ? 'packaged' : 'dev',
    profile,
    userDataDir,
    workspaceDir,
    disablePetOverlay: env.ORCHESTRATOR_DISABLE_PET_OVERLAY === '1'
  }, null, 2))
  process.exit(0)
}

const command = options.packaged ? packagedCommand() : devCommand()
console.log(`Launching isolated Orchestrator ${options.packaged ? 'packaged' : 'dev'} profile:`)
console.log(`  profile: ${profile}`)
console.log(`  userData: ${userDataDir}`)
console.log(`  workspace: ${workspaceDir}`)
console.log(`  pet overlay: ${options.pet ? 'enabled' : 'disabled'}`)

const child = spawn(command.bin, command.args, {
  cwd: root,
  env,
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})

function devCommand() {
  return {
    bin: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev']
  }
}

function packagedCommand() {
  const executable = process.platform === 'darwin'
    ? prepareMacSmokeBundle({ root, profile }).executable
    : join(root, 'dist', 'Orchestrator')
  if (!existsSync(executable)) {
    console.error(`Packaged app not found at ${executable}`)
    console.error('Run npm run pack:mac first, or use npm run smoke:app for a dev smoke profile.')
    process.exit(1)
  }
  return {
    bin: executable,
    args: [
      '--orchestrator-profile', profile,
      '--orchestrator-user-data-dir', userDataDir,
      '--orchestrator-disable-pet'
    ]
  }
}

function parseArgs(args) {
  const options = {
    packaged: false,
    pet: false,
    print: false,
    reset: false,
    profile: undefined,
    userDataDir: undefined,
    workspaceDir: undefined
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--packaged') options.packaged = true
    else if (arg === '--pet') options.pet = true
    else if (arg === '--print') options.print = true
    else if (arg === '--reset') options.reset = true
    else if (arg === '--profile') options.profile = args[++i]
    else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length)
    else if (arg === '--user-data-dir') options.userDataDir = args[++i]
    else if (arg.startsWith('--user-data-dir=')) options.userDataDir = arg.slice('--user-data-dir='.length)
    else if (arg === '--workspace-dir') options.workspaceDir = args[++i]
    else if (arg.startsWith('--workspace-dir=')) options.workspaceDir = arg.slice('--workspace-dir='.length)
    else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
  }
  return options
}

function sanitizeProfileName(name) {
  const sanitized = String(name).trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized || 'smoke'
}
