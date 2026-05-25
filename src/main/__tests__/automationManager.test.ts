import test from 'node:test'
import assert from 'node:assert/strict'
import type { AutomationRun, Automation, RunRequest } from '../../types'
import { applyAutomationPermissionSnapshot } from '../../types'
import { computeNextRunAt, createAutomationManager } from '../automations'

interface MemoryStoreSchema {
  automations: Automation[]
  automationRuns: AutomationRun[]
}

function createMemoryStore(seed: Partial<MemoryStoreSchema> = {}) {
  const data: MemoryStoreSchema = {
    automations: seed.automations ?? [],
    automationRuns: seed.automationRuns ?? []
  }
  return {
    get<Key extends keyof MemoryStoreSchema>(key: Key, fallback: MemoryStoreSchema[Key]): MemoryStoreSchema[Key] {
      return data[key] ?? fallback
    },
    set<Key extends keyof MemoryStoreSchema>(key: Key, value: MemoryStoreSchema[Key]): void {
      data[key] = value
    },
    data
  }
}

test('automation next run is absent for manual or paused schedules', () => {
  const now = Date.UTC(2026, 4, 23, 12, 0, 0)
  assert.equal(computeNextRunAt({
    schedule: { mode: 'manual', rrule: null },
    status: 'ACTIVE',
    now
  }), null)
  assert.equal(computeNextRunAt({
    schedule: { mode: 'interval', intervalMinutes: 30, rrule: null },
    status: 'PAUSED',
    now
  }), null)
})

test('automation interval schedules advance from the fake clock and last run', () => {
  const now = Date.UTC(2026, 4, 23, 12, 0, 0)
  assert.equal(computeNextRunAt({
    schedule: { mode: 'interval', intervalMinutes: 30, rrule: null },
    status: 'ACTIVE',
    now
  }), now + 30 * 60_000)
  assert.equal(computeNextRunAt({
    schedule: { mode: 'interval', intervalMinutes: 15, rrule: null },
    status: 'ACTIVE',
    now,
    lastRunAt: now - 60 * 60_000
  }), now + 15 * 60_000)
})

