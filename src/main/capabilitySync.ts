import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { homedir } from 'os'
import type {
  CapabilityMutationResult,
  CapabilitySyncOperation,
  CapabilitySyncPlan,
  CapabilitySyncRequest,
  ProviderResource
} from '../types'

type JsonObject = Record<string, unknown>

interface InternalOperation extends CapabilitySyncOperation {
  content?: string
  json?: JsonObject
  mcpName?: string
  mcpConfig?: JsonObject
}

interface SyncBuild {
  capabilityName: string
  kind: ProviderResource['kind']
  operations: InternalOperation[]
  warnings: string[]
  blockers: string[]
}

const PROVIDER_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot'
}

export function previewCapabilitySync(input: CapabilitySyncRequest): CapabilitySyncPlan {
  return visiblePlan(buildCapabilitySync(input))
}

export function applyCapabilitySync(input: CapabilitySyncRequest): CapabilityMutationResult {
  const plan = buildCapabilitySync(input)
  const files: string[] = []
  const warnings = [...plan.warnings]
  if (plan.blockers.length > 0) {
    return { ok: false, files, warnings: [...warnings, ...plan.blockers] }
  }

  for (const operation of plan.operations) {
    if (operation.risk === 'gated') {
      warnings.push(`${operation.summary} requires provider confirmation and was not run.`)
      continue
    }
    if (operation.action === 'write-file' && operation.path && operation.content !== undefined) {
      writeText(operation.path, operation.content, files)
    } else if (operation.action === 'update-json' && operation.path && operation.json) {
      writeJson(operation.path, operation.json, files)
    } else if (operation.action === 'update-toml' && operation.path && operation.mcpName && operation.mcpConfig) {
      upsertCodexMcpToml(operation.path, operation.mcpName, operation.mcpConfig, files)
    } else if (operation.action === 'manual') {
      warnings.push(operation.summary)
    }
  }

  return { ok: true, files: unique(files), warnings: unique(warnings) }
}

function buildCapabilitySync(input: CapabilitySyncRequest): SyncBuild {
  const resources = input.resources.filter(Boolean)
  const first = resources[0]
  const kind = first?.kind ?? 'skill'
  const name = first?.name?.trim() || 'Capability'
  const targetProviders = normalizedTargets(input, kind)
  const operations: InternalOperation[] = []
  const warnings: string[] = []
  const blockers: string[] = []

  if (!first) {
    return { capabilityName: name, kind, operations, warnings, blockers: ['No capability resources were provided.'] }
  }

  if (!input.workDir.trim()) blockers.push('Open a project before syncing capabilities.')

  if (input.mode === 'install-native') {
    operations.push(...nativeInstallOperations(resources, targetProviders))
    warnings.push('Native provider install operations are gated and require explicit confirmation before execution.')
    return { capabilityName: name, kind, operations, warnings, blockers }
  }

  if (input.mode === 'remove-provider-projection') {
    blockers.push('Removing individual provider projections needs a dedicated conflict-safe delete flow.')
    return { capabilityName: name, kind, operations, warnings, blockers }
  }

  if (kind === 'skill' || kind === 'command') {
    operations.push(...skillOperations(input, resources, targetProviders))
  } else if (kind === 'plugin') {
    operations.push(...pluginOperations(input, resources, targetProviders, warnings))
  } else if (kind === 'mcp_server') {
    operations.push(...mcpOperations(input, resources, targetProviders))
  } else if (kind === 'agent') {
    blockers.push('Agent sync needs provider-specific schema validation before writing projections.')
  } else if (kind === 'hook') {
    blockers.push('Hooks can block or alter tool execution; import hooks into a plugin package with an explicit hook editor first.')
  } else if (kind === 'rule') {
    blockers.push('Instruction files are context policy, not portable capabilities; sync should be a separate copy/migration action.')
  } else if (kind === 'app') {
    blockers.push('Apps/connectors are Codex-only until another provider exposes an equivalent app projection.')
  } else {
    blockers.push(`${kind} sync is not supported yet.`)
  }

  const registryOperation = capabilityRegistryOperation(input, resources, operations)
  if (registryOperation) operations.push(registryOperation)

  return { capabilityName: name, kind, operations, warnings, blockers }
}

