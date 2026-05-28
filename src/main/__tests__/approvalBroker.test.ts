import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ApprovalBroker } from '../approvalBroker'
import type { RunEvent } from '../../types'

test('approval broker auto-allows safe tools and pauses mutating tools for the UI', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))

  const readDecision = await broker.handleClaudeSdkPermission('session-2', {
    toolName: 'Read',
    toolUseId: 'tool-read',
    toolInput: { file_path: 'README.md' }
  })
  assert.equal(readDecision.approved, true)
  assert.equal(events.length, 0)

  const writeDecisionPromise = broker.handleClaudeSdkPermission('session-2', {
    toolName: 'Write',
    toolUseId: 'tool-write',
    toolInput: { file_path: 'notes.md' }
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
  assert.equal(writeDecision.approved, true)
})

test('approval broker can resolve parallel pending approvals for a granted tool', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))

  const firstWrite = broker.handleClaudeSdkPermission('session-3', {
    toolName: 'Write',
    toolUseId: 'tool-write-a',
    toolInput: { file_path: 'a.txt' }
  })
  const secondWrite = broker.handleClaudeSdkPermission('session-3', {
    toolName: 'Write',
    toolUseId: 'tool-write-b',
    toolInput: { file_path: 'b.txt' }
  })
  const bash = broker.handleClaudeSdkPermission('session-3', {
    toolName: 'Bash',
    toolUseId: 'tool-bash',
    toolInput: { command: 'echo hi' }
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(events.length, 3)
  assert.equal(broker.resolveSessionApprovals('session-3', true, undefined, ['Write']), 2)

  const [firstDecision, secondDecision] = await Promise.all([firstWrite, secondWrite])
  assert.equal(firstDecision.approved, true)
  assert.equal(secondDecision.approved, true)
  assert.equal(broker.resolveSessionApproval('session-3', false, 'still pending'), true)
  const bashDecision = await bash
  assert.equal(bashDecision.approved, false)
})

test('approval broker auto-allows tools granted for the active session', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))
  broker.grantTools('session-4', ['Write'])

  const decision = await broker.handleClaudeSdkPermission('session-4', {
    toolName: 'Write',
    toolUseId: 'tool-write',
    toolInput: { file_path: 'already-granted.txt' }
  })

  assert.equal(decision.approved, true)
  assert.equal(events.length, 0)
})

test('approval broker auto-allows Claude plan artifact writes only under ~/.claude/plans', async () => {
  const broker = new ApprovalBroker()
  const events: RunEvent[] = []
  broker.setEventSink((_sessionId, nextEvents) => events.push(...nextEvents))

  const planDecision = await broker.handleClaudeSdkPermission('session-5', {
    toolName: 'Write',
    toolUseId: 'tool-plan-write',
    toolInput: { file_path: join(homedir(), '.claude', 'plans', 'sample-plan.md') }
  })

  assert.equal(planDecision.approved, true)
  assert.equal(events.length, 0)

  const escapedPlanWrite = broker.handleClaudeSdkPermission('session-5', {
    toolName: 'Write',
    toolUseId: 'tool-plan-escape',
    toolInput: { file_path: join(homedir(), '.claude', 'plans', '..', 'not-a-native-plan.md') }
  })

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(events.length, 1)
  assert.equal(broker.resolveSessionApproval('session-5', false, 'outside native plan directory'), true)
  const escapedDecision = await escapedPlanWrite
  assert.equal(escapedDecision.approved, false)
})
