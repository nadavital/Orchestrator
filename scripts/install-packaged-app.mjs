#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { assertNoRunningInstalledOrchestrator } from './lib/orchestrator-processes.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagedApp = join(root, 'dist', 'mac-arm64', 'Orchestrator.app')
const installedApp = '/Applications/Orchestrator.app'
const launchServicesRegister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const dryRun = process.argv.includes('--dry-run')

const run = (command, args, { required = true } = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status === 0) return

  const status = result.status ?? 1
  if (required) process.exit(status)
  console.warn(`Warning: ${command} ${args.join(' ')} exited with ${status}`)
}

if (!existsSync(packagedApp)) {
  console.error(`Packaged app not found at ${packagedApp}`)
  console.error('Run npm run pack:mac first.')
  process.exit(1)
}

assertNoRunningInstalledOrchestrator('replace /Applications/Orchestrator.app')

if (dryRun) {
  console.log(`Install guard passed for clean replacement of ${installedApp} from ${packagedApp}`)
  process.exit(0)
}

if (existsSync(installedApp)) {
  rmSync(installedApp, { recursive: true, force: true })
}

run('ditto', [packagedApp, installedApp])
run('xattr', ['-cr', installedApp])
run('codesign', ['--force', '--deep', '--sign', '-', installedApp])
run(launchServicesRegister, ['-f', installedApp], { required: false })
run('mdimport', [installedApp], { required: false })

console.log(`Installed ${packagedApp} -> ${installedApp}`)
