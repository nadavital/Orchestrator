import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseOrchestratorDeepLink,
  parseSessionRouteLocation,
  parseSettingsRouteLocation,
  sessionRouteHash,
  sessionRoutePath,
  sessionRouteUrlForLocation,
  settingsDeepLinkUrl,
  settingsRouteExitUrl,
  settingsRouteHash,
  settingsRoutePath,
  settingsRouteUrlForLocation
} from '../../types'

test('settings routes prefer app paths for http/custom renderers and hash fallback for file renderers', () => {
  assert.equal(settingsRouteUrlForLocation('providers', 'codex:remote-mac', { protocol: 'http:' }), '/settings/providers?host=codex%3Aremote-mac')
  assert.equal(settingsRouteUrlForLocation('providers', 'codex:remote-mac', { protocol: 'orchestrator-app:' }), '/settings/providers?host=codex%3Aremote-mac')
  assert.equal(settingsRouteUrlForLocation('providers', 'codex:remote-mac', { protocol: 'file:' }), '#/settings/providers?host=codex%3Aremote-mac')
  assert.equal(settingsRoutePath('general', 'local'), '/settings/general')
  assert.equal(settingsRouteHash('general', null), '#/settings/general')
})

test('settings routes parse path and hash forms with section fallback', () => {
  assert.deepEqual(parseSettingsRouteLocation({
    protocol: 'http:',
    pathname: '/settings/shortcuts',
    search: '?host=codex%3Aremote-mac',
    hash: ''
  }), {
    section: 'shortcuts',
    hostId: 'codex:remote-mac',
    mode: 'path'
  })

  assert.deepEqual(parseSettingsRouteLocation({
    protocol: 'orchestrator-app:',
    pathname: '/settings/providers',
    search: '?host=codex%3Aremote-mac',
    hash: ''
  }), {
    section: 'providers',
    hostId: 'codex:remote-mac',
    mode: 'path'
  })

  assert.deepEqual(parseSettingsRouteLocation({
    protocol: 'file:',
    pathname: '/Users/example/Orchestrator.app/index.html',
    search: '',
    hash: '#/settings/nope?host=cursor%3Aremote-linux'
  }), {
    section: 'general',
    hostId: 'cursor:remote-linux',
    mode: 'hash'
  })

  assert.equal(parseSettingsRouteLocation({ pathname: '/', search: '', hash: '#/' }), null)
  assert.equal(settingsRouteExitUrl('path'), '/')
  assert.equal(settingsRouteExitUrl('hash'), '#/')
})

test('session routes prefer app paths and parse path and hash forms', () => {
  assert.equal(sessionRouteUrlForLocation('session 123', { protocol: 'orchestrator-app:' }), '/threads/session%20123')
  assert.equal(sessionRouteUrlForLocation('session 123', { protocol: 'file:' }), '#/threads/session%20123')
  assert.equal(sessionRoutePath('session-123'), '/threads/session-123')
  assert.equal(sessionRouteHash('session-123'), '#/threads/session-123')
  assert.deepEqual(parseSessionRouteLocation({
    protocol: 'orchestrator-app:',
    pathname: '/threads/session-123',
    search: '',
    hash: ''
  }), {
    sessionId: 'session-123',
    mode: 'path'
  })
  assert.deepEqual(parseSessionRouteLocation({
    protocol: 'file:',
    pathname: '/index.html',
    search: '',
    hash: '#/sessions/session%20123'
  }), {
    sessionId: 'session 123',
    mode: 'hash'
  })
  assert.equal(parseSessionRouteLocation({ pathname: '/', hash: '#/' }), null)
})

test('orchestrator deep links route settings and sessions through the app protocol', () => {
  assert.equal(settingsDeepLinkUrl('providers', 'codex:remote-mac'), 'orchestrator://settings/providers?host=codex%3Aremote-mac')
  assert.deepEqual(parseOrchestratorDeepLink('orchestrator://settings/providers?host=codex%3Aremote-mac'), {
    kind: 'settings',
    section: 'providers',
    hostId: 'codex:remote-mac'
  })
  assert.deepEqual(parseOrchestratorDeepLink('orchestrator://settings/not-real'), {
    kind: 'settings',
    section: 'general',
    hostId: null
  })
  assert.deepEqual(parseOrchestratorDeepLink('orchestrator://threads/session-123'), {
    kind: 'session',
    sessionId: 'session-123'
  })
  assert.equal(parseOrchestratorDeepLink('https://settings/providers'), null)
})
