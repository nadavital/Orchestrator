import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appMenuCommandForKeyboardEvent,
  findShortcutConflict,
  shortcutDisabledDefaultSequences,
  shortcutOverrideRecord,
  shortcutSequenceFromKeyboardEvent,
  shortcutSequenceToAccelerator,
  visibleShortcutRows
} from '../../types/appCommands'

test('app command registry maps core shortcuts to commands', () => {
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'k', metaKey: true }), 'open-command-menu')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'P', metaKey: true, shiftKey: true }), 'open-command-menu')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'f', metaKey: true }), 'search-transcript')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'p', metaKey: true }), 'open-file-search')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'l', metaKey: true }), 'focus-browser-address-bar')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'n', ctrlKey: true }), 'new-chat')
})

test('app command registry maps navigation and panel shortcuts', () => {
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'Tab', ctrlKey: true }), 'next-chat')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'Tab', ctrlKey: true, shiftKey: true }), 'previous-chat')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true }), 'previous-chat')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '[', code: 'BracketLeft', metaKey: true }), 'browser-navigate-back')
  assert.equal(appMenuCommandForKeyboardEvent({ key: ']', code: 'BracketRight', metaKey: true }), 'browser-navigate-forward')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'r', metaKey: true }), 'browser-reload-page')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'R', metaKey: true, shiftKey: true }), 'browser-hard-reload-page')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 't', metaKey: true }), 'open-browser-tab')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'B', metaKey: true, shiftKey: true }), 'toggle-browser-panel')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '`', code: 'Backquote', metaKey: true }), 'toggle-terminal')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'w', metaKey: true }), 'close-active-panel-tab')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '/', code: 'Slash', metaKey: true, shiftKey: true }), 'keyboard-shortcuts')
})

test('app command registry maps chat slot shortcuts and ignores unrelated keys', () => {
  assert.equal(appMenuCommandForKeyboardEvent({ key: '3', metaKey: true }), 'go-chat-3')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '3' }), null)
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'x', metaKey: true }), null)
})

test('app command registry applies editable shortcut overrides', () => {
  const overrides = { 'open-file-search': [['mod', 'shift', 'O']] as const }
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'O', metaKey: true, shiftKey: true }, overrides), 'open-file-search')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'p', metaKey: true }, overrides), 'open-file-search')

  const fileSearchRow = visibleShortcutRows(overrides).find((row) => row.id === 'open-file-search')
  assert.deepEqual(fileSearchRow?.shortcuts[0], ['mod', 'shift', 'O'])
  assert.deepEqual(fileSearchRow?.shortcuts[1], ['mod', 'P'])
})

test('app command registry supports disabled default shortcut bindings', () => {
  const overrides = {
    'toggle-terminal': {
      shortcuts: [['mod', 'shift', 'T']],
      disabledDefaults: [['mod', '`']]
    }
  } as const

  assert.equal(appMenuCommandForKeyboardEvent({ key: 'T', metaKey: true, shiftKey: true }, overrides), 'toggle-terminal')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '`', code: 'Backquote', metaKey: true }, overrides), null)
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'j', metaKey: true }, overrides), 'toggle-terminal')
  assert.deepEqual(shortcutDisabledDefaultSequences('toggle-terminal', overrides), [['mod', '`']])
  assert.deepEqual(shortcutOverrideRecord('toggle-terminal', overrides), {
    shortcuts: [['mod', 'shift', 'T']],
    disabledDefaults: [['mod', '`']]
  })
})

test('app command registry detects shortcut conflicts across defaults and custom bindings', () => {
  assert.equal(findShortcutConflict(['mod', 'K'], 'open-file-search')?.id, 'open-command-menu')
  assert.equal(findShortcutConflict(['mod', 'shift', 'O'], 'open-file-search'), null)
  assert.equal(
    findShortcutConflict(['mod', 'shift', 'O'], 'new-chat', { 'open-file-search': [['mod', 'shift', 'O']] as const })?.id,
    'open-file-search'
  )
})

test('shortcut recorder normalizes keyboard events into editable sequences', () => {
  assert.deepEqual(shortcutSequenceFromKeyboardEvent({ key: 'O', metaKey: true, shiftKey: true }), ['mod', 'shift', 'O'])
  assert.deepEqual(shortcutSequenceFromKeyboardEvent({ key: 'ArrowDown', metaKey: true }), ['mod', 'Down'])
  assert.deepEqual(shortcutSequenceFromKeyboardEvent({ key: '?', code: 'Slash', metaKey: true, shiftKey: true }), ['mod', 'shift', '/'])
  assert.deepEqual(shortcutSequenceFromKeyboardEvent({ key: '{', code: 'BracketLeft', metaKey: true, shiftKey: true }), ['mod', 'shift', '['])
  assert.deepEqual(shortcutSequenceFromKeyboardEvent({ key: '~', code: 'Backquote', metaKey: true, shiftKey: true }), ['mod', 'shift', '`'])
  assert.deepEqual(shortcutSequenceFromKeyboardEvent({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), ['mod', 'shift', '1'])
  assert.equal(shortcutSequenceFromKeyboardEvent({ key: 'O' }), null)
})

test('shortcut sequences convert to Electron accelerators', () => {
  assert.equal(shortcutSequenceToAccelerator(['mod', 'shift', 'O']), 'CmdOrCtrl+Shift+O')
  assert.equal(shortcutSequenceToAccelerator(['ctrl', 'Tab']), 'Ctrl+Tab')
  assert.equal(shortcutSequenceToAccelerator(['mod', '`']), 'CmdOrCtrl+`')
})
