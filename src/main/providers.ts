import { v4 as uuidv4 } from 'uuid'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFile, execFileSync, spawn } from 'child_process'
import { delimiter, join } from 'path'
import { homedir, tmpdir } from 'os'
import { promisify } from 'util'
import type {
  AgentNode,
  AgentStatus,
  PermissionDenial,
  PermissionExecutionContract,
  ProviderCapability,
  ProviderCapabilities,
  ProviderCommand,
  PermissionIntent,
  PermissionInteraction,
  PermissionRuntimeControl,
  ProviderCapabilityRegistry,
  ProviderCapabilityGap,
  ProviderCommandSurface,
  ProviderCommandSurfaceResult,
  ProviderDiagnosticInfo,
  ProviderFeature,
  ProviderPermissionRuntimeContext,
  ProviderProbeDefinition,
  ProviderProbeResult,
  ProviderAuthValidationResult,
  ProviderRuntimeInfo,
  ProviderSlashCommand,
  PlanItem,
  PlanItemStatus,
  ResolvedExecutionPolicy,
  RunEvent,
  RunRequest,
  UsageSummary,
  UserInputQuestion
} from '../types'
import { PROVIDER_DEFS } from '../types'
import { loadDotEnvFile } from './localEnv'
import { listProviderRuntimeConnections, listProviderRuntimeDebugEvents } from './providerRuntimeDiagnostics'
import { providerKeychainEnv } from './providerSecrets'

function isExecutablePath(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function commonCliDirs(): string[] {
  const home = homedir()
  return [
    join(home, '.local/bin'),
    join(home, 'bin'),
    join(home, '.npm-global/bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
}

export function providerSearchPath(): string {
  const existing = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  return [...new Set([...existing, ...commonCliDirs()])].join(delimiter)
}

function providerConfigPath(providerId?: string): string | null {
  const home = homedir()
  const paths: Record<string, string> = {
    claude: join(home, '.claude/settings.json'),
    cursor: join(home, '.cursor/cli-config.json'),
    copilot: join(home, '.config/github-copilot/config.json')
  }
  return providerId ? paths[providerId] ?? null : null
}

function providerConfigEnv(providerId?: string): NodeJS.ProcessEnv {
  const configPath = providerConfigPath(providerId)
  if (!configPath) return {}

  try {
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> }
    return Object.fromEntries(
      Object.entries(parsed.env ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  } catch {
    return {}
  }
}

function orchestratorProviderEnvPath(): string {
  if (process.env.ORCHESTRATOR_PROVIDER_ENV_PATH) return process.env.ORCHESTRATOR_PROVIDER_ENV_PATH
  return process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/orchestrator/provider-env.json')
    : join(homedir(), '.orchestrator/provider-env.json')
}

function orchestratorProviderEnv(providerId?: string): NodeJS.ProcessEnv {
  if (!providerId) return {}
  try {
    const raw = readFileSync(orchestratorProviderEnvPath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const providers = asRecord(parsed.providers)
    const entry = asRecord(providers?.[providerId]) ?? asRecord(parsed[providerId])
    const env = asRecord(entry?.env) ?? entry
    return Object.fromEntries(
      Object.entries(env ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  } catch {
    return {}
  }
}

export function providerSpawnEnv(providerId?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...loadDotEnvFile(),
    ...providerConfigEnv(providerId),
    ...orchestratorProviderEnv(providerId),
    ...providerKeychainEnv(providerId),
    PATH: providerSearchPath(),
    TERM: 'xterm-256color'
  }
}

export async function validateProviderAuthSecret(providerId: string): Promise<ProviderAuthValidationResult> {
  if (providerId !== 'cursor') {
    return {
      ok: false,
      providerId,
      message: 'Auth validation is only implemented for Cursor API keys right now.'
    }
  }

  const provider = PROVIDERS[providerId]
  if (!provider) {
    return { ok: false, providerId, message: 'Provider is not registered.' }
  }

  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-provider-auth-'))
  const marker = 'ORCHESTRATOR_CURSOR_AUTH_OK'
  try {
    writeFileSync(join(cwd, 'SMOKE.md'), 'Disposable Orchestrator Cursor auth validation workspace.\n')
    const request: RunRequest = {
      prompt: [
        'You are validating Cursor auth for Orchestrator.',
        'Do not edit files.',
        `Reply with exactly: ${marker}`
      ].join(' '),
      cwd,
      model: 'composer-2.5-fast',
      effort: 'low',
      providerSessionId: null,
      executionPolicy: 'default',
      allowedTools: [],
      runtime: 'headless'
    }
    const commandSpec = buildProviderCommandForRuntime(provider, request)
    const command = commandSpec ? resolveProviderCommand(provider, commandSpec) : null
    if (!command) return { ok: false, providerId, message: 'Cursor CLI is not available.' }

    const { stdout } = await execFileAsync(command.binary, command.args, {
      cwd,
      env: providerSpawnEnv(providerId),
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024
    })
    const events = String(stdout)
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => provider.parseOutputLine(line))
    const text = events
      .filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta')
      .map((event) => event.content)
      .join('')
    const eventTypes = [...new Set(events.map((event) => event.type))]
    const failed = events.find((event) => event.type === 'run.failed')
    if (failed?.type === 'run.failed') {
      return { ok: false, providerId, message: failed.content ?? 'Cursor auth validation failed.', eventTypes }
    }
    if (!eventTypes.includes('run.completed') || !text.includes(marker)) {
      return { ok: false, providerId, message: 'Cursor ran, but did not return the validation response.', eventTypes }
    }
    return { ok: true, providerId, message: 'Cursor auth validated.', eventTypes }
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : err.stderr
    const stdout = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : err.stdout
    const output = [stderr, stdout, err.message].filter(Boolean).join('\n').trim()
    return { ok: false, providerId, message: output.split(/\r?\n/).filter(Boolean).slice(-3).join('\n') || 'Cursor auth validation failed.' }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function resolveNamedBinary(candidate: string): string | null {
  const pathEnv = providerSearchPath()
  try {
    const resolved = execFileSync('which', [candidate], {
      encoding: 'utf8',
      env: { ...process.env, PATH: pathEnv }
    }).trim()
    return resolved || null
  } catch {
    for (const dir of commonCliDirs()) {
      const absolute = join(dir, candidate)
      if (isExecutablePath(absolute)) return absolute
    }
    return null
  }
}

export function resolveProviderBinary(provider: ProviderAdapter): string | null {
  const candidates = provider.binaryCandidates ?? [provider.binary]
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (isExecutablePath(candidate)) return candidate
      continue
    }
    const resolved = resolveNamedBinary(candidate)
    if (resolved) return resolved
  }
  return null
}

export function resolveProviderCommand(provider: ProviderAdapter, command: ProviderCommand): ProviderCommand | null {
  const binary = resolveProviderBinary(provider)
  return binary ? { ...command, binary } : null
}

export interface ProviderAdapter {
  id: string
  binary: string
  binaryCandidates?: string[]
  capabilities: ProviderCapabilities
  resolveExecutionPolicy(policy: string): ResolvedExecutionPolicy
  buildStartCommand?(request: RunRequest): ProviderCommand
  buildResumeCommand?(request: RunRequest): ProviderCommand
  buildInteractiveCommand?(request: RunRequest): ProviderCommand
  parseOutputLine(line: string): RunEvent[]
}

export function buildProviderCommandForRuntime(
  provider: ProviderAdapter,
  request: RunRequest,
  mode: 'start' | 'resume' = 'start'
): ProviderCommand | null {
  if (request.runtime === 'interactive' && provider.capabilities.interactiveCli && provider.buildInteractiveCommand) {
    return provider.buildInteractiveCommand(request)
  }
  if (mode === 'resume') return provider.buildResumeCommand?.(request) ?? null
  return provider.buildStartCommand?.(request) ?? null
}

function command(binary: string, args: string[]): ProviderCommand {
  return { binary, args }
}

function resolvedPolicyArgs(provider: ProviderAdapter, policyId: string, fallback = 'default'): string[] {
  const resolved = provider.resolveExecutionPolicy(policyId)
  return resolved.support === 'unsupported'
    ? provider.resolveExecutionPolicy(fallback).args
    : resolved.args
}

function interactivePolicyArgs(provider: ProviderAdapter, policyId: string, fallback = 'default'): string[] {
  const resolved = provider.resolveExecutionPolicy(policyId)
  const effective = resolved.support === 'unsupported'
    ? provider.resolveExecutionPolicy(fallback)
    : resolved

  if (provider.id !== 'codex') return effective.args

  const approvalConfig = effective.args.find((arg) => arg.startsWith('approval_policy='))
  const approval = approvalConfig?.match(/^approval_policy="([^"]+)"$/)?.[1]
  const sandboxIndex = effective.args.indexOf('--sandbox')
  const sandbox = sandboxIndex >= 0 ? effective.args[sandboxIndex + 1] : undefined
  const args: string[] = []
  if (sandbox) args.push('--sandbox', sandbox)
  if (approval) args.push('--ask-for-approval', approval)
  for (let index = 0; index < effective.args.length; index += 1) {
    if (effective.args[index] !== '-c') continue
    const configValue = effective.args[index + 1]
    if (typeof configValue === 'string' && !configValue.startsWith('approval_policy=')) {
      args.push('-c', configValue)
    }
    index += 1
  }
  return args
}

function capability(
  key: ProviderCapability['key'],
  label: string,
  support: ProviderCapability['support'],
  source: ProviderCapability['source'],
  note?: string
): ProviderCapability {
  return { key, label, support, source, note }
}

function baseCapabilities(provider: ProviderAdapter): ProviderCapability[] {
  return [
    capability('resume', 'Resume', provider.capabilities.resume ? 'supported' : 'unsupported', 'adapter'),
    capability('interactiveCli', 'Interactive CLI', provider.capabilities.interactiveCli ? 'supported' : 'unsupported', 'adapter'),
    capability('structuredOutput', 'Structured Output', provider.capabilities.streamingJson ? 'supported' : 'partial', 'adapter'),
    capability('streamEvents', 'Stream Events', provider.capabilities.streamingJson ? 'supported' : 'unsupported', 'adapter'),
    capability(
      'interactivePermissions',
      'Interactive Permissions',
      provider.capabilities.interactivePermissions ? 'supported' : provider.capabilities.forcedAllTools ? 'forced' : 'unsupported',
      'adapter'
    ),
    capability('toolAllowlist', 'Tool Allowlist', provider.capabilities.allowedTools ? 'supported' : 'unsupported', 'adapter'),
    capability('workspaceSandbox', 'Workspace Sandbox', provider.capabilities.workspaceSandbox ? 'supported' : 'unsupported', 'adapter'),
    capability('fullAccess', 'Full Access', provider.capabilities.fullAccessMode ? 'supported' : 'unsupported', 'adapter'),
    capability(
      'checkpointUndo',
      'Checkpoint Undo',
      provider.capabilities.checkpointUndo ? 'supported' : 'unsupported',
      'adapter',
      provider.capabilities.checkpointUndo
        ? 'Provider can roll back a completed turn from a provider checkpoint.'
        : 'Requires a provider checkpoint id plus rollback API; current adapters keep provider last-turn Undo disabled.'
    ),
    capability(
      'bypassAll',
      'Bypass All',
      provider.resolveExecutionPolicy('yolo').support === 'unsupported' ? 'unsupported' : 'supported',
      'adapter'
    )
  ]
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function stringArrayValue(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    if (strings.length > 0) return strings
  }
  return []
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function usageSummaryFromAnthropicResult(event: Record<string, unknown>): UsageSummary | undefined {
  const usage = asRecord(event.usage)
  const modelUsage = asRecord(event.modelUsage)
  const inputTokens = numberValue(usage?.input_tokens, usage?.inputTokens)
  const outputTokens = numberValue(usage?.output_tokens, usage?.outputTokens)
  const cacheCreationInputTokens = numberValue(usage?.cache_creation_input_tokens, usage?.cacheCreationInputTokens)
  const cacheReadInputTokens = numberValue(usage?.cache_read_input_tokens, usage?.cacheReadInputTokens)
  const totalCostUsd = numberValue(event.total_cost_usd, event.totalCostUsd)
  const durationMs = numberValue(event.duration_ms, event.durationMs)
  const apiDurationMs = numberValue(event.duration_api_ms, event.apiDurationMs)
  const turns = numberValue(event.num_turns, event.turns)
  const serviceTier = stringValue(usage?.service_tier, usage?.serviceTier)
  const totalTokens = [
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens
  ].reduce<number>((sum, value) => sum + (value ?? 0), 0)

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    totalCostUsd === undefined &&
    durationMs === undefined &&
    apiDurationMs === undefined &&
    turns === undefined &&
    !modelUsage
  ) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: totalTokens > 0 ? totalTokens : undefined,
    totalCostUsd,
    durationMs,
    apiDurationMs,
    turns,
    serviceTier,
    modelUsage: modelUsage as UsageSummary['modelUsage'] | undefined
  }
}

function textFromContentBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => {
    const rec = asRecord(block)
    return rec?.type === 'text' && typeof rec.text === 'string' ? [rec.text] : []
  })
}

export function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}

function claudeAgentIdFromContent(value: unknown): string | undefined {
  const match = stringifyContent(value).match(/\bagentId:\s*([a-f0-9-]+)/iu)
  return match?.[1]
}

function normalizePlanItemStatus(value: unknown): PlanItemStatus {
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled' || value === 'blocked') return value
  if (value === 'doing' || value === 'active' || value === 'running') return 'in_progress'
  if (value === 'done' || value === 'success') return 'completed'
  if (value === 'failed') return 'blocked'
  return 'pending'
}

function planItemsFromTodos(input: unknown): PlanItem[] {
  const record = asRecord(input) ?? {}
  const rawTodos = Array.isArray(record.todos)
    ? record.todos
    : Array.isArray(record.items)
      ? record.items
      : []

  return rawTodos.flatMap((todo, index) => {
    const rec = asRecord(todo)
    if (!rec) return []
    const content = stringValue(rec.content, rec.text, rec.task, rec.title)
    if (!content) return []
    return [{
      id: stringValue(rec.id) ?? String(index + 1),
      content,
      status: normalizePlanItemStatus(rec.status)
    }]
  })
}

function planModeFromTool(name: string): 'plan' | 'execute' | undefined {
  if (name === 'EnterPlanMode') return 'plan'
  if (name === 'ExitPlanMode') return 'execute'
  return undefined
}

function claudeTaskSummary(event: Record<string, unknown>): string | undefined {
  const usage = asRecord(event.usage)
  const details = [
    stringValue(event.description, event.summary),
    stringValue(event.last_tool_name) ? `Tool: ${stringValue(event.last_tool_name)}` : undefined,
    numberValue(usage?.total_tokens) ? `${numberValue(usage?.total_tokens)} tokens` : undefined
  ].filter((value): value is string => Boolean(value))

  return details.length > 0 ? details.join(' · ') : undefined
}

function claudeAgentEventFromTaskSystemEvent(
  providerId: string,
  sessionId: string | undefined,
  event: Record<string, unknown>
): RunEvent | null {
  const subtype = stringValue(event.subtype)
  if (subtype !== 'task_started' && subtype !== 'task_progress' && subtype !== 'task_notification') return null

  const id = stringValue(event.tool_use_id, event.task_id)
  if (!id) return null

  const status = subtype === 'task_notification'
    ? normalizeAgentStatus(stringValue(event.status))
    : 'running'
  const eventType = status === 'completed'
    ? 'agent.completed'
    : status === 'failed'
      ? 'agent.failed'
      : subtype === 'task_started'
        ? 'agent.started'
        : 'agent.updated'

  return {
    type: eventType,
    agent: {
      id,
      providerId,
      sessionId: sessionId ?? '',
      name: stringValue(event.task_type, event.description),
      role: stringValue(event.description, event.prompt),
      status,
      summary: claudeTaskSummary(event),
      providerAgentId: id,
      providerItemId: id,
      providerThreadId: stringValue(event.task_id, event.session_id),
      parentThreadId: sessionId,
      providerTurnId: stringValue(event.turn_id),
      source: stringValue(event.task_id, event.session_id) ? 'provider-thread' : 'provider-event',
      completedAt: status === 'completed' || status === 'failed' || status === 'cancelled'
        ? Date.now()
        : undefined
    }
  } as RunEvent
}

function streamStateKey(providerId: string, sessionId: string | undefined, parentToolUseId: string | undefined): string {
  return `${providerId}:${sessionId ?? 'unknown'}:${parentToolUseId ?? 'main'}`
}

function streamBlockKey(streamKey: string, index: number | undefined): string {
  return `${streamKey}:${index ?? 0}`
}

function streamIdForBlock(streamKey: string, index: number | undefined): string {
  return `${anthropicStreamMessageIds.get(streamKey) ?? streamKey}:${index ?? 0}`
}

function claudePartialEventFromStreamEvent(
  providerId: string,
  sessionId: string | undefined,
  parentToolUseId: string | undefined,
  event: Record<string, unknown>
): RunEvent[] {
  const streamEvent = asRecord(event.event)
  const streamType = stringValue(streamEvent?.type)
  if (!streamEvent || !streamType) return []

  const streamKey = streamStateKey(providerId, sessionId, parentToolUseId)
  const index = numberValue(streamEvent.index)

  if (streamType === 'message_start') {
    const message = asRecord(streamEvent.message)
    const messageId = stringValue(message?.id)
    if (messageId) anthropicStreamMessageIds.set(streamKey, messageId)
    return []
  }

  if (streamType === 'content_block_start') {
    const contentBlock = asRecord(streamEvent.content_block)
    const blockType = stringValue(contentBlock?.type)
    if (blockType) anthropicStreamBlockTypes.set(streamBlockKey(streamKey, index), blockType)
    return []
  }

  if (streamType === 'content_block_delta') {
    const delta = asRecord(streamEvent.delta)
    if (delta?.type !== 'text_delta' || typeof delta.text !== 'string' || !delta.text) return []

    const streamId = streamIdForBlock(streamKey, index)
    const messageId = anthropicStreamMessageIds.get(streamKey)
    if (messageId) anthropicPartialMessageIds.add(messageId)

    return parentToolUseId
      ? [{ type: 'agent.text.delta', agentId: parentToolUseId, streamId, content: delta.text }]
      : [{ type: 'assistant.text.delta', streamId, content: delta.text }]
  }

  if (streamType === 'content_block_stop') {
    const blockKey = streamBlockKey(streamKey, index)
    if (anthropicStreamBlockTypes.get(blockKey) !== 'text') return []

    const streamId = streamIdForBlock(streamKey, index)
    anthropicStreamBlockTypes.delete(blockKey)
    return parentToolUseId
      ? [{ type: 'agent.text.completed', agentId: parentToolUseId, streamId }]
      : [{ type: 'assistant.text.completed', streamId }]
  }

  if (streamType === 'message_stop') {
    anthropicStreamMessageIds.delete(streamKey)
  }

  return []
}

