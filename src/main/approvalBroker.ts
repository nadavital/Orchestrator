import { randomUUID } from 'crypto'
import { isAbsolute, relative, resolve } from 'path'
import { homedir } from 'os'
import type { RunEvent } from '../types'

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

interface ClaudeToolPermissionRequest {
  tool_name?: string
  tool_use_id?: string
  tool_input?: Record<string, unknown>
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

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

function isClaudeNativePlanWrite(toolName: string, toolInput: Record<string, unknown> | undefined): boolean {
  if (toolName !== 'Write') return false
  const filePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : ''
  if (!filePath.endsWith('.md')) return false

  const plansDir = resolve(homedir(), '.claude', 'plans')
  const target = resolve(filePath)
  const pathFromPlansDir = relative(plansDir, target)
  return pathFromPlansDir !== '' && !pathFromPlansDir.startsWith('..') && !isAbsolute(pathFromPlansDir)
}

export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly grantedToolsBySession = new Map<string, Set<string>>()
  private onEvents: ((sessionId: string, events: RunEvent[]) => void) | null = null

  setEventSink(sink: (sessionId: string, events: RunEvent[]) => void): void {
    this.onEvents = sink
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

  resolveSessionApprovals(sessionId: string, approved: boolean, reason?: string, toolNames?: string[]): number {
    const tools = toolNames && toolNames.length > 0 ? new Set(toolNames) : null
    const entries = [...this.pending.entries()].filter(([, approval]) =>
      approval.sessionId === sessionId && (!tools || tools.has(approval.toolName))
    )
    for (const [requestId, approval] of entries) {
      clearTimeout(approval.timeout)
      this.pending.delete(requestId)
      approval.resolve({ approved, reason })
    }
    return entries.length
  }

  grantTools(sessionId: string, toolNames: string[]): void {
    const current = this.grantedToolsBySession.get(sessionId) ?? new Set<string>()
    for (const toolName of toolNames) current.add(toolName)
    this.grantedToolsBySession.set(sessionId, current)
  }

  prepareClaudeSdkRun(sessionId: string, allowedTools: string[] = []): { dispose: () => void } {
    this.grantedToolsBySession.set(sessionId, new Set(allowedTools))
    return {
      dispose: () => this.disposeSession(sessionId)
    }
  }

  async handleClaudeSdkPermission(
    sessionId: string,
    input: {
      toolName: string
      toolUseId?: string
      toolInput?: Record<string, unknown>
    }
  ): Promise<{ approved: boolean; reason?: string }> {
    return await this.handleToolRequest(sessionId, {
      tool_name: input.toolName,
      tool_use_id: input.toolUseId,
      tool_input: input.toolInput
    })
  }

  disposeSession(sessionId: string): void {
    this.grantedToolsBySession.delete(sessionId)
    for (const [requestId, approval] of this.pending) {
      if (approval.sessionId !== sessionId) continue
      clearTimeout(approval.timeout)
      this.pending.delete(requestId)
      approval.resolve({ approved: false, reason: 'Run stopped.' })
    }
  }

  private async handleToolRequest(
    sessionId: string,
    input: ClaudeToolPermissionRequest
  ): Promise<ApprovalDecision> {
    const toolName = input.tool_name ?? 'tool'
    if (SAFE_TOOLS.has(toolName)) return { approved: true }
    if (this.grantedToolsBySession.get(sessionId)?.has(toolName)) return { approved: true }
    if (isClaudeNativePlanWrite(toolName, input.tool_input)) return { approved: true }

    const requestId = randomUUID()
    const decision = await new Promise<ApprovalDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ approved: false, reason: 'Approval timed out.' })
      }, APPROVAL_TIMEOUT_MS)
      this.pending.set(requestId, {
        sessionId,
        toolName,
        resolve,
        timeout
      })

      this.onEvents?.(sessionId, [{
        type: 'permission.requested',
        content: `${toolName} needs approval.`,
        denials: [{
          tool_name: toolName,
          tool_use_id: input.tool_use_id ?? requestId,
          tool_input: input.tool_input ?? {}
        }]
      }])
    })

    return decision
  }
}

export const approvalBroker = new ApprovalBroker()
