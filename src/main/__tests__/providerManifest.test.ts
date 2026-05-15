import test from 'node:test'
import assert from 'node:assert/strict'
import { providerManifests } from '../providerManifest'

test('provider manifests expose scalable runtime and status contracts', () => {
  const manifests = providerManifests()

  assert.ok(manifests.claude)
  assert.ok(manifests.codex)
  assert.equal(manifests.codex.defaultRuntime, 'app-server')
  assert.ok(manifests.codex.runtimes.includes('app-server'))
  assert.ok(manifests.claude.statusLifecycle.includes('waiting_for_permission'))
  assert.ok(manifests.cursor.customStates.includes('reconnecting'))
})
