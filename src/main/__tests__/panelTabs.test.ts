import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOTTOM_PANEL_TRANSFER_TAB_KINDS,
  bottomPanelTransferPolicyLabel,
  canCloseBottomPanelTab,
  closePanelTab,
  filePanelTabId,
  isBottomPanelTransferTabKind,
  movePanelTabByDirection,
  parseFilePanelTabId,
  pinPanelTab,
  reorderPanelTab,
  resolvePanelBrowserCommandTarget,
  resolvePanelCloseTarget,
  resolvePanelFindTarget,
  resolvePanelNewTabTarget,
  resolvePanelTabTransferAvailability,
  resetPanelTabSet,
  transferPanelTab,
  upsertPanelTab
} from '../../types/panelTabs'

test('file panel tab ids include host and decode legacy path-only ids', () => {
  const id = filePanelTabId('/Users/nadav/Desktop/Orchestrator', 'Nested Folder/nested note.md')

  assert.equal(id, 'file:%2FUsers%2Fnadav%2FDesktop%2FOrchestrator:Nested%20Folder%2Fnested%20note.md')
  assert.deepEqual(parseFilePanelTabId(id), {
    host: '/Users/nadav/Desktop/Orchestrator',
    filePath: 'Nested Folder/nested note.md'
  })
  assert.deepEqual(parseFilePanelTabId('file:Nested%20Folder%2Fnested%20note.md'), {
    host: 'workspace',
    filePath: 'Nested Folder/nested note.md'
  })
  assert.equal(parseFilePanelTabId('browser'), null)
})

test('panel tabs replace an unpinned preview tab when opening another preview', () => {
  const next = upsertPanelTab({
    activeTabId: 'file:a',
    tabs: [
      { id: 'review' },
      { id: 'file:a', isPreview: true }
    ]
  }, { id: 'file:b', isPreview: true }, { replacePreview: true })

  assert.deepEqual(next, {
    activeTabId: 'file:b',
    tabs: [
      { id: 'review' },
      { id: 'file:b', isPreview: true }
    ]
  })
})

test('panel tabs preserve pinned tabs when opening a preview', () => {
  const next = upsertPanelTab({
    activeTabId: 'file:a',
    tabs: [
      { id: 'file:a', isPreview: false, isPinned: true }
    ]
  }, { id: 'file:b', isPreview: true }, { replacePreview: true })

  assert.deepEqual(next.tabs.map((tab) => tab.id), ['file:a', 'file:b'])
  assert.equal(next.activeTabId, 'file:b')
})

test('closing the active tab activates the previous adjacent tab', () => {
  const next = closePanelTab({
    activeTabId: 'browser',
    tabs: [
      { id: 'review' },
      { id: 'browser' },
      { id: 'files' }
    ]
  }, 'browser')

  assert.deepEqual(next.tabs.map((tab) => tab.id), ['review', 'files'])
  assert.equal(next.activeTabId, 'review')
})

test('panel tabs can move by direction or direct index without changing active tab', () => {
  const moved = movePanelTabByDirection({
    activeTabId: 'files',
    tabs: [
      { id: 'review' },
      { id: 'browser' },
      { id: 'files' }
    ]
  }, 'files', 'left')

  assert.deepEqual(moved.tabs.map((tab) => tab.id), ['review', 'files', 'browser'])
  assert.equal(moved.activeTabId, 'files')

  const reordered = reorderPanelTab(moved, 'review', 2)
  assert.deepEqual(reordered.tabs.map((tab) => tab.id), ['files', 'browser', 'review'])
  assert.equal(reordered.activeTabId, 'files')
})

