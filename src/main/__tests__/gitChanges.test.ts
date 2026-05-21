import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { gitManager } from '../git'

test('changed files preserve paths with spaces without git porcelain quotes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-changes-'))
  try {
    mkdirSync(join(root, 'Nested Folder'), { recursive: true })
    writeFileSync(join(root, 'Nested Folder', 'nested note.md'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')

    writeFileSync(join(root, 'Nested Folder', 'nested note.md'), 'before\nafter\n')

    const files = await gitManager.getChangedFiles(root)

    assert.deepEqual(files.map((file) => file.path), ['Nested Folder/nested note.md'])
    assert.equal(files[0]?.status, 'M')
    assert.deepEqual({ additions: files[0]?.additions, deletions: files[0]?.deletions }, { additions: 1, deletions: 0 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('changed files expose staged and unstaged state for review actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-stage-state-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')

    writeFileSync(join(root, 'tracked.txt'), 'before\nafter\n')
    writeFileSync(join(root, 'new.txt'), 'new\n')

    const unstaged = await gitManager.getChangedFiles(root)
    assert.equal(unstaged.find((file) => file.path === 'tracked.txt')?.unstaged, true)
    assert.equal(unstaged.find((file) => file.path === 'tracked.txt')?.staged, false)
    assert.equal(unstaged.find((file) => file.path === 'new.txt')?.status, '?')

    const stagedResult = await gitManager.stagePaths(root, ['tracked.txt', 'new.txt'])
    assert.equal(stagedResult.ok, true)
    assert.equal(stagedResult.changedFiles.find((file) => file.path === 'tracked.txt')?.staged, true)
    assert.equal(stagedResult.changedFiles.find((file) => file.path === 'tracked.txt')?.unstaged, false)
    assert.equal(stagedResult.changedFiles.find((file) => file.path === 'new.txt')?.staged, true)

    const unstagedResult = await gitManager.unstagePaths(root, ['tracked.txt', 'new.txt'])
    assert.equal(unstagedResult.ok, true)
    assert.equal(unstagedResult.changedFiles.find((file) => file.path === 'tracked.txt')?.staged, false)
    assert.equal(unstagedResult.changedFiles.find((file) => file.path === 'tracked.txt')?.unstaged, true)
    assert.equal(unstagedResult.changedFiles.find((file) => file.path === 'new.txt')?.status, '?')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}
