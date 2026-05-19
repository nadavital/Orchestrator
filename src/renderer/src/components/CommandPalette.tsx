import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MotionOverlay } from './shared/designSystem'

export interface CommandPaletteAction {
  id: string
  label: string
  group?: string
  description?: string
  shortcut?: string
  shortcuts?: string[]
  keywords?: string[]
  disabled?: boolean
  run: () => void | Promise<void>
}

interface Props {
  actions: CommandPaletteAction[]
  onClose: () => void
}

interface DisplayEntry {
  action: CommandPaletteAction
  index: number
}

const RECENT_COMMANDS_KEY = 'orchestrator.commandPalette.recent'
const RECENT_COMMAND_LIMIT = 4

export default function CommandPalette({ actions, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recentActionIds, setRecentActionIds] = useState<string[]>(() => readRecentActionIds())
  const inputRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const normalizedQuery = useMemo(() => normalize(query), [query])
  const rankedActions = useMemo(() => {
    const enabled = actions.filter((action) => !action.disabled)
    if (!normalizedQuery) return enabled
    return enabled
      .map((action, index) => ({ action, index, score: scoreAction(action, normalizedQuery) }))
      .filter((entry): entry is { action: CommandPaletteAction; index: number; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((entry) => entry.action)
  }, [actions, normalizedQuery])

  const groupedActions = useMemo(() => {
    const groups: Array<{ name: string; entries: DisplayEntry[] }> = []
    const addEntry = (groupName: string, action: CommandPaletteAction): void => {
      let group = groups.find((candidate) => candidate.name === groupName)
      if (!group) {
        group = { name: groupName, entries: [] }
        groups.push(group)
      }
      group.entries.push({ action, index: groups.flatMap((candidate) => candidate.entries).length })
    }

    const recentActions = !normalizedQuery
      ? recentActionIds
        .map((id) => rankedActions.find((action) => action.id === id))
        .filter((action): action is CommandPaletteAction => Boolean(action))
      : []
    const recentIds = new Set(recentActions.map((action) => action.id))
    for (const action of recentActions) addEntry('Recent', action)
    for (const action of rankedActions) {
      if (!normalizedQuery && recentIds.has(action.id)) continue
      addEntry(action.group ?? 'Commands', action)
    }
    return groups
  }, [normalizedQuery, rankedActions, recentActionIds])

  const displayActions = useMemo(() => (
    groupedActions.flatMap((group) => group.entries.map((entry) => entry.action))
  ), [groupedActions])

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, displayActions.length - 1)))
  }, [displayActions.length])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runAction = (action: CommandPaletteAction): void => {
    const nextRecent = [action.id, ...recentActionIds.filter((id) => id !== action.id)].slice(0, RECENT_COMMAND_LIMIT)
    setRecentActionIds(nextRecent)
    writeRecentActionIds(nextRecent)
    onClose()
    window.requestAnimationFrame(() => { void action.run() })
  }

  const palette = (
    <MotionOverlay
      onClose={onClose}
      className="items-start pt-[12vh]"
      surfaceClassName="w-[min(620px,calc(100vw-28px))] overflow-hidden rounded-xl"
      surfaceStyle={{
        background: 'var(--surface-bg)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-popover)'
      }}
    >
      <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <label className="sr-only" htmlFor="command-palette-search">Command</label>
        <input
          id="command-palette-search"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((index) => Math.min(Math.max(0, displayActions.length - 1), index + 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(0, index - 1))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const action = displayActions[activeIndex]
              if (action) runAction(action)
            }
          }}
          placeholder="Search commands"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: 'var(--control-bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        />
      </div>
      <div className="max-h-[360px] overflow-y-auto p-1.5">
        {displayActions.length > 0 ? (
          groupedActions.map((group) => (
            <div key={group.name} data-command-group={group.name}>
              <div
                className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {group.name}
              </div>
              {group.entries.map(({ action, index }) => {
                const shortcut = action.shortcut ?? action.shortcuts?.[0]
                return (
                  <button
                    key={action.id}
                    ref={index === activeIndex ? activeItemRef : undefined}
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left"
                    data-testid="command-palette-action"
                    data-command-id={action.id}
                    data-active={index === activeIndex ? 'true' : 'false'}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runAction(action)}
                    style={{
                      background: index === activeIndex ? 'var(--control-bg-active)' : 'transparent',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{action.label}</span>
                      {action.description && (
                        <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {action.description}
                        </span>
                      )}
                    </span>
                    {shortcut && (
                      <span className="flex shrink-0 items-center gap-1">
                        <kbd
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: 'var(--control-bg)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)'
                          }}
                        >
                          {shortcut}
                        </kbd>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        ) : (
          <div className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No matching commands</div>
            <div className="mt-1 text-xs">Try “new chat”, “pin”, “terminal”, or “settings”.</div>
          </div>
        )}
      </div>
      <div
        className="flex items-center justify-end gap-2 border-t px-3 py-2 text-[11px]"
        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
      >
        <span>↑↓</span>
        <span>Enter</span>
        <span>Esc</span>
      </div>
    </MotionOverlay>
  )

  return createPortal(palette, document.body)
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function actionSearchText(action: CommandPaletteAction): { label: string; haystack: string; acronym: string } {
  const label = normalize(action.label)
  const haystack = normalize([
    action.label,
    action.group,
    action.description,
    action.shortcut,
    ...(action.shortcuts ?? []),
    ...(action.keywords ?? [])
  ].filter(Boolean).join(' '))
  const acronym = action.label
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .toLowerCase()
  return { label, haystack, acronym }
}

function scoreAction(action: CommandPaletteAction, query: string): number | null {
  const { label, haystack, acronym } = actionSearchText(action)
  const tokens = query.split(' ').filter(Boolean)
  if (tokens.some((token) => !haystack.includes(token) && !acronym.includes(token))) return null
  if (label === query) return 0
  if (label.startsWith(query)) return 5
  if (acronym.startsWith(query)) return 8
  if (label.includes(query)) return 15
  if ((action.keywords ?? []).some((keyword) => normalize(keyword).startsWith(query))) return 20
  if (haystack.includes(query)) return 30
  return 50 + tokens.length
}

function readRecentActionIds(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_COMMANDS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_COMMAND_LIMIT) : []
  } catch {
    return []
  }
}

function writeRecentActionIds(ids: string[]): void {
  try {
    window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(ids.slice(0, RECENT_COMMAND_LIMIT)))
  } catch {
    // Local storage is best-effort polish; command execution should never depend on it.
  }
}
