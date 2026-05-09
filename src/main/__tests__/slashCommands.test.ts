import test from 'node:test'
import assert from 'node:assert/strict'
import type { ProviderRuntimeInfo } from '../../types'
import { availableSlashCommands, getSlashQuery } from '../../types'

function runtimeInfo(): ProviderRuntimeInfo {
  return {
    id: 'claude',
    capabilities: {
      resume: true,
      streamingJson: true,
      interactiveCli: true,
      interactivePermissions: true,
      allowedTools: true,
      workspaceSandbox: false,
      fullAccessMode: true
    },
    abstractCapabilities: [],
    policies: {},
    registry: {
      providerId: 'claude',
      features: [
        { id: 'review', label: 'Review', area: 'commands', support: 'supported', source: 'local-cli', runtimes: ['headless'] },
        { id: 'agents', label: 'Agents', area: 'agents', support: 'partial', source: 'local-cli', runtimes: ['headless'] },
        { id: 'mcp', label: 'MCP', area: 'mcp', support: 'unsupported', source: 'local-cli', runtimes: ['headless'] }
      ],
      gaps: [],
      probes: [],
      commandSurfaces: [],
      slashCommands: [
        {
          id: 'review',
          name: '/review',
          description: 'Run review',
          providerId: 'claude',
          source: 'provider',
          runtime: 'headless',
          handler: 'insert-prompt',
          featureId: 'review',
          prompt: 'Run review'
        },
        {
          id: 'agents',
          name: '/agents-native',
          description: 'List agents',
          providerId: 'claude',
          source: 'provider',
          runtime: 'headless',
          handler: 'send-to-provider',
          featureId: 'agents'
        },
        {
          id: 'mcp',
          name: '/mcp',
          description: 'Manage MCP',
          providerId: 'claude',
          source: 'provider',
          runtime: 'headless',
          handler: 'send-to-provider',
          featureId: 'mcp'
        },
        {
          id: 'interactive-only',
          name: '/interactive-only',
          providerId: 'claude',
          source: 'provider',
          runtime: 'interactive',
          handler: 'send-to-provider'
        }
      ]
    }
  }
}

test('slash command availability combines app commands with supported provider commands', () => {
  const commands = availableSlashCommands(runtimeInfo(), 'headless')
  const names = commands.map((command) => command.name)

  assert.ok(names.includes('/settings'))
  assert.ok(names.includes('/permissions'))
  assert.ok(names.includes('/review'))
  assert.ok(names.includes('/agents-native'))
  assert.equal(names.includes('/mcp'), false)
  assert.equal(names.includes('/interactive-only'), false)
  assert.equal(commands.find((command) => command.name === '/settings')?.group, 'App')
  assert.equal(commands.find((command) => command.name === '/review')?.group, 'Provider')
})

test('slash command availability tracks the active provider runtime lane', () => {
  const commands = availableSlashCommands(runtimeInfo(), 'interactive')
  const names = commands.map((command) => command.name)

  assert.ok(names.includes('/settings'))
  assert.ok(names.includes('/interactive-only'))
  assert.equal(names.includes('/review'), false)
})

test('slash query only opens for leading command text', () => {
  assert.equal(getSlashQuery('/review this diff'), '/review')
  assert.equal(getSlashQuery('/'), '/')
  assert.equal(getSlashQuery('please /review'), null)
})
