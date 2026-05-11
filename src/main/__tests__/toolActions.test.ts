import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolResultMessage, ToolUseMessage } from '../../types'
import {
  describeToolAction,
  extractFileReferences,
  extractWorkspaceRootsFromText,
  pairToolActivities,
  permissionSummary,
  summarizeToolActivities
} from '../../types'

function tool(toolName: string, toolInput: Record<string, unknown>, id = toolName): ToolUseMessage {
  return {
    id,
    role: 'assistant',
    type: 'tool_use',
    toolName,
    toolInput,
    timestamp: 0
  }
}

function result(toolUseId: string, isError = false): ToolResultMessage {
  return {
    id: `${toolUseId}-result`,
    role: 'tool',
    type: 'tool_result',
    toolUseId,
    content: isError ? 'failed' : 'ok',
    isError,
    timestamp: 0
  }
}

test('tool action descriptors classify common repo actions with compact targets', () => {
  assert.deepEqual(describeToolAction(tool('Read', { file_path: 'src/main/providers.ts' })), {
    kind: 'read',
    verb: 'Read',
    unit: 'file',
    label: 'Read',
    risk: 'low',
    target: 'src/main/providers.ts'
  })
  assert.equal(describeToolAction(tool('Write', { file_path: 'docs/plan.md' })).kind, 'write')
  assert.equal(describeToolAction(tool('MultiEdit', { file_path: 'src/App.tsx' })).kind, 'edit')
  assert.equal(describeToolAction(tool('DeleteFile', { path: 'tmp/out.txt' })).risk, 'high')
  assert.equal(describeToolAction(tool('Bash', { command: 'git status --short' })).kind, 'shell')
  assert.equal(describeToolAction(tool('mcp__jira__search', { query: 'project = X' })).kind, 'mcp')
  assert.equal(describeToolAction(tool('Agent', { description: 'Inspect renderer UI' })).kind, 'agent')
  assert.equal(describeToolAction(tool('TodoWrite', { todos: [] })).kind, 'plan')
})

test('tool activity summary stays concise across mixed repo actions and errors', () => {
  const messages: Array<ToolUseMessage | ToolResultMessage> = [
    tool('Read', { file_path: 'README.md' }, 'read-1'),
    result('read-1'),
    tool('Edit', { file_path: 'src/index.ts' }, 'edit-1'),
    result('edit-1'),
    tool('Bash', { command: 'npm test' }, 'bash-1'),
    result('bash-1', true)
  ]
  const activities = pairToolActivities(messages)

  assert.equal(activities.length, 3)
  assert.equal(
    summarizeToolActivities(activities),
    'Read 1 file · Edited 1 file · Ran 1 command · 1 error'
  )
})

test('permission summaries use the same action vocabulary without dumping raw payloads', () => {
  assert.equal(
    permissionSummary({
      tool_name: 'Edit',
      tool_use_id: 'tool-1',
      tool_input: { file_path: '/tmp/example.ts', old_string: 'before', new_string: 'after' }
    }),
    'Edit /tmp/example.ts'
  )
  assert.equal(
    permissionSummary({
      tool_name: 'Bash',
      tool_use_id: 'tool-2',
      tool_input: { command: 'git push origin main' }
    }),
    'Bash git push origin main'
  )
  assert.equal(
    permissionSummary({
      tool_name: 'ExitPlanMode',
      tool_use_id: 'tool-3',
      tool_input: { plan: '# Plan\n\nRun parser tests.' }
    }),
    'Plan: Plan'
  )
})

test('file references extract local paths from assistant prose without code block noise', () => {
  const content = [
    'Created at /Users/navital/Desktop/fgql/postman/collection_fop_banner.json.',
    'Also wrote `docs/plan.md`.',
    '```ts',
    'const ignored = "/Users/navital/Desktop/fgql/tmp/generated.ts"',
    '```'
  ].join('\n')
  const refs = extractFileReferences(content, '/Users/navital/Desktop/fgql')

  assert.deepEqual(refs.map((ref) => ref.path), [
    '/Users/navital/Desktop/fgql/postman/collection_fop_banner.json',
    '/Users/navital/Desktop/fgql/docs/plan.md'
  ])
  assert.equal(refs[0].label, 'collection_fop_banner.json')
})

test('file reference roots include sibling Desktop repos mentioned in tool output', () => {
  const content = 'Read /Users/navital/Desktop/xopes/xopesweb/src/main/resources/schema/PaymentsUpsellMessage.graphqls'
  assert.deepEqual(
    extractWorkspaceRootsFromText(content, '/Users/navital/Desktop/dynamicplatform'),
    ['/Users/navital/Desktop/dynamicplatform', '/Users/navital/Desktop/xopes']
  )
})