function agentEventFromProviderPayload(
  providerId: string,
  sessionId: string | null | undefined,
  type: string,
  payload: Record<string, unknown> | undefined,
  fallbackId: string
): RunEvent | null {
  const agentRecord = asRecord(payload?.agent) ?? payload ?? {}
  const id = stringValue(agentRecord.id, agentRecord.agentId, agentRecord.agent_id, agentRecord.name, fallbackId) ?? fallbackId
  const parentAgentId = stringValue(agentRecord.parentAgentId, agentRecord.parent_agent_id, agentRecord.parentId)
  const name = stringValue(agentRecord.name, agentRecord.label, agentRecord.title, agentRecord.agentName)
  const role = stringValue(agentRecord.role, agentRecord.description, agentRecord.kind)
  const model = stringValue(agentRecord.model, agentRecord.modelId)
  const summary = stringValue(agentRecord.summary, agentRecord.result, agentRecord.error, payload?.summary, payload?.error)
  const startedAt = numberValue(agentRecord.startedAt, agentRecord.started_at, payload?.startedAt)
  const completedAt = numberValue(agentRecord.completedAt, agentRecord.completed_at, payload?.completedAt)
  const providerThreadId = stringValue(agentRecord.providerThreadId, agentRecord.threadId, agentRecord.thread_id, agentRecord.sessionId, agentRecord.session_id)
  const childThreadIds = stringArrayValue(agentRecord.childThreadIds, agentRecord.receiverThreadIds, payload?.childThreadIds, payload?.receiverThreadIds)
  const status: AgentStatus = type === 'subagent.started' || type === 'agent.started'
    ? 'running'
    : type === 'subagent.completed' || type === 'agent.completed'
      ? 'completed'
      : type === 'subagent.failed' || type === 'agent.failed'
        ? 'failed'
        : normalizeAgentStatus(stringValue(agentRecord.status, payload?.status))
  const eventType = status === 'completed'
    ? 'agent.completed'
    : status === 'failed'
      ? 'agent.failed'
      : type === 'subagent.started' || type === 'agent.started'
        ? 'agent.started'
        : 'agent.updated'

  return {
    type: eventType,
    agent: {
      id,
      providerId,
      sessionId: sessionId ?? '',
      parentAgentId,
      providerAgentId: stringValue(agentRecord.providerAgentId, agentRecord.agentId, agentRecord.agent_id),
      providerItemId: stringValue(agentRecord.providerItemId, agentRecord.itemId, agentRecord.toolUseId, agentRecord.tool_use_id),
      providerThreadId,
      parentThreadId: stringValue(agentRecord.parentThreadId, agentRecord.parent_thread_id, payload?.parentThreadId, payload?.parent_thread_id),
      childThreadIds,
      receiverThreadIds: stringArrayValue(agentRecord.receiverThreadIds, payload?.receiverThreadIds),
      providerTurnId: stringValue(agentRecord.turnId, agentRecord.turn_id, payload?.turnId, payload?.turn_id),
      source: providerThreadId || childThreadIds.length > 0 ? 'provider-thread' : 'provider-event',
      name,
      role,
      status,
      model,
      startedAt,
      completedAt,
      summary
    }
  } as RunEvent
}

function normalizeAgentStatus(value: string | undefined): AgentStatus {
  if (value === 'queued') return 'queued'
  if (value === 'running') return 'running'
  if (value === 'waiting') return 'waiting'
  if (value === 'blocked') return 'blocked'
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  if (value === 'cancelled' || value === 'canceled') return 'cancelled'
  return 'running'
}

function parseStructuredUserInputRequest(value: unknown): { content: string; questions: UserInputQuestion[] } | null {
  const raw = typeof value === 'string' ? parseJsonLine(value) : asRecord(value)
  const questions = Array.isArray(raw?.questions) ? raw.questions : []
  const parsedQuestions: UserInputQuestion[] = questions.flatMap((question) => {
    const rec = asRecord(question)
    if (!rec || typeof rec.question !== 'string') return []
    const options = Array.isArray(rec.options)
      ? rec.options.flatMap((option) => {
          const opt = asRecord(option)
          return opt && typeof opt.label === 'string'
            ? [{ label: opt.label, description: typeof opt.description === 'string' ? opt.description : undefined }]
            : []
        })
      : undefined
    return [{
      question: rec.question,
      header: typeof rec.header === 'string' ? rec.header : undefined,
      options,
      multiSelect: rec.multiSelect === true,
      isOther: rec.isOther === true,
      isSecret: rec.isSecret === true
    }]
  })

  if (parsedQuestions.length === 0) return null
  return {
    content: parsedQuestions.map((question) => question.question).join('\n'),
    questions: parsedQuestions
  }
}

function userInputFromAskUserQuestionTool(input: unknown): { content: string; questions: UserInputQuestion[] } | null {
  const rec = asRecord(input)
  if (!rec) return null
  return parseStructuredUserInputRequest({ questions: rec.questions ?? [rec] })
}

function userInputFromGenericPayload(payload: unknown): { content: string; questions: UserInputQuestion[] } | null {
  const rec = asRecord(payload)
  if (!rec) return null
  const structured = parseStructuredUserInputRequest(rec)
  if (structured) return structured

  const question = stringValue(
    rec.question,
    rec.prompt,
    rec.message,
    rec.text,
    asRecord(rec.input)?.question,
    asRecord(rec.data)?.question
  )
  if (!question) return null

  const rawOptions = Array.isArray(rec.options)
    ? rec.options
    : Array.isArray(asRecord(rec.input)?.options)
      ? asRecord(rec.input)?.options as unknown[]
      : Array.isArray(asRecord(rec.data)?.options)
        ? asRecord(rec.data)?.options as unknown[]
        : []
  const options = rawOptions.flatMap((option) => {
    if (typeof option === 'string') return [{ label: option }]
    const opt = asRecord(option)
    const label = stringValue(opt?.label, opt?.name, opt?.value, opt?.title)
    return label
      ? [{ label, description: stringValue(opt?.description, opt?.detail, opt?.subtitle) }]
      : []
  })

  return {
    content: question,
    questions: [{
      question,
      header: stringValue(rec.header, rec.title),
      options: options.length > 0 ? options : undefined,
      multiSelect: rec.multiSelect === true || rec.multiselect === true,
      isOther: rec.isOther === true || rec.other === true,
      isSecret: rec.isSecret === true || rec.secret === true
    }]
  }
}

function permissionRequestFromGenericPayload(payload: Record<string, unknown>): RunEvent | null {
  const data = asRecord(payload.data) ?? asRecord(payload.permission) ?? asRecord(payload.approval) ?? payload
  const toolName = stringValue(data.tool_name, data.toolName, data.name, data.kind, data.type) ?? 'tool'
  const toolUseId = stringValue(data.tool_use_id, data.toolUseId, data.call_id, data.callId, data.id) ?? uuidv4()
  const toolInput = asRecord(data.tool_input ?? data.toolInput ?? data.input ?? data.arguments) ?? {}
  const content = stringValue(data.message, data.summary, data.prompt, data.reason, payload.message)

  return {
    type: 'permission.requested',
    content,
    denials: [{
      tool_name: toolName,
      tool_use_id: toolUseId,
      tool_input: toolInput
    }]
  }
}

function compactToolInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null))
}

const anthropicUserQuestionToolIds = new Set<string>()
const anthropicPlanConfirmationToolIds = new Set<string>()
const anthropicPartialMessageIds = new Set<string>()
const anthropicStreamMessageIds = new Map<string, string>()
const anthropicStreamBlockTypes = new Map<string, string>()
const anthropicTaskAgents = new Map<string, {
  providerId: string
  sessionId: string
  name?: string
  role?: string
  model?: string
}>()

const PROVIDER_PROBE_TIMEOUT_MS = 2_000
const PROVIDER_COMMAND_SURFACE_TIMEOUT_MS = 5_000
const PROVIDER_PERMISSION_CONTEXT_TTL_MS = 30_000
const providerPermissionContextCache = new Map<string, {
  expiresAt: number
  promise: Promise<ProviderPermissionRuntimeContext>
}>()
const execFileAsync = promisify(execFile)

function feature(
  id: string,
  label: string,
  area: ProviderFeature['area'],
  support: ProviderFeature['support'],
  source: ProviderFeature['source'],
  runtimes: ProviderFeature['runtimes'],
  note?: string
): ProviderFeature {
  return { id, label, area, support, source, runtimes, note }
}

function gap(
  id: string,
  label: string,
  area: ProviderCapabilityGap['area'],
  severity: ProviderCapabilityGap['severity'],
  status: ProviderCapabilityGap['status'],
  summary: string,
  nextStep: string
): ProviderCapabilityGap {
  return { id, label, area, severity, status, summary, nextStep }
}

function probe(
  id: string,
  label: string,
  args: string[],
  category: ProviderProbeDefinition['category'],
  safeByDefault = true
): ProviderProbeDefinition {
  return { id, label, args, category, quota: 'none', safeByDefault }
}

function slashCommand(
  name: string,
  description: string,
  source: ProviderSlashCommand['source'],
  runtime: ProviderSlashCommand['runtime'],
  handler: ProviderSlashCommand['handler'],
  patch: Partial<ProviderSlashCommand> = {}
): ProviderSlashCommand {
  return {
    id: patch.id ?? name.slice(1),
    name,
    description,
    providerId: patch.providerId ?? '',
    source,
    runtime,
    handler,
    featureId: patch.featureId,
    prompt: patch.prompt,
    arguments: patch.arguments
  }
}

function withProviderId(providerId: string, command: ProviderSlashCommand): ProviderSlashCommand {
  return { ...command, providerId }
}

function commandSurface(
  id: string,
  label: string,
  area: ProviderCommandSurface['area'],
  command: string[],
  runtime: ProviderCommandSurface['runtime'],
  quota: ProviderCommandSurface['quota'],
  mutatesState: boolean,
  appSurface: ProviderCommandSurface['appSurface'],
  patch: Partial<ProviderCommandSurface> = {}
): ProviderCommandSurface {
  return {
    id,
    label,
    area,
    command,
    runtime,
    quota,
    mutatesState,
    appSurface,
    featureId: patch.featureId,
    note: patch.note
  }
}

