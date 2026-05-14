import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { basename, dirname, join } from 'path'
import { PROVIDERS, resolveProviderBinary } from './providers'
import type {
  CapabilityDeleteRequest,
  CapabilityMutationResult,
  CapabilityUpdateRequest,
  ProviderResource
} from '../types'

type JsonObject = Record<string, unknown>

export function updateCapability(input: CapabilityUpdateRequest): CapabilityMutationResult {
  const name = input.name.trim()
  if (!name) throw new Error('Capability name is required.')

  const files: string[] = []
  const warnings: string[] = []
  const touched = new Set<string>()

  for (const resource of input.resources) {
    const path = rawPath(resource)
    if (!path) {
      if (resource.kind === 'mcp_server' && resource.providerId === 'claude' && rawManage(resource) === 'claude-mcp') {
        updateClaudeMcpServer(resource, input, files)
        continue
      }
      warnings.push(`${resource.name} is provider-managed and cannot be edited here yet.`)
      continue
    }
    if (touched.has(`${resource.kind}:${path}`)) continue
    touched.add(`${resource.kind}:${path}`)

    if (resource.kind === 'skill') {
      updateSkill(resource, path, input, files)
    } else if (resource.kind === 'plugin') {
      updatePlugin(resource, path, input, files)
    } else if (resource.kind === 'mcp_server') {
      updateMcpServer(resource, path, input, files)
    } else {
      warnings.push(`${resource.name} cannot be edited from Capabilities yet.`)
    }
  }

  return { ok: true, files, warnings }
}

export function deleteCapability(input: CapabilityDeleteRequest): CapabilityMutationResult {
  const files: string[] = []
  const warnings: string[] = []
  const touched = new Set<string>()

  for (const resource of input.resources) {
    const path = rawPath(resource)
    if (!path) {
      if (resource.kind === 'mcp_server' && resource.providerId === 'claude' && rawManage(resource) === 'claude-mcp') {
        removeClaudeMcpServer(resource, files)
        continue
      }
      warnings.push(`${resource.name} is provider-managed and cannot be removed here yet.`)
      continue
    }
    if (touched.has(`${resource.kind}:${path}`)) continue
    touched.add(`${resource.kind}:${path}`)

    if (resource.kind === 'skill') {
      const root = dirname(path)
      rmSync(root, { recursive: true, force: true })
      files.push(root)
    } else if (resource.kind === 'plugin') {
      removePlugin(path, files)
    } else if (resource.kind === 'mcp_server') {
      removeMcpServer(resource, path, files)
    } else {
      warnings.push(`${resource.name} cannot be removed from Capabilities yet.`)
    }
  }

  return { ok: true, files, warnings }
}

function updateSkill(
  resource: ProviderResource,
  path: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const nextDir = join(dirname(dirname(path)), slugify(input.name))
  const nextPath = join(nextDir, 'SKILL.md')
  if (nextPath !== path && existsSync(nextPath)) {
    throw new Error(`A skill named "${input.name}" already exists.`)
  }
  if (nextPath !== path) {
    mkdirSync(dirname(nextDir), { recursive: true })
    renameSync(dirname(path), nextDir)
  }
  writeText(nextPath, buildSkillMarkdown(input, path), files)
  if (nextPath !== path) files.push(path)
  void resource
}

function updatePlugin(
  resource: ProviderResource,
  path: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const oldSlug = basename(path)
  const nextSlug = slugify(input.name)
  const nextPath = join(dirname(path), nextSlug)
  if (nextPath !== path && existsSync(nextPath)) {
    throw new Error(`A plugin named "${input.name}" already exists.`)
  }
  if (nextPath !== path) renameSync(path, nextPath)

  for (const manifestPath of [
    join(nextPath, '.claude-plugin', 'plugin.json'),
    join(nextPath, '.codex-plugin', 'plugin.json')
  ]) {
    if (!existsSync(manifestPath)) continue
    const manifest = readJson(manifestPath)
    writeJson(manifestPath, {
      ...manifest,
      name: nextSlug,
      description: input.description || manifest.description || `${input.name} plugin`
    }, files)
  }

  const oldPluginSkillRoot = join(nextPath, 'skills', oldSlug)
  const skillPath = join(nextPath, 'skills', nextSlug, 'SKILL.md')
  const existingPluginSkillPath = existsSync(skillPath)
    ? skillPath
    : existsSync(join(oldPluginSkillRoot, 'SKILL.md'))
      ? join(oldPluginSkillRoot, 'SKILL.md')
      : undefined
  writeText(skillPath, buildSkillMarkdown(input, existingPluginSkillPath), files)
  if (oldSlug !== nextSlug && existsSync(oldPluginSkillRoot)) {
    rmSync(oldPluginSkillRoot, { recursive: true, force: true })
    files.push(oldPluginSkillRoot)
  }
  syncPluginSkillMirrors(path, nextPath, oldSlug, nextSlug, input, files)
  syncPluginMarketplaces(nextPath, oldSlug, nextSlug, input, files)
  if (nextPath !== path) files.push(path)
  void resource
}

