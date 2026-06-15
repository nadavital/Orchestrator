import type { ChatMessage, ResultMessage, TextMessage } from './index'

export interface TranscriptTurnGroup {
  id: string
  index: number
  messages: ChatMessage[]
  isLatest: boolean
  hasStreaming: boolean
  hasPendingInteraction: boolean
  isCollapsible: boolean
  summary: TranscriptTurnSummary
}

export interface TranscriptTurnSummary {
  userPreview: string
  assistantPreview: string
  toolCount: number
  noticeCount: number
  messageCount: number
}

export function buildTranscriptTurnGroups(messages: ChatMessage[]): TranscriptTurnGroup[] {
  const groups: ChatMessage[][] = []
  let current: ChatMessage[] = []

  const flush = (): void => {
    if (current.length === 0) return
    groups.push(current)
    current = []
  }

  for (const message of messages) {
    if (isTextMessage(message) && message.role === 'user' && current.length > 0) flush()
    current.push(message)
  }
  flush()

  return groups.map((group, index) => {
    const isLatest = index === groups.length - 1
    const hasStreaming = group.some((message) => isTextMessage(message) && message.isStreaming === true)
    const hasPendingInteraction = group.some(isPendingInteractionMessage)
    const hasSpecialVisibleState = group.some(hasSpecialVisibleMessageState)
    const summary = summarizeTurn(group)
    return {
      id: turnGroupId(group, index),
      index,
      messages: group,
      isLatest,
      hasStreaming,
      hasPendingInteraction,
      isCollapsible:
        summary.userPreview.length > 0 &&
        !isLatest &&
        !hasStreaming &&
        !hasPendingInteraction &&
        !hasSpecialVisibleState &&
        summary.messageCount > 1,
      summary
    }
  })
}

export function transcriptTurnIdForMessage(messages: ChatMessage[], messageId: string): string | null {
  const group = buildTranscriptTurnGroups(messages).find((group) =>
    group.messages.some((message) => message.id === messageId)
  )
  return group?.id ?? null
}

function turnGroupId(messages: ChatMessage[], index: number): string {
  const nativeTurnId = messages.map(nativeTurnIdForMessage).find((turnId): turnId is string => Boolean(turnId))
  if (nativeTurnId) return `turn-${nativeTurnId}`
  const userMessage = messages.find((message) => isTextMessage(message) && message.role === 'user')
  return `turn-${userMessage?.id ?? messages[0]?.id ?? index}`
}

function nativeTurnIdForMessage(message: ChatMessage): string | null {
  const record = message as ChatMessage & {
    providerTurnId?: unknown
    provider_turn_id?: unknown
    turnId?: unknown
    turn_id?: unknown
  }
  const value = record.providerTurnId ?? record.provider_turn_id ?? record.turnId ?? record.turn_id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isTextMessage(message: ChatMessage): message is TextMessage {
  return message.type === 'text'
}

function isPendingInteractionMessage(message: ChatMessage): boolean {
  if (message.type !== 'result') return false
  return hasPendingUserInput(message) || hasPendingPermission(message)
}

function hasPendingUserInput(message: ResultMessage): boolean {
  return (message.userInputQuestions?.length ?? 0) > 0
}

function hasPendingPermission(message: ResultMessage): boolean {
  return (message.permissionDenials?.length ?? 0) > 0 && !message.permissionDecision
}

function hasSpecialVisibleMessageState(message: ChatMessage): boolean {
  return message.type === 'result' && message.subtype !== 'success'
}

function summarizeTurn(messages: ChatMessage[]): TranscriptTurnSummary {
  let userText = ''
  const assistantTexts: string[] = []
  for (const message of messages) {
    if (!isTextMessage(message)) continue
    if (message.role === 'user' && userText.length === 0) {
      userText = message.content
      continue
    }
    if (message.role === 'assistant' && message.content.trim().length > 0) {
      assistantTexts.push(message.content)
    }
  }
  const toolCount = messages.filter((message) => message.type === 'tool_use' || message.type === 'tool_result').length
  const noticeCount = messages.filter((message) => message.type === 'result' && message.subtype !== 'success').length
  return {
    userPreview: compactPreview(userText),
    assistantPreview: compactPreview(assistantTexts.at(-1) ?? ''),
    toolCount,
    noticeCount,
    messageCount: messages.length
  }
}

function compactPreview(content: string, maxLength = 180): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}
