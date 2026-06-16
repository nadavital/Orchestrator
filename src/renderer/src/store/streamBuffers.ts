import { useSyncExternalStore } from 'react'
import type { SessionRunEventRecord } from '../../types'

const MAX_EVENTS_PER_SESSION = 500
const MAX_RAW_CHARS_PER_SESSION = 20_000
const EMPTY_EVENTS: readonly SessionRunEventRecord[] = Object.freeze([])
const EMPTY_SNAPSHOT: SessionStreamSnapshot = Object.freeze({ events: EMPTY_EVENTS, raw: '' })

export interface SessionStreamSnapshot {
  events: readonly SessionRunEventRecord[]
  raw: string
}

const eventsBySession = new Map<string, readonly SessionRunEventRecord[]>()
const rawBySession = new Map<string, string>()
const snapshotsBySession = new Map<string, SessionStreamSnapshot>()
const listenersBySession = new Map<string, Set<() => void>>()

function snapshotForSession(sessionId: string): SessionStreamSnapshot {
  return snapshotsBySession.get(sessionId) ?? EMPTY_SNAPSHOT
}

function rebuildSnapshot(sessionId: string): void {
  const events = eventsBySession.get(sessionId) ?? EMPTY_EVENTS
  const raw = rawBySession.get(sessionId) ?? ''
  snapshotsBySession.set(sessionId, { events, raw })
}

function notify(sessionId: string): void {
  const listeners = listenersBySession.get(sessionId)
  if (!listeners) return
  for (const listener of listeners) listener()
}

export function appendSessionEvents(sessionId: string, records: SessionRunEventRecord[]): void {
  if (records.length === 0) return
  const current = eventsBySession.get(sessionId) ?? EMPTY_EVENTS
  eventsBySession.set(sessionId, [...current, ...records].slice(-MAX_EVENTS_PER_SESSION))
  rebuildSnapshot(sessionId)
  notify(sessionId)
}

export function appendSessionRaw(sessionId: string, data: string): void {
  if (!data) return
  const current = rawBySession.get(sessionId) ?? ''
  rawBySession.set(sessionId, `${current}${data}`.slice(-MAX_RAW_CHARS_PER_SESSION))
  rebuildSnapshot(sessionId)
  notify(sessionId)
}

export function clearSessionStreamBuffers(sessionId: string): void {
  const hadData = eventsBySession.delete(sessionId) || rawBySession.delete(sessionId) || snapshotsBySession.delete(sessionId)
  if (hadData) notify(sessionId)
}

export function getSessionEvents(sessionId: string): readonly SessionRunEventRecord[] {
  return snapshotForSession(sessionId).events
}

export function getSessionRaw(sessionId: string): string {
  return snapshotForSession(sessionId).raw
}

export function useSessionEvents(sessionId: string): readonly SessionRunEventRecord[] {
  return useSessionStreamSnapshot(sessionId).events
}

export function useSessionRaw(sessionId: string): string {
  return useSessionStreamSnapshot(sessionId).raw
}

export function useSessionStreamSnapshot(sessionId: string): SessionStreamSnapshot {
  return useSyncExternalStore(
    (listener) => subscribeSessionStream(sessionId, listener),
    () => snapshotForSession(sessionId),
    () => EMPTY_SNAPSHOT
  )
}

function subscribeSessionStream(sessionId: string, listener: () => void): () => void {
  let listeners = listenersBySession.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    listenersBySession.set(sessionId, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = listenersBySession.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listenersBySession.delete(sessionId)
  }
}
