import type { ChatMessage, ToolResultMessage, ToolUseMessage } from '../../types'
import {
  buildTranscriptTurnGroups,
  type TranscriptTurnGroup
} from '../../../../types/transcriptView'

const TOOL_SUMMARY_COLLAPSED_ESTIMATE = 42
const TURN_ACTIVITY_COLLAPSED_ESTIMATE = 46
const TRANSCRIPT_VIRTUAL_OVERSCAN = 900
export const TRANSCRIPT_VIRTUAL_ROW_GAP = 14

export type TranscriptItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'tool_group'; id: string; messages: Array<ToolUseMessage | ToolResultMessage> }
  | { type: 'collapsed_activity'; id: string; turn: TranscriptTurnGroup; messages: ChatMessage[]; expanded: boolean }

export interface VirtualTranscriptWindow {
  totalHeight: number
  offsetTop: number
  items: Array<{ id: string; item: TranscriptItem }>
}

export function buildVirtualTranscriptWindow(
  items: TranscriptItem[],
  measuredHeights: Record<string, number>,
  scrollTop: number,
  viewportHeight: number,
  pinToBottom = false
): VirtualTranscriptWindow {
  if (items.length === 0) return { totalHeight: 0, offsetTop: 0, items: [] }

  const measuredItems = items.map((item) => {
    const id = transcriptItemId(item)
    return {
      id,
      item,
      height: measuredHeights[id] ?? estimateTranscriptItemHeight(item)
    }
  })
  const totalHeight = measuredItems.reduce((total, item) => total + item.height, 0)
  const viewportStart = pinToBottom
    ? Math.max(0, totalHeight - viewportHeight - TRANSCRIPT_VIRTUAL_OVERSCAN)
    : Math.max(0, scrollTop - TRANSCRIPT_VIRTUAL_OVERSCAN)
  const viewportEnd = pinToBottom
    ? totalHeight
    : scrollTop + viewportHeight + TRANSCRIPT_VIRTUAL_OVERSCAN
  const visibleItems: Array<{ id: string; item: TranscriptItem }> = []
  let offset = 0
  let offsetTop = 0

  for (const { id, item, height } of measuredItems) {
    const itemStart = offset
    const itemEnd = itemStart + height
    if (itemEnd >= viewportStart && itemStart <= viewportEnd) {
      if (visibleItems.length === 0) offsetTop = itemStart
      visibleItems.push({ id, item })
    }
    offset = itemEnd
  }

  if (visibleItems.length === 0) {
    const item = items[items.length - 1]
    const id = transcriptItemId(item)
    return {
      totalHeight,
      offsetTop: Math.max(0, totalHeight - (measuredHeights[id] ?? estimateTranscriptItemHeight(item))),
      items: [{ id, item }]
    }
  }

  return { totalHeight, offsetTop, items: visibleItems }
}

export function transcriptItemId(item: TranscriptItem): string {
  if (item.type === 'tool_group') return item.id
  if (item.type === 'collapsed_activity') return item.id
  return item.message.id
}

export function transcriptItemMessageIds(item: TranscriptItem): string[] {
  if (item.type === 'tool_group') return item.messages.map((message) => message.id)
  if (item.type === 'collapsed_activity') return item.messages.map((message) => message.id)
  return [item.message.id]
}

export function transcriptItemOffset(
  messageId: string,
  items: TranscriptItem[],
  measuredHeights: Record<string, number>
): number | null {
  let offset = 0
  for (const item of items) {
    const id = transcriptItemId(item)
    if (transcriptItemMessageIds(item).includes(messageId)) return offset
    offset += measuredHeights[id] ?? estimateTranscriptItemHeight(item)
  }
  return null
}

export function estimateTranscriptMessagesHeight(messages: ChatMessage[]): number {
  return groupTranscriptMessages(messages).reduce((total, item) => total + estimateTranscriptItemHeight(item), 0)
}

export function estimateTranscriptItemHeight(item: TranscriptItem): number {
  if (item.type === 'tool_group') {
    return TOOL_SUMMARY_COLLAPSED_ESTIMATE + TRANSCRIPT_VIRTUAL_ROW_GAP
  }
  if (item.type === 'collapsed_activity') {
    return TURN_ACTIVITY_COLLAPSED_ESTIMATE + TRANSCRIPT_VIRTUAL_ROW_GAP
  }
  const message = item.message
  if (message.type === 'text') {
    const lines = message.content.split('\n').length
    const wrappedLines = Math.ceil(message.content.length / (message.role === 'user' ? 70 : 92))
    const bodyHeight = Math.min(720, Math.max(lines, wrappedLines) * 18)
    return (message.role === 'user' ? 52 : 44) + bodyHeight + TRANSCRIPT_VIRTUAL_ROW_GAP
  }
  if (message.type === 'tool_use' || message.type === 'tool_result') return 96 + TRANSCRIPT_VIRTUAL_ROW_GAP
  return 72 + TRANSCRIPT_VIRTUAL_ROW_GAP
}

export function groupTranscriptMessages(messages: ChatMessage[], expandedTurnIds: Set<string> = new Set()): TranscriptItem[] {
  return groupTranscriptTurnGroups(buildTranscriptTurnGroups(messages), expandedTurnIds)
}

export function groupTranscriptTurnGroups(turns: TranscriptTurnGroup[], expandedTurnIds: Set<string> = new Set()): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const turn of turns) {
    if (turn.isCollapsible) {
      items.push(...groupCollapsibleTurnMessages(turn, expandedTurnIds.has(turn.id)))
      continue
    }
    items.push(...groupTurnMessages(turn.messages))
  }
  return items
}

function groupCollapsibleTurnMessages(turn: TranscriptTurnGroup, expanded: boolean): TranscriptItem[] {
  const visibleIds = collapsedTurnVisibleMessageIds(turn.messages)
  const hiddenMessages = turn.messages.filter((message) => !visibleIds.has(message.id))
  if (hiddenMessages.length === 0) return groupTurnMessages(turn.messages)

  const items: TranscriptItem[] = []
  const userMessages = turn.messages.filter((message) => visibleIds.has(message.id) && message.type === 'text' && message.role === 'user')
  const finalAssistant = [...turn.messages].reverse().find((message) => visibleIds.has(message.id) && message.type === 'text' && message.role === 'assistant')
  items.push(...groupTurnMessages(userMessages))
  items.push({ type: 'collapsed_activity', id: `${turn.id}:collapsed-activity`, turn, messages: hiddenMessages, expanded })
  if (expanded) items.push(...groupTurnMessages(hiddenMessages))
  if (finalAssistant) items.push(...groupTurnMessages([finalAssistant]))
  return items
}

function collapsedTurnVisibleMessageIds(messages: ChatMessage[]): Set<string> {
  const visibleIds = new Set<string>()
  for (const message of messages) {
    if (message.type === 'text' && message.role === 'user') visibleIds.add(message.id)
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.type === 'text' && message.role === 'assistant' && message.content.trim().length > 0) {
      visibleIds.add(message.id)
      break
    }
  }
  return visibleIds
}

function groupTurnMessages(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let pendingTools: Array<ToolUseMessage | ToolResultMessage> = []

  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    items.push({
      type: 'tool_group',
      id: `tools-${pendingTools[0].id}`,
      messages: pendingTools
    })
    pendingTools = []
  }

  for (const message of messages) {
    if (message.type === 'tool_use' || message.type === 'tool_result') {
      pendingTools.push(message)
      continue
    }
    flushTools()
    items.push({ type: 'message', message })
  }
  flushTools()

  return items
}
