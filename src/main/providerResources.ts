import type {
  ProviderCommandSurface,
  ProviderCommandSurfaceResult,
  ProviderResource,
  ProviderResourceKind,
  ProviderResourceSnapshot
} from '../types'
import { getProviderRuntimeInfo, runProviderCommandSurfaceAsync } from './providers'
import { discoverClaudeExtensions } from './claudeExtensions'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, join, relative } from 'path'
import { homedir } from 'os'

const RESOURCE_AREAS = new Set<ProviderCommandSurface['area']>(['agents', 'extensions', 'mcp'])

export async function listProviderResources(providerId?: string): Promise<Record<string, ProviderResourceSnapshot>> {
  const runtimeInfo = getProviderRuntimeInfo()
  const ids = providerId ? [providerId] : Object.keys(runtimeInfo)
  const snapshots = await Promise.all(ids.map((id) => discoverProviderResources(id)))
  return Object.fromEntries(snapshots.map((snapshot) => [snapshot.providerId, snapshot]))
}

export async function discoverProviderResources(providerId: string): Promise<ProviderResourceSnapshot> {
  const runtime = getProviderRuntimeInfo()[providerId]
  const surfaces = resourceSurfaces(runtime?.registry.commandSurfaces ?? [])
  const resources: ProviderResource[] = discoverLocalProviderResources(providerId)
  const errors: ProviderResourceSnapshot['errors'] = []

  const results = await Promise.all(surfaces.map(async (surface) => ({
    surface,
    result: await runProviderCommandSurfaceAsync(providerId, surface.id)
  })))

  for (const { surface, result } of results) {
    if (result.status !== 'ok') {
      errors.push({ surfaceId: surface.id, message: result.output })
      continue
    }
    resources.push(...resourcesFromSurfaceResult(surface, result))
  }

  return {
    providerId,
    status: errors.length === 0 ? 'ok' : resources.length > 0 ? 'partial' : 'error',
    lastRefreshedAt: Date.now(),
    resources: dedupeProviderResources(resources),
    errors
  }
}

export function resourceSurfaces(surfaces: ProviderCommandSurface[]): ProviderCommandSurface[] {
  return surfaces.filter((surface) =>
    surface.appSurface === 'settings' &&
    surface.quota === 'none' &&
    !surface.mutatesState &&
    RESOURCE_AREAS.has(surface.area)
  )
}

export function discoverLocalProviderResources(
  providerId: string,
  cwd = process.cwd(),
  homeDir = homedir()
): ProviderResource[] {
  if (providerId === 'claude') return discoverClaudeResources(cwd, homeDir)
  if (providerId === 'cursor') return discoverCursorResources(cwd, homeDir)
  if (providerId === 'copilot') return discoverCopilotResources(cwd, homeDir)
  return []
}

export function resourcesFromSurfaceResult(
  surface: Pick<ProviderCommandSurface, 'id' | 'label' | 'area' | 'runtime'>,
  result: ProviderCommandSurfaceResult
): ProviderResource[] {
  if (result.status !== 'ok') return []
  const parsed = parseOutput(result.output)
  if (result.providerId === 'claude') return claudeResources(surface, result, parsed)
  if (result.providerId === 'codex') return codexResources(surface, result, parsed)
  return genericResources(surface, result, parsed)
}

