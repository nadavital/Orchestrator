import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type {
  CapabilityCreateRequest,
  CapabilityCreateResult,
  ProviderResource
} from '../types'

type JsonObject = Record<string, unknown>

export function createCapability(input: CapabilityCreateRequest): CapabilityCreateResult {
  const request = normalizeCreateRequest(input)
  if (request.kind === 'skill') return createSkillCapability(request)
  if (request.kind === 'plugin') return createPluginCapability(request)
  return createMcpCapability(request)
}

function createSkillCapability(request: CapabilityCreateRequest): CapabilityCreateResult {
  const files: string[] = []
  const warnings: string[] = []
  const slug = slugify(request.name)
  const skillMarkdown = buildSkillMarkdown(request)
  const roots = capabilityRoots(request)

  for (const root of roots) {
    writeText(join(root.orchestrator, 'skills', slug, 'SKILL.md'), skillMarkdown, files)
    writeText(join(root.claude, 'skills', slug, 'SKILL.md'), skillMarkdown, files)
    writeText(join(root.codex, 'skills', slug, 'SKILL.md'), skillMarkdown, files)
  }

  return {
    ok: true,
    files,
    warnings,
    resources: portableResources(request, slug, 'skill', 'available')
  }
}

function createPluginCapability(request: CapabilityCreateRequest): CapabilityCreateResult {
  const files: string[] = []
  const warnings = [
    'Created Claude and Codex plugin manifests plus local marketplace entries. Mirrored the plugin skill as standalone provider skills so it is usable immediately; native install/enable still needs provider-specific confirmation.'
  ]
  const slug = slugify(request.name)
  const skillMarkdown = buildSkillMarkdown(request)
  const roots = capabilityRoots(request)

  for (const root of roots) {
    const pluginRoot = join(root.orchestrator, 'plugins', slug)
    writeJson(join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: slug,
      version: '0.1.0',
      description: request.description || `${request.name} plugin`,
      author: { name: 'Orchestrator' }
    }, files)
    writeJson(join(pluginRoot, '.codex-plugin', 'plugin.json'), {
      name: slug,
      version: '0.1.0',
      description: request.description || `${request.name} plugin`
    }, files)
    writeText(join(pluginRoot, 'skills', slug, 'SKILL.md'), skillMarkdown, files)
    writeText(join(root.claude, 'skills', slug, 'SKILL.md'), skillMarkdown, files)
    writeText(join(root.codex, 'skills', slug, 'SKILL.md'), skillMarkdown, files)
    upsertClaudePluginMarketplace(root, slug, request, files)
    upsertCodexPluginMarketplace(root, slug, request, files)
  }

  return {
    ok: true,
    files,
    warnings,
    resources: [
      ...portableResources(request, slug, 'plugin', 'available'),
      ...portableResources(request, slug, 'skill', 'available')
    ]
  }
}

function createMcpCapability(request: CapabilityCreateRequest): CapabilityCreateResult {
  const files: string[] = []
  const warnings: string[] = []
  const slug = slugify(request.name)
  const roots = capabilityRoots(request)
  const serverConfig = mcpServerConfig(request)

  for (const root of roots) {
    writeJson(join(root.orchestrator, 'mcp', `${slug}.json`), {
      mcpServers: { [slug]: serverConfig }
    }, files)
    upsertMcpJson(join(root.base, '.mcp.json'), slug, serverConfig, files)
    upsertMcpJson(join(root.base, '.cursor', 'mcp.json'), slug, serverConfig, files)
    upsertMcpJson(join(root.base, '.copilot', 'mcp-config.json'), slug, serverConfig, files)
    upsertCodexMcpToml(join(root.codex, 'config.toml'), slug, request, files)
  }

  warnings.push('MCP config was written for shared project config, Claude, Cursor, and Codex. Some providers may require a running session reload before the new server appears.')
  return {
    ok: true,
    files,
    warnings,
    resources: portableResources(request, slug, 'mcp_server', 'available')
  }
}

function normalizeCreateRequest(input: CapabilityCreateRequest): CapabilityCreateRequest {
  const name = input.name.trim()
  if (!name) throw new Error('Capability name is required.')
  if (!input.workDir.trim()) throw new Error('A project or workspace is required.')
  if (input.kind === 'mcp_server') {
    const transport = input.transport ?? (input.url ? 'http' : 'stdio')
    if (transport === 'stdio' && !input.command?.trim()) {
      throw new Error('MCP command is required for stdio servers.')
    }
    if (transport === 'http' && !input.url?.trim()) {
      throw new Error('MCP URL is required for HTTP servers.')
    }
  }
  return {
    ...input,
    name,
    scope: input.scope ?? 'project',
    description: input.description?.trim(),
    body: input.body?.trim(),
    transport: input.transport ?? (input.url ? 'http' : 'stdio'),
    command: input.command?.trim(),
    url: input.url?.trim(),
    args: input.args?.map((arg) => arg.trim()).filter(Boolean) ?? []
  }
}

