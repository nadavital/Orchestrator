import { spawn as childSpawn } from 'child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process'
import type { Attachment, RunEvent, RunRequest, Session } from '../types'
import { codexRuntimePolicyConfig, providerSpawnEnv, resolveProviderCommand, type ProviderAdapter } from './providers'
import { recordProviderRuntimeDebugEvent, updateProviderRuntimeConnection } from './providerRuntimeDiagnostics'

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
  clientDynamicToolBridge?: CodexClientDynamicToolBridge
  onRawData: (data: string) => void
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export interface CodexClientDynamicToolCall {
  sessionId: string
  threadId: string | null
  turnId: string | null
  namespace: string | null
  tool: string
  arguments: JsonObject
}

export interface CodexClientDynamicToolResponse {
  success: boolean
  contentItems: Array<{ type: 'inputText'; text: string }>
}

export interface CodexClientDynamicToolBridge {
  dynamicTools: JsonObject[]
  isSupported(namespace: string | null, tool: string): boolean
  call(call: CodexClientDynamicToolCall): Promise<CodexClientDynamicToolResponse>
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
      this.record('codex CLI is not available.', {
        severity: 'warning',
        code: 'missing-binary'
      })
      this.updateConnection('failed', {
        errorCode: 'missing-binary',
        message: 'codex CLI is not available.'
      })
      return { ok: false, message: 'codex CLI is not available. Check provider settings or install codex.' }
    }

    try {
      this.process = this.spawnProcess(command.binary, command.args, {
        cwd: this.options.session.workDir,
        env: providerSpawnEnv('codex'),
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      this.record(error instanceof Error ? error.message : String(error), {
        severity: 'error',
        code: 'spawn-failed'
      })
      this.updateConnection('failed', {
        errorCode: 'spawn-failed',
        message: error instanceof Error ? error.message : String(error)
      })
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }

    this.record('Codex app-server process started.', {
      hostId: command.binary
    })
    this.updateConnection('starting', {
      hostId: command.binary,
      message: 'Codex app-server process started.'
    })
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
    }, (result) => {
      this.updateConnection('connected', {
        method: 'initialize',
        version: stringValue(result.protocolVersion, result.serverInfo),
        message: 'Codex app-server initialized.'
      })
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
    const threadConfig = threadConfigFromRequest(request)
    if (method === 'thread/start' && this.options.clientDynamicToolBridge?.dynamicTools.length) {
      threadConfig.dynamicTools = this.options.clientDynamicToolBridge.dynamicTools
    }
    const params = method === 'thread/resume'
      ? {
          ...threadConfig,
          threadId: request.providerSessionId,
          excludeTurns: true
        }
      : {
          ...threadConfig,
          sessionStartSource: 'startup'
        }

    this.record(`Codex app-server ${method} request: model=${String(threadConfig.model ?? '')}, effort=${String(configFromRequest(request).model_reasoning_effort ?? '')}.`, {
      method,
      hostId: request.providerSessionId ?? undefined,
      severity: 'debug',
      noisy: true
    })
    this.sendRequest(method, params, (result) => {
      const thread = asRecord(result.thread)
      const threadId = stringValue(thread?.id)
      if (!threadId) {
        this.record('Codex app-server did not return a thread id.', {
          method,
          severity: 'error',
          code: 'missing-thread-id'
        })
        this.options.onParsedEvents([{ type: 'run.failed', content: 'Codex app-server did not return a thread id.' }])
        return
      }
      this.threadId = threadId
      this.updateConnection('connected', {
        method,
        hostId: threadId,
        message: `Codex app-server ${this.options.mode === 'resume' ? 'resumed' : 'started'} thread.`
      })
      this.record(`Codex app-server ${this.options.mode === 'resume' ? 'resumed' : 'started'} thread.`, {
        method,
        hostId: threadId
      })
      this.options.onParsedEvents([{ type: 'session.started', providerSessionId: threadId }])
      this.startTurn(threadId)
    }, (error) => {
      if (this.transportFailed) return
      this.options.onParsedEvents([{ type: 'run.failed', content: stringifyContent(error) }])
    })
  }

  private startTurn(threadId: string): void {
    const request = this.options.request
    const turnConfig = turnConfigFromRequest(request)
    this.record(`Codex app-server turn/start request: model=${String(turnConfig.model ?? '')}, effort=${String(turnConfig.effort ?? '')}.`, {
      method: 'turn/start',
      hostId: threadId,
      severity: 'debug',
      noisy: true
    })
    this.sendRequest('turn/start', {
      threadId,
      input: inputFromRequest(request),
      cwd: request.cwd,
      ...turnConfig
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
      this.record('Codex app-server requested permission.', { method, severity: 'info' })
    } else if (method === 'item/tool/requestUserInput') {
      this.pendingServerRequests.set(id, { id, method, params, kind: 'user_input' })
      this.record('Codex app-server requested user input.', { method, severity: 'info' })
    } else if (method === 'mcpServer/elicitation/request') {
      this.pendingServerRequests.set(id, { id, method, params, kind: 'mcp_elicitation' })
      this.record('Codex app-server requested MCP elicitation.', { method, severity: 'info' })
    } else if (method === 'item/tool/call') {
      const namespace = stringValue(params.namespace)
      const tool = stringValue(params.tool) ?? 'unknown'
      const toolName = namespace ? `${namespace}.${tool}` : tool
      if (this.options.clientDynamicToolBridge?.isSupported(namespace ?? null, tool)) {
        void this.answerClientDynamicTool(id, params, namespace ?? null, tool)
        return
      }
      this.record('Codex app-server requested an unsupported client tool.', {
        method,
        severity: 'warning',
        code: 'unsupported-client-tool'
      })
      const message = `Client tool unavailable: ${toolName}. Orchestrator does not provide client-side dynamic tools for this runtime yet.`
      this.options.onParsedEvents([{ type: 'assistant.status', content: message }])
      this.sendError(id, -32601, message)
    } else if (method === 'account/chatgptAuthTokens/refresh') {
      this.record('Codex app-server requested unsupported auth token refresh.', {
        method,
        severity: 'warning',
        code: 'unsupported-auth-refresh'
      })
      this.sendError(id, -32601, 'Orchestrator relies on Codex CLI-managed authentication and cannot refresh ChatGPT tokens.')
    } else {
      this.record('Codex app-server notification/request received.', {
        method,
        severity: 'debug',
        noisy: true
      })
    }
  }

  private async answerClientDynamicTool(
    id: string | number,
    params: JsonObject,
    namespace: string | null,
    tool: string
  ): Promise<void> {
    const bridge = this.options.clientDynamicToolBridge
    if (!bridge) return
    const toolName = namespace ? `${namespace}.${tool}` : tool
    this.record('Codex app-server requested a Browser client tool.', {
      method: 'item/tool/call',
      severity: 'info',
      code: 'browser-client-tool'
    })
    this.options.onParsedEvents([
      {
        type: 'browser.manager_state',
        active: true,
        open: true,
        turnId: stringValue(params.turnId) ?? this.turnId
      },
      {
        type: 'assistant.status',
        content: `Browser tool requested: ${toolName}`
      }
    ])
    try {
      const result = await bridge.call({
        sessionId: this.options.sessionId,
        threadId: stringValue(params.threadId) ?? this.threadId,
        turnId: stringValue(params.turnId) ?? this.turnId,
        namespace,
        tool,
        arguments: dynamicToolArguments(params.arguments)
      })
      this.sendResponse(id, result)
    } catch (error) {
      const message = `Browser client tool failed: ${errorMessage(error)}`
      this.options.onParsedEvents([{ type: 'assistant.status', content: message }])
      this.sendError(id, -32000, message)
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
    this.record('Orchestrator sent Codex app-server request.', {
      method,
      severity: 'debug',
      noisy: true
    })
    if (!this.send({ method, id, params })) {
      this.pendingClientRequests.delete(id)
      onError?.({ message: 'Codex app-server transport is not available.' })
    }
    return id
  }

  private sendNotification(method: string, params?: unknown): void {
    this.record('Orchestrator sent Codex app-server notification.', {
      method,
      severity: 'debug',
      noisy: true
    })
    this.send(params === undefined ? { method } : { method, params })
  }

  private sendResponse(id: string | number, result: unknown): void {
    const pending = this.pendingServerRequests.get(id)
    this.record('Orchestrator answered Codex app-server request.', {
      method: pending?.method,
      severity: 'debug'
    })
    this.send({ id, result })
  }

  private sendError(id: string | number, code: number, message: string): void {
    const pending = this.pendingServerRequests.get(id)
    this.record(message, {
      method: pending?.method,
      severity: 'warning',
      code: String(code)
    })
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
      this.emitTransportFailure(`Codex app-server exited unexpectedly${exitDetail(code, signal)}.`, {
        code: code == null ? signal ?? undefined : String(code)
      })
    } else {
      this.record(`Codex app-server exited${exitDetail(code, signal)}.`, {
        severity: 'debug',
        code: code == null ? signal ?? undefined : String(code)
      })
      this.updateConnection(this.stopped ? 'stopped' : 'disconnected', {
        errorCode: code == null ? signal ?? undefined : String(code),
        message: `Codex app-server exited${exitDetail(code, signal)}.`
      })
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
    this.emitTransportFailure(message, { code: errorCode(error) })
    this.stopped = true
    this.rejectPendingClientRequests(message)
    this.pendingServerRequests.clear()
    try { this.process?.kill('SIGTERM') } catch { /* ignore transport cleanup races */ }
    this.options.onExit()
  }

  private emitTransportFailure(content: string, options: { code?: string } = {}): void {
    this.transportFailed = true
    this.terminalRunEventSeen = true
    this.updateConnection('failed', {
      errorCode: options.code,
      message: content
    })
    this.record(content, {
      severity: 'error',
      code: options.code
    })
    this.options.onParsedEvents([{ type: 'run.failed', content }])
  }

  private rejectPendingClientRequests(message: string): void {
    for (const [, pending] of this.pendingClientRequests) {
      pending.onError?.({ message })
    }
    this.pendingClientRequests.clear()
  }

  private record(
    message: string,
    options: {
      method?: string
      hostId?: string
      severity?: 'debug' | 'info' | 'warning' | 'error'
      noisy?: boolean
      code?: string
    } = {}
  ): void {
    recordProviderRuntimeDebugEvent({
      providerId: this.options.provider.id,
      runtime: 'app-server',
      sessionId: this.options.sessionId,
      hostId: options.hostId ?? this.threadId ?? 'stdio://codex-app-server',
      method: options.method,
      severity: options.severity,
      noisy: options.noisy,
      code: options.code,
      message
    })
  }

  private updateConnection(
    status: 'starting' | 'connected' | 'disconnected' | 'failed' | 'stopped',
    options: {
      hostId?: string
      version?: string
      method?: string
      errorCode?: string
      message?: string
    } = {}
  ): void {
    updateProviderRuntimeConnection({
      providerId: this.options.provider.id,
      runtime: 'app-server',
      sessionId: this.options.sessionId,
      hostId: options.hostId ?? this.threadId ?? 'stdio://codex-app-server',
      status,
      version: options.version,
      method: options.method,
      errorCode: options.errorCode,
      message: options.message
    })
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

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return undefined
}

function exitDetail(code: number | null, signal: NodeJS.Signals | null): string {
  const details = [
    code == null ? null : `code ${code}`,
    signal ? `signal ${signal}` : null
  ].filter(Boolean)
  return details.length > 0 ? ` (${details.join(', ')})` : ''
}

function threadConfigFromRequest(request: RunRequest): JsonObject {
  const policy = codexRuntimePolicyConfig(request.executionPolicy)
  return {
    model: request.model || 'gpt-5.4',
    cwd: request.cwd,
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer,
    sandbox: policy.sandboxMode,
    config: configFromRequest(request),
    serviceName: 'orchestrator',
    personality: 'friendly'
  }
}

function turnConfigFromRequest(request: RunRequest): JsonObject {
  const policy = codexRuntimePolicyConfig(request.executionPolicy)
  return {
    model: request.model || 'gpt-5.4',
    effort: codexEffort(request.effort),
    approvalPolicy: policy.approvalPolicy,
    approvalsReviewer: policy.approvalsReviewer
  }
}

function configFromRequest(request: RunRequest): JsonObject {
  const config: JsonObject = {}
  if (request.effort) config.model_reasoning_effort = codexEffort(request.effort)
  return config
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

function dynamicToolArguments(value: unknown): JsonObject {
  const direct = asRecord(value)
  if (direct) return direct
  if (typeof value !== 'string') return {}
  try {
    return asRecord(JSON.parse(value)) ?? {}
  } catch {
    return {}
  }
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
