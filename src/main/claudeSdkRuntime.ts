import { z } from 'zod/v4'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RunEvent, RunRequest, Session } from '../types'
import { approvalBroker } from './approvalBroker'
import type { ProviderAdapter } from './providers'
import { normalizeClaudeMessageObject, providerSpawnEnv } from './providers'
import { browserProviderHostToolBridge, type ProviderHostToolBridge } from './providerHostTools'
import { recordProviderRuntimeDebugEvent, updateProviderRuntimeConnection } from './providerRuntimeDiagnostics'

type ClaudeAgentSdk = typeof import('@anthropic-ai/claude-agent-sdk')
type SdkOptions = NonNullable<Parameters<ClaudeAgentSdk['query']>[0]['options']>
type SdkMcpServer = NonNullable<SdkOptions['mcpServers']>[string]
type SdkPrompt = Parameters<ClaudeAgentSdk['query']>[0]['prompt']
type SdkPromptStream = Extract<SdkPrompt, AsyncIterable<unknown>>
type SdkUserMessage = Extract<SdkPromptStream extends AsyncIterable<infer T> ? T : never, { type: 'user' }>
type PermissionMode = NonNullable<SdkOptions['permissionMode']>

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>
const requireForResolution = new Function('return typeof require === "function" ? require : undefined')() as NodeRequire | undefined

interface ResolveClaudeSdkExecutablePathOptions {
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  resourcesPath?: string
  resolve?: (specifier: string) => string
  exists?: (path: string) => boolean
}

export interface StartClaudeSdkRunOptions {
  sessionId: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  mode: 'start' | 'resume'
  onRawData: (data: string) => void
  onParsedEvents: (events: RunEvent[]) => void
  onExit: () => void
}

export interface ClaudeSdkRunStartResult {
  ok: boolean
  message?: string
}

export interface RunClaudeSdkOneShotOptions {
  sessionId?: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  timeoutMs?: number
  maxBudgetUsd?: number
  hostToolBridge?: ProviderHostToolBridge
}

export interface ClaudeSdkOneShotResult {
  raw: string
  events: RunEvent[]
}

interface ActiveClaudeSdkRun {
  abortController: AbortController
}

type ClaudeSdkRunContext = StartClaudeSdkRunOptions & {
  hostToolBridge: ProviderHostToolBridge
}

export class ClaudeSdkRuntimeManager {
  private readonly activeRuns = new Map<string, ActiveClaudeSdkRun>()

  constructor(private readonly hostToolBridge: ProviderHostToolBridge = browserProviderHostToolBridge()) {}

  has(sessionId: string): boolean {
    return this.activeRuns.has(sessionId)
  }

  start(options: StartClaudeSdkRunOptions): ClaudeSdkRunStartResult {
    if (this.activeRuns.has(options.sessionId)) {
      return { ok: false, message: 'Claude SDK runtime already has an active run for this session.' }
    }

    const abortController = new AbortController()
    this.activeRuns.set(options.sessionId, { abortController })
    approvalBroker.prepareClaudeSdkRun(options.sessionId, options.request.allowedTools ?? [])

    recordProviderRuntimeDebugEvent({
      providerId: options.provider.id,
      runtime: 'sdk',
      sessionId: options.sessionId,
      message: 'Starting Claude SDK runtime.'
    })
    updateProviderRuntimeConnection({
      providerId: options.provider.id,
      runtime: 'sdk',
      sessionId: options.sessionId,
      status: 'starting',
      message: 'Starting Claude SDK runtime.'
    })

    void this.run(options, abortController)
    return { ok: true }
  }

  stop(sessionId: string): boolean {
    const run = this.activeRuns.get(sessionId)
    if (!run) return false
    this.activeRuns.delete(sessionId)
    approvalBroker.disposeSession(sessionId)
    run.abortController.abort()
    recordProviderRuntimeDebugEvent({
      providerId: 'claude',
      runtime: 'sdk',
      sessionId,
      severity: 'debug',
      message: 'Stopped Claude SDK runtime.'
    })
    updateProviderRuntimeConnection({
      providerId: 'claude',
      runtime: 'sdk',
      sessionId,
      status: 'stopped',
      message: 'Stopped Claude SDK runtime.'
    })
    return true
  }

