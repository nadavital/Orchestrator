import test from 'node:test'
import assert from 'node:assert/strict'
import {
  browserManagerPatchFromEvents,
  browserWebviewPartitionForHost,
  isOrchestratorBrowserWebviewPartition,
  type RunEvent
} from '../../types'

test('browser manager state events merge into a workbench patch', () => {
  const events: RunEvent[] = [
    { type: 'assistant.status', content: 'navigating' },
    {
      type: 'browser.manager_state',
      active: true,
      turnId: 'turn-123',
      viewportSize: { width: 390.2, height: 843.8 },
      captureSurfaceSize: { width: 800, height: 600 },
      captureBounds: { x: 12.2, y: 34.6, width: 800.4, height: 600.3, scale: 0.752 },
      cursorState: { visible: true, x: 42, y: 84, animateMovement: true, moveSequence: 7 },
      localServerRoutes: [
        { serverUrl: 'http://127.0.0.1:5173/', url: 'http://127.0.0.1:5173/dashboard?tab=1#hash', title: 'Dashboard', source: 'provider' },
        { serverUrl: 'https://example.com/', url: 'https://example.com/nope', title: 'External', source: 'provider' }
      ],
      hiddenLocalServerRoutes: ['http://127.0.0.1:5173/hidden#fragment']
    }
  ]

  assert.deepEqual(browserManagerPatchFromEvents(events), {
    shouldOpenBrowser: true,
    browserUseActive: true,
    browserUseTurnId: 'turn-123',
    browserUseViewportSize: { width: 390, height: 844 },
    browserUseCaptureSurfaceSize: { width: 800, height: 600 },
    browserUseCaptureBounds: { x: 12, y: 35, width: 800, height: 600, scale: 0.752 },
    browserUseCursorState: { visible: true, x: 42, y: 84, animateMovement: true, moveSequence: 7 },
    localServerRoutes: [
      { serverUrl: 'http://127.0.0.1:5173/', url: 'http://127.0.0.1:5173/dashboard?tab=1', title: 'Dashboard', source: 'provider' }
    ],
    hiddenLocalServerRoutes: ['http://127.0.0.1:5173/hidden']
  })
})

test('browser manager state events can update without opening Browser', () => {
  const events: RunEvent[] = [
    {
      type: 'browser.manager_state',
      open: false,
      active: false,
      turnId: null,
      viewportSize: null,
      captureSurfaceSize: null,
      captureBounds: null,
      cursorState: null,
      localServerRoutes: null,
      hiddenLocalServerRoutes: null
    }
  ]

  assert.deepEqual(browserManagerPatchFromEvents(events), {
    browserUseActive: false,
    browserUseTurnId: null,
    browserUseViewportSize: null,
    browserUseCaptureSurfaceSize: null,
    browserUseCaptureBounds: null,
    browserUseCursorState: null,
    localServerRoutes: [],
    hiddenLocalServerRoutes: []
  })
})

test('browser manager state local routes normalize bind addresses and reject remote hosts', () => {
  const events: RunEvent[] = [
    {
      type: 'browser.manager_state',
      localServerRoutes: [
        { serverUrl: 'http://0.0.0.0:5173/', url: 'http://0.0.0.0:5173/preview#hash', title: 'Preview', source: 'provider' },
        { serverUrl: 'http://[::1]:6173/', url: 'http://[::1]:6173/ipad?view=1#hash', title: 'IPv6 Preview', source: 'provider' },
        { serverUrl: 'http://192.168.1.20:5173/', url: 'http://192.168.1.20:5173/nope', title: 'Remote', source: 'provider' }
      ],
      hiddenLocalServerRoutes: [
        'http://0.0.0.0:5173/hidden#fragment',
        'http://192.168.1.20:5173/hidden'
      ]
    }
  ]

  assert.deepEqual(browserManagerPatchFromEvents(events), {
    shouldOpenBrowser: true,
    localServerRoutes: [
      { serverUrl: 'http://127.0.0.1:5173/', url: 'http://127.0.0.1:5173/preview', title: 'Preview', source: 'provider' },
      { serverUrl: 'http://[::1]:6173/', url: 'http://[::1]:6173/ipad?view=1', title: 'IPv6 Preview', source: 'provider' }
    ],
    hiddenLocalServerRoutes: ['http://127.0.0.1:5173/hidden']
  })
})

test('browser manager reducer ignores non-browser events', () => {
  const events: RunEvent[] = [
    { type: 'assistant.text', content: 'done' },
    { type: 'run.completed' }
  ]

  assert.equal(browserManagerPatchFromEvents(events), null)
})

test('browser webview partitions are scoped to host ids', () => {
  assert.equal(browserWebviewPartitionForHost('right:session-1:browser'), 'persist:orchestrator-side-browser:right%3Asession-1%3Abrowser')
  assert.equal(browserWebviewPartitionForHost(''), 'persist:orchestrator-side-browser')
  assert.equal(isOrchestratorBrowserWebviewPartition('persist:orchestrator-side-browser:right%3Asession-1%3Abrowser'), true)
  assert.equal(isOrchestratorBrowserWebviewPartition('persist:codex-browser-app-route:session-1'), false)
})
