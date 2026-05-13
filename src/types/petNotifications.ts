import type { ChatMessage, PermissionDenial, RunEvent, Session, SessionRunEventRecord } from './index'

export type PetNotificationStatus = 'waiting' | 'failed' | 'review' | 'running' | 'idle'

export interface PetSessionSnapshot {
  id: string
  name: string
  provider: string
  status: Session['status']
  messages: ChatMessage[]
  events: SessionRunEventRecord[]
  hasUnread: boolean
  lastActivityAt: number
  activitySeq: number
}

export interface PetPermissionAction {
  toolNames: string[]
  denials: PermissionDenial[]
}

export interface PetNotification {
  key: string
  dismissKey: string
  sessionId: string
  provider: string
  title: string
  status: PetNotificationStatus
  label: string
  body: string
  timestamp: number
  priority: number
  canReply: boolean
  canDismiss: boolean
  permissionAction: PetPermissionAction | null
}

export const PET_STATUS_PRIORITY: Record<PetNotificationStatus, number> = {
  waiting: 0,
  failed: 1,
  review: 2,
  running: 3,
  idle: 4,
}

export const PET_STATUS_LABEL: Record<PetNotificationStatus, string> = {
  waiting: 'Needs input',
  failed: 'Blocked',
  review: 'Ready',
  running: 'Running',
  idle: '',
}

export const PET_NOTIFICATION_TTL_MS: Record<PetNotificationStatus, number> = {
  running: 180_000,
  failed: 3_600_000,
  waiting: 86_400_000,
  review: 604_800_000,
  idle: 0,
}

export function petStatusForSession(session: Pick<PetSessionSnapshot, 'status' | 'hasUnread'>): PetNotificationStatus {
  if (session.status === 'waiting_for_permission' || session.status === 'waiting_for_user') return 'waiting'
  if (
    session.status === 'auth_error' ||
    session.status === 'model_error' ||
    session.status === 'quota_error' ||
    session.status === 'rate_limit_error' ||
    session.status === 'provider_error' ||
    session.status === 'error'
  ) return 'failed'
  if (session.status === 'running' || session.status === 'reconnecting') return 'running'
  if (session.hasUnread) return 'review'
  return 'idle'
}

export function buildPetNotification(session: PetSessionSnapshot): PetNotification | null {
  const status = petStatusForSession(session)
  if (status === 'idle') return null

  const latestActivity = latestActivityForStatus(session, status)
  const timestamp = latestActivity.timestamp || session.lastActivityAt
  const turnKey = latestActivity.id || `${session.activitySeq}`
  const permissionAction = status === 'waiting' ? latestPermissionAction(session.events) : null

  return {
    key: `${session.id}:${status}:${turnKey}`,
    dismissKey: `${session.id}:${status}:${turnKey}`,
    sessionId: session.id,
    provider: session.provider,
    title: session.name,
    status,
    label: PET_STATUS_LABEL[status],
    body: latestActivity.body,
    timestamp,
    priority: PET_STATUS_PRIORITY[status],
    canReply: session.status === 'waiting_for_user',
    canDismiss: status !== 'running',
    permissionAction,
  }
}

export function isPetNotificationExpired(notification: PetNotification, nowMs: number): boolean {
  const ttl = PET_NOTIFICATION_TTL_MS[notification.status]
  return ttl > 0 && nowMs - notification.timestamp > ttl
}

function latestActivityForStatus(
  session: PetSessionSnapshot,
  status: PetNotificationStatus
): { id: string; timestamp: number; body: string } {
  const eventActivity = latestEventActivity(session.events, status)
  if (eventActivity) return eventActivity

  const messageActivity = latestMessageActivity(session.messages, status)
  if (messageActivity) return messageActivity

  return {
    id: `${session.activitySeq}`,
    timestamp: session.lastActivityAt,
    body: fallbackBody(session.status, status),
  }
}

function latestEventActivity(
  records: SessionRunEventRecord[],
  status: PetNotificationStatus
): { id: string; timestamp: number; body: string } | null {
  for (const record of [...records].reverse()) {
    const body = eventBody(record.event, status)
    if (body) return { id: record.id, timestamp: record.timestamp, body }
  }
  return null
}

