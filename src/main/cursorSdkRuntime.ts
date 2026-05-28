import { v4 as uuidv4 } from 'uuid'
import type { AgentNode, RunEvent, RunRequest, Session } from '../types'
import type { ProviderAdapter } from './providers'
import { effectiveCursorModel, providerSpawnEnv, stringifyContent } from './providers'
import { recordProviderRuntimeDebugEvent, updateProviderRuntimeConnection } from './providerRuntimeDiagnostics'

type CursorSdk = typeof import('@cursor/sdk')
type SdkAgent = import('@cursor/sdk').SDKAgent
type SdkRun = import('@cursor/sdk').Run
type SdkMessage = import('@cursor/sdk').SDKMessage
type AgentOptions = import('@cursor/sdk').AgentOptions
type ModelSelection = import('@cursor/sdk').ModelSelection
type SendOptions = import('@cursor/sdk').SendOptions
type AgentModeOption = import('@cursor/sdk').AgentModeOption

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>

export interface StartCursorSdkRunOptions {
  sessionId: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  mode: 'start' | 'resume'
  onRawData: (data: string) => void
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export interface CursorSdkRunStartResult {
  ok: boolean
  message?: string
}

export interface RunCursorSdkOneShotOptions {
  sessionId?: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  timeoutMs?: number
}

export interface CursorSdkOneShotResult {
  raw: string
  events: RunEvent[]
}

interface ActiveCursorSdkRun {
  agent?: SdkAgent
  run?: SdkRun
  stopped: boolean
  exited?: boolean
  sessionId: string
  providerId: string
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export class CursorSdkRuntimeManager {
  private static readonly instances = new Set<CursorSdkRuntimeManager>()
  private static listenerInstalled = false
  private static readonly handleGlobalUnhandledRejection = (reason: unknown): void => {
    if (!isCursorSdkUnhandledRejection(reason)) {
      setImmediate(() => { throw reason })
      return
    }
    for (const instance of CursorSdkRuntimeManager.instances) {
      instance.handleCursorSdkUnhandledRejection(reason)
    }
  }

  private readonly activeRuns = new Map<string, ActiveCursorSdkRun>()

  constructor() {
    CursorSdkRuntimeManager.instances.add(this)
    if (!CursorSdkRuntimeManager.listenerInstalled) {
      CursorSdkRuntimeManager.listenerInstalled = true
      process.on('unhandledRejection', CursorSdkRuntimeManager.handleGlobalUnhandledRejection)
    }
  }

  has(sessionId: string): boolean {
    return this.activeRuns.has(sessionId)
  }

  start(options: StartCursorSdkRunOptions): CursorSdkRunStartResult {
    if (this.activeRuns.has(options.sessionId)) {
      return { ok: false, message: 'Cursor SDK runtime already has an active run for this session.' }
    }

    this.activeRuns.set(options.sessionId, {
      stopped: false,
      sessionId: options.sessionId,
      providerId: options.provider.id,
      onParsedEvents: options.onParsedEvents,
      onExit: options.onExit
    })
    recordProviderRuntimeDebugEvent({
      providerId: options.provider.id,
      runtime: 'sdk',
      sessionId: options.sessionId,
      message: 'Starting Cursor SDK runtime.'
    })
    updateProviderRuntimeConnection({
      providerId: options.provider.id,
      runtime: 'sdk',
      sessionId: options.sessionId,
      status: 'starting',
      message: 'Starting Cursor SDK runtime.'
    })

    void this.run(options)
    return { ok: true }
  }

  stop(sessionId: string): boolean {
    const active = this.activeRuns.get(sessionId)
    if (!active) return false
    active.stopped = true
    this.activeRuns.delete(sessionId)
    void active.run?.cancel().catch(() => {})
    try { active.agent?.close() } catch { /* ignore stop races */ }
    recordProviderRuntimeDebugEvent({
      providerId: 'cursor',
      runtime: 'sdk',
      sessionId,
      severity: 'debug',
      message: 'Stopped Cursor SDK runtime.'
    })
    updateProviderRuntimeConnection({
      providerId: 'cursor',
      runtime: 'sdk',
      sessionId,
      status: 'stopped',
      message: 'Stopped Cursor SDK runtime.'
    })
    return true
  }

  private async run(options: StartCursorSdkRunOptions): Promise<void> {
    const active = this.activeRuns.get(options.sessionId)
    if (!active) return

    try {
      const sdk = await importCursorSdk()
      const agentOptions = cursorSdkAgentOptions(options.request, options.session)
      const agent = options.request.providerSessionId
        ? await sdk.Agent.resume(options.request.providerSessionId, agentOptions)
        : await sdk.Agent.create(agentOptions)
      active.agent = agent
      if (active.stopped) return

      options.onParsedEvents([{ type: 'session.started', providerSessionId: agent.agentId }])
      updateProviderRuntimeConnection({
        providerId: options.provider.id,
        runtime: 'sdk',
        sessionId: options.sessionId,
        hostId: '@cursor/sdk',
        status: 'connected',
        message: 'Started Cursor SDK runtime.'
      })

      const run = await agent.send(cursorSdkPromptForRequest(options.request), cursorSdkSendOptions(options.request))
      active.run = run
      if (active.stopped) return

      for await (const message of run.stream()) {
        if (this.activeRuns.get(options.sessionId) !== active || active.stopped) return
        const raw = `${JSON.stringify(message)}\n`
        options.onRawData(raw)
        options.onParsedEvents(normalizeCursorSdkMessage(message))
      }

      if (this.activeRuns.get(options.sessionId) !== active || active.stopped) return
      const result = await run.wait()
      const raw = `${JSON.stringify({ type: 'result', ...result })}\n`
      options.onRawData(raw)
      options.onParsedEvents(normalizeCursorSdkResult(result))
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
      try { active.agent?.close() } catch { /* ignore close races */ }
      if (!active.exited) {
        updateProviderRuntimeConnection({
          providerId: options.provider.id,
          runtime: 'sdk',
          sessionId: options.sessionId,
          status: active.stopped ? 'stopped' : 'disconnected',
          message: active.stopped ? 'Cursor SDK runtime stopped.' : 'Cursor SDK runtime exited.'
        })
        active.exited = true
        options.onExit()
      }
    }
  }

  private handleCursorSdkUnhandledRejection(reason: unknown): void {
    for (const [sessionId, active] of this.activeRuns) {
      active.stopped = true
      this.activeRuns.delete(sessionId)
      active.onParsedEvents([{ type: 'run.failed', content: cursorSdkErrorMessage(reason) }])
      try { active.agent?.close() } catch { /* ignore close races */ }
      updateProviderRuntimeConnection({
        providerId: active.providerId,
        runtime: 'sdk',
        sessionId,
        status: 'failed',
        errorCode: 'sdk-run-failed',
        message: cursorSdkErrorMessage(reason)
      })
      active.exited = true
      active.onExit()
    }
  }
}

export async function runCursorSdkOneShot(options: RunCursorSdkOneShotOptions): Promise<CursorSdkOneShotResult> {
  const sdk = await importCursorSdk()
  const sessionId = options.sessionId ?? `cursor-sdk-one-shot-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const events: RunEvent[] = []
  let raw = ''
  let agent: SdkAgent | undefined
  let run: SdkRun | undefined
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    void run?.cancel().catch(() => {})
  }, options.timeoutMs ?? 90_000)

  try {
    agent = options.request.providerSessionId
      ? await sdk.Agent.resume(options.request.providerSessionId, cursorSdkAgentOptions(options.request, options.session))
      : await sdk.Agent.create(cursorSdkAgentOptions(options.request, options.session))
    events.push({ type: 'session.started', providerSessionId: agent.agentId })
    run = await agent.send(cursorSdkPromptForRequest(options.request), cursorSdkSendOptions(options.request))
    for await (const message of run.stream()) {
      const line = `${JSON.stringify(message)}\n`
      raw += line
      events.push(...normalizeCursorSdkMessage(message))
    }
    const result = await run.wait()
    raw += `${JSON.stringify({ type: 'result', ...result })}\n`
    events.push(...normalizeCursorSdkResult(result))
  } catch (error) {
    events.push({
      type: 'run.failed',
      content: timedOut ? `Cursor SDK run timed out after ${options.timeoutMs ?? 90_000}ms.` : error instanceof Error ? error.message : String(error)
    })
  } finally {
    clearTimeout(timeout)
    try { agent?.close() } catch { /* ignore close races */ }
  }

  void sessionId
  return { raw, events }
}

export async function importCursorSdk(): Promise<CursorSdk> {
  return await importEsm('@cursor/sdk') as CursorSdk
}

export function cursorSdkAgentOptions(request: RunRequest, session: Session): AgentOptions {
  const env = providerSpawnEnv('cursor')
  const apiKey = typeof env.CURSOR_API_KEY === 'string' && env.CURSOR_API_KEY.trim()
    ? env.CURSOR_API_KEY.trim()
    : undefined
  return {
    ...(apiKey ? { apiKey } : {}),
    model: cursorSdkModelSelection(request),
    local: {
      cwd: session.workDir || request.cwd,
      settingSources: ['project', 'user', 'plugins'],
      sandboxOptions: { enabled: request.executionPolicy === 'sandbox' }
    },
    mode: cursorSdkMode(request)
  }
}

export function cursorSdkSendOptions(request: RunRequest): SendOptions {
  return {
    mode: cursorSdkMode(request),
    local: request.executionPolicy === 'yolo' || request.executionPolicy === 'bypassPermissions'
      ? { force: true }
      : undefined
  }
}

export function cursorSdkPromptForRequest(request: Pick<RunRequest, 'prompt' | 'attachments'>): string | import('@cursor/sdk').SDKUserMessage {
  const images = (request.attachments ?? [])
    .flatMap((attachment) => {
      if (attachment.kind !== 'local_file' || !/\.(png|jpe?g|gif|webp)$/i.test(attachment.path)) return []
      return [{ url: `file://${attachment.path}` }]
    })
  if (images.length === 0) return request.prompt
  return { text: request.prompt, images }
}

