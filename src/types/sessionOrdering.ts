export interface PinOrderedSession {
  id: string
  pinned?: boolean
  pinOrder?: number
  latestMessageAt?: number
  createdAt: number
  status?: string
  messageCount?: number
  messages?: Array<{ timestamp: number }>
}

export type SidebarSessionSortMode = 'updated' | 'created'

export interface SidebarSessionOrderOptions {
  sortMode: SidebarSessionSortMode
  activeSessionId?: string | null
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

export function comparePinnedSessions(a: PinOrderedSession, b: PinOrderedSession): number {
  const aOrder = a.pinOrder ?? Number.MAX_SAFE_INTEGER
  const bOrder = b.pinOrder ?? Number.MAX_SAFE_INTEGER
  if (aOrder !== bOrder) return aOrder - bOrder
  return comparePinnedOrderMigration(a, b)
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
    return typeof session.pinOrder === 'number' ? Math.max(max, session.pinOrder) : max
  }, 0)
}

function comparePinnedOrderMigration(a: PinOrderedSession, b: PinOrderedSession): number {
  const aTime = a.latestMessageAt ?? a.messages?.at(-1)?.timestamp ?? a.createdAt
  const bTime = b.latestMessageAt ?? b.messages?.at(-1)?.timestamp ?? b.createdAt
  return bTime - aTime || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
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
