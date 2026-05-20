import assert from 'node:assert/strict'
import test from 'node:test'

import { appMenuCommandForKeyboardEvent } from '../../types/appCommands'

test('app command registry maps core shortcuts to commands', () => {
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'k', metaKey: true }), 'open-command-menu')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'P', metaKey: true, shiftKey: true }), 'open-command-menu')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'f', metaKey: true }), 'search-transcript')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'n', ctrlKey: true }), 'new-chat')
})

test('app command registry maps navigation and panel shortcuts', () => {
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'Tab', ctrlKey: true }), 'next-chat')
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'Tab', ctrlKey: true, shiftKey: true }), 'previous-chat')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true }), 'previous-chat')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '`', code: 'Backquote', metaKey: true }), 'toggle-terminal')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '/', code: 'Slash', metaKey: true, shiftKey: true }), 'keyboard-shortcuts')
})

test('app command registry maps chat slot shortcuts and ignores unrelated keys', () => {
  assert.equal(appMenuCommandForKeyboardEvent({ key: '3', metaKey: true }), 'go-chat-3')
  assert.equal(appMenuCommandForKeyboardEvent({ key: '3' }), null)
  assert.equal(appMenuCommandForKeyboardEvent({ key: 'x', metaKey: true }), null)
})
