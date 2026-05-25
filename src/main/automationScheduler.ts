import type { Automation, AutomationEligibilityResult, AutomationRun } from '../types'
import type { AutomationExecutionContext, AutomationExecutionResult, RunDueOptions } from './automations'

interface AutomationSchedulerManager {
  runDue(options: RunDueOptions): Promise<AutomationRun[]>
}

interface AutomationSchedulerOptions {
  manager: AutomationSchedulerManager
  intervalMs?: number
  now?: () => number
  setIntervalImpl?: (handler: () => void, intervalMs: number) => unknown
  clearIntervalImpl?: (handle: unknown) => void
  isEligible: (automation: Automation) => AutomationEligibilityResult | Promise<AutomationEligibilityResult>
  execute: (context: AutomationExecutionContext) => Promise<AutomationExecutionResult> | AutomationExecutionResult
}

export function createAutomationScheduler({
  manager,
  intervalMs = 60_000,
  now = () => Date.now(),
  setIntervalImpl = (handler, interval) => setInterval(handler, interval),
  clearIntervalImpl = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  isEligible,
  execute
}: AutomationSchedulerOptions) {
  let intervalHandle: unknown = null
  let activeTick: Promise<AutomationRun[]> | null = null

  async function tick(): Promise<AutomationRun[]> {
    if (activeTick) return []
    activeTick = manager.runDue({
      at: now(),
      isEligible,
      execute
    }).finally(() => {
      activeTick = null
    })
    return activeTick
  }

  return {
    start(): void {
      if (intervalHandle) return
      intervalHandle = setIntervalImpl(() => { void tick() }, intervalMs)
      void tick()
    },

    stop(): void {
      if (!intervalHandle) return
      clearIntervalImpl(intervalHandle)
      intervalHandle = null
    },

    tick,

    isRunning(): boolean {
      return Boolean(intervalHandle)
    },

    isTicking(): boolean {
      return Boolean(activeTick)
    }
  }
}