export function normalizeCursorSdkMessage(message: SdkMessage): RunEvent[] {
  const events: RunEvent[] = []

  if (message.type === 'system') {
    events.push({ type: 'session.started', providerSessionId: message.agent_id })
    if (message.subtype === 'init') {
      const tools = Array.isArray(message.tools) && message.tools.length > 0 ? ` Tools: ${message.tools.join(', ')}` : ''
      events.push({ type: 'assistant.status', content: `Cursor SDK run started.${tools}` })
    }
  }

  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text) {
        events.push({ type: 'assistant.text', content: block.text })
      }
      if (block.type === 'tool_use') {
        const toolInput = asRecord(block.input) ?? { input: block.input }
        events.push({ type: 'tool.started', id: block.id, toolName: block.name, toolInput })
        const agent = cursorSdkAgentFromToolUse(block.id, block.name, toolInput, message.agent_id)
        if (agent) events.push({ type: 'agent.started', agent })
      }
    }
  }

  if (message.type === 'tool_call') {
    const toolInput = asRecord(message.args) ?? (message.args == null ? {} : { input: message.args })
    if (message.status === 'running') {
      events.push({ type: 'tool.started', id: message.call_id, toolName: message.name, toolInput })
      const agent = cursorSdkAgentFromToolUse(message.call_id, message.name, toolInput, message.agent_id)
      if (agent) events.push({ type: 'agent.started', agent })
    } else {
      const isError = message.status === 'error'
      events.push({
        type: 'tool.completed',
        id: uuidv4(),
        toolUseId: message.call_id,
        content: stringifyContent(message.result ?? ''),
        isError
      })
      const agent = cursorSdkAgentFromToolResult(message.call_id, message.name, toolInput, message.result, message.agent_id, isError)
      if (agent) events.push({ type: isError ? 'agent.failed' : 'agent.completed', agent })
    }
  }

  if (message.type === 'thinking' && message.text.trim()) {
    events.push({ type: 'assistant.status', content: message.text })
  }

  if (message.type === 'status') {
    if (message.status === 'RUNNING' && message.message) events.push({ type: 'assistant.status', content: message.message })
    if (message.status === 'ERROR') {
      events.push({ type: 'run.failed', content: cursorSdkStatusFailureMessage(message.message) })
    }
    if (message.status === 'CANCELLED' || message.status === 'EXPIRED') {
      events.push({ type: 'run.failed', content: message.message ?? `Cursor SDK run ${message.status.toLowerCase()}.` })
    }
  }

  if (message.type === 'task' && message.text) {
    const status = cursorSdkAgentStatus(message.status)
    const agent: AgentNode = {
      id: `task-${message.agent_id}-${message.run_id}`,
      providerId: 'cursor',
      sessionId: message.agent_id,
      name: 'Cursor task',
      role: 'task',
      status,
      summary: message.text
    }
    if (status === 'completed') events.push({ type: 'agent.completed', agent })
    else if (status === 'failed') events.push({ type: 'agent.failed', agent })
    else if (status === 'running') events.push({ type: 'agent.updated', agent })
    else events.push({ type: 'agent.started', agent })
  }

  return events
}

