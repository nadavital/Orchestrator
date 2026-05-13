import { v4 as uuidv4 } from 'uuid'
import { accessSync, constants, readFileSync } from 'fs'
import { execFile, execFileSync } from 'child_process'
import { delimiter, join } from 'path'
import { homedir } from 'os'
import { promisify } from 'util'
import type {
  AgentStatus,
  PermissionDenial,
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
  ProviderProbeDefinition,
  ProviderProbeResult,
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
    cursor: join(home, '.cursor/agent-config.json'),
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

export function providerSpawnEnv(providerId?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...providerConfigEnv(providerId),
    PATH: providerSearchPath(),
    TERM: 'xterm-256color'
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
  buildStartCommand(request: RunRequest): ProviderCommand
  buildResumeCommand(request: RunRequest): ProviderCommand
  buildInteractiveCommand(request: RunRequest): ProviderCommand
  parseOutputLine(line: string): RunEvent[]
}

export function buildProviderCommandForRuntime(
  provider: ProviderAdapter,
  request: RunRequest,
  mode: 'start' | 'resume' = 'start'
): ProviderCommand {
  if (request.runtime === 'interactive' && provider.capabilities.interactiveCli) {
    return provider.buildInteractiveCommand(request)
  }
  return mode === 'resume'
    ? provider.buildResumeCommand(request)
    : provider.buildStartCommand(request)
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

function claudeFileSpecs(attachments: RunRequest['attachments']): string[] {
  return (attachments ?? []).flatMap((attachment) => {
    if (attachment.kind !== 'claude_file') return []
    const fileId = attachment.fileId.trim()
    const relativePath = attachment.relativePath.trim()
    return fileId && relativePath ? [`${fileId}:${relativePath}`] : []
  })
}

function textFromContentBlocks(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => {
    const rec = asRecord(block)
    return rec?.type === 'text' && typeof rec.text === 'string' ? [rec.text] : []
  })
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
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
      multiSelect: rec.multiSelect === true
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
      multiSelect: rec.multiSelect === true || rec.multiselect === true
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
      feature('stream-json', 'Stream JSON', 'runtime', 'supported', 'adapter', ['headless']),
      feature('ask-user-question', 'Ask user', 'permissions', 'supported', 'adapter', ['headless'], 'AskUserQuestion is normalized as user input.'),
      feature('tool-permissions', 'Tool grants', 'permissions', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('slash-commands', 'Slash commands', 'commands', 'partial', 'local-cli', ['interactive'], 'Provider commands exist, but command listing is not normalized yet.'),
      feature('agents', 'Agents', 'agents', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('ultrareview', 'Ultrareview', 'review', 'supported', 'local-cli', ['headless']),
      feature('mcp', 'MCP', 'mcp', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('plugins', 'Plugins', 'extensions', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('worktrees', 'Worktrees', 'workspace', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('attachments', 'Files', 'attachments', 'partial', 'local-cli', ['headless', 'interactive'])
    ],
    gaps: [
      gap(
        'claude-hook-partials',
        'Hook and partial streams',
        'runtime',
        'medium',
        'partial',
        'Claude partial text streams are normalized for headless runs; hook lifecycle events are not surfaced yet.',
        'Add parser fixtures for --include-hook-events before enabling hook event UI.'
      ),
      gap(
        'claude-rich-permission-controls',
        'Denied tools and scoped grants',
        'permissions',
        'medium',
        'partial',
        'Allowed tools, denied tools, available tool sets, additional directories, allow-once grants, allow-session grants, and denial are represented in run/session state and passed to Claude; native Claude rule-file import/export is not surfaced yet.',
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
        'Orchestrator can create app-managed git worktrees before launch; native Claude --worktree, --tmux, --from-pr, --fork-session, and named session flows are not exposed as separate launch commands.',
        'Keep app-managed worktrees as the cross-provider default and add provider-native launch extras only behind an advanced sheet.'
      )
    ],
    probes: [
      probe('version', 'Version', ['--version'], 'version'),
      probe('help', 'Help', ['--help'], 'help'),
      probe('agents-help', 'Agents', ['agents', '--help'], 'help'),
      probe('mcp-help', 'MCP', ['mcp', '--help'], 'mcp'),
      probe('plugin-help', 'Plugins', ['plugin', '--help'], 'extensions'),
      probe('ultrareview-help', 'Ultrareview', ['ultrareview', '--help'], 'features')
    ],
    commandSurfaces: [
      commandSurface('auth-status', 'Auth status', 'runtime', ['auth', 'status'], 'headless', 'none', false, 'settings', { featureId: 'auth' }),
      commandSurface('agents-list', 'Configured agents', 'agents', ['agents'], 'headless', 'none', false, 'settings', { featureId: 'agents' }),
      commandSurface('mcp-list', 'MCP servers', 'mcp', ['mcp', 'list'], 'headless', 'none', false, 'settings', { featureId: 'mcp' }),
      commandSurface('mcp-details', 'MCP details', 'mcp', ['mcp', 'get'], 'headless', 'none', false, 'settings', { featureId: 'mcp', note: 'Runs mcp list, then mcp get for each discovered server.' }),
      commandSurface('plugin-list', 'Plugins', 'extensions', ['plugin', 'list', '--json'], 'headless', 'none', false, 'settings', { featureId: 'plugins' }),
      commandSurface('auto-mode-defaults', 'Auto mode defaults', 'permissions', ['auto-mode', 'defaults'], 'headless', 'none', false, 'settings', { featureId: 'auto-mode' }),
      commandSurface('project-purge', 'Purge project state', 'workspace', ['project', 'purge'], 'headless', 'none', true, 'settings', { featureId: 'project-state' }),
      commandSurface('ultrareview-json', 'Ultrareview JSON', 'review', ['ultrareview', '--json'], 'headless', 'may-use-quota', false, 'composer', { featureId: 'ultrareview' }),
      commandSurface('interactive-session', 'Interactive session', 'runtime', [], 'interactive', 'may-use-quota', false, 'composer', { featureId: 'interactive-cli' })
    ],
    slashCommands: [
      slashCommand('/review', 'Run Claude ultrareview against the current changes', 'provider', 'headless', 'insert-prompt', {
        featureId: 'ultrareview',
        prompt: 'Review the current changes with Claude ultrareview-style depth. Focus on correctness, regressions, and missing tests.'
      }),
      slashCommand('/agents', 'Work with Claude agents', 'provider', 'interactive', 'send-to-provider', { featureId: 'agents' }),
      slashCommand('/mcp', 'Open Claude MCP command flow', 'provider', 'interactive', 'send-to-provider', { featureId: 'mcp' }),
      slashCommand('/plugins', 'Open Claude plugin command flow', 'provider', 'interactive', 'send-to-provider', { featureId: 'plugins' })
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
      feature('interactive', 'Interactive CLI', 'runtime', 'partial', 'local-cli', ['interactive'], 'Launch command and trust prompt are verified; native approval capture still needs a PTY runtime pass.'),
      feature('app-server', 'App server', 'runtime', 'partial', 'local-cli', ['app-server'], 'Protocol schema exposes approvals, questions, MCP elicitation, diffs, and agents; runtime wiring is still deferred.'),
      feature('mcp-elicitation', 'Elicitation', 'permissions', 'partial', 'local-cli', ['interactive']),
      feature('sandbox', 'Sandbox', 'permissions', 'supported', 'adapter', ['headless', 'interactive']),
      feature('slash-commands', 'Commands', 'commands', 'partial', 'local-cli', ['interactive']),
      feature('multi-agent', 'Multi-agent', 'agents', 'supported', 'local-cli', ['interactive']),
      feature('mcp', 'MCP', 'mcp', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('plugins', 'Plugins', 'extensions', 'supported', 'local-cli', ['interactive']),
      feature('review', 'Review', 'review', 'supported', 'local-cli', ['headless']),
      feature('local-providers', 'Local models', 'runtime', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('images', 'Images', 'attachments', 'supported', 'local-cli', ['interactive'])
    ],
    gaps: [
      gap(
        'codex-interactive-approvals',
        'Interactive approvals',
        'permissions',
        'high',
        'partial',
        'codex exec is deterministic and does not expose native approval UI; the interactive CLI trust prompt and app-server approval protocol are now verified.',
        'Add a PTY-backed interactive lane or app-server runtime so approval requests can be answered from Orchestrator instead of only parsed from fixtures.'
      ),
      gap(
        'codex-mcp-elicitation',
        'MCP elicitation',
        'permissions',
        'high',
        'partial',
        'The CLI advertises MCP elicitation and app-server schema exposes mcpServer/elicitation/request; the adapter normalizes protocol fixtures to user_input.requested.',
        'Wire a live app-server or PTY transcript before marking this complete.'
      ),
      gap(
        'codex-app-server',
        'App server protocol',
        'runtime',
        'low',
        'partial',
        'codex app-server and exec-server exist, and generated v2 bindings show first-class approvals, questions, diffs, and agent items.',
        'Prototype app-server transport only if PTY cannot provide enough native CLI state.'
      ),
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
    commandSurfaces: [],
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
      feature('stream-json', 'Stream JSON', 'runtime', 'supported', 'adapter', ['headless']),
      feature('ask-mode', 'Ask mode', 'permissions', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('plan-mode', 'Plan mode', 'permissions', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('sandbox', 'Sandbox', 'permissions', 'supported', 'adapter', ['headless']),
      feature('mcp', 'MCP', 'mcp', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('worktrees', 'Worktrees', 'workspace', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('sessions', 'Chats', 'runtime', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('rules', 'Rules', 'extensions', 'supported', 'local-cli', ['headless']),
      feature('bedrock', 'Bedrock', 'runtime', 'supported', 'local-cli', ['headless', 'interactive']),
      feature('model-list', 'Models', 'usage', 'partial', 'local-cli', ['headless'], 'Local command can fail when keychain is unavailable.')
    ],
    gaps: [
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

function authStatusFromProbe(providerId: string, probe: { ok: boolean; output: string }): ProviderDiagnosticInfo['auth'] {
  if (/authentication required|not logged in|login|api key|unauthorized/i.test(probe.output)) {
    return { status: 'error', message: probe.output }
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
  } = {}
): ResolvedExecutionPolicy {
  return { policy: policyId, support, args, label, description, warning, ...details }
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
        controls: claudePermissionControls
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
        controls: claudePermissionControls
      }
    )
  }
  return policy(policyId, 'unsupported', [], policyId, 'Claude Code does not support this policy.', undefined, {
    intent: 'custom',
    interaction: 'none',
    controls: claudePermissionControls
  })
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
          events.push({
            type: rec.is_error === true ? 'agent.failed' : 'agent.completed',
            agent: {
              id: toolUseId,
              providerId: taskAgent.providerId,
              sessionId: taskAgent.sessionId,
              name: taskAgent.name,
              role: taskAgent.role,
              model: taskAgent.model,
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
    interactiveCli: true,
    interactivePermissions: true,
    allowedTools: true,
    workspaceSandbox: false,
    fullAccessMode: true
  },

  resolveExecutionPolicy: claudePolicy,

  buildStartCommand(request) {
    const args = ['-p', request.prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
    if (request.providerContext?.includeHookEvents) args.push('--include-hook-events')
    if (request.providerSessionId) args.push('--resume', request.providerSessionId)
    if (request.agentName && !request.providerSessionId) args.push('--agent', request.agentName)
    args.push('--model', request.model || 'sonnet')
    if (request.effort && request.effort !== 'normal') args.push('--effort', request.effort)
    args.push(...resolvedPolicyArgs(this, request.executionPolicy || 'default'))
    if (request.providerContext?.settingsPath) args.push('--settings', request.providerContext.settingsPath)
    if (request.allowedTools.length > 0) args.push('--allowedTools', request.allowedTools.join(','))
    if (request.disallowedTools?.length) args.push('--disallowedTools', request.disallowedTools.join(','))
    if (request.availableTools?.length) args.push('--tools', request.availableTools.join(','))
    if (request.additionalDirs?.length) args.push('--add-dir', ...request.additionalDirs)
    const fileSpecs = claudeFileSpecs(request.attachments)
    if (fileSpecs.length > 0) args.push('--file', ...fileSpecs)
    return command(this.binary, args)
  },

  buildResumeCommand(request) {
    return this.buildStartCommand({ ...request, prompt: request.prompt || 'Please continue.' })
  },

  buildInteractiveCommand(request) {
    const args: string[] = []
    if (request.providerSessionId) args.push('--resume', request.providerSessionId)
    if (request.agentName && !request.providerSessionId) args.push('--agent', request.agentName)
    args.push('--model', request.model || 'sonnet')
    if (request.effort && request.effort !== 'normal') args.push('--effort', request.effort)
    args.push(...interactivePolicyArgs(this, request.executionPolicy || 'default'))
    if (request.allowedTools.length > 0) args.push('--allowedTools', request.allowedTools.join(','))
    if (request.disallowedTools?.length) args.push('--disallowedTools', request.disallowedTools.join(','))
    if (request.availableTools?.length) args.push('--tools', request.availableTools.join(','))
    if (request.additionalDirs?.length) args.push('--add-dir', ...request.additionalDirs)
    const fileSpecs = claudeFileSpecs(request.attachments)
    if (fileSpecs.length > 0) args.push('--file', ...fileSpecs)
    if (request.prompt) args.push(request.prompt)
    return command(this.binary, args)
  },

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
        controls: copilotPermissionControls
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
      controls: copilotPermissionControls
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
    return this.buildStartCommand({ ...request, prompt: request.prompt || 'Please continue.' })
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
      'The current Orchestrator runtime uses codex exec, so approval policy is passed as config; native prompt surfacing needs the interactive CLI lane.',
      {
        intent: approvalPolicy.intent,
        interaction: 'headless',
        controls: codexPermissionControls
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
      'Verified in the Codex app-server v2 schema; current headless exec still cannot surface native approval prompts in Orchestrator.',
      {
        intent: 'ask',
        interaction: 'headless',
        controls: codexPermissionControls
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
        controls: codexPermissionControls
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
        controls: codexPermissionControls
      }
    )
  }
  return policy(policyId, 'unsupported', [], policyId, 'Codex does not support this policy in exec mode.', undefined, {
    intent: 'custom',
    interaction: 'none',
    controls: codexPermissionControls
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
      question: questionText,
      header: stringValue(rec.header, rec.title),
      options: options && options.length > 0 ? options : undefined,
      multiSelect: rec.multiSelect === true || rec.multiselect === true
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

  return null
}

function parseCodexAppServerItem(item: Record<string, unknown>): RunEvent[] {
  const itemType = stringValue(item.type)
  if (itemType === 'agentMessage') {
    const text = stringValue(item.text)
    return text ? [{ type: 'assistant.text', content: text }] : []
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
      content: stringifyContent(item.result ?? item.error ?? item.contentItems ?? ''),
      isError: status === 'failed' || item.error != null
    }]
  }

  if (itemType === 'collabAgentToolCall') {
    const id = stringValue(item.id) ?? uuidv4()
    const status = normalizeAgentStatus(stringValue(item.status))
    const eventType = status === 'completed'
      ? 'agent.completed'
      : status === 'failed'
        ? 'agent.failed'
        : 'agent.updated'
    return [{
      type: eventType,
      agent: {
        id,
        providerId: 'codex',
        sessionId: stringValue(item.senderThreadId) ?? '',
        name: stringValue(asRecord(item.tool)?.type, item.tool),
        role: stringValue(item.prompt),
        status,
        model: stringValue(item.model)
      }
    } as RunEvent]
  }

  return []
}

function parseCodexAppServerMessage(obj: Record<string, unknown>): RunEvent[] {
  const method = stringValue(obj.method)
  if (!method) return []

  const params = asRecord(obj.params) ?? {}
  const requestId = stringValue(obj.id)
  const events: RunEvent[] = []

  if (method === 'thread/started') {
    const thread = asRecord(params.thread)
    const threadId = stringValue(thread?.id, params.threadId)
    if (threadId) events.push({ type: 'session.started', providerSessionId: threadId })
  }

  if (method === 'turn/completed') events.push({ type: 'run.completed' })
  if (method === 'error') events.push({ type: 'run.failed', content: stringifyContent(params.message ?? params.error ?? obj.error) })

  if (method === 'item/started' || method === 'item/completed') {
    const item = asRecord(params.item)
    if (item) events.push(...parseCodexAppServerItem(item))
  }

  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
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
    interactivePermissions: false,
    allowedTools: false,
    workspaceSandbox: true,
    fullAccessMode: true
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
      controls: cursorPermissionControls
    })
  }
  if (policyId === 'sandbox') {
    return policy(policyId, 'exact', ['--sandbox', 'enabled', '--trust'], 'Sandbox', 'Requests Cursor sandbox mode.', undefined, {
      intent: 'workspaceSandbox',
      interaction: 'headless',
      controls: cursorPermissionControls
    })
  }
  return policy(
    policyId,
    'exact',
    ['--mode', 'ask', '--trust'],
    'Ask',
    'Cursor ask mode is read-only and does not apply edits.',
    undefined,
    {
      intent: 'ask',
      interaction: 'headless',
      controls: cursorPermissionControls
    }
  )
}

function effectiveCursorModel(request: RunRequest): string {
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
    return this.buildStartCommand({ ...request, prompt: request.prompt || 'Please continue.' })
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

async function runClaudeMcpDetailsAsync(providerId: string, surfaceId: string, binary: string): Promise<ProviderCommandSurfaceResult> {
  try {
    const { stdout } = await execFileAsync(binary, ['mcp', 'list'], {
      encoding: 'utf8',
      timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
      env: providerSpawnEnv(providerId),
      maxBuffer: 512 * 1024
    })
    const names = claudeMcpServerNames(String(stdout))
    const details = await Promise.all(names.map(async (name) => {
      try {
        const result = await execFileAsync(binary, ['mcp', 'get', name], {
          encoding: 'utf8',
          timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
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

export async function runProviderCommandSurfaceAsync(providerId: string, surfaceId: string): Promise<ProviderCommandSurfaceResult> {
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
  if (provider.id === 'claude' && surface.id === 'mcp-details') {
    return await runClaudeMcpDetailsAsync(provider.id, surface.id, binary)
  }

  try {
    const { stdout } = await execFileAsync(binary, surface.command, {
      encoding: 'utf8',
      timeout: PROVIDER_COMMAND_SURFACE_TIMEOUT_MS,
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
          auth: specific.auth,
          models: specific.models,
          usage: usageStatus(id),
          liveSmoke: {
            status: 'not-run',
            message: 'Run opt-in live smoke with cheap models to verify auth, model access, and parser behavior.'
          },
          probes: runProbeDefinitions(binary, registry.probes)
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
        auth: specific.auth,
        models: specific.models,
        usage: usageStatus(id),
        liveSmoke: {
          status: 'not-run',
          message: 'Run opt-in live smoke with cheap models to verify auth, model access, and parser behavior.'
        },
        probes
      } satisfies ProviderDiagnosticInfo
    ] as const
  }))

  return Object.fromEntries(diagnostics)
}
