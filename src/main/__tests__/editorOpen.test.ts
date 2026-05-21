import assert from 'node:assert/strict'
import test from 'node:test'

import { editorFileUrl, editorPathTarget, hasValidLineTarget } from '../editorOpen'

test('editor file URL preserves line and column for URL-scheme editors', () => {
  assert.equal(
    editorFileUrl('vscode', '/Users/navital/Desktop/Orchestrator/src/main/index.ts', { line: 42, column: 7 }),
    'vscode://file/Users/navital/Desktop/Orchestrator/src/main/index.ts:42:7'
  )
})

test('editor file URL encodes spaces and defaults invalid columns to one', () => {
  assert.equal(
    editorFileUrl('cursor', '/Users/navital/Desktop/Orchestrator/Nested Folder/file name.ts', { line: 12, column: Number.NaN }),
    'cursor://file/Users/navital/Desktop/Orchestrator/Nested%20Folder/file%20name.ts:12:1'
  )
})

test('editor file URL is absent when scheme or valid line target is missing', () => {
  assert.equal(editorFileUrl(undefined, '/tmp/file.ts', { line: 1 }), null)
  assert.equal(editorFileUrl('vscode', '/tmp/file.ts', {}), null)
  assert.equal(editorFileUrl('vscode', '/tmp/file.ts', { line: Number.NaN }), null)
})

test('editor path targets preserve line and column for CLI editors', () => {
  assert.equal(
    editorPathTarget('/Users/navital/Desktop/Orchestrator/Nested Folder/file name.ts', { line: 12, column: 4 }),
    '/Users/navital/Desktop/Orchestrator/Nested Folder/file name.ts:12:4'
  )
  assert.equal(editorPathTarget('/tmp/file.ts', {}), '/tmp/file.ts')
  assert.equal(hasValidLineTarget({ line: 12 }), true)
  assert.equal(hasValidLineTarget({ line: Number.NaN }), false)
})
