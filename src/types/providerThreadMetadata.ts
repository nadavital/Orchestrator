export type ProviderThreadSourceProjection = 'local' | 'remote' | 'cloud' | 'remote-host' | 'worktree'

export interface ProviderThreadMetadataSession {
  id: string
  provider?: string
  providerSessionId?: string | null
  name?: string
  workDir?: string
  repoRoot?: string
  previewText?: string
  latestMessageAt?: number
  createdAt: number
  providerThreadSource?: ProviderThreadSourceProjection
  providerHostId?: string | null
  providerHostLabel?: string | null
  providerWorktreeSourceRoot?: string | null
  providerWorktreeRoot?: string | null
  providerWorktreeHostId?: string | null
  providerWorktreeHostLabel?: string | null
  providerProjectless?: boolean
  providerProjectlessThreadId?: string | null
}

export interface ProviderThreadMetadataApplyOptions {
  providerId?: string
}

export function applyCodexThreadListMetadata<T extends ProviderThreadMetadataSession>(
  sessions: T[],
  threadListResult: unknown,
  options: ProviderThreadMetadataApplyOptions = {}
): T[] {
  const providerId = options.providerId ?? 'codex'
  const threads = codexThreadListItems(threadListResult)
  if (threads.length === 0) return sessions

  const threadById = new Map<string, Record<string, unknown>>()
  for (const thread of threads) {
    const id = stringValue(thread.id, thread.sessionId)
    if (id) threadById.set(id, thread)
  }
  if (threadById.size === 0) return sessions

  return sessions.map((session) => {
    if (session.provider !== providerId) return session
    const providerThreadId = session.providerSessionId ?? session.id
    const thread = providerThreadId ? threadById.get(providerThreadId) : undefined
    if (!thread) return session

    const next = providerThreadSessionWithCodexMetadata(session, thread)
    return shallowEqualSessionProjection(session, next) ? session : next
  })
}

export function codexThreadListItems(result: unknown): Record<string, unknown>[] {
  const record = asRecord(result)
  const items = Array.isArray(result)
    ? result
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.threads)
        ? record.threads
        : Array.isArray(record?.items)
          ? record.items
          : []
  return items.flatMap((item) => {
    const thread = codexThreadRecordFromListItem(item)
    return thread ? [thread] : []
  })
}

function providerThreadSessionWithCodexMetadata<T extends ProviderThreadMetadataSession>(
  session: T,
  thread: Record<string, unknown>
): T {
  const id = stringValue(thread.id, thread.sessionId)
  const source = codexThreadSource(thread)
  const hostId = stringValue(
    thread.hostId,
    nestedValue(thread, 'conversation', 'hostId'),
    nestedValue(thread, 'host', 'id'),
    nestedValue(thread, 'remoteHost', 'id')
  )
  const hostLabel = stringValue(
    thread.hostLabel,
    thread.hostName,
    nestedValue(thread, 'conversation', 'hostLabel'),
    nestedValue(thread, 'host', 'displayName'),
    nestedValue(thread, 'host', 'name'),
    nestedValue(thread, 'remoteHost', 'displayName'),
    nestedValue(thread, 'remoteHost', 'name')
  )
  const worktreeRoot = stringValue(
    thread.worktreeRoot,
    thread.worktreePath,
    nestedValue(thread, 'worktree', 'root'),
    nestedValue(thread, 'worktree', 'workspaceRoot'),
    nestedValue(thread, 'pendingWorktree', 'worktreeWorkspaceRoot'),
    nestedValue(thread, 'pendingWorktree', 'worktreeGitRoot')
  )
  const worktreeSourceRoot = stringValue(
    thread.worktreeSourceRoot,
    thread.sourceRoot,
    nestedValue(thread, 'worktree', 'sourceRoot'),
    nestedValue(thread, 'pendingWorktree', 'sourceWorkspaceRoot'),
    nestedArrayValue(thread, ['pendingWorktree', 'startConversationParamsInput', 'workspaceRoots'], 0),
    nestedValue(thread, 'pendingWorktree', 'cwd')
  )
  const worktreeHostId = stringValue(
    thread.worktreeHostId,
    nestedValue(thread, 'worktree', 'hostId'),
    nestedValue(thread, 'pendingWorktree', 'hostId')
  ) ?? hostId
  const worktreeHostLabel = stringValue(
    thread.worktreeHostLabel,
    nestedValue(thread, 'worktree', 'hostLabel'),
    nestedValue(thread, 'pendingWorktree', 'hostLabel')
  ) ?? hostLabel
  const preview = stringValue(thread.preview, thread.previewText, thread.title, nestedValue(thread, 'conversation', 'title'))
  const latestMessageAt = timestampMs(thread.updatedAt, thread.updated_at, thread.createdAt, thread.created_at)
  const projectless = isCodexProjectlessThread(thread)

  return {
    ...session,
    providerThreadSource: source ?? session.providerThreadSource,
    providerHostId: source === 'remote-host' ? hostId ?? session.providerHostId : session.providerHostId,
    providerHostLabel: source === 'remote-host' ? hostLabel ?? session.providerHostLabel : session.providerHostLabel,
    providerWorktreeSourceRoot: source === 'worktree'
      ? worktreeSourceRoot ?? session.providerWorktreeSourceRoot
      : session.providerWorktreeSourceRoot,
    providerWorktreeRoot: source === 'worktree'
      ? worktreeRoot ?? session.providerWorktreeRoot
      : session.providerWorktreeRoot,
    providerWorktreeHostId: source === 'worktree'
      ? worktreeHostId ?? session.providerWorktreeHostId
      : session.providerWorktreeHostId,
    providerWorktreeHostLabel: source === 'worktree'
      ? worktreeHostLabel ?? session.providerWorktreeHostLabel
      : session.providerWorktreeHostLabel,
    providerProjectless: projectless ? true : session.providerProjectless,
    providerProjectlessThreadId: projectless && id ? id : session.providerProjectlessThreadId,
    previewText: preview ?? session.previewText,
    latestMessageAt: latestMessageAt ?? session.latestMessageAt
  }
}