function syncPluginSkillMirrors(
  oldPluginPath: string,
  nextPluginPath: string,
  oldSlug: string,
  nextSlug: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const base = capabilityBaseFromPluginPath(nextPluginPath)
  if (!base) return
  for (const providerDir of ['.claude', '.codex']) {
    const oldRoot = join(base, providerDir, 'skills', oldSlug)
    const nextRoot = join(base, providerDir, 'skills', nextSlug)
    const nextPath = join(nextRoot, 'SKILL.md')
    const oldPath = join(oldRoot, 'SKILL.md')
    const existingPath = existsSync(nextPath) ? nextPath : existsSync(oldPath) ? oldPath : undefined
    writeText(nextPath, buildSkillMarkdown(input, existingPath), files)
    if (oldSlug !== nextSlug && existsSync(oldRoot)) {
      rmSync(oldRoot, { recursive: true, force: true })
      files.push(oldRoot)
    }
  }
  void oldPluginPath
}

function removePlugin(path: string, files: string[]): void {
  const slug = basename(path)
  const base = capabilityBaseFromPluginPath(path)
  rmSync(path, { recursive: true, force: true })
  files.push(path)
  if (!base) return
  for (const providerDir of ['.claude', '.codex']) {
    const mirrorRoot = join(base, providerDir, 'skills', slug)
    if (!existsSync(mirrorRoot)) continue
    rmSync(mirrorRoot, { recursive: true, force: true })
    files.push(mirrorRoot)
  }
  removePluginMarketplaceEntries(base, slug, files)
}

function capabilityBaseFromPluginPath(pluginPath: string): string | null {
  const capabilitiesDir = dirname(dirname(dirname(pluginPath)))
  return basename(capabilitiesDir) === '.orchestrator' ? dirname(capabilitiesDir) : null
}

function syncPluginMarketplaces(
  pluginPath: string,
  oldSlug: string,
  nextSlug: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const base = capabilityBaseFromPluginPath(pluginPath)
  if (!base) return
  upsertClaudeMarketplaceEntry(base, oldSlug, nextSlug, input, files)
  upsertCodexMarketplaceEntry(base, oldSlug, nextSlug, input, files)
}

