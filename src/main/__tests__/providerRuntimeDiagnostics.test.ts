import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ProviderRuntimeDebugRing,
  clearProviderRuntimeConnections,
  listProviderRuntimeConnections,
  updateProviderRuntimeConnection
} from '../providerRuntimeDiagnostics'

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

test('provider runtime connections preserve start time and latest state', () => {
  clearProviderRuntimeConnections()
  const first = updateProviderRuntimeConnection({
    providerId: 'codex',
    runtime: 'app-server',
    sessionId: 'session-1',
    hostId: 'stdio://codex-app-server',
    status: 'starting',
    method: 'initialize',
    message: 'starting'
  })
  const second = updateProviderRuntimeConnection({
    providerId: 'codex',
    runtime: 'app-server',
    sessionId: 'session-1',
    hostId: 'thread-1',
    status: 'connected',
    version: 'v2',
    message: 'connected'
  })

  assert.equal(second.id, first.id)
  assert.equal(second.startedAt, first.startedAt)
  assert.equal(second.status, 'connected')
  assert.equal(second.version, 'v2')
  assert.deepEqual(listProviderRuntimeConnections({ providerId: 'codex' }).map((state) => state.hostId), ['thread-1'])
})
