#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { aggregateDailyCodingCoverage } from './run-daily-coding-smoke.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildPhase1ReadinessReport({
    rootDir: root,
    sinceHours: options.sinceHours,
    nowMs: Date.now()
  })
  if (options.markdown) printMarkdown(report)
  else console.log(JSON.stringify(report, null, 2))

  const complete = options.requireFullParity ? report.overall.fullParityComplete : report.overall.localDailyUseReady
  process.exit(complete ? 0 : 1)
}

export function buildPhase1ReadinessReport({ rootDir = root, sinceHours = 72, nowMs = Date.now() } = {}) {
  const dailyManifests = readDailyCodingManifests(join(rootDir, 'tmp', 'daily-coding-smoke'), sinceHours, nowMs)
  const dailyCoding = aggregateDailyCodingCoverage(dailyManifests)
  const comparisonPath = join(rootDir, 'tmp', 'codex-side-panel-comparison', 'comparison-report.json')
  const comparison = readJson(comparisonPath)
  const statusCounts = comparison?.statusCounts ?? comparison?.summary?.statusCounts ?? {}
  const actionableGapSummary = comparison?.actionableGapSummary ?? null
  const remainingParityGapCounts = comparison?.remainingParityGapCounts ?? {}
  const remainingParityGapCount = numberValue(comparison?.remainingParityGapCount) ?? 0
  const localActionable = numberValue(actionableGapSummary?.localActionable)
  const localComparisonReady =
    localActionable === 0 &&
    statusCount(statusCounts, 'mismatch') === 0 &&
    statusCount(statusCounts, 'needs-smoke') === 0 &&
    statusCount(statusCounts, 'needs-proof') === 0
  const localDailyUseReady = dailyCoding.full.complete === true && localComparisonReady
  const fullParityComplete = localDailyUseReady && remainingParityGapCount === 0

  return {
    generatedAt: new Date(nowMs).toISOString(),
    sinceHours,
    overall: {
      localDailyUseReady,
      fullParityComplete,
      recommendation: nextRecommendation({
        dailyCoding,
        localComparisonReady,
        localActionable,
        remainingParityGapCount,
        remainingParityGapCounts
      })
    },
    dailyCoding: {
      consideredManifestCount: dailyCoding.consideredManifestCount,
      fullComplete: dailyCoding.full.complete,
      missingFullTargets: dailyCoding.full.missing,
      latestFullTargets: dailyCoding.full.latestPassed
    },
    comparison: comparison
      ? {
          path: relative(rootDir, comparisonPath),
          createdAt: comparison.createdAt ?? null,
          localComparisonReady,
          statusCounts,
          remainingParityGapCount,
          remainingParityGapCounts,
          actionableGapSummary
        }
      : {
          path: relative(rootDir, comparisonPath),
          localComparisonReady: false,
          missing: true
        },
    proofArtifacts: {
      githubReviewMetadata: summarizeProof(rootDir, 'tmp/github-review-metadata-live-proof/result.json', (proof) => ({
        status: proof.status ?? null,
        authenticated: proof.authenticated === true,
        commentedProof: proof.commentedProof === true,
        boundary: proof.boundary ?? proof.warning ?? null
      })),
      claudeCapabilities: summarizeProof(rootDir, 'tmp/claude-live-capabilities/_summary/summary.json', (proof) => ({
        status: proof.status ?? null,
        unavailableReason: proof.unavailableReason ?? proof.reason ?? proof.error ?? null
      })),
      codexBrowserRuntime: summarizeProof(rootDir, 'tmp/codex-browser-appserver-live-proof/result.json', (proof) => ({
        status: proof.status ?? browserRuntimeStatus(proof),
        browserUseEventCount: Array.isArray(proof.browserEvents) ? proof.browserEvents.length : null,
        conclusion: proof.conclusion ?? proof.boundary ?? proof.reason ?? null
      })),
      codexComposerUserInput: summarizeProof(rootDir, 'tmp/codex-composer-user-input-live-proof/result.json', (proof) => ({
        status: proof.status ?? liveBoundaryStatus(proof),
        userInputRequestCount: Array.isArray(proof.userInputRequests) ? proof.userInputRequests.length : null,
        requireUserInput: proof.requireUserInput === true,
        conclusion: proof.conclusion ?? proof.boundary ?? proof.reason ?? null
      })),
      codexPinnedThreads: summarizeProof(rootDir, 'tmp/codex-pinned-threads-live-proof/result.json', (proof) => ({
        status: proof.status ?? null,
        unsupportedMethods: Array.isArray(proof.unsupportedMethods) ? proof.unsupportedMethods : [],
        boundary: proof.boundary ?? proof.conclusion ?? null
      }))
    }
  }
}

