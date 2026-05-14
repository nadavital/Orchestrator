import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createCapability } from '../capabilityCreator'

test('custom skill creation mirrors portable skills to Claude and Codex project locations', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-skill-'))
  const result = createCapability({
    kind: 'skill',
    scope: 'project',
    workDir: cwd,
    name: 'Release Reviewer',
    description: 'Review release readiness',
    body: 'Check changelog, tests, and risky diffs.'
  })

  assert.equal(result.ok, true)
  assert.ok(result.files.includes(join(cwd, '.claude', 'skills', 'release-reviewer', 'SKILL.md')))
  assert.ok(result.files.includes(join(cwd, '.codex', 'skills', 'release-reviewer', 'SKILL.md')))
  assert.deepEqual([...new Set(result.resources.map((resource) => resource.providerId))].sort(), ['claude', 'codex'])
  assert.match(readFileSync(join(cwd, '.claude', 'skills', 'release-reviewer', 'SKILL.md'), 'utf8'), /Release Reviewer/)
})

test('custom MCP creation writes provider-readable project config files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-mcp-'))
  const result = createCapability({
    kind: 'mcp_server',
    scope: 'project',
    workDir: cwd,
    name: 'Docs Search',
    description: 'Search internal docs',
    transport: 'stdio',
    command: 'node',
    args: ['server.js']
  })

  assert.equal(result.ok, true)
  assert.match(readFileSync(join(cwd, '.mcp.json'), 'utf8'), /docs-search/)
  assert.match(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8'), /docs-search/)
  assert.match(readFileSync(join(cwd, '.copilot', 'mcp-config.json'), 'utf8'), /docs-search/)
  assert.match(readFileSync(join(cwd, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.docs-search\]/)
  assert.deepEqual([...new Set(result.resources.map((resource) => resource.providerId))].sort(), ['claude', 'codex', 'copilot', 'cursor'])
})

test('custom plugin creation writes Claude and Codex marketplace entries', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-plugin-'))
  const result = createCapability({
    kind: 'plugin',
    scope: 'project',
    workDir: cwd,
    name: 'Release Helper',
    description: 'Reusable release workflow',
    body: 'Prepare the release notes and risk checklist.'
  })

  const pluginRoot = join(cwd, '.orchestrator', 'capabilities', 'plugins', 'release-helper')
  assert.ok(result.files.includes(join(pluginRoot, '.claude-plugin', 'plugin.json')))
  assert.ok(result.files.includes(join(pluginRoot, '.codex-plugin', 'plugin.json')))
  assert.match(readFileSync(join(cwd, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), 'utf8'), /"source": "\.\/plugins\/release-helper"/)
  assert.match(readFileSync(join(cwd, '.agents', 'plugins', 'marketplace.json'), 'utf8'), /"\.\/\.orchestrator\/capabilities\/plugins\/release-helper"/)
  assert.deepEqual(
    result.resources.filter((resource) => resource.kind === 'plugin').map((resource) => resource.providerId).sort(),
    ['claude', 'codex']
  )
})
