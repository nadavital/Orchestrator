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

export default function CommandPalette({ actions, onClose }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const filteredActions = useMemo(() => {
    const normalizedQuery = normalize(query)
    const enabled = actions.filter((action) => !action.disabled)
    if (!normalizedQuery) return enabled
    return enabled.filter((action) => {
      const haystack = normalize([
        action.label,
        action.group,
        action.description,
        action.shortcut,
        ...(action.shortcuts ?? []),
        ...(action.keywords ?? [])
      ].filter(Boolean).join(' '))
      return haystack.includes(normalizedQuery)
    })
  }, [actions, query])

  const groupedActions = useMemo(() => {
    const groups: Array<{ name: string; actions: CommandPaletteAction[] }> = []
    for (const action of filteredActions) {
      const groupName = action.group ?? 'Commands'
      let group = groups.find((candidate) => candidate.name === groupName)
      if (!group) {
        group = { name: groupName, actions: [] }
        groups.push(group)
      }
      group.actions.push(action)
    }
    return groups
  }, [filteredActions])

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runAction = (action: CommandPaletteAction): void => {
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
              setActiveIndex((index) => Math.min(filteredActions.length - 1, index + 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((index) => Math.max(0, index - 1))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              const action = filteredActions[activeIndex]
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
        {filteredActions.length > 0 ? (
          groupedActions.map((group) => (
            <div key={group.name} data-command-group={group.name}>
              <div
                className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {group.name}
              </div>
              {group.actions.map((action) => {
                const index = filteredActions.findIndex((candidate) => candidate.id === action.id)
                const shortcuts = action.shortcuts ?? (action.shortcut ? [action.shortcut] : [])
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
                    {shortcuts.length > 0 && (
                      <span className="flex shrink-0 items-center gap-1">
                        {shortcuts.map((shortcut) => (
                          <kbd
                            key={`${action.id}-${shortcut}`}
                            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                            style={{
                              background: 'var(--control-bg)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-secondary)'
                            }}
                          >
                            {shortcut}
                          </kbd>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))
        ) : (
          <div className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            No matching commands
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