function claudeResources(
  surface: Pick<ProviderCommandSurface, 'id' | 'label' | 'area' | 'runtime'>,
  result: ProviderCommandSurfaceResult,
  parsed: unknown
): ProviderResource[] {
  if (surface.id === 'agents-list') {
    return textLines(result.output)
      .filter((line) => !/^\d+\s+active\s+agents?$/i.test(line))
      .map((line) => line.replace(/^[-*]\s+/, '').split(/\s*[·•]\s*/)[0]?.trim())
      .filter((name): name is string => Boolean(name) && !/^(none|no configured agents|agents?:)$/i.test(name))
      .map((name) => makeResource({
        providerId: result.providerId,
        kind: 'agent',
        source: 'Claude CLI',
        name,
        status: 'available',
        scope: 'provider',
        raw: name
      }))
  }

  if (surface.id === 'mcp-details') {
    return arrayValue(parsed).flatMap((entry) => {
      const item = objectValue(entry)
      const name = stringValue(item?.server, item?.name, item?.id)
      if (!name || isCommandNoise(name)) return []
      const statusText = stringValue(item?.status)
      return makeResource({
        providerId: result.providerId,
        kind: 'mcp_server',
        source: 'Claude CLI',
        name,
        description: stringValue(item?.detail),
        status: statusFromText(statusText),
        scope: 'provider',
        raw: entry
      })
    })
  }

  if (surface.id === 'mcp-list') {
    return textLines(result.output).filter((line) => !isCommandNoise(line)).flatMap((line) => {
      const cleaned = line.replace(/^[✓✔✕✖\-*]\s*/, '').trim()
      const name = cleaned.split(/\s{2,}|\s+-\s+|:/)[0]?.trim()
      if (!name || /^no mcp/i.test(name) || isCommandNoise(name)) return []
      return makeResource({
        providerId: result.providerId,
        kind: 'mcp_server',
        source: 'Claude CLI',
        name,
        description: cleaned !== name ? cleaned : undefined,
        status: /fail|error|disabled/i.test(cleaned) ? 'error' : 'available',
        scope: 'provider',
        raw: line
      })
    })
  }

  if (surface.id === 'plugin-list') {
    return resourceArray(parsed).map((entry, index) => {
      const item = objectValue(entry)
      return makeResource({
        providerId: result.providerId,
        kind: 'plugin',
        source: 'Claude CLI',
        name: compactScalar(item?.name ?? item?.id ?? entry ?? `Plugin ${index + 1}`),
        description: stringValue(item?.description, item?.summary),
        status: statusFromText(item?.enabled ?? item?.status ?? item?.state),
        scope: scopeFromText(item?.scope),
        raw: entry
      })
    })
  }

  return genericResources(surface, result, parsed)
}

function codexResources(
  surface: Pick<ProviderCommandSurface, 'id' | 'label' | 'area' | 'runtime'>,
  result: ProviderCommandSurfaceResult,
  parsed: unknown
): ProviderResource[] {
  const kind = codexKind(surface.id)
  if (!kind) return []
  return resourceArray(parsed).map((entry, index) => {
    const item = objectValue(entry)
    const name = resourceName([
      item?.name,
      item?.title,
      item?.id,
      item?.server,
      item?.serverName,
      item?.provider,
      item?.source,
      item?.path,
      item?.configPath,
      item?.filePath,
      item?.command,
      entry
    ], codexFallbackName(surface, index))
    return makeResource({
      providerId: result.providerId,
      kind,
      source: 'Codex app-server',
      name,
      description: stringValue(item?.description, item?.summary, item?.path, item?.command),
      status: statusFromText(item?.status ?? item?.state ?? item?.enabled ?? item?.available ?? item?.availability),
      scope: scopeFromText(item?.scope ?? item?.source),
      raw: entry
    })
  })
}

function genericResources(
  surface: Pick<ProviderCommandSurface, 'id' | 'label' | 'area' | 'runtime'>,
  result: ProviderCommandSurfaceResult,
  parsed: unknown
): ProviderResource[] {
  const kind = surfaceKind(surface)
  return resourceArray(parsed).map((entry, index) => {
    const item = objectValue(entry)
    const name = resourceName([
      item?.name,
      item?.title,
      item?.id,
      item?.server,
      entry
    ], `${surface.label} ${index + 1}`)
    return makeResource({
      providerId: result.providerId,
      kind,
      source: `${result.providerId} ${surface.runtime}`,
      name,
      description: stringValue(item?.description, item?.summary, item?.status),
      status: statusFromText(item?.status ?? item?.state ?? item?.enabled),
      scope: scopeFromText(item?.scope),
      raw: entry
    })
  })
}

function codexKind(surfaceId: string): ProviderResourceKind | null {
  if (surfaceId === 'appserver-skills') return 'skill'
  if (surfaceId === 'appserver-hooks') return 'hook'
  if (surfaceId === 'appserver-plugins') return 'plugin'
  if (surfaceId === 'appserver-apps') return 'app'
  if (surfaceId === 'appserver-mcp-status') return 'mcp_server'
  if (surfaceId === 'appserver-external-agent-config') return 'agent'
  return null
}

