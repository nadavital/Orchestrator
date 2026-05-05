import { v4 as uuidv4 } from 'uuid'
import type { Session, ChatMessage, PermissionDenial } from '../types'
import { PROVIDER_DEFS } from '../types'
import { parseStreamEvent, eventToMessages } from './parser'

export interface ParsedLine {
  messages: ChatMessage[]
  capturedSessionId?: string
}

export interface Provider {
  id: string
  binary: string
  buildArgs(session: Session, prompt: string): string[]
  buildResumeArgs?(session: Session): string[]
  parseLine(line: string): ParsedLine | null
}

// ─── Claude Code ──────────────────────────────────────────────────────────────

const claudeProvider: Provider = {
  id: 'claude',
  binary: 'claude',

  buildArgs(session, prompt) {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']
    if (session.claudeSessionId) args.push('--resume', session.claudeSessionId)
    args.push('--model', session.model || 'claude-sonnet-4-6')
    if (session.effort && session.effort !== 'normal') args.push('--effort', session.effort)
    const perm = session.permissionMode || 'default'
    if (perm === 'default') {
      args.push('--permission-mode', 'acceptEdits')
    } else {
      args.push('--permission-mode', perm)
    }
    if (session.allowedTools && session.allowedTools.length > 0) {
      args.push('--allowedTools', session.allowedTools.join(','))
    }
    return args
  },

  parseLine(line) {
    const event = parseStreamEvent(line)
    if (!event) return null
    const messages = eventToMessages(event)
    const capturedSessionId =
      event.type === 'system' && event.subtype === 'init' && event.session_id
        ? event.session_id
        : undefined
    return { messages, capturedSessionId }
  }
}

// ─── GitHub Copilot CLI ───────────────────────────────────────────────────────

const copilotProvider: Provider = {
  id: 'copilot',
  binary: 'copilot',

  buildArgs(session, prompt) {
    // --allow-all-tools is required for non-interactive mode
    const args = ['-p', prompt, '--output-format', 'json', '--allow-all-tools']
    if (session.claudeSessionId) args.push(`--resume=${session.claudeSessionId}`)
    args.push('--model', session.model || 'claude-sonnet-4.6')
    if (session.effort) args.push('--effort', session.effort)
    if ((session.permissionMode ?? 'default') === 'yolo') args.push('--yolo')
    return args
  },

  buildResumeArgs(session) {
    const args = ['--allow-all-tools', '--output-format', 'json', '-p', 'Please continue.']
    if (session.claudeSessionId) args.push(`--resume=${session.claudeSessionId}`)
    args.push('--model', session.model || 'claude-sonnet-4.6')
    if ((session.permissionMode ?? 'default') === 'yolo') args.push('--yolo')
    return args
  },

  parseLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return null
    let obj: Record<string, unknown>
    try { obj = JSON.parse(trimmed) } catch { return null }

    const messages: ChatMessage[] = []
    let capturedSessionId: string | undefined
    const type = obj.type as string
    const data = obj.data as Record<string, unknown> | undefined

    // Final result — sessionId lives at top level here (not in data)
    if (type === 'result') {
      if (typeof obj.sessionId === 'string') capturedSessionId = obj.sessionId
      const exitCode = (obj.exitCode as number) ?? 0
      messages.push({
        id: uuidv4(), role: 'system', type: 'result',
        content: '', subtype: exitCode === 0 ? 'success' : 'error_during_execution',
        timestamp: Date.now()
      })
    }

    // Assistant text + tool requests
    if (type === 'assistant.message' && data) {
      const content = data.content as string | undefined
      if (content) {
        messages.push({ id: uuidv4(), role: 'assistant', type: 'text', content, timestamp: Date.now() })
      }
      const toolRequests = (data.toolRequests ?? []) as Array<Record<string, unknown>>
      for (const req of toolRequests) {
        messages.push({
          id: (req.toolCallId as string) ?? uuidv4(),
          role: 'assistant', type: 'tool_use',
          toolName: (req.name as string) ?? 'unknown',
          toolInput: (req.arguments as Record<string, unknown>) ?? {},
          timestamp: Date.now()
        })
      }
    }

    // Tool result
    if (type === 'tool.execution_complete' && data) {
      const result = data.result as Record<string, unknown> | undefined
      const content = String(result?.detailedContent ?? result?.content ?? '')
      messages.push({
        id: uuidv4(), role: 'tool', type: 'tool_result',
        toolUseId: (data.toolCallId as string) ?? uuidv4(),
        content, isError: data.success === false,
        timestamp: Date.now()
      })
    }

    return { messages, capturedSessionId }
  }
}

