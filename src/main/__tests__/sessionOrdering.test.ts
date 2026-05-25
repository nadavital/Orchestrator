import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCodexThreadListMetadata, applyProviderPinnedThreadState, codexThreadListItems, comparePinnedSessions, compareSidebarSessions, ensurePinnedSessionOrders, isSidebarPinnedSession, isSidebarProjectlessSession, moveSessionToSidebarCustomSection, moveSidebarSectionKey, nextPinOrder, normalizeProviderPinnedThreadKey, normalizeSettingsHostId, normalizeSettingsSectionForHostKind, orderProjectlessSidebarGroups, providerPinnedThreadKeyForSession, reorderPinnedSessions, settingsHostAdapterState, settingsHostOptionsFromSessions, settingsNavigationGroupsForHostKind, settingsSectionScope, sidebarConnectionGroupIdentity, sidebarThreadKind } from '../../types'
import type { PinOrderedSession, ProviderThreadMetadataSession } from '../../types'

test('pin order migration preserves the previous visible recency order once', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'older', pinned: true, createdAt: 10, latestMessageAt: 100 },
    { id: 'recent', pinned: true, createdAt: 20, latestMessageAt: 500 },
    { id: 'newest-unpinned', pinned: false, createdAt: 30, latestMessageAt: 1000 }
  ]

  ensurePinnedSessionOrders(sessions)

  assert.equal(sessions.find((session) => session.id === 'recent')?.pinOrder, 1)
  assert.equal(sessions.find((session) => session.id === 'older')?.pinOrder, 2)
  assert.equal(sessions.find((session) => session.id === 'newest-unpinned')?.pinOrder, undefined)
})

test('newly pinned sessions append after existing pinned sessions', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'second', pinned: true, pinOrder: 2, createdAt: 20, latestMessageAt: 20 },
    { id: 'candidate', pinned: false, createdAt: 30, latestMessageAt: 3000 }
  ]

  const candidate = sessions.find((session) => session.id === 'candidate')
  assert.ok(candidate)
  candidate.pinned = true
  candidate.pinOrder = nextPinOrder(sessions)

  assert.deepEqual(
    sessions.filter((session) => session.pinned).sort(comparePinnedSessions).map((session) => session.id),
    ['first', 'second', 'candidate']
  )
})

test('message recency does not reorder pinned sessions after pinOrder exists', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'second', pinned: true, pinOrder: 2, createdAt: 20, latestMessageAt: 2000 }
  ]

  sessions[0].latestMessageAt = 9000

  assert.deepEqual(
    [...sessions].sort(comparePinnedSessions).map((session) => session.id),
    ['first', 'second']
  )
})

test('unpinning clears pin order and excludes the session from pinned sort', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'removed', pinned: true, pinOrder: 2, createdAt: 20, latestMessageAt: 20 }
  ]

  const removed = sessions.find((session) => session.id === 'removed')
  assert.ok(removed)
  removed.pinned = false
  removed.pinOrder = undefined

  assert.deepEqual(
    sessions.filter((session) => session.pinned).sort(comparePinnedSessions).map((session) => session.id),
    ['first']
  )
  assert.equal(removed.pinOrder, undefined)
})

test('provider pinned sessions merge with local pinned ordering', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'local-first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'provider-second', providerPinned: true, providerPinOrder: 2, providerPinnedThreadKey: 'remote:task-2', createdAt: 20, latestMessageAt: 2000 },
    { id: 'local-third', pinned: true, pinOrder: 3, createdAt: 30, latestMessageAt: 3000 },
    { id: 'ordinary', pinned: false, createdAt: 40, latestMessageAt: 4000 }
  ]

  assert.equal(isSidebarPinnedSession(sessions[1]), true)
  assert.equal(isSidebarPinnedSession(sessions[3]), false)
  assert.equal(nextPinOrder(sessions), 4)
  assert.deepEqual(
    sessions.filter(isSidebarPinnedSession).sort(comparePinnedSessions).map((session) => session.id),
    ['local-first', 'provider-second', 'local-third']
  )
})

