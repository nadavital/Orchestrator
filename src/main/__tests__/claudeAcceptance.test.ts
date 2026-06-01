import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileChange, RunEvent, SessionRunEventRecord } from '../../types'
import {
  availableSlashCommands,
  deriveAgentNodes,
  deriveAgentThreadGraph,
  deriveAgentNodesFromMessages,
  derivePlanStates,
  pairToolActivities,
  summarizeFileChanges,
  summarizeToolActivities
} from '../../types'
import { getProviderRuntimeInfo, PROVIDERS } from '../providers'
import { eventsToMessages } from '../runEvents'

function readFixture(fixtureName: string): string[] {
  return readFileSync(join(process.cwd(), 'src/main/__fixtures__/providers/claude', fixtureName), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseClaudeFixture(fixtureName: string): RunEvent[] {
  return readFixture(fixtureName).flatMap((line) => PROVIDERS.claude.parseOutputLine(line))
}

function records(events: RunEvent[]): SessionRunEventRecord[] {
  return events.map((event, index) => ({
    id: `event-${index}`,
    timestamp: index + 1,
    event
  }))
}

test('Orchestrator source of truth is backed by Claude fixtures and completion gates', () => {
  const plan = readFileSync(join(process.cwd(), 'docs/orchestrator-source-of-truth.md'), 'utf8')
  for (const fixture of [
    'plain-answer.jsonl',
    'repo-actions.jsonl',
    'permission-denied.jsonl',
    'ask-user-question.jsonl',
    'plan-todos.jsonl',
    'exit-plan-denial.jsonl',
    'task-agent.jsonl',
    'agent-tool.jsonl',
    'task-progress.jsonl',
    'hook-approval.jsonl',
    'plan-approval-live.jsonl',
    'project-command.jsonl',
    'project-skill.jsonl',
    'sidechain-real.jsonl',
    'mcp-web-approval.jsonl',
    'failure-categories.jsonl'
  ]) {
    assert.match(plan, new RegExp(fixture.replace('.', '\\.')), `Source of truth should cite ${fixture}`)
  }
  for (const surface of ['slash commands', 'skills', 'Diff', 'subagents']) {
    assert.match(plan, new RegExp(surface, 'i'), `Source of truth should cover ${surface}`)
  }
  assert.match(plan, /Allow once/i)
  assert.match(plan, /Allow session/i)

  for (const contract of [
    'Orchestrator-native',
    'Provider diagnostics remain available',
    'Mutating provider-management commands are gated',
    'P0-003',
    'P6-001'
  ]) {
    assert.match(plan, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Claude support test matrix tracks first-class CLI capability gates', () => {
  const matrix = readFileSync(join(process.cwd(), 'docs/claude-code-support-test-matrix.md'), 'utf8')

  for (const required of [
    'Workspace trust prompt',
    'AskUserQuestion tool',
    'Plan mode',
    '`Task` tool subagents',
    'Skills as slash commands',
    '`claude mcp list/get`',
    '`claude plugin list --json`',
    'Queue/steer'
  ]) {
    assert.ok(matrix.includes(required), `Missing Claude support matrix row for ${required}`)
  }
})

test('Claude repo actions collapse into the expected transcript vocabulary', () => {
  const events = parseClaudeFixture('repo-actions.jsonl')
  const messages = eventsToMessages(events).filter((message) => message.type === 'tool_use' || message.type === 'tool_result')
  const activities = pairToolActivities(messages)

  assert.equal(
    summarizeToolActivities(activities),
    'Read 1 file · Wrote 1 file · Edited 1 file · Deleted 1 file · Ran 1 command · Searched 1 query · Used MCP 1 tool · Delegated 1 agent'
  )
  assert.equal(events.some((event) => event.type === 'agent.started'), true)
  assert.equal(events.some((event) => event.type === 'agent.completed'), true)
})

test('Claude agent and plan derivation covers subagents and plan mode from fixtures', () => {
  const session = { id: 'session-under-test', provider: 'claude', providerSessionId: 'claude-parent-session' }
  const agentEvents = parseClaudeFixture('task-progress.jsonl')
  const agents = deriveAgentNodes(session, records(agentEvents))

  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'tool-live-agent-1')
  assert.equal(agents[0].status, 'completed')
  assert.match(agents[0].summary ?? '', /Found TodoWrite parser test patterns/)

  const plans = derivePlanStates(session, records(parseClaudeFixture('plan-todos.jsonl')))
  assert.equal(plans.at(-1)?.title, 'Tasks')
  assert.equal(plans.at(-1)?.items.length, 3)
  assert.equal(plans.at(-1)?.items[1].status, 'in_progress')
})

test('Claude agent derivation falls back to saved transcript tool messages', () => {
  const session = { id: 'session-under-test', provider: 'claude' }
  const messages = eventsToMessages(parseClaudeFixture('agent-tool.jsonl'))
  const agents = deriveAgentNodesFromMessages(session, messages)

  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'tool-agent-1')
  assert.equal(agents[0].status, 'completed')
  assert.equal(agents[0].transcript, 'README.md')
})

test('Claude saved subagent transcripts hide native agent metadata trailers', () => {
  const session = { id: 'session-under-test', provider: 'claude', providerSessionId: 'claude-parent-session' }
  const messages = [
    {
      id: 'tool-agent-2',
      role: 'assistant' as const,
      type: 'tool_use' as const,
      toolName: 'Task',
      toolInput: { description: 'Read README.md first sentence' },
      timestamp: 1
    },
    {
      id: 'tool-result-2',
      role: 'tool' as const,
      type: 'tool_result' as const,
      toolUseId: 'tool-agent-2',
      content: `The first sentence is useful.\nagentId: abc123 (use SendMessage with to: 'abc123' to continue this agent)\n<usage>total_tokens: 15197\ntool_uses: 1\n</usage>`,
      isError: false,
      timestamp: 2
    }
  ]
  const agents = deriveAgentNodesFromMessages(session, messages)
  const graph = deriveAgentThreadGraph({ ...session, messages }, [])

  assert.equal(agents.length, 1)
  assert.equal(agents[0].transcript, 'The first sentence is useful.')
  assert.equal(agents[0].summary, 'The first sentence is useful.')
  assert.equal(agents[0].providerAgentId, 'abc123')
  assert.equal(agents[0].providerItemId, 'tool-agent-2')
  assert.equal(agents[0].parentThreadId, 'claude-parent-session')
  assert.equal(graph.threads[0]?.capabilities.openProviderThread.status, 'available')
  assert.equal(graph.threads[0]?.capabilities.resume.status, 'available')
})

test('Claude saved transcript failure finalizes active subagents', () => {
  const session = { id: 'session-under-test', provider: 'claude' }
  const messages = eventsToMessages(parseClaudeFixture('task-permission-denied.jsonl'))
  const agents = deriveAgentNodesFromMessages(session, messages)

  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'tool-denied-agent-1')
  assert.equal(agents[0].status, 'failed')
  assert.match(agents[0].summary ?? '', /Permission denied by user/)
})

test('Claude live hook approval fixture hides hook attachments and preserves tool flow', () => {
  const events = parseClaudeFixture('hook-approval.jsonl')
  const messages = eventsToMessages(events)
  const activities = pairToolActivities(messages.filter((message) => message.type === 'tool_use' || message.type === 'tool_result'))

  assert.deepEqual(events.map((event) => event.type), [
    'session.started',
    'tool.started',
    'tool.completed',
    'assistant.text',
    'run.completed'
  ])
  assert.equal(summarizeToolActivities(activities), 'Ran 1 command')
  assert.equal(messages.some((message) => message.type === 'text' && /hook_success|PreToolUse/.test(message.content)), false)
})

test('Claude plan approval live fixture covers plan permission and approved write', () => {
  const events = parseClaudeFixture('plan-approval-live.jsonl')
  const plans = derivePlanStates({ id: 'session-under-test', provider: 'claude' }, records(events))
  const messages = eventsToMessages(events)
  const writeResult = messages.find((message) => message.type === 'tool_result' && message.toolUseId === 'tool-plan-approved-write-1')

  assert.ok(plans.some((plan) => /Create p7-plan-approve/.test(plan.summary ?? '')))
  assert.ok(events.some((event) => event.type === 'permission.requested' && event.denials[0]?.tool_name === 'ExitPlanMode'))
  assert.ok(writeResult)
  assert.ok(messages.some((message) => message.type === 'text' && message.content === 'P7_PLAN_APPROVE_DONE'))
})

test('Claude project command and skill fixtures preserve expected assistant output', () => {
  const commandText = assistantText(parseClaudeFixture('project-command.jsonl'))
  const skillText = assistantText(parseClaudeFixture('project-skill.jsonl'))

  assert.match(commandText, /P5_PROJECT_COMMAND_OK/)
  assert.match(skillText, /tiny skill loaded/)
})

function assistantText(events: RunEvent[]): string {
  return events
    .filter((event) => event.type === 'assistant.text' || event.type === 'assistant.text.delta')
    .map((event) => event.content)
    .join('')
}

test('Claude slash command surface follows feature support without a user-visible runtime split', () => {
  const runtime = getProviderRuntimeInfo().claude
  const commands = availableSlashCommands(runtime)

  assert.ok(commands.some((command) => command.name === '/settings' && command.group === 'App'))
  assert.ok(commands.some((command) => command.name === '/review' && command.group === 'Provider'))
  assert.equal(commands.filter((command) => command.name === '/agents').length, 1)
  assert.ok(commands.some((command) => command.name === '/agents' && command.group === 'App'))
})

test('Codex slash command surface does not advertise unsupported goal routing', () => {
  const runtime = getProviderRuntimeInfo().codex
  const commands = availableSlashCommands(runtime)
  const goal = commands.find((command) => command.name === '/goal')

  assert.equal(goal, undefined)
})

test('Diff summary makes deletion and large changes visible without dumping patches', () => {
  const files: FileChange[] = [
    { path: 'src/index.ts', status: 'M', additions: 4, deletions: 2 },
    { path: 'docs/new.md', status: 'A', additions: 30, deletions: 0 },
    { path: 'tmp/generated.log', status: 'D', additions: 0, deletions: 120 }
  ]
  const summary = summarizeFileChanges(files)

  assert.equal(summary.total, 3)
  assert.equal(summary.label, '1 modified · 1 added · 1 deleted')
  assert.equal(summary.additions, 34)
  assert.equal(summary.deletions, 122)
  assert.equal(summary.risk, 'high')
})