export function normalizeCursorSdkResult(result: import('@cursor/sdk').RunResult): RunEvent[] {
  if (result.status === 'finished') {
    return [{ type: 'run.completed', content: result.result, usage: { durationMs: result.durationMs } }]
  }
  return [{ type: 'run.failed', content: cursorSdkStatusFailureMessage(result.result ?? `Cursor SDK run ${result.status}.`), usage: { durationMs: result.durationMs } }]
}

export function cursorSdkModelSelection(request: RunRequest): ModelSelection {
  const model = effectiveCursorModel(request)
  if (!model || model === 'auto') return composer25FastSelection()
  if (model === 'composer-2.5-fast') return composer25FastSelection()
  if (model === 'composer-2.5') {
    return request.useFast === false
      ? { id: 'composer-2.5', params: [{ id: 'fast', value: 'false' }] }
      : composer25FastSelection()
  }
  return { id: model }
}

function composer25FastSelection(): ModelSelection {
  return { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] }
}

function cursorSdkMode(request: Pick<RunRequest, 'executionPolicy'>): AgentModeOption {
  return request.executionPolicy === 'plan' ? 'plan' : 'agent'
}

function cursorSdkAgentFromToolUse(id: string, name: string, input: Record<string, unknown>, sessionId: string): AgentNode | null {
  if (!/^(task|subagent)$/i.test(name)) return null
  return {
    id,
    providerId: 'cursor',
    sessionId,
    name: stringValue(input.subagent_type, input.type, input.name) ?? 'Cursor subagent',
    role: stringValue(input.mode, input.role) ?? 'subagent',
    status: 'running',
    summary: stringValue(input.description, input.prompt)
  }
}

