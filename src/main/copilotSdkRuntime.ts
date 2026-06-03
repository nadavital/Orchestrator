import { v4 as uuidv4 } from 'uuid'
import type { AgentNode, RunEvent, RunRequest, Session, UsageSummary } from '../types'
import type { ProviderAdapter } from './providers'
import { providerSdkSpawnEnv, resolveProviderBinary, stringifyContent } from './providers'
import { recordProviderRuntimeDebugEvent, updateProviderRuntimeConnection } from './providerRuntimeDiagnostics'

type CopilotSdk = typeof import('@github/copilot-sdk')
type CopilotClient = import('@github/copilot-sdk').CopilotClient
type CopilotSession = import('@github/copilot-sdk').CopilotSession
type SessionEvent = import('@github/copilot-sdk').SessionEvent
type SessionConfig = import('@github/copilot-sdk').SessionConfig
type ResumeSessionConfig = import('@github/copilot-sdk').ResumeSessionConfig
type MessageOptions = import('@github/copilot-sdk').MessageOptions
type PermissionRequest = import('@github/copilot-sdk').PermissionRequest

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>

export interface StartCopilotSdkRunOptions {
  sessionId: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  mode: 'start' | 'resume'
  onRawData: (data: string) => void
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export interface CopilotSdkRunStartResult {
  ok: boolean
  message?: string
}

interface ActiveCopilotSdkRun {
  client?: CopilotClient
  session?: CopilotSession
  streamedMessageIds: Set<string>
  pendingUsage: { current?: UsageSummary }
  stopped: boolean
  completed: boolean
  exited?: boolean
  sessionId: string
  providerId: string
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export class CopilotSdkRuntimeManager {
  private readonly activeRuns = new Map<string, ActiveCopilotSdkRun>()

  has(sessionId: string): boolean {
    return this.activeRuns.has(sessionId)
  }

  start(options: StartCopilotSdkRunOptions): CopilotSdkRunStartResult {
    if (this.activeRuns.has(options.sessionId)) {
      return { ok: false, message: 'Copilot SDK runtime already has an active run for this session.' }
    }

    this.activeRuns.set(options.sessionId, {
      streamedMessageIds: new Set(),
      pendingUsage: {},
      stopped: false,
      completed: false,
      sessionId: options.sessionId,
      providerId: options.provider.id,
      onParsedEvents: options.onParsedEvents,
      onExit: options.onExit
    })

    recordProviderRuntimeDebugEvent({
      providerId: options.provider.id,
      runtime: 'sdk',
      sessionId: options.sessionId,
      message: 'Starting Copilot SDK runtime.'
    })
    updateProviderRuntimeConnection({
      providerId: options.provider.id,
      runtime: 'sdk',
      sessionId: options.sessionId,
      status: 'starting',
      message: 'Starting Copilot SDK runtime.'
    })

    void this.run(options)
    return { ok: true }
  }

  stop(sessionId: string): boolean {
    const active = this.activeRuns.get(sessionId)
    if (!active) return false
    active.stopped = true
    this.activeRuns.delete(sessionId)
    void active.session?.abort().catch(() => {})
    void active.session?.disconnect().catch(() => {})
    void active.client?.stop().catch(() => {})
    recordProviderRuntimeDebugEvent({
      providerId: 'copilot',
      runtime: 'sdk',
      sessionId,
      severity: 'debug',
      message: 'Stopped Copilot SDK runtime.'
    })
    updateProviderRuntimeConnection({
      providerId: 'copilot',
      runtime: 'sdk',
      sessionId,
      status: 'stopped',
      message: 'Stopped Copilot SDK runtime.'
    })
    return true
  }

  private async run(options: StartCopilotSdkRunOptions): Promise<void> {
    const active = this.activeRuns.get(options.sessionId)
    if (!active) return

    try {
      const sdk = await importCopilotSdk()
      const workDir = options.session.workDir || options.request.cwd
      const binary = resolveProviderBinary(options.provider)
      const client = new sdk.CopilotClient({
        workingDirectory: workDir,
        env: providerSdkSpawnEnv('copilot', binary),
        logLevel: 'error'
      })
      active.client = client
      await client.start()
      if (active.stopped) return

      const session = options.request.providerSessionId
        ? await client.resumeSession(options.request.providerSessionId, copilotSdkResumeConfig(sdk, options.request, options.session))
        : await client.createSession(copilotSdkSessionConfig(sdk, options.request, options.session))
      active.session = session
      if (active.stopped) return

      options.onParsedEvents([{ type: 'session.started', providerSessionId: session.sessionId }])
      const unsubscribe = session.on((event) => {
        if (this.activeRuns.get(options.sessionId) !== active || active.stopped) return
        const raw = `${JSON.stringify(event)}\n`
        options.onRawData(raw)
        const events = normalizeCopilotSdkEvent(event, session.sessionId, {
          streamedMessageIds: active.streamedMessageIds,
          pendingUsage: active.pendingUsage
        })
        if (events.some((item) => item.type === 'run.completed' || item.type === 'run.failed')) active.completed = true
        options.onParsedEvents(events)
      })

      updateProviderRuntimeConnection({
        providerId: options.provider.id,
        runtime: 'sdk',
        sessionId: options.sessionId,
        hostId: '@github/copilot-sdk',
        status: 'connected',
        message: 'Started Copilot SDK runtime.'
      })

      const result = await session.sendAndWait(copilotSdkMessageOptions(options.request), 120_000)
      unsubscribe()
      if (this.activeRuns.get(options.sessionId) !== active || active.stopped) return
      if (!active.completed) {
        options.onParsedEvents([{ type: 'run.completed', content: stringValue(asRecord(result)?.data && asRecord(asRecord(result)?.data)?.content) }])
        active.completed = true
      }
    } catch (error) {
      if (!active.stopped) {
        const message = error instanceof Error ? error.message : String(error)
        options.onParsedEvents([{ type: 'run.failed', content: message }])
        recordProviderRuntimeDebugEvent({
          providerId: options.provider.id,
          runtime: 'sdk',
          sessionId: options.sessionId,
          severity: 'error',
          code: 'sdk-run-failed',
          message
        })
      }
    } finally {
      if (this.activeRuns.get(options.sessionId) === active) this.activeRuns.delete(options.sessionId)
      try { await active.session?.disconnect() } catch { /* ignore disconnect races */ }
      try { await active.client?.stop() } catch { /* ignore stop races */ }
      if (!active.exited) {
        updateProviderRuntimeConnection({
          providerId: options.provider.id,
          runtime: 'sdk',
          sessionId: options.sessionId,
          status: active.stopped ? 'stopped' : 'disconnected',
          message: active.stopped ? 'Copilot SDK runtime stopped.' : 'Copilot SDK runtime exited.'
        })
        active.exited = true
        options.onExit()
      }
    }
  }
}

export async function importCopilotSdk(): Promise<CopilotSdk> {
  return await importEsm('@github/copilot-sdk') as CopilotSdk
}

export function copilotSdkSessionConfig(sdk: CopilotSdk, request: RunRequest, session: Session): SessionConfig {
  return copilotSdkBaseConfig(sdk, request, session)
}

export function copilotSdkResumeConfig(sdk: CopilotSdk, request: RunRequest, session: Session): ResumeSessionConfig {
  return {
    ...copilotSdkBaseConfig(sdk, request, session),
    continuePendingWork: true
  }
}

function copilotSdkBaseConfig(sdk: CopilotSdk, request: RunRequest, session: Session): SessionConfig {
  const config: SessionConfig = {
    clientName: 'Orchestrator',
    model: request.model,
    reasoningEffort: copilotSdkReasoningEffort(request.effort),
    workingDirectory: session.workDir || request.cwd,
    streaming: true,
    includeSubAgentStreamingEvents: true,
    enableConfigDiscovery: true,
    enableHostGitOperations: true,
    enableSkills: true,
    enableSessionStore: true
  }

  if (request.executionPolicy === 'yolo' || request.executionPolicy === 'bypassPermissions') {
    config.onPermissionRequest = sdk.approveAll
  }
  if (request.allowedTools?.length) config.availableTools = request.allowedTools
  return config
}

export function copilotSdkMessageOptions(request: RunRequest): MessageOptions {
  return {
    prompt: request.prompt,
    attachments: (request.attachments ?? []).flatMap((attachment) => {
      if (attachment.kind !== 'local_file') return []
      return [{ type: 'file' as const, path: attachment.path, displayName: attachment.name }]
    })
  }
}

export function normalizeCopilotSdkEvent(
  event: SessionEvent,
  providerSessionId?: string,
  options: { streamedMessageIds?: Set<string>; pendingUsage?: { current?: UsageSummary } } = {}
): RunEvent[] {
  const events: RunEvent[] = []
  const data = asRecord(event.data)
  const eventId = stringValue(event.id) ?? uuidv4()
  const sessionId = providerSessionId ?? stringValue(data?.sessionId, data?.session_id) ?? 'copilot-sdk'

  if (event.type === 'session.start' || event.type === 'session.resume') {
    if (sessionId) events.push({ type: 'session.started', providerSessionId: sessionId })
    const producer = stringValue(data?.producer, data?.copilotVersion)
    if (producer) events.push({ type: 'assistant.status', content: `Copilot SDK session ${event.type === 'session.resume' ? 'resumed' : 'started'}: ${producer}` })
  } else if (event.type === 'session.error') {
    events.push({ type: 'run.failed', content: stringValue(data?.message) ?? 'Copilot SDK session error.' })
  } else if (event.type === 'session.idle') {
    events.push({ type: 'run.completed', usage: options.pendingUsage?.current })
    if (options.pendingUsage) options.pendingUsage.current = undefined
  } else if (event.type === 'session.task_complete') {
    const content = stringValue(data?.message, data?.summary, data?.description)
    if (content) events.push({ type: 'assistant.status', content })
  } else if (event.type === 'assistant.message_delta') {
    const content = stringValue(data?.deltaContent)
    const streamId = stringValue(data?.messageId) ?? eventId
    options.streamedMessageIds?.add(streamId)
    if (content && event.agentId) events.push({ type: 'agent.text.delta', agentId: event.agentId, streamId, content })
    else if (content) events.push({ type: 'assistant.text.delta', streamId, content: sanitizeCopilotAssistantText(content, 'delta') })
  } else if (event.type === 'assistant.message') {
    const messageId = stringValue(data?.messageId)
    const content = sanitizeCopilotAssistantText(stringValue(data?.content) ?? '')
    if (event.agentId && messageId && options.streamedMessageIds?.has(messageId)) {
      events.push({ type: 'agent.text.completed', agentId: event.agentId, streamId: messageId })
      options.streamedMessageIds.delete(messageId)
    } else if (messageId && options.streamedMessageIds?.has(messageId)) {
      events.push({ type: 'assistant.text.completed', streamId: messageId, content })
      options.streamedMessageIds.delete(messageId)
    } else if (content) {
      events.push({ type: 'assistant.text', content })
    }
    const toolRequests = Array.isArray(data?.toolRequests) ? data.toolRequests : []
    for (const req of toolRequests) {
      const rec = asRecord(req)
      if (!rec) continue
      events.push({
        type: 'tool.started',
        id: stringValue(rec.toolCallId) ?? uuidv4(),
        toolName: stringValue(rec.name, rec.mcpToolName) ?? 'copilot-tool',
        toolInput: asRecord(rec.arguments) ?? {}
      })
    }
  } else if (event.type === 'assistant.reasoning' || event.type === 'assistant.reasoning_delta') {
    const content = stringValue(data?.content, data?.deltaContent)
    if (content) events.push({ type: 'assistant.status', content })
  } else if (event.type === 'assistant.usage') {
    const usage = copilotUsageSummary(data)
    if (usage && options.pendingUsage) options.pendingUsage.current = usage
  } else if (event.type === 'tool.execution_start') {
    events.push({
      type: 'tool.started',
      id: stringValue(data?.toolCallId) ?? eventId,
      toolName: stringValue(data?.toolName, data?.mcpToolName) ?? 'copilot-tool',
      toolInput: asRecord(data?.arguments) ?? {}
    })
  } else if (event.type === 'tool.execution_complete') {
    events.push({
      type: 'tool.completed',
      id: eventId,
      toolUseId: stringValue(data?.toolCallId) ?? eventId,
      content: stringifyContent(asRecord(data?.result)?.uiContent ?? asRecord(data?.result)?.content ?? data?.error ?? data?.result ?? ''),
      isError: data?.success === false || Boolean(data?.error)
    })
  } else if (event.type === 'tool.execution_progress') {
    const content = stringValue(data?.progressMessage)
    if (content) events.push({ type: 'assistant.status', content })
  } else if (event.type === 'permission.requested') {
    const permission = copilotPermissionDenial(data)
    if (permission) events.push({ type: 'permission.requested', denials: [permission], content: copilotPermissionContent(data) })
  } else if (event.type === 'user_input.requested') {
    const question = stringValue(data?.question)
    if (question) {
      events.push({
        type: 'user_input.requested',
        content: question,
        questions: [{
          id: stringValue(data?.requestId),
          question,
          options: arrayValue(data?.choices).map((choice) => ({ label: String(choice) })),
          isOther: data?.allowFreeform !== false
        }]
      })
    }
  } else if (event.type === 'elicitation.requested') {
    const message = stringValue(data?.message)
    if (message) events.push({ type: 'user_input.requested', content: message, questions: [{ id: stringValue(data?.requestId), question: message }] })
  } else if (event.type === 'subagent.started') {
    events.push({ type: 'agent.started', agent: copilotAgentNode('running', event, sessionId) })
  } else if (event.type === 'subagent.completed') {
    events.push({ type: 'agent.completed', agent: copilotAgentNode('completed', event, sessionId) })
  } else if (event.type === 'subagent.failed') {
    events.push({ type: 'agent.failed', agent: copilotAgentNode('failed', event, sessionId) })
  } else if (event.type === 'abort') {
    events.push({ type: 'run.failed', content: stringValue(data?.reason) ?? 'Copilot SDK run aborted.' })
  } else if (event.type === 'session.warning' || event.type === 'session.info' || event.type === 'system.notification') {
    const content = stringValue(data?.message, data?.content, data?.title)
    if (content) events.push({ type: 'assistant.status', content })
  }

  return events
}

function sanitizeCopilotAssistantText(content: string, mode: 'final' | 'delta' = 'final'): string {
  if (!content) return content
  let next = content
    .replace(/\bGitHubCopilot\s+CLI\b/g, 'GitHub Copilot')
    .replace(/\bGitHub Copilot\s+CLI\b/g, 'GitHub Copilot')
    .replace(/\bGitHubCopilot\b/g, 'GitHub Copilot')
  if (mode === 'final') {
    next = next
      .replace(/([.!?])(?=[A-Z])/g, '$1 ')
      .replace(/\bHowcan\b/g, 'How can')
  }
  return next
}

function copilotAgentNode(status: AgentNode['status'], event: SessionEvent, sessionId: string): AgentNode {
  const data = asRecord(event.data)
  const agentId = event.agentId ?? stringValue(data?.agentId, data?.toolCallId) ?? event.id
  return {
    id: `copilot-${sessionId}-${agentId}`,
    providerId: 'copilot',
    sessionId,
    providerAgentId: agentId,
    providerItemId: stringValue(data?.toolCallId) ?? event.id,
    providerThreadId: agentId,
    parentThreadId: sessionId,
    providerTurnId: stringValue(data?.turnId, data?.toolCallId),
    source: 'sdk-run',
    name: stringValue(data?.agentDisplayName, data?.agentName) ?? 'Copilot subagent',
    role: stringValue(data?.agentName) ?? 'subagent',
    model: stringValue(data?.model),
    status,
    summary: stringValue(data?.agentDescription, data?.summary, data?.errorMessage)
  }
}

function copilotUsageSummary(data: Record<string, unknown> | null): UsageSummary | undefined {
  if (!data) return undefined
  const inputTokens = numberValue(data.promptTokens, data.inputTokens)
  const outputTokens = numberValue(data.completionTokens, data.outputTokens)
  const cacheReadInputTokens = numberValue(data.cacheReadTokens)
  const totalTokens = numberValue(data.totalTokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0) + (cacheReadInputTokens ?? 0) || undefined)
  const totalCostUsd = numberValue(data.cost)
  const durationMs = numberValue(data.duration)
  if (inputTokens === undefined && outputTokens === undefined && cacheReadInputTokens === undefined && totalTokens === undefined && totalCostUsd === undefined && durationMs === undefined) return undefined
  return { inputTokens, outputTokens, cacheReadInputTokens, totalTokens, totalCostUsd, durationMs }
}

function copilotPermissionDenial(data: Record<string, unknown> | null): { tool_name: string; tool_use_id: string; tool_input: Record<string, unknown> } | null {
  if (!data) return null
  const request = asRecord(data.permissionRequest) as PermissionRequest | null
  const prompt = asRecord(data.promptRequest)
  const payload = request ?? prompt
  if (!payload) return null
  const kind = stringValue(payload.kind) ?? 'permission'
  return {
    tool_name: stringValue((payload as Record<string, unknown>).toolName, (payload as Record<string, unknown>).fullCommandText, kind) ?? kind,
    tool_use_id: stringValue(data.requestId, (payload as Record<string, unknown>).toolCallId) ?? uuidv4(),
    tool_input: payload as Record<string, unknown>
  }
}

function copilotPermissionContent(data: Record<string, unknown> | null): string | undefined {
  const prompt = asRecord(data?.promptRequest)
  const request = asRecord(data?.permissionRequest)
  return stringValue(prompt?.intention, request?.intention, prompt?.fullCommandText, request?.fullCommandText, prompt?.toolName, request?.toolName)
}

function copilotSdkReasoningEffort(effort: string | undefined): SessionConfig['reasoningEffort'] {
  if (effort === 'low' || effort === 'medium' || effort === 'high') return effort
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
