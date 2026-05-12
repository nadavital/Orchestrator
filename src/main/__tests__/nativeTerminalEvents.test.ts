import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeTerminalSnapshot, terminalSnapshotToRunEvents } from '../../types/nativeTerminalEvents'

test('parses Claude native terminal assistant text and returned prompt', () => {
  const raw = '\u001B]0;Claude Code\u0007\r⏺ORCHESTRATOR_RUNTIME_PARITY_OK\r✻ Cogitated for 2s\r❯\u00a0'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, 'ORCHESTRATOR_RUNTIME_PARITY_OK')
  assert.equal(snapshot.completed, true)
})

test('preserves multiline Claude native terminal assistant text without status chrome', () => {
  const raw = '\r⏺First line\rSecond line\r· Flambéing… (10s · ↓ 248 tokens · thought for 1s)\r✻ Cogitated for 2s\r? for shortcuts\r❯ '
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, 'First line\nSecond line')
  assert.equal(snapshot.completed, true)
})

test('does not mark Claude native terminal complete before assistant output', () => {
  const snapshot = parseClaudeTerminalSnapshot('❯ 1. Yes, I trust this folder')

  assert.equal(snapshot.assistantText, undefined)
  assert.equal(snapshot.completed, false)
})

test('does not treat Claude native tool status rows as assistant completion', () => {
  const raw = '❯ 1. Yes, I trust this folder\r⏺Write(created-by-claude.txt)\r1 ORCHESTRATOR_FILE_CREATE_OK\r2 ORCHESTRATOR_FILE_APPEND_OK\r❯\u00a0\r⏵⏵accept edits on\r86'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, undefined)
  assert.equal(snapshot.completed, false)
})

test('does not treat compact Claude native tool progress as assistant completion', () => {
  const raw = '⏺ Ling 1 directory… (ctrl+ to expand)\r⎿ $ ls /tmp/project\r✻ Gesticulating…\r❯'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, undefined)
  assert.equal(snapshot.completed, false)
})

test('does not treat corrupted Claude native tool status rows as assistant text', () => {
  const raw = '⏺Wrte(created-by-claude.txt)\r✶ Shimmying…\r❯'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, undefined)
  assert.equal(snapshot.completed, false)
})

test('does not treat Claude native tool output rows as assistant text', () => {
  const raw = '⏺\r⎿ Wrote 2 lines to created-by-claude.txt\r     1 ORCHESTRATOR_FILE_CREATE_OK\r2 ORCHESTRATOR_FILE_APPEND_OK\r❯'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, undefined)
  assert.equal(snapshot.completed, false)
})

test('filters Claude native status fragments from terminal fallback text', () => {
  const raw = '⏺·8\r3MCPserversfailed · /mcp\r⏺Doe\r↑\r↓80\r⏺RCHESTRATOR_FILE_OPS_OK\r❯'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, 'RCHESTRATOR_FILE_OPS_OK')
  assert.equal(snapshot.completed, true)
})

test('maps Claude native plan preview hint to a placeholder completion', () => {
  const raw = 'Updatd plan\r❯\u00a0\r⏺\r⎿ /plantopreview\r❯\u00a0'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, 'Plan updated in Claude Code. Run /plan to preview the full plan.')
  assert.equal(snapshot.completed, true)
})

test('streams Claude native terminal assistant deltas before completion', () => {
  const first = terminalSnapshotToRunEvents(
    { assistantText: 'Hello', completed: false },
    undefined,
    'native-terminal:test'
  )
  assert.deepEqual(first.events, [
    { type: 'assistant.text.delta', streamId: 'native-terminal:test', content: 'Hello' }
  ])

  const second = terminalSnapshotToRunEvents(
    { assistantText: 'Hello world', completed: true },
    first.state,
    'native-terminal:test'
  )
  assert.deepEqual(second.events, [
    { type: 'assistant.text.delta', streamId: 'native-terminal:test', content: ' world' },
    { type: 'assistant.text.completed', streamId: 'native-terminal:test' },
    { type: 'run.completed' }
  ])
})

test('does not duplicate Claude native terminal completion events on repaint', () => {
  const completed = terminalSnapshotToRunEvents(
    { assistantText: 'Done', completed: true },
    undefined,
    'native-terminal:test'
  )
  const repaint = terminalSnapshotToRunEvents(
    { assistantText: 'Done', completed: true },
    completed.state,
    'native-terminal:test'
  )

  assert.equal(repaint.events.length, 0)
})
