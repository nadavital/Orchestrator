import assert from 'node:assert/strict'
import test from 'node:test'
import { extractChildArtifactPaths } from './run-daily-coding-smoke.mjs'

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
