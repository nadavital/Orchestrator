import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RunEvent } from '../types'

interface HookRegistration {
  sessionId: string
  settingsPath: string
}

interface PendingApproval {
  sessionId: string
  toolName: string
  resolve: (decision: ApprovalDecision) => void
  timeout: NodeJS.Timeout
}

interface ApprovalDecision {
  approved: boolean
  reason?: string
}

interface HookToolRequest {
  tool_name?: string
  tool_use_id?: string
  tool_input?: Record<string, unknown>
  session_id?: string
  hook_event_name?: string
}

const SAFE_TOOLS = new Set([
  'Read',
  'LS',
  'Glob',
  'Grep',
  'TodoRead',
  'TodoWrite',
  'Task',
  'Agent',
  'TaskOutput',
  'BashOutput'
])

const CLAUDE_PERMISSION_MATCHER = '^(Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|WebSearch|DeleteFile|mcp__.*)$'
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000
const MAX_HOOK_BODY_BYTES = 1024 * 1024

function hookResponse(approved: boolean, reason?: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: approved ? 'allow' : 'deny',
      ...(reason ? { permissionDecisionReason: reason } : {})
    }
  }
}

function sendJson(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

export function buildClaudeHookSettings(port: number, secret: string, token: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: CLAUDE_PERMISSION_MATCHER,
          hooks: [
            {
              type: 'http',
              url: `http://127.0.0.1:${port}/hook/claude/pre-tool-use/${secret}/${token}`,
              timeout: 300
            }
          ]
        }
      ]
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<HookToolRequest> {
  let body = ''
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_HOOK_BODY_BYTES) throw new Error('Hook request too large')
    body += buffer.toString('utf8')
  }
  return JSON.parse(body) as HookToolRequest
}

export class ApprovalBroker {
  private server: Server | null = null
  private port: number | null = null
  private readonly secret = randomUUID()
  private readonly registrations = new Map<string, HookRegistration>()
  private readonly tokensBySession = new Map<string, string>()
  private readonly pending = new Map<string, PendingApproval>()
  private onEvents: ((sessionId: string, events: RunEvent[]) => void) | null = null

  setEventSink(sink: (sessionId: string, events: RunEvent[]) => void): void {
    this.onEvents = sink
  }

  async prepareClaudeRun(sessionId: string): Promise<{ settingsPath: string; dispose: () => void }> {
    await this.ensureServer()
    const token = randomUUID()
    const dir = join(tmpdir(), 'orchestrator-claude-hooks')
    mkdirSync(dir, { recursive: true, mode: 0o700 })

    const settingsPath = join(dir, `claude-hooks-${sessionId}-${token}.json`)
    const settings = buildClaudeHookSettings(this.port ?? 0, this.secret, token)
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 })

    this.registrations.set(token, { sessionId, settingsPath })
    this.tokensBySession.set(sessionId, token)

    return {
      settingsPath,
      dispose: () => this.disposeRegistration(sessionId, token)
    }
  }

  hasPendingApproval(sessionId: string): boolean {
    return [...this.pending.values()].some((approval) => approval.sessionId === sessionId)
  }

  resolveSessionApproval(sessionId: string, approved: boolean, reason?: string): boolean {
    const entry = [...this.pending.entries()].find(([, approval]) => approval.sessionId === sessionId)
    if (!entry) return false
    const [requestId, approval] = entry
    clearTimeout(approval.timeout)
    this.pending.delete(requestId)
    approval.resolve({ approved, reason })
    return true
  }

  disposeSession(sessionId: string): void {
    const token = this.tokensBySession.get(sessionId)
    if (token) this.disposeRegistration(sessionId, token)
    for (const [requestId, approval] of this.pending) {
      if (approval.sessionId !== sessionId) continue
      clearTimeout(approval.timeout)
      this.pending.delete(requestId)
      approval.resolve({ approved: false, reason: 'Run stopped.' })
    }
  }

  async handleClaudeHookForTest(sessionId: string, input: HookToolRequest): Promise<Record<string, unknown>> {
    return await this.handleToolRequest({ sessionId, settingsPath: '' }, input)
  }

  private async ensureServer(): Promise<void> {
    if (this.server && this.port) return

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => {
        const address = this.server?.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Approval broker failed to bind a local port'))
          return
        }
        this.port = address.port
        resolve()
      })
    })
  }

  private disposeRegistration(sessionId: string, token: string): void {
    const registration = this.registrations.get(token)
    this.registrations.delete(token)
    if (this.tokensBySession.get(sessionId) === token) this.tokensBySession.delete(sessionId)
    if (registration?.settingsPath) rmSync(registration.settingsPath, { force: true })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendJson(res, 404, hookResponse(false, 'Not found'))
      return
    }

    const segments = (req.url ?? '').split('/').filter(Boolean)
    if (segments.length !== 5 || segments[0] !== 'hook' || segments[1] !== 'claude' || segments[2] !== 'pre-tool-use') {
      sendJson(res, 404, hookResponse(false, 'Invalid hook path'))
      return
    }
    if (segments[3] !== this.secret) {
      sendJson(res, 403, hookResponse(false, 'Invalid hook credentials'))
      return
    }

    const registration = this.registrations.get(segments[4])
    if (!registration) {
      sendJson(res, 403, hookResponse(false, 'Unknown run'))
      return
    }

    let input: HookToolRequest
    try {
      input = await readJsonBody(req)
    } catch {
      sendJson(res, 400, hookResponse(false, 'Invalid hook payload'))
      return
    }

    if (input.hook_event_name && input.hook_event_name !== 'PreToolUse') {
      sendJson(res, 400, hookResponse(false, 'Unexpected hook event'))
      return
    }

    const decision = await this.handleToolRequest(registration, input)
    sendJson(res, 200, decision)
  }

  private async handleToolRequest(
    registration: HookRegistration,
    input: HookToolRequest
  ): Promise<Record<string, unknown>> {
    const toolName = input.tool_name ?? 'tool'
    if (SAFE_TOOLS.has(toolName)) return hookResponse(true)

    const requestId = randomUUID()
    const decision = await new Promise<ApprovalDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ approved: false, reason: 'Approval timed out.' })
      }, APPROVAL_TIMEOUT_MS)
      this.pending.set(requestId, {
        sessionId: registration.sessionId,
        toolName,
        resolve,
        timeout
      })

      this.onEvents?.(registration.sessionId, [{
        type: 'permission.requested',
        content: `${toolName} needs approval.`,
        denials: [{
          tool_name: toolName,
          tool_use_id: input.tool_use_id ?? requestId,
          tool_input: input.tool_input ?? {}
        }]
      }])
    })

    return hookResponse(decision.approved, decision.reason)
  }
}

export const approvalBroker = new ApprovalBroker()
