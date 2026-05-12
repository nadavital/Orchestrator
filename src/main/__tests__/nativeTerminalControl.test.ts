import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeTerminalControlResponses } from '../../types/nativeTerminalControl'

test('responds to Claude native terminal startup capability queries', () => {
  assert.deepEqual(
    nativeTerminalControlResponses('\x1b[>0q\x1b[c\x1b[?2026$p'),
    ['\x1bP>|XTerm(379)\x1b\\', '\x1b[?1;2c', '\x1b[?2026;0$y']
  )
})

test('does not emit terminal responses for normal assistant text', () => {
  assert.deepEqual(nativeTerminalControlResponses('hello from claude'), [])
})
