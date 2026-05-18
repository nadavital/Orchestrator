#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { assertNoRunningInstalledOrchestrator } from './lib/orchestrator-processes.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagedApp = join(root, 'dist', 'mac-arm64', 'Orchestrator.app')
const installedApp = '/Applications/Orchestrator.app'
const dryRun = process.argv.includes('--dry-run')

if (!existsSync(packagedApp)) {
  console.error(`Packaged app not found at ${packagedApp}`)
  console.error('Run npm run pack:mac first.')
  process.exit(1)
}

assertNoRunningInstalledOrchestrator('replace /Applications/Orchestrator.app')

if (dryRun) {
  console.log(`Install guard passed for ${packagedApp} -> ${installedApp}`)
  process.exit(0)
}

const result = spawnSync('ditto', [packagedApp, installedApp], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

console.log(`Installed ${packagedApp} -> ${installedApp}`)