test('panel tabs transfer between controller-owned sets', () => {
  const transfer = transferPanelTab(
    {
      activeTabId: 2,
      tabs: [{ id: 1 }, { id: 2 }, { id: 3 }]
    },
    {
      activeTabId: 'browser',
      tabs: [{ id: 'browser' }]
    },
    2,
    (tab) => ({ id: `terminal:${tab.id}` as const }),
    { activate: true }
  )

  assert.equal(transfer.moved, true)
  assert.deepEqual(transfer.source.tabs.map((tab) => tab.id), [1, 3])
  assert.equal(transfer.source.activeTabId, 1)
  assert.deepEqual(transfer.target.tabs.map((tab) => tab.id), ['browser', 'terminal:2'])
  assert.equal(transfer.target.activeTabId, 'terminal:2')
})

test('panel tab transfer preserves source and target when the tab cannot be moved', () => {
  const source = {
    activeTabId: 'browser',
    tabs: [{ id: 'browser' }]
  }
  const target = {
    activeTabId: 1,
    tabs: [{ id: 1 }]
  }

  const transfer = transferPanelTab(source, target, 'browser', () => null)

  assert.equal(transfer.moved, false)
  assert.equal(transfer.source, source)
  assert.equal(transfer.target, target)
})

test('panel tab transfer availability exposes the shared shell boundary', () => {
  assert.deepEqual([...BOTTOM_PANEL_TRANSFER_TAB_KINDS], ['terminal', 'plan'])
  assert.equal(isBottomPanelTransferTabKind('terminal'), true)
  assert.equal(isBottomPanelTransferTabKind('plan'), true)
  assert.equal(isBottomPanelTransferTabKind('browser'), false)
  assert.equal(bottomPanelTransferPolicyLabel(), 'Bottom panel supports Terminal and Plan tabs.')

  assert.deepEqual(resolvePanelTabTransferAvailability('bottom', 'right', 'terminal'), {
    model: 'shared',
    sourcePanel: 'bottom',
    targetPanel: 'right',
    tabKind: 'terminal',
    supported: true,
    reason: 'available'
  })

  assert.deepEqual(resolvePanelTabTransferAvailability('right', 'bottom', 'terminal'), {
    model: 'shared',
    sourcePanel: 'right',
    targetPanel: 'bottom',
    tabKind: 'terminal',
    supported: true,
    reason: 'available'
  })

  assert.deepEqual(resolvePanelTabTransferAvailability('right', 'bottom', 'plan'), {
    model: 'shared',
    sourcePanel: 'right',
    targetPanel: 'bottom',
    tabKind: 'plan',
    supported: true,
    reason: 'available'
  })

  for (const tabKind of ['browser', 'diff', 'files']) {
    assert.deepEqual(resolvePanelTabTransferAvailability('right', 'bottom', tabKind), {
      model: 'shared',
      sourcePanel: 'right',
      targetPanel: 'bottom',
      tabKind,
      supported: false,
      reason: 'unsupported-tab-kind'
    })
  }
})

test('pinning a preview tab promotes it to a stable tab', () => {
  const next = pinPanelTab({
    activeTabId: 'file:a',
    tabs: [{ id: 'file:a', isPreview: true }]
  }, 'file:a')

  assert.deepEqual(next.tabs, [{ id: 'file:a', isPreview: false, isPinned: true }])
})

test('resetting panel tabs recovers an invalid active id', () => {
  const next = resetPanelTabSet({
    activeTabId: 'missing',
    tabs: [{ id: 'review' }]
  })

  assert.equal(next.activeTabId, 'review')
})

test('panel close target honors focused right and bottom panels', () => {
  assert.equal(resolvePanelCloseTarget('right-panel', {
    rightPanelActiveTabId: 'files',
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 0,
    bottomPanelTabCount: 1
  }), 'right-panel')

  assert.equal(resolvePanelCloseTarget('bottom-panel', {
    rightPanelActiveTabId: 'files',
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 0,
    bottomPanelTabCount: 1
  }), 'bottom-panel')
})

