import type { ChatMessage, PermissionDenial, RunEvent, Session, SessionRunEventRecord, UserInputQuestion } from './index'

export type PetNotificationStatus = 'waiting' | 'failed' | 'review' | 'running' | 'idle'
export type PetNotificationLevel = 'warning' | 'danger' | 'success' | 'info'
export type PetWaitingRequestKind = 'question' | 'exec' | 'network' | 'patch' | 'permission' | 'plan' | 'tool'

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

export type PetWaitingRequestAction =
  | { kind: 'permission-response'; response: 'allow' | 'deny'; label: string; toolNames: string[]; primary?: boolean }
  | { kind: 'question-option'; label: string; value: string; primary?: boolean }
  | { kind: 'reply'; label: string; primary?: boolean }
  | { kind: 'open'; label: string; primary?: boolean }

export interface PetWaitingRequest {
  kind: PetWaitingRequestKind
  requestId: string
  title: string
  prompt: string
  actions: PetWaitingRequestAction[]
  denials?: PermissionDenial[]
  questions?: UserInputQuestion[]
  toolNames?: string[]
}

export interface PetNotification {
  id: string
  key: string
  dismissKey: string
  action: { path: string } | null
  body: string
  expiresAtMs: number
  isLoading: boolean
  level: PetNotificationLevel
  localConversationId: string
  replyTarget: { conversationId: string } | null
  source: 'local'
  provider: string
  title: string
  turnKey: string
  updatedAtMs: number
  waitingRequest: PetWaitingRequest | null

  // Orchestrator extensions around Codex's status buckets.
  status: PetNotificationStatus
  notificationPriority: number
  canDismiss: boolean
}

export interface PetNotificationVisual {
  badgeBackgroundColor: string
  badgeForegroundColor: string
  fallbackBodyMessage: string
  iconType: 'spinner' | 'clock' | 'warning' | 'check-circle'
  labelMessage: string
  mascotState: PetNotificationStatus
}

export const PET_STATUS_PRIORITY: Record<PetNotificationStatus, number> = {
  waiting: 0,
  failed: 1,
  review: 2,
  running: 3,
  idle: 4,
}

export const PET_NOTIFICATION_TTL_MS: Record<PetNotificationStatus, number> = {
  running: 180_000,
  failed: 3_600_000,
  waiting: 86_400_000,
  review: 604_800_000,
  idle: 0,
}

const PET_NOTIFICATION_LEVEL: Record<PetNotificationStatus, PetNotificationLevel> = {
  waiting: 'warning',
  failed: 'danger',
  review: 'success',
  running: 'info',
  idle: 'info',
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

  const waitingRequest = status === 'waiting' ? latestWaitingRequest(session) : null
  const latestActivity = latestActivityForStatus(session, status, waitingRequest)
  const updatedAtMs = latestActivity.timestamp || session.lastActivityAt
  const turnKey = `${session.id}:${latestActivity.id || session.activitySeq}`
  const title = status === 'waiting' && waitingRequest ? `${waitingRequest.title} · ${session.name}` : session.name

  return {
    id: `${session.id}:${status}:${turnKey}`,
    key: `${session.id}:${status}:${turnKey}`,
    dismissKey: turnKey,
    action: { path: `session/${session.id}` },
    body: latestActivity.body,
    expiresAtMs: updatedAtMs + PET_NOTIFICATION_TTL_MS[status],
    isLoading: status === 'running',
    level: PET_NOTIFICATION_LEVEL[status],
    localConversationId: session.id,
    replyTarget: session.status === 'waiting_for_user' ? { conversationId: session.id } : null,
    source: 'local',
    provider: session.provider,
    title,
    turnKey,
    updatedAtMs,
    waitingRequest,
    status,
    notificationPriority: PET_STATUS_PRIORITY[status],
    canDismiss: status !== 'running',
  }
}

export function isPetNotificationExpired(notification: PetNotification, nowMs: number): boolean {
  const ttl = PET_NOTIFICATION_TTL_MS[notification.status]
  return ttl > 0 && nowMs > notification.expiresAtMs
}

export function statusVisualForNotification(notification: PetNotification | null): PetNotificationVisual {
  if (!notification) {
    return {
      badgeBackgroundColor: 'var(--color-token-activity-bar-badge-background, #3B82F6)',
      badgeForegroundColor: 'var(--color-token-activity-bar-badge-foreground, #FFFFFF)',
      fallbackBodyMessage: '',
      iconType: 'clock',
      labelMessage: '',
      mascotState: 'idle',
    }
  }
  if (notification.isLoading) {
    return {
      badgeBackgroundColor: 'var(--color-token-activity-bar-badge-background, #3B82F6)',
      badgeForegroundColor: 'var(--color-token-activity-bar-badge-foreground, #FFFFFF)',
      fallbackBodyMessage: 'Running',
      iconType: 'spinner',
      labelMessage: 'Running',
      mascotState: 'running',
    }
  }
  if (notification.level === 'warning') {
    return {
      badgeBackgroundColor: 'var(--color-token-editor-warning-foreground, #FBBF24)',
      badgeForegroundColor: 'var(--color-token-bg-primary, #111827)',
      fallbackBodyMessage: 'Waiting for your response',
      iconType: 'clock',
      labelMessage: 'Needs input',
      mascotState: 'waiting',
    }
  }
  if (notification.level === 'danger') {
    return {
      badgeBackgroundColor: 'var(--color-token-error-foreground, #F87171)',
      badgeForegroundColor: 'var(--color-token-bg-primary, #111827)',
      fallbackBodyMessage: 'Run blocked',
      iconType: 'warning',
      labelMessage: 'Blocked',
      mascotState: 'failed',
    }
  }
  if (notification.level === 'success') {
    return {
      badgeBackgroundColor: 'var(--color-token-charts-green, #22C55E)',
      badgeForegroundColor: 'var(--color-token-bg-primary, #111827)',
      fallbackBodyMessage: 'Ready to review',
      iconType: 'check-circle',
      labelMessage: 'Ready',
      mascotState: 'review',
    }
  }
  return {
    badgeBackgroundColor: 'var(--color-token-activity-bar-badge-background, #3B82F6)',
    badgeForegroundColor: 'var(--color-token-activity-bar-badge-foreground, #FFFFFF)',
    fallbackBodyMessage: 'Running',
    iconType: 'clock',
    labelMessage: 'Running',
    mascotState: 'running',
  }
}