function upsertClaudeMarketplaceEntry(
  base: string,
  oldSlug: string,
  nextSlug: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const path = join(base, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json')
  const current = readJson(path)
  const plugins = arrayValue(current.plugins)
    .filter((entry) => !isRecord(entry) || (entry.name !== oldSlug && entry.name !== nextSlug))
  writeJson(path, {
    name: stringValue(current.name) || 'orchestrator-capabilities',
    owner: isRecord(current.owner) ? current.owner : { name: 'Orchestrator' },
    plugins: [
      ...plugins,
      {
        name: nextSlug,
        source: `./plugins/${nextSlug}`,
        description: input.description || `${input.name} plugin`
      }
    ]
  }, files)
}

function upsertCodexMarketplaceEntry(
  base: string,
  oldSlug: string,
  nextSlug: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const path = join(base, '.agents', 'plugins', 'marketplace.json')
  const current = readJson(path)
  const plugins = arrayValue(current.plugins)
    .filter((entry) => !isRecord(entry) || (entry.name !== oldSlug && entry.name !== nextSlug))
  writeJson(path, {
    name: stringValue(current.name) || 'orchestrator-capabilities',
    interface: isRecord(current.interface) ? current.interface : { displayName: 'Orchestrator Capabilities' },
    plugins: [
      ...plugins,
      {
        name: nextSlug,
        source: {
          source: 'local',
          path: `./.orchestrator/capabilities/plugins/${nextSlug}`
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL'
        },
        category: 'Productivity',
        description: input.description || `${input.name} plugin`
      }
    ]
  }, files)
}

function removePluginMarketplaceEntries(base: string, slug: string, files: string[]): void {
  removeMarketplaceEntry(join(base, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), slug, files)
  removeMarketplaceEntry(join(base, '.agents', 'plugins', 'marketplace.json'), slug, files)
}

function removeMarketplaceEntry(path: string, slug: string, files: string[]): void {
  if (!existsSync(path)) return
  const current = readJson(path)
  const plugins = arrayValue(current.plugins)
  const nextPlugins = plugins.filter((entry) => !isRecord(entry) || entry.name !== slug)
  if (nextPlugins.length === plugins.length) return
  writeJson(path, { ...current, plugins: nextPlugins }, files)
}

function updateMcpServer(
  resource: ProviderResource,
  path: string,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const oldName = resource.name
  const nextName = slugify(input.name)
  const current = readJson(path)
  const servers = isRecord(current.mcpServers) ? current.mcpServers : {}
  const previous = isRecord(servers[oldName]) ? servers[oldName] as JsonObject : {}
  const next = input.transport === 'http'
    ? { ...previous, type: 'http', url: input.url ?? previous.url }
    : { ...previous, command: input.command ?? previous.command, args: input.args ?? previous.args ?? [] }
  const updatedServers = { ...servers }
  delete updatedServers[oldName]
  updatedServers[nextName] = next
  writeJson(path, { ...current, mcpServers: updatedServers }, files)
}

function removeMcpServer(resource: ProviderResource, path: string, files: string[]): void {
  const current = readJson(path)
  const servers = isRecord(current.mcpServers) ? current.mcpServers : {}
  if (!(resource.name in servers)) return
  const nextServers = { ...servers }
  delete nextServers[resource.name]
  writeJson(path, { ...current, mcpServers: nextServers }, files)
}

function updateClaudeMcpServer(
  resource: ProviderResource,
  input: CapabilityUpdateRequest,
  files: string[]
): void {
  const binary = claudeBinary()
  const config = rawConfig(resource)
  const scope = claudeScope(config.scope)
  const nextName = slugify(input.name)
  const transport = input.transport ?? (config.url ? 'http' : 'stdio')
  const removeArgs = ['mcp', 'remove', '--scope', scope, resource.name]
  runProviderMutation(binary, removeArgs)
  const addArgs = transport === 'http'
    ? ['mcp', 'add', '--scope', scope, '--transport', 'http', nextName, input.url || stringValue(config.url)]
    : [
        'mcp',
        'add',
        '--scope',
        scope,
        nextName,
        '--',
        input.command || stringValue(config.command),
        ...(input.args && input.args.length ? input.args : stringArray(config.args))
      ]
  runProviderMutation(binary, addArgs.filter(Boolean))
  files.push(`claude mcp ${resource.name}`)
}

function removeClaudeMcpServer(resource: ProviderResource, files: string[]): void {
  const binary = claudeBinary()
  const scope = claudeScope(rawConfig(resource).scope)
  runProviderMutation(binary, ['mcp', 'remove', '--scope', scope, resource.name])
  files.push(`claude mcp ${resource.name}`)
}

function buildSkillMarkdown(input: CapabilityUpdateRequest, existingPath?: string): string {
  const description = input.description || `Reusable workflow for ${input.name}.`
  const body = input.body?.trim() || (existingPath ? existingSkillBody(existingPath) : '') || [
    `Use this capability when the user asks for ${input.name}.`,
    '',
    'Follow the project conventions, keep changes scoped, and verify the result before handing it back.'
  ].join('\n')
  return [
    '---',
    `name: ${slugify(input.name)}`,
    `description: ${description}`,
    '---',
    '',
    `# ${input.name}`,
    '',
    body,
    ''
  ].join('\n')
}

function existingSkillBody(path: string): string {
  try {
    const content = readFileSync(path, 'utf8')
    return content
      .replace(/^---\n[\s\S]*?\n---\n+/, '')
      .replace(/^# .+\n+/, '')
      .trim()
  } catch {
    return ''
  }
}

function rawPath(resource: ProviderResource): string | null {
  const raw = isRecord(resource.raw) ? resource.raw : null
  return typeof raw?.path === 'string' ? raw.path : null
}

function rawManage(resource: ProviderResource): string | null {
  const raw = isRecord(resource.raw) ? resource.raw : null
  return typeof raw?.manage === 'string' ? raw.manage : null
}

function rawConfig(resource: ProviderResource): JsonObject {
  const raw = isRecord(resource.raw) ? resource.raw : null
  return isRecord(raw?.config) ? raw.config : {}
}

function claudeScope(value: unknown): string {
  return value === 'project' || value === 'local' || value === 'user' ? value : 'user'
}

function claudeBinary(): string {
  const binary = resolveProviderBinary(PROVIDERS.claude)
  if (!binary) throw new Error('Claude CLI is not installed.')
  return binary
}

function runProviderMutation(binary: string, args: string[]): void {
  try {
    execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000
    })
  } catch (error) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : err.stderr
    const stdout = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : err.stdout
    throw new Error((stderr || stdout || err.message || 'Provider mutation failed').trim())
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readJson(path: string): JsonObject {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
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
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'capability'
}