const providerRegistries: Record<string, ProviderCapabilityRegistry> = {
  claude: {
    providerId: 'claude',
    features: [
      feature('sdk-runtime', 'SDK runtime', 'runtime', 'supported', 'adapter', ['sdk']),
      feature('ask-user-question', 'Ask user', 'permissions', 'supported', 'adapter', ['sdk'], 'AskUserQuestion is normalized as user input.'),
      feature('tool-permissions', 'Tool grants', 'permissions', 'supported', 'adapter', ['sdk']),
      feature('slash-commands', 'Slash commands', 'commands', 'partial', 'local-cli', ['sdk'], 'Provider command inventory still comes from local no-quota Claude commands.'),
      feature('agents', 'Agents', 'agents', 'supported', 'adapter', ['sdk']),
      feature('ultrareview', 'Ultrareview', 'review', 'supported', 'local-cli', ['sdk']),
      feature('mcp', 'MCP', 'mcp', 'supported', 'adapter', ['sdk']),
      feature('plugins', 'Plugins', 'extensions', 'supported', 'local-cli', ['sdk']),
      feature('worktrees', 'Worktrees', 'workspace', 'supported', 'adapter', ['sdk']),
      feature('attachments', 'Files', 'attachments', 'partial', 'adapter', ['sdk'])
    ],
    gaps: [
      gap(
        'claude-hook-partials',
        'Hook and partial streams',
        'runtime',
        'medium',
        'partial',
        'Claude SDK partial text streams are normalized; hook lifecycle events are not surfaced yet.',
        'Add parser fixtures for SDK hook events before enabling hook event UI.'
      ),
      gap(
        'claude-rich-permission-controls',
        'Denied tools and scoped grants',
        'permissions',
        'medium',
        'partial',
        'Allowed tools, denied tools, available tool sets, additional directories, allow-once grants, allow-session grants, and denial are represented in run/session state and passed to the Claude SDK; native Claude rule-file import/export is not surfaced yet.',
        'Add native rule-file import/export only after the CLI exposes a stable no-quota contract for those settings.'
      ),
      gap(
        'claude-cli-management',
        'MCP/plugin/agent management',
        'mcp',
        'medium',
        'partial',
        'MCP, plugins, agents, auth, and auto-mode no-quota commands are surfaced as provider command panels; mutating commands and model-quota commands are intentionally blocked from one-click execution.',
        'Route mutating/provider-quota flows through an explicit terminal or composer action with confirmation instead of settings auto-run.'
      ),
      gap(
        'claude-worktree-launch',
        'Worktree launch',
        'workspace',
        'medium',
        'partial',
        'Orchestrator can create app-managed git worktrees before launch; native Claude --worktree, --tmux, --from-pr, --fork-session, and named session flows are not exposed as separate SDK launch options.',
        'Keep app-managed worktrees as the cross-provider default and add provider-native launch extras only behind an advanced sheet.'
      )
    ],
    probes: [
      probe('version', 'Version', ['--version'], 'version'),
      probe('help', 'Help', ['--help'], 'help'),
      probe('agents-help', 'Agents', ['agents', '--help'], 'help'),
      probe('mcp-help', 'MCP', ['mcp', '--help'], 'mcp'),
      probe('plugin-help', 'Plugins', ['plugin', '--help'], 'extensions'),
      probe('ultrareview-help', 'Ultrareview', ['ultrareview', '--help'], 'features'),
      probe('auto-mode-defaults', 'Auto mode defaults', ['auto-mode', 'defaults'], 'features')
    ],
    commandSurfaces: [
      commandSurface('auth-status', 'Auth status', 'runtime', ['auth', 'status'], 'sdk', 'none', false, 'settings', { featureId: 'auth' }),
      commandSurface('agents-list', 'Configured agents', 'agents', ['agents'], 'sdk', 'none', false, 'settings', { featureId: 'agents' }),
      commandSurface('mcp-list', 'MCP servers', 'mcp', ['mcp', 'list'], 'sdk', 'none', false, 'settings', { featureId: 'mcp' }),
      commandSurface('mcp-details', 'MCP details', 'mcp', ['mcp', 'get'], 'sdk', 'none', false, 'settings', { featureId: 'mcp', note: 'Runs mcp list, then mcp get for each discovered server.' }),
      commandSurface('plugin-list', 'Plugins', 'extensions', ['plugin', 'list', '--json'], 'sdk', 'none', false, 'settings', { featureId: 'plugins' }),
      commandSurface('auto-mode-defaults', 'Auto mode defaults', 'permissions', ['auto-mode', 'defaults'], 'sdk', 'none', false, 'settings', { featureId: 'auto-mode' }),
      commandSurface('project-purge', 'Purge project state', 'workspace', ['project', 'purge'], 'sdk', 'none', true, 'settings', { featureId: 'project-state' }),
      commandSurface('ultrareview-json', 'Ultrareview JSON', 'review', ['ultrareview', '--json'], 'sdk', 'may-use-quota', false, 'composer', { featureId: 'ultrareview' })
    ],
    slashCommands: [
      slashCommand('/review', 'Run Claude ultrareview against the current changes', 'provider', 'sdk', 'insert-prompt', {
        featureId: 'ultrareview',
        prompt: 'Review the current changes with Claude ultrareview-style depth. Focus on correctness, regressions, and missing tests.'
      }),
      slashCommand('/agents', 'Work with Claude agents', 'provider', 'sdk', 'send-to-provider', { featureId: 'agents' }),
      slashCommand('/mcp', 'Open Claude MCP command flow', 'provider', 'sdk', 'send-to-provider', { featureId: 'mcp' }),
      slashCommand('/plugins', 'Open Claude plugin command flow', 'provider', 'sdk', 'send-to-provider', { featureId: 'plugins' })
    ]
  },
  copilot: {
    providerId: 'copilot',
    features: [
      feature('json-output', 'JSON output', 'runtime', 'partial', 'adapter', ['headless']),
      feature('interactive-cli', 'Interactive CLI', 'runtime', 'supported', 'local-cli', ['interactive']),
      feature('slash-commands', 'Commands', 'commands', 'supported', 'local-cli', ['interactive']),
      feature('subagents', 'Subagents', 'agents', 'planned', 'local-cli', ['interactive']),
      feature('rich-permissions', 'Rich permissions', 'permissions', 'supported', 'local-cli', ['interactive', 'headless'], 'Supports allow/deny tool, path, URL, MCP, plan, autopilot, and ask-user controls.'),
      feature('mcp', 'MCP', 'mcp', 'supported', 'local-cli', ['interactive', 'headless']),
      feature('skills', 'Plugins', 'extensions', 'supported', 'local-cli', ['interactive']),
      feature('code-review', 'Review', 'review', 'planned', 'local-cli', ['interactive'])
    ],
    gaps: [
      gap(
        'copilot-cli-keychain',
        'CLI keychain health',
        'runtime',
        'high',
        'partial',
        'The local copilot binary works outside the sandbox, but keychain-backed probes can fail with SecItemCopyMatching in sandboxed processes.',
        'Run account-sensitive probes from the installed app process and surface keychain errors separately from missing CLI errors.'
      ),
      gap(
        'copilot-cli-command-inventory',
        'CLI command inventory',
        'commands',
        'medium',
        'partial',
        'Top-level help is captured, but command/help-topic details for commands, permissions, providers, plugins, and monitoring are not yet fixture-backed.',
        'Capture no-quota help for permissions, providers, mcp, plugin, and commands, then map the useful controls into provider settings.'
      ),
      gap(
        'copilot-structured-runtime',
        'Structured CLI event parsing',
        'runtime',
        'medium',
        'partial',
        'The adapter handles basic JSON messages/tools, but rich command, elicitation, MCP, background-task, and subagent events are not fixture-backed through the CLI path.',
        'Record CLI JSON transcripts for commands, permissions, user input, and subagents, then add parser fixture tests.'
      )
    ],
    probes: [
      probe('version', 'Version', ['--version'], 'version'),
      probe('help', 'Help', ['--help'], 'help')
    ],
    commandSurfaces: [],
    slashCommands: [
      slashCommand('/review', 'Start a Copilot code review task', 'sdk', 'sdk', 'sdk-command', { featureId: 'code-review' }),
      slashCommand('/agents', 'Show Copilot agents', 'sdk', 'sdk', 'sdk-command', { featureId: 'subagents' }),
      slashCommand('/commands', 'Refresh Copilot commands', 'sdk', 'sdk', 'sdk-command', { featureId: 'slash-commands' })
    ]
  },
  codex: {
    providerId: 'codex',
    features: [
      feature('exec-json', 'Exec JSON', 'runtime', 'supported', 'adapter', ['headless']),
      feature('interactive', 'Interactive CLI', 'runtime', 'partial', 'local-cli', ['interactive'], 'Launch command and trust prompt are verified, but Orchestrator targets app-server for rich Codex UI instead of PTY scraping.'),
      feature('app-server', 'App server', 'runtime', 'supported', 'adapter', ['app-server'], 'Orchestrator starts the Codex app-server protocol, opens/resumes threads, starts turns, handles approvals/questions/MCP elicitation, streams deltas, and normalizes plans/tools/agents.'),
      feature('mcp-elicitation', 'Elicitation', 'permissions', 'supported', 'adapter', ['app-server']),
      feature('sandbox', 'Sandbox', 'permissions', 'supported', 'adapter', ['headless', 'app-server', 'interactive']),
      feature('slash-commands', 'Commands', 'commands', 'partial', 'local-cli', ['app-server']),
      feature('multi-agent', 'Multi-agent', 'agents', 'supported', 'local-cli', ['app-server']),
      feature('mcp', 'MCP', 'mcp', 'supported', 'local-cli', ['headless', 'app-server']),
      feature('plugins', 'Plugins', 'extensions', 'supported', 'local-cli', ['app-server']),
      feature('review', 'Review', 'review', 'supported', 'local-cli', ['headless']),
      feature('local-providers', 'Local models', 'runtime', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('images', 'Images', 'attachments', 'supported', 'local-cli', ['app-server'])
    ],
    gaps: [
      gap(
        'codex-backend-variants',
        'OSS/local providers',
        'runtime',
        'medium',
        'missing',
        'The CLI supports --oss and --local-provider, but model/provider backend variants are not represented in settings.',
        'Add backend variant controls under Codex models: OpenAI, OSS, Ollama, and LM Studio.'
      ),
      gap(
        'codex-auto-review-mode',
        'Auto-review approval mode',
        'permissions',
        'medium',
        'partial',
        'Generated app-server v2 schema verifies approvals_reviewer="auto_review"; Orchestrator can now pass it as an advanced Codex permission mode.',
        'Verify live auto-review behavior with an approval-producing run before promoting it to a primary/default mode.'
      )
    ],
    probes: [
      probe('version', 'Version', ['--version'], 'version'),
      probe('exec-help', 'Exec', ['exec', '--help'], 'help'),
      probe('review-help', 'Review', ['review', '--help'], 'features'),
      probe('mcp-help', 'MCP', ['mcp', '--help'], 'mcp'),
      probe('plugin-help', 'Plugins', ['plugin', '--help'], 'extensions'),
      probe('sandbox-help', 'Sandbox', ['sandbox', '--help'], 'features'),
      probe('features-list', 'Features', ['features', 'list'], 'features')
    ],
    commandSurfaces: [
      commandSurface('appserver-models', 'Models', 'runtime', ['app-server', 'model/list'], 'app-server', 'none', false, 'settings', { featureId: 'local-providers' }),
      commandSurface('appserver-model-provider-capabilities', 'Model provider capabilities', 'runtime', ['app-server', 'modelProvider/capabilities/read'], 'app-server', 'none', false, 'settings', { featureId: 'local-providers' }),
      commandSurface('appserver-features', 'Feature flags', 'runtime', ['app-server', 'experimentalFeature/list'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' }),
      commandSurface('appserver-config', 'Effective config', 'runtime', ['app-server', 'config/read'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' }),
      commandSurface('appserver-config-requirements', 'Config requirements', 'permissions', ['app-server', 'configRequirements/read'], 'app-server', 'none', false, 'settings', { featureId: 'sandbox' }),
      commandSurface('appserver-account', 'Account', 'usage', ['app-server', 'account/read'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' }),
      commandSurface('appserver-rate-limits', 'Rate limits', 'usage', ['app-server', 'account/rateLimits/read'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' }),
      commandSurface('appserver-auth-status', 'Auth status', 'runtime', ['app-server', 'getAuthStatus'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' }),
      commandSurface('appserver-skills', 'Skills', 'extensions', ['app-server', 'skills/list'], 'app-server', 'none', false, 'settings', { featureId: 'plugins' }),
      commandSurface('appserver-hooks', 'Hooks', 'extensions', ['app-server', 'hooks/list'], 'app-server', 'none', false, 'settings', { featureId: 'plugins' }),
      commandSurface('appserver-plugins', 'Plugins', 'extensions', ['app-server', 'plugin/list'], 'app-server', 'none', false, 'settings', { featureId: 'plugins' }),
      commandSurface('appserver-apps', 'Apps', 'extensions', ['app-server', 'app/list'], 'app-server', 'none', false, 'settings', { featureId: 'plugins' }),
      commandSurface('appserver-mcp-status', 'MCP status', 'mcp', ['app-server', 'mcpServerStatus/list'], 'app-server', 'none', false, 'settings', { featureId: 'mcp' }),
      commandSurface('appserver-external-agent-config', 'External agent configs', 'agents', ['app-server', 'externalAgentConfig/detect'], 'app-server', 'none', false, 'settings', { featureId: 'multi-agent' }),
      commandSurface('appserver-threads', 'Threads', 'runtime', ['app-server', 'thread/list'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' }),
      commandSurface('appserver-loaded-threads', 'Loaded threads', 'runtime', ['app-server', 'thread/loaded/list'], 'app-server', 'none', false, 'settings', { featureId: 'app-server' })
    ],
    slashCommands: [
      slashCommand('/review', 'Review uncommitted changes with Codex', 'provider', 'headless', 'insert-prompt', {
        featureId: 'review',
        prompt: 'Review the current uncommitted changes. Prioritize bugs, regressions, and missing tests.'
      }),
      slashCommand('/mcp', 'Open Codex MCP command flow', 'provider', 'interactive', 'send-to-provider', { featureId: 'mcp' }),
      slashCommand('/plugins', 'Open Codex plugin command flow', 'provider', 'interactive', 'send-to-provider', { featureId: 'plugins' }),
      slashCommand('/agents', 'Show Codex multi-agent activity', 'provider', 'interactive', 'send-to-provider', { featureId: 'multi-agent' })
    ]
  },
  cursor: {
    providerId: 'cursor',
    features: [
      feature('sdk-runtime', 'SDK runtime', 'runtime', 'partial', 'sdk', ['sdk'], 'Cloud auth works with the API key, but the local SDK stream still exits with an unmessaged ERROR before assistant text.'),
      feature('stream-json', 'Stream JSON', 'runtime', 'supported', 'adapter', ['headless']),
      feature('run-streaming', 'Run streaming', 'runtime', 'supported', 'sdk', ['sdk']),
      feature('ask-mode', 'Ask mode', 'permissions', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('plan-mode', 'Plan mode', 'permissions', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('sdk-plan-mode', 'Plan mode', 'permissions', 'supported', 'sdk', ['sdk']),
      feature('sandbox', 'Sandbox', 'permissions', 'supported', 'adapter', ['headless']),
      feature('sdk-local-sandbox', 'Local sandbox', 'permissions', 'partial', 'sdk', ['sdk'], 'SDK exposes local sandbox options but not Cursor CLI ask mode.'),
      feature('mcp', 'MCP', 'mcp', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('sdk-mcp', 'SDK MCP servers', 'mcp', 'partial', 'sdk', ['sdk'], 'SDK accepts stdio/http/sse MCP server configs; Orchestrator host tools still need a bridge process.'),
      feature('worktrees', 'Worktrees', 'workspace', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('sessions', 'Chats', 'runtime', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('sdk-sessions', 'Agents and runs', 'runtime', 'supported', 'sdk', ['sdk']),
      feature('rules', 'Rules', 'extensions', 'supported', 'local-cli', ['headless']),
      feature('bedrock', 'Bedrock', 'runtime', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('model-list', 'Models', 'usage', 'partial', 'local-cli', ['headless'], 'Local command can fail when keychain is unavailable.')
    ],
    gaps: [
      gap(
        'cursor-sdk-host-tools',
        'Orchestrator host tools for SDK',
        'mcp',
        'high',
        'partial',
        'Cursor SDK supports MCP server configs, but does not expose the in-process dynamic tool callback shape used by Codex app-server and Claude SDK.',
        'Add an Orchestrator stdio/http MCP bridge or adopt a native Cursor SDK tool callback if one becomes available.'
      ),
      gap(
        'cursor-sdk-local-stream',
        'SDK local stream exits before content',
        'runtime',
        'high',
        'blocked',
        'Live Cursor SDK runtime smoke starts an agent, then the local stream returns ERROR before assistant text or run completion. API-key auth itself succeeds.',
        'Keep Cursor SDK behind an experimental/runtime choice until Cursor exposes an HTTP/1.1 fallback or the local SDK transport succeeds on this machine.'
      ),
      gap(
        'cursor-keychain-models',
        'Model/status keychain failure',
        'runtime',
        'high',
        'blocked',
        'Cursor help works, but account-sensitive models/status/about probes can fail in this shell with keychain errors.',
        'Keep model probes optional, preserve manual model overrides, and surface keychain failure as auth/config rather than missing CLI.'
      ),
      gap(
        'cursor-worktree-ui',
        'Worktree controls',
        'workspace',
        'medium',
        'missing',
        'Cursor supports --worktree, --worktree-base, and --skip-worktree-setup, but the launch UI does not expose them.',
        'Add shared worktree launch controls and map them into Cursor buildStartCommand.'
      ),
      gap(
        'cursor-mcp-rules',
        'MCP and rules management',
        'mcp',
        'medium',
        'missing',
        'Cursor can list/enable/disable MCP tools and generate rules, but settings only expose generic capability chips.',
        'Add compact provider-specific MCP/rules actions backed by no-quota list/list-tools probes.'
      ),
      gap(
        'cursor-stream-deltas',
        'Partial stream deltas',
        'runtime',
        'low',
        'partial',
        'Cursor can stream partial output, but the adapter only reads complete stream-json events.',
        'Add fixture coverage for --stream-partial-output before enabling it in normal runs.'
      )
    ],
    probes: [
      probe('version', 'Version', ['--version'], 'version'),
      probe('help', 'Help', ['--help'], 'help'),
      probe('mcp-help', 'MCP', ['mcp', '--help'], 'mcp'),
      probe('create-chat-help', 'Create chat', ['create-chat', '--help'], 'features'),
      probe('models', 'Models', ['models'], 'models')
    ],
    commandSurfaces: [],
    slashCommands: [
      slashCommand('/plan', 'Switch the task into Cursor plan mode', 'provider', 'headless', 'insert-prompt', {
        featureId: 'plan-mode',
        prompt: 'Plan the requested change first. Do not edit files until I confirm the plan.'
      }),
      slashCommand('/mcp', 'Open Cursor MCP command flow', 'provider', 'interactive', 'send-to-provider', { featureId: 'mcp' }),
      slashCommand('/rules', 'Generate or update Cursor rules', 'provider', 'headless', 'insert-prompt', {
        featureId: 'rules',
        prompt: 'Generate or update project rules for Cursor based on this repository.'
      })
    ]
  }
}

function providerCapabilityRegistry(providerId: string): ProviderCapabilityRegistry {
  const registry = providerRegistries[providerId] ?? {
    providerId,
    features: [],
    gaps: [],
    probes: [probe('version', 'Version', ['--version'], 'version')],
    commandSurfaces: [],
    slashCommands: []
  }
  return {
    ...registry,
    slashCommands: registry.slashCommands.map((command) => withProviderId(providerId, command))
  }
}

function probeCommand(binary: string, args: string[], timeout = PROVIDER_PROBE_TIMEOUT_MS): { ok: boolean; output: string } {
  const result = probeCommandFull(binary, args, timeout)
  return {
    ok: result.ok,
    output: result.output.trim().split('\n')[0] ?? ''
  }
}

function stringifyCommandError(error: { stderr?: unknown; stdout?: unknown; message?: string }): string {
  const stderr = typeof error.stderr === 'string'
    ? error.stderr.trim()
    : Buffer.isBuffer(error.stderr)
      ? error.stderr.toString('utf8').trim()
      : ''
  const stdout = typeof error.stdout === 'string'
    ? error.stdout.trim()
    : Buffer.isBuffer(error.stdout)
      ? error.stdout.toString('utf8').trim()
      : ''
  return stderr || stdout || error.message || 'command failed'
}

function redactProviderCommandOutput(output: string): string {
  return output
    .replace(/(authorization:\s*bearer\s+)[^\s"'`]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/((?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|CURSOR_API_KEY)\s*=\s*)[^\s]+/g, '$1[redacted]')
}

function probeCommandFull(binary: string, args: string[], timeout = PROVIDER_PROBE_TIMEOUT_MS): { ok: boolean; output: string } {
  try {
    const output = execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout
    })
    return { ok: true, output: output.trim() }
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    return {
      ok: false,
      output: stringifyCommandError(err)
    }
  }
}

async function probeCommandFullAsync(binary: string, args: string[], timeout = PROVIDER_PROBE_TIMEOUT_MS): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout } = await execFileAsync(binary, args, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 512 * 1024
    })
    return { ok: true, output: String(stdout).trim() }
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    return {
      ok: false,
      output: stringifyCommandError(err)
    }
  }
}

async function probeCommandAsync(binary: string, args: string[], timeout = PROVIDER_PROBE_TIMEOUT_MS): Promise<{ ok: boolean; output: string }> {
  const result = await probeCommandFullAsync(binary, args, timeout)
  return {
    ok: result.ok,
    output: result.output.trim().split('\n')[0] ?? ''
  }
}

function versionArgs(providerId: string): string[] {
  return providerId === 'cursor' ? ['--version'] : ['--version']
}

function runProbeDefinitions(binary: string | null, definitions: ProviderProbeDefinition[]): ProviderProbeResult[] {
  return definitions
    .filter((definition) => definition.safeByDefault && definition.quota === 'none')
    .map((definition) => {
      if (!binary) {
        return { ...definition, status: 'missing', output: 'CLI binary was not found.' }
      }
      const result = probeCommand(binary, definition.args)
      return {
        ...definition,
        status: result.ok ? 'ok' : 'error',
        output: result.output
      }
    })
}

async function runProbeDefinitionsAsync(binary: string | null, definitions: ProviderProbeDefinition[]): Promise<ProviderProbeResult[]> {
  const safeDefinitions = definitions.filter((definition) => definition.safeByDefault && definition.quota === 'none')
  return Promise.all(safeDefinitions.map(async (definition) => {
    if (!binary) {
      return { ...definition, status: 'missing', output: 'CLI binary was not found.' }
    }
    const result = await probeCommandAsync(binary, definition.args)
    return {
      ...definition,
      status: result.ok ? 'ok' : 'error',
      output: result.output
    }
  }))
}

export function providerAuthFailureMessage(output: string): string | null {
  const firstLine = output.trim().split('\n')[0] ?? ''
  if (/authentication required|not logged in|login|api key|unauthorized|authentication_error|invalid authentication credentials|failed to authenticate/i.test(output)) {
    return firstLine || 'Provider authentication failed.'
  }
  if (/SecItemCopyMatching|keychain/i.test(output)) {
    return 'Keychain access failed in this process.'
  }
  return null
}

function authStatusFromProbe(providerId: string, probe: { ok: boolean; output: string }): ProviderDiagnosticInfo['auth'] {
  const authFailure = providerAuthFailureMessage(probe.output)
  if (authFailure) {
    return { status: 'error', message: authFailure }
  }
  if (/SecItemCopyMatching|keychain/i.test(probe.output)) {
    return { status: 'error', message: 'Keychain access failed in this process.' }
  }
  if (probe.ok && providerId === 'claude') {
    return { status: 'unknown', message: 'Version works; auth is verified by live smoke.' }
  }
  if (probe.ok) {
    return { status: 'unknown', message: 'CLI responds; auth is verified by live smoke.' }
  }
  return { status: 'unknown', message: 'Version probe failed before auth could be verified.' }
}

function authStatusFromProviderProbes(probes: ProviderProbeResult[]): ProviderDiagnosticInfo['auth'] | null {
  const authProbe = probes.find((probe) => providerAuthFailureMessage(probe.output) !== null)
  if (!authProbe) return null
  const message = providerAuthFailureMessage(authProbe.output) ?? 'Provider authentication failed.'
  return {
    status: 'error',
    message: `${authProbe.label}: ${message}`
  }
}

function usageStatus(providerId: string): ProviderDiagnosticInfo['usage'] {
  const messages: Record<string, string> = {
    claude: 'Claude Code CLI does not expose local quota usage through the current adapter.',
    codex: 'Codex CLI usage is not exposed through a local non-run probe yet.',
    copilot: 'GitHub Copilot CLI usage/quota is not exposed by the current prompt adapter.',
    cursor: 'Cursor Agent usage/quota is not exposed by the local CLI probe yet.'
  }
  return {
    status: 'unavailable',
    message: messages[providerId] ?? 'Usage/quota is not exposed by this provider adapter.'
  }
}

function providerSpecificDiagnostics(
  providerId: string,
  binary: string | null,
  fallbackAuth: ProviderDiagnosticInfo['auth'],
  fallbackModels: ProviderDiagnosticInfo['models']
): Pick<ProviderDiagnosticInfo, 'auth' | 'models'> {
  if (!binary || providerId !== 'cursor') {
    return { auth: fallbackAuth, models: fallbackModels }
  }

  const statusProbe = probeCommandFull(binary, ['status'])
  const modelsProbe = probeCommandFull(binary, ['models'])
  const auth: ProviderDiagnosticInfo['auth'] = statusProbe.ok && /Logged in as/i.test(statusProbe.output)
    ? { status: 'ok', message: statusProbe.output.split('\n')[0] ?? 'Logged in.' }
    : fallbackAuth
  const modelLines = modelsProbe.ok
    ? modelsProbe.output.split('\n').filter((line) => /^[^\s].+ - .+/.test(line))
    : []
  const models: ProviderDiagnosticInfo['models'] = modelsProbe.ok && modelLines.length > 0
    ? {
        status: 'available',
        count: modelLines.length,
        message: `${modelLines.length} models reported by Cursor Agent for this account.`
      }
    : fallbackModels

  return { auth, models }
}

async function providerSpecificDiagnosticsAsync(
  providerId: string,
  binary: string | null,
  fallbackAuth: ProviderDiagnosticInfo['auth'],
  fallbackModels: ProviderDiagnosticInfo['models']
): Promise<Pick<ProviderDiagnosticInfo, 'auth' | 'models'>> {
  if (!binary || providerId !== 'cursor') {
    return { auth: fallbackAuth, models: fallbackModels }
  }

  const [statusProbe, modelsProbe] = await Promise.all([
    probeCommandFullAsync(binary, ['status']),
    probeCommandFullAsync(binary, ['models'])
  ])
  const auth: ProviderDiagnosticInfo['auth'] = statusProbe.ok && /Logged in as/i.test(statusProbe.output)
    ? { status: 'ok', message: statusProbe.output.split('\n')[0] ?? 'Logged in.' }
    : fallbackAuth
  const modelLines = modelsProbe.ok
    ? modelsProbe.output.split('\n').filter((line) => /^[^\s].+ - .+/.test(line))
    : []
  const models: ProviderDiagnosticInfo['models'] = modelsProbe.ok && modelLines.length > 0
    ? {
        status: 'available',
        count: modelLines.length,
        message: `${modelLines.length} models reported by Cursor Agent for this account.`
      }
    : fallbackModels

  return { auth, models }
}

function policy(
  policyId: string,
  support: ResolvedExecutionPolicy['support'],
  args: string[],
  label: string,
  description: string,
  warning?: string,
  details: {
    intent?: PermissionIntent
    interaction?: PermissionInteraction
    controls?: PermissionRuntimeControl[]
    execution?: PermissionExecutionContract
  } = {}
): ResolvedExecutionPolicy {
  return { policy: policyId, support, args, label, description, warning, ...details }
}

export function codexRuntimePolicyConfig(policyId: string | undefined): PermissionExecutionContract {
  const policy = policyId ?? 'default'
  if (policy === 'never') {
    return { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxMode: 'workspace-write', configSource: 'mixed' }
  }
  if (policy === 'untrusted') {
    return { approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandboxMode: 'workspace-write', configSource: 'mixed' }
  }
  if (policy === 'autoReview') {
    return { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxMode: 'workspace-write', configSource: 'app-server' }
  }
  if (policy === 'fullAccess') {
    return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'danger-full-access', configSource: 'cli' }
  }
  if (policy === 'yolo') {
    return { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxMode: 'danger-full-access', configSource: 'cli' }
  }
  return { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxMode: 'workspace-write', configSource: 'mixed' }
}

type ProviderPermissionContextInput = {
  cwd?: string
  configResult?: ProviderCommandSurfaceResult
  requirementsResult?: ProviderCommandSurfaceResult
}

export function resolveProviderPermissionRuntimeContext(
  providerId: string,
  input: ProviderPermissionContextInput = {}
): ProviderPermissionRuntimeContext {
  const providerDef = PROVIDER_DEFS[providerId]
  const staticContext: ProviderPermissionRuntimeContext = {
    providerId,
    cwd: input.cwd,
    status: 'static',
    source: 'static',
    defaultPolicy: providerDef ? getProviderStaticDefaultPolicy(providerDef) : undefined,
    visiblePolicies: providerDef?.permissionModes.map((mode) => mode.id),
    summary: 'Using static provider permission modes.',
    updatedAt: Date.now()
  }
  if (!providerDef || providerId !== 'codex') return staticContext

  const configPayload = parseSurfaceJson(input.configResult)
  const requirementsPayload = parseSurfaceJson(input.requirementsResult)
  if (input.configResult?.status === 'error' || input.requirementsResult?.status === 'error') {
    return {
      ...staticContext,
      status: 'error',
      source: 'app-server',
      summary: input.requirementsResult?.output || input.configResult?.output || 'Codex app-server permission config is unavailable.'
    }
  }
  if (!configPayload && !requirementsPayload) {
    return {
      ...staticContext,
      status: input.configResult || input.requirementsResult ? 'unavailable' : 'static',
      source: input.configResult || input.requirementsResult ? 'app-server' : 'static',
      summary: input.configResult || input.requirementsResult
        ? 'Codex app-server did not return readable permission config.'
        : staticContext.summary
    }
  }

  const config = asRecord(asRecord(configPayload)?.config) ?? asRecord(configPayload) ?? {}
  const requirements = asRecord(asRecord(requirementsPayload)?.requirements) ?? asRecord(requirementsPayload) ?? {}
  const allowedApprovalPolicies = stringArrayValue(
    requirements.allowedApprovalPolicies,
    requirements.allowedApprovalPolicy,
    requirements.approvalPolicies,
    requirements.approval_policy,
    asRecord(requirements.approvalPolicy)?.allowed,
    asRecord(requirements.approval_policy)?.allowed
  )
  const allowedSandboxModes = stringArrayValue(
    requirements.allowedSandboxModes,
    requirements.allowedSandboxMode,
    requirements.sandboxModes,
    requirements.sandbox_mode,
    asRecord(requirements.sandboxMode)?.allowed,
    asRecord(requirements.sandbox_mode)?.allowed
  )
  const effective: PermissionExecutionContract = {
    approvalPolicy: stringValue(
      config.approvalPolicy,
      config.approval_policy,
      asRecord(config.approvalPolicy)?.value,
      asRecord(config.approval_policy)?.value
    ),
    approvalsReviewer: stringValue(
      config.approvalsReviewer,
      config.approvals_reviewer,
      asRecord(config.approvalsReviewer)?.value,
      asRecord(config.approvals_reviewer)?.value
    ),
    sandboxMode: stringValue(
      config.sandboxMode,
      config.sandbox_mode,
      config.sandbox,
      asRecord(config.sandboxMode)?.value,
      asRecord(config.sandbox_mode)?.value
    ),
    configSource: 'app-server'
  }
  const disabledPolicies = Object.fromEntries(
    providerDef.permissionModes
      .map((mode) => {
        const contract = codexRuntimePolicyConfig(mode.id)
        const approvalBlocked = allowedApprovalPolicies.length > 0 &&
          contract.approvalPolicy &&
          !allowedApprovalPolicies.includes(contract.approvalPolicy)
        if (approvalBlocked) return [mode.id, `Requires approval policy ${contract.approvalPolicy}`]
        const sandboxBlocked = allowedSandboxModes.length > 0 &&
          contract.sandboxMode &&
          !allowedSandboxModes.includes(contract.sandboxMode)
        if (sandboxBlocked) return [mode.id, `Requires sandbox ${contract.sandboxMode}`]
        return null
      })
      .filter((entry): entry is [string, string] => Boolean(entry))
  )
  const visiblePolicies = providerDef.permissionModes
    .map((mode) => mode.id)
    .filter((policyId) => !disabledPolicies[policyId])
  const defaultPolicy = findCodexPolicyForExecution(providerDef.permissionModes.map((mode) => mode.id), effective) ??
    (visiblePolicies.includes(providerDef.defaultPermissionMode ?? '') ? providerDef.defaultPermissionMode : undefined) ??
    visiblePolicies[0] ??
    getProviderStaticDefaultPolicy(providerDef)
  const requirementSummary = [
    allowedApprovalPolicies.length > 0 ? `${allowedApprovalPolicies.length} approval modes` : 'any approval mode',
    allowedSandboxModes.length > 0 ? `${allowedSandboxModes.length} sandbox modes` : 'any sandbox'
  ].join(', ')

  return {
    providerId,
    cwd: input.cwd,
    status: 'ok',
    source: 'app-server',
    defaultPolicy,
    visiblePolicies,
    disabledPolicies,
    effective,
    summary: `Codex app-server config loaded: ${requirementSummary}.`,
    updatedAt: Date.now()
  }
}

function getProviderStaticDefaultPolicy(providerDef: typeof PROVIDER_DEFS[string]): string {
  return providerDef.defaultPermissionMode && providerDef.permissionModes.some((mode) => mode.id === providerDef.defaultPermissionMode)
    ? providerDef.defaultPermissionMode
    : providerDef.permissionModes[0]?.id ?? 'default'
}

function parseSurfaceJson(result?: ProviderCommandSurfaceResult): Record<string, unknown> | undefined {
  if (!result || result.status !== 'ok') return undefined
  try {
    return JSON.parse(result.output) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function findCodexPolicyForExecution(policyIds: string[], effective: PermissionExecutionContract): string | undefined {
  if (!effective.approvalPolicy && !effective.sandboxMode && !effective.approvalsReviewer) return undefined
  return policyIds.find((policyId) => {
    const contract = codexRuntimePolicyConfig(policyId)
    if (effective.approvalPolicy && contract.approvalPolicy !== effective.approvalPolicy) return false
    if (effective.sandboxMode && contract.sandboxMode !== effective.sandboxMode) return false
    if (effective.approvalsReviewer && contract.approvalsReviewer !== effective.approvalsReviewer) return false
    return true
  })
}

const claudePermissionControls: PermissionRuntimeControl[] = [
  {
    kind: 'mode',
    label: 'Permission mode',
    description: 'Maps directly to Claude Code --permission-mode.',
    support: 'available',
    examples: ['default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions']
  },
  {
    kind: 'tool',
    label: 'Allowed tools',
    description: 'Persisted tool grants are passed with --allowedTools when resuming after approval.',
    support: 'available',
    examples: ['Read', 'Edit', 'Bash(git status)']
  },
  {
    kind: 'tool',
    label: 'Denied tools',
    description: 'Persisted tool denials are passed with --disallowedTools.',
    support: 'available',
    examples: ['Bash(git push)', 'WebFetch']
  },
  {
    kind: 'tool',
    label: 'Available tools',
    description: 'Claude supports --tools to restrict the built-in tool set for a run.',
    support: 'available',
    examples: ['default', 'Read,Edit,Bash']
  },
  {
    kind: 'path',
    label: 'Additional directories',
    description: 'Claude supports --add-dir for extra tool-access roots.',
    support: 'available',
    examples: ['--add-dir /tmp/shared']
  }
]

const copilotPermissionControls: PermissionRuntimeControl[] = [
  {
    kind: 'tool',
    label: 'Tool rules',
    description: 'Copilot supports --allow-tool, --deny-tool, --available-tools, and --excluded-tools.',
    support: 'available',
    examples: ['--allow-tool=write', '--deny-tool=shell(git push)', '--available-tools=shell,write']
  },
  {
    kind: 'path',
    label: 'Path rules',
    description: 'Copilot can add directories, allow all paths, or disallow temp directory access.',
    support: 'available',
    examples: ['--add-dir /tmp/project', '--allow-all-paths', '--disallow-temp-dir']
  },
  {
    kind: 'url',
    label: 'URL rules',
    description: 'Copilot can allow or deny protocol-aware URL/domain access.',
    support: 'available',
    examples: ['--allow-url=github.com', '--deny-url=https://example.com', '--allow-all-urls']
  },
  {
    kind: 'mcp',
    label: 'GitHub MCP tools',
    description: 'Copilot can expose selected GitHub MCP tools and external MCP configuration.',
    support: 'available',
    examples: ['--add-github-mcp-tool=*', '--additional-mcp-config @mcp.json']
  }
]

const codexPermissionControls: PermissionRuntimeControl[] = [
  {
    kind: 'sandbox',
    label: 'Sandbox',
    description: 'Codex exec supports read-only, workspace-write, and danger-full-access sandbox modes.',
    support: 'available',
    examples: ['--sandbox workspace-write', '--sandbox danger-full-access']
  },
  {
    kind: 'path',
    label: 'Additional directories',
    description: 'Codex can grant extra writable roots with --add-dir.',
    support: 'available',
    examples: ['--add-dir /tmp/shared']
  },
  {
    kind: 'mode',
    label: 'Interactive approvals',
    description: 'Codex approval policy supports untrusted, on-request, and never. Interactive CLI exposes this as --ask-for-approval; exec can receive config overrides.',
    support: 'available',
    examples: ['--ask-for-approval on-request', '--ask-for-approval untrusted', '-c approval_policy="never"']
  }
]

const cursorPermissionControls: PermissionRuntimeControl[] = [
  {
    kind: 'config',
    label: 'Permission config',
    description: 'Cursor supports allow/deny rules in CLI config files.',
    support: 'available',
    examples: ['Shell(git)', 'Read(src/**)', 'Write(docs/**)']
  },
  {
    kind: 'sandbox',
    label: 'Sandbox',
    description: 'Cursor Agent can explicitly enable or disable sandbox mode.',
    support: 'available',
    examples: ['--sandbox enabled', '--sandbox disabled']
  },
  {
    kind: 'mode',
    label: 'Plan / ask modes',
    description: 'Cursor supports read-only plan and ask modes as first-class execution modes.',
    support: 'available',
    examples: ['--mode plan', '--mode ask']
  }
]

function claudePolicy(policyId: string): ResolvedExecutionPolicy {
  if (['default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions'].includes(policyId)) {
    const intentByPolicy: Record<string, PermissionIntent> = {
      default: 'ask',
      acceptEdits: 'autoEdit',
      auto: 'autoEdit',
      dontAsk: 'workspaceSandbox',
      plan: 'plan',
      bypassPermissions: 'bypass'
    }
    return policy(
      policyId,
      'exact',
      ['--permission-mode', policyId],
      policyId,
      'Uses Claude Code permission mode directly.',
      undefined,
      {
        intent: intentByPolicy[policyId] ?? 'custom',
        interaction: 'structured',
        controls: claudePermissionControls,
        execution: {
          nativeMode: policyId,
          configSource: 'cli'
        }
      }
    )
  }
  if (policyId === 'yolo') {
    return policy(
      policyId,
      'approximate',
      ['--dangerously-skip-permissions'],
      'Bypass permissions',
      'Skips Claude Code permission prompts.',
      'This maps to Claude Code dangerous skip mode, not a sandboxed approval mode.',
      {
        intent: 'bypass',
        interaction: 'structured',
        controls: claudePermissionControls,
        execution: {
          nativeMode: 'dangerously-skip-permissions',
          sandboxMode: 'none',
          configSource: 'cli'
        }
      }
    )
  }
  return policy(policyId, 'unsupported', [], policyId, 'Claude Code does not support this policy.', undefined, {
    intent: 'custom',
    interaction: 'none',
    controls: claudePermissionControls,
    execution: {
      nativeMode: 'unsupported',
      configSource: 'cli'
    }
  })
}

export function normalizeClaudeMessageObject(event: Record<string, unknown>, providerId = 'claude'): RunEvent[] {
  const events: RunEvent[] = []
  const type = event.type as string | undefined
  const sessionId = stringValue(event.sessionId, event.session_id)
  const sidechainAgentId = event.isSidechain === true
    ? stringValue(event.agentId, event.agent_id)
    : undefined
  const parentToolUseId = stringValue(event.parent_tool_use_id) ?? sidechainAgentId

  if (type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
    events.push({ type: 'session.started', providerSessionId: event.session_id })
  }

  if (type === 'permission-mode' && typeof event.sessionId === 'string') {
    events.push({ type: 'session.started', providerSessionId: event.sessionId })
  }

  if (type === 'system' && event.subtype === 'api_retry' && event.error === 'authentication_failed') {
    const attempt = typeof event.attempt === 'number' ? `attempt ${event.attempt}` : 'retry'
    events.push({
      type: 'run.failed',
      content: `Claude authentication failed during ${attempt}. Check the configured apiKeyHelper or Claude auth.`
    })
  }

  const taskEvent = type === 'system'
    ? claudeAgentEventFromTaskSystemEvent(providerId, sessionId, event)
    : null
  if (taskEvent) {
    events.push(taskEvent)
    if (taskEvent.type === 'agent.completed' || taskEvent.type === 'agent.failed') {
      anthropicTaskAgents.delete(taskEvent.agent.id)
    }
  }

  if (type === 'system' && event.subtype === 'turn_duration') {
    events.push({ type: 'run.completed' })
  }

  if (type === 'stream_event') {
    events.push(...claudePartialEventFromStreamEvent(providerId, sessionId, parentToolUseId, event))
  }

  if (type === 'assistant') {
    const message = asRecord(event.message)
    const messageId = stringValue(message?.id)
    const hasPartialText = Boolean(messageId && anthropicPartialMessageIds.has(messageId))
    for (const text of textFromContentBlocks(message?.content)) {
      if (parentToolUseId && !hasPartialText) {
        const streamId = `${messageId ?? event.uuid ?? parentToolUseId}:final`
        events.push({ type: 'agent.text.delta', agentId: parentToolUseId, streamId, content: text })
        events.push({ type: 'agent.text.completed', agentId: parentToolUseId, streamId })
      } else if (!hasPartialText) {
        events.push({ type: 'assistant.text', content: text })
      }
    }
    const content = Array.isArray(message?.content) ? message.content : []
    for (const block of content) {
      const rec = asRecord(block)
      if (rec?.type === 'tool_use') {
        if (rec.name === 'SendUserMessage') {
          const input = asRecord(rec.input) ?? {}
          const content = stringValue(input.message, input.text, input.content, input.summary)
          if (content) {
            events.push({ type: 'assistant.status', content })
            continue
          }
        }
        if (rec.name === 'AskUserQuestion') {
          const userInputRequest = userInputFromAskUserQuestionTool(rec.input)
          if (userInputRequest) {
            if (typeof rec.id === 'string') anthropicUserQuestionToolIds.add(rec.id)
            events.push({ type: 'user_input.requested', ...userInputRequest })
            continue
          }
        }
        if ((rec.name === 'Task' || rec.name === 'Agent') && typeof rec.id === 'string') {
          const input = asRecord(rec.input) ?? {}
          const agent = {
            providerId,
            sessionId: sessionId ?? '',
            name: stringValue(input.subagent_type, input.agent, input.name, input.description),
            role: stringValue(input.description, input.prompt),
            model: stringValue(input.model)
          }
          anthropicTaskAgents.set(rec.id, agent)
          events.push({
            type: 'agent.started',
            agent: {
              id: rec.id,
              providerId,
              sessionId: agent.sessionId,
              name: agent.name,
              role: agent.role,
              model: agent.model,
              providerItemId: rec.id,
              parentThreadId: sessionId,
              source: 'provider-event',
              status: 'running'
            }
          })
        }
        if (rec.name === 'TodoWrite' || rec.name === 'EnterPlanMode' || rec.name === 'ExitPlanMode') {
          const toolName = typeof rec.name === 'string' ? rec.name : ''
          const input = asRecord(rec.input) ?? {}
          if (toolName === 'ExitPlanMode' && typeof rec.id === 'string') {
            anthropicPlanConfirmationToolIds.add(rec.id)
          }
          const items = toolName === 'TodoWrite' ? planItemsFromTodos(input) : []
          events.push({
            type: 'plan.updated',
            plan: {
              providerId,
              sessionId: sessionId ?? '',
              mode: planModeFromTool(toolName),
              title: toolName === 'TodoWrite' ? 'Tasks' : undefined,
              summary: stringValue(input.plan, input.summary, input.description),
              items
            }
          })
        }
        events.push({
          type: 'tool.started',
          id: typeof rec.id === 'string' ? rec.id : uuidv4(),
          toolName: typeof rec.name === 'string' ? rec.name : 'unknown',
          toolInput: asRecord(rec.input) ?? {}
        })
      }
    }
  }

  if (type === 'user') {
    const message = asRecord(event.message)
    const content = Array.isArray(message?.content) ? message.content : []
    for (const block of content) {
      const rec = asRecord(block)
      if (rec?.type === 'tool_result') {
        const toolUseId = typeof rec.tool_use_id === 'string' ? rec.tool_use_id : ''
        if (toolUseId && anthropicUserQuestionToolIds.has(toolUseId)) {
          anthropicUserQuestionToolIds.delete(toolUseId)
          continue
        }
        if (toolUseId && anthropicPlanConfirmationToolIds.has(toolUseId)) {
          anthropicPlanConfirmationToolIds.delete(toolUseId)
          continue
        }
        if (
          toolUseId &&
          rec.is_error === true &&
          /requested permissions?|haven't granted/i.test(stringifyContent(rec.content))
        ) {
          continue
        }
        const taskAgent = toolUseId ? anthropicTaskAgents.get(toolUseId) : undefined
        if (taskAgent) {
          anthropicTaskAgents.delete(toolUseId)
          const providerAgentId = claudeAgentIdFromContent(rec.content)
          events.push({
            type: rec.is_error === true ? 'agent.failed' : 'agent.completed',
            agent: {
              id: toolUseId,
              providerId: taskAgent.providerId,
              sessionId: taskAgent.sessionId,
              name: taskAgent.name,
              role: taskAgent.role,
              model: taskAgent.model,
              providerAgentId,
              providerItemId: toolUseId,
              parentThreadId: taskAgent.sessionId,
              source: 'provider-event',
              status: rec.is_error === true ? 'failed' : 'completed',
              summary: stringifyContent(rec.content)
            }
          })
        }
        const userInputRequest = parseStructuredUserInputRequest(rec.content)
        if (userInputRequest) {
          events.push({ type: 'user_input.requested', ...userInputRequest })
          continue
        }
        events.push({
          type: 'tool.completed',
          id: uuidv4(),
          toolUseId,
          content: stringifyContent(rec.content),
          isError: rec.is_error === true
        })
      }
    }
  }

  if (type === 'result') {
    const usage = usageSummaryFromAnthropicResult(event)
    const denials = Array.isArray(event.permission_denials)
      ? event.permission_denials as PermissionDenial[]
      : []
    if (denials.length > 0) {
      const askUserDenial = denials.find((denial) => denial.tool_name === 'AskUserQuestion')
      const userInputRequest = askUserDenial
        ? userInputFromAskUserQuestionTool(askUserDenial.tool_input)
        : null
      if (userInputRequest) {
        if (typeof askUserDenial?.tool_use_id === 'string') anthropicUserQuestionToolIds.add(askUserDenial.tool_use_id)
        events.push({ type: 'user_input.requested', ...userInputRequest })
        return events
      }
      const planDenial = denials.find((denial) => denial.tool_name === 'ExitPlanMode')
      if (planDenial) {
        const planInput = asRecord(planDenial.tool_input) ?? {}
        events.push({
          type: 'plan.updated',
          plan: {
            providerId,
            sessionId: sessionId ?? '',
            mode: 'plan',
            summary: stringValue(planInput.plan, planInput.summary, event.result) ?? 'Plan confirmation required',
            items: []
          }
        })
      }
      events.push({
        type: 'permission.requested',
        content: typeof event.result === 'string' ? event.result : undefined,
        denials
      })
    } else if (event.subtype === 'success' || event.is_error === false) {
      events.push({ type: 'run.completed', content: typeof event.result === 'string' ? event.result : undefined, usage })
    } else {
      events.push({ type: 'run.failed', content: typeof event.result === 'string' ? event.result : undefined, usage })
    }
  }

  return events
}

function parseAnthropicStyleLine(line: string, providerId = 'claude'): RunEvent[] {
  const cleanLine = stripAnsi(line).trim()
  const event = parseJsonLine(cleanLine)
  if (!event) {
    if (/apiKeyHelper failed|authentication_failed/i.test(cleanLine)) {
      return [{ type: 'run.failed', content: cleanLine }]
    }
    return []
  }

  return normalizeClaudeMessageObject(event, providerId)
}

// Claude Code

const claudeProvider: ProviderAdapter = {
  id: 'claude',
  binary: 'claude',
  binaryCandidates: [
    'claude',
    join(homedir(), '.local/bin/claude')
  ],
  capabilities: {
    resume: true,
    streamingJson: true,
    interactiveCli: false,
    interactivePermissions: true,
    allowedTools: true,
    workspaceSandbox: false,
    fullAccessMode: true,
    checkpointUndo: false
  },

  resolveExecutionPolicy: claudePolicy,

  parseOutputLine: parseAnthropicStyleLine
}

// GitHub Copilot CLI

function copilotPolicy(policyId: string): ResolvedExecutionPolicy {
  if (policyId === 'yolo') {
    return policy(
      policyId,
      'exact',
      ['--yolo'],
      'Auto',
      'Enables all Copilot tool, path, and URL permissions.',
      undefined,
      {
        intent: 'bypass',
        interaction: 'headless',
        controls: copilotPermissionControls,
        execution: {
          nativeMode: 'yolo',
          toolPolicy: 'all tools, paths, and URLs',
          configSource: 'cli'
        }
      }
    )
  }
  const intent = policyId === 'allowEdits' ? 'autoEdit' : 'ask'
  return policy(
    policyId,
    'forced',
    ['--allow-all-tools'],
    'Programmatic all-tools',
    'Copilot requires all tools to be auto-allowed for programmatic prompt mode.',
    'This is broader than the selected permission intent.',
    {
      intent,
      interaction: 'headless',
      controls: copilotPermissionControls,
      execution: {
        nativeMode: 'programmatic',
        toolPolicy: 'forced all tools',
        configSource: 'cli'
      }
    }
  )
}

const copilotProvider: ProviderAdapter = {
  id: 'copilot',
  binary: 'copilot',
  binaryCandidates: [
    'copilot',
    join(homedir(), '.local/bin/copilot')
  ],
  capabilities: {
    resume: true,
    streamingJson: true,
    interactiveCli: true,
    interactivePermissions: true,
    allowedTools: true,
    workspaceSandbox: false,
    fullAccessMode: true,
    checkpointUndo: false,
    forcedAllTools: true
  },

  resolveExecutionPolicy: copilotPolicy,

  buildStartCommand(request) {
    const args = ['-p', request.prompt, '--output-format', 'json']
    args.push(...resolvedPolicyArgs(this, request.executionPolicy || 'default'))
    if (request.providerSessionId) args.push(`--resume=${request.providerSessionId}`)
    args.push('--model', request.model || 'claude-sonnet-4.6')
    if (request.effort) args.push('--effort', request.effort)
    return command(this.binary, args)
  },

  buildResumeCommand(request) {
    return this.buildStartCommand!({ ...request, prompt: request.prompt || 'Please continue.' })
  },

  buildInteractiveCommand(request) {
    const args: string[] = []
    if (request.model) args.push('--model', request.model)
    if (request.effort) args.push('--effort', request.effort)
    if (request.executionPolicy === 'yolo') {
      args.push('--allow-all')
    } else if (request.executionPolicy === 'allowEdits') {
      args.push('--allow-tool=write')
    }
    if (request.prompt) args.push('-i', request.prompt)
    return command(this.binary, args)
  },

  parseOutputLine(line) {
    const obj = parseJsonLine(line)
    if (!obj) return []

    const events: RunEvent[] = []
    const type = obj.type as string | undefined
    const data = asRecord(obj.data)

    if (
      type === 'user_input.requested' ||
      type === 'elicitation.requested' ||
      type === 'elicitation' ||
      type === 'input.requested'
    ) {
      const userInput = userInputFromGenericPayload(data ?? obj)
      if (userInput) events.push({ type: 'user_input.requested', ...userInput })
    }

    if (
      type === 'permission.requested' ||
      type === 'approval.requested' ||
      type === 'tool.permission.requested'
    ) {
      const permission = permissionRequestFromGenericPayload(data ?? obj)
      if (permission) events.push(permission)
    }

    if (type === 'result') {
      const sessionId = typeof obj.sessionId === 'string'
        ? obj.sessionId
        : typeof obj.session_id === 'string'
          ? obj.session_id
          : undefined
      if (sessionId) events.push({ type: 'session.started', providerSessionId: sessionId })
      const exitCode = typeof obj.exitCode === 'number' ? obj.exitCode : 0
      const failureContent = stringifyContent(obj.error ?? obj.message ?? '')
      events.push(exitCode === 0 ? { type: 'run.completed' } : { type: 'run.failed', content: failureContent })
    }

    if (type === 'assistant.message' && data) {
      if (typeof data.content === 'string') {
        events.push({ type: 'assistant.text', content: data.content })
      }
      const toolRequests = Array.isArray(data.toolRequests) ? data.toolRequests : []
      for (const req of toolRequests) {
        const rec = asRecord(req)
        if (!rec) continue
        events.push({
          type: 'tool.started',
          id: typeof rec.toolCallId === 'string' ? rec.toolCallId : uuidv4(),
          toolName: typeof rec.name === 'string' ? rec.name : 'unknown',
          toolInput: asRecord(rec.arguments) ?? {}
        })
      }
    }

    if (type === 'tool.execution_complete' && data) {
      const result = asRecord(data.result)
      events.push({
        type: 'tool.completed',
        id: uuidv4(),
        toolUseId: typeof data.toolCallId === 'string' ? data.toolCallId : uuidv4(),
        content: stringifyContent(result?.detailedContent ?? result?.content),
        isError: data.success === false
      })
    }

    if (type?.startsWith('subagent.') || type?.startsWith('agent.')) {
      const agentEvent = agentEventFromProviderPayload(
        'copilot',
        stringValue(obj.sessionId, obj.session_id),
        type,
        data ?? obj,
        typeof obj.id === 'string' ? obj.id : uuidv4()
      )
      if (agentEvent) events.push(agentEvent)
    }

    return events
  }
}

// OpenAI Codex CLI

function codexPolicy(policyId: string): ResolvedExecutionPolicy {
  const approvalPolicyById: Record<string, { value: string; label: string; intent: PermissionIntent; description: string }> = {
    default: {
      value: 'on-request',
      label: 'Ask',
      intent: 'ask',
      description: 'Uses Codex approval policy on-request with workspace sandboxing.'
    },
    onRequest: {
      value: 'on-request',
      label: 'Ask',
      intent: 'ask',
      description: 'Uses Codex approval policy on-request with workspace sandboxing.'
    },
    untrusted: {
      value: 'untrusted',
      label: 'Trusted',
      intent: 'ask',
      description: 'Runs trusted commands without asking and asks for untrusted commands.'
    },
    never: {
      value: 'never',
      label: 'Never',
      intent: 'workspaceSandbox',
      description: 'Never asks for approval; execution failures are returned to the model.'
    }
  }
  const approvalPolicy = approvalPolicyById[policyId]
  if (approvalPolicy) {
    return policy(
      policyId,
      'approximate',
      ['--sandbox', 'workspace-write', '-c', `approval_policy="${approvalPolicy.value}"`],
      approvalPolicy.label,
      approvalPolicy.description,
      'Codex app-server surfaces native approvals in Orchestrator; codex exec still receives the same policy as config for headless automation.',
      {
        intent: approvalPolicy.intent,
        interaction: 'structured',
        controls: codexPermissionControls,
        execution: codexRuntimePolicyConfig(policyId)
      }
    )
  }
  if (policyId === 'autoReview') {
    return policy(
      policyId,
      'approximate',
      ['--sandbox', 'workspace-write', '-c', 'approval_policy="on-request"', '-c', 'approvals_reviewer="auto_review"'],
      'Auto-review',
      'Routes approval requests through Codex auto-review while keeping workspace sandboxing.',
      'Available through the Codex app-server runtime; use live approval-producing runs before promoting it to the default mode.',
      {
        intent: 'ask',
        interaction: 'structured',
        controls: codexPermissionControls,
        execution: codexRuntimePolicyConfig(policyId)
      }
    )
  }
  if (policyId === 'yolo') {
    return policy(
      policyId,
      'exact',
      ['--dangerously-bypass-approvals-and-sandbox'],
      'Bypass all',
      'Bypasses Codex approvals and sandboxing.',
      undefined,
      {
        intent: 'bypass',
        interaction: 'headless',
        controls: codexPermissionControls,
        execution: codexRuntimePolicyConfig(policyId)
      }
    )
  }
  if (policyId === 'fullAccess') {
    return policy(
      policyId,
      'exact',
      ['--sandbox', 'danger-full-access'],
      'Full access',
      'Runs without workspace sandbox limits.',
      undefined,
      {
        intent: 'fullAccess',
        interaction: 'headless',
        controls: codexPermissionControls,
        execution: codexRuntimePolicyConfig(policyId)
      }
    )
  }
  return policy(policyId, 'unsupported', [], policyId, 'Codex does not support this policy in exec mode.', undefined, {
    intent: 'custom',
    interaction: 'none',
    controls: codexPermissionControls,
    execution: {
      nativeMode: 'unsupported',
      configSource: 'mixed'
    }
  })
}

function codexBaseArgs(request: RunRequest): string[] {
  const args = ['--json', '--skip-git-repo-check']
  const resolved = codexPolicy(request.executionPolicy || 'default')
  args.push(...(resolved.support === 'unsupported' ? codexPolicy('default').args : resolved.args))
  args.push('--model', request.model || 'gpt-5.4')
  if (request.effort) args.push('-c', `model_reasoning_effort="${request.effort}"`)
  return args
}

function parseCodexItem(item: Record<string, unknown>): RunEvent[] {
  const itemType = item.type as string | undefined
  if (
    itemType === 'user_input.requested' ||
    itemType === 'mcp_elicitation_request' ||
    itemType === 'mcp.elicitation.requested' ||
    itemType === 'tool_call_mcp_elicitation' ||
    itemType === 'elicitation.requested'
  ) {
    const userInput = userInputFromGenericPayload(item)
    return userInput ? [{ type: 'user_input.requested', ...userInput }] : []
  }

  if (
    itemType === 'permission.requested' ||
    itemType === 'approval.requested' ||
    itemType === 'exec.approval.requested'
  ) {
    const permission = permissionRequestFromGenericPayload(item)
    return permission ? [permission] : []
  }

  if (itemType === 'agent_message') {
    const text = typeof item.text === 'string'
      ? item.text
      : typeof item.message === 'string'
        ? item.message
        : undefined
    return text ? [{ type: 'assistant.text', content: text }] : []
  }

  if (itemType === 'command_execution') {
    const id = typeof item.id === 'string' ? item.id : uuidv4()
    const commandText = typeof item.command === 'string' ? item.command : ''
    if (item.status === 'in_progress') {
      return [{ type: 'tool.started', id, toolName: 'shell', toolInput: { command: commandText } }]
    }
    return [{
      type: 'tool.completed',
      id: uuidv4(),
      toolUseId: id,
      content: stringifyContent(item.output ?? item.result ?? ''),
      isError: item.status === 'failed'
    }]
  }

  if (itemType === 'function_call' || itemType === 'mcp_tool_call') {
    return [{
      type: 'tool.started',
      id: typeof item.id === 'string' ? item.id : uuidv4(),
      toolName: typeof item.name === 'string' ? item.name : itemType,
      toolInput: asRecord(item.arguments ?? item.input) ?? {}
    }]
  }

  return []
}

function codexAppServerUserInput(params: Record<string, unknown>): RunEvent | null {
  const questions = Array.isArray(params.questions) ? params.questions : []
  const parsedQuestions: UserInputQuestion[] = questions.flatMap((question) => {
    const rec = asRecord(question)
    const questionText = stringValue(rec?.question, rec?.message, rec?.prompt)
    if (!rec || !questionText) return []
    const options = Array.isArray(rec.options)
      ? rec.options.flatMap((option) => {
          const opt = asRecord(option)
          const label = typeof option === 'string' ? option : stringValue(opt?.label, opt?.name, opt?.value)
          return label
            ? [{ label, description: stringValue(opt?.description, opt?.detail) }]
            : []
        })
      : undefined
    return [{
      id: stringValue(rec.id),
      question: questionText,
      header: stringValue(rec.header, rec.title),
      options: options && options.length > 0 ? options : undefined,
      multiSelect: rec.multiSelect === true || rec.multiselect === true,
      isOther: rec.isOther === true,
      isSecret: rec.isSecret === true
    }]
  })

  if (parsedQuestions.length === 0) return null
  return {
    type: 'user_input.requested',
    content: parsedQuestions.map((question) => question.question).join('\n'),
    questions: parsedQuestions
  }
}

function codexAppServerMcpElicitation(params: Record<string, unknown>): RunEvent | null {
  const message = stringValue(params.message)
  if (!message) return null
  return {
    type: 'user_input.requested',
    content: message,
    questions: [{
      question: message,
      header: stringValue(params.serverName, params.mode)
    }]
  }
}

function codexAppServerPermissionRequest(
  method: string,
  requestId: string | undefined,
  params: Record<string, unknown>
): RunEvent | null {
  if (method === 'item/commandExecution/requestApproval') {
    const toolUseId = stringValue(params.approvalId, params.itemId, requestId) ?? uuidv4()
    const command = stringValue(params.command)
    return {
      type: 'permission.requested',
      content: stringValue(params.reason) ?? (command ? `Approve command: ${command}` : 'Approve command?'),
      denials: [{
        tool_name: 'shell',
        tool_use_id: toolUseId,
        tool_input: compactToolInput({
          command,
          cwd: stringValue(params.cwd),
          reason: stringValue(params.reason),
          commandActions: params.commandActions,
          proposedExecpolicyAmendment: params.proposedExecpolicyAmendment,
          proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments
        })
      }]
    }
  }

  if (method === 'execCommandApproval') {
    const toolUseId = stringValue(params.approvalId, params.callId, requestId) ?? uuidv4()
    const rawCommand = Array.isArray(params.command) ? params.command.filter((part): part is string => typeof part === 'string') : []
    const command = rawCommand.join(' ')
    return {
      type: 'permission.requested',
      content: stringValue(params.reason) ?? (command ? `Approve command: ${command}` : 'Approve command?'),
      denials: [{
        tool_name: 'shell',
        tool_use_id: toolUseId,
        tool_input: compactToolInput({
          command,
          cwd: stringValue(params.cwd),
          reason: stringValue(params.reason),
          parsedCmd: params.parsedCmd
        })
      }]
    }
  }

  if (method === 'item/fileChange/requestApproval') {
    const toolUseId = stringValue(params.itemId, requestId) ?? uuidv4()
    return {
      type: 'permission.requested',
      content: stringValue(params.reason) ?? 'Approve file change?',
      denials: [{
        tool_name: 'write',
        tool_use_id: toolUseId,
        tool_input: compactToolInput({
          reason: stringValue(params.reason),
          grantRoot: stringValue(params.grantRoot)
        })
      }]
    }
  }

  if (method === 'applyPatchApproval') {
    const toolUseId = stringValue(params.callId, requestId) ?? uuidv4()
    return {
      type: 'permission.requested',
      content: stringValue(params.reason) ?? 'Approve patch?',
      denials: [{
        tool_name: 'apply_patch',
        tool_use_id: toolUseId,
        tool_input: compactToolInput({
          reason: stringValue(params.reason),
          grantRoot: stringValue(params.grantRoot),
          fileChanges: params.fileChanges
        })
      }]
    }
  }

  if (method === 'item/permissions/requestApproval') {
    const toolUseId = stringValue(params.itemId, requestId) ?? uuidv4()
    return {
      type: 'permission.requested',
      content: stringValue(params.reason) ?? 'Approve additional permissions?',
      denials: [{
        tool_name: 'permissions',
        tool_use_id: toolUseId,
        tool_input: compactToolInput({
          cwd: stringValue(params.cwd),
          reason: stringValue(params.reason),
          permissions: params.permissions
        })
      }]
    }
  }

  return null
}

function contentItemsText(value: unknown): string {
  if (!Array.isArray(value)) return stringifyContent(value)
  return value.map((item) => {
    const rec = asRecord(item)
    if (!rec) return stringifyContent(item)
    return stringValue(rec.text, rec.imageUrl, rec.type) ?? stringifyContent(rec)
  }).filter(Boolean).join('\n')
}

function parseCodexAppServerItem(
  item: Record<string, unknown>,
  phase?: 'started' | 'completed',
  params: Record<string, unknown> = {}
): RunEvent[] {
  const itemType = stringValue(item.type)
  if (itemType === 'agentMessage') {
    const text = stringValue(item.text)
    return text ? [{ type: 'assistant.text', content: text }] : []
  }

  if (itemType === 'plan') {
    const text = stringValue(item.text)
    return text ? [{ type: 'assistant.status', content: `Plan: ${text}` }] : []
  }

  if (itemType === 'reasoning') {
    const summary = Array.isArray(item.summary) ? item.summary.filter((part): part is string => typeof part === 'string') : []
    const content = Array.isArray(item.content) ? item.content.filter((part): part is string => typeof part === 'string') : []
    const text = summary.join('\n') || content.join('\n')
    return text ? [{ type: 'assistant.status', content: `Reasoning: ${text}` }] : []
  }

  if (itemType === 'hookPrompt') {
    const id = stringValue(item.id) ?? uuidv4()
    return [{
      type: phase === 'completed' ? 'tool.completed' : 'tool.started',
      ...(phase === 'completed'
        ? { id: uuidv4(), toolUseId: id, content: stringifyContent(item.fragments ?? ''), isError: false }
        : { id, toolName: 'hook', toolInput: { fragments: item.fragments ?? [] } })
    } as RunEvent]
  }

  if (itemType === 'commandExecution') {
    const id = stringValue(item.id) ?? uuidv4()
    const commandText = stringValue(item.command) ?? ''
    const status = stringValue(item.status)
    if (status === 'inProgress') {
      return [{ type: 'tool.started', id, toolName: 'shell', toolInput: { command: commandText, cwd: stringValue(item.cwd) } }]
    }
    return [{
      type: 'tool.completed',
      id: uuidv4(),
      toolUseId: id,
      content: stringifyContent(item.aggregatedOutput ?? ''),
      isError: status === 'failed' || status === 'declined'
    }]
  }

  if (itemType === 'mcpToolCall' || itemType === 'dynamicToolCall') {
    const id = stringValue(item.id) ?? uuidv4()
    const status = stringValue(item.status)
    const toolName = itemType === 'mcpToolCall'
      ? [stringValue(item.server), stringValue(item.tool)].filter(Boolean).join('.') || 'mcpToolCall'
      : stringValue(item.tool) ?? 'dynamicToolCall'
    if (status === 'inProgress') {
      return [{ type: 'tool.started', id, toolName, toolInput: asRecord(item.arguments) ?? {} }]
    }
    return [{
      type: 'tool.completed',
      id: uuidv4(),
      toolUseId: id,
      content: itemType === 'dynamicToolCall'
        ? contentItemsText(item.contentItems ?? item.error ?? '')
        : stringifyContent(item.result ?? item.error ?? ''),
      isError: status === 'failed' || item.error != null
    }]
  }

  if (itemType === 'fileChange') {
    const id = stringValue(item.id) ?? uuidv4()
    const status = stringValue(item.status)
    if (status === 'inProgress') {
      return [{ type: 'tool.started', id, toolName: 'apply_patch', toolInput: { changes: item.changes ?? [] } }]
    }
    return [{
      type: 'tool.completed',
      id: uuidv4(),
      toolUseId: id,
      content: stringifyContent(item.changes ?? ''),
      isError: status === 'failed' || status === 'declined'
    }]
  }

  if (itemType === 'collabAgentToolCall') {
    const id = stringValue(item.id) ?? uuidv4()
    const status = normalizeAgentStatus(stringValue(item.status))
    const receiverThreadIds = stringArrayValue(item.receiverThreadIds)
    const receiverThreads = Array.isArray(item.receiverThreads)
      ? item.receiverThreads.flatMap((thread): NonNullable<AgentNode['receiverThreads']> => {
        const rec = asRecord(thread)
        const threadId = stringValue(rec?.id, rec?.threadId, rec?.thread_id)
        if (!threadId) return []
        return [{
          id: threadId,
          title: stringValue(rec?.title, rec?.name),
          status: stringValue(rec?.status),
          providerId: 'codex',
          sessionId: threadId,
          raw: rec
        }]
      })
      : []
    const providerThreadId = stringValue(item.providerThreadId, item.threadId) ?? receiverThreadIds[0] ?? receiverThreads[0]?.id
    const parentThreadId = stringValue(item.senderThreadId, params.threadId)
    const eventType = status === 'completed'
      ? 'agent.completed'
      : status === 'failed'
        ? 'agent.failed'
        : status === 'cancelled'
          ? 'agent.failed'
          : 'agent.started'
    return [{
      type: eventType,
      agent: {
        id,
        providerId: 'codex',
        sessionId: parentThreadId ?? '',
        providerAgentId: providerThreadId,
        providerItemId: id,
        providerThreadId,
        parentThreadId,
        childThreadIds: receiverThreadIds,
        receiverThreadIds,
        receiverThreads,
        providerTurnId: stringValue(params.turnId, item.turnId),
        reasoningEffort: stringValue(item.reasoningEffort),
        source: providerThreadId ? 'provider-thread' : 'provider-event',
        name: stringValue(asRecord(item.tool)?.type, item.tool),
        role: stringValue(item.prompt),
        status,
        model: stringValue(item.model)
      }
    } as RunEvent]
  }

  if (itemType === 'webSearch') {
    const id = stringValue(item.id) ?? uuidv4()
    const query = stringValue(item.query) ?? ''
    if (phase === 'started') {
      return [{ type: 'tool.started', id, toolName: 'web_search', toolInput: { query, action: item.action ?? null } }]
    }
    return [{ type: 'tool.completed', id: uuidv4(), toolUseId: id, content: stringifyContent(item.action ?? query), isError: false }]
  }

  if (itemType === 'imageView') {
    const id = stringValue(item.id) ?? uuidv4()
    if (phase === 'started') return [{ type: 'tool.started', id, toolName: 'image_view', toolInput: { path: stringValue(item.path) } }]
    return [{ type: 'tool.completed', id: uuidv4(), toolUseId: id, content: stringValue(item.path) ?? '', isError: false }]
  }

  if (itemType === 'imageGeneration') {
    const id = stringValue(item.id) ?? uuidv4()
    const status = stringValue(item.status)
    if (phase === 'started' || status === 'inProgress') {
      return [{ type: 'tool.started', id, toolName: 'image_generation', toolInput: { revisedPrompt: stringValue(item.revisedPrompt) } }]
    }
    return [{
      type: 'tool.completed',
      id: uuidv4(),
      toolUseId: id,
      content: stringifyContent(item.savedPath ?? item.result ?? item.revisedPrompt ?? ''),
      isError: status === 'failed'
    }]
  }

  if (itemType === 'enteredReviewMode' || itemType === 'exitedReviewMode') {
    const review = stringValue(item.review)
    return [{
      type: 'review.mode.changed',
      providerId: 'codex',
      sessionId: stringValue(params.threadId, item.threadId) ?? '',
      active: itemType === 'enteredReviewMode',
      review,
      itemId: stringValue(item.id)
    }]
  }

  if (itemType === 'contextCompaction') {
    return [{ type: 'assistant.status', content: 'Context compacted' }]
  }

  return []
}

function codexAppServerGoal(params: Record<string, unknown>): RunEvent | null {
  const goal = asRecord(params.goal)
  const objective = stringValue(goal?.objective)
  const threadId = stringValue(params.threadId, goal?.threadId)
  if (!goal || !objective || !threadId) return null
  return {
    type: 'goal.updated',
    goal: {
      providerId: 'codex',
      sessionId: threadId,
      objective,
      status: stringValue(goal.status),
      tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
      tokensUsed: typeof goal.tokensUsed === 'number' ? goal.tokensUsed : undefined,
      timeUsedSeconds: typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : undefined
    }
  }
}

function codexAppServerPlan(params: Record<string, unknown>): RunEvent | null {
  const plan = Array.isArray(params.plan) ? params.plan : []
  const turnId = stringValue(params.turnId) ?? 'codex-plan'
  return {
    type: 'plan.updated',
    plan: {
      providerId: 'codex',
      sessionId: stringValue(params.threadId) ?? '',
      mode: 'execute',
      title: 'Codex plan',
      summary: stringValue(params.explanation),
      items: plan.flatMap((item, index) => {
        const rec = asRecord(item)
        const content = stringValue(rec?.step, rec?.content, rec?.text)
        if (!content) return []
        const status = stringValue(rec?.status)
        return [{
          id: `${turnId}-${index}`,
          content,
          status: status === 'inProgress' ? 'in_progress' : status === 'completed' ? 'completed' : 'pending'
        }]
      })
    }
  }
}

function codexAppServerUsage(params: Record<string, unknown>): RunEvent | null {
  const usage = asRecord(params.tokenUsage)
  const total = asRecord(usage?.total)
  if (!total) return null
  return {
    type: 'assistant.status',
    content: `Token usage: ${Number(total.totalTokens ?? 0).toLocaleString()} total`
  }
}

function codexStatusFromNotification(method: string, params: Record<string, unknown>): RunEvent | null {
  const thread = asRecord(params.thread)
  const turn = asRecord(params.turn)
  const labels: Record<string, string> = {
    'thread/status/changed': `Thread status: ${stringValue(params.status, thread?.status) ?? 'changed'}`,
    'thread/archived': 'Thread archived',
    'thread/unarchived': 'Thread unarchived',
    'thread/closed': 'Thread closed',
    'skills/changed': 'Skills changed',
    'thread/name/updated': `Thread renamed${stringValue(params.name) ? `: ${stringValue(params.name)}` : ''}`,
    'turn/started': `Turn started${stringValue(turn?.id, params.turnId) ? `: ${stringValue(turn?.id, params.turnId)}` : ''}`,
    'hook/started': `Hook started${stringValue(params.name, params.hookName) ? `: ${stringValue(params.name, params.hookName)}` : ''}`,
    'hook/completed': `Hook completed${stringValue(params.name, params.hookName) ? `: ${stringValue(params.name, params.hookName)}` : ''}`,
    'rawResponseItem/completed': 'Raw response item completed',
    'serverRequest/resolved': 'Server request resolved',
    'mcpServer/oauthLogin/completed': 'MCP OAuth login completed',
    'mcpServer/startupStatus/updated': 'MCP startup status updated',
    'account/updated': 'Account updated',
    'account/rateLimits/updated': 'Rate limits updated',
    'app/list/updated': 'App list updated',
    'remoteControl/status/changed': `Remote control: ${stringValue(params.status) ?? 'changed'}`,
    'externalAgentConfig/import/completed': 'External agent config import completed',
    'fs/changed': 'File system changed',
    'thread/compacted': 'Thread compacted',
    'model/rerouted': `Model rerouted${stringValue(params.model, params.targetModel) ? `: ${stringValue(params.model, params.targetModel)}` : ''}`,
    'model/verification': `Model verification${stringValue(params.status, params.result) ? `: ${stringValue(params.status, params.result)}` : ''}`,
    'warning': stringValue(params.message) ?? 'Codex warning',
    'guardianWarning': stringValue(params.message) ?? 'Codex guardian warning',
    'deprecationNotice': stringValue(params.message) ?? 'Codex deprecation notice',
    'configWarning': stringValue(params.message) ?? 'Codex config warning',
    'fuzzyFileSearch/sessionUpdated': 'Fuzzy file search updated',
    'fuzzyFileSearch/sessionCompleted': 'Fuzzy file search completed',
    'thread/realtime/started': 'Realtime session started',
    'thread/realtime/itemAdded': 'Realtime item added',
    'thread/realtime/transcript/done': 'Realtime transcript completed',
    'thread/realtime/error': stringValue(params.message, params.error) ?? 'Realtime error',
    'thread/realtime/closed': 'Realtime session closed',
    'windows/worldWritableWarning': stringValue(params.message) ?? 'Windows world-writable path warning',
    'windowsSandbox/setupCompleted': 'Windows sandbox setup completed',
    'account/login/completed': 'Account login completed'
  }
  const content = labels[method]
  return content ? { type: 'assistant.status', content } : null
}

function codexBrowserManagerStateFromNotification(method: string, params: Record<string, unknown>): RunEvent | null {
  const normalizedMethod = method.replace(/[./:_-]/g, '').toLowerCase()
  const isDirectManagerState = normalizedMethod === 'browsermanagerstate' || normalizedMethod === 'browsermanagerstatechanged'
  const isState = normalizedMethod === 'browsersidebarbrowserusestate' || normalizedMethod === 'browserusestate'
  const isViewport = normalizedMethod === 'browsersidebarbrowseruseviewport' || normalizedMethod === 'browseruseviewport'
  const isCapture = normalizedMethod === 'browsersidebarbrowserusecapturesurface' || normalizedMethod === 'browserusecapturesurface'
  const isCursor = normalizedMethod === 'browsersidebarbrowserusecursorstate' || normalizedMethod === 'browserusecursorstate'
  const isLocalServers = normalizedMethod === 'browsersidebarlocalservers' || normalizedMethod === 'browserlocalservers'
  if (!isDirectManagerState && !isState && !isViewport && !isCapture && !isCursor && !isLocalServers) return null

  const active = booleanValue(params.active, params.isActive, params.browserUseActive)
  const viewportSize = surfaceSizeValue(params.viewportSize, params.viewport, isViewport ? params.size : undefined)
  const captureSurfaceSize = surfaceSizeValue(params.captureSurfaceSize, params.surfaceSize, params.captureSurface, isCapture ? params.size : undefined)
  const captureBounds = surfaceBoundsValue(params.captureBounds, params.bounds, params.geometry, params.captureGeometry, isCapture ? params.bounds : undefined)
  const cursorState = cursorStateValue(params.cursorState, isCursor ? params : undefined)
  const localServerState = localServerRouteStateValue(params)
  const hasState = active !== undefined ||
    'turnId' in params ||
    'turn_id' in params ||
    viewportSize !== undefined ||
    captureSurfaceSize !== undefined ||
    captureBounds !== undefined ||
    cursorState !== undefined ||
    localServerState !== undefined
  if (!hasState) return null

  const event: Extract<RunEvent, { type: 'browser.manager_state' }> = {
    type: 'browser.manager_state',
    open: active === false && viewportSize === undefined && captureSurfaceSize === undefined && captureBounds === undefined && cursorState === undefined && localServerState === undefined ? false : undefined
  }
  if (active !== undefined) event.active = active
  if ('turnId' in params || 'turn_id' in params) event.turnId = stringValue(params.turnId, params.turn_id) ?? null
  if (viewportSize !== undefined) event.viewportSize = viewportSize
  if (captureSurfaceSize !== undefined) event.captureSurfaceSize = captureSurfaceSize
  if (captureBounds !== undefined) event.captureBounds = captureBounds
  if (cursorState !== undefined) event.cursorState = cursorState
  if (localServerState !== undefined) {
    event.localServerRoutes = localServerState.routes
    event.hiddenLocalServerRoutes = localServerState.hiddenRoutes
  }
  return event
}

function booleanValue(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function surfaceSizeValue(...values: unknown[]): { width: number; height: number } | null | undefined {
  for (const value of values) {
    if (value === null) return null
    if (value === undefined) continue
    const rec = asRecord(value)
    if (!rec) continue
    const width = numberValue(rec.width, rec.w)
    const height = numberValue(rec.height, rec.h)
    if (width !== undefined && height !== undefined) return { width, height }
  }
  return undefined
}

function surfaceBoundsValue(...values: unknown[]): { x: number; y: number; width: number; height: number; scale?: number } | null | undefined {
  for (const value of values) {
    if (value === null) return null
    if (value === undefined) continue
    const rec = asRecord(value)
    if (!rec) continue
    const x = numberValue(rec.x, rec.left)
    const y = numberValue(rec.y, rec.top)
    const width = numberValue(rec.width, rec.w)
    const height = numberValue(rec.height, rec.h)
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      const bounds = {
        x,
        y,
        width,
        height
      }
      const scale = numberValue(rec.scale)
      return scale === undefined ? bounds : { ...bounds, scale }
    }
  }
  return undefined
}

function cursorStateValue(...values: unknown[]): { visible: boolean; x: number; y: number; animateMovement?: boolean; moveSequence?: number } | null | undefined {
  for (const value of values) {
    if (value === null) return null
    if (value === undefined) continue
    const rec = asRecord(value)
    if (!rec) continue
    const visible = booleanValue(rec.visible, rec.isVisible)
    const x = numberValue(rec.x, rec.clientX)
    const y = numberValue(rec.y, rec.clientY)
    if (visible === undefined || x === undefined || y === undefined) continue
    return {
      visible,
      x,
      y,
      animateMovement: booleanValue(rec.animateMovement),
      moveSequence: numberValue(rec.moveSequence)
    }
  }
  return undefined
}

function localServerRouteStateValue(params: Record<string, unknown>): { routes: Array<{ serverUrl: string; url: string; title?: string | null; source?: 'provider' }>; hiddenRoutes: string[] } | undefined {
  const state = asRecord(params.state) ?? params
  const routes = new Map<string, { serverUrl: string; url: string; title?: string | null; source?: 'provider' }>()
  const hiddenRoutes = new Set<string>()
  const addRoute = (serverUrl: string | undefined, routeUrl: string | undefined, title?: string | null): void => {
    if (!serverUrl || !routeUrl) return
    routes.set(routeUrl, {
      serverUrl,
      url: routeUrl,
      title: title ?? null,
      source: 'provider'
    })
  }
  const addHiddenRoute = (routeUrl: string | undefined): void => {
    if (routeUrl) hiddenRoutes.add(routeUrl)
  }
  const addServerRoutes = (serverValue: unknown, hidden: boolean): void => {
    const server = asRecord(serverValue)
    if (!server) return
    const serverUrl = stringValue(server.url, server.serverUrl, server.baseUrl)
    const routeValues = Array.isArray(server.routes) ? server.routes : []
    for (const routeValue of routeValues) {
      const route = asRecord(routeValue)
      const routeUrl = typeof routeValue === 'string'
        ? routeValue
        : stringValue(route?.url, route?.routeUrl, route?.href)
      if (hidden) addHiddenRoute(routeUrl)
      else addRoute(serverUrl, routeUrl, stringValue(route?.title, route?.label, route?.name) ?? null)
    }
  }

  const directRoutes = Array.isArray(params.localServerRoutes) ? params.localServerRoutes : Array.isArray(params.routes) ? params.routes : []
  for (const routeValue of directRoutes) {
    const route = asRecord(routeValue)
    const routeUrl = typeof routeValue === 'string'
      ? routeValue
      : stringValue(route?.url, route?.routeUrl, route?.href)
    const serverUrl = stringValue(route?.serverUrl, route?.server, route?.baseUrl, params.serverUrl, params.url)
    addRoute(serverUrl, routeUrl, stringValue(route?.title, route?.label, route?.name) ?? null)
  }

  const servers = Array.isArray(state.servers) ? state.servers : Array.isArray(params.servers) ? params.servers : []
  const hiddenServers = Array.isArray(state.hiddenServers) ? state.hiddenServers : Array.isArray(params.hiddenServers) ? params.hiddenServers : []
  for (const server of servers) addServerRoutes(server, false)
  for (const server of hiddenServers) addServerRoutes(server, true)

  const directHiddenRoutes = Array.isArray(params.hiddenLocalServerRoutes)
    ? params.hiddenLocalServerRoutes
    : Array.isArray(params.hiddenRoutes)
      ? params.hiddenRoutes
      : []
  for (const routeValue of directHiddenRoutes) {
    addHiddenRoute(typeof routeValue === 'string' ? routeValue : stringValue(asRecord(routeValue)?.url))
  }

  const hasLocalServerShape = 'state' in params ||
    'localServerRoutes' in params ||
    'routes' in params ||
    'servers' in params ||
    'hiddenServers' in params ||
    'hiddenLocalServerRoutes' in params ||
    'hiddenRoutes' in params
  if (!hasLocalServerShape) return undefined
  return {
    routes: [...routes.values()],
    hiddenRoutes: [...hiddenRoutes.values()]
  }
}

function parseCodexAppServerMessage(obj: Record<string, unknown>): RunEvent[] {
  const method = stringValue(obj.method)
  if (!method) return []

  const params = asRecord(obj.params) ?? {}
  const requestId = stringValue(obj.id)
  const events: RunEvent[] = []
  const browserManagerState = codexBrowserManagerStateFromNotification(method, params)
  if (browserManagerState) events.push(browserManagerState)

  if (method === 'thread/started') {
    const thread = asRecord(params.thread)
    const threadId = stringValue(thread?.id, params.threadId)
    if (threadId) events.push({ type: 'session.started', providerSessionId: threadId })
  }

  if (method === 'turn/completed') {
    const turn = asRecord(params.turn)
    const status = stringValue(turn?.status)
    if (status === 'failed' || status === 'interrupted') {
      const error = asRecord(turn?.error)
      events.push({ type: 'run.failed', content: stringifyContent(error?.message ?? error ?? status) })
    } else {
      events.push({ type: 'run.completed' })
    }
  }
  if (method === 'error') events.push({ type: 'run.failed', content: stringifyContent(params.message ?? params.error ?? obj.error) })

  if (method === 'item/agentMessage/delta') {
    const itemId = stringValue(params.itemId)
    const delta = stringValue(params.delta)
    if (itemId && delta) events.push({ type: 'assistant.text.delta', streamId: itemId, content: delta })
  }

  if (method === 'item/plan/delta') {
    const itemId = stringValue(params.itemId)
    const delta = stringValue(params.delta)
    if (itemId && delta) events.push({ type: 'assistant.text.delta', streamId: itemId, content: delta })
  }

  if (method === 'turn/plan/updated') {
    const plan = codexAppServerPlan(params)
    if (plan) events.push(plan)
  }

  if (method === 'thread/goal/updated') {
    const goal = codexAppServerGoal(params)
    if (goal) events.push(goal)
  }

  if (method === 'thread/goal/cleared') {
    const threadId = stringValue(params.threadId)
    if (threadId) events.push({ type: 'goal.cleared', providerId: 'codex', sessionId: threadId })
  }

  if (method === 'thread/tokenUsage/updated') {
    const usage = codexAppServerUsage(params)
    if (usage) events.push(usage)
  }

  if (method === 'turn/diff/updated' && typeof params.diff === 'string') {
    const providerSessionId = stringValue(params.threadId)
    const providerTurnId = stringValue(params.turnId)
    const checkpoint = asRecord(params.checkpoint)
    const checkpointId = stringValue(
      params.checkpointId,
      params.checkpoint_id,
      checkpoint?.id,
      checkpoint?.checkpointId,
      checkpoint?.checkpoint_id
    )
    events.push({
      type: 'diff.updated',
      content: params.diff,
      ...(providerSessionId ? { providerSessionId } : {}),
      ...(providerTurnId ? { providerTurnId } : {}),
      ...(checkpointId ? { checkpointId } : {}),
      checkpointUndoSupported: false
    })
  }

  if (method === 'item/autoApprovalReview/started') {
    events.push({
      type: 'assistant.status',
      content: `Auto-review started${stringValue(params.reviewId) ? `: ${stringValue(params.reviewId)}` : ''}`
    })
  }

  if (method === 'item/autoApprovalReview/completed') {
    const action = asRecord(params.action)
    events.push({
      type: 'assistant.status',
      content: `Auto-review completed${stringValue(action?.type, params.reviewId) ? `: ${stringValue(action?.type, params.reviewId)}` : ''}`
    })
  }

  if (
    method === 'command/exec/outputDelta' ||
    method === 'item/commandExecution/outputDelta' ||
    method === 'item/fileChange/outputDelta'
  ) {
    const streamId = stringValue(params.callId, params.itemId, params.commandId, params.processId) ?? method
    const delta = stringValue(params.delta, params.text, params.output)
    if (delta) events.push({ type: 'assistant.text.delta', streamId, content: delta })
  }

  if (method === 'item/fileChange/patchUpdated') {
    events.push({
      type: 'assistant.status',
      content: `Patch updated${stringValue(params.itemId) ? `: ${stringValue(params.itemId)}` : ''}`
    })
  }

  if (method === 'item/mcpToolCall/progress') {
    const message = stringValue(params.message, params.progress, params.status)
    events.push({
      type: 'assistant.status',
      content: message ? `MCP progress: ${message}` : 'MCP progress updated'
    })
  }

  if (
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/textDelta' ||
    method === 'thread/realtime/transcript/delta'
  ) {
    const streamId = stringValue(params.itemId, params.responseId, params.threadId) ?? method
    const delta = stringValue(params.delta, params.text)
    if (delta) events.push({ type: 'assistant.text.delta', streamId, content: delta })
  }

  if (method === 'item/reasoning/summaryPartAdded') {
    events.push({
      type: 'assistant.status',
      content: `Reasoning summary updated${stringValue(params.itemId) ? `: ${stringValue(params.itemId)}` : ''}`
    })
  }

  if (method === 'thread/realtime/outputAudio/delta' || method === 'thread/realtime/sdp') {
    events.push({ type: 'assistant.status', content: method === 'thread/realtime/sdp' ? 'Realtime SDP updated' : 'Realtime audio updated' })
  }

  if (method === 'item/started' || method === 'item/completed') {
    const item = asRecord(params.item)
    if (item) events.push(...parseCodexAppServerItem(item, method === 'item/started' ? 'started' : 'completed', params))
  }

  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval' ||
    method === 'item/permissions/requestApproval' ||
    method === 'applyPatchApproval' ||
    method === 'execCommandApproval'
  ) {
    const permission = codexAppServerPermissionRequest(method, requestId, params)
    if (permission) events.push(permission)
  }

  if (method === 'item/tool/requestUserInput') {
    const userInput = codexAppServerUserInput(params)
    if (userInput) events.push(userInput)
  }

  if (method === 'mcpServer/elicitation/request') {
    const elicitation = codexAppServerMcpElicitation(params)
    if (elicitation) events.push(elicitation)
  }

  const status = codexStatusFromNotification(method, params)
  if (status) events.push(status)

  return events
}

const codexProvider: ProviderAdapter = {
  id: 'codex',
  binary: 'codex',
  binaryCandidates: [
    'codex',
    join(homedir(), '.local/bin/codex'),
    '/Applications/Codex.app/Contents/Resources/codex'
  ],
  capabilities: {
    resume: true,
    streamingJson: true,
    interactiveCli: true,
    interactivePermissions: true,
    allowedTools: false,
    workspaceSandbox: true,
    fullAccessMode: true,
    checkpointUndo: false
  },

  resolveExecutionPolicy: codexPolicy,

  buildStartCommand(request) {
    return command(this.binary, ['exec', ...codexBaseArgs(request), request.prompt])
  },

  buildResumeCommand(request) {
    const args = ['exec', 'resume', ...codexBaseArgs(request)]
    if (request.providerSessionId) args.push(request.providerSessionId)
    args.push(request.prompt || 'Please continue.')
    return command(this.binary, args)
  },

  buildInteractiveCommand(request) {
    const args: string[] = []
    args.push('--model', request.model || 'gpt-5.4')
    if (request.effort) args.push('-c', `model_reasoning_effort="${request.effort}"`)
    args.push(...interactivePolicyArgs(this, request.executionPolicy || 'default'))
    if (request.prompt) args.push(request.prompt)
    return command(this.binary, args)
  },

  parseOutputLine(line) {
    const obj = parseJsonLine(line)
    if (!obj) return []

    const events: RunEvent[] = []
    events.push(...parseCodexAppServerMessage(obj))
    const type = obj.type as string | undefined
    const directBrowserManagerState = type
      ? codexBrowserManagerStateFromNotification(type, asRecord(obj.data) ?? asRecord(obj.item) ?? obj)
      : null
    if (directBrowserManagerState) events.push(directBrowserManagerState)

    if (
      type === 'user_input.requested' ||
      type === 'mcp_elicitation_request' ||
      type === 'mcp.elicitation.requested' ||
      type === 'tool_call_mcp_elicitation' ||
      type === 'elicitation.requested'
    ) {
      const userInput = userInputFromGenericPayload(asRecord(obj.data) ?? asRecord(obj.item) ?? obj)
      if (userInput) events.push({ type: 'user_input.requested', ...userInput })
    }

    if (
      type === 'permission.requested' ||
      type === 'approval.requested' ||
      type === 'exec.approval.requested'
    ) {
      const permission = permissionRequestFromGenericPayload(asRecord(obj.data) ?? obj)
      if (permission) events.push(permission)
    }

    if (type === 'thread.started' && typeof obj.thread_id === 'string') {
      events.push({ type: 'session.started', providerSessionId: obj.thread_id })
    }

    if (type === 'agent_message') {
      const content = typeof obj.message === 'string'
        ? obj.message
        : typeof obj.content === 'string'
          ? obj.content
          : undefined
      if (content) events.push({ type: 'assistant.text', content })
    }

    if (type === 'function_call' || type === 'exec_command_begin') {
      events.push({
        type: 'tool.started',
        id: typeof obj.call_id === 'string' ? obj.call_id : uuidv4(),
        toolName: typeof obj.name === 'string' ? obj.name : typeof obj.command === 'string' ? 'shell' : 'tool',
        toolInput: asRecord(obj.arguments ?? obj.input) ?? (typeof obj.command === 'string' ? { command: obj.command } : {})
      })
    }

    if (type === 'function_call_output' || type === 'exec_command_end') {
      events.push({
        type: 'tool.completed',
        id: uuidv4(),
        toolUseId: typeof obj.call_id === 'string' ? obj.call_id : uuidv4(),
        content: stringifyContent(obj.output ?? obj.result ?? ''),
        isError: obj.error != null
      })
    }

    if (type === 'item.started' || type === 'item.completed') {
      const item = asRecord(obj.item)
      if (item) events.push(...parseCodexItem(item))
    }

    if (type?.startsWith('agent.') || type?.startsWith('subagent.')) {
      const agentEvent = agentEventFromProviderPayload(
        'codex',
        stringValue(obj.thread_id, obj.sessionId, obj.session_id),
        type,
        asRecord(obj.agent) ?? obj,
        typeof obj.id === 'string' ? obj.id : uuidv4()
      )
      if (agentEvent) events.push(agentEvent)
    }

    if (type === 'turn.completed') events.push({ type: 'run.completed' })
    if (type === 'turn.failed') {
      const err = obj.error
      const content = typeof err === 'string' ? err : stringifyContent(asRecord(err)?.message ?? err)
      events.push({ type: 'run.failed', content })
    }
    if (type === 'error') events.push({ type: 'run.failed', content: stringifyContent(obj.message ?? obj.error) })

    return events
  }
}

// Cursor Agent CLI

function cursorPolicy(policyId: string): ResolvedExecutionPolicy {
  if (policyId === 'yolo') {
    return policy(policyId, 'exact', ['--force', '--trust'], 'Auto', 'Enables Cursor all-permissions mode.', undefined, {
      intent: 'bypass',
      interaction: 'headless',
      controls: cursorPermissionControls,
      execution: {
        nativeMode: 'force',
        toolPolicy: 'trusted all tools',
        configSource: 'cli'
      }
    })
  }
  if (policyId === 'ask') {
    return policy(
      policyId,
      'exact',
      ['--mode', 'ask', '--trust'],
      'Read-only',
      'Cursor ask mode is read-only and does not apply edits.',
      undefined,
      {
        intent: 'ask',
        interaction: 'headless',
        controls: cursorPermissionControls,
        execution: {
          nativeMode: 'ask',
          sandboxMode: 'read-only',
          configSource: 'cli'
        }
      }
    )
  }
  return policy(
    policyId,
    'exact',
    ['--sandbox', 'enabled', '--trust'],
    'Sandbox',
    'Requests Cursor sandbox mode so the agent can edit inside the workspace.',
    undefined,
    {
      intent: 'workspaceSandbox',
      interaction: 'headless',
      controls: cursorPermissionControls,
      execution: {
        nativeMode: 'sandbox',
        sandboxMode: 'enabled',
        configSource: 'cli'
      }
    }
  )
}

export function effectiveCursorModel(request: RunRequest): string {
  const modelDef = PROVIDER_DEFS.cursor.models.find((m) => m.id === request.model)
  const cfg = modelDef?.cursorConfig
  let effectiveModel = request.model || 'auto'

  if (!cfg) return effectiveModel
  if (cfg.effortLevels && cfg.effortLevels.length > 0) {
    const effortId = request.effort || cfg.defaultEffort || cfg.effortLevels[0].id
    const level = cfg.effortLevels.find((l) => l.id === effortId) ?? cfg.effortLevels[0]
    if (request.useThinking && level.thinkingModelId) return level.thinkingModelId
    if (request.useFast && level.fastModelId) return level.fastModelId
    return level.modelId
  }

  if (request.useThinking && cfg.thinkingModelId) effectiveModel = cfg.thinkingModelId
  if (request.useFast && cfg.fastModelId) effectiveModel = cfg.fastModelId
  return effectiveModel
}

function cursorToolName(toolCall: Record<string, unknown>): string {
  const key = Object.keys(toolCall).find((k) => k.endsWith('ToolCall'))
  return key ? key.replace(/ToolCall$/, '') : 'tool'
}

const cursorProvider: ProviderAdapter = {
  id: 'cursor',
  binary: 'agent',
  binaryCandidates: [
    'cursor-agent',
    'agent',
    join(homedir(), '.local/bin/cursor-agent')
  ],
  capabilities: {
    resume: true,
    streamingJson: true,
    interactiveCli: true,
    interactivePermissions: false,
    allowedTools: false,
    workspaceSandbox: true,
    fullAccessMode: true,
    checkpointUndo: false,
    forcedAllTools: true
  },

  resolveExecutionPolicy: cursorPolicy,

  buildStartCommand(request) {
    const args = ['--print', '--output-format', 'stream-json']
    if (request.providerSessionId) args.push('--resume', request.providerSessionId)
    args.push('--workspace', request.cwd)
    args.push('--model', effectiveCursorModel(request))
    args.push(...resolvedPolicyArgs(this, request.executionPolicy || 'default'))
    args.push(request.prompt)
    return command(this.binary, args)
  },

  buildResumeCommand(request) {
    return this.buildStartCommand!({ ...request, prompt: request.prompt || 'Please continue.' })
  },

  buildInteractiveCommand(request) {
    const args: string[] = []
    if (request.providerSessionId) args.push('--resume', request.providerSessionId)
    args.push('--workspace', request.cwd)
    args.push('--model', effectiveCursorModel(request))
    args.push(...interactivePolicyArgs(this, request.executionPolicy || 'default').filter((arg) => arg !== '--trust'))
    if (request.prompt) args.push(request.prompt)
    return command(this.binary, args)
  },

  parseOutputLine(line) {
    const obj = parseJsonLine(line)
    if (!obj) return []

    const events = parseAnthropicStyleLine(line, 'cursor')
    const type = obj.type as string | undefined
    const subtype = obj.subtype as string | undefined

    if (
      type === 'user_input.requested' ||
      type === 'elicitation.requested' ||
      type === 'question'
    ) {
      const userInput = userInputFromGenericPayload(asRecord(obj.data) ?? obj)
      if (userInput) events.push({ type: 'user_input.requested', ...userInput })
    }

    if (type === 'permission.requested' || type === 'approval.requested') {
      const permission = permissionRequestFromGenericPayload(asRecord(obj.data) ?? obj)
      if (permission) events.push(permission)
    }

    if (type === 'tool_call') {
      const callId = typeof obj.call_id === 'string' ? obj.call_id : uuidv4()
      const toolCall = asRecord(obj.tool_call) ?? {}
      const toolName = cursorToolName(toolCall)
      const toolBody = asRecord(toolCall[Object.keys(toolCall)[0] ?? '']) ?? {}
      const args = asRecord(toolBody.args) ?? {}
      if (obj.subtype === 'started') {
        events.push({ type: 'tool.started', id: callId, toolName, toolInput: args })
      } else if (obj.subtype === 'completed') {
        events.push({
          type: 'tool.completed',
          id: uuidv4(),
          toolUseId: callId,
          content: stringifyContent(asRecord(toolBody.result)?.success ?? toolBody.result ?? ''),
          isError: asRecord(toolBody.result)?.error != null
        })
      }
    }

    if (type === 'connection' && subtype === 'reconnecting') {
      const attempt = typeof obj.attempt === 'number' ? obj.attempt : undefined
      events.push({
        type: 'connection.reconnecting',
        attempt,
        content: attempt ? `Cursor reconnecting, attempt ${attempt}.` : 'Cursor reconnecting.'
      })
    }

    if (type === 'retry' && subtype === 'starting') {
      const attempt = typeof obj.attempt === 'number' ? obj.attempt : undefined
      events.push({
        type: 'connection.retrying',
        attempt,
        content: attempt ? `Cursor retrying, attempt ${attempt}.` : 'Cursor retrying.'
      })
    }

    if (type === 'error') {
      events.push({ type: 'run.failed', content: stringifyContent(obj.message ?? obj.error) })
    }

    return events
  }
}

// Registry

export const PROVIDERS: Record<string, ProviderAdapter> = {
  claude: claudeProvider,
  copilot: copilotProvider,
  codex: codexProvider,
  cursor: cursorProvider
}

export function getProvider(id: string): ProviderAdapter {
  return PROVIDERS[id] ?? PROVIDERS.claude
}

export function claudeMcpServerNames(output: string): string[] {
  const names = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^checking\b/i.test(line)) return null
      const withoutMarker = line.replace(/^[•*-]\s*/, '')
      const colonMatch = withoutMarker.match(/^([A-Za-z0-9._-]+)\s*:/)
      const bulletMatch = line.match(/^[•*-]\s*([A-Za-z0-9._-]+)\b/)
      const candidate = (colonMatch?.[1] ?? bulletMatch?.[1])?.trim()
      return candidate && !/^(checking|name|server|servers|no|none)$/i.test(candidate) ? candidate : null
    })
    .filter((name): name is string => Boolean(name))

  return [...new Set(names)]
}

function claudeMcpStatusFromDetail(detail: string, fallback: 'ok' | 'error' = 'ok'): 'ok' | 'error' {
  return /failed|error|not found|unable|cannot/i.test(detail) ? 'error' : fallback
}

function runClaudeMcpDetails(providerId: string, surfaceId: string, binary: string): ProviderCommandSurfaceResult {
  try {
    const listOutput = execFileSync(binary, ['mcp', 'list'], {
      encoding: 'utf8',
      timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
      env: providerSpawnEnv(providerId),
      maxBuffer: 512 * 1024
    })
    const names = claudeMcpServerNames(listOutput)
    const details = names.map((name) => {
      try {
        const output = execFileSync(binary, ['mcp', 'get', name], {
          encoding: 'utf8',
          timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
          env: providerSpawnEnv(providerId),
          maxBuffer: 512 * 1024
        })
        const detail = redactProviderCommandOutput(output.trim())
        return { server: name, status: claudeMcpStatusFromDetail(detail), detail }
      } catch (error) {
        const err = error as { stdout?: unknown; stderr?: unknown; message?: string }
        return { server: name, status: 'error', detail: redactProviderCommandOutput(stringifyCommandError(err)) }
      }
    })
    const hasErrors = details.some((detail) => detail.status === 'error')
    return {
      providerId,
      surfaceId,
      status: hasErrors ? 'error' : 'ok',
      output: JSON.stringify(details, null, 2)
    }
  } catch (error) {
    const err = error as { stdout?: unknown; stderr?: unknown; message?: string }
    return {
      providerId,
      surfaceId,
      status: 'error',
      output: redactProviderCommandOutput(stringifyCommandError(err))
    }
  }
}

async function runClaudeMcpDetailsAsync(providerId: string, surfaceId: string, binary: string, cwd = process.cwd()): Promise<ProviderCommandSurfaceResult> {
  try {
    const { stdout } = await execFileAsync(binary, ['mcp', 'list'], {
      encoding: 'utf8',
      timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
      cwd,
      env: providerSpawnEnv(providerId),
      maxBuffer: 512 * 1024
    })
    const names = claudeMcpServerNames(String(stdout))
    const details = await Promise.all(names.map(async (name) => {
      try {
        const result = await execFileAsync(binary, ['mcp', 'get', name], {
          encoding: 'utf8',
          timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
          cwd,
          env: providerSpawnEnv(providerId),
          maxBuffer: 512 * 1024
        })
        const detail = redactProviderCommandOutput(String(result.stdout).trim())
        return { server: name, status: claudeMcpStatusFromDetail(detail), detail }
      } catch (error) {
        const err = error as { stdout?: unknown; stderr?: unknown; message?: string }
        return { server: name, status: 'error', detail: redactProviderCommandOutput(stringifyCommandError(err)) }
      }
    }))
    const hasErrors = details.some((detail) => detail.status === 'error')
    return {
      providerId,
      surfaceId,
      status: hasErrors ? 'error' : 'ok',
      output: JSON.stringify(details, null, 2)
    }
  } catch (error) {
    const err = error as { stdout?: unknown; stderr?: unknown; message?: string }
    return {
      providerId,
      surfaceId,
      status: 'error',
      output: redactProviderCommandOutput(stringifyCommandError(err))
    }
  }
}

type CodexAppServerSurfaceRequest = {
  method: string
  params?: Record<string, unknown>
}

function codexAppServerSurfaceRequest(surfaceId: string, cwd = process.cwd()): CodexAppServerSurfaceRequest | null {
  const requests: Record<string, CodexAppServerSurfaceRequest> = {
    'appserver-models': { method: 'model/list', params: { limit: 100, includeHidden: true } },
    'appserver-model-provider-capabilities': { method: 'modelProvider/capabilities/read', params: {} },
    'appserver-features': { method: 'experimentalFeature/list', params: { limit: 100 } },
    'appserver-config': { method: 'config/read', params: { includeLayers: true, cwd } },
    'appserver-config-requirements': { method: 'configRequirements/read' },
    'appserver-account': { method: 'account/read', params: { refreshToken: false } },
    'appserver-rate-limits': { method: 'account/rateLimits/read' },
    'appserver-auth-status': { method: 'getAuthStatus', params: { includeToken: false, refreshToken: false } },
    'appserver-skills': { method: 'skills/list', params: { cwds: [cwd], forceReload: false } },
    'appserver-hooks': { method: 'hooks/list', params: { cwds: [cwd] } },
    'appserver-plugins': { method: 'plugin/list', params: { cwds: [cwd] } },
    'appserver-apps': { method: 'app/list', params: { limit: 100, forceRefetch: false } },
    'appserver-mcp-status': { method: 'mcpServerStatus/list', params: { limit: 100 } },
    'appserver-external-agent-config': { method: 'externalAgentConfig/detect', params: { includeHome: true, cwds: [cwd] } },
    'appserver-threads': { method: 'thread/list', params: { limit: 50, cwd, useStateDbOnly: true } },
    'appserver-loaded-threads': { method: 'thread/loaded/list', params: { limit: 50 } }
  }
  return requests[surfaceId] ?? null
}

async function runCodexAppServerSingleRequest(
  provider: ProviderAdapter,
  binary: string,
  request: CodexAppServerSurfaceRequest,
  cwd = process.cwd()
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
      cwd,
      env: providerSpawnEnv(provider.id),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let nextId = 1
    let stdoutBuffer = ''
    let stderrBuffer = ''
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    let finished = false
    let timeout: ReturnType<typeof setTimeout>

    const finish = (error: Error | null, value?: unknown): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      if (!child.killed) child.kill()
      pending.clear()
      if (error) reject(error)
      else resolve(value)
    }

    const send = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      const id = `surface-${nextId++}`
      const payload = params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params }
      const line = JSON.stringify(payload)
      return new Promise((requestResolve, requestReject) => {
        pending.set(id, { resolve: requestResolve, reject: requestReject })
        child.stdin.write(`${line}\n`, (error) => {
          if (error) {
            pending.delete(id)
            requestReject(error)
          }
        })
      })
    }

    const notify = (method: string, params?: Record<string, unknown>): void => {
      const payload = params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params }
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    }

    timeout = setTimeout(() => {
      finish(new Error(`Codex app-server request timed out: ${request.method}${stderrBuffer ? `\n${stderrBuffer.trim()}` : ''}`))
    }, PROVIDER_COMMAND_SURFACE_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrBuffer += String(chunk)
    })
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk)
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const message = parseJsonLine(line)
        if (!message) continue
        const id = stringValue(message.id)
        if (!id) continue
        const waiting = pending.get(id)
        if (!waiting) continue
        pending.delete(id)
        if (message.error) {
          waiting.reject(new Error(stringifyContent(message.error)))
        } else {
          waiting.resolve(message.result)
        }
      }
    })
    child.on('error', (error) => finish(error))
    child.on('exit', (code, signal) => {
      if (!finished && pending.size > 0) {
        finish(new Error(`Codex app-server exited before responding (${signal ?? code ?? 'unknown'}).${stderrBuffer ? `\n${stderrBuffer.trim()}` : ''}`))
      }
    })

    send('initialize', {
      clientInfo: {
        name: 'orchestrator',
        title: 'Orchestrator',
        version: '1.0.0'
      },
      capabilities: {
        experimentalApi: true
      }
    }).then(async () => {
      notify('initialized')
      const result = await send(request.method, request.params)
      finish(null, result)
    }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

async function runCodexAppServerCommandSurface(
  provider: ProviderAdapter,
  surfaceId: string,
  binary: string,
  cwd = process.cwd()
): Promise<ProviderCommandSurfaceResult> {
  const request = codexAppServerSurfaceRequest(surfaceId, cwd)
  if (!request) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'blocked',
      output: 'Unknown Codex app-server surface.'
    }
  }
  try {
    const result = await runCodexAppServerSingleRequest(provider, binary, request, cwd)
    return {
      providerId: provider.id,
      surfaceId,
      status: 'ok',
      output: redactProviderCommandOutput(JSON.stringify(result, null, 2))
    }
  } catch (error) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'error',
      output: redactProviderCommandOutput(error instanceof Error ? error.message : String(error))
    }
  }
}

export async function runCodexAppServerCommandSurfaceRaw(surfaceId: string, cwd = process.cwd()): Promise<unknown> {
  const provider = getProvider('codex')
  const registry = providerCapabilityRegistry(provider.id)
  const surface = registry.commandSurfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface) throw new Error('Unknown Codex app-server surface.')
  if (surface.quota !== 'none' || surface.mutatesState) {
    throw new Error('This Codex app-server surface is not safe to run automatically.')
  }
  if (surface.runtime !== 'app-server') {
    throw new Error('This Codex surface is not an app-server surface.')
  }
  const request = codexAppServerSurfaceRequest(surface.id, cwd)
  if (!request) throw new Error('Unknown Codex app-server request.')
  const binary = resolveProviderBinary(provider)
  if (!binary) throw new Error('codex CLI is not available.')
  return await runCodexAppServerSingleRequest(provider, binary, request, cwd)
}

