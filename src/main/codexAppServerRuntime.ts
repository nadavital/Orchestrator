import { spawn as childSpawn } from 'child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process'
import type { Attachment, RunEvent, RunRequest, Session } from '../types'
import { providerSpawnEnv, resolveProviderCommand, type ProviderAdapter } from './providers'

type JsonObject = Record<string, unknown>
type PendingKind = 'permission' | 'user_input' | 'mcp_elicitation'

interface CodexAppServerProcess {
  stdin: {
    write(data: string, callback?: (error?: Error | null) => void): unknown
    end(): unknown
    on?(event: 'error', handler: (error: Error) => void): unknown
  }
  stdout: { on(event: 'data', handler: (chunk: Buffer) => void): unknown }
  stderr: { on(event: 'data', handler: (chunk: Buffer) => void): unknown }
  on(event: 'exit', handler: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  on(event: 'error', handler: (error: Error) => void): unknown
  kill(signal?: NodeJS.Signals | number): unknown
}

export type CodexAppServerSpawn = (
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => CodexAppServerProcess

interface PendingServerRequest {
  id: string | number
  method: string
  params: JsonObject
  kind: PendingKind
}

export interface CodexAppServerRunOptions {
  sessionId: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  mode: 'start' | 'resume'
  onRawData: (data: string) => void
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export interface CodexAppServerRun {
  write(data: string): void
  stop(): void
  interrupt(): boolean
  resolvePermission(allow: boolean, persistGrant: boolean): boolean
  answerUserInput(answer: string): boolean
}

interface PendingClientRequest {
  onResult?: (result: JsonObject) => void
  onError?: (error: unknown) => void
}

class CodexAppServerSession implements CodexAppServerRun {
  private process: CodexAppServerProcess | null = null
  private nextId = 1
  private buffer = ''
  private threadId: string | null = null
  private turnId: string | null = null
  private readonly pendingClientRequests = new Map<string | number, PendingClientRequest>()
  private readonly pendingServerRequests = new Map<string | number, PendingServerRequest>()
  private readonly streamedAgentItems = new Set<string>()
  private stopped = false
  private terminalRunEventSeen = false
  private exitHandled = false
  private transportFailed = false

  constructor(
    private readonly options: CodexAppServerRunOptions,
    private readonly spawnProcess: CodexAppServerSpawn
  ) {}

  start(): { ok: boolean; message?: string } {
    const command = resolveProviderCommand(this.options.provider, {
      binary: this.options.provider.binary,
      args: ['app-server', '--listen', 'stdio://']
    })
    if (!command) {
      return { ok: false, message: 'codex CLI is not available. Check provider settings or install codex.' }
    }

    try {
      this.process = this.spawnProcess(command.binary, command.args, {
        cwd: this.options.session.workDir,
        env: providerSpawnEnv('codex'),
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }

    this.process.stdout.on('data', (chunk: Buffer) => this.handleData(chunk.toString('utf8')))
    this.process.stderr.on('data', (chunk: Buffer) => {
      const data = chunk.toString('utf8')
      this.options.onRawData(data)
    })
    this.process.stdin.on?.('error', (error: Error) => {
      this.failTransport('Codex app-server stdin failed', error)
    })
    this.process.on('error', (error: Error) => {
      this.failTransport('Codex app-server process failed', error)
    })
    this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.handleExit(code, signal)
    })

    this.initialize()
    return { ok: true }
  }

  write(data: string): void {
    if (!this.threadId || !this.turnId) return
    this.sendRequest('turn/steer', {
      threadId: this.threadId,
      expectedTurnId: this.turnId,
      input: textInput(data.trim())
    })
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    try { this.process?.stdin.end() } catch { /* ignore stop races */ }
    try { this.process?.kill('SIGTERM') } catch { /* ignore stop races */ }
    setTimeout(() => {
      try { this.process?.kill('SIGKILL') } catch { /* ignore stop races */ }
    }, 1500)
  }

  interrupt(): boolean {
    if (!this.threadId || !this.turnId) return false
    this.sendRequest('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId
    })
    return true
  }

  resolvePermission(allow: boolean, persistGrant: boolean): boolean {
    const pending = latestPending(this.pendingServerRequests, 'permission')
    if (!pending) return false

    this.pendingServerRequests.delete(pending.id)
    if (pending.method === 'item/commandExecution/requestApproval') {
      this.sendResponse(pending.id, { decision: allow ? (persistGrant ? 'acceptForSession' : 'accept') : 'decline' })
      return true
    }
    if (pending.method === 'item/fileChange/requestApproval') {
      this.sendResponse(pending.id, { decision: allow ? (persistGrant ? 'acceptForSession' : 'accept') : 'decline' })
      return true
    }
    if (pending.method === 'item/permissions/requestApproval') {
      if (!allow) {
        this.sendError(pending.id, -32000, 'Permission request declined by user.')
        return true
      }
      this.sendResponse(pending.id, {
        permissions: pending.params.permissions ?? {},
        scope: persistGrant ? 'session' : 'turn'
      })
      return true
    }
    if (pending.method === 'applyPatchApproval' || pending.method === 'execCommandApproval') {
      this.sendResponse(pending.id, {
        decision: allow ? (persistGrant ? 'approved_for_session' : 'approved') : 'denied'
      })
      return true
    }
    return false
  }

  answerUserInput(answer: string): boolean {
    const pending = latestPending(this.pendingServerRequests, 'user_input') ??
      latestPending(this.pendingServerRequests, 'mcp_elicitation')
    if (!pending) return false

    this.pendingServerRequests.delete(pending.id)
    if (pending.kind === 'mcp_elicitation') {
      this.sendResponse(pending.id, {
        action: 'accept',
        content: answer,
        _meta: null
      })
      return true
    }

    const questions = Array.isArray(pending.params.questions) ? pending.params.questions : []
    const answers: Record<string, { answers: string[] }> = {}
    for (const question of questions) {
      const rec = asRecord(question)
      const id = stringValue(rec?.id) ?? stringValue(rec?.question) ?? 'answer'
      answers[id] = { answers: [answer] }
    }
    if (Object.keys(answers).length === 0) answers.answer = { answers: [answer] }
    this.sendResponse(pending.id, { answers })
    return true
  }

  private initialize(): void {
    this.sendRequest('initialize', {
      clientInfo: {
        name: 'orchestrator',
        title: 'Orchestrator',
        version: '1.0.0'
      },
      capabilities: {
        experimentalApi: true
      }
    }, () => {
      this.sendNotification('initialized')
      this.startOrResumeThread()
    }, (error) => {
      if (this.transportFailed) return
      this.options.onParsedEvents([{ type: 'run.failed', content: stringifyContent(error) }])
    })
  }

  private startOrResumeThread(): void {
    const request = this.options.request
    const method = this.options.mode === 'resume' && request.providerSessionId ? 'thread/resume' : 'thread/start'
    const params = method === 'thread/resume'
      ? {
          ...threadConfigFromRequest(request),
          threadId: request.providerSessionId,
          excludeTurns: true
        }
      : {
          ...threadConfigFromRequest(request),
          sessionStartSource: 'startup'
        }

    this.sendRequest(method, params, (result) => {
      const thread = asRecord(result.thread)
      const threadId = stringValue(thread?.id)
      if (!threadId) {
        this.options.onParsedEvents([{ type: 'run.failed', content: 'Codex app-server did not return a thread id.' }])
        return
      }
      this.threadId = threadId
      this.options.onParsedEvents([{ type: 'session.started', providerSessionId: threadId }])
      this.startTurn(threadId)
    }, (error) => {
      if (this.transportFailed) return
      this.options.onParsedEvents([{ type: 'run.failed', content: stringifyContent(error) }])
    })
  }

  private startTurn(threadId: string): void {
    const request = this.options.request
    this.sendRequest('turn/start', {
      threadId,
      input: inputFromRequest(request),
      cwd: request.cwd,
      ...turnConfigFromRequest(request)
    }, (result) => {
      const turn = asRecord(result.turn)
      const turnId = stringValue(turn?.id)
      if (turnId) this.turnId = turnId
    }, (error) => {
      if (this.transportFailed) return
      this.options.onParsedEvents([{ type: 'run.failed', content: stringifyContent(error) }])
    })
  }

  private handleData(data: string): void {
    this.options.onRawData(data)
    this.buffer += data
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) this.handleLine(line.trim())
  }

  private handleLine(line: string): void {
    if (!line) return
    const obj = parseJsonObject(line)
    if (!obj) return

    if ('id' in obj && !('method' in obj)) {
      const id = obj.id as string | number
      const pending = this.pendingClientRequests.get(id)
      if (pending) {
        this.pendingClientRequests.delete(id)
        if ('error' in obj) pending.onError?.(obj.error)
        else pending.onResult?.(asRecord(obj.result) ?? {})
      }
      return
    }

    this.trackServerRequest(obj)
    const parsed = this.options.provider.parseOutputLine(line)
    if (parsed.some((event) => event.type === 'run.completed' || event.type === 'run.failed')) {
      this.terminalRunEventSeen = true
    }
    const filtered = this.filterStreamingDuplicates(obj, parsed)
    this.options.onParsedEvents(filtered)
  }

  private trackServerRequest(obj: JsonObject): void {
    const id = obj.id as string | number | undefined
    const method = stringValue(obj.method)
    if (id == null || !method) return
    const params = asRecord(obj.params) ?? {}
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'item/permissions/requestApproval' ||
      method === 'applyPatchApproval' ||
      method === 'execCommandApproval'
    ) {
      this.pendingServerRequests.set(id, { id, method, params, kind: 'permission' })
    } else if (method === 'item/tool/requestUserInput') {
      this.pendingServerRequests.set(id, { id, method, params, kind: 'user_input' })
    } else if (method === 'mcpServer/elicitation/request') {
      this.pendingServerRequests.set(id, { id, method, params, kind: 'mcp_elicitation' })
    } else if (method === 'item/tool/call') {
      this.sendError(id, -32601, 'Orchestrator does not provide client-side dynamic tools yet.')
    } else if (method === 'account/chatgptAuthTokens/refresh') {
      this.sendError(id, -32601, 'Orchestrator relies on Codex CLI-managed authentication and cannot refresh ChatGPT tokens.')
    }
  }