function cursorSdkAgentFromToolResult(
  id: string,
  name: string,
  input: Record<string, unknown>,
  result: unknown,
  sessionId: string,
  isError: boolean
): AgentNode | null {
  const started = cursorSdkAgentFromToolUse(id, name, input, sessionId)
  if (!started) return null
  return {
    ...started,
    status: isError ? 'failed' : 'completed',
    summary: stringifyContent(result ?? started.summary ?? '')
  }
}

function cursorSdkAgentStatus(status: string | undefined): AgentNode['status'] {
  if (!status) return 'running'
  if (/complete|finish|success/i.test(status)) return 'completed'
  if (/fail|error|cancel|expire/i.test(status)) return 'failed'
  return 'running'
}

function cursorSdkStatusFailureMessage(message: string | undefined): string {
  const trimmed = message?.trim()
  if (trimmed && !/^Cursor SDK run error\.?$/i.test(trimmed)) return trimmed
  return 'Cursor SDK local stream failed before any content was emitted. The current SDK local agent path requires HTTP/2; Cursor CLI/IDE HTTP/1.1 fallback settings are not applied to SDK streaming yet.'
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

function isCursorSdkUnhandledRejection(reason: unknown): boolean {
  const message = cursorSdkErrorMessage(reason)
  const stack = reason instanceof Error ? reason.stack ?? '' : ''
  const cause = reason instanceof Error ? reason.cause : undefined
  const causeStack = cause instanceof Error ? cause.stack ?? '' : ''
  return /@cursor\/sdk|cursor sdk|AuthenticationError|unauthenticated|ConnectError/i.test(`${message}\n${stack}\n${causeStack}`)
}

function cursorSdkErrorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    const cause = reason.cause instanceof Error ? ` ${reason.cause.message}` : ''
    return `${reason.message}${cause}`.trim() || reason.name
  }
  return String(reason)
}