function latestActivityForStatus(
  session: PetSessionSnapshot,
  status: PetNotificationStatus,
  waitingRequest: PetWaitingRequest | null
): { id: string; timestamp: number; body: string } {
  const eventActivity = latestEventActivity(session.events, status, waitingRequest)
  if (eventActivity) return eventActivity

  const messageActivity = latestMessageActivity(session.messages, status)
  if (messageActivity) return messageActivity

  return {
    id: `${session.activitySeq}`,
    timestamp: session.lastActivityAt,
    body: waitingRequest?.prompt || fallbackBody(session.status, status),
  }
}

function latestEventActivity(
  records: SessionRunEventRecord[],
  status: PetNotificationStatus,
  waitingRequest: PetWaitingRequest | null
): { id: string; timestamp: number; body: string } | null {
  for (const record of [...records].reverse()) {
    const body = eventBody(record.event, status, waitingRequest)
    if (body) return { id: record.id, timestamp: record.timestamp, body }
  }
  return null
}

function eventBody(event: RunEvent, status: PetNotificationStatus, waitingRequest: PetWaitingRequest | null): string | null {
  if (status === 'waiting') {
    if (event.type === 'permission.requested') {
      const denial = event.denials[0]
      return event.content || waitingRequest?.prompt || (denial ? `Permission: ${describeDenial(denial)}` : 'Permission required')
    }
    if (event.type === 'user_input.requested') return compact(event.content) || waitingRequest?.prompt || 'Waiting for your response'
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

function latestWaitingRequest(session: PetSessionSnapshot): PetWaitingRequest | null {
  for (const record of [...session.events].reverse()) {
    const event = record.event
    if (event.type === 'user_input.requested') return userInputWaitingRequest(record.id, event)
    if (event.type === 'permission.requested') return permissionWaitingRequest(record.id, event)
  }
  if (session.status === 'waiting_for_user') {
    return {
      kind: 'question',
      requestId: `${session.id}:user-input`,
      title: 'Answer Required',
      prompt: 'Waiting for your response',
      actions: [{ kind: 'reply', label: 'Reply', primary: true }],
    }
  }
  if (session.status === 'waiting_for_permission') {
    return {
      kind: 'permission',
      requestId: `${session.id}:permission`,
      title: 'Approval Required',
      prompt: 'Permission required',
      actions: [
        { kind: 'permission-response', response: 'allow', label: 'Allow', toolNames: [], primary: true },
        { kind: 'permission-response', response: 'deny', label: 'Deny', toolNames: [] },
      ],
    }
  }
  return null
}

function userInputWaitingRequest(
  id: string,
  event: Extract<RunEvent, { type: 'user_input.requested' }>
): PetWaitingRequest {
  const question = event.questions?.[0]
  const title = compact(question?.header) || 'Answer Required'
  const prompt = compact(event.content) || compact(question?.question) || 'Waiting for your response'
  const optionActions: PetWaitingRequestAction[] = question?.options?.map((option, index) => ({
    kind: 'question-option',
    label: option.label,
    value: option.label,
    primary: index === 0,
  })) ?? []
  return {
    kind: 'question',
    requestId: id,
    title,
    prompt,
    actions: optionActions.length > 0 ? optionActions : [{ kind: 'reply', label: 'Reply', primary: true }],
    questions: event.questions,
  }
}

function permissionWaitingRequest(
  id: string,
  event: Extract<RunEvent, { type: 'permission.requested' }>
): PetWaitingRequest {
  const toolNames = [...new Set(event.denials.map((denial) => denial.tool_name))]
  const primaryDenial = event.denials[0]
  const kind = waitingKindForDenials(event.denials)
  const title = waitingTitleForKind(kind)
  const prompt = event.content || (primaryDenial ? `Permission: ${describeDenial(primaryDenial)}` : 'Permission required')
  return {
    kind,
    requestId: id,
    title,
    prompt,
    actions: [
      { kind: 'permission-response', response: 'allow', label: 'Allow', toolNames, primary: true },
      { kind: 'permission-response', response: 'deny', label: 'Deny', toolNames },
    ],
    denials: event.denials,
    toolNames,
  }
}

function waitingKindForDenials(denials: PermissionDenial[]): PetWaitingRequestKind {
  if (denials.some((denial) => /^(Bash|Shell|Command)$/i.test(denial.tool_name))) return 'exec'
  if (denials.some((denial) => /^(WebFetch|WebSearch|Fetch|Network)$/i.test(denial.tool_name))) return 'network'
  if (denials.some((denial) => /^(Write|Edit|MultiEdit|Patch)$/i.test(denial.tool_name))) return 'patch'
  return 'permission'
}

function waitingTitleForKind(kind: PetWaitingRequestKind): string {
  if (kind === 'exec') return 'Command Approval'
  if (kind === 'network') return 'Network Approval'
  if (kind === 'patch') return 'File Approval'
  if (kind === 'plan') return 'Plan Review'
  if (kind === 'tool') return 'Tool Approval'
  if (kind === 'question') return 'Answer Required'
  return 'Approval Required'
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
