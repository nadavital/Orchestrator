import test from 'node:test'
import assert from 'node:assert/strict'
import { providerManifests } from '../providerManifest'

test('provider manifests expose scalable runtime and status contracts', () => {
  const manifests = providerManifests()

  assert.ok(manifests.claude)
  assert.ok(manifests.codex)
  assert.equal(manifests.claude.defaultRuntime, 'sdk')
  assert.deepEqual(manifests.claude.runtimes, ['sdk'])
  assert.equal(manifests.codex.defaultRuntime, 'app-server')
  assert.ok(manifests.codex.runtimes.includes('app-server'))
  assert.equal(manifests.copilot.defaultRuntime, 'sdk')
  assert.ok(manifests.copilot.runtimes.includes('sdk'))
  assert.ok(manifests.copilot.runtimes.includes('headless'))
  assert.equal(manifests.cursor.defaultRuntime, 'headless')
  assert.ok(manifests.cursor.runtimes.includes('headless'))
  assert.ok(manifests.cursor.runtimes.includes('sdk'))
  assert.ok(manifests.claude.statusLifecycle.includes('waiting_for_permission'))
  assert.ok(manifests.cursor.customStates.includes('reconnecting'))
})
