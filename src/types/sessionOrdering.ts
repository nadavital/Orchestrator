export interface PinOrderedSession {
  id: string
  pinned?: boolean
  pinOrder?: number
  latestMessageAt?: number
  createdAt: number
  messages?: Array<{ timestamp: number }>
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
