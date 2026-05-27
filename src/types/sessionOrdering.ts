export interface PinOrderedSession {
  id: string
  provider?: string
  providerSessionId?: string | null
  useWorktree?: boolean
  worktreeState?: string
  pinned?: boolean
  pinOrder?: number
  providerPinned?: boolean
  providerPinOrder?: number
  providerPinnedThreadKey?: string | null
  latestMessageAt?: number
  createdAt: number
  status?: string
  messageCount?: number
  messages?: Array<{ timestamp: number }>
}

export type SidebarSessionSortMode = 'updated' | 'created'
export type ProviderPinnedThreadKeyKind = 'local' | 'remote' | 'pending-worktree'

export interface SidebarSessionOrderOptions {
  sortMode: SidebarSessionSortMode
  activeSessionId?: string | null
}

export interface ProviderPinnedThreadState {
  providerId: string
  threadKeys: string[]
}

export function ensurePinnedSessionOrders<T extends PinOrderedSession>(sessions: T[]): T[] {
  const missingOrder = sessions.filter((session) => session.pinned && typeof session.pinOrder !== 'number')
  if (missingOrder.length === 0) return sessions

  let nextOrder = highestPinOrder(sessions)
  const orderedMissing = [...missingOrder].sort(comparePinnedOrderMigration)
  for (const session of orderedMissing) {
    nextOrder += 1
    session.pinOrder = nextOrder
  }
  return sessions
}

export function nextPinOrder(sessions: PinOrderedSession[]): number {
  return highestPinOrder(sessions) + 1
}

export function isSidebarPinnedSession(session: Pick<PinOrderedSession, 'pinned' | 'providerPinned'>): boolean {
  return session.pinned === true || session.providerPinned === true
}

export function normalizeProviderPinnedThreadKey(threadKey: string, providerId?: string | null): string | null {
  const trimmed = threadKey.trim()
  if (!trimmed) return null
  const [kind, ...parts] = trimmed.split(':')
  if (!isProviderPinnedThreadKeyKind(kind) || parts.length === 0) return null
  const idParts = kind === 'remote' && providerId && parts[0] === providerId && parts.length > 1
    ? parts.slice(1)
    : parts
  const id = idParts.join(':').trim()
  if (!id) return null
  return `${kind}:${id}`
}

export function providerPinnedThreadKeyForSession(session: Pick<PinOrderedSession, 'id' | 'providerSessionId' | 'useWorktree' | 'worktreeState'>): string {
  const isPendingWorktree = session.useWorktree === true &&
    (session.worktreeState === 'pending' || session.worktreeState === 'failed')
  if (isPendingWorktree) return `pending-worktree:${session.providerSessionId ?? session.id}`
  if (session.providerSessionId) return `remote:${session.providerSessionId}`
  return `local:${session.id}`
}

export function applyProviderPinnedThreadState<T extends PinOrderedSession>(
  sessions: T[],
  state: ProviderPinnedThreadState
): T[] {
  const providerId = state.providerId
  const orderedKeys = uniqueNormalizedPinnedKeys(state.threadKeys, providerId)
  const orderByKey = new Map<string, number>()
  orderedKeys.forEach((key, index) => orderByKey.set(key, index + 1))

  return sessions.map((session) => {
    if (session.provider !== providerId) return session
    const keys = providerPinnedThreadKeyCandidates(session, providerId)
    const matchedKey = keys.find((key) => orderByKey.has(key))
    const previousKey = session.providerPinnedThreadKey
      ? normalizeProviderPinnedThreadKey(session.providerPinnedThreadKey, providerId)
      : null

    if (!matchedKey) {
      if (!session.providerPinned && session.providerPinOrder === undefined && session.providerPinnedThreadKey == null) {
        return session
      }
      return {
        ...session,
        providerPinned: false,
        providerPinOrder: undefined,
        providerPinnedThreadKey: undefined
      }
    }

    const nextOrder = orderByKey.get(matchedKey)
    if (
      session.providerPinned === true &&
      session.providerPinOrder === nextOrder &&
      previousKey === matchedKey
    ) {
      return session
    }

    return {
      ...session,
      providerPinned: true,
      providerPinOrder: nextOrder,
      providerPinnedThreadKey: matchedKey
    }
  })
}

export function comparePinnedSessions(a: PinOrderedSession, b: PinOrderedSession): number {
  const aOrder = effectivePinOrder(a)
  const bOrder = effectivePinOrder(b)
  if (aOrder !== bOrder) return aOrder - bOrder
  return comparePinnedOrderMigration(a, b)
}

