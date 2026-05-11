import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FileChange, RunEvent, SessionRunEventRecord } from '../../types'
import {
  availableSlashCommands,
  deriveAgentNodes,
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

test('Claude acceptance matrix is backed by fixtures and probes', () => {
  const matrix = readFileSync(join(process.cwd(), 'docs/claude-acceptance-matrix.md'), 'utf8')
  for (const fixture of [
    'plain-answer.jsonl',
    'repo-actions.jsonl',
    'permission-denied.jsonl',
    'ask-user-question.jsonl',
    'plan-todos.jsonl',
    'exit-plan-denial.jsonl',
    'task-agent.jsonl',
    'agent-tool.jsonl',
    'task-progress.jsonl'
  ]) {
    assert.match(matrix, new RegExp(fixture.replace('.', '\\.')), `Matrix should cite ${fixture}`)
  }
  for (const surface of ['slash commands', 'Skills panel', 'Diff panel', 'Agents sidebar']) {
    assert.match(matrix, new RegExp(surface, 'i'), `Matrix should cover ${surface}`)
  }
  assert.match(matrix, /Allow Once/)
  assert.match(matrix, /Allow Session/)

  const completionSpec = readFileSync(join(process.cwd(), 'docs/orchestrator-completion-spec.md'), 'utf8')
  for (const contract of [
    'Provider registries expose provider-specific features',
    'Permission cards support `Allow Once`',
    'Mutating provider command surfaces are blocked',
    'Computer Use GUI verification'
  ]) {
    assert.match(completionSpec, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
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
  const session = { id: 'session-under-test', provider: 'claude' }
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

test('Claude slash command surface follows feature support and runtime lane', () => {
  const runtime = getProviderRuntimeInfo().claude
  const headless = availableSlashCommands(runtime, 'headless')
  const interactive = availableSlashCommands(runtime, 'interactive')

  assert.ok(headless.some((command) => command.name === '/settings' && command.group === 'App'))
  assert.ok(headless.some((command) => command.name === '/review' && command.group === 'Provider'))
  assert.ok(interactive.some((command) => command.name === '/settings'))
  assert.equal(interactive.some((command) => command.name === '/review'), false)
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