test('pinned sessions reorder through explicit sidebar order', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'first', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'provider-second', providerPinned: true, providerPinOrder: 2, providerPinnedThreadKey: 'remote:task-2', createdAt: 20, latestMessageAt: 20 },
    { id: 'third', pinned: true, pinOrder: 3, createdAt: 30, latestMessageAt: 30 },
    { id: 'ordinary', pinned: false, createdAt: 40, latestMessageAt: 40 }
  ]

  const next = reorderPinnedSessions(sessions, ['third', 'first'])

  assert.deepEqual(
    next.filter(isSidebarPinnedSession).sort(comparePinnedSessions).map((session) => session.id),
    ['third', 'first', 'provider-second']
  )
  assert.deepEqual(
    next.map((session) => [session.id, session.pinned, session.pinOrder]),
    [
      ['first', true, 2],
      ['provider-second', true, 3],
      ['third', true, 1],
      ['ordinary', false, undefined]
    ]
  )
  assert.equal(next.find((session) => session.id === 'provider-second')?.providerPinnedThreadKey, 'remote:task-2')
})

test('provider pinned thread keys normalize Codex local remote and pending worktree ids', () => {
  assert.equal(normalizeProviderPinnedThreadKey('remote:codex:task-2', 'codex'), 'remote:task-2')
  assert.equal(normalizeProviderPinnedThreadKey('remote:task-2', 'codex'), 'remote:task-2')
  assert.equal(normalizeProviderPinnedThreadKey('local:session-1', 'codex'), 'local:session-1')
  assert.equal(normalizeProviderPinnedThreadKey('pending-worktree:pending-1', 'codex'), 'pending-worktree:pending-1')
  assert.equal(normalizeProviderPinnedThreadKey('unknown:task-2', 'codex'), null)

  assert.equal(providerPinnedThreadKeyForSession({
    id: 'local-session'
  }), 'local:local-session')
  assert.equal(providerPinnedThreadKeyForSession({
    id: 'remote-session',
    providerSessionId: 'task-2'
  }), 'remote:task-2')
  assert.equal(providerPinnedThreadKeyForSession({
    id: 'pending-session',
    providerSessionId: 'task-3',
    useWorktree: true,
    worktreeState: 'pending'
  }), 'pending-worktree:task-3')
})

test('provider pinned thread state applies ordered Codex-style keys without touching local pins', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'local-first', provider: 'codex', pinned: true, pinOrder: 1, createdAt: 10, latestMessageAt: 10 },
    { id: 'remote-second', provider: 'codex', providerSessionId: 'task-2', createdAt: 20, latestMessageAt: 20 },
    { id: 'pending-third', provider: 'codex', providerSessionId: 'task-3', useWorktree: true, worktreeState: 'pending', createdAt: 30, latestMessageAt: 30 },
    { id: 'claude-remote', provider: 'claude', providerSessionId: 'task-2', providerPinned: true, providerPinOrder: 9, providerPinnedThreadKey: 'remote:task-2', createdAt: 40, latestMessageAt: 40 },
    { id: 'stale-codex', provider: 'codex', providerSessionId: 'stale-task', providerPinned: true, providerPinOrder: 7, providerPinnedThreadKey: 'remote:stale-task', createdAt: 50, latestMessageAt: 50 }
  ]

  const next = applyProviderPinnedThreadState(sessions, {
    providerId: 'codex',
    threadKeys: ['remote:task-2', 'pending-worktree:task-3', 'remote:codex:task-2']
  })

  assert.deepEqual(
    next.filter(isSidebarPinnedSession).sort(comparePinnedSessions).map((session) => session.id),
    ['remote-second', 'local-first', 'pending-third', 'claude-remote']
  )
  assert.deepEqual(next.find((session) => session.id === 'remote-second'), {
    id: 'remote-second',
    provider: 'codex',
    providerSessionId: 'task-2',
    createdAt: 20,
    latestMessageAt: 20,
    providerPinned: true,
    providerPinOrder: 1,
    providerPinnedThreadKey: 'remote:task-2'
  })
  assert.equal(next.find((session) => session.id === 'pending-third')?.providerPinnedThreadKey, 'pending-worktree:task-3')
  assert.equal(next.find((session) => session.id === 'stale-codex')?.providerPinned, false)
  assert.equal(next.find((session) => session.id === 'stale-codex')?.providerPinOrder, undefined)
  assert.equal(next.find((session) => session.id === 'claude-remote')?.providerPinned, true)
})

