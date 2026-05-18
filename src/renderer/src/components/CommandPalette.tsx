import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MotionOverlay } from './shared/designSystem'

export interface CommandPaletteAction {
  id: string
  label: string
  description?: string
  shortcut?: string
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
  const filteredActions = useMemo(() => {
    const normalizedQuery = normalize(query)
    const enabled = actions.filter((action) => !action.disabled)
    if (!normalizedQuery) return enabled
    return enabled.filter((action) => {
      const haystack = normalize([
        action.label,
        action.description,
        action.shortcut,
        ...(action.keywords ?? [])
      ].filter(Boolean).join(' '))
      return haystack.includes(normalizedQuery)
    })
  }, [actions, query])

  useEffect(() => {
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

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
          filteredActions.map((action, index) => (
            <button
              key={action.id}
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
              {action.shortcut && (
                <kbd
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: 'var(--control-bg)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {action.shortcut}
                </kbd>
              )}
            </button>
          ))
        ) : (
          <div className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            No matching commands
          </div>
        )}
      </div>
    </MotionOverlay>
  )

  return createPortal(palette, document.body)
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}