function parseArgs(args) {
  args = [...args]
  while (args[0] === '--') args.shift()
  const parsed = {
    markdown: false,
    requireFullParity: false,
    sinceHours: 72
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--markdown') parsed.markdown = true
    else if (arg === '--require-full-parity') parsed.requireFullParity = true
    else if (arg === '--since-hours') parsed.sinceHours = parsePositiveInteger(args[++index], '--since-hours')
    else if (arg.startsWith('--since-hours=')) parsed.sinceHours = parsePositiveInteger(arg.slice('--since-hours='.length), '--since-hours')
    else throw new Error(`Unknown option: ${arg}`)
  }
  return parsed
}

function readDailyCodingManifests(outputDir, sinceHours, nowMs) {
  if (!existsSync(outputDir)) return []
  const cutoffMs = nowMs - (sinceHours * 60 * 60 * 1000)
  return readdirSync(outputDir)
    .filter((name) => /^daily-coding-smoke-\d+\.json$/.test(name))
    .map((name) => {
      const manifestPath = join(outputDir, name)
      return { manifestPath, stats: statSync(manifestPath) }
    })
    .filter((entry) => entry.stats.mtimeMs >= cutoffMs)
    .sort((left, right) => left.stats.mtimeMs - right.stats.mtimeMs)
    .map((entry) => ({ ...readJson(entry.manifestPath), manifestPath: entry.manifestPath }))
}

function summarizeProof(rootDir, relativePath, summarize) {
  const fullPath = join(rootDir, relativePath)
  const parsed = readJson(fullPath)
  if (!parsed) return { path: relativePath, available: false }
  return {
    path: relativePath,
    available: true,
    completedAt: parsed.completedAt ?? parsed.generatedAt ?? parsed.createdAt ?? null,
    ...summarize(parsed)
  }
}

function nextRecommendation({ dailyCoding, localComparisonReady, localActionable, remainingParityGapCount, remainingParityGapCounts }) {
  if (dailyCoding.full.complete !== true) {
    return `Run focused daily-coding targets for missing surfaces: ${dailyCoding.full.missing.join(', ')}.`
  }
  if (!localComparisonReady) {
    return localActionable && localActionable > 0
      ? `Fix ${localActionable} local actionable comparison gap(s) before more live/provider proof.`
      : 'Refresh the side-panel comparison and resolve local mismatch/needs-smoke/needs-proof rows.'
  }
  if (remainingParityGapCount > 0) {
    return `Local daily-use proof is ready; remaining work is external/live/provider/Phase 2: ${formatGapCounts(remainingParityGapCounts)}.`
  }
  return 'Phase 1 parity evidence is complete.'
}

function printMarkdown(report) {
  console.log(`# Phase 1 Readiness`)
  console.log('')
  console.log(`- Local daily-use ready: ${report.overall.localDailyUseReady ? 'yes' : 'no'}`)
  console.log(`- Full parity complete: ${report.overall.fullParityComplete ? 'yes' : 'no'}`)
  console.log(`- Daily-coding full coverage: ${report.dailyCoding.fullComplete ? 'yes' : 'no'} (${report.dailyCoding.consideredManifestCount} manifests)`)
  console.log(`- Comparison local-ready: ${report.comparison.localComparisonReady ? 'yes' : 'no'}`)
  console.log(`- Remaining parity gaps: ${formatGapCounts(report.comparison.remainingParityGapCounts ?? {}) || 'none'}`)
  console.log(`- Recommendation: ${report.overall.recommendation}`)
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function formatGapCounts(counts) {
  return Object.entries(counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ')
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function statusCount(statusCounts, key) {
  return numberValue(statusCounts?.[key]) ?? 0
}

function browserRuntimeStatus(proof) {
  if (proof.ok === true) return 'passed'
  if (proof.ok === false && isBlockedReason(proof.reason)) return 'blocked'
  if (proof.ok === false) return 'failed'
  return null
}

function liveBoundaryStatus(proof) {
  if (proof.ok === true) return 'passed'
  if (proof.ok === false && isBlockedReason(proof.reason)) return 'blocked'
  if (proof.ok === false) return 'failed'
  return null
}

function isBlockedReason(reason) {
  return typeof reason === 'string' && (/^blocked:/i.test(reason) || /unavailable/i.test(reason))
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive integer for ${optionName}.`)
  return parsed
}
