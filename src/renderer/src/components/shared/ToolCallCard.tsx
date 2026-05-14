import { useState } from 'react'
import type { ToolUseMessage } from '../../types'

const toolIcons: Record<string, string> = {
  Bash: '$',
  Read: 'R',
  Write: 'W',
  Edit: 'E',
  Glob: 'G',
  Grep: 'G',
  WebFetch: 'W',
  WebSearch: 'S',
  Agent: 'A',
  TodoWrite: 'T',
  Task: 'T'
}

interface Props {
  msg: ToolUseMessage
}

export default function ToolCallCard({ msg }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const icon = toolIcons[msg.toolName] ?? '•'

  const inputPreview = (() => {
    const entries = Object.entries(msg.toolInput)
    if (entries.length === 0) return ''
    const [key, val] = entries[0]
    const strVal = typeof val === 'string' ? val : JSON.stringify(val)
    return `${key}: ${strVal.slice(0, 60)}${strVal.length > 60 ? '…' : ''}`
  })()

  return (
    <div className="flex justify-start pl-8">
      <div
        className="overflow-hidden text-xs"
        style={{
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          maxWidth: '80%'
        }}
      >
        <button
          className="flex items-center gap-2 px-3 py-2 w-full text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            className="grid h-5 w-5 shrink-0 place-items-center rounded-md font-mono text-[10px] font-bold"
            style={{ background: 'var(--control-bg)', color: 'var(--accent)' }}
          >
            {icon}
          </span>
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>
            {msg.toolName}
          </span>
          {!expanded && inputPreview && (
            <span className="truncate flex-1" style={{ color: 'var(--color-text-muted)' }}>
              {inputPreview}
            </span>
          )}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className="shrink-0 ml-auto transition-transform"
            style={{
              color: 'var(--color-text-muted)',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)'
            }}
          >
            <path d="M5 7 L1 3 L9 3 Z" />
          </svg>
        </button>
        {expanded && (
          <div
            className="overflow-y-auto overflow-x-hidden px-3 pb-3 font-mono"
            style={{ borderTop: '1px solid var(--border-subtle)', maxHeight: 220, color: 'var(--color-text-muted)', overscrollBehavior: 'contain' }}
          >
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(msg.toolInput, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
