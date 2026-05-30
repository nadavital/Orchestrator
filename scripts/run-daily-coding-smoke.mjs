#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_SLOW_TARGET_THRESHOLD_MS = 30000
const targetSets = {
  core: [
    '--header',
    '--session-switch',
    '--composer',
    '--transcript-layout',
    '--workbench-new-tab',
    '--right-panel',
    '--diff-core',
    '--files',
    '--browser',
    '--terminal',
    '--settings'
  ],
  full: [
    '--header',
    '--session-switch',
    '--composer',
    '--transcript-layout',
    '--transcript-permission',
    '--transcript-user-input',
    '--workbench-new-tab',
    '--agent-inspector',
    '--right-panel',
    '--environment',
    '--diff-core',
    '--files',
    '--browser',
    '--terminal',
    '--settings',
    '--settings-providers',
    '--side-chat'
  ]
}
const allowedTargets = new Set([...targetSets.core, ...targetSets.full])

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  const targets = options.targets.length > 0
    ? options.targets
    : targetSets[options.full ? 'full' : 'core']

  if (options.list) {
    console.log('Daily coding smoke targets')
    console.log('')
    console.log('Core:')
    for (const target of targetSets.core) console.log(`  ${target}`)
    console.log('')
    console.log('Full:')
    for (const target of targetSets.full) console.log(`  ${target}`)
    process.exit(0)
  }

  const outputDir = resolve(options.outDir ?? join(root, 'tmp', 'daily-coding-smoke'))
  mkdirSync(outputDir, { recursive: true })

  const startedAt = Date.now()
  const results = []
  for (const target of targets) {
    const args = ['scripts/run-automated-ui-smoke.mjs', target]
    if (options.packaged) args.push('--packaged')
    if (options.installed) args.push('--installed')
    const started = Date.now()
    console.log(`\n[daily-coding-smoke] ${target}`)
    const result = spawnSync('node', args, {
      cwd: root,
      env: process.env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const { outputPath, screenshotPath } = extractChildArtifactPaths(result.stdout, result.stderr)
    const summary = {
      target,
      status: result.status ?? 1,
      signal: result.signal ?? null,
      durationMs: Date.now() - started,
      outputPath,
      screenshotPath
    }
    results.push(summary)
    if (summary.status === 0) {
      const seconds = (summary.durationMs / 1000).toFixed(1)
      const suffix = outputPath ? ` -> ${outputPath}` : ''
      console.log(`[daily-coding-smoke] passed ${target} in ${seconds}s${suffix}`)
      if (options.verbose) {
        if (result.stdout) process.stdout.write(result.stdout)
        if (result.stderr) process.stderr.write(result.stderr)
      }
    } else {
      const seconds = (summary.durationMs / 1000).toFixed(1)
      const suffix = outputPath ? ` -> ${outputPath}` : ''
      console.log(`[daily-coding-smoke] failed ${target} in ${seconds}s${suffix}`)
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    if (summary.status !== 0 && !options.keepGoing) break
  }

  const failed = results.filter((result) => result.status !== 0)
  const slowTargets = slowTargetsForResults(results, options.slowTargetThresholdMs)
  const manifest = {
    createdAt: new Date().toISOString(),
    mode: options.installed ? 'installed' : options.packaged ? 'packaged' : 'dev',
    set: options.targets.length > 0 ? 'custom' : options.full ? 'full' : 'core',
    targets,
    durationMs: Date.now() - startedAt,
    slowTargetThresholdMs: options.slowTargetThresholdMs,
    slowTargets,
    passed: failed.length === 0 && results.length === targets.length,
    results
  }
  const manifestPath = join(outputDir, `daily-coding-smoke-${Date.now()}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log('')
  console.log(JSON.stringify({
    manifestPath,
    passed: manifest.passed,
    failed: failed.map((result) => result.target),
    slowTargets: slowTargets.map((result) => ({
      target: result.target,
      durationMs: result.durationMs
    }))
  }, null, 2))
  process.exit(manifest.passed ? 0 : 1)
}

export function normalizeCliArgs(args) {
  const normalized = [...args]
  while (normalized[0] === '--') normalized.shift()
  return normalized
}

function parseArgs(args) {
  args = normalizeCliArgs(args)
  const parsed = {
    full: false,
    installed: false,
    keepGoing: false,
    list: false,
    outDir: undefined,
    packaged: false,
    slowTargetThresholdMs: DEFAULT_SLOW_TARGET_THRESHOLD_MS,
    targets: [],
    verbose: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--full') parsed.full = true
    else if (arg === '--installed') parsed.installed = true
    else if (arg === '--keep-going') parsed.keepGoing = true
    else if (arg === '--list') parsed.list = true
    else if (arg === '--packaged') parsed.packaged = true
    else if (arg === '--slow-threshold-ms') parsed.slowTargetThresholdMs = parsePositiveInteger(args[++index], '--slow-threshold-ms')
    else if (arg.startsWith('--slow-threshold-ms=')) parsed.slowTargetThresholdMs = parsePositiveInteger(arg.slice('--slow-threshold-ms='.length), '--slow-threshold-ms')
    else if (arg === '--verbose') parsed.verbose = true
    else if (arg === '--out') parsed.outDir = args[++index]
    else if (arg.startsWith('--out=')) parsed.outDir = arg.slice('--out='.length)
    else if (arg === '--only') parsed.targets.push(...splitTargets(args[++index] ?? ''))
    else if (arg.startsWith('--only=')) parsed.targets.push(...splitTargets(arg.slice('--only='.length)))
    else {
      console.error(`Unknown option: ${arg}`)
      process.exit(1)
    }
  }
  if (parsed.installed && parsed.packaged) {
    console.error('Use either --packaged or --installed, not both.')
    process.exit(1)
  }
  parsed.targets = parsed.targets.map((target) => target.startsWith('--') ? target : `--${target}`)
  for (const target of parsed.targets) {
    if (!allowedTargets.has(target)) {
      console.error(`Unknown daily-coding target: ${target}`)
      console.error('Run pnpm run smoke:ui:daily-coding --list to see supported targets.')
      process.exit(1)
    }
  }
  return parsed
}

function splitTargets(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Expected a positive integer for ${optionName}.`)
    process.exit(1)
  }
  return parsed
}

export function slowTargetsForResults(results, thresholdMs = DEFAULT_SLOW_TARGET_THRESHOLD_MS) {
  return results
    .filter((result) => result.durationMs >= thresholdMs)
    .map((result) => ({ ...result }))
    .sort((a, b) => b.durationMs - a.durationMs)
}

function matchJsonString(value, key) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`)
  const match = pattern.exec(value ?? '')
  return match?.[1] ?? null
}

export function extractChildArtifactPaths(stdout, stderr) {
  const childOutput = `${stdout ?? ''}\n${stderr ?? ''}`
  return {
    outputPath: matchJsonString(childOutput, 'outputPath'),
    screenshotPath: matchJsonString(childOutput, 'screenshotPath')
  }
}