function eventBody(event: RunEvent, status: PetNotificationStatus): string | null {
  if (status === 'waiting') {
    if (event.type === 'permission.requested') {
      const denial = event.denials[0]
      return event.content || (denial ? `Permission: ${describeDenial(denial)}` : 'Permission required')
    }
    if (event.type === 'user_input.requested') return compact(event.content) || 'Waiting for your response'
  }

  if (status === 'failed') {
    if (event.type === 'run.failed') return compact(event.content) || 'Run failed'
    if (event.type === 'tool.completed' && event.isError) return compact(event.content) || 'Tool failed'
  }

  if (status === 'running') {
    if (event.type === 'connection.reconnecting') return reconnectingBody(event, 'Reconnecting')
    if (event.type === 'connection.retrying') return reconnectingBody(event, 'Retrying')
    if (event.type === 'plan.updated') return planActivity(event.plan)
    if (event.type === 'tool.started') return classifyToolActivity(event.toolName, event.toolInput, true)
    if (event.type === 'tool.completed') return classifyCompletedTool(event)
    if (event.type === 'assistant.text') return compact(event.content) || 'Thinking'
    if (event.type === 'session.started') return 'Session started'
  }

  if (status === 'review') {
    if (event.type === 'run.completed') return compact(event.content) || 'Done'
    if (event.type === 'assistant.text') return compact(event.content)
    if (event.type === 'tool.completed' && event.content) return compact(event.content)
  }

  return null
}

function planActivity(plan: Extract<RunEvent, { type: 'plan.updated' }>['plan']): string {
  const active = plan.items.find((item) => item.status === 'in_progress')
  if (active) return `Planning: ${truncate(active.content, 80)}`
  const pending = plan.items.filter((item) => item.status === 'pending').length
  if (pending > 0) return `Planning ${pending} task${pending === 1 ? '' : 's'}`
  if (plan.mode === 'plan') return 'Planning'
  return plan.summary ? truncate(plan.summary, 80) : 'Updated plan'
}

function latestMessageActivity(
  messages: ChatMessage[],
  status: PetNotificationStatus
): { id: string; timestamp: number; body: string } | null {
  for (const msg of [...messages].reverse()) {
    if (status === 'running' && msg.type === 'tool_use') {
      return {
        id: msg.id,
        timestamp: msg.timestamp,
        body: classifyToolActivity(msg.toolName, msg.toolInput, true),
      }
    }
    if ((status === 'review' || status === 'failed') && msg.type === 'text' && msg.role === 'assistant') {
      return { id: msg.id, timestamp: msg.timestamp, body: compact(msg.content) || fallbackBody('', status) }
    }
    if ((status === 'review' || status === 'failed') && msg.type === 'result') {
      return { id: msg.id, timestamp: msg.timestamp, body: compact(msg.content) || fallbackBody('', status) }
    }
    if (status === 'waiting' && msg.type === 'result' && msg.permissionDenials?.length) {
      return {
        id: msg.id,
        timestamp: msg.timestamp,
        body: `Permission: ${describeDenial(msg.permissionDenials[0])}`,
      }
    }
  }
  return null
}

function fallbackBody(sessionStatus: string, status: PetNotificationStatus): string {
  if (sessionStatus === 'waiting_for_permission') return 'Permission required'
  if (sessionStatus === 'waiting_for_user') return 'Waiting for your response'
  if (sessionStatus === 'reconnecting') return 'Reconnecting'
  if (status === 'running') return 'Thinking'
  if (status === 'review') return 'Ready to review'
  if (status === 'failed') return 'Run blocked'
  return ''
}

function latestPermissionAction(records: SessionRunEventRecord[]): PetPermissionAction | null {
  for (const record of [...records].reverse()) {
    const event = record.event
    if (event.type !== 'permission.requested' || event.denials.length === 0) continue
    return {
      denials: event.denials,
      toolNames: [...new Set(event.denials.map((denial) => denial.tool_name))],
    }
  }
  return null
}