export function runProviderCommandSurface(providerId: string, surfaceId: string): ProviderCommandSurfaceResult {
  const provider = getProvider(providerId)
  const registry = providerCapabilityRegistry(provider.id)
  const surface = registry.commandSurfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'blocked',
      output: 'Unknown provider command.'
    }
  }
  if (surface.quota !== 'none' || surface.mutatesState) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'blocked',
      output: 'This command is not safe to run automatically from settings.'
    }
  }

  const binary = resolveProviderBinary(provider)
  if (!binary) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'error',
      output: `${provider.id} CLI is not available.`
    }
  }
  if (provider.id === 'codex' && surface.runtime === 'app-server') {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'blocked',
      output: 'Codex app-server surfaces require the async command runner.'
    }
  }
  if (provider.id === 'claude' && surface.id === 'mcp-details') {
    return runClaudeMcpDetails(provider.id, surface.id, binary)
  }

  try {
    const output = execFileSync(binary, surface.command, {
      encoding: 'utf8',
      timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
      env: providerSpawnEnv(provider.id),
      maxBuffer: 512 * 1024
    })
    return {
      providerId: provider.id,
      surfaceId,
      status: 'ok',
      output: redactProviderCommandOutput(output.trim())
    }
  } catch (error) {
    const err = error as { stdout?: unknown; stderr?: unknown; message?: string }
    return {
      providerId: provider.id,
      surfaceId,
      status: 'error',
      output: redactProviderCommandOutput(stringifyCommandError(err))
    }
  }
}

