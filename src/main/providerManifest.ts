import type { ProviderManifest, ProviderRuntimeKind, SessionStatus } from '../types'
import { PROVIDER_DEFS } from '../types'
import { getProvider, PROVIDERS } from './providers'

const STATUS_LIFECYCLE: SessionStatus[] = [
  'idle',
  'running',
  'waiting_for_permission',
  'waiting_for_user',
  'reconnecting',
  'auth_error',
  'model_error',
  'quota_error',
  'rate_limit_error',
  'provider_error',
  'error'
]

export function providerManifests(): Record<string, ProviderManifest> {
  return Object.fromEntries(
    Object.keys(PROVIDERS).map((providerId) => [providerId, providerManifest(providerId)])
  )
}

export function providerManifest(providerId: string): ProviderManifest {
  const adapter = getProvider(providerId)
  const def = PROVIDER_DEFS[providerId] ?? PROVIDER_DEFS.claude
  const runtimes: ProviderRuntimeKind[] = providerId === 'claude' || providerId === 'copilot' ? ['sdk'] : ['headless']
  if (providerId === 'cursor') runtimes.push('sdk')
  if (providerId === 'copilot') runtimes.push('headless')
  if (providerId !== 'claude' && adapter.capabilities.interactiveCli) runtimes.push('interactive')
  if (providerId === 'codex') runtimes.push('app-server')

  return {
    id: adapter.id,
    name: def.name,
    runtimes,
    defaultRuntime: providerId === 'codex' ? 'app-server' : providerId === 'claude' || providerId === 'copilot' ? 'sdk' : 'headless',
    statusLifecycle: STATUS_LIFECYCLE,
    capabilityKeys: [
      'resume',
      'interactiveCli',
      'structuredOutput',
      'streamEvents',
      'interactivePermissions',
      'toolAllowlist',
      'workspaceSandbox',
      'fullAccess',
      'bypassAll'
    ],
    customStates: providerId === 'cursor'
      ? ['reconnecting']
      : providerId === 'claude'
        ? ['planning', 'permission-review']
        : providerId === 'codex'
          ? ['app-server-turn', 'approval-review']
          : []
  }
}
