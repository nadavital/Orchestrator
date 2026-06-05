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
import { basename, dirname, join, relative, sep } from 'path'
import { homedir } from 'os'

const RESOURCE_AREAS = new Set<ProviderCommandSurface['area']>(['agents', 'extensions', 'mcp'])

export async function listProviderResources(providerId?: string, cwd = process.cwd()): Promise<Record<string, ProviderResourceSnapshot>> {
  const runtimeInfo = getProviderRuntimeInfo()
  const ids = providerId ? [providerId] : Object.keys(runtimeInfo)
  const snapshots = await Promise.all(ids.map((id) => discoverProviderResources(id, cwd)))
  return Object.fromEntries(snapshots.map((snapshot) => [snapshot.providerId, snapshot]))
}

export async function discoverProviderResources(providerId: string, cwd = process.cwd()): Promise<ProviderResourceSnapshot> {
  const runtime = getProviderRuntimeInfo()[providerId]
  const surfaces = resourceSurfaces(runtime?.registry.commandSurfaces ?? [])
  const resources: ProviderResource[] = discoverLocalProviderResources(providerId, cwd)
  const errors: ProviderResourceSnapshot['errors'] = []

  const results = await Promise.all(surfaces.map(async (surface) => ({
    surface,
    result: await runProviderCommandSurfaceAsync(providerId, surface.id, cwd)
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
  if (providerId === 'codex') return discoverCodexResources(cwd, homeDir)
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
      const detail = stringValue(item?.detail)
      return makeResource({
        providerId: result.providerId,
        kind: 'mcp_server',
        source: 'Claude CLI',
        name,
        description: detail,
        status: statusFromText(statusText),
        scope: 'provider',
        raw: {
          ...(objectValue(entry) ?? {}),
          manage: 'claude-mcp',
          config: claudeMcpConfigFromDetail(detail)
        }
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
    ...portablePlugins('claude', homeDir, 'global'),
    ...portablePlugins('claude', cwd, 'project'),
    ...skillsFromDirectory('claude', 'Claude skills', join(homeDir, '.claude', 'skills'), 'global', true),
    ...skillsFromDirectory('claude', 'Claude project skills', join(cwd, '.claude', 'skills'), 'project', true),
    ...extensions.commands.map((command) => makeResource({
      providerId: 'claude',
      kind: 'command',
      source: 'Claude commands',
      name: command.name,
      description: command.description,
      status: 'available',
      scope: command.scope ?? 'provider',
      raw: command
    })),
    ...markdownFilesFromDirectory('claude', 'Claude agents', join(homeDir, '.claude', 'agents'), 'agent', 'global', { prefixSlash: false }),
    ...markdownFilesFromDirectory('claude', 'Claude agents', join(cwd, '.claude', 'agents'), 'agent', 'project', { prefixSlash: false }),
    ...claudeHooksFromSettings(join(homeDir, '.claude', 'settings.json'), 'global'),
    ...claudeHooksFromSettings(join(cwd, '.claude', 'settings.json'), 'project'),
    ...instructionFile('claude', 'Claude instructions', join(homeDir, '.claude', 'CLAUDE.md'), 'global', 'CLAUDE.md'),
    ...instructionFile('claude', 'Claude instructions', join(cwd, 'CLAUDE.md'), 'project', 'CLAUDE.md')
  ]
}

function discoverCursorResources(_cwd: string, homeDir: string): ProviderResource[] {
  return [
    ...mcpServersFromConfig('cursor', 'Cursor MCP', join(homeDir, '.cursor', 'mcp.json'), 'global')
  ]
}

function discoverCopilotResources(_cwd: string, homeDir: string): ProviderResource[] {
  return [
    makeResource({
      providerId: 'copilot',
      kind: 'mcp_server',
      source: 'GitHub Copilot runtime',
      name: 'github',
      description: 'Built-in GitHub MCP server',
      status: 'available',
      scope: 'provider',
      raw: { builtIn: true }
    }),
    ...mcpServersFromConfig('copilot', 'GitHub Copilot MCP', join(homeDir, '.copilot', 'mcp-config.json'), 'global')
  ]
}

function discoverCodexResources(cwd: string, homeDir: string): ProviderResource[] {
  return [
    ...skillsFromDirectory('codex', 'Codex user skills', join(homeDir, '.agents', 'skills'), 'global', true),
    ...skillsFromDirectory('codex', 'Codex project skills', join(cwd, '.agents', 'skills'), 'project', true),
    ...skillsFromDirectory('codex', 'Codex installed skills', join(homeDir, '.codex', 'skills'), 'global', false),
    ...skillsFromDirectory('codex', 'Codex project legacy skills', join(cwd, '.codex', 'skills'), 'project', true),
    ...portablePlugins('codex', homeDir, 'global'),
    ...portablePlugins('codex', cwd, 'project'),
    ...instructionFile('codex', 'Codex instructions', join(homeDir, '.codex', 'AGENTS.md'), 'global', 'AGENTS.md'),
    ...instructionFile('codex', 'Codex instructions', join(cwd, 'AGENTS.md'), 'project', 'AGENTS.md'),
    ...codexMcpServersFromToml(join(homeDir, '.codex', 'config.toml'), 'global'),
    ...codexMcpServersFromToml(join(cwd, '.codex', 'config.toml'), 'project')
  ]
}

function skillsFromDirectory(
  providerId: string,
  source: string,
  root: string,
  scope: ProviderResource['scope'],
  editable = true
): ProviderResource[] {
  return walkFiles(root)
    .filter((path) => basename(path) === 'SKILL.md')
    .flatMap((path) => {
      const name = basename(dirname(path))
      return makeResource({
        providerId,
        kind: 'skill',
        source,
        name,
        description: firstMarkdownSummary(path),
        status: 'available',
        scope,
        raw: { path, editable }
      })
    })
}

function markdownFilesFromDirectory(
  providerId: string,
  source: string,
  root: string,
  kind: ProviderResourceKind,
  scope: ProviderResource['scope'],
  options: { prefixSlash: boolean }
): ProviderResource[] {
  return walkFiles(root)
    .filter((path) => basename(path).endsWith('.md'))
    .map((path) => {
      const name = relative(root, path).replace(/\.md$/, '').split(sep).join(':')
      return makeResource({
        providerId,
        kind,
        source,
        name: options.prefixSlash ? `/${name}` : name,
        description: firstMarkdownSummary(path),
        status: 'available',
        scope,
        raw: { path, editable: false }
      })
    })
}

function instructionFile(
  providerId: string,
  source: string,
  path: string,
  scope: ProviderResource['scope'],
  name: string
): ProviderResource[] {
  const stat = safeStat(path)
  if (!stat?.isFile()) return []
  return [makeResource({
    providerId,
    kind: 'rule',
    source,
    name,
    description: firstMarkdownSummary(path),
    status: 'available',
    scope,
    raw: { path, editable: false }
  })]
}

function portablePlugins(
  providerId: string,
  base: string,
  scope: ProviderResource['scope']
): ProviderResource[] {
  const root = join(base, '.orchestrator', 'capabilities', 'plugins')
  const marketplacePath = providerId === 'claude'
    ? join(base, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json')
    : join(base, '.agents', 'plugins', 'marketplace.json')
  const stat = safeStat(root)
  if (!stat?.isDirectory()) return []
  return readdirSync(root).sort().flatMap((name) => {
    const pluginRoot = join(root, name)
    if (!safeStat(pluginRoot)?.isDirectory()) return []
    const manifestPath = join(pluginRoot, providerId === 'claude' ? '.claude-plugin' : '.codex-plugin', 'plugin.json')
    const manifest = readJsonObject(manifestPath)
    if (!manifest && providerId !== 'claude' && providerId !== 'codex') return []
    return makeResource({
      providerId,
      kind: 'plugin',
      source: 'Orchestrator portable plugin',
      name: stringValue(manifest?.name) ?? name,
      description: stringValue(manifest?.description),
      status: 'available',
      scope,
      raw: {
        path: pluginRoot,
        editable: true,
        manifestPath,
        marketplacePath,
        compatibility: providerId === 'claude' ? 'claude-plugin' : 'codex-plugin'
      }
    })
  })
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
      raw: { path, config: value, editable: true, configFormat: 'json' }
    })
  })
}

function codexMcpServersFromToml(path: string, scope: ProviderResource['scope']): ProviderResource[] {
  const content = readText(path)
  if (!content) return []
  const sections = [...content.matchAll(/^\s*\[mcp_servers\.([^\]\n]+)\]\s*$/gm)]
  return sections.map((match, index) => {
    const name = unquoteTomlKey(match[1].trim())
    const start = (match.index ?? 0) + match[0].length
    const end = index + 1 < sections.length ? sections[index + 1].index ?? content.length : content.length
    const body = content.slice(start, end)
    const url = tomlStringValue(body, 'url')
    const command = tomlStringValue(body, 'command')
    const args = tomlArrayValue(body, 'args')
    const config = url ? { type: 'http', url } : { command, args }
    return makeResource({
      providerId: 'codex',
      kind: 'mcp_server',
      source: 'Codex config',
      name,
      description: url || command || 'MCP server',
      status: 'available',
      scope,
      raw: { path, config, editable: true, configFormat: 'codex-toml' }
    })
  })
}

function claudeHooksFromSettings(path: string, scope: ProviderResource['scope']): ProviderResource[] {
  const settings = readJsonObject(path)
  const hooks = objectValue(settings?.hooks)
  if (!hooks) return []
  return Object.entries(hooks).flatMap(([eventName, value]) => {
    return arrayValue(value).flatMap((entry, groupIndex) => {
      const group = objectValue(entry)
      const matcher = stringValue(group?.matcher) ?? '*'
      const handlers = arrayValue(group?.hooks)
      return handlers.map((handler, handlerIndex) => {
        const item = objectValue(handler)
        const type = stringValue(item?.type) ?? 'hook'
        const command = stringValue(item?.command, item?.url, item?.prompt)
        return makeResource({
          providerId: 'claude',
          kind: 'hook',
          source: 'Claude settings',
          name: `${eventName} ${matcher} ${handlerIndex + 1}`,
          description: command || `${type} hook`,
          status: 'available',
          scope,
          raw: {
            path,
            eventName,
            matcher,
            groupIndex,
            handlerIndex,
            config: handler,
            editable: false
          }
        })
      })
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

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function firstMarkdownSummary(path: string): string | undefined {
  try {
    const lines = readFileSync(path, 'utf8').split('\n')
    if (lines[0]?.trim() === '---') {
      const end = lines.slice(1).findIndex((line) => line.trim() === '---')
      const frontmatter = end >= 0 ? lines.slice(1, end + 1) : []
      const description = frontmatter
        .map((line) => line.match(/^description:\s*(.+)$/i)?.[1]?.trim())
        .find(Boolean)
      if (description) return description.replace(/^['"]|['"]$/g, '')
      return lines
        .slice(end >= 0 ? end + 2 : 1)
        .map(markdownSummaryLine)
        .find((line) => line.length > 0)
    }
    return lines
      .map(markdownSummaryLine)
      .find((line) => line.length > 0)
  } catch {
    return undefined
  }
}

function markdownSummaryLine(line: string): string {
  const trimmed = line.replace(/^#+\s*/, '').trim()
  return trimmed === '---' ? '' : trimmed
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
  const raw = objectValue(input.raw)
  const canManage = (
    Boolean(raw?.path) && raw?.editable === true && ['skill', 'plugin', 'mcp_server'].includes(input.kind)
  ) || (
    input.providerId === 'claude' && input.kind === 'mcp_server' && raw?.manage === 'claude-mcp'
  )
  return {
    ...input,
    name,
    id: `${input.providerId}:${input.kind}:${canonicalName(name)}`,
    fingerprint,
    actions: canManage ? ['refresh', 'inspect', 'edit', 'remove'] : ['refresh', 'inspect']
  }
}

function claudeMcpConfigFromDetail(detail?: string): Record<string, unknown> {
  if (!detail) return {}
  const scopeText = detail.match(/Scope:\s*([^\n]+)/i)?.[1] ?? ''
  const type = detail.match(/Type:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase()
  const command = detail.match(/Command:\s*([^\n]+)/i)?.[1]?.trim()
  const argsText = detail.match(/Args:\s*([^\n]+)/i)?.[1]?.trim()
  const url = detail.match(/URL:\s*([^\n]+)/i)?.[1]?.trim()
  const scope = /user/i.test(scopeText)
    ? 'user'
    : /project/i.test(scopeText)
      ? 'project'
      : /local/i.test(scopeText)
        ? 'local'
        : undefined
  return {
    scope,
    type,
    command,
    args: argsText ? shellLikeSplit(argsText) : [],
    url
  }
}

function shellLikeSplit(value: string): string[] {
  const matches = value.match(/"([^"]*)"|'([^']*)'|\S+/g) ?? []
  return matches.map((part) => part.replace(/^["']|["']$/g, ''))
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

function unquoteTomlKey(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function tomlStringValue(section: string, key: string): string | undefined {
  const match = section.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*("([^"]*)"|'([^']*)'|[^\\n#]+)`, 'm'))
  const value = match?.[2] ?? match?.[3] ?? match?.[1]
  return value?.replace(/^['"]|['"]$/g, '').trim() || undefined
}

function tomlArrayValue(section: string, key: string): string[] {
  const match = section.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\\[[^\\n]*\\])`, 'm'))
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1]) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function kindLabel(kind: ProviderResourceKind): string {
  return kind.replace(/_/g, ' ')
}
