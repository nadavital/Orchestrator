import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderCommandSurface } from '../../types'
import { discoverLocalProviderResources, resourceSurfaces, resourcesFromSurfaceResult } from '../providerResources'

const surface = (
  id: string,
  label: string,
  area: ProviderCommandSurface['area']
): ProviderCommandSurface => ({
  id,
  label,
  area,
  command: [],
  runtime: 'app-server',
  quota: 'none',
  mutatesState: false,
  appSurface: 'settings'
})

test('resource surfaces only include safe settings inventory commands', () => {
  const surfaces: ProviderCommandSurface[] = [
    surface('appserver-skills', 'Skills', 'extensions'),
    { ...surface('appserver-account', 'Account', 'usage'), appSurface: 'settings' },
    { ...surface('plugin-install', 'Plugin install', 'extensions'), mutatesState: true },
    { ...surface('review', 'Review', 'review'), quota: 'may-use-quota' },
    { ...surface('composer-agents', 'Agents', 'agents'), appSurface: 'composer' }
  ]

  assert.deepEqual(resourceSurfaces(surfaces).map((item) => item.id), ['appserver-skills'])
})

test('Codex app-server resource outputs normalize into first-class resources', () => {
  const resources = resourcesFromSurfaceResult(surface('appserver-skills', 'Skills', 'extensions'), {
    providerId: 'codex',
    surfaceId: 'appserver-skills',
    status: 'ok',
    output: JSON.stringify({
      skills: [
        { id: 'browser', name: 'Browser', description: 'Browser automation', enabled: true, scope: 'global' },
        { id: 'docs', name: 'Docs', status: 'disabled' }
      ]
    })
  })

  assert.equal(resources.length, 2)
  assert.equal(resources[0].kind, 'skill')
  assert.equal(resources[0].providerId, 'codex')
  assert.equal(resources[0].source, 'Codex app-server')
  assert.equal(resources[0].name, 'Browser')
  assert.equal(resources[0].status, 'enabled')
  assert.equal(resources[0].scope, 'global')
  assert.equal(resources[0].fingerprint, 'skill:browser')
  assert.equal(resources[1].status, 'disabled')
})

test('Claude resource outputs normalize agents, MCP, and plugins', () => {
  const agents = resourcesFromSurfaceResult(surface('agents-list', 'Configured agents', 'agents'), {
    providerId: 'claude',
    surfaceId: 'agents-list',
    status: 'ok',
    output: '- reviewer · sonnet\n- explorer\n'
  })
  const mcp = resourcesFromSurfaceResult(surface('mcp-details', 'MCP details', 'mcp'), {
    providerId: 'claude',
    surfaceId: 'mcp-details',
    status: 'ok',
    output: JSON.stringify([{ server: 'filesystem', status: 'ok', detail: 'Connected' }])
  })
  const plugins = resourcesFromSurfaceResult(surface('plugin-list', 'Plugins', 'extensions'), {
    providerId: 'claude',
    surfaceId: 'plugin-list',
    status: 'ok',
    output: JSON.stringify({ plugins: [{ name: 'jira', enabled: false, description: 'Jira tools' }] })
  })

  assert.deepEqual(agents.map((resource) => resource.name), ['reviewer', 'explorer'])
  assert.equal(mcp[0].kind, 'mcp_server')
  assert.equal(mcp[0].name, 'filesystem')
  assert.equal(mcp[0].status, 'enabled')
  assert.equal(plugins[0].kind, 'plugin')
  assert.equal(plugins[0].status, 'disabled')
})

test('resource parsing filters provider command noise and gives fallback names', () => {
  const claudeMcp = resourcesFromSurfaceResult(surface('mcp-list', 'MCP servers', 'mcp'), {
    providerId: 'claude',
    surfaceId: 'mcp-list',
    status: 'ok',
    output: 'Checking MCP server health...\nfilesystem: connected\n'
  })
  const codexHooks = resourcesFromSurfaceResult(surface('appserver-hooks', 'Hooks', 'extensions'), {
    providerId: 'codex',
    surfaceId: 'appserver-hooks',
    status: 'ok',
    output: JSON.stringify({ hooks: [{ event: 'post_tool_use' }] })
  })
  const codexAgentConfig = resourcesFromSurfaceResult(surface('appserver-external-agent-config', 'External agent config', 'agents'), {
    providerId: 'codex',
    surfaceId: 'appserver-external-agent-config',
    status: 'ok',
    output: JSON.stringify({
      configs: [{ description: 'Migrate /Users/navital/.claude/settings.json into /Users/navital/.codex/config.toml' }]
    })
  })

  assert.deepEqual(claudeMcp.map((resource) => resource.name), ['filesystem'])
  assert.equal(codexHooks[0].name, 'Hook 1')
  assert.equal(codexAgentConfig[0].name, 'External agent config')
  assert.equal(codexAgentConfig[0].description, 'Migrate /Users/navital/.claude/settings.json into /Users/navital/.codex/config.toml')
})

