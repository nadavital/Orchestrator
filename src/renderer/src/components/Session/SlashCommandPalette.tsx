import { useEffect, useMemo, useRef } from 'react'
import type { ProviderRuntimeInfo, ProviderSlashCommand, SlashPaletteCommand } from '../../types'
import { availableSlashCommands } from '../../types'
import { Badge, PopoverSurface, SurfaceRow } from '../shared/designSystem'

interface Props {
  query: string
  providerRuntime?: ProviderRuntimeInfo
  discoveredCommands?: ProviderSlashCommand[]
  onSelect: (command: SlashPaletteCommand) => void
  onDismiss: () => void
  selectedIndex: number
  onSelectedIndexChange: (i: number) => void
}

export default function SlashCommandPalette({
  query,
  providerRuntime,
  discoveredCommands = [],
  onSelect,
  onDismiss,
  selectedIndex,
  onSelectedIndexChange
}: Props): JSX.Element | null {
  const commands = useMemo(
    () => availableSlashCommands(providerRuntime, discoveredCommands),
    [providerRuntime, discoveredCommands]
  )
  const matches = commands.filter((command) =>
    command.name.startsWith(query.length > 0 ? query : '/')
  )

  const listRef = useRef<HTMLDivElement>(null)

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
        if (matches[selectedIndex]) onSelect(matches[selectedIndex])
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [selectedIndex, matches, onSelect, onDismiss, onSelectedIndexChange])

  if (matches.length === 0) return null

  return (
    <PopoverSurface
      data-testid="composer-slash-palette"
      data-slash-command-palette="true"
      className="absolute left-0 right-0 bottom-full mb-2 overflow-hidden z-50"
      style={{
        borderRadius: 'var(--radius-xl)',
        maxHeight: 240,
        overflowY: 'auto'
      }}
    >
      <div ref={listRef}>
        {matches.map((command, i) => (
          <SurfaceRow
            as="button"
            key={`${command.group}-${command.id}`}
            active={i === selectedIndex}
            index={i}
            title={`${command.name} ${command.description ?? ''} ${command.group}`.trim()}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-none"
            onMouseEnter={() => onSelectedIndexChange(i)}
            onClick={() => onSelect(command)}
          >
            <span
              className="text-xs font-mono shrink-0"
              style={{ color: 'var(--accent)', minWidth: 108 }}
            >
              {command.name}
            </span>
            <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text-muted)' }}>
              {command.description}
            </span>
            <Badge tone={command.group === 'App' ? 'neutral' : 'accent'}>
              {command.group}
            </Badge>
          </SurfaceRow>
        ))}
      </div>
    </PopoverSurface>
  )
}

export { getSlashQuery } from '../../types'
