import test from 'node:test'
import assert from 'node:assert/strict'
import type { ProviderRuntimeInfo } from '../../types'
import { availableSlashCommands, expandSlashCommandPrompt, getSlashQuery } from '../../types'

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
          id: 'agents-colliding',
          name: '/agents',
          description: 'Native agents command with an app-owned name',
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
  const commands = availableSlashCommands(runtimeInfo())
  const names = commands.map((command) => command.name)

  assert.ok(names.includes('/settings'))
  assert.ok(names.includes('/permissions'))
  assert.ok(names.includes('/pet'))
  assert.ok(names.includes('/review'))
  assert.ok(names.includes('/agents-native'))
  assert.ok(names.includes('/interactive-only'))
  assert.equal(names.includes('/mcp'), false)
  assert.equal(names.filter((name) => name === '/agents').length, 1)
  assert.equal(commands.find((command) => command.name === '/settings')?.group, 'App')
  assert.equal(commands.find((command) => command.name === '/agents')?.group, 'App')
  assert.equal(commands.find((command) => command.name === '/review')?.group, 'Provider')
  assert.equal(commands.find((command) => command.name === '/mcp')?.group, undefined)
})

test('slash command availability is not split by user-visible runtime lanes', () => {
  const commands = availableSlashCommands(runtimeInfo())
  const names = commands.map((command) => command.name)

  assert.ok(names.includes('/settings'))
  assert.ok(names.includes('/interactive-only'))
  assert.ok(names.includes('/review'))
})

test('slash query only opens for leading command text', () => {
  assert.equal(getSlashQuery('/review this diff'), '/review')
  assert.equal(getSlashQuery('/'), '/')
  assert.equal(getSlashQuery('please /review'), null)
})

test('slash command availability groups discovered commands and skills', () => {
  const commands = availableSlashCommands(runtimeInfo(), [
    {
      id: 'project-command',
      name: '/build',
      providerId: 'claude',
      source: 'provider',
      scope: 'project',
      runtime: 'headless',
      handler: 'insert-prompt',
      prompt: 'Build $ARGUMENTS'
    },
    {
      id: 'global-command',
      name: '/daily',
      providerId: 'claude',
      source: 'provider',
      scope: 'global',
      runtime: 'headless',
      handler: 'insert-prompt',
      prompt: 'Summarize'
    },
    {
      id: 'skill-debug',
      name: '/skill:debug',
      providerId: 'claude',
      source: 'skill',
      scope: 'project',
      runtime: 'headless',
      handler: 'insert-prompt',
      prompt: 'Debug'
    }
  ])

  assert.equal(commands.find((command) => command.name === '/build')?.group, 'Project')
  assert.equal(commands.find((command) => command.name === '/daily')?.group, 'Global')
  assert.equal(commands.find((command) => command.name === '/skill:debug')?.group, 'Skills')
})

test('slash command prompt expansion follows Claude ARGUMENTS templates', () => {
  const prompt = expandSlashCommandPrompt({
    id: 'project-command',
    name: '/build',
    providerId: 'claude',
    source: 'provider',
    scope: 'project',
    runtime: 'headless',
    handler: 'insert-prompt',
    prompt: 'Build ${ARGUMENTS}\nThen report back.'
  }, 'the release target')

  assert.equal(prompt, 'Build the release target\nThen report back.')
})