export async function runProviderCommandSurfaceAsync(providerId: string, surfaceId: string, cwd = process.cwd()): Promise<ProviderCommandSurfaceResult> {
  const provider = getProvider(providerId)
  const registry = providerCapabilityRegistry(provider.id)
  const surface = registry.commandSurfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'blocked',
      output: 'Unknown provider command.'
    }
  }
  if (surface.quota !== 'none' || surface.mutatesState) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'blocked',
      output: 'This command is not safe to run automatically from settings.'
    }
  }

  const binary = resolveProviderBinary(provider)
  if (!binary) {
    return {
      providerId: provider.id,
      surfaceId,
      status: 'error',
      output: `${provider.id} CLI is not available.`
    }
  }
  if (provider.id === 'codex' && surface.runtime === 'app-server') {
    return await runCodexAppServerCommandSurface(provider, surface.id, binary, cwd)
  }
  if (provider.id === 'claude' && surface.id === 'mcp-details') {
    return await runClaudeMcpDetailsAsync(provider.id, surface.id, binary, cwd)
  }

  try {
    const { stdout } = await execFileAsync(binary, surface.command, {
      encoding: 'utf8',
      timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
      cwd,
      env: providerSpawnEnv(provider.id),
      maxBuffer: 512 * 1024
    })
    return {
      providerId: provider.id,
      surfaceId,
      status: 'ok',
      output: redactProviderCommandOutput(String(stdout).trim())
    }
  } catch (error) {
    const err = error as { stdout?: unknown; stderr?: unknown; message?: string }
    return {
      providerId: provider.id,
      surfaceId,
      status: 'error',
      output: redactProviderCommandOutput(stringifyCommandError(err))
    }
  }
}

