import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderRuntimeDebugRing } from '../providerRuntimeDiagnostics'

test('provider runtime debug ring caps events and filters noisy records by default', () => {
  const ring = new ProviderRuntimeDebugRing(3)
  ring.record({ providerId: 'codex', runtime: 'app-server', sessionId: 'one', message: 'first' })
  ring.record({ providerId: 'codex', runtime: 'app-server', sessionId: 'one', method: 'turn/start', noisy: true, message: 'second' })
  ring.record({ providerId: 'claude', runtime: 'headless', sessionId: 'two', message: 'third' })
  ring.record({ providerId: 'codex', runtime: 'app-server', sessionId: 'three', severity: 'error', code: 'EPIPE', message: 'fourth' })

  assert.deepEqual(ring.list({ includeNoisy: true }).map((event) => event.message), ['second', 'third', 'fourth'])
  assert.deepEqual(ring.list().map((event) => event.message), ['third', 'fourth'])
  assert.deepEqual(ring.list({ providerId: 'codex', includeNoisy: true }).map((event) => event.message), ['second', 'fourth'])
  assert.deepEqual(ring.list({ sessionId: 'three' }).map((event) => event.code), ['EPIPE'])
})
