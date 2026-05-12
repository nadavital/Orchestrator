import type { UserInputQuestion } from './index'

export type NativeCliPromptKind = 'claude_workspace_trust' | 'claude_mcp_servers_enable'

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
  if (
    normalized.includes('newmcpserversfoundin.mcp.json') &&
    normalized.includes('selectanyyouwishtoenable') &&
    normalized.includes('entertoconfirm')
  ) {
    return 'claude_mcp_servers_enable'
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
  if (kind === 'claude_mcp_servers_enable') {
    return {
      content: 'Claude Code found MCP servers for this workspace.',
      questions: [{
        header: 'MCP Servers',
        question: 'Enable the selected MCP servers for this Claude Code session?',
        options: [
          {
            label: 'Enable selected',
            description: 'Continue with Claude Code using the selected workspace MCP servers.'
          },
          {
            label: 'Reject all',
            description: 'Continue without enabling these MCP servers.'
          }
        ]
      }]
    }
  }
  throw new Error(`Unsupported native CLI prompt: ${kind}`)
}

export function nativeCliPromptAnswer(kind: NativeCliPromptKind, answer: string): string {
  if (kind === 'claude_workspace_trust') {
    return /^exit|no\b|2$/i.test(answer.trim()) ? '2' : ''
  }
  if (kind === 'claude_mcp_servers_enable') {
    return /^reject|no\b|2$/i.test(answer.trim()) ? '\x1b' : ''
  }
  return answer
}

export function nativeCliPromptSubmitSequence(kind: NativeCliPromptKind, answer: string): string {
  const mapped = nativeCliPromptAnswer(kind, answer)
  if (mapped === '\x1b') return mapped
  if (kind === 'claude_workspace_trust' || kind === 'claude_mcp_servers_enable') {
    return `${mapped}\x1b[13u`
  }
  return `${mapped}\n`
}
