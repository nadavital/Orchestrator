import { useEffect, useMemo, useRef } from 'react'
import type { ProviderRuntimeInfo, ProviderRuntimeKind, ProviderSlashCommand } from '../../types'

export type SlashPaletteCommand = ProviderSlashCommand & {
  group: 'App' | 'Provider'
}

const APP_COMMANDS: ProviderSlashCommand[] = [
  {
    id: 'settings',
    name: '/settings',
    description: 'Open settings',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  },
  {
    id: 'diff',
    name: '/diff',
    description: 'Toggle diff',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  },
  {
    id: 'terminal',
    name: '/terminal',
    description: 'Toggle terminal',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  },
  {
    id: 'skills',
    name: '/skills',
    description: 'Toggle skills',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  },
  {
    id: 'events',
    name: '/events',
    description: 'Toggle events',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  },
  {
    id: 'model',
    name: '/model',
    description: 'Choose provider or model',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  },
  {
    id: 'permissions',
    name: '/permissions',
    description: 'Choose permission mode',
    providerId: 'app',
    source: 'app',
    runtime: 'headless',
    handler: 'app-action'
  }
]

export function availableSlashCommands(
  providerRuntime: ProviderRuntimeInfo | undefined,
  runtime: ProviderRuntimeKind
): SlashPaletteCommand[] {
  const featureSupport = new Map(
    providerRuntime?.registry.features.map((feature) => [feature.id, feature.support]) ?? []
  )
  const providerCommands = providerRuntime?.registry.slashCommands.filter((command) => {
    if (command.runtime !== runtime) return false
    if (!command.featureId) return true
    const support = featureSupport.get(command.featureId)
    return support === 'supported' || support === 'partial'
  }) ?? []

  return [
    ...APP_COMMANDS.map((command) => ({ ...command, group: 'App' as const })),
    ...providerCommands.map((command) => ({ ...command, group: 'Provider' as const }))
  ]
}

interface Props {
  query: string
  providerRuntime?: ProviderRuntimeInfo
  runtime: ProviderRuntimeKind
  onSelect: (command: SlashPaletteCommand) => void
  onDismiss: () => void
  selectedIndex: number
  onSelectedIndexChange: (i: number) => void
}

export default function SlashCommandPalette({
  query,
  providerRuntime,
  runtime,
  onSelect,
  onDismiss,
  selectedIndex,
  onSelectedIndexChange
}: Props): JSX.Element | null {
  const commands = useMemo(
    () => availableSlashCommands(providerRuntime, runtime),
    [providerRuntime, runtime]
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
        {matches.map((command, i) => (
          <button
            key={`${command.group}-${command.id}`}
            className="w-full flex items-center gap-3 px-3 py-2 text-left"
            style={{
              background: i === selectedIndex ? 'var(--color-surface2)' : 'transparent'
            }}
            onMouseEnter={() => onSelectedIndexChange(i)}
            onClick={() => onSelect(command)}
          >
            <span
              className="text-xs font-mono shrink-0"
              style={{ color: 'var(--color-accent)', minWidth: 108 }}
            >
              {command.name}
            </span>
            <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text-muted)' }}>
              {command.description}
            </span>
            <span
              className="text-xs shrink-0"
              style={{
                color: command.group === 'App' ? 'var(--color-text-muted)' : 'var(--color-accent)',
                fontSize: 10
              }}
            >
              {command.group}
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
