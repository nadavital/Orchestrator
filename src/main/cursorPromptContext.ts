import type { ChatMessage, ProviderRuntimeKind, Session, TextMessage } from '../types'

export function promptWithCursorSdkUnansweredContext(
  session: Pick<Session, 'provider' | 'runtime' | 'messages'>,
  prompt: string
): string {
  if (!isCursorSdkSession(session.provider, session.runtime)) return prompt

  const unansweredMessages = collectTrailingUnansweredUserMessages(session.messages)
  if (unansweredMessages.length <= 1) return prompt

  const context = unansweredMessages
    .map((message, index) => {
      const latest = index === unansweredMessages.length - 1 ? ' latest="true"' : ''
      return `<user_message index="${index + 1}"${latest}>\n${message.content.trim()}\n</user_message>`
    })
    .join('\n\n')

  return [
    'The local Orchestrator transcript has consecutive user messages that may not all have reached Cursor before the previous run was interrupted. Use these user messages as the immediate conversation context, in order. Respond to the latest user message.',
    '',
    '<orchestrator_unanswered_user_messages>',
    context,
    '</orchestrator_unanswered_user_messages>'
  ].join('\n')
}

export function collectTrailingUnansweredUserMessages(messages: readonly ChatMessage[]): TextMessage[] {
  const collected: TextMessage[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === 'text' && message.role === 'assistant' && message.content.trim()) break
    if (message.type === 'text' && message.role === 'user' && !message.queueState && message.content.trim()) {
      collected.push(message)
    }
  }
  return collected.reverse()
}

function isCursorSdkSession(provider: string | undefined, runtime: ProviderRuntimeKind | undefined): boolean {
  return provider === 'cursor' && runtime === 'sdk'
}