export async function getProviderPermissionRuntimeContextAsync(
  providerId: string,
  cwd = process.cwd()
): Promise<ProviderPermissionRuntimeContext> {
  const cacheKey = `${providerId}:${cwd}`
  const cached = providerPermissionContextCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = loadProviderPermissionRuntimeContext(providerId, cwd).catch((error) => {
    providerPermissionContextCache.delete(cacheKey)
    throw error
  })
  providerPermissionContextCache.set(cacheKey, {
    expiresAt: Date.now() + PROVIDER_PERMISSION_CONTEXT_TTL_MS,
    promise
  })
  return promise
}

async function loadProviderPermissionRuntimeContext(
  providerId: string,
  cwd = process.cwd()
): Promise<ProviderPermissionRuntimeContext> {
  if (providerId !== 'codex') return resolveProviderPermissionRuntimeContext(providerId, { cwd })
  const [configResult, requirementsResult] = await Promise.all([
    runProviderCommandSurfaceAsync(providerId, 'appserver-config', cwd),
    runProviderCommandSurfaceAsync(providerId, 'appserver-config-requirements', cwd)
  ])
  return resolveProviderPermissionRuntimeContext(providerId, {
    cwd,
    configResult,
    requirementsResult
  })
}

export function getProviderRuntimeInfo(): Record<string, ProviderRuntimeInfo> {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, provider]) => {
      const providerDef = PROVIDER_DEFS[id]
      const policyIds = providerDef?.permissionModes.map((mode) => mode.id) ?? ['default']
      const registry = providerCapabilityRegistry(id)
      return [
        id,
        {
          id,
          capabilities: provider.capabilities,
          abstractCapabilities: baseCapabilities(provider),
          registry,
          policies: Object.fromEntries(
            policyIds.map((policyId) => [policyId, provider.resolveExecutionPolicy(policyId)])
          )
        }
      ]
    })
  )
}

