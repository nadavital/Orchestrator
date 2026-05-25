import Store from 'electron-store'
import { v4 as uuidv4 } from 'uuid'
import type {
  Automation,
  AutomationEligibilityResult,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationSchedule,
  AutomationUpsertRequest
} from '../types'

interface StoreSchema {
  automations: Automation[]
  automationRuns: AutomationRun[]
}

interface AutomationStore {
  get<Key extends keyof StoreSchema>(key: Key, fallback: StoreSchema[Key]): StoreSchema[Key]
  set<Key extends keyof StoreSchema>(key: Key, value: StoreSchema[Key]): void
}

interface AutomationManagerOptions {
  store: AutomationStore
  now?: () => number
  createId?: () => string
}

export interface AutomationExecutionContext {
  automation: Automation
  run: AutomationRun
  scheduledFor: number | null
  trigger: AutomationRunTrigger
}

export interface RunDueOptions {
  at?: number
  isEligible?: (automation: Automation) => AutomationEligibilityResult | Promise<AutomationEligibilityResult>
  execute: (context: AutomationExecutionContext) => Promise<AutomationExecutionResult> | AutomationExecutionResult
}

export interface RunNowOptions {
  id: string
  isEligible?: (automation: Automation) => AutomationEligibilityResult | Promise<AutomationEligibilityResult>
  execute: (context: AutomationExecutionContext) => Promise<AutomationExecutionResult> | AutomationExecutionResult
}

export type AutomationExecutionResult = void | {
  deferCompletion?: boolean
}

let electronStore: Store<StoreSchema> | null = null

function getStore(): Store<StoreSchema> {
  electronStore ??= new Store<StoreSchema>({
    defaults: { automations: [], automationRuns: [] }
  })
  return electronStore
}

const store: AutomationStore = {
  get(key, fallback) {
    return getStore().get(key, fallback)
  },
  set(key, value) {
    getStore().set(key, value)
  }
}

const defaultSchedule: AutomationSchedule = { mode: 'manual', rrule: null }
const minuteMs = 60_000
const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

function activeAutomations(store: AutomationStore): Automation[] {
  return store.get('automations', []).filter((automation) => automation.status !== 'DELETED')
}

function sanitizeSchedule(schedule?: AutomationSchedule): AutomationSchedule {
  if (!schedule) return defaultSchedule
  if (schedule.mode === 'interval') {
    const intervalMinutes = Math.max(1, Math.round(schedule.intervalMinutes ?? 60))
    return { mode: 'interval', intervalMinutes, rrule: null }
  }
  if (schedule.mode === 'rrule') {
    return { mode: 'rrule', rrule: schedule.rrule?.trim() || null }
  }
  return defaultSchedule
}

function normalizeRequest(
  request: AutomationUpsertRequest,
  now: number,
  existing?: Automation
): Omit<Automation, 'id' | 'createdAt' | 'updatedAt'> {
  const name = request.name.trim()
  if (!name) throw new Error('Automation name is required')
  if (request.target.type !== 'session' || !request.target.sessionId.trim()) {
    throw new Error('Automation session target is required')
  }
  const status = request.status ?? existing?.status ?? 'PAUSED'
  const schedule = sanitizeSchedule(request.schedule ?? existing?.schedule)
  const lastRunAt = existing?.lastRunAt ?? null
  return {
    kind: request.kind ?? existing?.kind ?? 'heartbeat',
    name,
    prompt: request.prompt?.trim() || existing?.prompt || 'Continue this chat and check whether anything needs attention.',
    status,
    target: { type: 'session', sessionId: request.target.sessionId },
    schedule,
    lastRunAt,
    nextRunAt: computeNextRunAt({ schedule, status, now, lastRunAt }),
    permissionSnapshot: request.permissionSnapshot ?? existing?.permissionSnapshot ?? null
  }
}

function parseRruleValue(rrule: string): Record<string, string> {
  const source = rrule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('RRULE:')) ?? rrule.trim()
  const raw = source.startsWith('RRULE:') ? source.slice('RRULE:'.length) : source
  return Object.fromEntries(
    raw
      .split(';')
      .map((part) => part.split('=', 2))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0].length > 0)
      .map(([key, value]) => [key.toUpperCase(), value.toUpperCase()])
  )
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.round(parsed))
}

function parseRruleTime(parts: Record<string, string>, fallback: Date): { hour: number; minute: number } {
  const hour = Number(parts.BYHOUR)
  const minute = Number(parts.BYMINUTE)
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : fallback.getHours(),
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.round(minute))) : fallback.getMinutes()
  }
}

function parseRruleDays(parts: Record<string, string>): Set<number> | null {
  if (!parts.BYDAY) return null
  const values = parts.BYDAY.split(',').map((value) => value.trim())
  const days = values
    .map((value) => weekdays.indexOf(value as (typeof weekdays)[number]))
    .filter((value) => value >= 0)
  return days.length > 0 ? new Set(days) : null
}

