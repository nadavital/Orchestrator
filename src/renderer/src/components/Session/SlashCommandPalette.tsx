import { useEffect, useRef } from 'react'

export interface SlashCommand {
  cmd: string
  desc: string
}

// Commands available for Claude Code CLI
export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/clear', desc: 'Clear conversation history' },
  { cmd: '/compact', desc: 'Compact conversation to save context' },
  { cmd: '/cost', desc: 'View token usage and estimated cost' },
  { cmd: '/diff', desc: 'Show git diff of current changes' },
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/init', desc: 'Initialize Claude Code in this project' },
  { cmd: '/memory', desc: 'Edit CLAUDE.md memory file' },
  { cmd: '/model', desc: 'Switch model for this session' },
  { cmd: '/permissions', desc: 'View and manage tool permissions' },
  { cmd: '/pr-comments', desc: 'Load PR comments for review' },
  { cmd: '/review', desc: 'Review staged or uncommitted changes' },
  { cmd: '/status', desc: 'Show account and system status' },
  { cmd: '/vim', desc: 'Toggle vim keybindings' },
  { cmd: '/bug', desc: 'Report a Claude Code bug' },
  { cmd: '/login', desc: 'Sign in to Claude' },
  { cmd: '/logout', desc: 'Sign out of Claude' },
]

interface Props {
  query: string
  onSelect: (cmd: string) => void
  onDismiss: () => void
  selectedIndex: number
  onSelectedIndexChange: (i: number) => void
}

export default function SlashCommandPalette({
  query,
  onSelect,
  onDismiss,
  selectedIndex,
  onSelectedIndexChange
}: Props): JSX.Element | null {
  const matches = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(query.length > 0 ? query : '/')
  )

  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { onDismiss(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        onSelectedIndexChange(Math.min(selectedIndex + 1, matches.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        onSelectedIndexChange(Math.max(selectedIndex - 1, 0))
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        if (matches[selectedIndex]) onSelect(matches[selectedIndex].cmd)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [selectedIndex, matches, onSelect, onDismiss, onSelectedIndexChange])

  if (matches.length === 0) return null

  return (
    <div
      className="absolute left-0 right-0 bottom-full mb-1 rounded-xl overflow-hidden z-50"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        maxHeight: 240,
        overflowY: 'auto'
      }}
    >
      <div ref={listRef}>
        {matches.map((c, i) => (
          <button
            key={c.cmd}
            className="w-full flex items-baseline gap-3 px-3 py-2 text-left"
            style={{
              background: i === selectedIndex ? 'var(--color-surface2)' : 'transparent'
            }}
            onMouseEnter={() => onSelectedIndexChange(i)}
            onClick={() => onSelect(c.cmd)}
          >
            <span
              className="text-xs font-mono shrink-0"
              style={{ color: 'var(--color-accent)', minWidth: 120 }}
            >
              {c.cmd}
            </span>
            <span className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
              {c.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function getSlashQuery(text: string): string | null {
  const match = text.match(/^(\/\S*)/)
  return match ? match[1] : null
}