export function reorderPinnedSessions<T extends PinOrderedSession>(
  sessions: readonly T[],
  orderedPinnedSessionIds: readonly string[]
): T[] {
  const currentPinnedSessions = sessions
    .filter(isSidebarPinnedSession)
    .sort(comparePinnedSessions)
  const currentPinnedIds = new Set(currentPinnedSessions.map((session) => session.id))
  const seen = new Set<string>()
  const requestedOrder: string[] = []
  for (const id of orderedPinnedSessionIds) {
    if (!currentPinnedIds.has(id) || seen.has(id)) continue
    seen.add(id)
    requestedOrder.push(id)
  }
  if (requestedOrder.length === 0) return [...sessions]

  const nextPinnedOrder = [
    ...requestedOrder,
    ...currentPinnedSessions.map((session) => session.id).filter((id) => !seen.has(id))
  ]
  const orderById = new Map(nextPinnedOrder.map((id, index) => [id, index + 1]))

  return sessions.map((session) => {
    const pinOrder = orderById.get(session.id)
    if (pinOrder == null) return session
    if (session.pinned === true) {
      if (session.pinOrder === pinOrder) return session
      return {
        ...session,
        pinOrder
      }
    }
    if (session.providerPinned === true) {
      if (session.providerPinOrder === pinOrder) return session
      return {
        ...session,
        providerPinOrder: pinOrder
      }
    }
    return session
  })
}

export function compareSidebarSessions(
  a: PinOrderedSession,
  b: PinOrderedSession,
  options: SidebarSessionOrderOptions
): number {
  const aIsBlankActive = isBlankActiveSession(a, options.activeSessionId)
  const bIsBlankActive = isBlankActiveSession(b, options.activeSessionId)
  if (aIsBlankActive !== bIsBlankActive) return aIsBlankActive ? -1 : 1

  const aIsLive = isLiveSidebarSession(a)
  const bIsLive = isLiveSidebarSession(b)
  if (aIsLive !== bIsLive) return aIsLive ? -1 : 1
  if (aIsLive && bIsLive) return stableCreatedOrder(a, b)

  if (options.sortMode === 'created') return stableCreatedOrder(a, b)

  const aTime = a.latestMessageAt ?? a.messages?.at(-1)?.timestamp ?? a.createdAt
  const bTime = b.latestMessageAt ?? b.messages?.at(-1)?.timestamp ?? b.createdAt
  return bTime - aTime || stableCreatedOrder(a, b)
}

function highestPinOrder(sessions: PinOrderedSession[]): number {
  return sessions.reduce((max, session) => {
    const order = effectivePinOrder(session)
    return order === Number.MAX_SAFE_INTEGER ? max : Math.max(max, order)
  }, 0)
}

function effectivePinOrder(session: PinOrderedSession): number {
  if (session.pinned && typeof session.pinOrder === 'number') return session.pinOrder
  if (session.providerPinned && typeof session.providerPinOrder === 'number') return session.providerPinOrder
  return Number.MAX_SAFE_INTEGER
}

function comparePinnedOrderMigration(a: PinOrderedSession, b: PinOrderedSession): number {
  const aTime = a.latestMessageAt ?? a.messages?.at(-1)?.timestamp ?? a.createdAt
  const bTime = b.latestMessageAt ?? b.messages?.at(-1)?.timestamp ?? b.createdAt
  const aKey = a.providerPinnedThreadKey ?? a.id
  const bKey = b.providerPinnedThreadKey ?? b.id
  return bTime - aTime || a.createdAt - b.createdAt || aKey.localeCompare(bKey)
}

function isProviderPinnedThreadKeyKind(kind: string): kind is ProviderPinnedThreadKeyKind {
  return kind === 'local' || kind === 'remote' || kind === 'pending-worktree'
}

function uniqueNormalizedPinnedKeys(threadKeys: string[], providerId?: string | null): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const threadKey of threadKeys) {
    const normalized = normalizeProviderPinnedThreadKey(threadKey, providerId)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    keys.push(normalized)
  }
  return keys
}

function providerPinnedThreadKeyCandidates(session: PinOrderedSession, providerId?: string | null): string[] {
  const keys = new Set<string>([providerPinnedThreadKeyForSession(session)])
  if (session.providerPinnedThreadKey) {
    const normalized = normalizeProviderPinnedThreadKey(session.providerPinnedThreadKey, providerId)
    if (normalized) keys.add(normalized)
  }
  if (session.providerSessionId) keys.add(`remote:${session.providerSessionId}`)
  keys.add(`local:${session.id}`)
  return [...keys]
}

function isBlankActiveSession(session: PinOrderedSession, activeSessionId?: string | null): boolean {
  if (!activeSessionId || session.id !== activeSessionId) return false
  const messageCount = session.messageCount ?? session.messages?.length ?? 0
  return messageCount === 0
}

function isLiveSidebarSession(session: PinOrderedSession): boolean {
  return session.status === 'running' ||
    session.status === 'reconnecting' ||
    session.status === 'waiting_for_permission' ||
    session.status === 'waiting_for_user'
}

function stableCreatedOrder(a: PinOrderedSession, b: PinOrderedSession): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}