test('codex app-server thread list metadata projects onto matching provider sessions', () => {
  const sessions: ProviderThreadMetadataSession[] = [
    { id: 'local-session', provider: 'codex', providerSessionId: 'thread-local', createdAt: 10, latestMessageAt: 10 },
    { id: 'cloud-session', provider: 'codex', providerSessionId: 'thread-cloud', createdAt: 20, latestMessageAt: 20 },
    { id: 'host-session', provider: 'codex', providerSessionId: 'thread-host', createdAt: 30, latestMessageAt: 30 },
    { id: 'worktree-session', provider: 'codex', providerSessionId: 'thread-worktree', createdAt: 40, latestMessageAt: 40 },
    { id: 'projectless-session', provider: 'codex', providerSessionId: 'thread-projectless', createdAt: 50, latestMessageAt: 50 },
    { id: 'claude-session', provider: 'claude', providerSessionId: 'thread-cloud', createdAt: 60, latestMessageAt: 60 }
  ]

  const result = {
    data: [
      { id: 'thread-local', source: 'vscode', preview: 'Local Codex preview', updatedAt: 1779638273 },
      { id: 'thread-cloud', threadSource: 'cloud', preview: 'Cloud Codex preview', updatedAt: 1779638274000 },
      { id: 'thread-host', threadSource: 'remote-host', hostId: 'remote-mac', hostLabel: 'Remote Mac' },
      { id: 'thread-worktree', threadSource: 'worktree', worktreeRoot: '/tmp/worktree', worktreeSourceRoot: '/repo', worktreeHostId: 'remote-linux', worktreeHostLabel: 'Remote Linux' },
      { id: 'thread-projectless', projectless: true, cwd: '/' },
      { id: 'unmatched-thread', threadSource: 'cloud' }
    ]
  }

  const next = applyCodexThreadListMetadata(sessions, result)

  assert.equal(codexThreadListItems(result).length, 6)
  assert.equal(next.find((session) => session.id === 'local-session')?.previewText, 'Local Codex preview')
  assert.equal(next.find((session) => session.id === 'local-session')?.latestMessageAt, 1779638273000)
  assert.equal(next.find((session) => session.id === 'local-session')?.providerThreadSource, 'local')
  assert.equal(next.find((session) => session.id === 'cloud-session')?.providerThreadSource, 'cloud')
  assert.equal(next.find((session) => session.id === 'cloud-session')?.latestMessageAt, 1779638274000)
  assert.equal(next.find((session) => session.id === 'host-session')?.providerThreadSource, 'remote-host')
  assert.equal(next.find((session) => session.id === 'host-session')?.providerHostId, 'remote-mac')
  assert.equal(next.find((session) => session.id === 'host-session')?.providerHostLabel, 'Remote Mac')
  assert.equal(next.find((session) => session.id === 'worktree-session')?.providerThreadSource, 'worktree')
  assert.equal(next.find((session) => session.id === 'worktree-session')?.providerWorktreeRoot, '/tmp/worktree')
  assert.equal(next.find((session) => session.id === 'worktree-session')?.providerWorktreeSourceRoot, '/repo')
  assert.equal(next.find((session) => session.id === 'worktree-session')?.providerWorktreeHostId, 'remote-linux')
  assert.equal(next.find((session) => session.id === 'projectless-session')?.providerProjectless, true)
  assert.equal(next.find((session) => session.id === 'projectless-session')?.providerProjectlessThreadId, 'thread-projectless')
  assert.equal(next.find((session) => session.id === 'claude-session')?.providerThreadSource, undefined)
})

