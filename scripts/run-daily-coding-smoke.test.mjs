import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateDailyCodingCoverage, extractChildArtifactPaths, normalizeCliArgs, slowTargetsForResults, targetCoverageForTargets } from './run-daily-coding-smoke.mjs'

test('normalizes package-manager option separators before runner args', () => {
  assert.deepEqual(normalizeCliArgs(['--', '--only', 'header']), ['--only', 'header'])
  assert.deepEqual(normalizeCliArgs(['--', '--', '--full', '--keep-going']), ['--full', '--keep-going'])
  assert.deepEqual(normalizeCliArgs(['--only=header']), ['--only=header'])
})

test('extracts child smoke artifact paths from stderr failures', () => {
  const paths = extractChildArtifactPaths('', [
    '[daily-coding-smoke] failed --workbench-new-tab',
    '{',
    '  "outputPath": "/tmp/orchestrator-automated-ui-smoke-workbench-new-tab.json",',
    '  "screenshotPath": "/tmp/orchestrator-automated-ui-smoke-workbench-new-tab.png"',
    '}'
  ].join('\n'))

  assert.deepEqual(paths, {
    outputPath: '/tmp/orchestrator-automated-ui-smoke-workbench-new-tab.json',
    screenshotPath: '/tmp/orchestrator-automated-ui-smoke-workbench-new-tab.png'
  })
})

test('sorts slow daily-coding targets by duration', () => {
  const slowTargets = slowTargetsForResults([
    { target: '--header', durationMs: 8000, status: 0 },
    { target: '--files', durationMs: 38174, status: 0 },
    { target: '--browser', durationMs: 29301, status: 0 },
    { target: '--composer', durationMs: 42000, status: 0 }
  ], 30000)

  assert.deepEqual(slowTargets.map((target) => target.target), ['--composer', '--files'])
})

test('reports daily-coding target set coverage', () => {
  const partial = targetCoverageForTargets(['header', '--composer', '--browser'])
  assert.equal(partial.core.complete, false)
  assert.deepEqual(partial.core.covered, ['--header', '--composer', '--browser'])
  assert.ok(partial.core.missing.includes('--session-switch'))
  assert.equal(partial.full.complete, false)
  assert.ok(partial.full.missing.includes('--side-chat'))

  const full = targetCoverageForTargets([
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
  ])
  assert.equal(full.core.complete, true)
  assert.equal(full.full.complete, true)
  assert.deepEqual(full.full.missing, [])
})

test('aggregates daily-coding coverage across focused manifests', () => {
  const summary = aggregateDailyCodingCoverage([
    {
      manifestPath: '/tmp/a.json',
      createdAt: '2026-05-30T01:00:00.000Z',
      mode: 'dev',
      set: 'custom',
      results: [
        { target: '--header', status: 0, durationMs: 1000 },
        { target: '--composer', status: 0, durationMs: 2000 },
        { target: '--files', status: 1, durationMs: 3000 }
      ]
    },
    {
      manifestPath: '/tmp/b.json',
      createdAt: '2026-05-30T02:00:00.000Z',
      mode: 'dev',
      set: 'custom',
      results: [
        { target: 'files', status: 0, durationMs: 4000 },
        { target: '--browser', status: 0, durationMs: 5000 }
      ]
    }
  ])

  assert.equal(summary.consideredManifestCount, 2)
  assert.equal(summary.passedTargetCount, 4)
  assert.equal(summary.slowTargetThresholdMs, 30000)
  assert.equal(summary.core.complete, false)
  assert.deepEqual(summary.core.covered, ['--header', '--composer', '--files', '--browser'])
  assert.ok(summary.core.missing.includes('--session-switch'))
  assert.equal(summary.full.complete, false)
  assert.equal(summary.full.latestPassed.find((target) => target.target === '--files')?.manifestPath, '/tmp/b.json')
})

test('aggregates slow daily-coding targets from latest passing manifests', () => {
  const summary = aggregateDailyCodingCoverage([
    {
      manifestPath: '/tmp/a.json',
      createdAt: '2026-05-30T01:00:00.000Z',
      mode: 'dev',
      set: 'custom',
      results: [
        { target: '--files', status: 0, durationMs: 52000 },
        { target: '--browser', status: 0, durationMs: 31000 }
      ]
    },
    {
      manifestPath: '/tmp/b.json',
      createdAt: '2026-05-30T02:00:00.000Z',
      mode: 'dev',
      set: 'custom',
      results: [
        { target: '--files', status: 0, durationMs: 28000 },
        { target: '--composer', status: 0, durationMs: 45000 }
      ]
    }
  ], { slowTargetThresholdMs: 30000 })

  assert.deepEqual(summary.full.slowTargets.map((target) => target.target), ['--composer', '--browser'])
  assert.equal(summary.full.slowTargets.find((target) => target.target === '--files'), undefined)
})

test('aggregates full coverage from multiple passing manifests', () => {
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
  const summary = aggregateDailyCodingCoverage(fullTargets.map((target, index) => ({
    manifestPath: `/tmp/${index}.json`,
    createdAt: `2026-05-30T02:${String(index).padStart(2, '0')}:00.000Z`,
    passed: true,
    targets: [target]
  })))

  assert.equal(summary.core.complete, true)
  assert.equal(summary.full.complete, true)
  assert.deepEqual(summary.full.missing, [])
})

test('prefers stdout artifact paths when the child smoke passes', () => {
  const paths = extractChildArtifactPaths([
    '{',
    '  "outputPath": "/tmp/orchestrator-automated-ui-smoke-header.json",',
    '  "screenshotPath": "/tmp/orchestrator-automated-ui-smoke-header.png"',
    '}'
  ].join('\n'), '')

  assert.deepEqual(paths, {
    outputPath: '/tmp/orchestrator-automated-ui-smoke-header.json',
    screenshotPath: '/tmp/orchestrator-automated-ui-smoke-header.png'
  })
})