function capabilityRoots(request: CapabilityCreateRequest): Array<{
  base: string
  orchestrator: string
  claude: string
  codex: string
}> {
  if (request.scope === 'global') {
    const home = homedir()
    return [{
      base: home,
      orchestrator: join(home, '.orchestrator', 'capabilities'),
      claude: join(home, '.claude'),
      codex: join(home, '.codex')
    }]
  }
  return [{
    base: request.workDir,
    orchestrator: join(request.workDir, '.orchestrator', 'capabilities'),
    claude: join(request.workDir, '.claude'),
    codex: join(request.workDir, '.codex')
  }]
}

function buildSkillMarkdown(request: CapabilityCreateRequest): string {
  const description = request.description || `Reusable workflow for ${request.name}.`
  const body = request.body || [
    `Use this capability when the user asks for ${request.name}.`,
    '',
    'Follow the project conventions, keep changes scoped, and verify the result before handing it back.'
  ].join('\n')
  return [
    '---',
    `name: ${slugify(request.name)}`,
    `description: ${description}`,
    '---',
    '',
    `# ${request.name}`,
    '',
    body,
    ''
  ].join('\n')
}

function mcpServerConfig(request: CapabilityCreateRequest): JsonObject {
  if (request.transport === 'http') {
    return {
      type: 'http',
      url: request.url
    }
  }
  return {
    command: request.command,
    args: request.args ?? []
  }
}

function upsertMcpJson(path: string, name: string, serverConfig: JsonObject, files: string[]): void {
  const current = readJson(path)
  const mcpServers = isRecord(current.mcpServers) ? current.mcpServers : {}
  writeJson(path, {
    ...current,
    mcpServers: {
      ...mcpServers,
      [name]: serverConfig
    }
  }, files)
}

function upsertCodexMcpToml(
  path: string,
  name: string,
  request: CapabilityCreateRequest,
  files: string[]
): void {
  const markerStart = `# orchestrator:${name}:start`
  const markerEnd = `# orchestrator:${name}:end`
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const block = [
    markerStart,
    `[mcp_servers.${quoteTomlKey(name)}]`,
    request.transport === 'http'
      ? `url = ${JSON.stringify(request.url ?? '')}`
      : `command = ${JSON.stringify(request.command ?? '')}`,
    request.transport === 'stdio' ? `args = ${JSON.stringify(request.args ?? [])}` : '',
    markerEnd
  ].filter(Boolean).join('\n')
  const pattern = new RegExp(`${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}`)
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`
  writeText(path, next, files)
}

function upsertClaudePluginMarketplace(
  root: ReturnType<typeof capabilityRoots>[number],
  slug: string,
  request: CapabilityCreateRequest,
  files: string[]
): void {
  const path = join(root.orchestrator, '.claude-plugin', 'marketplace.json')
  const current = readJson(path)
  const plugins = arrayValue(current.plugins)
  writeJson(path, {
    name: stringValue(current.name) || 'orchestrator-capabilities',
    owner: isRecord(current.owner) ? current.owner : { name: 'Orchestrator' },
    plugins: upsertNamedEntry(plugins, slug, {
      name: slug,
      source: `./plugins/${slug}`,
      description: request.description || `${request.name} plugin`
    })
  }, files)
}

function upsertCodexPluginMarketplace(
  root: ReturnType<typeof capabilityRoots>[number],
  slug: string,
  request: CapabilityCreateRequest,
  files: string[]
): void {
  const path = join(root.base, '.agents', 'plugins', 'marketplace.json')
  const current = readJson(path)
  const plugins = arrayValue(current.plugins)
  writeJson(path, {
    name: stringValue(current.name) || 'orchestrator-capabilities',
    interface: isRecord(current.interface) ? current.interface : { displayName: 'Orchestrator Capabilities' },
    plugins: upsertNamedEntry(plugins, slug, {
      name: slug,
      source: {
        source: 'local',
        path: `./.orchestrator/capabilities/plugins/${slug}`
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL'
      },
      category: 'Productivity',
      description: request.description || `${request.name} plugin`
    })
  }, files)
}

function upsertNamedEntry(entries: unknown[], name: string, next: JsonObject): unknown[] {
  const filtered = entries.filter((entry) => !isRecord(entry) || entry.name !== name)
  return [...filtered, next]
}

function portableResources(
  request: CapabilityCreateRequest,
  slug: string,
  kind: ProviderResource['kind'],
  status: ProviderResource['status']
): ProviderResource[] {
  const providerIds = providerIdsForCreatedResource(kind)
  return providerIds.map((providerId) => ({
    id: `${providerId}:${kind}:${slug}`,
    kind,
    providerId,
    source: 'Orchestrator',
    name: request.name,
    description: request.description,
    fingerprint: `${kind}:${slug}`,
    status,
    scope: request.scope === 'global' ? 'global' : 'project',
    actions: ['refresh', 'inspect']
  }))
}

function providerIdsForCreatedResource(kind: ProviderResource['kind']): string[] {
  if (kind === 'app') return ['codex']
  if (kind === 'skill' || kind === 'plugin') return ['claude', 'codex']
  if (kind === 'mcp_server') return ['claude', 'codex', 'cursor', 'copilot']
  return []
}

function readJson(path: string): JsonObject {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function writeJson(path: string, value: unknown, files: string[]): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`, files)
}

function writeText(path: string, content: string, files: string[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  files.push(path)
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'capability'
}

function quoteTomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