function discoverClaudeResources(cwd: string, homeDir: string): ProviderResource[] {
  const extensions = discoverClaudeExtensions(cwd, homeDir)
  return [
    ...extensions.skills.map((skill) => makeResource({
      providerId: 'claude',
      kind: 'skill',
      source: 'Claude skills',
      name: skill.name.replace(/^\/skill:/, ''),
      description: skill.description,
      status: 'available',
      scope: skill.scope ?? 'project',
      raw: skill
    })),
    ...extensions.commands.map((command) => makeResource({
      providerId: 'claude',
      kind: 'command',
      source: 'Claude commands',
      name: command.name,
      description: command.description,
      status: 'available',
      scope: command.scope ?? 'project',
      raw: command
    }))
  ]
}

function discoverCursorResources(cwd: string, homeDir: string): ProviderResource[] {
  return [
    ...rulesFromDirectory('cursor', 'Cursor rules', join(cwd, '.cursor', 'rules'), '.cursor/rules'),
    ...rulesFromFiles('cursor', 'Cursor rules', cwd, ['.cursorrules']),
    ...mcpServersFromConfig('cursor', 'Cursor MCP', join(homeDir, '.cursor', 'mcp.json'), 'global'),
    ...mcpServersFromConfig('cursor', 'Cursor MCP', join(cwd, '.cursor', 'mcp.json'), 'project')
  ]
}

function discoverCopilotResources(cwd: string, homeDir: string): ProviderResource[] {
  return [
    makeResource({
      providerId: 'copilot',
      kind: 'mcp_server',
      source: 'GitHub Copilot CLI',
      name: 'github',
      description: 'Built-in GitHub MCP server',
      status: 'available',
      scope: 'provider',
      raw: { builtIn: true }
    }),
    ...mcpServersFromConfig('copilot', 'GitHub Copilot MCP', join(homeDir, '.copilot', 'mcp-config.json'), 'global'),
    ...rulesFromFiles('copilot', 'GitHub Copilot instructions', cwd, [
      '.github/copilot-instructions.md',
      'CLAUDE.md',
      'GEMINI.md'
    ]),
    ...rulesFromDirectory('copilot', 'GitHub Copilot instructions', join(cwd, '.github', 'instructions'), '.github/instructions', '.instructions.md'),
    ...rulesFromDirectory('copilot', 'GitHub Copilot agent instructions', cwd, '.', 'AGENTS.md')
  ]
}

function rulesFromFiles(
  providerId: string,
  source: string,
  cwd: string,
  paths: string[]
): ProviderResource[] {
  return paths.flatMap((path) => ruleFromFile(providerId, source, join(cwd, path), path, 'project'))
}

function rulesFromDirectory(
  providerId: string,
  source: string,
  root: string,
  displayRoot: string,
  suffix = ''
): ProviderResource[] {
  return walkFiles(root)
    .filter((path) => {
      if (!suffix) return /\.(md|mdc)$/i.test(path)
      return basename(path) === suffix || path.endsWith(suffix)
    })
    .flatMap((path) => {
      const rel = relative(root, path)
      const displayPath = displayRoot === '.' ? rel : join(displayRoot, rel)
      return ruleFromFile(providerId, source, path, displayPath, 'project')
    })
}

function ruleFromFile(
  providerId: string,
  source: string,
  path: string,
  displayPath: string,
  scope: ProviderResource['scope']
): ProviderResource[] {
  if (!safeStat(path)?.isFile()) return []
  const name = displayPath.replace(/\.(instructions\.md|mdc|md)$/i, '')
  return [makeResource({
    providerId,
    kind: 'rule',
    source,
    name,
    description: firstMarkdownSummary(path),
    status: 'available',
    scope,
    raw: { path }
  })]
}

function mcpServersFromConfig(
  providerId: string,
  source: string,
  path: string,
  scope: ProviderResource['scope']
): ProviderResource[] {
  const config = readJsonObject(path)
  const servers = objectValue(config?.mcpServers)
  if (!servers) return []
  return Object.entries(servers).map(([name, value]) => {
    const item = objectValue(value)
    return makeResource({
      providerId,
      kind: 'mcp_server',
      source,
      name,
      description: stringValue(item?.type, item?.url, item?.command),
      status: statusFromText(item?.disabled === true ? false : item?.status ?? item?.enabled ?? true),
      scope,
      raw: { path, config: value }
    })
  })
}

function surfaceKind(surface: Pick<ProviderCommandSurface, 'area'>): ProviderResourceKind {
  if (surface.area === 'agents') return 'agent'
  if (surface.area === 'mcp') return 'mcp_server'
  return 'plugin'
}