export function getProviderDiagnostics(): Record<string, ProviderDiagnosticInfo> {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, provider]) => {
      const providerDef = PROVIDER_DEFS[id]
      const registry = providerCapabilityRegistry(id)
      const binary = resolveProviderBinary(provider)
      const versionProbe = binary
        ? probeCommand(binary, versionArgs(id))
        : { ok: false, output: 'CLI binary was not found.' }
      const modelCount = providerDef?.models.length ?? 0
      const fallbackAuth = authStatusFromProbe(id, versionProbe)
      const fallbackModels: ProviderDiagnosticInfo['models'] = {
        status: modelCount > 0 ? 'configured' : 'unknown',
        count: modelCount,
        message: modelCount > 0
          ? `${modelCount} configured model IDs in Orchestrator. Provider account availability is verified by live smoke.`
          : 'No local model catalog is configured.'
      }
      const specific = providerSpecificDiagnostics(id, binary, fallbackAuth, fallbackModels)
      const probes = runProbeDefinitions(binary, registry.probes)
      const probeAuth = authStatusFromProviderProbes(probes)

      return [
        id,
        {
          id,
          binary: binary
            ? { status: 'found', path: binary }
            : { status: 'missing' },
          version: binary
            ? versionProbe.ok
              ? { status: 'ok', value: versionProbe.output || 'ok' }
              : { status: 'error', message: versionProbe.output }
            : { status: 'unknown', message: 'Install the CLI before probing version.' },
          auth: probeAuth ?? specific.auth,
          models: specific.models,
          usage: usageStatus(id),
          liveSmoke: {
            status: 'not-run',
            message: 'Run opt-in live smoke with cheap models to verify auth, model access, and parser behavior.'
          },
          runtimeConnections: listProviderRuntimeConnections({ providerId: id, limit: 8 }),
          runtimeEvents: listProviderRuntimeDebugEvents({ providerId: id, limit: 8 }),
          probes
        } satisfies ProviderDiagnosticInfo
      ]
    })
  )
}