  private filterStreamingDuplicates(obj: JsonObject, events: RunEvent[]): RunEvent[] {
    const method = stringValue(obj.method)
    const params = asRecord(obj.params) ?? {}
    if (method === 'item/agentMessage/delta') {
      const itemId = stringValue(params.itemId)
      if (itemId) this.streamedAgentItems.add(itemId)
      return events
    }
    if (method !== 'item/completed') return events

    const item = asRecord(params.item)
    const itemId = stringValue(item?.id)
    if (!itemId || !this.streamedAgentItems.has(itemId)) return events
    return events.filter((event) => event.type !== 'assistant.text').concat({
      type: 'assistant.text.completed',
      streamId: itemId
    })
  }

  private sendRequest(
    method: string,
    params?: unknown,
    onResult?: (result: JsonObject) => void,
    onError?: (error: unknown) => void
  ): string {
    const id = `orchestrator-${this.nextId++}`
    this.pendingClientRequests.set(id, { onResult, onError })
    if (!this.send({ method, id, params })) {
      this.pendingClientRequests.delete(id)
      onError?.({ message: 'Codex app-server transport is not available.' })
    }
    return id
  }

  private sendNotification(method: string, params?: unknown): void {
    this.send(params === undefined ? { method } : { method, params })
  }

  private sendResponse(id: string | number, result: unknown): void {
    this.send({ id, result })
  }

