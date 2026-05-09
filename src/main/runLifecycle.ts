import type { ChatMessage, ProviderRuntimeKind, RunEvent, SessionStatus } from '../types'

export interface RunLifecycleSession {
  id: string
  provider?: string
  runtime?: ProviderRuntimeKind
  status: SessionStatus
}

export interface RunLifecycleDecision {
  providerSessionId?: string
  claudeSessionId?: string
  status?: SessionStatus
  shouldKillPty: boolean
  systemMessages: ChatMessage[]
}

export function classifyFailure(content?: string): SessionStatus {
  if (/authentication required|authentication_failed|not logged in|login|api key|apiKeyHelper|unauthorized|keychain|SecItemCopyMatching/i.test(content ?? '')) {
    return 'auth_error'
  }
  if (/model .*unavailable|model unavailable|unknown model|invalid model|no models available/i.test(content ?? '')) {
    return 'model_error'
  }
  return 'provider_error'
}

export function isPausedOrFailed(status: SessionStatus): boolean {
  return [
    'waiting_for_permission',
    'waiting_for_user',
    'reconnecting',
    'auth_error',
    'model_error',
    'provider_error',
    'error'
  ].includes(status)
}

export function decideRunLifecycle(
  session: RunLifecycleSession | undefined,
  events: RunEvent[]
): RunLifecycleDecision {
  const decision: RunLifecycleDecision = {
    shouldKillPty: false,
    systemMessages: []
  }

  const sessionStarted = events.find((event) => event.type === 'session.started')
  if (sessionStarted?.type === 'session.started') {
    decision.providerSessionId = sessionStarted.providerSessionId
    decision.claudeSessionId = sessionStarted.providerSessionId
  }

  const repeatedReconnect = events.find((event) =>
    (event.type === 'connection.reconnecting' || event.type === 'connection.retrying') &&
    typeof event.attempt === 'number' &&
    event.attempt >= 2
  )
  if (session?.provider === 'cursor' && repeatedReconnect) {
    decision.shouldKillPty = true
    decision.status = 'provider_error'
    decision.systemMessages.push({
      id: `provider-reconnect-${Date.now()}`,
      role: 'system',
      type: 'result',
      content: 'Cursor Agent is reconnecting repeatedly. The run was stopped before it could hang. Try Cursor again after the CLI transport recovers.',
      subtype: 'error_during_execution',
      timestamp: Date.now()
    })
    return decision
  }

  if (events.some((event) => event.type === 'permission.requested')) {
    decision.status = 'waiting_for_permission'
    return decision
  }

  if (events.some((event) => event.type === 'user_input.requested')) {
    decision.status = 'waiting_for_user'
    decision.shouldKillPty = session?.runtime !== 'interactive'
    return decision
  }

  if (events.some((event) => event.type === 'connection.reconnecting' || event.type === 'connection.retrying')) {
    decision.status = 'reconnecting'
    return decision
  }

  const failed = [...events].reverse().find((event) => event.type === 'run.failed')
  if (failed?.type === 'run.failed') {
    if (session?.status === 'waiting_for_user') return decision
    decision.shouldKillPty = true
    decision.status = classifyFailure(failed.content)
    return decision
  }

  const completed = [...events].reverse().find((event) => event.type === 'run.completed')
  if (completed?.type === 'run.completed') {
    decision.status = 'idle'
  }

  return decision
}
