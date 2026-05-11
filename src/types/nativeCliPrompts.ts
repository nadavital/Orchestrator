import type { UserInputQuestion } from './index'

export type NativeCliPromptKind = 'claude_workspace_trust'

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

export function detectNativeCliPrompt(providerId: string, value: string): NativeCliPromptKind | null {
  if (providerId !== 'claude') return null
  const normalized = stripAnsi(value).replace(/\s+/g, '').toLowerCase()
  if (
    normalized.includes('quicksafetycheck') &&
    normalized.includes('isthisaprojectyoucreatedoroneyoutrust') &&
    normalized.includes('yes,itrustthisfolder')
  ) {
    return 'claude_workspace_trust'
  }
  return null
}

export function nativeCliPromptContent(kind: NativeCliPromptKind): {
  content: string
  questions: UserInputQuestion[]
} {
  if (kind === 'claude_workspace_trust') {
    return {
      content: 'Claude Code needs workspace trust before it can run here.',
      questions: [{
        header: 'Workspace Trust',
        question: 'Trust this workspace for this Claude Code session?',
        options: [
          {
            label: 'Trust workspace',
            description: 'Continue the session and allow Claude Code to inspect this folder.'
          },
          {
            label: 'Exit',
            description: 'Stop this Claude Code session.'
          }
        ]
      }]
    }
  }
  throw new Error(`Unsupported native CLI prompt: ${kind}`)
}

export function nativeCliPromptAnswer(kind: NativeCliPromptKind, answer: string): string {
  if (kind === 'claude_workspace_trust') {
    return /^exit|no\b|2$/i.test(answer.trim()) ? '2' : '1'
  }
  return answer
}
