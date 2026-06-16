import { useSyncExternalStore } from 'react'
import type { ChatMessage, SessionRunEventRecord } from '../../types'

const MAX_EVENTS_PER_SESSION = 500
const MAX_RAW_CHARS_PER_SESSION = 20_000
const EMPTY_EVENTS: readonly SessionRunEventRecord[] = Object.freeze([])
const EMPTY_SNAPSHOT: SessionStreamSnapshot = Object.freeze({ events: EMPTY_EVENTS, raw: '' })
const EMPTY_STREAMING_MESSAGES: Readonly<Record<string, ChatMessage>> = Object.freeze({})

export interface SessionStreamSnapshot {
  events: readonly SessionRunEventRecord[]
  raw: string
}

const eventsBySession = new Map<string, readonly SessionRunEventRecord[]>()
const rawBySession = new Map<string, string>()
const streamingMessagesBySession = new Map<string, Readonly<Record<string, ChatMessage>>>()
const snapshotsBySession = new Map<string, SessionStreamSnapshot>()
const listenersBySession = new Map<string, Set<() => void>>()
const streamingMessageListenersBySession = new Map<string, Set<() => void>>()

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

function notifyStreamingMessages(sessionId: string): void {
  const listeners = streamingMessageListenersBySession.get(sessionId)
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
  if (streamingMessagesBySession.delete(sessionId)) notifyStreamingMessages(sessionId)
}

export function upsertSessionStreamingMessage(sessionId: string, message: ChatMessage): void {
  const current = streamingMessagesBySession.get(sessionId) ?? EMPTY_STREAMING_MESSAGES
  if (current[message.id] === message) return
  streamingMessagesBySession.set(sessionId, { ...current, [message.id]: message })
  notifyStreamingMessages(sessionId)
}

export function deleteSessionStreamingMessage(sessionId: string, messageId: string): void {
  const current = streamingMessagesBySession.get(sessionId)
  if (!current || current[messageId] === undefined) return
  const { [messageId]: _removed, ...next } = current
  if (Object.keys(next).length > 0) {
    streamingMessagesBySession.set(sessionId, next)
  } else {
    streamingMessagesBySession.delete(sessionId)
  }
  notifyStreamingMessages(sessionId)
}

export function hasSessionStreamingMessage(sessionId: string, messageId: string): boolean {
  return streamingMessagesBySession.get(sessionId)?.[messageId] !== undefined
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

export function useSessionStreamingMessages(sessionId: string): Readonly<Record<string, ChatMessage>> {
  return useSyncExternalStore(
    (listener) => subscribeSessionStreamingMessages(sessionId, listener),
    () => streamingMessagesBySession.get(sessionId) ?? EMPTY_STREAMING_MESSAGES,
    () => EMPTY_STREAMING_MESSAGES
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

function subscribeSessionStreamingMessages(sessionId: string, listener: () => void): () => void {
  let listeners = streamingMessageListenersBySession.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    streamingMessageListenersBySession.set(sessionId, listeners)
  }
  listeners.add(listener)
  return () => {
    const current = streamingMessageListenersBySession.get(sessionId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) streamingMessageListenersBySession.delete(sessionId)
  }
}