// ─── OpenAI Codex CLI ─────────────────────────────────────────────────────────

const codexProvider: Provider = {
  id: 'codex',
  binary: 'codex',

  buildArgs(session, prompt) {
    const args = ['exec', '--json', '--skip-git-repo-check']
    const perm = session.permissionMode ?? 'default'
    if (perm === 'yolo') {
      args.push('--dangerously-bypass-approvals-and-sandbox')
    } else if (perm === 'fullAccess') {
      args.push('--sandbox', 'danger-full-access')
    } else {
      args.push('--sandbox', 'workspace-write')
    }
    args.push('--model', session.model || 'gpt-5.4')
    if (session.effort) args.push('-c', `model_reasoning_effort="${session.effort}"`)
    args.push(prompt)
    return args
  },

  buildResumeArgs(session) {
    const args = ['exec', 'resume', '--json', '--skip-git-repo-check']
    if ((session.permissionMode ?? 'default') === 'yolo') {
      args.push('--dangerously-bypass-approvals-and-sandbox')
    }
    if (session.claudeSessionId) args.push(session.claudeSessionId)
    args.push('Permission granted. Please continue.')
    return args
  },

  parseLine(line) {
    const trimmed = line.trim()
    if (!trimmed) return null
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed)
    } catch {
      return null
    }

    const messages: ChatMessage[] = []
    let capturedSessionId: string | undefined
    const type = obj.type as string | undefined

    // Capture thread/session ID
    if (type === 'thread.started' && obj.thread_id) {
      capturedSessionId = obj.thread_id as string
    }

    // Agent text message
    if (type === 'agent_message') {
      const content = (obj.message ?? obj.content) as string | undefined
      if (content) {
        messages.push({
          id: uuidv4(), role: 'assistant', type: 'text', content, timestamp: Date.now()
        })
      }
    }

    // Shell / function tool call
    if (type === 'function_call' || type === 'exec_command_begin') {
      const toolName = (obj.name ?? obj.command ?? 'shell') as string
      const toolInput = (obj.arguments ?? obj.input ?? (obj.command ? { command: obj.command } : {})) as Record<string, unknown>
      messages.push({
        id: (obj.call_id as string) ?? uuidv4(),
        role: 'assistant', type: 'tool_use', toolName, toolInput, timestamp: Date.now()
      })
    }

    // Tool result
    if (type === 'function_call_output' || type === 'exec_command_end') {
      const content = String(obj.output ?? obj.result ?? '')
      messages.push({
        id: uuidv4(), role: 'tool', type: 'tool_result',
        toolUseId: (obj.call_id as string) ?? uuidv4(),
        content, isError: obj.error != null,
        timestamp: Date.now()
      })
    }

    // Completion
    if (type === 'turn.completed' || type === 'turn.failed') {
      const failed = type === 'turn.failed'
      const err = obj.error as Record<string, unknown> | string | undefined
      const errMsg = typeof err === 'object' ? String(err?.message ?? '') : String(err ?? '')
      messages.push({
        id: uuidv4(), role: 'system', type: 'result',
        content: errMsg,
        subtype: failed ? 'error_during_execution' : 'success',
        timestamp: Date.now()
      })
    }

    return { messages, capturedSessionId }
  }
}

// ─── Cursor CLI ───────────────────────────────────────────────────────────────

const cursorProvider: Provider = {
  id: 'cursor',
  binary: 'agent',

  buildArgs(session, prompt) {
    const modelDef = PROVIDER_DEFS.cursor?.models.find((m) => m.id === session.model)
    const effectiveModel =
      session.effort === 'thinking' && modelDef?.thinkingId
        ? modelDef.thinkingId
        : (session.model || 'auto')
    const args = ['--print', '--output-format', 'stream-json', '--force', '--trust']
    if (session.claudeSessionId) args.push('--resume', session.claudeSessionId)
    args.push('--model', effectiveModel)
    const perm = session.permissionMode ?? 'default'
    if (perm === 'yolo') {
      args.push('--yolo')
    } else if (perm === 'sandbox') {
      args.push('--sandbox', 'enabled')
    }
    args.push(prompt)
    return args
  },

  parseLine(line) {
    // Cursor uses the same stream-json format as Claude Code (both built on Anthropic SDK)
    return claudeProvider.parseLine(line)
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PROVIDERS: Record<string, Provider> = {
  claude: claudeProvider,
  copilot: copilotProvider,
  codex: codexProvider,
  cursor: cursorProvider
}

export function getProvider(id: string): Provider {
  return PROVIDERS[id] ?? PROVIDERS.claude
}