export async function getProviderDiagnosticsAsync(providerId?: string): Promise<Record<string, ProviderDiagnosticInfo>> {
  const entries = providerId && PROVIDERS[providerId]
    ? [[providerId, PROVIDERS[providerId]] as const]
    : Object.entries(PROVIDERS)

  const diagnostics = await Promise.all(entries.map(async ([id, provider]) => {
    const providerDef = PROVIDER_DEFS[id]
    const registry = providerCapabilityRegistry(id)
    const binary = resolveProviderBinary(provider)
    const versionProbe = binary
      ? await probeCommandAsync(binary, versionArgs(id))
      : { ok: false, output: 'CLI binary was not found.' }
    const modelCount = providerDef?.models.length ?? 0
    const fallbackAuth = authStatusFromProbe(id, versionProbe)
    const fallbackModels: ProviderDiagnosticInfo['models'] = {
      status: modelCount > 0 ? 'configured' : 'unknown',
      count: modelCount,
      message: modelCount > 0
        ? `${modelCount} configured model IDs in Orchestrator. Provider account availability is verified by live smoke.`
        : 'No local model catalog is configured.'
    }
    const [specific, probes] = await Promise.all([
      providerSpecificDiagnosticsAsync(id, binary, fallbackAuth, fallbackModels),
      runProbeDefinitionsAsync(binary, registry.probes)
    ])
    const probeAuth = authStatusFromProviderProbes(probes)

    return [
      id,
      {
        id,
        binary: binary
          ? { status: 'found', path: binary }
          : { status: 'missing' },
        version: binary
          ? versionProbe.ok
            ? { status: 'ok', value: versionProbe.output || 'ok' }
            : { status: 'error', message: versionProbe.output }
          : { status: 'unknown', message: 'Install the CLI before probing version.' },
        auth: probeAuth ?? specific.auth,
        models: specific.models,
        usage: usageStatus(id),
        liveSmoke: {
          status: 'not-run',
          message: 'Run opt-in live smoke with cheap models to verify auth, model access, and parser behavior.'
        },
        runtimeConnections: listProviderRuntimeConnections({ providerId: id, limit: 8 }),
        runtimeEvents: listProviderRuntimeDebugEvents({ providerId: id, limit: 8 }),
        probes
      } satisfies ProviderDiagnosticInfo
    ] as const
  }))

  return Object.fromEntries(diagnostics)
}
