import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeSdkAgentTeamsEnabled, claudeSdkContentBlocksForRequest, claudeSdkPromptForRequest, claudeSdkRunPolicySummary, resolveClaudeSdkExecutablePath, resolveClaudeSdkRunPolicy } from '../claudeSdkRuntime'
import { normalizeClaudeMessageObject } from '../providers'
import type { RunEvent, RunRequest, Session } from '../../types'

function request(patch: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: 'hello',
    cwd: '/tmp/orchestrator-request-cwd',
    model: 'claude-sonnet-4-6',
    effort: 'normal',
    providerSessionId: null,
    executionPolicy: 'default',
    allowedTools: [],
    ...patch
  }
}

function session(patch: Partial<Session> = {}): Pick<Session, 'workDir' | 'providerProjectlessThreadId'> {
  return {
    workDir: '/tmp/orchestrator-session-cwd',
    providerProjectlessThreadId: null,
    ...patch
  }
}

function normalizeSdkFixture(name: string): RunEvent[] {
  const raw = readFileSync(join(process.cwd(), 'src/main/__fixtures__/providers/claude-sdk', name), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => normalizeClaudeMessageObject(JSON.parse(line) as Record<string, unknown>))
}

test('claude sdk prompt uses a plain string when no provider file resources are attached', () => {
  const prompt = claudeSdkPromptForRequest({ prompt: 'hello', attachments: [] })

  assert.equal(prompt, 'hello')
})

test('claude sdk prompt maps provider file resources to file-backed content blocks', async () => {
  const prompt = claudeSdkPromptForRequest({
    prompt: 'summarize these files',
    attachments: [
      { id: 'local-1', kind: 'local_file', path: '/tmp/local.txt', name: 'local.txt' },
      { id: 'file-1', kind: 'claude_file', fileId: ' file_doc ', relativePath: ' docs/context.md ', name: 'Context' },
      { id: 'file-2', kind: 'claude_file', fileId: 'file_img', relativePath: 'assets/screenshot.png' },
      { id: 'file-3', kind: 'claude_file', fileId: '', relativePath: 'ignored.md' }
    ]
  })

  assert.notEqual(typeof prompt, 'string')
  const messages: unknown[] = []
  for await (const message of prompt as AsyncIterable<unknown>) messages.push(message)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'text', text: 'summarize these files' },
        {
          type: 'document',
          source: { type: 'file', file_id: 'file_doc' },
          title: 'Context',
          context: 'Attached provider file resource: docs/context.md'
        },
        {
          type: 'image',
          source: { type: 'file', file_id: 'file_img' }
        }
      ]
    }
  })
})

test('claude sdk content block helper ignores invalid file resources', () => {
  assert.deepEqual(
    claudeSdkContentBlocksForRequest({
      prompt: 'hello',
      attachments: [
        { id: 'missing-id', kind: 'claude_file', fileId: ' ', relativePath: 'docs/a.md' },
        { id: 'missing-path', kind: 'claude_file', fileId: 'file_abc', relativePath: ' ' }
      ]
    }),
    [{ type: 'text', text: 'hello' }]
  )
})

test('claude sdk enables agent teams only for resumed subagent shells', () => {
  assert.equal(
    claudeSdkAgentTeamsEnabled({ providerProjectlessThreadId: 'agent-123' }, { providerSessionId: 'parent-session' }),
    true
  )
  assert.equal(
    claudeSdkAgentTeamsEnabled({ providerProjectlessThreadId: null }, { providerSessionId: 'parent-session' }),
    false
  )
  assert.equal(
    claudeSdkAgentTeamsEnabled({ providerProjectlessThreadId: 'agent-123' }, { providerSessionId: null }),
    false
  )
  assert.equal(
    claudeSdkAgentTeamsEnabled({ providerProjectlessThreadId: 'claude-child-session' }, { providerSessionId: 'claude-child-session' }),
    false
  )
})

test('claude sdk run policy makes streaming and filesystem defaults explicit', () => {
  const policy = resolveClaudeSdkRunPolicy(session(), request())

  assert.equal(policy.cwd, '/tmp/orchestrator-session-cwd')
  assert.equal(policy.clientApp, 'orchestrator/claude-sdk-runtime')
  assert.equal(policy.includePartialMessages, true)
  assert.equal(policy.includeHookEvents, true)
  assert.equal(policy.forwardSubagentText, true)
  assert.equal(policy.agentProgressSummaries, true)
  assert.equal(policy.persistSession, true)
  assert.deepEqual(policy.settingSources, ['user', 'project', 'local'])
  assert.deepEqual(policy.thinking, { type: 'disabled' })
  assert.equal(policy.permissionMode, 'default')
  assert.equal(policy.allowDangerouslySkipPermissions, false)
})