test('codex sidebar metadata accepts items and nested conversation task worktree records', () => {
  const sessions: ProviderThreadMetadataSession[] = [
    { id: 'local-nested', provider: 'codex', providerSessionId: 'conversation-local', createdAt: 10 },
    { id: 'cloud-nested', provider: 'codex', providerSessionId: 'task-cloud', createdAt: 20 },
    { id: 'pending-nested', provider: 'codex', providerSessionId: 'pending-worktree-1', createdAt: 30 },
    { id: 'hosted-conversation', provider: 'codex', providerSessionId: 'conversation-hosted', createdAt: 40 }
  ]

  const result = {
    items: [
      {
        kind: 'local',
        conversation: {
          id: 'conversation-local',
          cwd: '/',
          workspaceKind: 'projectless',
          title: 'Nested local title',
          updated_at: '2026-05-24T20:00:00.000Z'
        }
      },
      {
        kind: 'remote',
        task: {
          id: 'task-cloud',
          title: 'Nested cloud title',
          updated_at: 1779638275,
          task_status_display: {
            environment_label: 'Cloud run'
          }
        }
      },
      {
        kind: 'pending-worktree',
        pendingWorktree: {
          id: 'pending-worktree-1',
          hostId: 'remote-mac',
          sourceWorkspaceRoot: '/repo',
          worktreeWorkspaceRoot: '/repo-worktree'
        }
      },
      {
        conversation: {
          id: 'conversation-hosted',
          hostId: 'remote-linux',
          hostLabel: 'Remote Linux',
          cwd: '/srv/project'
        }
      }
    ]
  }

  const next = applyCodexThreadListMetadata(sessions, result)

  assert.equal(codexThreadListItems(result).length, 4)
  assert.equal(next.find((session) => session.id === 'local-nested')?.providerThreadSource, 'local')
  assert.equal(next.find((session) => session.id === 'local-nested')?.providerProjectless, true)
  assert.equal(next.find((session) => session.id === 'local-nested')?.providerProjectlessThreadId, 'conversation-local')
  assert.equal(next.find((session) => session.id === 'local-nested')?.previewText, 'Nested local title')
  assert.equal(next.find((session) => session.id === 'local-nested')?.latestMessageAt, Date.parse('2026-05-24T20:00:00.000Z'))
  assert.equal(next.find((session) => session.id === 'cloud-nested')?.providerThreadSource, 'cloud')
  assert.equal(next.find((session) => session.id === 'cloud-nested')?.previewText, 'Nested cloud title')
  assert.equal(next.find((session) => session.id === 'cloud-nested')?.latestMessageAt, 1779638275000)
  assert.equal(next.find((session) => session.id === 'pending-nested')?.providerThreadSource, 'worktree')
  assert.equal(next.find((session) => session.id === 'pending-nested')?.providerWorktreeHostId, 'remote-mac')
  assert.equal(next.find((session) => session.id === 'pending-nested')?.providerWorktreeSourceRoot, '/repo')
  assert.equal(next.find((session) => session.id === 'pending-nested')?.providerWorktreeRoot, '/repo-worktree')
  assert.equal(next.find((session) => session.id === 'hosted-conversation')?.providerThreadSource, 'remote-host')
  assert.equal(next.find((session) => session.id === 'hosted-conversation')?.providerHostId, 'remote-linux')
  assert.equal(next.find((session) => session.id === 'hosted-conversation')?.providerHostLabel, 'Remote Linux')
})

test('sidebar ordering keeps the active blank chat above recently updated inactive chats', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'recent-inactive', createdAt: 100, latestMessageAt: 1000, status: 'idle', messageCount: 8 },
    { id: 'blank-active', createdAt: 900, latestMessageAt: 900, status: 'idle', messageCount: 0 },
    { id: 'older-inactive', createdAt: 50, latestMessageAt: 50, status: 'idle', messageCount: 2 }
  ]

  assert.deepEqual(
    [...sessions].sort((a, b) => compareSidebarSessions(a, b, { sortMode: 'updated', activeSessionId: 'blank-active' })).map((session) => session.id),
    ['blank-active', 'recent-inactive', 'older-inactive']
  )
})

test('sidebar ordering keeps live chats stable above inactive chats', () => {
  const sessions: PinOrderedSession[] = [
    { id: 'inactive-newest', createdAt: 300, latestMessageAt: 3000, status: 'idle', messageCount: 6 },
    { id: 'live-older', createdAt: 100, latestMessageAt: 9000, status: 'running', messageCount: 4 },
    { id: 'waiting-newer', createdAt: 200, latestMessageAt: 250, status: 'waiting_for_permission', messageCount: 3 }
  ]

  const sorted = [...sessions].sort((a, b) => compareSidebarSessions(a, b, { sortMode: 'updated', activeSessionId: null }))

  sorted[1].latestMessageAt = 10_000

  assert.deepEqual(
    [...sorted].sort((a, b) => compareSidebarSessions(a, b, { sortMode: 'updated', activeSessionId: null })).map((session) => session.id),
    ['waiting-newer', 'live-older', 'inactive-newest']
  )
})

test('sidebar thread identity classifies local remote worktree and pending worktree sessions', () => {
  const base = { provider: 'codex', providerSessionId: null, status: 'idle' as const, useWorktree: false }

  assert.equal(sidebarThreadKind(base), 'local')
  assert.equal(sidebarThreadKind({ ...base, providerSessionId: 'remote-thread' }), 'remote')
  assert.equal(sidebarThreadKind({ ...base, useWorktree: true }), 'worktree')
  assert.equal(sidebarThreadKind({ ...base, useWorktree: true, status: 'reconnecting' }), 'pending-worktree')
  assert.equal(sidebarThreadKind({ ...base, useWorktree: true, worktreeState: 'pending' }), 'pending-worktree')
  assert.equal(sidebarThreadKind({ ...base, useWorktree: true, worktreeState: 'failed' }), 'pending-worktree')
  assert.equal(sidebarThreadKind({ ...base, useWorktree: true, worktreeState: 'ready' }), 'worktree')
})