function codexFallbackName(
  surface: Pick<ProviderCommandSurface, 'id' | 'label'>,
  index: number
): string {
  if (surface.id === 'appserver-external-agent-config') return 'External agent config'
  if (surface.id === 'appserver-hooks') return `Hook ${index + 1}`
  return `${surface.label} ${index + 1}`
}

function resourceName(values: unknown[], fallback: string): string {
  for (const value of values) {
    const text = compactScalar(value)
    if (text && !isCommandNoise(text)) return text
  }
  return fallback
}

function isCommandNoise(value: string): boolean {
  return /checking mcp server health|refreshing provider inventory|loading resources/i.test(value)
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function firstMarkdownSummary(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .find((line) => line.length > 0)
  } catch {
    return undefined
  }
}

function walkFiles(root: string, depth = 0): string[] {
  if (depth > 4) return []
  const stat = safeStat(root)
  if (!stat?.isDirectory()) return []
  return readdirSync(root).sort().flatMap((name) => {
    if (name === '.git' || name === 'node_modules' || name === 'out' || name === 'out-test') return []
    const path = join(root, name)
    const child = safeStat(path)
    if (child?.isDirectory()) return walkFiles(path, depth + 1)
    return child?.isFile() ? [path] : []
  })
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return existsSync(path) ? statSync(path) : null
  } catch {
    return null
  }
}

function makeResource(input: Omit<ProviderResource, 'id' | 'fingerprint' | 'actions'>): ProviderResource {
  const name = input.name.trim() || 'Unnamed'
  const fingerprint = [input.kind, canonicalName(name)].join(':')
  return {
    ...input,
    name,
    id: `${input.providerId}:${input.kind}:${canonicalName(name)}`,
    fingerprint,
    actions: ['refresh', 'inspect']
  }
}

function dedupeProviderResources(resources: ProviderResource[]): ProviderResource[] {
  const byId = new Map<string, ProviderResource>()
  for (const resource of resources) {
    const previous = byId.get(resource.id)
    if (!previous) {
      byId.set(resource.id, resource)
      continue
    }
    byId.set(resource.id, {
      ...previous,
      description: previous.description ?? resource.description,
      status: mergeStatus(previous.status, resource.status)
    })
  }
  return [...byId.values()].sort(compareResources)
}

function compareResources(a: ProviderResource, b: ProviderResource): number {
  const kindCompare = kindLabel(a.kind).localeCompare(kindLabel(b.kind))
  if (kindCompare !== 0) return kindCompare
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function mergeStatus(a: ProviderResource['status'], b: ProviderResource['status']): ProviderResource['status'] {
  const rank: ProviderResource['status'][] = ['enabled', 'available', 'unknown', 'disabled', 'missing', 'error']
  return rank.indexOf(a) <= rank.indexOf(b) ? a : b
}

function parseOutput(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch {
    return output
  }
}

function resourceArray(value: unknown): unknown[] {
  const record = objectValue(value)
  return arrayValue(
    record?.data ??
    record?.items ??
    record?.results ??
    record?.resources ??
    record?.plugins ??
    record?.apps ??
    record?.skills ??
    record?.hooks ??
    record?.servers ??
    record?.serverStatuses ??
    record?.statuses ??
    record?.agents ??
    record?.configs ??
    value
  )
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = compactScalar(value)
    if (text) return text
  }
  return undefined
}

function compactScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const record = objectValue(value)
  if (record) return compactScalar(record.name ?? record.label ?? record.id ?? record.status)
  return ''
}

function statusFromText(value: unknown): ProviderResource['status'] {
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled'
  const text = compactScalar(value).toLowerCase()
  if (/enabled|active|ready|ok|connected|available|installed|true/.test(text)) return 'enabled'
  if (/disabled|inactive|false/.test(text)) return 'disabled'
  if (/missing|not found|unavailable/.test(text)) return 'missing'
  if (/error|failed|fail|disconnected/.test(text)) return 'error'
  return 'available'
}

function scopeFromText(value: unknown): ProviderResource['scope'] {
  const text = compactScalar(value).toLowerCase()
  if (text.includes('project')) return 'project'
  if (text.includes('workspace')) return 'workspace'
  if (text.includes('session')) return 'session'
  if (text.includes('global') || text.includes('home')) return 'global'
  return 'provider'
}

function canonicalName(value: string): string {
  return value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed'
}

function textLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function kindLabel(kind: ProviderResourceKind): string {
  return kind.replace(/_/g, ' ')
}
