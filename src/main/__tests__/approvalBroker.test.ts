import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ApprovalBroker, buildClaudeHookSettings } from '../approvalBroker'
import type { RunEvent } from '../../types'

test('approval broker creates a per-run Claude hook settings file', async () => {
  const settings = buildClaudeHookSettings(12345, 'secret', 'token')
  const raw = JSON.stringify(settings)

  assert.match(raw, /PreToolUse/)
  assert.match(raw, /127\.0\.0\.1:12345/)
  assert.match(raw, /Bash\|Edit\|Write/)
})

test('approval broker auto-allows safe tools and pauses mutating tools for the UI', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))

  const readDecision = await broker.handleClaudeHookForTest('session-2', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_use_id: 'tool-read',
    tool_input: { file_path: 'README.md' },
    session_id: 'claude-session'
  })
  assert.equal((readDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'allow')
  assert.equal(events.length, 0)

  const writeDecisionPromise = broker.handleClaudeHookForTest('session-2', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'tool-write',
    tool_input: { file_path: 'notes.md' },
    session_id: 'claude-session'
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'permission.requested')
  if (events[0].type === 'permission.requested') {
    assert.equal(events[0].denials[0].tool_name, 'Write')
    assert.deepEqual(events[0].denials[0].tool_input, { file_path: 'notes.md' })
  }

  assert.equal(broker.resolveSessionApproval('session-2', true), true)
  const writeDecision = await writeDecisionPromise
  assert.equal((writeDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'allow')
})

test('approval broker can resolve parallel pending approvals for a granted tool', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))

  const firstWrite = broker.handleClaudeHookForTest('session-3', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'tool-write-a',
    tool_input: { file_path: 'a.txt' }
  })
  const secondWrite = broker.handleClaudeHookForTest('session-3', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'tool-write-b',
    tool_input: { file_path: 'b.txt' }
  })
  const bash = broker.handleClaudeHookForTest('session-3', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tool-bash',
    tool_input: { command: 'echo hi' }
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(events.length, 3)
  assert.equal(broker.resolveSessionApprovals('session-3', true, undefined, ['Write']), 2)

  const [firstDecision, secondDecision] = await Promise.all([firstWrite, secondWrite])
  assert.equal((firstDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'allow')
  assert.equal((secondDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'allow')
  assert.equal(broker.resolveSessionApproval('session-3', false, 'still pending'), true)
  const bashDecision = await bash
  assert.equal((bashDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'deny')
})

test('approval broker auto-allows tools granted for the active session', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))
  broker.grantTools('session-4', ['Write'])

  const decision = await broker.handleClaudeHookForTest('session-4', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'tool-write',
    tool_input: { file_path: 'already-granted.txt' }
  })

  assert.equal((decision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'allow')
  assert.equal(events.length, 0)
})

test('approval broker auto-allows Claude plan artifact writes only under ~/.claude/plans', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))

  const planDecision = await broker.handleClaudeHookForTest('session-5', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'tool-plan-write',
    tool_input: { file_path: join(homedir(), '.claude', 'plans', 'sample-plan.md') }
  })

  assert.equal((planDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'allow')
  assert.equal(events.length, 0)

  const escapedPlanWrite = broker.handleClaudeHookForTest('session-5', {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_use_id: 'tool-plan-escape',
    tool_input: { file_path: join(homedir(), '.claude', 'plans', '..', 'not-a-native-plan.md') }
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(events.length, 1)
  assert.equal(broker.resolveSessionApproval('session-5', false, 'outside native plan directory'), true)
  const escapedDecision = await escapedPlanWrite
  assert.equal((escapedDecision.hookSpecificOutput as Record<string, unknown>).permissionDecision, 'deny')
})
