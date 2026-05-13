import type { ProviderRuntimeInfo, ProviderSlashCommand } from './index'

export type SlashPaletteGroup = 'App' | 'Provider' | 'Project' | 'Global' | 'Skills' | 'Terminal'

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
    id: 'plan-sidebar',
    name: '/plans',
    description: 'Open plan',
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
  providerRuntime: ProviderRuntimeInfo | undefined,
  discoveredCommands: ProviderSlashCommand[] = []
): SlashPaletteCommand[] {
  const featureSupport = new Map(
    providerRuntime?.registry.features.map((feature) => [feature.id, feature.support]) ?? []
  )
  const providerCommands = providerRuntime?.registry.slashCommands.filter((command) => {
    if (!command.featureId) return true
    const support = featureSupport.get(command.featureId)
    return support === 'supported' || support === 'partial'
  }) ?? []
  const appCommandNames = new Set(APP_SLASH_COMMANDS.map((command) => command.name))
  const nonCollidingProviderCommands = providerCommands.filter((command) => !appCommandNames.has(command.name))

  return [
    ...APP_SLASH_COMMANDS.map((command) => ({ ...command, group: slashCommandGroup(command) })),
    ...nonCollidingProviderCommands.map((command) => ({ ...command, group: slashCommandGroup(command) })),
    ...discoveredCommands.map((command) => ({ ...command, group: slashCommandGroup(command) }))
  ]
}

export function slashCommandGroup(command: ProviderSlashCommand): SlashPaletteGroup {
  if (command.source === 'app') return 'App'
  if (command.source === 'skill') return 'Skills'
  if (command.scope === 'project') return 'Project'
  if (command.scope === 'global') return 'Global'
  if (command.runtime === 'interactive' && command.handler === 'send-to-provider') return 'Terminal'
  return 'Provider'
}

export function expandSlashCommandPrompt(command: ProviderSlashCommand, args: string): string | null {
  if (command.handler !== 'insert-prompt' || !command.prompt) return null
  const trimmedArgs = args.trim()
  return command.prompt
    .replace(/\$\{?ARGUMENTS\}?/g, trimmedArgs)
    .trim()
}

export function getSlashQuery(text: string): string | null {
  const match = text.match(/^(\/\S*)/)
  return match ? match[1] : null
}