  private sendError(id: string | number, code: number, message: string): void {
    this.send({ id, error: { code, message } })
  }

  private send(message: JsonObject): boolean {
    if (this.stopped || !this.process) return false
    try {
      this.process.stdin.write(`${JSON.stringify(message)}\n`, (error?: Error | null) => {
        if (error) this.failTransport('Codex app-server write failed', error)
      })
      return true
    } catch (error) {
      this.failTransport('Codex app-server write failed', error)
      return false
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitHandled) return
    this.exitHandled = true

    if (!this.stopped && !this.terminalRunEventSeen) {
      this.emitTransportFailure(`Codex app-server exited unexpectedly${exitDetail(code, signal)}.`)
    }

    this.stopped = true
    this.rejectPendingClientRequests('Codex app-server exited before responding.')
    this.pendingServerRequests.clear()
    this.options.onExit()
  }

  private failTransport(prefix: string, error: unknown): void {
    if (this.exitHandled || this.stopped) return
    this.exitHandled = true
    const message = `${prefix}: ${errorMessage(error)}`
    this.emitTransportFailure(message)
    this.stopped = true
    this.rejectPendingClientRequests(message)
    this.pendingServerRequests.clear()
    try { this.process?.kill('SIGTERM') } catch { /* ignore transport cleanup races */ }
    this.options.onExit()
  }

  private emitTransportFailure(content: string): void {
    this.transportFailed = true
    this.terminalRunEventSeen = true
    this.options.onParsedEvents([{ type: 'run.failed', content }])
  }

  private rejectPendingClientRequests(message: string): void {
    for (const [, pending] of this.pendingClientRequests) {
      pending.onError?.({ message })
    }
    this.pendingClientRequests.clear()
  }
}