  private async run(options: StartClaudeSdkRunOptions, abortController: AbortController): Promise<void> {
    try {
      const sdk = await importClaudeAgentSdk()
      const sdkOptions = buildSdkOptions(sdk, { ...options, hostToolBridge: this.hostToolBridge }, abortController)
      updateProviderRuntimeConnection({
        providerId: options.provider.id,
        runtime: 'sdk',
        sessionId: options.sessionId,
        hostId: '@anthropic-ai/claude-agent-sdk',
        status: 'connected',
        message: 'Started Claude SDK runtime.'
      })

      for await (const message of sdk.query({ prompt: claudeSdkPromptForRequest(options.request), options: sdkOptions })) {
        if (this.activeRuns.get(options.sessionId)?.abortController !== abortController) return
        const raw = `${JSON.stringify(message)}\n`
        options.onRawData(raw)
        options.onParsedEvents(normalizeClaudeMessageObject(message as Record<string, unknown>, options.provider.id))
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
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
      if (this.activeRuns.get(options.sessionId)?.abortController === abortController) {
        this.activeRuns.delete(options.sessionId)
      }
      approvalBroker.disposeSession(options.sessionId)
      updateProviderRuntimeConnection({
        providerId: options.provider.id,
        runtime: 'sdk',
        sessionId: options.sessionId,
        status: abortController.signal.aborted ? 'stopped' : 'disconnected',
        message: abortController.signal.aborted ? 'Claude SDK runtime stopped.' : 'Claude SDK runtime exited.'
      })
      options.onExit()
    }
  }
}

export function claudeSdkPromptForRequest(request: Pick<RunRequest, 'prompt' | 'attachments'>): SdkPrompt {
  const content = claudeSdkContentBlocksForRequest(request)
  if (content.length === 1 && content[0]?.type === 'text') return request.prompt

  return (async function* (): AsyncGenerator<SdkUserMessage> {
    yield {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: content as unknown as SdkUserMessage['message']['content']
      }
    } as unknown as SdkUserMessage
  })()
}

export function claudeSdkContentBlocksForRequest(request: Pick<RunRequest, 'prompt' | 'attachments'>): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }]
  for (const attachment of request.attachments ?? []) {
    if (attachment.kind !== 'claude_file') continue
    const fileId = attachment.fileId.trim()
    const relativePath = attachment.relativePath.trim()
    if (!fileId || !relativePath) continue
    const blockType = claudeSdkContentBlockTypeForPath(relativePath)
    const block: Record<string, unknown> = {
      type: blockType,
      source: {
        type: 'file',
        file_id: fileId
      }
    }
    if (blockType === 'document') {
      block.title = attachment.name?.trim() || relativePath
      block.context = `Attached provider file resource: ${relativePath}`
    }
    blocks.push(block)
  }
  return blocks
}