test('local provider resources expose file-backed capabilities across scopes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-resources-cwd-'))
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-resources-home-'))
  try {
    mkdirSync(join(cwd, '.claude', 'skills', 'debug'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'skills', 'debug', 'SKILL.md'), '---\ndescription: Debug failures\n---\n# Debug\n')
    mkdirSync(join(cwd, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'commands', 'ship.md'), '# Ship\nRelease checklist')
    mkdirSync(join(home, '.claude', 'skills', 'global-debug'), { recursive: true })
    writeFileSync(join(home, '.claude', 'skills', 'global-debug', 'SKILL.md'), '---\ndescription: Global debug failures\n---\n# Debug\n')
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(home, '.claude', 'agents', 'reviewer.md'), '---\ndescription: Reviews code\n---\n# Reviewer\n')
    mkdirSync(join(cwd, '.claude'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: './scripts/check.sh' }]
        }]
      }
    }))
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Claude project instructions\n')
    mkdirSync(join(home, '.agents', 'skills', 'commit'), { recursive: true })
    writeFileSync(join(home, '.agents', 'skills', 'commit', 'SKILL.md'), '---\ndescription: Commit workflow\n---\n# Commit\n')
    mkdirSync(join(cwd, '.agents', 'skills', 'repo-review'), { recursive: true })
    writeFileSync(join(cwd, '.agents', 'skills', 'repo-review', 'SKILL.md'), '---\ndescription: Repo review\n---\n# Repo Review\n')
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex', 'AGENTS.md'), '# Codex global instructions\n')
    writeFileSync(join(home, '.codex', 'config.toml'), [
      '# orchestrator:docs:start',
      '[mcp_servers.docs]',
      'command = "node"',
      'args = ["server.js"]',
      '# orchestrator:docs:end',
      ''
    ].join('\n'))
    mkdirSync(join(cwd, '.cursor', 'rules'), { recursive: true })
    writeFileSync(join(cwd, '.cursor', 'rules', 'frontend.mdc'), '# Frontend rules\n')
    mkdirSync(join(cwd, '.github', 'instructions'), { recursive: true })
    writeFileSync(join(cwd, '.github', 'copilot-instructions.md'), '# Copilot repo instructions\n')
    writeFileSync(join(cwd, '.github', 'instructions', 'tests.instructions.md'), '# Test instructions\n')
    writeFileSync(join(cwd, 'AGENTS.md'), '# Agent instructions\n')
    mkdirSync(join(home, '.cursor'), { recursive: true })
    writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { browser: { command: 'npx' } } }))
    mkdirSync(join(home, '.copilot'), { recursive: true })
    writeFileSync(join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { playwright: { type: 'local' } } }))
    mkdirSync(join(home, '.orchestrator', 'capabilities', 'plugins', 'release-helper', '.claude-plugin'), { recursive: true })
    mkdirSync(join(home, '.orchestrator', 'capabilities', 'plugins', 'release-helper', '.codex-plugin'), { recursive: true })
    writeFileSync(join(home, '.orchestrator', 'capabilities', 'plugins', 'release-helper', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'release-helper', description: 'Claude release plugin' }))
    writeFileSync(join(home, '.orchestrator', 'capabilities', 'plugins', 'release-helper', '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'release-helper', description: 'Codex release plugin' }))

    const claude = discoverLocalProviderResources('claude', cwd, home)
    const codex = discoverLocalProviderResources('codex', cwd, home)
    const cursor = discoverLocalProviderResources('cursor', cwd, home)
    const copilot = discoverLocalProviderResources('copilot', cwd, home)

    assert.ok(claude.some((resource) => resource.kind === 'skill' && resource.name === 'global-debug' && resource.scope === 'global'))
    assert.ok(claude.some((resource) => resource.kind === 'skill' && resource.name === 'debug' && resource.scope === 'project'))
    assert.ok(claude.some((resource) => resource.kind === 'command' && resource.name === '/ship' && resource.scope === 'project'))
    assert.ok(claude.some((resource) => resource.kind === 'agent' && resource.name === 'reviewer' && resource.scope === 'global'))
    assert.ok(claude.some((resource) => resource.kind === 'hook' && resource.name === 'PreToolUse Bash 1' && resource.scope === 'project'))
    assert.ok(claude.some((resource) => resource.kind === 'rule' && resource.name === 'CLAUDE.md' && resource.scope === 'project'))
    assert.ok(claude.some((resource) => resource.kind === 'plugin' && resource.name === 'release-helper'))
    assert.ok(codex.some((resource) => resource.kind === 'skill' && resource.name === 'commit' && resource.scope === 'global'))
    assert.ok(codex.some((resource) => resource.kind === 'skill' && resource.name === 'repo-review' && resource.scope === 'project'))
    assert.ok(codex.some((resource) => resource.kind === 'plugin' && resource.name === 'release-helper'))
    assert.ok(codex.some((resource) => resource.kind === 'rule' && resource.name === 'AGENTS.md' && resource.scope === 'global'))
    assert.ok(codex.some((resource) => resource.kind === 'mcp_server' && resource.name === 'docs' && resource.source === 'Codex config'))
    assert.ok(!cursor.some((resource) => resource.kind === 'rule' && resource.name === '.cursor/rules/frontend'))
    assert.ok(cursor.some((resource) => resource.kind === 'mcp_server' && resource.name === 'browser'))
    assert.ok(copilot.some((resource) => resource.kind === 'mcp_server' && resource.name === 'github'))
    assert.ok(copilot.some((resource) => resource.kind === 'mcp_server' && resource.name === 'playwright'))
    assert.ok(!copilot.some((resource) => resource.kind === 'rule' && resource.name === '.github/copilot-instructions'))
    assert.ok(!copilot.some((resource) => resource.kind === 'rule' && resource.name === 'AGENTS'))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
