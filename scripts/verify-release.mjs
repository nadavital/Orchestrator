#!/usr/bin/env node
import { createHash } from 'crypto'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packagedApp = join(root, 'dist', 'mac-arm64', 'Orchestrator.app')
const packagedAsar = join(packagedApp, 'Contents', 'Resources', 'app.asar')
const installedAsar = '/Applications/Orchestrator.app/Contents/Resources/app.asar'
const outputPath = join(root, 'tmp', 'release-verification.json')
mkdirSync(join(root, 'tmp'), { recursive: true })

run('npm', ['run', 'pack:mac'])
run('npm', ['run', 'smoke:ui:auto', '--', '--packaged', '--session-switch'])

const result = {
  createdAt: new Date().toISOString(),
  packagedApp,
  packagedExists: existsSync(packagedApp),
  packagedAsarHash: existsSync(packagedAsar) ? sha256(packagedAsar) : null,
  installedAsarHash: existsSync(installedAsar) ? sha256(installedAsar) : null
}

writeFileSync(outputPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ outputPath, ...result }, null, 2))

function run(binary, args) {
  const result = spawnSync(process.platform === 'win32' && binary === 'npm' ? 'npm.cmd' : binary, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