export function describeDenial(denial: PermissionDenial): string {
  const { tool_name, tool_input } = denial
  const path = stringFromInput(tool_input, ['file_path', 'path', 'target_file', 'targetFile'])
  if (path && /^(Write|Edit|Read|MultiEdit)$/i.test(tool_name)) return `${tool_name} ${compactPath(path)}`

  const command = stringFromInput(tool_input, ['command', 'cmd', 'script'])
  if (command && /^(Bash|Shell|Command)$/i.test(tool_name)) return `${tool_name}: ${truncate(command, 80)}`

  const target = path ?? command ?? stringFromInput(tool_input, ['query', 'pattern', 'url'])
  return target ? `${tool_name} ${truncate(target, 80)}` : tool_name
}

export function classifyToolActivity(
  toolName: string,
  input: Record<string, unknown>,
  inProgress = false
): string {
  const normalizedName = toolName.toLowerCase().replace(/[_\s.-]+/g, '')
  const prefix = inProgress ? activeVerbForTool(normalizedName) : completedVerbForTool(normalizedName)
  const target = toolTarget(input)

  if (target) return `${prefix} ${target}`
  if (normalizedName.includes('todo')) return inProgress ? 'Updating tasks' : 'Updated tasks'
  if (normalizedName.includes('agent') || normalizedName.includes('subtask')) return inProgress ? 'Running agent' : 'Ran agent'
  return inProgress ? `Using ${toolName}` : `Used ${toolName}`
}

function classifyCompletedTool(event: Extract<RunEvent, { type: 'tool.completed' }>): string {
  if (event.isError) return compact(event.content) || 'Tool failed'
  return compact(event.content) || 'Tool completed'
}

function activeVerbForTool(normalizedName: string): string {
  if (normalizedName.includes('read')) return 'Reading'
  if (normalizedName.includes('write')) return 'Writing'
  if (normalizedName.includes('edit') || normalizedName.includes('patch')) return 'Editing'
  if (normalizedName.includes('grep') || normalizedName.includes('search')) return 'Searching'
  if (normalizedName.includes('glob') || normalizedName.includes('list')) return 'Listing'
  if (normalizedName.includes('web') || normalizedName.includes('fetch') || normalizedName.includes('open')) return 'Browsing'
  if (normalizedName.includes('bash') || normalizedName.includes('shell') || normalizedName.includes('exec') || normalizedName.includes('command')) return 'Running'
  return 'Using'
}

function completedVerbForTool(normalizedName: string): string {
  if (normalizedName.includes('read')) return 'Read'
  if (normalizedName.includes('write')) return 'Wrote'
  if (normalizedName.includes('edit') || normalizedName.includes('patch')) return 'Edited'
  if (normalizedName.includes('grep') || normalizedName.includes('search')) return 'Searched'
  if (normalizedName.includes('glob') || normalizedName.includes('list')) return 'Listed'
  if (normalizedName.includes('web') || normalizedName.includes('fetch') || normalizedName.includes('open')) return 'Browsed'
  if (normalizedName.includes('bash') || normalizedName.includes('shell') || normalizedName.includes('exec') || normalizedName.includes('command')) return 'Ran'
  return 'Used'
}

function toolTarget(input: Record<string, unknown>): string | null {
  const filePath = stringFromInput(input, ['file_path', 'path', 'target_file', 'targetFile', 'absolutePath', 'relativePath'])
  if (filePath) return compactPath(filePath)

  const files = input.files
  if (Array.isArray(files) && typeof files[0] === 'string') return compactPath(files[0])

  const query = stringFromInput(input, ['query', 'pattern', 'search', 'searchTerm'])
  if (query) return truncate(query, 72)

  const command = stringFromInput(input, ['command', 'cmd', 'script', 'description'])
  if (command) return command.startsWith('$') ? truncate(command, 72) : `$ ${truncate(command, 70)}`

  const url = stringFromInput(input, ['url', 'uri'])
  if (url) return truncate(url, 72)

  const prompt = stringFromInput(input, ['prompt', 'task'])
  if (prompt) return truncate(prompt, 72)

  return null
}

function stringFromInput(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function reconnectingBody(event: Extract<RunEvent, { type: 'connection.reconnecting' | 'connection.retrying' }>, label: string): string {
  const attempt = typeof event.attempt === 'number' ? ` ${event.attempt}` : ''
  return compact(event.content) || `${label}${attempt}`
}

function compact(value: string | undefined): string {
  return truncate((value ?? '').replace(/\s+/g, ' ').trim(), 180)
}

function compactPath(value: string): string {
  const parts = value.trim().split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('/')
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}
