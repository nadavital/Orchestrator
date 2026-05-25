import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseOrchestratorDeepLink,
  parseSettingsRouteLocation,
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