test('automation RRULE schedules support common minute hour day and week recurrence', () => {
  const now = new Date(2026, 4, 23, 12, 10, 0).getTime()
  assert.equal(computeNextRunAt({
    schedule: { mode: 'rrule', rrule: 'RRULE:FREQ=MINUTELY;INTERVAL=10' },
    status: 'ACTIVE',
    now,
    lastRunAt: now - 10 * 60_000
  }), now + 10 * 60_000)
  assert.equal(computeNextRunAt({
    schedule: { mode: 'rrule', rrule: 'RRULE:FREQ=HOURLY;INTERVAL=2' },
    status: 'ACTIVE',
    now
  }), now + 2 * 60 * 60_000)
  const daily = new Date(computeNextRunAt({
    schedule: { mode: 'rrule', rrule: 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30' },
    status: 'ACTIVE',
    now
  }) ?? 0)
  assert.equal(daily.getFullYear(), 2026)
  assert.equal(daily.getMonth(), 4)
  assert.equal(daily.getDate(), 24)
  assert.equal(daily.getHours(), 9)
  assert.equal(daily.getMinutes(), 30)
  const weekly = new Date(computeNextRunAt({
    schedule: { mode: 'rrule', rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=8;BYMINUTE=15' },
    status: 'ACTIVE',
    now
  }) ?? 0)
  assert.equal(weekly.getFullYear(), 2026)
  assert.equal(weekly.getMonth(), 4)
  assert.equal(weekly.getDate(), 25)
  assert.equal(weekly.getHours(), 8)
  assert.equal(weekly.getMinutes(), 15)
})

test('automation manager persists schedule state, pause resume delete, due list, and run history', () => {
  let fakeNow = Date.UTC(2026, 4, 23, 12, 0, 0)
  let idCounter = 0
  const memory = createMemoryStore()
  const manager = createAutomationManager({
    store: memory,
    now: () => fakeNow,
    createId: () => `auto-${++idCounter}`
  })

  const automation = manager.upsert({
    kind: 'heartbeat',
    name: 'Smoke follow-up',
    prompt: 'Check the thread',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'interval', intervalMinutes: 30, rrule: null },
    permissionSnapshot: {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandboxPolicy: 'workspace-write'
    }
  })

  assert.equal(automation.nextRunAt, fakeNow + 30 * 60_000)
  assert.equal(manager.listDue(fakeNow + 29 * 60_000).length, 0)
  assert.deepEqual(manager.listDue(fakeNow + 30 * 60_000).map((item) => item.id), [automation.id])
  assert.equal(manager.pause(automation.id)?.nextRunAt, null)
  assert.equal(manager.listDue(fakeNow + 60 * 60_000).length, 0)

  fakeNow += 60 * 60_000
  const resumed = manager.resume(automation.id)
  assert.equal(resumed?.status, 'ACTIVE')
  assert.equal(resumed?.nextRunAt, fakeNow + 30 * 60_000)

  const run = manager.startRun(automation.id, 'schedule', resumed?.nextRunAt ?? null)
  assert.equal(run.status, 'RUNNING')
  fakeNow += 5 * 60_000
  const completed = manager.finishRun(run.id, 'SUCCEEDED')
  assert.equal(completed?.status, 'SUCCEEDED')
  assert.equal(completed?.completedAt, fakeNow)
  assert.equal(manager.listRuns(automation.id).length, 1)
  assert.equal(manager.get(automation.id)?.lastRunAt, fakeNow)
  assert.equal(manager.get(automation.id)?.nextRunAt, fakeNow + 30 * 60_000)

  manager.delete(automation.id)
  assert.equal(manager.get(automation.id), undefined)
  assert.equal(memory.data.automations[0]?.status, 'DELETED')
  assert.equal(memory.data.automations[0]?.nextRunAt, null)
})

test('automation manager executes due runs, records failures, and prevents duplicate running turns', async () => {
  let fakeNow = Date.UTC(2026, 4, 23, 12, 0, 0)
  let idCounter = 0
  const memory = createMemoryStore()
  const manager = createAutomationManager({
    store: memory,
    now: () => fakeNow,
    createId: () => `run-${++idCounter}`
  })
  const automation = manager.upsert({
    kind: 'heartbeat',
    name: 'Due follow-up',
    prompt: 'Check the thread',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'interval', intervalMinutes: 15, rrule: null }
  })

  fakeNow = automation.nextRunAt ?? fakeNow
  const running = manager.startRun(automation.id, 'schedule', automation.nextRunAt ?? null)
  assert.deepEqual(manager.listDue(fakeNow).map((item) => item.id), [])
  const guardedRuns = await manager.runDue({
    execute: () => {
      throw new Error('should not run while another turn is running')
    }
  })
  assert.deepEqual(guardedRuns, [])
  manager.finishRun(running.id, 'SUCCEEDED')

  fakeNow = manager.get(automation.id)?.nextRunAt ?? fakeNow
  const completedRuns = await manager.runDue({
    execute: ({ automation: dueAutomation, scheduledFor }) => {
      assert.equal(dueAutomation.id, automation.id)
      assert.equal(scheduledFor, fakeNow)
    }
  })
  assert.equal(completedRuns.length, 1)
  assert.equal(completedRuns[0]?.status, 'SUCCEEDED')
  assert.equal(manager.get(automation.id)?.lastRunAt, fakeNow)
  assert.equal(manager.get(automation.id)?.nextRunAt, fakeNow + 15 * 60_000)

  fakeNow = manager.get(automation.id)?.nextRunAt ?? fakeNow
  const failedRuns = await manager.runDue({
    execute: () => {
      throw new Error('executor failed')
    }
  })
  assert.equal(failedRuns[0]?.status, 'FAILED')
  assert.equal(failedRuns[0]?.error, 'executor failed')
})

test('automation manager records ineligible due runs as skipped and advances schedule', async () => {
  let fakeNow = Date.UTC(2026, 4, 23, 12, 0, 0)
  let idCounter = 0
  const memory = createMemoryStore()
  const manager = createAutomationManager({
    store: memory,
    now: () => fakeNow,
    createId: () => `skip-${++idCounter}`
  })
  const automation = manager.upsert({
    kind: 'heartbeat',
    name: 'Waiting follow-up',
    prompt: 'Check the thread',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'interval', intervalMinutes: 10, rrule: null }
  })

  fakeNow = automation.nextRunAt ?? fakeNow
  const runs = await manager.runDue({
    isEligible: () => ({ isEligible: false, reason: 'waiting_on_approval' }),
    execute: () => {
      throw new Error('ineligible automation should not execute')
    }
  })

  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.status, 'SKIPPED')
  assert.equal(runs[0]?.error, 'waiting_on_approval')
  assert.equal(manager.get(automation.id)?.lastRunAt, fakeNow)
  assert.equal(manager.get(automation.id)?.nextRunAt, fakeNow + 10 * 60_000)
})

