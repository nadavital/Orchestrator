import type { ChatMessage, ClaudeStreamEvent } from '../types'
import { v4 as uuidv4 } from 'uuid'

export function parseStreamEvent(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as ClaudeStreamEvent
  } catch {
    return null
  }
}

export function eventToMessages(event: ClaudeStreamEvent): ChatMessage[] {
  const messages: ChatMessage[] = []

  if (event.type === 'assistant') {
    const content = event.message?.content ?? []
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        messages.push({
          id: uuidv4(),
          role: 'assistant',
          type: 'text',
          content: block.text,
          timestamp: Date.now()
        })
      } else if (block.type === 'tool_use') {
        messages.push({
          id: block.id ?? uuidv4(),
          role: 'assistant',
          type: 'tool_use',
          toolName: block.name ?? '',
          toolInput: block.input ?? {},
          timestamp: Date.now()
        })
      }
    }
  }

  if (event.type === 'user') {
    const content = event.message?.content ?? []
    for (const block of content) {
      if (block.type === 'tool_result') {
        const output =
          typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content, null, 2)
        messages.push({
          id: uuidv4(),
          role: 'tool',
          type: 'tool_result',
          toolUseId: block.tool_use_id ?? '',
          content: output,
          isError: block.is_error ?? false,
          timestamp: Date.now()
        })
      }
    }
  }

  if (event.type === 'result') {
    const denials = event.permission_denials
    messages.push({
      id: uuidv4(),
      role: 'system',
      type: 'result',
      content: event.result ?? '',
      subtype: event.subtype ?? 'success',
      timestamp: Date.now(),
      ...(denials && denials.length > 0 ? { permissionDenials: denials } : {})
    })
  }

  return messages
}