test('claude sdk run policy maps thinking effort limits and bypass safely', () => {
  const policy = resolveClaudeSdkRunPolicy(
    session({ workDir: '', providerProjectlessThreadId: 'agent-123' }),
    request({
      cwd: '/tmp/fallback-cwd',
      providerSessionId: 'parent-session',
      executionPolicy: 'bypassPermissions',
      useThinking: true,
      effort: 'high',
      maxTurns: 3.8,
      maxBudgetUsd: 0.05
    })
  )

  assert.equal(policy.cwd, '/tmp/fallback-cwd')
  assert.equal(policy.permissionMode, 'bypassPermissions')
  assert.equal(policy.allowDangerouslySkipPermissions, true)
  assert.deepEqual(policy.thinking, { type: 'adaptive' })
  assert.equal(policy.effort, 'high')
  assert.equal(policy.maxTurns, 3)
  assert.equal(policy.maxBudgetUsd, 0.05)
  assert.equal(policy.agentTeamsEnabled, true)
})

test('claude sdk run policy summary avoids prompt and tool payload data', () => {
  const summary = claudeSdkRunPolicySummary(resolveClaudeSdkRunPolicy(
    session(),
    request({ prompt: 'secret prompt', allowedTools: ['Bash'], maxTurns: -1, maxBudgetUsd: Number.NaN })
  ))

  assert.equal(summary.thinking, 'disabled')
  assert.equal(summary.maxTurns, null)
  assert.equal(summary.maxBudgetUsd, null)
  assert.equal(Object.values(summary).some((value) => String(value).includes('secret prompt')), false)
  assert.equal(Object.values(summary).some((value) => String(value).includes('Bash')), false)
})

test('claude sdk executable resolver prefers packaged app.asar.unpacked binary', () => {
  const resourcesPath = join('/Applications/Orchestrator.app', 'Contents', 'Resources')
  const nestedBinary = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk-darwin-arm64',
    'claude'
  )

  assert.equal(resolveClaudeSdkExecutablePath({
    platform: 'darwin',
    arch: 'arm64',
    resourcesPath,
    resolve: () => { throw new Error('not used') },
    exists: (path) => path === nestedBinary
  }), nestedBinary)
})

test('claude sdk executable resolver maps app.asar require results to unpacked paths', () => {
  const asarBinary = join(
    '/Applications/Orchestrator.app',
    'Contents',
    'Resources',
    'app.asar',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk-darwin-arm64',
    'claude'
  )
  const unpackedBinary = asarBinary.replace('app.asar', 'app.asar.unpacked')

  assert.equal(resolveClaudeSdkExecutablePath({
    platform: 'darwin',
    arch: 'arm64',
    resolve: () => asarBinary,
    exists: (path) => path === unpackedBinary
  }), unpackedBinary)
})

test('claude sdk object normalizer maps questions browser tools subagents and usage', () => {
  const events = normalizeSdkFixture('sdk-object-events.jsonl')
  const eventTypes = events.map((event) => event.type)

  assert.ok(eventTypes.includes('session.started'))
  assert.ok(eventTypes.includes('user_input.requested'))
  assert.ok(eventTypes.includes('tool.started'))
  assert.ok(eventTypes.includes('tool.completed'))
  assert.ok(eventTypes.includes('agent.started'))
  assert.ok(eventTypes.includes('agent.completed'))
  assert.ok(eventTypes.includes('run.completed'))

  const question = events.find((event) => event.type === 'user_input.requested')
  assert.equal(question?.type, 'user_input.requested')
  if (question?.type === 'user_input.requested') {
    const firstQuestion = question.questions?.[0]
    assert.equal(firstQuestion?.header, 'Marker')
    assert.deepEqual(firstQuestion?.options?.map((option) => option.label), ['ALPHA', 'BETA'])
  }

  const browserTool = events.find((event) => event.type === 'tool.started' && event.toolName === 'mcp__orchestrator__browser_read')
  assert.equal(browserTool?.type, 'tool.started')
  const agent = events.find((event) => event.type === 'agent.completed')
  assert.equal(agent?.type, 'agent.completed')
  if (agent?.type === 'agent.completed') assert.match(agent.agent.summary ?? '', /Agent fixture summary/)
  const completed = events.find((event) => event.type === 'run.completed')
  assert.equal(completed?.type, 'run.completed')
  if (completed?.type === 'run.completed') {
    assert.equal(completed.content, 'SDK_OBJECT_FIXTURE_DONE')
    assert.equal(completed.usage?.inputTokens, 11)
    assert.equal(completed.usage?.outputTokens, 7)
    assert.equal(completed.usage?.totalCostUsd, 0.0123)
  }
})

test('claude sdk object normalizer maps permission and plan denials', () => {
  const events = normalizeSdkFixture('sdk-permission-events.jsonl')

  const permission = events.find((event) => event.type === 'permission.requested')
  assert.equal(permission?.type, 'permission.requested')
  if (permission?.type === 'permission.requested') {
    assert.equal(permission.denials[0]?.tool_name, 'Bash')
    assert.deepEqual(permission.denials[0]?.tool_input, { command: 'touch blocked.txt' })
  }

  const plan = events.find((event) => event.type === 'plan.updated')
  assert.equal(plan?.type, 'plan.updated')
  if (plan?.type === 'plan.updated') {
    assert.equal(plan.plan.mode, 'plan')
    assert.match(plan.plan.summary ?? '', /Create the file/)
  }
})
