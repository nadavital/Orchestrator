import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRefreshCodexSidebarMetadataAfterRun, shouldRefreshCodexSidebarMetadataOnIdle, syncCodexSidebarThreadMetadata } from '../providerSidebarSync'

test('codex sidebar thread metadata sync skips when no Codex sessions exist', async () => {
  let fetched = false
  const result = await syncCodexSidebarThreadMetadata({
    cwd: '/tmp/orchestrator-test',
    sessions: [{ provider: 'claude' }, { provider: 'cursor' }],
    fetchThreadList: async () => {
      fetched = true
      return []
    },
    applyThreadList: () => 1
  })

  assert.equal(fetched, false)
  assert.deepEqual(result, {
    ok: true,
    providerId: 'codex',
    changed: 0,
    skipped: 'no-provider-sessions'
  })
})

test('codex sidebar thread metadata sync fetches and applies thread list for Codex sessions', async () => {
  const result = await syncCodexSidebarThreadMetadata({
    cwd: '/tmp/orchestrator-test',
    sessions: [{ provider: 'codex' }, { provider: 'claude' }],
    fetchThreadList: async (cwd) => ({ data: [{ id: 'thread-1', cwd }] }),
    applyThreadList: (threadListResult) => {
      assert.deepEqual(threadListResult, { data: [{ id: 'thread-1', cwd: '/tmp/orchestrator-test' }] })
      return 2
    }
  })

  assert.deepEqual(result, {
    ok: true,
    providerId: 'codex',
    changed: 2
  })
})

test('codex sidebar thread metadata sync reports app-server fetch failures without throwing', async () => {
  const result = await syncCodexSidebarThreadMetadata({
    cwd: '/tmp/orchestrator-test',
    sessions: [{ provider: 'codex' }],
    fetchThreadList: async () => {
      throw new Error('app-server unavailable')
    },
    applyThreadList: () => 1
  })

  assert.equal(result.ok, false)
  assert.equal(result.providerId, 'codex')
  assert.equal(result.changed, 0)
  assert.match(result.error ?? '', /app-server unavailable/)
})

test('codex sidebar thread metadata refresh after run is scoped to non-smoke app-server runs', () => {
  assert.equal(shouldRefreshCodexSidebarMetadataAfterRun({
    providerId: 'codex',
    runtime: 'app-server'
  }), true)
  assert.equal(shouldRefreshCodexSidebarMetadataAfterRun({
    providerId: 'codex',
    runtime: 'headless'
  }), false)
  assert.equal(shouldRefreshCodexSidebarMetadataAfterRun({
    providerId: 'claude',
    runtime: 'app-server'
  }), false)
  assert.equal(shouldRefreshCodexSidebarMetadataAfterRun({
    providerId: 'codex',
    runtime: 'app-server',
    smokeOutput: '/tmp/orchestrator-smoke.json'
  }), false)
})

test('codex sidebar thread metadata idle refresh is smoke-safe, throttled, and single-flight', () => {
  assert.equal(shouldRefreshCodexSidebarMetadataOnIdle({
    now: 1_000,
    minIntervalMs: 5_000
  }), true)
  assert.equal(shouldRefreshCodexSidebarMetadataOnIdle({
    now: 1_000,
    lastRefreshAt: 900,
    minIntervalMs: 5_000
  }), false)
  assert.equal(shouldRefreshCodexSidebarMetadataOnIdle({
    now: 6_001,
    lastRefreshAt: 1_000,
    minIntervalMs: 5_000
  }), true)
  assert.equal(shouldRefreshCodexSidebarMetadataOnIdle({
    now: 6_001,
    lastRefreshAt: 1_000,
    minIntervalMs: 5_000,
    inFlight: true
  }), false)
  assert.equal(shouldRefreshCodexSidebarMetadataOnIdle({
    now: 6_001,
    lastRefreshAt: 1_000,
    minIntervalMs: 5_000,
    smokeOutput: '/tmp/orchestrator-smoke.json'
  }), false)
})
