import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { buildPhase1ReadinessReport } from './report-phase1-readiness.mjs'

const fullTargets = [
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

test('reports local daily-use ready while external parity gaps remain', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-phase1-ready-'))
  writeJson(root, 'tmp/daily-coding-smoke/daily-coding-smoke-1.json', {
    createdAt: '2026-05-30T03:00:00.000Z',
    mode: 'dev',
    set: 'full',
    results: fullTargets.map((target) => ({ target, status: 0, durationMs: 1000 }))
  })
  writeJson(root, 'tmp/codex-side-panel-comparison/comparison-report.json', {
    createdAt: '2026-05-30T03:10:00.000Z',
    statusCounts: {
      blocked: 2,
      'fixture-covered': 8
    },
    remainingParityGapCount: 2,
    remainingParityGapCounts: {
      'provider-proof': 1,
      'runtime-signal': 1
    },
    actionableGapSummary: {
      localActionable: 0
    }
  })
  writeJson(root, 'tmp/github-review-metadata-live-proof/result.json', {
    status: 'passed',
    authenticated: true,
    commentedProof: false,
    boundary: 'No commented PR target.'
  })

  const report = buildPhase1ReadinessReport({
    rootDir: root,
    sinceHours: 72,
    nowMs: Date.parse('2026-05-30T04:00:00.000Z')
  })

  assert.equal(report.overall.localDailyUseReady, true)
  assert.equal(report.overall.fullParityComplete, false)
  assert.match(report.overall.recommendation, /remaining work is external/)
  assert.equal(report.proofArtifacts.githubReviewMetadata.authenticated, true)
  assert.equal(report.proofArtifacts.githubReviewMetadata.commentedProof, false)
})

test('reports missing local daily-coding targets before provider proof work', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-phase1-missing-'))
  writeJson(root, 'tmp/daily-coding-smoke/daily-coding-smoke-1.json', {
    createdAt: '2026-05-30T03:00:00.000Z',
    mode: 'dev',
    set: 'custom',
    results: [{ target: '--header', status: 0, durationMs: 1000 }]
  })
  writeJson(root, 'tmp/codex-side-panel-comparison/comparison-report.json', {
    statusCounts: {
      'fixture-covered': 1
    },
    remainingParityGapCount: 0,
    remainingParityGapCounts: {},
    actionableGapSummary: {
      localActionable: 0
    }
  })

  const report = buildPhase1ReadinessReport({
    rootDir: root,
    sinceHours: 72,
    nowMs: Date.parse('2026-05-30T04:00:00.000Z')
  })

  assert.equal(report.overall.localDailyUseReady, false)
  assert.match(report.overall.recommendation, /missing surfaces/)
  assert.ok(report.dailyCoding.missingFullTargets.includes('--composer'))
})

test('classifies blocked browser runtime proof without making local readiness fail', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-phase1-browser-blocked-'))
  writeJson(root, 'tmp/daily-coding-smoke/daily-coding-smoke-1.json', {
    createdAt: '2026-05-30T03:00:00.000Z',
    mode: 'dev',
    set: 'full',
    results: fullTargets.map((target) => ({ target, status: 0, durationMs: 1000 }))
  })
  writeJson(root, 'tmp/codex-side-panel-comparison/comparison-report.json', {
    statusCounts: {
      blocked: 1,
      'fixture-covered': 9
    },
    remainingParityGapCount: 1,
    remainingParityGapCounts: {
      'runtime-signal': 1
    },
    actionableGapSummary: {
      localActionable: 0
    }
  })
  writeJson(root, 'tmp/codex-browser-appserver-live-proof/result.json', {
    ok: false,
    reason: 'blocked: live Codex app-server completed but did not expose a browser/browser-use tool to this client',
    browserEvents: []
  })

  const report = buildPhase1ReadinessReport({
    rootDir: root,
    sinceHours: 72,
    nowMs: Date.parse('2026-05-30T04:00:00.000Z')
  })

  assert.equal(report.overall.localDailyUseReady, true)
  assert.equal(report.proofArtifacts.codexBrowserRuntime.status, 'blocked')
  assert.equal(report.proofArtifacts.codexBrowserRuntime.browserUseEventCount, 0)
})

test('summarizes blocked Codex composer user-input proof', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-phase1-user-input-blocked-'))
  writeJson(root, 'tmp/daily-coding-smoke/daily-coding-smoke-1.json', {
    createdAt: '2026-05-30T03:00:00.000Z',
    mode: 'dev',
    set: 'full',
    results: fullTargets.map((target) => ({ target, status: 0, durationMs: 1000 }))
  })
  writeJson(root, 'tmp/codex-side-panel-comparison/comparison-report.json', {
    statusCounts: {
      blocked: 1,
      'fixture-covered': 9
    },
    remainingParityGapCount: 1,
    remainingParityGapCounts: {
      'provider-proof': 1
    },
    actionableGapSummary: {
      localActionable: 0
    }
  })
  writeJson(root, 'tmp/codex-composer-user-input-live-proof/result.json', {
    ok: false,
    reason: 'live Codex app-server reported request_user_input is unavailable in Default mode',
    createdAt: '2026-05-30T04:05:00.000Z',
    requireUserInput: true,
    userInputRequests: []
  })

  const report = buildPhase1ReadinessReport({
    rootDir: root,
    sinceHours: 72,
    nowMs: Date.parse('2026-05-30T04:00:00.000Z')
  })

  assert.equal(report.overall.localDailyUseReady, true)
  assert.equal(report.proofArtifacts.codexComposerUserInput.status, 'blocked')
  assert.equal(report.proofArtifacts.codexComposerUserInput.completedAt, '2026-05-30T04:05:00.000Z')
  assert.equal(report.proofArtifacts.codexComposerUserInput.userInputRequestCount, 0)
  assert.equal(report.proofArtifacts.codexComposerUserInput.requireUserInput, true)
})

test('ignores package-manager option separators in cli args', async () => {
  const child = await import('node:child_process')
  const result = child.spawnSync(process.execPath, ['scripts/report-phase1-readiness.mjs', '--', '--markdown'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  assert.equal(result.stderr, '')
  assert.equal(result.status === 0 || result.status === 1, true)
  assert.match(result.stdout, /Phase 1 Readiness/)
})

function writeJson(root, relativePath, value) {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