test('sidebar connection group identity stays provider-aware and ordered', () => {
  assert.deepEqual(sidebarConnectionGroupIdentity({
    provider: 'claude',
    providerSessionId: null,
    status: 'idle',
    useWorktree: false
  }), {
    key: 'local:claude',
    kind: 'local',
    providerId: 'claude',
    label: 'Claude Code local',
    threadKind: 'local',
    order: 10
  })

  assert.deepEqual(sidebarConnectionGroupIdentity({
    provider: 'codex',
    providerSessionId: 'cloud-task',
    status: 'idle',
    useWorktree: false,
    providerThreadSource: 'cloud'
  }), {
    key: 'cloud:codex',
    kind: 'cloud',
    providerId: 'codex',
    label: 'Codex CLI cloud',
    threadKind: 'remote',
    order: 20
  })

  assert.deepEqual(sidebarConnectionGroupIdentity({
    provider: 'codex',
    providerSessionId: 'remote-host-thread',
    status: 'idle',
    useWorktree: false,
    providerHostId: 'remote-mac',
    providerHostLabel: 'Remote Mac'
  }), {
    key: 'host:codex:remote-mac',
    kind: 'remote',
    providerId: 'codex',
    label: 'Remote Mac',
    threadKind: 'remote',
    order: 25
  })

  assert.equal(sidebarConnectionGroupIdentity({
    provider: 'cursor',
    providerSessionId: null,
    status: 'reconnecting',
    useWorktree: true
  }).key, 'pending-worktree:cursor')

  assert.deepEqual(sidebarConnectionGroupIdentity({
    provider: 'codex',
    providerSessionId: null,
    status: 'idle',
    useWorktree: true,
    providerWorktreeHostId: 'remote-mac',
    providerWorktreeHostLabel: 'Remote Mac'
  }), {
    key: 'worktree:codex:remote-mac',
    kind: 'worktree',
    providerId: 'codex',
    label: 'Remote Mac worktrees',
    threadKind: 'worktree',
    order: 30
  })

  assert.equal(sidebarConnectionGroupIdentity({
    provider: 'codex',
    providerSessionId: null,
    status: 'reconnecting',
    useWorktree: true,
    providerWorktreeHostId: 'remote-mac',
    providerWorktreeHostLabel: 'Remote Mac'
  }).key, 'pending-worktree:codex:remote-mac')
})

test('settings host options derive provider remote hosts from sessions', () => {
  const hosts = settingsHostOptionsFromSessions([
    {
      provider: 'claude',
      providerHostId: null,
      providerHostLabel: null,
      providerWorktreeHostId: null,
      providerWorktreeHostLabel: null
    },
    {
      provider: 'codex',
      providerHostId: 'remote-mac',
      providerHostLabel: 'Remote Mac',
      providerWorktreeHostId: null,
      providerWorktreeHostLabel: null
    },
    {
      provider: 'codex',
      providerHostId: null,
      providerHostLabel: null,
      providerWorktreeHostId: 'remote-mac',
      providerWorktreeHostLabel: 'Remote Mac'
    },
    {
      provider: 'cursor',
      providerHostId: null,
      providerHostLabel: null,
      providerWorktreeHostId: 'remote-linux',
      providerWorktreeHostLabel: null
    }
  ])

  assert.deepEqual(hosts.map((host) => host.id), ['local', 'cursor:remote-linux', 'codex:remote-mac'])
  assert.deepEqual(hosts.map((host) => host.label), ['Local', 'Cursor remote-linux', 'Remote Mac'])
  assert.equal(normalizeSettingsHostId('cursor:remote-linux', hosts), 'cursor:remote-linux')
  assert.equal(normalizeSettingsHostId('missing-host', hosts), 'local')
})

