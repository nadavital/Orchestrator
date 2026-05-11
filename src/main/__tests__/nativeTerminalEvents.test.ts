import test from 'node:test'
import assert from 'node:assert/strict'
import { parseClaudeTerminalSnapshot } from '../../types/nativeTerminalEvents'

test('parses Claude native terminal assistant text and returned prompt', () => {
  const raw = '\u001B]0;Claude Code\u0007\r⏺ORCHESTRATOR_RUNTIME_PARITY_OK\r✻ Cogitated for 2s\r❯\u00a0'
  const snapshot = parseClaudeTerminalSnapshot(raw)

  assert.equal(snapshot.assistantText, 'ORCHESTRATOR_RUNTIME_PARITY_OK')
  assert.equal(snapshot.completed, true)
})

test('does not mark Claude native terminal complete before assistant output', () => {
  const snapshot = parseClaudeTerminalSnapshot('❯ 1. Yes, I trust this folder')

  assert.equal(snapshot.assistantText, undefined)
  assert.equal(snapshot.completed, false)
})
