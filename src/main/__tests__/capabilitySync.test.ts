import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyCapabilitySync, previewCapabilitySync } from '../capabilitySync'
import type { ProviderResource } from '../../types'

test('capability sync backfills a missing Codex skill projection', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-sync-skill-'))
  const sourcePath = join(cwd, '.claude', 'skills', 'release-reviewer', 'SKILL.md')
  mkdirSync(join(sourcePath, '..'), { recursive: true })
  writeFileSync(sourcePath, '---\nname: release-reviewer\ndescription: Review releases\n---\n\n# Release Reviewer\n\nCheck tests.\n')
  const resource = resourceFor('claude', 'skill', 'Release Reviewer', sourcePath, undefined, 'project')

  const plan = previewCapabilitySync({
    resources: [resource],
    workDir: cwd,
    scope: 'project',
    targetProviders: ['claude', 'codex'],
    mode: 'backfill-missing-providers'
  })

  assert.equal(plan.ok, true)
  assert.ok(plan.operations.some((operation) => operation.providerId === 'codex' && operation.action === 'write-file'))
  assert.ok(plan.operations.some((operation) => operation.providerId === 'orchestrator' && operation.action === 'update-json'))
  assert.equal(plan.operations.some((operation) => 'content' in operation), false)

  const result = applyCapabilitySync({
    resources: [resource],
    workDir: cwd,
    scope: 'project',
    targetProviders: ['claude', 'codex'],
    mode: 'backfill-missing-providers'
  })

  const codexPath = join(cwd, '.agents', 'skills', 'release-reviewer', 'SKILL.md')
  const registryPath = join(cwd, '.orchestrator', 'capabilities', 'registry', 'skill', 'release-reviewer', 'capability.json')
  assert.equal(result.ok, true)
  assert.ok(result.files.includes(codexPath))
  assert.ok(result.files.includes(registryPath))
  assert.match(readFileSync(codexPath, 'utf8'), /Check tests/)
  assert.match(readFileSync(registryPath, 'utf8'), /"codex"/)
})

test('capability sync imports a provider plugin as a portable Claude and Codex package', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-sync-plugin-'))
  const providerPluginRoot = join(cwd, '.claude', 'plugins', 'release-helper')
  mkdirSync(providerPluginRoot, { recursive: true })
  writeFileSync(join(providerPluginRoot, 'plugin.json'), JSON.stringify({ name: 'release-helper' }))
  const resource = resourceFor('claude', 'plugin', 'Release Helper', providerPluginRoot, undefined, 'project')

  const result = applyCapabilitySync({
    resources: [resource],
    workDir: cwd,
    scope: 'project',
    targetProviders: ['claude', 'codex'],
    mode: 'import-as-portable-copy'
  })

  const portableRoot = join(cwd, '.orchestrator', 'capabilities', 'plugins', 'release-helper')
  assert.equal(result.ok, true)
  assert.ok(result.files.includes(join(portableRoot, 'skills', 'release-helper', 'SKILL.md')))
  assert.ok(result.files.includes(join(portableRoot, '.claude-plugin', 'plugin.json')))
  assert.ok(result.files.includes(join(portableRoot, '.codex-plugin', 'plugin.json')))
  assert.match(readFileSync(join(cwd, '.orchestrator', 'capabilities', '.claude-plugin', 'marketplace.json'), 'utf8'), /release-helper/)
  assert.match(readFileSync(join(cwd, '.agents', 'plugins', 'marketplace.json'), 'utf8'), /release-helper/)
})

test('capability sync fans MCP config out to provider config files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-sync-mcp-'))
  const resource = resourceFor('claude', 'mcp_server', 'Docs Search', join(cwd, '.mcp.json'), { command: 'node', args: ['server.js'] }, 'project')

  const result = applyCapabilitySync({
    resources: [resource],
    workDir: cwd,
    scope: 'project',
    targetProviders: ['claude', 'codex', 'cursor', 'copilot'],
    mode: 'sync-selected-providers'
  })

  assert.equal(result.ok, true)
  assert.match(readFileSync(join(cwd, '.mcp.json'), 'utf8'), /docs-search/)
  assert.match(readFileSync(join(cwd, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.docs-search\]/)
  assert.match(readFileSync(join(cwd, '.cursor', 'mcp.json'), 'utf8'), /docs-search/)
  assert.match(readFileSync(join(cwd, '.copilot', 'mcp-config.json'), 'utf8'), /docs-search/)
  assert.match(readFileSync(join(cwd, '.orchestrator', 'capabilities', 'mcp', 'docs-search.json'), 'utf8'), /server\.js/)
})

test('capability sync keeps risky native operations gated', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-capability-sync-gated-'))
  const hook = resourceFor('claude', 'hook', 'Pre Tool Hook', join(cwd, 'hook.json'), undefined, 'project')
  const hookPlan = previewCapabilitySync({
    resources: [hook],
    workDir: cwd,
    scope: 'project',
    targetProviders: ['claude', 'codex'],
    mode: 'sync-selected-providers'
  })

  assert.equal(hookPlan.ok, false)
  assert.match(hookPlan.blockers.join('\n'), /Hooks can block/)

  const plugin = resourceFor('claude', 'plugin', 'Release Helper', join(cwd, '.claude', 'plugins', 'release-helper'), undefined, 'project')
  const nativeResult = applyCapabilitySync({
    resources: [plugin],
    workDir: cwd,
    scope: 'project',
    targetProviders: ['claude', 'codex'],
    mode: 'install-native'
  })

  assert.equal(nativeResult.ok, true)
  assert.deepEqual(nativeResult.files, [])
  assert.match(nativeResult.warnings.join('\n'), /requires provider confirmation/)
  assert.equal(existsSync(join(cwd, '.claude', 'plugins', 'release-helper')), false)
})

function resourceFor(
  providerId: string,
  kind: ProviderResource['kind'],
  name: string,
  path: string,
  config?: Record<string, unknown>,
  scope: ProviderResource['scope'] = 'global'
): ProviderResource {
  return {
    id: `${providerId}:${kind}:${name}`,
    providerId,
    kind,
    name,
    source: 'test',
    description: 'test capability',
    fingerprint: `${kind}:${name.toLowerCase().replace(/\s+/g, '-')}`,
    status: 'available',
    scope,
    actions: ['refresh', 'inspect', 'edit', 'remove'],
    raw: { path, config, editable: true }
  }
}
