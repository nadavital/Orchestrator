export interface NativeTerminalSnapshot {
  assistantText?: string
  completed: boolean
}

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

export function parseClaudeTerminalSnapshot(value: string): NativeTerminalSnapshot {
  const clean = stripTerminalControls(value)
  const assistantMatch = clean.match(/⏺\s*([^\r\n]+)/)
  const assistantText = assistantMatch?.[1]?.trim()

  return {
    assistantText: assistantText || undefined,
    completed: clean.includes('❯') && Boolean(assistantText)
  }
}
