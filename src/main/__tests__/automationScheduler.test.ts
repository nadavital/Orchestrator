import test from 'node:test'
import assert from 'node:assert/strict'
import type { AutomationRun } from '../../types'
import type { RunDueOptions } from '../automations'
import { createAutomationScheduler } from '../automationScheduler'
import { automationEligibilityForSession } from '../automationEligibility'

test('automation scheduler starts once, ticks immediately, and stops its interval', async () => {
  const intervalHandlers: Array<() => void> = []
  let clearedHandle: unknown = null
  let runDueCalls = 0
  const manager = {
    async runDue(options: RunDueOptions): Promise<AutomationRun[]> {
      runDueCalls += 1
      assert.equal(options.at, 1234)
      return []
    }
  }
  const scheduler = createAutomationScheduler({
    manager,
    now: () => 1234,
    setIntervalImpl: (handler, intervalMs) => {
      assert.equal(intervalMs, 60_000)
      intervalHandlers.push(handler)
      return 'interval-handle'
    },
    clearIntervalImpl: (handle) => {
      clearedHandle = handle
    },
    isEligible: () => ({ isEligible: true }),
    execute: () => {}
  })

  scheduler.start()
  scheduler.start()
  assert.equal(scheduler.isRunning(), true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(runDueCalls, 1)
  await scheduler.tick()
  assert.equal(runDueCalls, 2)
  assert.equal(intervalHandlers.length, 1)
  intervalHandlers[0]?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(runDueCalls, 3)

  scheduler.stop()
  assert.equal(scheduler.isRunning(), false)
  assert.equal(clearedHandle, 'interval-handle')
})

test('automation scheduler prevents overlapping ticks', async () => {
  const deferred: { resolve?: (runs: AutomationRun[]) => void } = {}
  let runDueCalls = 0
  const manager = {
    runDue(): Promise<AutomationRun[]> {
      runDueCalls += 1
      return new Promise<AutomationRun[]>((resolve) => {
        deferred.resolve = resolve
      })
    }
  }
  const scheduler = createAutomationScheduler({
    manager,
    setIntervalImpl: () => 'interval-handle',
    clearIntervalImpl: () => {},
    isEligible: () => ({ isEligible: true }),
    execute: () => {}
  })

  const firstTick = scheduler.tick()
  assert.equal(scheduler.isTicking(), true)
  const secondTick = await scheduler.tick()
  assert.deepEqual(secondTick, [])
  assert.equal(runDueCalls, 1)

  assert.ok(deferred.resolve)
  deferred.resolve([])
  await firstTick
  assert.equal(scheduler.isTicking(), false)
})

test('automation eligibility maps current session state into scheduler skip reasons', () => {
  const baseAutomation = {
    id: 'auto-1',
    kind: 'heartbeat',
    name: 'Follow-up',
    prompt: 'Check in',
    status: 'ACTIVE',
    target: { type: 'session', sessionId: 'session-1' },
    schedule: { mode: 'manual', rrule: null },
    createdAt: 1,
    updatedAt: 1
  } as const

  assert.deepEqual(automationEligibilityForSession(baseAutomation, () => undefined), {
    isEligible: false,
    reason: 'missing_session'
  })
  assert.deepEqual(automationEligibilityForSession(baseAutomation, () => ({ status: 'running' })), {
    isEligible: false,
    reason: 'turn_in_progress'
  })
  assert.deepEqual(automationEligibilityForSession(baseAutomation, () => ({ status: 'waiting_for_user' })), {
    isEligible: false,
    reason: 'waiting_on_user_input'
  })
  assert.deepEqual(automationEligibilityForSession(baseAutomation, () => ({ status: 'waiting_for_permission' })), {
    isEligible: false,
    reason: 'waiting_on_approval'
  })
  assert.deepEqual(automationEligibilityForSession(baseAutomation, () => ({ status: 'idle' })), {
    isEligible: true
  })
})