function codexThreadRecordFromListItem(item: unknown): Record<string, unknown> | null {
  const record = asRecord(item)
  if (!record) return null

  const thread = asRecord(record.thread)
  if (thread) return mergeCodexThreadRecord(record, thread)

  const conversation = asRecord(record.conversation)
  if (conversation) {
    return mergeCodexThreadRecord(record, {
      id: conversation.id,
      sessionId: conversation.id,
      source: conversation.source ?? record.source ?? record.kind,
      cwd: conversation.cwd,
      hostId: conversation.hostId,
      hostLabel: conversation.hostLabel,
      title: conversation.title,
      workspaceKind: conversation.workspaceKind,
      updatedAt: conversation.updatedAt ?? conversation.updated_at,
      createdAt: conversation.createdAt ?? conversation.created_at,
      conversation
    })
  }

  const task = asRecord(record.task)
  if (task) {
    return mergeCodexThreadRecord(record, {
      id: task.id,
      sessionId: task.id,
      threadSource: record.threadSource ?? record.source ?? (record.kind === 'remote' ? 'cloud' : undefined),
      title: task.title,
      updatedAt: task.updatedAt ?? task.updated_at,
      createdAt: task.createdAt ?? task.created_at,
      task
    })
  }

  const pendingWorktree = asRecord(record.pendingWorktree)
  if (pendingWorktree) {
    return mergeCodexThreadRecord(record, {
      id: pendingWorktree.id,
      sessionId: pendingWorktree.id,
      threadSource: 'worktree',
      pendingWorktree
    })
  }

  return record
}

function mergeCodexThreadRecord(parent: Record<string, unknown>, child: Record<string, unknown>): Record<string, unknown> {
  return { ...parent, ...child }
}

function codexThreadSource(thread: Record<string, unknown>): ProviderThreadSourceProjection | undefined {
  const raw = stringValue(thread.threadSource, thread.source, thread.type, thread.kind)?.toLowerCase()
  const normalized = raw?.replace(/[_\s]+/g, '-')
  if (normalized === 'cloud' || normalized === 'remote-cloud') return 'cloud'
  if (normalized === 'remote-host' || normalized === 'remote-control' || normalized === 'hosted') return 'remote-host'
  if (normalized === 'worktree' || normalized === 'pending-worktree') return 'worktree'
  if (normalized === 'remote') return 'remote'
  if (normalized === 'vscode') return 'local'
  if (normalized === 'local') return 'local'
  if (stringValue(
    thread.worktreeRoot,
    thread.worktreePath,
    nestedValue(thread, 'worktree', 'root'),
    nestedValue(thread, 'pendingWorktree', 'worktreeWorkspaceRoot'),
    nestedValue(thread, 'pendingWorktree', 'worktreeGitRoot')
  )) return 'worktree'
  if (stringValue(
    thread.hostId,
    nestedValue(thread, 'conversation', 'hostId'),
    nestedValue(thread, 'host', 'id'),
    nestedValue(thread, 'remoteHost', 'id')
  )) return 'remote-host'
  if (asRecord(thread.task)) return 'cloud'
  return undefined
}

function isCodexProjectlessThread(thread: Record<string, unknown>): boolean {
  if (thread.projectless === true || thread.isProjectless === true) return true
  const raw = stringValue(
    thread.projectId,
    thread.project,
    thread.workspaceKind,
    nestedValue(thread, 'conversation', 'workspaceKind'),
    thread.threadSource,
    thread.source
  )?.toLowerCase()
  if (raw === 'projectless') return true
  const cwd = stringValue(thread.cwd)
  return cwd === '/' || cwd === ''
}

function shallowEqualSessionProjection<T extends ProviderThreadMetadataSession>(a: T, b: T): boolean {
  return a.providerThreadSource === b.providerThreadSource &&
    a.providerHostId === b.providerHostId &&
    a.providerHostLabel === b.providerHostLabel &&
    a.providerWorktreeSourceRoot === b.providerWorktreeSourceRoot &&
    a.providerWorktreeRoot === b.providerWorktreeRoot &&
    a.providerWorktreeHostId === b.providerWorktreeHostId &&
    a.providerWorktreeHostLabel === b.providerWorktreeHostLabel &&
    a.providerProjectless === b.providerProjectless &&
    a.providerProjectlessThreadId === b.providerProjectlessThreadId &&
    a.previewText === b.previewText &&
    a.latestMessageAt === b.latestMessageAt
}

function timestampMs(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numericValue = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN
    if (!Number.isFinite(numericValue)) continue
    return numericValue < 1_000_000_000_000 ? Math.round(numericValue * 1000) : Math.round(numericValue)
  }
  return undefined
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function nestedValue(record: Record<string, unknown>, key: string, nestedKey: string): unknown {
  return asRecord(record[key])?.[nestedKey]
}

function nestedArrayValue(record: Record<string, unknown>, path: string[], index: number): unknown {
  let current: unknown = record
  for (const key of path) {
    const currentRecord = asRecord(current)
    if (!currentRecord) return undefined
    current = currentRecord[key]
  }
  return Array.isArray(current) ? current[index] : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
