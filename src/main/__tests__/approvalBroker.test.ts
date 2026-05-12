import test from 'node:test'
import assert from 'node:assert/strict'
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