export class CodexAppServerRuntimeManager {
  private readonly runs = new Map<string, CodexAppServerSession>()

  constructor(private readonly spawnProcess: CodexAppServerSpawn = defaultSpawn) {}

  start(options: CodexAppServerRunOptions): { ok: boolean; message?: string } {
    this.stop(options.sessionId)
    const run = new CodexAppServerSession({
      ...options,
      onExit: () => {
        this.runs.delete(options.sessionId)
        options.onExit()
      }
    }, this.spawnProcess)
    const result = run.start()
    if (!result.ok) return result
    this.runs.set(options.sessionId, run)
    return { ok: true }
  }

  has(sessionId: string): boolean {
    return this.runs.has(sessionId)
  }

  write(sessionId: string, data: string): void {
    this.runs.get(sessionId)?.write(data)
  }

  stop(sessionId: string): boolean {
    const run = this.runs.get(sessionId)
    if (!run) return false
    this.runs.delete(sessionId)
    run.stop()
    return true
  }

  interrupt(sessionId: string): boolean {
    return this.runs.get(sessionId)?.interrupt() ?? false
  }

  resolvePermission(sessionId: string, allow: boolean, persistGrant: boolean): boolean {
    return this.runs.get(sessionId)?.resolvePermission(allow, persistGrant) ?? false
  }

  answerUserInput(sessionId: string, answer: string): boolean {
    return this.runs.get(sessionId)?.answerUserInput(answer) ?? false
  }
}

function defaultSpawn(
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
  return childSpawn(binary, args, options)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function exitDetail(code: number | null, signal: NodeJS.Signals | null): string {
  const details = [
    code == null ? null : `code ${code}`,
    signal ? `signal ${signal}` : null
  ].filter(Boolean)
  return details.length > 0 ? ` (${details.join(', ')})` : ''
}

function threadConfigFromRequest(request: RunRequest): JsonObject {
  return {
    model: request.model || 'gpt-5.4',
    cwd: request.cwd,
    approvalPolicy: codexApprovalPolicy(request.executionPolicy),
    approvalsReviewer: request.executionPolicy === 'autoReview' ? 'auto_review' : 'user',
    sandbox: codexSandboxMode(request.executionPolicy),
    config: configFromRequest(request),
    serviceName: 'orchestrator',
    personality: 'friendly'
  }
}

function turnConfigFromRequest(request: RunRequest): JsonObject {
  return {
    model: request.model || 'gpt-5.4',
    effort: codexEffort(request.effort),
    approvalPolicy: codexApprovalPolicy(request.executionPolicy),
    approvalsReviewer: request.executionPolicy === 'autoReview' ? 'auto_review' : 'user'
  }
}

function configFromRequest(request: RunRequest): JsonObject {
  const config: JsonObject = {}
  if (request.effort) config.model_reasoning_effort = codexEffort(request.effort)
  return config
}

function codexApprovalPolicy(policyId: string | undefined): unknown {
  if (policyId === 'never' || policyId === 'yolo') return 'never'
  if (policyId === 'untrusted') return 'untrusted'
  return 'on-request'
}

function codexSandboxMode(policyId: string | undefined): unknown {
  if (policyId === 'fullAccess' || policyId === 'yolo') return 'danger-full-access'
  return 'workspace-write'
}

function codexEffort(effort: string | undefined): string | null {
  if (!effort || effort === 'normal' || effort === 'standard') return null
  return effort
}

function inputFromRequest(request: RunRequest): JsonObject[] {
  const inputs = textInput(request.prompt)
  for (const attachment of request.attachments ?? []) {
    const input = inputFromAttachment(attachment)
    if (input) inputs.push(input)
  }
  return inputs
}

function textInput(text: string): JsonObject[] {
  return [{ type: 'text', text, text_elements: [] }]
}

function inputFromAttachment(attachment: Attachment): JsonObject | null {
  if (attachment.kind !== 'local_file') return null
  if (attachment.mimeType?.startsWith('image/')) return { type: 'localImage', path: attachment.path }
  return { type: 'mention', name: attachment.name, path: attachment.path }
}

function latestPending(
  pending: Map<string | number, PendingServerRequest>,
  kind: PendingKind
): PendingServerRequest | null {
  const matches = Array.from(pending.values()).filter((request) => request.kind === kind)
  return matches[matches.length - 1] ?? null
}

function parseJsonObject(line: string): JsonObject | null {
  try {
    const parsed = JSON.parse(line)
    return asRecord(parsed)
  } catch {
    return null
  }
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