test('automation manager runs active automations manually and skips paused manual runs', async () => {
  let fakeNow = Date.UTC(2026, 4, 23, 12, 0, 0)
  let idCounter = 0
  const memory = createMemoryStore()
  const manager = createAutomationManager({
    store: memory,
    now: () => fakeNow,
    createId: () => `manual-${++idCounter}`
  })
  const active = manager.upsert({
    kind: 'heartbeat',
    name: 'Manual follow-up',
    prompt: 'Check the thread',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'manual', rrule: null }
  })

  let executed = 0
  const completed = await manager.runNow({
    id: active.id,
    execute: ({ automation, trigger, scheduledFor }) => {
      executed += 1
      assert.equal(automation.id, active.id)
      assert.equal(trigger, 'manual')
      assert.equal(scheduledFor, null)
    }
  })
  assert.equal(executed, 1)
  assert.equal(completed.status, 'SUCCEEDED')
  assert.equal(completed.trigger, 'manual')
  assert.equal(manager.get(active.id)?.lastRunAt, fakeNow)

  fakeNow += 60_000
  const paused = manager.upsert({
    kind: 'heartbeat',
    name: 'Paused manual follow-up',
    prompt: 'Check the thread',
    status: 'PAUSED',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'manual', rrule: null }
  })
  const skipped = await manager.runNow({
    id: paused.id,
    execute: () => {
      throw new Error('paused automation should not execute')
    }
  })
  assert.equal(skipped.status, 'SKIPPED')
  assert.equal(skipped.error, 'not_active')
})

test('automation manager manual run now reuses an existing running run', async () => {
  let fakeNow = Date.UTC(2026, 4, 23, 12, 0, 0)
  let idCounter = 0
  const memory = createMemoryStore()
  const manager = createAutomationManager({
    store: memory,
    now: () => fakeNow,
    createId: () => `manual-running-${++idCounter}`
  })
  const automation = manager.upsert({
    kind: 'heartbeat',
    name: 'Manual duplicate follow-up',
    prompt: 'Check the thread',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'manual', rrule: null }
  })
  const running = manager.startRun(automation.id, 'manual', null)
  const returned = await manager.runNow({
    id: automation.id,
    execute: () => {
      throw new Error('duplicate manual run should not execute')
    }
  })
  assert.equal(returned.id, running.id)
  assert.equal(returned.status, 'RUNNING')
  assert.equal(manager.listRuns(automation.id).length, 1)
})

test('automation manager can defer run completion until provider exit', async () => {
  let fakeNow = Date.UTC(2026, 4, 23, 12, 0, 0)
  let idCounter = 0
  const memory = createMemoryStore()
  const manager = createAutomationManager({
    store: memory,
    now: () => fakeNow,
    createId: () => `deferred-run-${++idCounter}`
  })
  const automation = manager.upsert({
    kind: 'heartbeat',
    name: 'Deferred follow-up',
    prompt: 'Check the thread',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'interval', intervalMinutes: 15, rrule: null }
  })

  const running = await manager.runNow({
    id: automation.id,
    execute: () => ({ deferCompletion: true })
  })

  assert.equal(running.status, 'RUNNING')
  assert.equal(manager.listRuns(automation.id)[0]?.status, 'RUNNING')
  assert.equal(manager.listDue(fakeNow + 15 * 60_000).length, 0)

  fakeNow += 5_000
  const completed = manager.finishRun(running.id, 'SUCCEEDED')
  assert.equal(completed?.status, 'SUCCEEDED')
  assert.equal(manager.get(automation.id)?.lastRunAt, fakeNow)
  assert.equal(manager.get(automation.id)?.nextRunAt, fakeNow + 15 * 60_000)
})

test('automation permission snapshots override run request permissions without changing other run fields', () => {
  const request: RunRequest = {
    prompt: 'Check the thread',
    cwd: '/tmp/project',
    model: 'gpt-5.4',
    effort: 'medium',
    providerSessionId: 'provider-session-1',
    executionPolicy: 'default',
    allowedTools: ['Read'],
    disallowedTools: ['Bash'],
    availableTools: ['Read', 'Edit', 'Bash'],
    additionalDirs: ['/tmp/extra'],
    runtime: 'app-server'
  }

  const applied = applyAutomationPermissionSnapshot(request, {
    executionPolicy: 'autoReview',
    allowedTools: ['Read', 'Edit'],
    disallowedTools: ['WebFetch']
  })

  assert.equal(applied.executionPolicy, 'autoReview')
  assert.deepEqual(applied.allowedTools, ['Read', 'Edit'])
  assert.deepEqual(applied.disallowedTools, ['WebFetch'])
  assert.equal(applied.prompt, request.prompt)
  assert.equal(applied.cwd, request.cwd)
  assert.equal(applied.model, request.model)
  assert.deepEqual(applied.availableTools, request.availableTools)
  assert.deepEqual(applyAutomationPermissionSnapshot(request, null), request)
})