test('settings navigation filters local-only sections for remote hosts', () => {
  const localGroups = settingsNavigationGroupsForHostKind('local')
  const remoteGroups = settingsNavigationGroupsForHostKind('remote')
  const localSections = localGroups.flatMap((group) => group.sections)
  const remoteSections = remoteGroups.flatMap((group) => group.sections)

  assert.deepEqual(localGroups.map((group) => group.id), ['app', 'host'])
  assert.equal(localSections.includes('automations'), true)
  assert.equal(localSections.includes('worktrees'), true)
  assert.equal(localSections.includes('data'), true)
  assert.deepEqual(remoteGroups.map((group) => group.id), ['app', 'host'])
  assert.equal(remoteSections.includes('automations'), false)
  assert.equal(remoteSections.includes('worktrees'), false)
  assert.equal(remoteSections.includes('data'), false)
  assert.equal(remoteSections.includes('shortcuts'), true)
  assert.equal(remoteSections.includes('personalization'), true)
  assert.equal(remoteSections.includes('pets'), true)
  assert.equal(normalizeSettingsSectionForHostKind('worktrees', 'remote'), 'general')
  assert.equal(normalizeSettingsSectionForHostKind('shortcuts', 'remote'), 'shortcuts')
  assert.equal(settingsSectionScope('general'), 'app')
  assert.equal(settingsSectionScope('personalization'), 'host')
  assert.equal(settingsSectionScope('pets'), 'app')
  assert.equal(settingsHostAdapterState('general', 'remote'), 'app-global')
  assert.equal(settingsHostAdapterState('pets', 'remote'), 'app-global')
  assert.equal(settingsHostAdapterState('shortcuts', 'remote'), 'unavailable')
  assert.equal(settingsHostAdapterState('personalization', 'remote'), 'unavailable')
  assert.equal(settingsHostAdapterState('personalization', 'local'), 'unavailable')
  assert.equal(settingsHostAdapterState('pets', 'local'), 'local')
})

test('sidebar projectless identity catches missing stale and provider projectless assignments', () => {
  const knownProjects = new Set(['project-a', 'project-b'])

  assert.equal(isSidebarProjectlessSession({ projectId: 'project-a' }, knownProjects), false)
  assert.equal(isSidebarProjectlessSession({ projectId: 'missing-project' }, knownProjects), true)
  assert.equal(isSidebarProjectlessSession({ projectId: '' }, knownProjects), true)
  assert.equal(isSidebarProjectlessSession({ projectId: 'missing-project' }), false)
  assert.equal(isSidebarProjectlessSession({ projectId: 'project-a', providerProjectless: true }, knownProjects), true)
  assert.equal(isSidebarProjectlessSession({ projectId: 'project-a', providerProjectlessThreadId: 'remote-thread' }, knownProjects), true)
})

test('sidebar projectless Chats placement follows the persisted chats-first preference', () => {
  assert.deepEqual(
    orderProjectlessSidebarGroups(['chats'], ['alpha', 'beta'], true),
    [
      { kind: 'projectless', item: 'chats' },
      { kind: 'project', item: 'alpha' },
      { kind: 'project', item: 'beta' }
    ]
  )

  assert.deepEqual(
    orderProjectlessSidebarGroups(['chats'], ['alpha', 'beta'], false),
    [
      { kind: 'project', item: 'alpha' },
      { kind: 'project', item: 'beta' },
      { kind: 'projectless', item: 'chats' }
    ]
  )
})

test('sidebar custom section membership moves a chat exclusively and preserves drop order', () => {
  const sections = [
    { id: 'triage', sessionIds: ['alpha', 'beta'] },
    { id: 'focus', sessionIds: ['gamma'] }
  ]

  assert.deepEqual(
    moveSessionToSidebarCustomSection(sections, 'focus', 'beta'),
    [
      { id: 'triage', sessionIds: ['alpha'] },
      { id: 'focus', sessionIds: ['gamma', 'beta'] }
    ]
  )

  assert.deepEqual(
    moveSessionToSidebarCustomSection(sections, 'focus', 'alpha', 'gamma'),
    [
      { id: 'triage', sessionIds: ['beta'] },
      { id: 'focus', sessionIds: ['alpha', 'gamma'] }
    ]
  )
})

test('sidebar section order moves custom sections before a target section', () => {
  assert.deepEqual(
    moveSidebarSectionKey(['pinned', 'custom:focus', 'custom:later', 'projects'], 'custom:later', 'custom:focus'),
    ['pinned', 'custom:later', 'custom:focus', 'projects']
  )

  assert.deepEqual(
    moveSidebarSectionKey(['pinned', 'custom:focus', 'projects'], 'custom:focus', null),
    ['pinned', 'projects', 'custom:focus']
  )
})