function nextIntervalRun(now: number, intervalMinutes: number, lastRunAt?: number | null): number {
  const intervalMs = Math.max(1, Math.round(intervalMinutes)) * minuteMs
  let next = (lastRunAt ?? now) + intervalMs
  if (next <= now) {
    const missedIntervals = Math.floor((now - next) / intervalMs) + 1
    next += missedIntervals * intervalMs
  }
  return next
}

function nextCalendarRun(
  now: number,
  intervalDays: number,
  hour: number,
  minute: number,
  allowedDays: Set<number> | null
): number | null {
  const start = new Date(now)
  for (let offset = 0; offset <= 370; offset += 1) {
    const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, hour, minute, 0, 0)
    if (candidate.getTime() <= now) continue
    if (allowedDays && !allowedDays.has(candidate.getDay())) continue
    if (!allowedDays && offset % intervalDays !== 0) continue
    return candidate.getTime()
  }
  return null
}

function nextRruleRun(rrule: string | null | undefined, now: number, lastRunAt?: number | null): number | null {
  if (!rrule?.trim()) return null
  const parts = parseRruleValue(rrule)
  const interval = parsePositiveInteger(parts.INTERVAL, 1)
  const anchor = new Date(lastRunAt ?? now)
  switch (parts.FREQ) {
    case 'MINUTELY':
      return nextIntervalRun(now, interval, lastRunAt)
    case 'HOURLY':
      return nextIntervalRun(now, interval * 60, lastRunAt)
    case 'DAILY': {
      const { hour, minute } = parseRruleTime(parts, anchor)
      return nextCalendarRun(now, interval, hour, minute, null)
    }
    case 'WEEKLY': {
      const { hour, minute } = parseRruleTime(parts, anchor)
      const days = parseRruleDays(parts) ?? new Set([anchor.getDay()])
      return nextCalendarRun(now, 1, hour, minute, days)
    }
    default:
      return null
  }
}

export function computeNextRunAt({
  schedule,
  status,
  now,
  lastRunAt
}: {
  schedule: AutomationSchedule
  status: Automation['status']
  now: number
  lastRunAt?: number | null
}): number | null {
  if (status !== 'ACTIVE') return null
  if (schedule.mode === 'interval') {
    return nextIntervalRun(now, schedule.intervalMinutes ?? 60, lastRunAt)
  }
  if (schedule.mode === 'rrule') {
    return nextRruleRun(schedule.rrule, now, lastRunAt)
  }
  return null
}

