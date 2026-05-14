import { v4 as uuidv4 } from 'uuid'
import type { ChatMessage, RunEvent } from '../types'

export function eventsToMessages(events: RunEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = []

  for (const event of events) {
    if (event.type === 'assistant.text') {
      messages.push({
        id: uuidv4(),
        role: 'assistant',
        type: 'text',
        content: event.content,
        timestamp: Date.now()
      })
    } else if (event.type === 'assistant.status') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: event.content,
        subtype: 'status',
        timestamp: Date.now()
      })
    } else if (event.type === 'diff.updated') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: `Diff updated (${event.content.length.toLocaleString()} chars)`,
        subtype: 'status',
        timestamp: Date.now()
      })
    } else if (event.type === 'tool.started') {
      messages.push({
        id: event.id,
        role: 'assistant',
        type: 'tool_use',
        toolName: event.toolName,
        toolInput: event.toolInput,
        timestamp: Date.now()
      })
    } else if (event.type === 'tool.completed') {
      messages.push({
        id: event.id,
        role: 'tool',
        type: 'tool_result',
        toolUseId: event.toolUseId,
        content: event.content,
        isError: event.isError,
        timestamp: Date.now()
      })
    } else if (event.type === 'permission.requested') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: event.content ?? 'Permission required',
        subtype: 'error_during_execution',
        timestamp: Date.now(),
        permissionDenials: event.denials
      })
    } else if (event.type === 'user_input.requested') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: event.content,
        subtype: 'waiting_for_user',
        timestamp: Date.now(),
        userInputQuestions: event.questions
      })
    } else if (event.type === 'goal.updated') {
      const usage = [
        typeof event.goal.tokensUsed === 'number' ? `${event.goal.tokensUsed} tokens` : undefined,
        typeof event.goal.tokenBudget === 'number' ? `${event.goal.tokenBudget} budget` : undefined,
        typeof event.goal.timeUsedSeconds === 'number' ? `${event.goal.timeUsedSeconds}s` : undefined
      ].filter(Boolean).join(' · ')
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: `Goal: ${event.goal.objective}${event.goal.status ? ` (${event.goal.status})` : ''}${usage ? ` · ${usage}` : ''}`,
        subtype: 'status',
        timestamp: Date.now()
      })
    } else if (event.type === 'goal.cleared') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: 'Goal cleared',
        subtype: 'status',
        timestamp: Date.now()
      })
    } else if (event.type === 'run.completed') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: event.content ?? '',
        subtype: 'success',
        timestamp: Date.now(),
        usageSummary: event.usage
      })
    } else if (event.type === 'run.failed') {
      messages.push({
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: event.content ?? '',
        subtype: 'error_during_execution',
        timestamp: Date.now(),
        usageSummary: event.usage
      })
    }
  }

  return messages
}
