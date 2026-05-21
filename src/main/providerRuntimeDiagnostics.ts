import type { ProviderRuntimeDebugEvent, ProviderRuntimeKind } from '../types'

const DEFAULT_RUNTIME_EVENT_LIMIT = 200

export interface ProviderRuntimeDebugEventInput {
  providerId: string
  runtime: ProviderRuntimeKind
  sessionId?: string
  hostId?: string
  method?: string
  severity?: ProviderRuntimeDebugEvent['severity']
  noisy?: boolean
  message: string
  code?: string
}

export class ProviderRuntimeDebugRing {
  private readonly events: ProviderRuntimeDebugEvent[] = []
  private sequence = 0

  constructor(private readonly limit = DEFAULT_RUNTIME_EVENT_LIMIT) {}

  record(input: ProviderRuntimeDebugEventInput): ProviderRuntimeDebugEvent {
    const event: ProviderRuntimeDebugEvent = {
      id: `runtime-${++this.sequence}`,
      timestamp: Date.now(),
      providerId: input.providerId,
      runtime: input.runtime,
      sessionId: input.sessionId,
      hostId: input.hostId,
      method: input.method,
      severity: input.severity ?? 'info',
      noisy: input.noisy ?? false,
      message: input.message,
      code: input.code
    }
    this.events.push(event)
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit)
    return event
  }

  list(options: {
    providerId?: string
    sessionId?: string
    includeNoisy?: boolean
    limit?: number
  } = {}): ProviderRuntimeDebugEvent[] {
    const filtered = this.events.filter((event) => {
      if (options.providerId && event.providerId !== options.providerId) return false
      if (options.sessionId && event.sessionId !== options.sessionId) return false
      if (!options.includeNoisy && event.noisy) return false
      return true
    })
    return filtered.slice(-(options.limit ?? DEFAULT_RUNTIME_EVENT_LIMIT))
  }

  clear(): void {
    this.events.length = 0
  }
}

export const providerRuntimeDebugRing = new ProviderRuntimeDebugRing()

export function recordProviderRuntimeDebugEvent(input: ProviderRuntimeDebugEventInput): ProviderRuntimeDebugEvent {
  return providerRuntimeDebugRing.record(input)
}

export function listProviderRuntimeDebugEvents(options?: Parameters<ProviderRuntimeDebugRing['list']>[0]): ProviderRuntimeDebugEvent[] {
  return providerRuntimeDebugRing.list(options)
}

export function clearProviderRuntimeDebugEvents(): void {
  providerRuntimeDebugRing.clear()
}
