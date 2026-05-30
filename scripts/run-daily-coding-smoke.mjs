#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
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

  if (options.summary) {
    const manifests = readDailyCodingManifests(outputDir, options.sinceHours)
    const summary = aggregateDailyCodingCoverage(manifests)
    console.log(JSON.stringify({
      outputDir,
      sinceHours: options.sinceHours,
      ...summary
    }, null, 2))
    process.exit(summary.full.complete ? 0 : 1)
  }

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
  const targetCoverage = targetCoverageForTargets(targets)
  const manifest = {
    createdAt: new Date().toISOString(),
    mode: options.installed ? 'installed' : options.packaged ? 'packaged' : 'dev',
    set: options.targets.length > 0 ? 'custom' : options.full ? 'full' : 'core',
    targets,
    targetCoverage,
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
    coverage: {
      coreComplete: targetCoverage.core.complete,
      fullComplete: targetCoverage.full.complete,
      missingCoreTargets: targetCoverage.core.missing,
      missingFullTargets: targetCoverage.full.missing
    },
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
    sinceHours: 72,
    slowTargetThresholdMs: DEFAULT_SLOW_TARGET_THRESHOLD_MS,
    summary: false,
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
    else if (arg === '--summary') parsed.summary = true
    else if (arg === '--since-hours') parsed.sinceHours = parsePositiveInteger(args[++index], '--since-hours')
    else if (arg.startsWith('--since-hours=')) parsed.sinceHours = parsePositiveInteger(arg.slice('--since-hours='.length), '--since-hours')
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

export function targetCoverageForTargets(targets) {
  const selected = new Set((targets ?? []).map((target) => normalizeTargetFlag(target)))
  return {
    core: targetSetCoverage(targetSets.core, selected),
    full: targetSetCoverage(targetSets.full, selected)
  }
}

export function aggregateDailyCodingCoverage(manifests) {
  const passedByTarget = new Map()
  const considered = Array.isArray(manifests) ? manifests : []
  for (const manifest of considered) {
    const manifestPath = typeof manifest.manifestPath === 'string' ? manifest.manifestPath : null
    const results = Array.isArray(manifest.results) ? manifest.results : []
    const targetStatuses = results.length > 0
      ? results.map((result) => ({ target: normalizeTargetFlag(result.target), status: result.status, durationMs: result.durationMs }))
      : Array.isArray(manifest.targets)
        ? manifest.targets.map((target) => ({ target: normalizeTargetFlag(target), status: manifest.passed === true ? 0 : 1, durationMs: undefined }))
        : []
    for (const result of targetStatuses) {
      if (result.status !== 0 || !allowedTargets.has(result.target)) continue
      const previous = passedByTarget.get(result.target)
      const candidate = {
        target: result.target,
        manifestPath,
        createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : null,
        mode: typeof manifest.mode === 'string' ? manifest.mode : null,
        set: typeof manifest.set === 'string' ? manifest.set : null,
        durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null
      }
      if (!previous || compareCreatedAt(candidate.createdAt, previous.createdAt) >= 0) {
        passedByTarget.set(result.target, candidate)
      }
    }
  }
  const coveredTargets = [...passedByTarget.keys()].sort((left, right) => targetSortIndex(left) - targetSortIndex(right))
  const targetCoverage = targetCoverageForTargets(coveredTargets)
  return {
    generatedAt: new Date().toISOString(),
    consideredManifestCount: considered.length,
    passedTargetCount: coveredTargets.length,
    core: {
      ...targetCoverage.core,
      latestPassed: latestPassedForTargets(targetSets.core, passedByTarget)
    },
    full: {
      ...targetCoverage.full,
      latestPassed: latestPassedForTargets(targetSets.full, passedByTarget)
    }
  }
}

function latestPassedForTargets(targets, passedByTarget) {
  return targets
    .map((target) => passedByTarget.get(target))
    .filter(Boolean)
}

function targetSortIndex(target) {
  const index = targetSets.full.indexOf(target)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function compareCreatedAt(left, right) {
  const leftTime = Date.parse(left ?? '')
  const rightTime = Date.parse(right ?? '')
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0
  if (Number.isNaN(leftTime)) return -1
  if (Number.isNaN(rightTime)) return 1
  return leftTime - rightTime
}

function readDailyCodingManifests(outputDir, sinceHours) {
  const cutoffMs = Date.now() - (sinceHours * 60 * 60 * 1000)
  return readdirSync(outputDir)
    .filter((name) => /^daily-coding-smoke-\d+\.json$/.test(name))
    .map((name) => {
      const manifestPath = join(outputDir, name)
      const stats = statSync(manifestPath)
      return { manifestPath, mtimeMs: stats.mtimeMs }
    })
    .filter((entry) => entry.mtimeMs >= cutoffMs)
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((entry) => {
      const manifest = JSON.parse(readFileSync(entry.manifestPath, 'utf8'))
      return { ...manifest, manifestPath: entry.manifestPath }
    })
}

function targetSetCoverage(requiredTargets, selectedTargets) {
  const missing = requiredTargets.filter((target) => !selectedTargets.has(target))
  const extra = [...selectedTargets].filter((target) => !requiredTargets.includes(target))
  return {
    complete: missing.length === 0,
    covered: requiredTargets.filter((target) => selectedTargets.has(target)),
    missing,
    extra
  }
}

function normalizeTargetFlag(target) {
  const value = String(target ?? '').trim()
  return value.startsWith('--') ? value : `--${value}`
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
