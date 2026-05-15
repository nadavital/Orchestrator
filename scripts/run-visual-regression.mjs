#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(root, 'tmp', 'visual-regression'))
const views = [
  ['main'],
  ['composer', '--composer'],
  ['settings', '--settings'],
  ['capabilities', '--capabilities'],
  ['terminal', '--terminal'],
  ['inspector', '--inspector'],
  ['design-system', '--design-system'],
  ['scroll', '--scroll'],
  ['session-switch', '--session-switch'],
  ['pet-overlay', '--pet-overlay'],
  ['motion-reduced', '--motion-reduced']
]

mkdirSync(outDir, { recursive: true })

const captures = []
for (const [name, flag] of views) {
  const args = ['run', 'smoke:ui:auto']
  if (flag) args.push('--', flag)
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  const parsed = parseLastJson(result.stdout)
  const screenshotPath = parsed.screenshotPath
  const size = screenshotPath && existsSync(screenshotPath) ? statSync(screenshotPath).size : 0
  captures.push({
    view: name,
    screenshotPath,
    size,
    checks: parsed.checks
  })
}

const manifestPath = join(outDir, 'manifest.json')
writeFileSync(manifestPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  captures,
  failed: captures.filter((capture) => capture.size <= 0).map((capture) => capture.view)
}, null, 2))

const failed = captures.filter((capture) => capture.size <= 0)
if (failed.length > 0) {
  console.error(JSON.stringify({ manifestPath, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ manifestPath, captures: captures.length }, null, 2))

function parseLastJson(stdout) {
  const lines = stdout.trim().split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines.slice(index).join('\n')
    try {
      return JSON.parse(line)
    } catch {
      // keep scanning
    }
  }
  throw new Error(`No JSON report found in smoke output:\n${stdout}`)
}
