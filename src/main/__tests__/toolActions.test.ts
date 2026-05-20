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
  const longPath = `/private/tmp/orchestrator-agent-ui-smoke/${'very-long-directory-name-'.repeat(8)}target.txt`

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
  assert.equal(
    permissionSummary({
      tool_name: 'WebFetch',
      tool_use_id: 'tool-4',
      tool_input: { url: 'https://docs.anthropic.com/en/docs/claude-code/settings' }
    }),
    'WebFetch https://docs.anthropic.com/en/docs/claude-code/settings'
  )
  assert.equal(
    permissionSummary({
      tool_name: 'mcp__linear__create_issue',
      tool_use_id: 'tool-5',
      tool_input: { description: 'Create issue in ORCH project' }
    }),
    'mcp__linear__create_issue Create issue in ORCH project'
  )
  assert.equal(
    permissionSummary({
      tool_name: 'Write',
      tool_use_id: 'tool-6',
      tool_input: { file_path: longPath }
    }),
    `Write ${longPath.slice(0, 160)}`
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

test('file references preserve quoted paths, paths with spaces, and home references', () => {
  const content = [
    'p2-read-search.txt',
    '/private/tmp/orchestrator-agent-ui-smoke/p2-read-search.txt',
    '"p2 paths/quoted path file.txt"',
    '/private/tmp/orchestrator-agent-ui-smoke/p2 paths/long-path-directory/reference-file-with-a-very-long-name.txt',
    '~/Desktop/Orchestrator/docs/orchestrator-source-of-truth.md'
  ].join('\n')
  const refs = extractFileReferences(content, '/private/tmp/orchestrator-agent-ui-smoke')

  assert.deepEqual(refs.map((ref) => ref.path), [
    '/private/tmp/orchestrator-agent-ui-smoke/p2-read-search.txt',
    '/private/tmp/orchestrator-agent-ui-smoke/p2 paths/quoted path file.txt',
    '/private/tmp/orchestrator-agent-ui-smoke/p2 paths/long-path-directory/reference-file-with-a-very-long-name.txt',
    '~/Desktop/Orchestrator/docs/orchestrator-source-of-truth.md'
  ])
  assert.equal(refs.some((ref) => ref.path === '/private/tmp/orchestrator-agent-ui-smoke/p2'), false)
})

test('file references preserve line and column targets separately from paths', () => {
  const content = [
    '`src/main/index.ts:42:7`',
    '"/Users/navital/Desktop/Orchestrator/src/main/ipc.ts:108"',
    '~/Desktop/Orchestrator/src/types/index.ts:12'
  ].join('\n')
  const refs = extractFileReferences(content, '/Users/navital/Desktop/Orchestrator')

  assert.deepEqual(
    refs.map((ref) => ({ path: ref.path, line: ref.line, column: ref.column })),
    [
      { path: '/Users/navital/Desktop/Orchestrator/src/main/index.ts', line: 42, column: 7 },
      { path: '/Users/navital/Desktop/Orchestrator/src/main/ipc.ts', line: 108, column: undefined },
      { path: '~/Desktop/Orchestrator/src/types/index.ts', line: 12, column: undefined }
    ]
  )
})

test('file references ignore inline comments and decimal literals in review prose', () => {
  const content = [
    'The code is in good shape. A few things to flag:',
    '',
    '**Blocking — files missing from the PR:**',
    '- `CbccPaymentBenefitExperienceContractTest.java` and `iloc-service-types/src/test/resources/` (the JSON fixture it uses) are **untracked** — they have not been committed, so the contract test will not be in the PR.',
    '',
    '**Minor issues:**',
    '- `EligibleReward.java:61` has a `// Co-branded card cashback reward values` comment that violates the no-comments-for-what convention.',
    '- `String.valueOf(r.getTotalRewardAmount().getValue())` at `ILockServiceContextBuilder.java:117` converts a `double` to string. It works for the known values (`0.03`, `13.67`), but floating-point representation could be surprising.'
  ].join('\n')
  const refs = extractFileReferences(content, '/Users/navital/Desktop/xoneor')

  assert.deepEqual(refs.map((ref) => ref.path), [
    '/Users/navital/Desktop/xoneor/CbccPaymentBenefitExperienceContractTest.java',
    '/Users/navital/Desktop/xoneor/EligibleReward.java',
    '/Users/navital/Desktop/xoneor/ILockServiceContextBuilder.java'
  ])
  assert.equal(refs.some((ref) => ref.path.includes('Co-branded card cashback reward values')), false)
  assert.equal(refs.some((ref) => ref.path.endsWith('/0.03')), false)
  assert.equal(refs.some((ref) => ref.path.endsWith('/13.67')), false)
})

test('file reference roots include sibling Desktop repos mentioned in tool output', () => {
  const content = 'Read /Users/navital/Desktop/xopes/xopesweb/src/main/resources/schema/PaymentsUpsellMessage.graphqls'
  assert.deepEqual(
    extractWorkspaceRootsFromText(content, '/Users/navital/Desktop/dynamicplatform'),
    ['/Users/navital/Desktop/dynamicplatform', '/Users/navital/Desktop/xopes']
  )
})
