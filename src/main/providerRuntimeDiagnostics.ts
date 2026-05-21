import type { ProviderRuntimeConnectionState, ProviderRuntimeDebugEvent, ProviderRuntimeKind } from '../types'

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

export interface ProviderRuntimeConnectionInput {
  providerId: string
  runtime: ProviderRuntimeKind
  sessionId?: string
  hostId?: string
  status: ProviderRuntimeConnectionState['status']
  version?: string
  method?: string
  errorCode?: string
  message?: string
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
const runtimeConnections = new Map<string, ProviderRuntimeConnectionState>()

export function recordProviderRuntimeDebugEvent(input: ProviderRuntimeDebugEventInput): ProviderRuntimeDebugEvent {
  return providerRuntimeDebugRing.record(input)
}

export function listProviderRuntimeDebugEvents(options?: Parameters<ProviderRuntimeDebugRing['list']>[0]): ProviderRuntimeDebugEvent[] {
  return providerRuntimeDebugRing.list(options)
}

export function clearProviderRuntimeDebugEvents(): void {
  providerRuntimeDebugRing.clear()
}

export function updateProviderRuntimeConnection(input: ProviderRuntimeConnectionInput): ProviderRuntimeConnectionState {
  const id = runtimeConnectionId(input)
  const now = Date.now()
  const previous = runtimeConnections.get(id)
  const state: ProviderRuntimeConnectionState = {
    id,
    providerId: input.providerId,
    runtime: input.runtime,
    sessionId: input.sessionId,
    hostId: input.hostId ?? previous?.hostId,
    status: input.status,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    version: input.version ?? previous?.version,
    method: input.method ?? previous?.method,
    errorCode: input.errorCode,
    message: input.message ?? previous?.message
  }
  runtimeConnections.set(id, state)
  return state
}

export function listProviderRuntimeConnections(options: {
  providerId?: string
  sessionId?: string
  limit?: number
} = {}): ProviderRuntimeConnectionState[] {
  const filtered = [...runtimeConnections.values()].filter((state) => {
    if (options.providerId && state.providerId !== options.providerId) return false
    if (options.sessionId && state.sessionId !== options.sessionId) return false
    return true
  })
  return filtered
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(-(options.limit ?? DEFAULT_RUNTIME_EVENT_LIMIT))
}

export function clearProviderRuntimeConnections(): void {
  runtimeConnections.clear()
}

function runtimeConnectionId(input: Pick<ProviderRuntimeConnectionInput, 'providerId' | 'runtime' | 'sessionId' | 'hostId'>): string {
  return [
    input.providerId,
    input.runtime,
    input.sessionId ?? input.hostId ?? 'global'
  ].join(':')
}
