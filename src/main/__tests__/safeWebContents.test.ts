import test from 'node:test'
import assert from 'node:assert/strict'
import { canSendToWebContents, safeWebContentsSend, safeWindowSend } from '../safeWebContents'

function fakeContents(options: {
  destroyed?: boolean
  crashed?: boolean
  throwOnSend?: boolean
} = {}) {
  const sends: Array<{ channel: string; args: unknown[] }> = []
  return {
    sends,
    isDestroyed: () => options.destroyed === true,
    isCrashed: () => options.crashed === true,
    send: (channel: string, ...args: unknown[]) => {
      if (options.throwOnSend) throw new Error('renderer went away')
      sends.push({ channel, args })
    }
  }
}

test('safe webContents send skips destroyed and crashed renderers', () => {
  assert.equal(canSendToWebContents(fakeContents()), true)
  assert.equal(canSendToWebContents(fakeContents({ destroyed: true })), false)
  assert.equal(canSendToWebContents(fakeContents({ crashed: true })), false)
  assert.equal(safeWebContentsSend(fakeContents({ destroyed: true }), 'session:status'), false)
  assert.equal(safeWebContentsSend(fakeContents({ crashed: true }), 'session:status'), false)
})

test('safe webContents send catches send races and reports success for delivered sends', () => {
  const contents = fakeContents()
  assert.equal(safeWebContentsSend(contents, 'session:status', 's1', 'running'), true)
  assert.deepEqual(contents.sends, [{ channel: 'session:status', args: ['s1', 'running'] }])

  assert.equal(safeWebContentsSend(fakeContents({ throwOnSend: true }), 'session:status'), false)
})

test('safe window send skips destroyed windows before touching webContents', () => {
  const contents = fakeContents()
  assert.equal(safeWindowSend({ isDestroyed: () => true, webContents: contents }, 'pet:navigate'), false)
  assert.equal(contents.sends.length, 0)

  assert.equal(safeWindowSend({ isDestroyed: () => false, webContents: contents }, 'pet:navigate', 's1'), true)
  assert.deepEqual(contents.sends, [{ channel: 'pet:navigate', args: ['s1'] }])
})
