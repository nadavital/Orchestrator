import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { deleteCapability, updateCapability } from '../capabilityManager'
import type { ProviderResource } from '../../types'

test('capability manager edits and removes global skill files', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-capability-manager-skill-'))
  const path = join(home, '.claude', 'skills', 'release-reviewer', 'SKILL.md')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '---\nname: release-reviewer\ndescription: Old\n---\n\n# Release Reviewer\n\nOld body\n')
  const resource = resourceFor('claude', 'skill', 'release-reviewer', path)

  const updated = updateCapability({
    resources: [resource],
    name: 'Ship Reviewer',
    description: 'Review shipping risk',
    body: 'New body'
  })

  const nextPath = join(home, '.claude', 'skills', 'ship-reviewer', 'SKILL.md')
  assert.ok(updated.files.includes(nextPath))
  assert.match(readFileSync(nextPath, 'utf8'), /New body/)

  const deleted = deleteCapability({ resources: [{ ...resource, name: 'ship-reviewer', raw: { path: nextPath } }] })
  assert.ok(deleted.files.includes(join(home, '.claude', 'skills', 'ship-reviewer')))
})

test('capability manager edits and removes MCP JSON config entries', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-capability-manager-mcp-'))
  const path = join(home, '.cursor', 'mcp.json')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ mcpServers: { docs: { command: 'node', args: ['old.js'] } } }))
  const resource = resourceFor('cursor', 'mcp_server', 'docs', path, { command: 'node', args: ['old.js'] })

  updateCapability({
    resources: [resource],
    name: 'Docs Search',
    transport: 'stdio',
    command: 'node',
    args: ['server.js']
  })

  assert.match(readFileSync(path, 'utf8'), /docs-search/)
  assert.match(readFileSync(path, 'utf8'), /server.js/)

  deleteCapability({ resources: [{ ...resource, name: 'docs-search' }] })
  assert.doesNotMatch(readFileSync(path, 'utf8'), /docs-search/)
})

test('capability manager edits and removes Codex MCP TOML entries', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-capability-manager-codex-mcp-'))
  const path = join(home, '.codex', 'config.toml')
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, [
    '# orchestrator:docs:start',
    '[mcp_servers.docs]',
    'command = "node"',
    'args = ["old.js"]',
    '# orchestrator:docs:end',
    ''
  ].join('\n'))
  const resource = resourceFor('codex', 'mcp_server', 'docs', path, { command: 'node', args: ['old.js'] }, 'codex-toml')

  updateCapability({
    resources: [resource],
    name: 'Docs Search',
    transport: 'stdio',
    command: 'node',
    args: ['server.js']
  })

  assert.match(readFileSync(path, 'utf8'), /\[mcp_servers\.docs-search\]/)
  assert.match(readFileSync(path, 'utf8'), /server.js/)
  assert.doesNotMatch(readFileSync(path, 'utf8'), /old\.js/)

  deleteCapability({ resources: [{ ...resource, name: 'docs-search' }] })
  assert.doesNotMatch(readFileSync(path, 'utf8'), /docs-search/)
})