export async function runClaudeSdkOneShot(options: RunClaudeSdkOneShotOptions): Promise<ClaudeSdkOneShotResult> {
  const sdk = await importClaudeAgentSdk()
  const abortController = new AbortController()
  const sessionId = options.sessionId ?? `claude-sdk-one-shot-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const events: RunEvent[] = []
  let raw = ''
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, options.timeoutMs ?? 90_000)

  approvalBroker.prepareClaudeSdkRun(sessionId, options.request.allowedTools ?? [])

  try {
    const sdkOptions = buildSdkOptions(sdk, {
      sessionId,
      session: options.session,
      provider: options.provider,
      request: { ...options.request, runtime: 'sdk' },
      mode: 'start',
      onRawData: (data) => { raw += data },
      onParsedEvents: (parsedEvents) => { events.push(...parsedEvents) },
      onExit: () => {},
      hostToolBridge: options.hostToolBridge ?? browserProviderHostToolBridge()
    }, abortController)
    if (typeof options.maxBudgetUsd === 'number') {
      ;(sdkOptions as SdkOptions & { maxBudgetUsd?: number }).maxBudgetUsd = options.maxBudgetUsd
    }

    for await (const message of sdk.query({ prompt: claudeSdkPromptForRequest(options.request), options: sdkOptions })) {
      const line = `${JSON.stringify(message)}\n`
      raw += line
      events.push(...normalizeClaudeMessageObject(message as Record<string, unknown>, options.provider.id))
    }
  } catch (error) {
    if (timedOut) {
      events.push({ type: 'run.failed', content: `Claude SDK run timed out after ${options.timeoutMs ?? 90_000}ms.` })
    } else if (!abortController.signal.aborted) {
      events.push({ type: 'run.failed', content: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    clearTimeout(timeout)
    approvalBroker.disposeSession(sessionId)
  }

  return { raw, events }
}

async function importClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  return await importEsm('@anthropic-ai/claude-agent-sdk') as ClaudeAgentSdk
}

export function claudeSdkAgentTeamsEnabled(
  session: Pick<Session, 'providerProjectlessThreadId'>,
  request: Pick<RunRequest, 'providerSessionId'>
): boolean {
  const providerSessionId = request.providerSessionId?.trim()
  const agentId = session.providerProjectlessThreadId?.trim()
  return Boolean(providerSessionId && agentId && providerSessionId !== agentId)
}

function buildSdkOptions(
  sdk: ClaudeAgentSdk,
  options: ClaudeSdkRunContext,
  abortController: AbortController
): SdkOptions {
  const request = options.request
  const permissionMode = claudeSdkPermissionMode(request.executionPolicy)
  const agentTeamsEnabled = claudeSdkAgentTeamsEnabled(options.session, request)
  const sdkOptions: SdkOptions = {
    abortController,
    cwd: options.session.workDir || request.cwd,
    env: {
      ...providerSpawnEnv('claude'),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'orchestrator/claude-sdk-runtime',
      ...(agentTeamsEnabled ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } : {})
    },
    includePartialMessages: true,
    includeHookEvents: true,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    model: request.model || undefined,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
    pathToClaudeCodeExecutable: resolveClaudeSdkExecutablePath(),
    allowedTools: request.allowedTools?.length ? request.allowedTools : undefined,
    disallowedTools: request.disallowedTools?.length ? request.disallowedTools : undefined,
    tools: request.availableTools?.length ? request.availableTools : undefined,
    additionalDirectories: request.additionalDirs?.length ? request.additionalDirs : undefined,
    agent: request.agentName && !request.providerSessionId ? request.agentName : undefined,
    resume: request.providerSessionId || undefined,
    canUseTool: async (toolName, input, details) => {
      if (toolName === 'AskUserQuestion') {
        options.onParsedEvents(normalizeClaudeMessageObject({
          type: 'assistant',
          session_id: details.toolUseID,
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: details.toolUseID,
              name: toolName,
              input
            }]
          }
        }, options.provider.id))
        return {
          behavior: 'deny',
          message: 'AskUserQuestion was handled by Orchestrator UI.',
          toolUseID: details.toolUseID
        }
      }

      const decision = await approvalBroker.handleClaudeSdkPermission(options.sessionId, {
        toolName,
        toolUseId: details.toolUseID,
        toolInput: input
      })
      return decision.approved
        ? { behavior: 'allow', updatedInput: input, toolUseID: details.toolUseID }
        : { behavior: 'deny', message: decision.reason ?? 'Denied by Orchestrator.', toolUseID: details.toolUseID }
    },
    mcpServers: {
      orchestrator: createBrowserSdkMcpServer(sdk, options.sessionId, options.hostToolBridge, options.onParsedEvents)
    }
  }

  if (request.effort && request.effort !== 'normal') {
    sdkOptions.effort = request.effort as SdkOptions['effort']
  }

  return sdkOptions
}

export function resolveClaudeSdkExecutablePath(options: ResolveClaudeSdkExecutablePathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const platformPackage = claudeSdkPlatformPackage(platform, arch)
  if (!platformPackage) return undefined

  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude'
  const exists = options.exists ?? existsSync
  const resolve = options.resolve ?? requireForResolution?.resolve
  const resourcesPath = options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates: string[] = []

  if (resourcesPath) {
    candidates.push(
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', platformPackage, binaryName),
      join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'node_modules', '@anthropic-ai', platformPackage, binaryName)
    )
  }

  if (resolve) {
    for (const specifier of [
      `@anthropic-ai/${platformPackage}/${binaryName}`,
      `@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/${platformPackage}/${binaryName}`
    ]) {
      try {
        const resolved = resolve(specifier)
        candidates.push(unpackedAsarPath(resolved), resolved)
      } catch {
        // Optional platform packages are only present for the current install target.
      }
    }
  }

  return candidates.find((candidate) => exists(candidate))
}

function claudeSdkPlatformPackage(platform: NodeJS.Platform, arch: NodeJS.Architecture): string | undefined {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `claude-agent-sdk-darwin-${arch}`
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) return `claude-agent-sdk-linux-${arch}`
  if (platform === 'win32' && (arch === 'arm64' || arch === 'x64')) return `claude-agent-sdk-win32-${arch}`
  return undefined
}

function unpackedAsarPath(path: string): string {
  return path.replace(`${join('app.asar')}/`, `${join('app.asar.unpacked')}/`)
}

function claudeSdkPermissionMode(policy: string): PermissionMode {
  if (policy === 'yolo') return 'bypassPermissions'
  if (policy === 'bypassPermissions') return 'bypassPermissions'
  if (policy === 'acceptEdits') return 'acceptEdits'
  if (policy === 'auto') return 'auto'
  if (policy === 'dontAsk') return 'dontAsk'
  if (policy === 'plan') return 'plan'
  return 'default'
}

function claudeSdkContentBlockTypeForPath(relativePath: string): 'image' | 'document' {
  const lower = relativePath.toLowerCase()
  if (/\.(png|jpe?g|gif|webp)$/.test(lower)) return 'image'
  return 'document'
}

function createBrowserSdkMcpServer(
  sdk: ClaudeAgentSdk,
  sessionId: string,
  hostToolBridge: ProviderHostToolBridge,
  onParsedEvents: (events: RunEvent[]) => void
): SdkMcpServer {
  return sdk.createSdkMcpServer({
    name: 'orchestrator',
    version: '1.0.0',
    instructions: 'Orchestrator host tools backed by the app Browser panel.',
    tools: hostToolBridge.dynamicTools.map((spec) => {
      const record = spec as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name : 'unknown'
      const description = typeof record.description === 'string' ? record.description : name
      const namespace = typeof record.namespace === 'string' ? record.namespace : 'orchestrator'
      return sdk.tool(
        name,
        description,
        zodShapeFromJsonSchema(record.inputSchema),
        async (args) => {
          if (!hostToolBridge.isSupported(namespace, name)) {
            return { isError: true, content: [{ type: 'text', text: `Unsupported Orchestrator tool: ${namespace}.${name}` }] }
          }
          onParsedEvents([
            {
              type: 'browser.manager_state',
              active: true,
              open: true
            },
            {
              type: 'assistant.status',
              content: `Browser tool requested: mcp__${namespace}__${name}`
            }
          ])
          const response = await hostToolBridge.call({
            sessionId,
            namespace,
            tool: name,
            arguments: args as Record<string, unknown>
          })
          return {
            isError: response.success === false,
            content: response.contentItems.map((item) => ({ type: 'text' as const, text: item.text }))
          }
        }
      )
    })
  })
}

function zodShapeFromJsonSchema(schema: unknown): Record<string, z.ZodType> {
  const record = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : {}
  const properties = record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : {}
  const required = new Set(Array.isArray(record.required) ? record.required.filter((item): item is string => typeof item === 'string') : [])

  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      const base = zodTypeFromJsonSchema(value)
      return [key, required.has(key) ? base : base.optional()]
    })
  )
}

function zodTypeFromJsonSchema(schema: unknown): z.ZodType {
  const record = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? schema as Record<string, unknown>
    : {}
  if (record.type === 'string') return z.string()
  if (record.type === 'number' || record.type === 'integer') return z.number()
  if (record.type === 'boolean') return z.boolean()
  if (record.type === 'array') return z.array(z.unknown())
  if (record.type === 'object') return z.record(z.string(), z.unknown())
  return z.unknown()
}
