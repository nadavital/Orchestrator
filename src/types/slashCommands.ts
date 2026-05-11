import type { ProviderRuntimeInfo, ProviderSlashCommand } from './index'

export type SlashPaletteGroup = 'App' | 'Provider'

export type SlashPaletteCommand = ProviderSlashCommand & {
  group: SlashPaletteGroup
}

export const APP_SLASH_COMMANDS: ProviderSlashCommand[] = [
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
    id: 'pet',
    name: '/pet',
    description: 'Toggle pet',
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
    id: 'agents',
    name: '/agents',
    description: 'Open agents',
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
  providerRuntime: ProviderRuntimeInfo | undefined
): SlashPaletteCommand[] {
  const featureSupport = new Map(
    providerRuntime?.registry.features.map((feature) => [feature.id, feature.support]) ?? []
  )
  const providerCommands = providerRuntime?.registry.slashCommands.filter((command) => {
    if (!command.featureId) return true
    const support = featureSupport.get(command.featureId)
    return support === 'supported' || support === 'partial'
  }) ?? []

  return [
    ...APP_SLASH_COMMANDS.map((command) => ({ ...command, group: 'App' as const })),
    ...providerCommands.map((command) => ({ ...command, group: 'Provider' as const }))
  ]
}

export function getSlashQuery(text: string): string | null {
  const match = text.match(/^(\/\S*)/)
  return match ? match[1] : null
}