test('capability manager keeps portable plugin mirrors in sync', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-capability-manager-plugin-'))
  const pluginRoot = join(home, '.orchestrator', 'capabilities', 'plugins', 'release-helper')
  const pluginSkillPath = join(pluginRoot, 'skills', 'release-helper', 'SKILL.md')
  const claudeSkillPath = join(home, '.claude', 'skills', 'release-helper', 'SKILL.md')
  const codexSkillPath = join(home, '.agents', 'skills', 'release-helper', 'SKILL.md')
  mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true })
  mkdirSync(join(pluginRoot, '.codex-plugin'), { recursive: true })
  mkdirSync(join(pluginSkillPath, '..'), { recursive: true })
  mkdirSync(join(claudeSkillPath, '..'), { recursive: true })
  mkdirSync(join(codexSkillPath, '..'), { recursive: true })
  writeFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'release-helper', description: 'Old' }))
  writeFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'release-helper', description: 'Old' }))
  writeFileSync(pluginSkillPath, '# Release Helper\n\nOld body\n')
  writeFileSync(claudeSkillPath, '# Release Helper\n\nOld body\n')
  writeFileSync(codexSkillPath, '# Release Helper\n\nOld body\n')
  mkdirSync(join(home, '.orchestrator', 'capabilities', '.claude-plugin'), { recursive: true })
  mkdirSync(join(home, '.agents', 'plugins'), { recursive: true })
  writeFileSync(join(home, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'orchestrator-capabilities',
    owner: { name: 'Orchestrator' },
    plugins: [{ name: 'release-helper', source: './plugins/release-helper', description: 'Old' }]
  }))
  writeFileSync(join(home, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({
    name: 'orchestrator-capabilities',
    interface: { displayName: 'Orchestrator Capabilities' },
    plugins: [{
      name: 'release-helper',
      source: { source: 'local', path: './.orchestrator/capabilities/plugins/release-helper' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity'
    }]
  }))
  const resource = resourceFor('claude', 'plugin', 'release-helper', pluginRoot)

  updateCapability({
    resources: [resource],
    name: 'Ship Helper',
    description: 'Help prepare releases',
    body: 'Updated plugin workflow'
  })

  const nextPluginRoot = join(home, '.orchestrator', 'capabilities', 'plugins', 'ship-helper')
  assert.match(readFileSync(join(nextPluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'), /ship-helper/)
  assert.match(readFileSync(join(nextPluginRoot, 'skills', 'ship-helper', 'SKILL.md'), 'utf8'), /Updated plugin workflow/)
  assert.match(readFileSync(join(home, '.claude', 'skills', 'ship-helper', 'SKILL.md'), 'utf8'), /Updated plugin workflow/)
  assert.match(readFileSync(join(home, '.agents', 'skills', 'ship-helper', 'SKILL.md'), 'utf8'), /Updated plugin workflow/)
  assert.match(readFileSync(join(home, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), 'utf8'), /ship-helper/)
  assert.doesNotMatch(readFileSync(join(home, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), 'utf8'), /release-helper/)
  assert.match(readFileSync(join(home, '.agents', 'plugins', 'marketplace.json'), 'utf8'), /\.orchestrator\/capabilities\/plugins\/ship-helper/)
  assert.doesNotMatch(readFileSync(join(home, '.agents', 'plugins', 'marketplace.json'), 'utf8'), /release-helper/)
  assert.equal(existsSync(join(home, '.claude', 'skills', 'release-helper')), false)
  assert.equal(existsSync(join(home, '.agents', 'skills', 'release-helper')), false)

  deleteCapability({ resources: [{ ...resource, name: 'ship-helper', raw: { path: nextPluginRoot } }] })
  assert.equal(existsSync(nextPluginRoot), false)
  assert.equal(existsSync(join(home, '.claude', 'skills', 'ship-helper')), false)
  assert.equal(existsSync(join(home, '.agents', 'skills', 'ship-helper')), false)
  assert.doesNotMatch(readFileSync(join(home, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), 'utf8'), /ship-helper/)
  assert.doesNotMatch(readFileSync(join(home, '.agents', 'plugins', 'marketplace.json'), 'utf8'), /ship-helper/)
})

function resourceFor(
  providerId: string,
  kind: ProviderResource['kind'],
  name: string,
  path: string,
  config?: Record<string, unknown>,
  configFormat = 'json'
): ProviderResource {
  return {
    id: `${providerId}:${kind}:${name}`,
    providerId,
    kind,
    name,
    source: 'test',
    description: 'test',
    fingerprint: `${kind}:${name}`,
    status: 'available',
    scope: 'global',
    actions: ['refresh', 'inspect', 'edit', 'remove'],
    raw: { path, config, editable: true, configFormat }
  }
}