function skillOperations(
  input: CapabilitySyncRequest,
  resources: ProviderResource[],
  targetProviders: string[]
): InternalOperation[] {
  const source = firstPath(resources)
  const slug = slugify(resources[0]?.name ?? 'skill')
  const markdown = source ? readText(source) : buildSkillMarkdown(resources[0]?.name ?? slug, resources[0]?.description)
  const ops: InternalOperation[] = []

  for (const providerId of targetProviders) {
    if (shouldSkipProvider(input, resources, providerId)) continue
    if (providerId === 'claude') {
      const path = join(scopeBase(input), '.claude', 'skills', slug, 'SKILL.md')
      ops.push(writeFileOp(providerId, path, markdown, `Write ${PROVIDER_LABELS[providerId]} skill projection`))
    } else if (providerId === 'codex') {
      const path = join(scopeBase(input), '.agents', 'skills', slug, 'SKILL.md')
      ops.push(writeFileOp(providerId, path, markdown, `Write ${PROVIDER_LABELS[providerId]} skill projection`))
    } else {
      ops.push(unsupportedOp(providerId, 'Skill projection is not defined for this provider yet.'))
    }
  }

  return ops
}

function pluginOperations(
  input: CapabilitySyncRequest,
  resources: ProviderResource[],
  targetProviders: string[],
  warnings: string[]
): InternalOperation[] {
  const slug = slugify(resources[0]?.name ?? 'plugin')
  const base = scopeBase(input)
  const pluginRoot = portablePluginRoot(resources) ?? join(base, '.orchestrator', 'capabilities', 'plugins', slug)
  const skillPath = join(pluginRoot, 'skills', slug, 'SKILL.md')
  const skillBody = existsSync(skillPath)
    ? readText(skillPath)
    : buildSkillMarkdown(resources[0]?.name ?? slug, resources[0]?.description)
  const ops: InternalOperation[] = []
  const sourcePath = firstPath(resources)

  if (!portablePluginRoot(resources) && sourcePath) {
    warnings.push('This sync creates an Orchestrator portable plugin package instead of editing the provider-native plugin in place.')
  }

  ops.push(writeFileOp('orchestrator', skillPath, skillBody, 'Write portable plugin skill content'))

  for (const providerId of targetProviders) {
    if (shouldSkipProvider(input, resources, providerId)) continue
    if (providerId === 'claude') {
      const manifestPath = join(pluginRoot, '.claude-plugin', 'plugin.json')
      const marketplacePath = join(base, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json')
      ops.push(writeFileOp(providerId, manifestPath, `${JSON.stringify({
        name: slug,
        version: '0.1.0',
        description: resources[0]?.description || `${resources[0]?.name ?? slug} plugin`,
        author: { name: 'Orchestrator' }
      }, null, 2)}\n`, 'Write Claude plugin manifest'))
      ops.push(updateJsonOp(providerId, marketplacePath, upsertClaudeMarketplace(readJson(marketplacePath), slug, resources[0]?.description), 'Register Claude plugin marketplace entry'))
    } else if (providerId === 'codex') {
      const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json')
      const marketplacePath = join(base, '.agents', 'plugins', 'marketplace.json')
      ops.push(writeFileOp(providerId, manifestPath, `${JSON.stringify({
        name: slug,
        version: '0.1.0',
        description: resources[0]?.description || `${resources[0]?.name ?? slug} plugin`
      }, null, 2)}\n`, 'Write Codex plugin manifest'))
      ops.push(updateJsonOp(providerId, marketplacePath, upsertCodexMarketplace(readJson(marketplacePath), slug, resources[0]?.description), 'Register Codex plugin marketplace entry'))
    } else {
      ops.push(unsupportedOp(providerId, 'Plugin projection is not defined for this provider yet.'))
    }
  }

  return ops
}

function mcpOperations(
  input: CapabilitySyncRequest,
  resources: ProviderResource[],
  targetProviders: string[]
): InternalOperation[] {
  const slug = slugify(resources[0]?.name ?? 'mcp-server')
  const config = mcpConfig(resources)
  const base = scopeBase(input)
  const ops: InternalOperation[] = [
    updateJsonOp('orchestrator', join(base, '.orchestrator', 'capabilities', 'mcp', `${slug}.json`), { mcpServers: { [slug]: config } }, 'Write canonical MCP descriptor')
  ]

  for (const providerId of targetProviders) {
    if (shouldSkipProvider(input, resources, providerId)) continue
    if (providerId === 'claude') {
      ops.push(updateJsonOp(providerId, join(base, '.mcp.json'), upsertMcpJson(readJson(join(base, '.mcp.json')), slug, config), 'Write Claude/shared MCP config'))
    } else if (providerId === 'codex') {
      ops.push(updateTomlOp(providerId, join(base, '.codex', 'config.toml'), slug, config, 'Write Codex MCP config'))
    } else if (providerId === 'cursor') {
      ops.push(updateJsonOp(providerId, join(base, '.cursor', 'mcp.json'), upsertMcpJson(readJson(join(base, '.cursor', 'mcp.json')), slug, config), 'Write Cursor MCP config'))
    } else if (providerId === 'copilot') {
      ops.push(updateJsonOp(providerId, join(base, '.copilot', 'mcp-config.json'), upsertMcpJson(readJson(join(base, '.copilot', 'mcp-config.json')), slug, config), 'Write GitHub Copilot MCP config'))
    } else {
      ops.push(unsupportedOp(providerId, 'MCP projection is not defined for this provider yet.'))
    }
  }

  return ops
}

function nativeInstallOperations(resources: ProviderResource[], targetProviders: string[]): InternalOperation[] {
  const name = slugify(resources[0]?.name ?? 'capability')
  return targetProviders.flatMap((providerId): InternalOperation[] => {
    if (providerId === 'claude' && resources[0]?.kind === 'plugin') {
      return [{
        providerId,
        action: 'run-command',
        command: ['claude', 'plugin', 'install', name],
        summary: 'Install plugin through Claude native plugin manager',
        risk: 'gated'
      }]
    }
    if (providerId === 'codex' && resources[0]?.kind === 'plugin') {
      return [{
        providerId,
        action: 'app-server-call',
        appServerMethod: 'plugin/install',
        summary: 'Install plugin through Codex app-server',
        risk: 'gated'
      }]
    }
    return [unsupportedOp(providerId, 'Native install is only defined for plugin resources.')]
  })
}

function normalizedTargets(input: CapabilitySyncRequest, kind: ProviderResource['kind']): string[] {
  if (input.targetProviders.length > 0) return unique(input.targetProviders)
  if (kind === 'mcp_server') return ['claude', 'codex', 'cursor', 'copilot']
  if (kind === 'skill' || kind === 'command' || kind === 'plugin') return ['claude', 'codex']
  return ['claude', 'codex']
}

function shouldSkipProvider(input: CapabilitySyncRequest, resources: ProviderResource[], providerId: string): boolean {
  return input.mode === 'backfill-missing-providers' && resources.some((resource) => resource.providerId === providerId)
}

function scopeBase(input: CapabilitySyncRequest): string {
  return input.scope === 'global' ? homedir() : input.workDir
}

function firstPath(resources: ProviderResource[]): string | null {
  for (const resource of resources) {
    const raw = recordValue(resource.raw)
    if (typeof raw?.path === 'string') return raw.path
    if (typeof raw?.manifestPath === 'string') return raw.manifestPath
  }
  return null
}

function portablePluginRoot(resources: ProviderResource[]): string | null {
  for (const resource of resources) {
    const path = recordValue(resource.raw)?.path
    if (typeof path === 'string' && path.includes(`${join('.orchestrator', 'capabilities', 'plugins')}`)) return path
  }
  return null
}

function mcpConfig(resources: ProviderResource[]): JsonObject {
  for (const resource of resources) {
    const config = recordValue(recordValue(resource.raw)?.config)
    if (config) return config
  }
  return { command: 'node', args: [] }
}

function capabilityRegistryOperation(
  input: CapabilitySyncRequest,
  resources: ProviderResource[],
  operations: InternalOperation[]
): InternalOperation | null {
  const first = resources[0]
  if (!first) return null
  const paths: Record<string, string> = {}
  for (const operation of operations) {
    if (!operation.path || operation.risk === 'gated' || operation.action === 'manual') continue
    paths[operation.providerId] ??= operation.path
  }
  if (Object.keys(paths).length === 0) return null

  const slug = slugify(first.name)
  return updateJsonOp(
    'orchestrator',
    join(scopeBase(input), '.orchestrator', 'capabilities', 'registry', first.kind, slug, 'capability.json'),
    registryValue(input, resources, paths),
    'Write capability sync registry'
  )
}

function registryValue(input: CapabilitySyncRequest, resources: ProviderResource[], paths: Record<string, string>): JsonObject {
  const first = resources[0]
  return {
    schemaVersion: 1,
    id: `${first.kind}:${slugify(first.name)}`,
    kind: first.kind,
    name: first.name,
    slug: slugify(first.name),
    scope: input.scope,
    origin: {
      providerId: first.providerId,
      resourceId: first.id,
      sourcePath: firstPath(resources)
    },
    desiredProviders: normalizedTargets(input, first.kind),
    projections: Object.fromEntries(Object.entries(paths).map(([providerId, path]) => [
      providerId,
      { state: 'synced', mode: providerId === 'orchestrator' ? 'file' : projectionMode(first.kind), path, lastSyncedAt: new Date().toISOString() }
    ]))
  }
}

function projectionMode(kind: ProviderResource['kind']): string {
  if (kind === 'mcp_server') return 'config'
  if (kind === 'plugin') return 'marketplace'
  return 'file'
}

function visiblePlan(plan: SyncBuild): CapabilitySyncPlan {
  return {
    ok: plan.blockers.length === 0,
    capabilityName: plan.capabilityName,
    kind: plan.kind,
    operations: plan.operations.map(({ content: _content, json: _json, mcpName: _mcpName, mcpConfig: _mcpConfig, ...operation }) => operation),
    warnings: unique(plan.warnings),
    blockers: unique(plan.blockers)
  }
}

function writeFileOp(providerId: string, path: string, content: string, summary: string): InternalOperation {
  return { providerId, action: 'write-file', path, content, summary, risk: 'low' }
}

function updateJsonOp(providerId: string, path: string, json: JsonObject, summary: string): InternalOperation {
  return { providerId, action: 'update-json', path, json, summary, risk: 'medium' }
}

function updateTomlOp(providerId: string, path: string, mcpName: string, mcpConfig: JsonObject, summary: string): InternalOperation {
  return { providerId, action: 'update-toml', path, mcpName, mcpConfig, summary, risk: 'medium' }
}

function unsupportedOp(providerId: string, summary: string): InternalOperation {
  return { providerId, action: 'manual', summary, risk: 'gated' }
}

function buildSkillMarkdown(name: string, description?: string): string {
  return [
    '---',
    `name: ${slugify(name)}`,
    `description: ${description || `Reusable workflow for ${name}.`}`,
    '---',
    '',
    `# ${name}`,
    '',
    `Use this capability when the user asks for ${name}.`,
    ''
  ].join('\n')
}

function upsertMcpJson(current: JsonObject, name: string, serverConfig: JsonObject): JsonObject {
  const mcpServers = recordValue(current.mcpServers) ?? {}
  return {
    ...current,
    mcpServers: {
      ...mcpServers,
      [name]: serverConfig
    }
  }
}

function upsertClaudeMarketplace(current: JsonObject, slug: string, description?: string): JsonObject {
  const plugins = arrayValue(current.plugins).filter((entry) => !recordValue(entry) || recordValue(entry)?.name !== slug)
  return {
    name: stringValue(current.name) || 'orchestrator-capabilities',
    owner: recordValue(current.owner) ?? { name: 'Orchestrator' },
    plugins: [
      ...plugins,
      { name: slug, source: `./plugins/${slug}`, description: description || `${slug} plugin` }
    ]
  }
}

function upsertCodexMarketplace(current: JsonObject, slug: string, description?: string): JsonObject {
  const plugins = arrayValue(current.plugins).filter((entry) => !recordValue(entry) || recordValue(entry)?.name !== slug)
  return {
    name: stringValue(current.name) || 'orchestrator-capabilities',
    interface: recordValue(current.interface) ?? { displayName: 'Orchestrator Capabilities' },
    plugins: [
      ...plugins,
      {
        name: slug,
        source: { source: 'local', path: `./.orchestrator/capabilities/plugins/${slug}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
        description: description || `${slug} plugin`
      }
    ]
  }
}

function upsertCodexMcpToml(path: string, name: string, config: JsonObject, files: string[]): void {
  const markerStart = `# orchestrator:${name}:start`
  const markerEnd = `# orchestrator:${name}:end`
  const existing = existsSync(path) ? readText(path) : ''
  const url = stringValue(config.url)
  const command = stringValue(config.command)
  const args = Array.isArray(config.args) ? config.args.filter((item): item is string => typeof item === 'string') : []
  const block = [
    markerStart,
    `[mcp_servers.${quoteTomlKey(name)}]`,
    url ? `url = ${JSON.stringify(url)}` : `command = ${JSON.stringify(command)}`,
    !url ? `args = ${JSON.stringify(args)}` : '',
    markerEnd
  ].filter(Boolean).join('\n')
  const pattern = new RegExp(`${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}`)
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`
  writeText(path, next, files)
}

function writeJson(path: string, value: unknown, files: string[]): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`, files)
}

function writeText(path: string, content: string, files: string[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  files.push(path)
}

function readJson(path: string): JsonObject {
  try {
    const parsed = JSON.parse(readText(path)) as unknown
    return recordValue(parsed) ?? {}
  } catch {
    return {}
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function recordValue(value: unknown): JsonObject | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function slugify(value: string): string {
  return basename(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'capability'
}

function quoteTomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
