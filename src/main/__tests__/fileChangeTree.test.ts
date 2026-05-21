import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFileChangeTreeRows } from '../../types'
import type { FileChange } from '../../types'

test('file change tree rows add directory ancestors once in file order', () => {
  const files: FileChange[] = [
    { path: 'src/components/Button.tsx', status: 'M', additions: 8, deletions: 2 },
    { path: 'src/components/Input.tsx', status: 'A', additions: 12, deletions: 0 },
    { path: 'docs/plan.md', status: 'D', additions: 0, deletions: 4 }
  ]

  const rows = buildFileChangeTreeRows(files)

  assert.deepEqual(rows.map((row) => [row.type, row.path, row.depth]), [
    ['directory', 'src', 0],
    ['directory', 'src/components', 1],
    ['file', 'src/components/Button.tsx', 2],
    ['file', 'src/components/Input.tsx', 2],
    ['directory', 'docs', 0],
    ['file', 'docs/plan.md', 1]
  ])
})

test('file change tree directory rows aggregate child file counts and stats', () => {
  const files: FileChange[] = [
    { path: 'src/a.ts', status: 'M', additions: 2, deletions: 1 },
    { path: 'src/nested/b.ts', status: '?', additions: 5, deletions: 0 }
  ]

  const rows = buildFileChangeTreeRows(files)
  const src = rows.find((row) => row.type === 'directory' && row.path === 'src')
  const nested = rows.find((row) => row.type === 'directory' && row.path === 'src/nested')

  assert.equal(src?.type, 'directory')
  assert.deepEqual({
    fileCount: src.fileCount,
    additions: src.additions,
    deletions: src.deletions
  }, {
    fileCount: 2,
    additions: 7,
    deletions: 1
  })
  assert.equal(nested?.type, 'directory')
  assert.deepEqual({
    fileCount: nested.fileCount,
    additions: nested.additions,
    deletions: nested.deletions
  }, {
    fileCount: 1,
    additions: 5,
    deletions: 0
  })
})

test('file change tree keeps root files flat', () => {
  const files: FileChange[] = [
    { path: 'README.md', status: 'M', additions: 1, deletions: 1 }
  ]

  assert.deepEqual(buildFileChangeTreeRows(files).map((row) => [row.type, row.path, row.depth]), [
    ['file', 'README.md', 0]
  ])
})