export function createAutomationManager({
  store,
  now = () => Date.now(),
  createId = uuidv4
}: AutomationManagerOptions) {
  const manager = {
    list(): Automation[] {
      return activeAutomations(store)
    },

    listForSession(sessionId: string): Automation[] {
      return activeAutomations(store).filter((automation) => (
        automation.target.type === 'session' &&
        automation.target.sessionId === sessionId
      ))
    },

    get(id: string): Automation | undefined {
      return activeAutomations(store).find((automation) => automation.id === id)
    },

    listRuns(automationId: string): AutomationRun[] {
      return store.get('automationRuns', [])
        .filter((run) => run.automationId === automationId)
        .sort((a, b) => b.startedAt - a.startedAt)
    },

    listDue(at = now()): Automation[] {
      return activeAutomations(store).filter((automation) => (
        automation.status === 'ACTIVE' &&
        typeof automation.nextRunAt === 'number' &&
        automation.nextRunAt <= at &&
        !runningRunForAutomation(store, automation.id)
      ))
    },

    upsert(request: AutomationUpsertRequest): Automation {
      const automations = store.get('automations', [])
      const currentTime = now()
      const existingIndex = request.id
        ? automations.findIndex((automation) => automation.id === request.id)
        : -1
      const existing = existingIndex >= 0 ? automations[existingIndex] : undefined
      const normalized = normalizeRequest(request, currentTime, existing)
      const automation: Automation = existingIndex >= 0 && existing
        ? {
            ...existing,
            ...normalized,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: currentTime
          }
        : {
            ...normalized,
            id: createId(),
            createdAt: currentTime,
            updatedAt: currentTime
          }

      if (existingIndex >= 0) automations[existingIndex] = automation
      else automations.push(automation)
      store.set('automations', automations)
      return automation
    },

    pause(id: string): Automation | undefined {
      return updateAutomation(store, id, now(), (automation, currentTime) => ({
        ...automation,
        status: 'PAUSED',
        nextRunAt: null,
        updatedAt: currentTime
      }))
    },

    resume(id: string): Automation | undefined {
      return updateAutomation(store, id, now(), (automation, currentTime) => ({
        ...automation,
        status: 'ACTIVE',
        nextRunAt: computeNextRunAt({
          schedule: automation.schedule,
          status: 'ACTIVE',
          now: currentTime,
          lastRunAt: automation.lastRunAt
        }),
        updatedAt: currentTime
      }))
    },

    delete(id: string): void {
      updateAutomation(store, id, now(), (automation, currentTime) => ({
        ...automation,
        status: 'DELETED',
        nextRunAt: null,
        updatedAt: currentTime
      }))
    },

    startRun(id: string, trigger: AutomationRunTrigger = 'schedule', scheduledFor: number | null = null): AutomationRun {
      const automation = activeAutomations(store).find((automation) => automation.id === id)
      if (!automation) throw new Error('Automation not found')
      const running = runningRunForAutomation(store, id)
      if (running) return running
      const run: AutomationRun = {
        id: createId(),
        automationId: id,
        status: 'RUNNING',
        trigger,
        scheduledFor,
        startedAt: now(),
        completedAt: null,
        error: null
      }
      const runs = store.get('automationRuns', [])
      store.set('automationRuns', [run, ...runs])
      return run
    },

    finishRun(runId: string, status: Exclude<AutomationRunStatus, 'PENDING' | 'RUNNING'>, error?: string | null): AutomationRun | undefined {
      const runs = store.get('automationRuns', [])
      const index = runs.findIndex((run) => run.id === runId)
      if (index === -1) return undefined
      const completedAt = now()
      const run: AutomationRun = {
        ...runs[index],
        status,
        completedAt,
        error: error ?? null
      }
      runs[index] = run
      store.set('automationRuns', runs)
      updateAutomation(store, run.automationId, completedAt, (automation, currentTime) => ({
        ...automation,
        lastRunAt: currentTime,
        nextRunAt: computeNextRunAt({
          schedule: automation.schedule,
          status: automation.status,
          now: currentTime,
          lastRunAt: currentTime
        }),
        updatedAt: currentTime
      }))
      return run
    },

    async runDue({ at = now(), isEligible, execute }: RunDueOptions): Promise<AutomationRun[]> {
      const due = manager.listDue(at)
      const completedRuns: AutomationRun[] = []
      for (const automation of due) {
        const scheduledFor = automation.nextRunAt ?? null
        const eligibility = await Promise.resolve(isEligible?.(automation) ?? { isEligible: true })
        const run = manager.startRun(automation.id, 'schedule', scheduledFor)
        if (!eligibility.isEligible) {
          const skipped = manager.finishRun(run.id, 'SKIPPED', eligibility.reason ?? 'not_eligible')
          if (skipped) completedRuns.push(skipped)
          continue
        }
        try {
          const result = await execute({ automation, run, scheduledFor, trigger: 'schedule' })
          if (result?.deferCompletion) {
            completedRuns.push(run)
            continue
          }
          const completed = manager.finishRun(run.id, 'SUCCEEDED')
          if (completed) completedRuns.push(completed)
        } catch (error) {
          const completed = manager.finishRun(run.id, 'FAILED', error instanceof Error ? error.message : String(error))
          if (completed) completedRuns.push(completed)
        }
      }
      return completedRuns
    },

    async runNow({ id, isEligible, execute }: RunNowOptions): Promise<AutomationRun> {
      const automation = manager.get(id)
      if (!automation) throw new Error('Automation not found')
      const running = runningRunForAutomation(store, id)
      if (running) return running
      const eligibility = automation.status === 'ACTIVE'
        ? await Promise.resolve(isEligible?.(automation) ?? { isEligible: true })
        : { isEligible: false, reason: 'not_active' }
      const run = manager.startRun(id, 'manual', null)
      if (!eligibility.isEligible) {
        return manager.finishRun(run.id, 'SKIPPED', eligibility.reason ?? 'not_eligible') ?? run
      }
      try {
        const result = await execute({ automation, run, scheduledFor: null, trigger: 'manual' })
        if (result?.deferCompletion) return run
        return manager.finishRun(run.id, 'SUCCEEDED') ?? run
      } catch (error) {
        return manager.finishRun(run.id, 'FAILED', error instanceof Error ? error.message : String(error)) ?? run
      }
    }
  }

  return manager
}

function runningRunForAutomation(store: AutomationStore, automationId: string): AutomationRun | undefined {
  return store.get('automationRuns', []).find((run) => (
    run.automationId === automationId &&
    run.status === 'RUNNING'
  ))
}

function updateAutomation(
  store: AutomationStore,
  id: string,
  currentTime: number,
  update: (automation: Automation, currentTime: number) => Automation
): Automation | undefined {
  const automations = store.get('automations', [])
  const index = automations.findIndex((automation) => automation.id === id)
  if (index === -1) return undefined
  const next = update(automations[index], currentTime)
  automations[index] = next
  store.set('automations', automations)
  return next
}

export const automationManager = createAutomationManager({ store })
