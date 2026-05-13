import type { RunEvent } from './index'

export interface NativeTerminalSnapshot {
  assistantText?: string
  completed: boolean
}

export interface NativeTerminalStreamState {
  assistantText: string
  completed: boolean
  streamId: string
}

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

function isNativeToolStatusLine(line: string): boolean {
  if (/^(Read|Writ|Write|Wrte|Wite|Edit|MultiEdit|Bash|Glob|Grep|LS|TodoWrite|Task|Agent)\(/.test(line)) {
    return true
  }

  return /^[A-Z][A-Za-z0-9_]{1,24}\([^)]*\)$/.test(line)
}

function isClaudeNativeModeBanner(line: string): boolean {
  const compact = line.replace(/\s+/g, '').toLowerCase()
  return compact.includes('modeletsclaudehandlepermissionprompts') ||
    compact.includes('shift+tabtochangemode')
}

export function parseClaudeTerminalSnapshot(value: string): NativeTerminalSnapshot {
  const clean = stripTerminalControls(value)
  const assistantStart = clean.lastIndexOf('⏺')
  const assistantSlice = assistantStart >= 0 ? clean.slice(assistantStart + 1) : ''
  const hasPlanPreviewHint = /\/plan\s*to\s*preview/i.test(assistantSlice)
  const firstContentLine = assistantSlice
    .split(/\r|\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (hasPlanPreviewHint) {
    return {
      assistantText: 'Plan updated in Claude Code. Run /plan to preview the full plan.',
      completed: assistantSlice.includes('❯')
    }
  }
  if (firstContentLine && (isNativeToolStatusLine(firstContentLine) || firstContentLine.startsWith('⎿'))) {
    return { completed: false }
  }
  const assistantLines = assistantSlice
    .split(/\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('✻') && !line.startsWith('✳') && !line.startsWith('✢') && !line.startsWith('✶') && !line.startsWith('✽'))
    .filter((line) => !line.startsWith('❯'))
    .filter((line) => !/^[-─━]{6,}$/.test(line))
    .filter((line) => !/^Updat\w*\s+pla(?:n)?$/i.test(line))
    .filter((line) => !isNativeToolStatusLine(line))
    .filter((line) => !line.startsWith('⎿'))
    .filter((line) => !/^\d+\s+[A-Za-z0-9_/.~-]/.test(line))
    .filter((line) => !/^[·•]\d*$/.test(line))
    .filter((line) => !/^[↑↓]\d*$/.test(line))
    .filter((line) => !/^\d*MCPserversfailed/i.test(line.replace(/\s+/g, '')))
    .filter((line) => !/^Don?e$/i.test(line))
    .filter((line) => !/ctrl\+|to expand/i.test(line))
    .filter((line) => !/\b\d+\s+(directory|directories|files?)\b/i.test(line))
    .filter((line) => !/^(acceptedits|⏵)/i.test(line.replace(/\s+/g, '')))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/MCPserverfailed|MCP server failed/i.test(line.replace(/\s+/g, '')))
    .filter((line) => !/for\s*shortcuts/i.test(line))
    .filter((line) => !/\/effort/i.test(line))
    .filter((line) => !/tokens?/i.test(line))
    .filter((line) => !isClaudeNativeModeBanner(line))
  let assistantText = assistantLines
    .join('\n')
    .trim()
  return {
    assistantText: assistantText || undefined,
    completed: assistantSlice.includes('❯') && Boolean(assistantText)
  }
}

export function terminalSnapshotToRunEvents(
  snapshot: NativeTerminalSnapshot,
  previous: NativeTerminalStreamState | undefined,
  streamId: string
): { events: RunEvent[]; state: NativeTerminalStreamState | undefined } {
  if (!snapshot.assistantText) {
    return { events: [], state: previous }
  }

  const previousText = previous?.assistantText ?? ''
  const events: RunEvent[] = []
  if (snapshot.assistantText !== previousText) {
    const delta = snapshot.assistantText.startsWith(previousText)
      ? snapshot.assistantText.slice(previousText.length)
      : snapshot.assistantText
    if (delta) events.push({ type: 'assistant.text.delta', streamId, content: delta })
  }

  const nextState: NativeTerminalStreamState = {
    streamId,
    assistantText: snapshot.assistantText,
    completed: snapshot.completed
  }

  if (snapshot.completed && previous?.completed !== true) {
    events.push({ type: 'assistant.text.completed', streamId })
    events.push({ type: 'run.completed' })
  }

  return { events, state: nextState }
}
