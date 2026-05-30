import assert from 'node:assert/strict'
import test from 'node:test'
import { extractChildArtifactPaths, normalizeCliArgs, slowTargetsForResults, targetCoverageForTargets } from './run-daily-coding-smoke.mjs'

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
