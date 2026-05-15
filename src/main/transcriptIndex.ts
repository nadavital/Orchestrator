import type { ChatMessage, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult } from '../types'

export const DEFAULT_TRANSCRIPT_PAGE_SIZE = 40
export const MAX_TRANSCRIPT_PAGE_SIZE = 200

export function transcriptPageForMessages(
  sessionId: string,
  messages: ChatMessage[],
  request: TranscriptPageRequest = {}
): TranscriptPage {
  const limit = normalizeLimit(request.limit)
  const count = messages.length
  let start = Math.max(0, count - limit)
  let end = count

  if (request.beforeMessageId) {
    const index = messages.findIndex((message) => message.id === request.beforeMessageId)
    end = index >= 0 ? index : count
    start = Math.max(0, end - limit)
  } else if (request.afterMessageId) {
    const index = messages.findIndex((message) => message.id === request.afterMessageId)
    start = index >= 0 ? Math.min(count, index + 1) : 0
    end = Math.min(count, start + limit)
  } else if (request.aroundMessageId) {
    const index = messages.findIndex((message) => message.id === request.aroundMessageId)
    if (index >= 0) {
      const before = Math.floor(limit / 2)
      start = Math.max(0, index - before)
      end = Math.min(count, start + limit)
      start = Math.max(0, end - limit)
    }
  }

  const pageMessages = messages.slice(start, end)
  return {
    sessionId,
    messages: pageMessages,
    messageCount: count,
    pageStartIndex: start,
    pageEndIndex: end,
    hasMoreBefore: start > 0,
    hasMoreAfter: end < count,
    beforeCursor: pageMessages[0]?.id,
    afterCursor: pageMessages.at(-1)?.id
  }
}

export function searchTranscriptMessages(
  sessionId: string,
  messages: ChatMessage[],
  rawQuery: string,
  limit = 20
): TranscriptSearchResult[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []
  const maxResults = Math.max(1, Math.min(limit, 100))
  const results: TranscriptSearchResult[] = []

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const text = searchableMessageText(message)
    const matchIndex = text.toLowerCase().indexOf(query)
    if (matchIndex < 0) continue

    results.push({
      sessionId,
      messageId: message.id,
      messageIndex: index,
      role: message.role,
      type: message.type,
      timestamp: message.timestamp,
      snippet: snippetAround(text, matchIndex, query.length)
    })
    if (results.length >= maxResults) break
  }

  return results
}

export function mergeTranscriptMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const message of [...incoming, ...existing]) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_TRANSCRIPT_PAGE_SIZE)) return DEFAULT_TRANSCRIPT_PAGE_SIZE
  return Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_TRANSCRIPT_PAGE_SIZE), MAX_TRANSCRIPT_PAGE_SIZE))
}

function searchableMessageText(message: ChatMessage): string {
  if (message.type === 'text') return message.content
  if (message.type === 'tool_result') return message.content
  if (message.type === 'tool_use') return `${message.toolName} ${JSON.stringify(message.toolInput)}`
  return message.content ?? message.subtype ?? ''
}

function snippetAround(text: string, matchIndex: number, queryLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const adjustedMatch = Math.max(0, Math.min(matchIndex, compact.length))
  const start = Math.max(0, adjustedMatch - 72)
  const end = Math.min(compact.length, adjustedMatch + queryLength + 96)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < compact.length ? '...' : ''
  return `${prefix}${compact.slice(start, end)}${suffix}`
}
