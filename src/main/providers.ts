import { v4 as uuidv4 } from 'uuid'
import { accessSync, constants } from 'fs'
import { execFileSync } from 'child_process'
import type {
  PermissionDenial,
  ProviderCapability,
  ProviderCapabilities,
  ProviderCommand,
  PermissionIntent,
  PermissionInteraction,
  PermissionRuntimeControl,
  ProviderDiagnosticInfo,
  ProviderRuntimeInfo,
  ResolvedExecutionPolicy,
  RunEvent,
  RunRequest,
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

export function resolveProviderBinary(provider: ProviderAdapter): string | null {
  const candidates = provider.binaryCandidates ?? [provider.binary]
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (isExecutablePath(candidate)) return candidate
      continue
    }
    try {
      return execFileSync('which', [candidate], { encoding: 'utf8' }).trim()
    } catch {
      // Try the next known binary candidate.
    }
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
  parseOutputLine(line: string): RunEvent[]
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

function probeCommand(binary: string, args: string[], timeout = 10_000): { ok: boolean; output: string } {
  const result = probeCommandFull(binary, args, timeout)
  return {
    ok: result.ok,
    output: result.output.trim().split('\n')[0] ?? ''
  }
}

function probeCommandFull(binary: string, args: string[], timeout = 10_000): { ok: boolean; output: string } {
  try {
    const output = execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout
    })
    return { ok: true, output: output.trim() }
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = typeof err.stderr === 'string'
      ? err.stderr.trim()
      : err.stderr?.toString('utf8').trim()
    const stdout = typeof err.stdout === 'string'
      ? err.stdout.trim()
      : err.stdout?.toString('utf8').trim()
    return {
      ok: false,
      output: stderr || stdout || err.message || 'probe failed'
    }
  }
}

function versionArgs(providerId: string): string[] {
  return providerId === 'cursor' ? ['--version'] : ['--version']
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
    examples: ['default', 'acceptEdits', 'plan', 'bypassPermissions']
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
    description: 'Claude supports --disallowedTools; the GUI still needs first-class controls for it.',
    support: 'planned',
    examples: ['Bash(git push)', 'WebFetch']
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
    description: 'Codex interactive mode supports --ask-for-approval, but codex exec does not.',
    support: 'planned',
    examples: ['--ask-for-approval on-request', '--ask-for-approval untrusted']
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
  if (['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(policyId)) {
    const intentByPolicy: Record<string, PermissionIntent> = {
      default: 'ask',
      acceptEdits: 'autoEdit',
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

function parseAnthropicStyleLine(line: string): RunEvent[] {
  const event = parseJsonLine(line)
  if (!event) return []

  const events: RunEvent[] = []
  const type = event.type as string | undefined

  if (type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
    events.push({ type: 'session.started', providerSessionId: event.session_id })
  }

  if (type === 'assistant') {
    const message = asRecord(event.message)
    for (const text of textFromContentBlocks(message?.content)) {
      events.push({ type: 'assistant.text', content: text })
    }
    const content = Array.isArray(message?.content) ? message.content : []
    for (const block of content) {
      const rec = asRecord(block)
      if (rec?.type === 'tool_use') {
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
        const userInputRequest = parseStructuredUserInputRequest(rec.content)
        if (userInputRequest) {
          events.push({ type: 'user_input.requested', ...userInputRequest })
          continue
        }
        events.push({
          type: 'tool.completed',
          id: uuidv4(),
          toolUseId: typeof rec.tool_use_id === 'string' ? rec.tool_use_id : '',
          content: stringifyContent(rec.content),
          isError: rec.is_error === true
        })
      }
    }
  }

  if (type === 'result') {
    const denials = Array.isArray(event.permission_denials)
      ? event.permission_denials as PermissionDenial[]
      : []
    if (denials.length > 0) {
      events.push({
        type: 'permission.requested',
        content: typeof event.result === 'string' ? event.result : undefined,
        denials
      })
    } else if (event.subtype === 'success' || event.is_error === false) {
      events.push({ type: 'run.completed', content: typeof event.result === 'string' ? event.result : undefined })
    } else {
      events.push({ type: 'run.failed', content: typeof event.result === 'string' ? event.result : undefined })
    }
  }

  return events
}

// Claude Code

const claudeProvider: ProviderAdapter = {
  id: 'claude',
  binary: 'claude',
  capabilities: {
    resume: true,
    streamingJson: true,
    interactivePermissions: true,
    allowedTools: true,
    workspaceSandbox: false,
    fullAccessMode: true
  },

  resolveExecutionPolicy: claudePolicy,

  buildStartCommand(request) {
    const args = ['-p', request.prompt, '--output-format', 'stream-json', '--verbose']
    if (request.providerSessionId) args.push('--resume', request.providerSessionId)
    args.push('--model', request.model || 'claude-sonnet-4-6')
    if (request.effort && request.effort !== 'normal') args.push('--effort', request.effort)
    args.push(...resolvedPolicyArgs(this, request.executionPolicy || 'default'))
    if (request.allowedTools.length > 0) args.push('--allowedTools', request.allowedTools.join(','))
    return command(this.binary, args)
  },

  buildResumeCommand(request) {
    return this.buildStartCommand({ ...request, prompt: request.prompt || 'Please continue.' })
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
    '/Users/navital/.nvm/versions/node/v22.12.0/bin/copilot'
  ],
  capabilities: {
    resume: true,
    streamingJson: true,
    interactivePermissions: false,
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

  parseOutputLine(line) {
    const obj = parseJsonLine(line)
    if (!obj) return []

    const events: RunEvent[] = []
    const type = obj.type as string | undefined
    const data = asRecord(obj.data)

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

    return events
  }
}

// OpenAI Codex CLI

function codexPolicy(policyId: string): ResolvedExecutionPolicy {
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
  if (policyId === 'default' || policyId === 'workspaceWrite') {
    return policy(
      policyId,
      'exact',
      ['--sandbox', 'workspace-write'],
      'Workspace write',
      'Allows writes in the workspace sandbox.',
      'Codex exec does not expose interactive approval prompts; denied operations are returned to the agent.',
      {
        intent: 'workspaceSandbox',
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

const codexProvider: ProviderAdapter = {
  id: 'codex',
  binary: 'codex',
  binaryCandidates: [
    'codex',
    '/Users/navital/.nvm/versions/node/v22.12.0/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex'
  ],
  capabilities: {
    resume: true,
    streamingJson: true,
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

  parseOutputLine(line) {
    const obj = parseJsonLine(line)
    if (!obj) return []

    const events: RunEvent[] = []
    const type = obj.type as string | undefined

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
  capabilities: {
    resume: true,
    streamingJson: true,
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

  parseOutputLine(line) {
    const obj = parseJsonLine(line)
    if (!obj) return []

    const events = parseAnthropicStyleLine(line)
    const type = obj.type as string | undefined
    const subtype = obj.subtype as string | undefined

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

export function getProviderRuntimeInfo(): Record<string, ProviderRuntimeInfo> {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, provider]) => {
      const providerDef = PROVIDER_DEFS[id]
      const policyIds = providerDef?.permissionModes.map((mode) => mode.id) ?? ['default']
      return [
        id,
        {
          id,
          capabilities: provider.capabilities,
          abstractCapabilities: baseCapabilities(provider),
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
          }
        } satisfies ProviderDiagnosticInfo
      ]
    })
  )
}
