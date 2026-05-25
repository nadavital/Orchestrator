import test from 'node:test'
import assert from 'node:assert/strict'
import { createTerminalServiceSnapshot } from '../terminalServiceSnapshot'

test('terminal service snapshot reports stable session status and counts', () => {
  const snapshot = createTerminalServiceSnapshot({
    shellIds: ['session-1-1'],
    startingIds: ['session-1-2'],
    buffers: new Map([
      ['session-1-1', 'Shell ready\n'],
      ['session-1-2', ''],
      ['session-1-3', 'command output\n'],
      ['session-1-4', 'closed\n']
    ]),
    workDirs: new Map([
      ['session-1-1', '/tmp/workspace'],
      ['session-1-2', '/tmp/workspace'],
      ['session-1-3', '/tmp/workspace'],
      ['session-1-4', '/tmp/workspace']
    ]),
    exitStates: new Map([
      ['session-1-4', { exitCode: 0, signal: null }]
    ])
  })

  assert.equal(snapshot.sessionCount, 4)
  assert.equal(snapshot.runningCount, 1)
  assert.equal(snapshot.startingCount, 1)
  assert.equal(snapshot.bufferedCount, 1)
  assert.equal(snapshot.exitedCount, 1)
  assert.equal(snapshot.totalBufferLength, 'Shell ready\ncommand output\nclosed\n'.length)
  assert.deepEqual(snapshot.sessions.map((session) => [session.terminalId, session.status]), [
    ['session-1-1', 'running'],
    ['session-1-2', 'starting'],
    ['session-1-3', 'buffered'],
    ['session-1-4', 'exited']
  ])
  assert.deepEqual(snapshot.sessions.find((session) => session.terminalId === 'session-1-4'), {
    terminalId: 'session-1-4',
    workDir: '/tmp/workspace',
    status: 'exited',
    bufferLength: 'closed\n'.length,
    hasBuffer: true,
    exitCode: 0,
    signal: null
  })
})