test('panel close target falls back from main to an open closeable panel', () => {
  assert.equal(resolvePanelCloseTarget('main', {
    rightPanelActiveTabId: 'browser',
    bottomPanelOpen: false,
    bottomPanelActiveTabId: 0,
    bottomPanelTabCount: 1
  }), 'right-panel')

  assert.equal(resolvePanelCloseTarget('main', {
    rightPanelActiveTabId: null,
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 0,
    bottomPanelTabCount: 1
  }), 'bottom-panel')
})

test('panel close target falls back when the focused panel cannot close', () => {
  assert.equal(resolvePanelCloseTarget('bottom-panel', {
    rightPanelActiveTabId: 'browser',
    bottomPanelOpen: false,
    bottomPanelActiveTabId: 0,
    bottomPanelTabCount: 1
  }), 'right-panel')

  assert.equal(resolvePanelCloseTarget('right-panel', {
    rightPanelActiveTabId: null,
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 2,
    bottomPanelTabCount: 2
  }), 'bottom-panel')

  assert.equal(resolvePanelCloseTarget('main', {
    rightPanelActiveTabId: null,
    bottomPanelOpen: true,
    bottomPanelActiveTabId: null,
    bottomPanelTabCount: 1
  }), null)
})

test('panel find target routes through the focused shell area', () => {
  assert.equal(resolvePanelFindTarget('main', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'diff'
  }), 'transcript')

  assert.equal(resolvePanelFindTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'diff'
  }), 'review-files')

  assert.equal(resolvePanelFindTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'files'
  }), 'workspace-files')

  assert.equal(resolvePanelFindTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'file:%2Ftmp%2Frepo:src%2FApp.tsx'
  }), 'source-file')

  assert.equal(resolvePanelFindTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'browser'
  }), 'browser-page')

  assert.equal(resolvePanelFindTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'plan'
  }), null)

  assert.equal(resolvePanelFindTarget('bottom-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'files'
  }), null)
})

test('browser panel command target only resolves for the focused browser tab', () => {
  assert.equal(resolvePanelBrowserCommandTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'browser'
  }), 'browser')

  assert.equal(resolvePanelBrowserCommandTarget('main', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'browser'
  }), null)

  assert.equal(resolvePanelBrowserCommandTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'files'
  }), null)

  assert.equal(resolvePanelBrowserCommandTarget('right-panel', {
    rightPanelOpen: false,
    rightPanelActiveTabId: 'browser'
  }), null)
})

test('panel new-tab target routes browser and terminal focus through the shell', () => {
  assert.equal(resolvePanelNewTabTarget('main', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'browser',
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 0,
    bottomPanelTabCount: 1
  }), null)

  assert.equal(resolvePanelNewTabTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'browser'
  }), 'browser')

  assert.equal(resolvePanelNewTabTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'terminal:2'
  }), 'right-terminal')

  assert.equal(resolvePanelNewTabTarget('bottom-panel', {
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 1,
    bottomPanelTabCount: 2
  }), 'bottom-terminal')

  assert.equal(resolvePanelNewTabTarget('right-panel', {
    rightPanelOpen: true,
    rightPanelActiveTabId: 'files'
  }), null)

  assert.equal(resolvePanelNewTabTarget('bottom-panel', {
    bottomPanelOpen: true,
    bottomPanelActiveTabId: null,
    bottomPanelTabCount: 1
  }), null)
})

test('bottom panel close policy protects single terminals but allows final plan tab', () => {
  assert.equal(canCloseBottomPanelTab(0, [0]), false)
  assert.equal(canCloseBottomPanelTab('plan', ['plan']), true)
  assert.equal(canCloseBottomPanelTab(0, [0, 'plan']), true)
  assert.equal(canCloseBottomPanelTab('plan', [0, 'plan']), true)

  assert.equal(resolvePanelNewTabTarget('bottom-panel', {
    bottomPanelOpen: true,
    bottomPanelActiveTabId: 'plan',
    bottomPanelTabCount: 1
  }), 'bottom-terminal')
})
