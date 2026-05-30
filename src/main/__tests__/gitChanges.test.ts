import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { gitManager, isGitHubReviewMetadataUnavailableErrorMessage, mergeReviewCommentSummaries, parseGitHubPullRequestUrl, parseGitHubRemoteUrl, reviewMetadataFromGitHubPullRequestView, reviewThreadCommentMetadataFromGitHub, reviewThreadCommentSummaryFromGitHub } from '../git'

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

test('commit staged creates a commit and leaves unstaged edits alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-commit-staged-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')

    writeFileSync(join(root, 'tracked.txt'), 'staged\n')
    writeFileSync(join(root, 'unstaged.txt'), 'working tree\n')
    await gitManager.stagePaths(root, ['tracked.txt'])

    const emptyMessage = await gitManager.commitStaged(root, '   ')
    assert.equal(emptyMessage.ok, false)
    assert.match(emptyMessage.error ?? '', /commit message/i)

    const result = await gitManager.commitStaged(root, 'Workbench commit\n')
    assert.equal(result.ok, true)
    assert.match(result.commit ?? '', /^[0-9a-f]{7,}$/)
    assert.deepEqual(result.changedFiles.map((file) => file.path), ['unstaged.txt'])
    assert.equal(result.changedFiles[0]?.unstaged, true)

    const subject = spawnSync('git', ['log', '-1', '--pretty=%s'], { cwd: root, encoding: 'utf-8' })
    assert.equal(subject.status, 0, subject.stderr || subject.stdout)
    assert.equal(subject.stdout.trim(), 'Workbench commit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('create branch validates names and checks out the new branch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-create-branch-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')
    const defaultBranch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf-8' }).stdout.trim()
    writeFileSync(join(root, 'tracked.txt'), 'before\ndirty\n')

    const empty = await gitManager.createBranch(root, '   ')
    assert.equal(empty.ok, false)
    assert.match(empty.error ?? '', /branch name/i)

    const result = await gitManager.createBranch(root, 'orchestrator/git-panel-test')
    assert.equal(result.ok, true)
    assert.equal(result.currentBranch, 'orchestrator/git-panel-test')
    assert.equal(result.branches.find((branch) => branch.name === 'orchestrator/git-panel-test')?.current, true)

    const current = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf-8' })
    assert.equal(current.status, 0, current.stderr || current.stdout)
    assert.equal(current.stdout.trim(), 'orchestrator/git-panel-test')
    assert.equal(readFileSync(join(root, 'tracked.txt'), 'utf-8'), 'before\ndirty\n')

    const checkoutEmpty = await gitManager.checkoutBranch(root, '   ')
    assert.equal(checkoutEmpty.ok, false)
    assert.match(checkoutEmpty.error ?? '', /choose a branch/i)

    const checkout = await gitManager.checkoutBranch(root, defaultBranch)
    assert.equal(checkout.ok, true)
    assert.equal(checkout.currentBranch, defaultBranch)
    assert.equal(checkout.branches.find((branch) => branch.name === defaultBranch)?.current, true)
    assert.equal(readFileSync(join(root, 'tracked.txt'), 'utf-8'), 'before\ndirty\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pull request create URL uses the GitHub origin remote and branch compare route', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-pr-url-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'remote', 'add', 'origin', 'git@github.com:nadavital/Orchestrator.git')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')

    const result = await gitManager.getPullRequestCreateUrl(root, 'main', 'codex/git-panel-pr')

    assert.equal(result.ok, true)
    assert.equal(result.remoteUrl, 'git@github.com:nadavital/Orchestrator.git')
    assert.equal(result.remoteName, 'origin')
    assert.equal(result.url, 'https://github.com/nadavital/Orchestrator/compare/main...codex%2Fgit-panel-pr?quick_pull=1')
    assert.equal(result.branchPublished, false)
    assert.equal(result.remoteBranch, 'origin/codex/git-panel-pr')
    assert.equal(result.pushCommand, 'git push -u origin codex/git-panel-pr')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pull request create URL marks locally known remote branches as published', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-pr-published-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'remote', 'add', 'origin', 'git@github.com:nadavital/Orchestrator.git')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')
    git(root, 'update-ref', 'refs/remotes/origin/codex/git-panel-pr', 'HEAD')

    const result = await gitManager.getPullRequestCreateUrl(root, 'main', 'codex/git-panel-pr')

    assert.equal(result.ok, true)
    assert.equal(result.branchPublished, true)
    assert.equal(result.remoteBranch, 'origin/codex/git-panel-pr')
    assert.equal(result.pushCommand, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pull request create URL reports unavailable non-GitHub remotes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-pr-url-missing-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'before\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'remote', 'add', 'origin', 'ssh://git@example.com/repo/project.git')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'baseline')

    const result = await gitManager.getPullRequestCreateUrl(root, 'main', 'feature')

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /No GitHub remote/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GitHub remote URL parser supports common clone URL forms', () => {
  assert.equal(parseGitHubRemoteUrl('https://github.com/nadavital/Orchestrator.git'), 'https://github.com/nadavital/Orchestrator')
  assert.equal(parseGitHubRemoteUrl('git@github.com:nadavital/Orchestrator.git'), 'https://github.com/nadavital/Orchestrator')
  assert.equal(parseGitHubRemoteUrl('ssh://git@github.com/nadavital/Orchestrator.git'), 'https://github.com/nadavital/Orchestrator')
  assert.equal(parseGitHubRemoteUrl('ssh://git@example.com/nadavital/Orchestrator.git'), null)
})

test('GitHub pull request create output parser extracts PR URL', () => {
  assert.equal(
    parseGitHubPullRequestUrl('Creating pull request for codex/feature into main in openai/orchestrator\nhttps://github.com/openai/orchestrator/pull/77\n'),
    'https://github.com/openai/orchestrator/pull/77'
  )
  assert.equal(parseGitHubPullRequestUrl('no pull request was created'), undefined)
})

test('pull request creation validates base and topic branches before gh mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-pr-create-validate-'))
  try {
    const missingBranch = await gitManager.createPullRequest(root, 'main', '   ')
    assert.equal(missingBranch.ok, false)
    assert.match(missingBranch.error ?? '', /base and topic branch/i)

    const sameBranch = await gitManager.createPullRequest(root, 'main', 'main')
    assert.equal(sameBranch.ok, false)
    assert.match(sameBranch.error ?? '', /topic branch/i)
    assert.equal(sameBranch.command, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('changed files expose unmerged conflict state for review helpers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-conflict-state-'))
  try {
    writeFileSync(join(root, 'conflict.txt'), 'base\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'conflict.txt')
    git(root, 'commit', '-m', 'baseline')
    const defaultBranch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf-8' }).stdout.trim()

    git(root, 'checkout', '-b', 'conflict-topic')
    writeFileSync(join(root, 'conflict.txt'), 'topic\n')
    git(root, 'add', 'conflict.txt')
    git(root, 'commit', '-m', 'topic change')
    git(root, 'checkout', defaultBranch)
    writeFileSync(join(root, 'conflict.txt'), 'main\n')
    git(root, 'add', 'conflict.txt')
    git(root, 'commit', '-m', 'main change')

    const merge = spawnSync('git', ['merge', 'conflict-topic'], { cwd: root, encoding: 'utf-8' })
    assert.notEqual(merge.status, 0)

    const files = await gitManager.getChangedFiles(root)
    const conflict = files.find((file) => file.path === 'conflict.txt')
    assert.equal(conflict?.status, 'U')
    assert.equal(conflict?.conflicted, true)
    assert.equal(conflict?.conflictStatus, 'UU')
    assert.equal(conflict?.indexStatus, 'U')
    assert.equal(conflict?.worktreeStatus, 'U')

    const diff = await gitManager.getDiffForFile(root, 'conflict.txt')
    assert.match(diff, /<<<<<<< HEAD/)
    assert.match(diff, /=======/)
    assert.match(diff, />>>>>>> conflict-topic/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('file diffs can be scoped to all, staged, or unstaged changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-diff-source-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'baseline\n')
    writeFileSync(join(root, 'untracked.txt'), 'new working tree file\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')

    writeFileSync(join(root, 'tracked.txt'), 'staged version\n')
    git(root, 'add', 'tracked.txt')
    writeFileSync(join(root, 'tracked.txt'), 'working tree version\n')

    const staged = await gitManager.getDiffForFile(root, 'tracked.txt', 'staged')
    const unstaged = await gitManager.getDiffForFile(root, 'tracked.txt', 'unstaged')
    const all = await gitManager.getDiffForFile(root, 'tracked.txt', 'all')
    const untracked = await gitManager.getDiffForFile(root, 'untracked.txt', 'unstaged')
    const providerNativeFiles = await gitManager.getChangedFiles(root, 'last-turn')
    const providerNativeDiff = await gitManager.getDiffForFile(root, 'tracked.txt', 'cloud')

    assert.match(staged, /staged version/)
    assert.doesNotMatch(staged, /working tree version/)
    assert.match(unstaged, /working tree version/)
    assert.match(unstaged, /staged version/)
    assert.match(all, /working tree version/)
    assert.match(all, /baseline/)
    assert.match(untracked, /new working tree file/)
    assert.deepEqual(providerNativeFiles, [])
    assert.equal(providerNativeDiff, '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('discard paths reverts tracked, staged, and untracked review files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-discard-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'baseline\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')

    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    writeFileSync(join(root, 'staged-new.txt'), 'staged\n')
    writeFileSync(join(root, 'untracked.txt'), 'untracked\n')
    git(root, 'add', 'staged-new.txt')

    const result = await gitManager.discardPaths(root, ['tracked.txt', 'staged-new.txt', 'untracked.txt'])

    assert.equal(result.ok, true)
    assert.equal(result.discarded, true)
    assert.deepEqual(result.changedFiles, [])
    assert.equal(readFileSync(join(root, 'tracked.txt'), 'utf-8'), 'baseline\n')
    assert.equal(existsSync(join(root, 'staged-new.txt')), false)
    assert.equal(existsSync(join(root, 'untracked.txt')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('discard paths refuses unsafe paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-discard-safe-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'baseline\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')

    const result = await gitManager.discardPaths(root, ['../outside.txt'])

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /unsafe path/)
    assert.equal(readFileSync(join(root, 'tracked.txt'), 'utf-8'), 'changed\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reverse apply diff undoes provider patch without discarding unrelated edits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-reverse-apply-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'one\n')
    writeFileSync(join(root, 'unrelated.txt'), 'keep\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt', 'unrelated.txt')
    git(root, 'commit', '-m', 'baseline')

    const providerDiff = [
      'diff --git a/tracked.txt b/tracked.txt',
      'index 5626abf..814f4a4 100644',
      '--- a/tracked.txt',
      '+++ b/tracked.txt',
      '@@ -1 +1,2 @@',
      ' one',
      '+two'
    ].join('\n')
    writeFileSync(join(root, 'tracked.txt'), 'one\ntwo\n')
    writeFileSync(join(root, 'unrelated.txt'), 'keep\nlater edit\n')

    const result = await gitManager.reverseApplyDiff(root, providerDiff)

    assert.equal(result.ok, true)
    assert.equal(result.reverseApplied, true)
    assert.deepEqual(result.paths, ['tracked.txt'])
    assert.equal(readFileSync(join(root, 'tracked.txt'), 'utf-8'), 'one\n')
    assert.equal(readFileSync(join(root, 'unrelated.txt'), 'utf-8'), 'keep\nlater edit\n')
    assert.deepEqual(result.changedFiles.map((file) => file.path), ['unrelated.txt'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reverse apply diff refuses unsafe paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-reverse-safe-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'one\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')

    const result = await gitManager.reverseApplyDiff(root, [
      'diff --git a/../outside.txt b/../outside.txt',
      '--- a/../outside.txt',
      '+++ b/../outside.txt',
      '@@ -1 +1 @@',
      '-outside',
      '+changed'
    ].join('\n'))

    assert.equal(result.ok, false)
    assert.equal(result.reverseApplied, false)
    assert.match(result.error ?? '', /unsafe path/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('file diffs can be scoped to branch and commit review sources', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-diff-ref-source-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'baseline\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')
    const defaultBranch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf-8' }).stdout.trim()

    git(root, 'checkout', '-b', 'review-branch')
    writeFileSync(join(root, 'tracked.txt'), 'branch version\n')
    writeFileSync(join(root, 'branch-only.txt'), 'branch file\n')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'branch change')
    const commitRef = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).stdout.trim()

    const branchFiles = await gitManager.getChangedFiles(root, 'branch', defaultBranch)
    const branchDiff = await gitManager.getDiffForFile(root, 'tracked.txt', 'branch', defaultBranch)
    const commitFiles = await gitManager.getChangedFiles(root, 'commit', commitRef)
    const commitDiff = await gitManager.getDiffForFile(root, 'branch-only.txt', 'commit', commitRef)

    assert.deepEqual(branchFiles.map((file) => file.path).sort(), ['branch-only.txt', 'tracked.txt'])
    assert.equal(branchFiles.find((file) => file.path === 'branch-only.txt')?.status, 'A')
    assert.match(branchDiff, /branch version/)
    assert.deepEqual(commitFiles.map((file) => file.path).sort(), ['branch-only.txt', 'tracked.txt'])
    assert.match(commitDiff, /branch file/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('review source branch and commit pickers expose recent refs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-review-refs-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'baseline\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')
    const defaultBranch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf-8' }).stdout.trim()

    git(root, 'checkout', '-b', 'review-base-branch')
    writeFileSync(join(root, 'tracked.txt'), 'base branch\n')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'base branch commit')
    git(root, 'checkout', defaultBranch)
    writeFileSync(join(root, 'tracked.txt'), 'current branch\n')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'current branch commit')

    const branches = await gitManager.listBranches(root)
    const commits = await gitManager.listRecentCommits(root)

    assert.ok(branches.some((branch) => branch.name === 'review-base-branch'))
    assert.ok(branches.some((branch) => branch.name === defaultBranch && branch.current === true))
    assert.ok(commits.some((commit) => commit.description?.includes('current branch commit')))
    assert.ok(commits.every((commit) => commit.name.length >= 8))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GitHub PR view JSON normalizes to review metadata', () => {
  const metadata = reviewMetadataFromGitHubPullRequestView({
    number: 42,
    title: 'Codex parity review',
    url: 'https://github.com/example/repo/pull/42',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'codex/review-parity',
    baseRefName: 'main',
    statusCheckRollup: [
      { conclusion: 'SUCCESS' },
      { conclusion: 'FAILURE' },
      { status: 'IN_PROGRESS' },
      { conclusion: 'SKIPPED' }
    ],
    reviewRequests: [
      { login: 'grace' },
      { team: { slug: 'ios' } }
    ],
    reviews: [
      { author: { login: 'ada' }, state: 'COMMENTED' },
      { author: { login: 'ada' }, state: 'APPROVED' },
      { author: { login: 'linus' }, state: 'CHANGES_REQUESTED' }
    ],
    comments: [
      { author: { login: 'mona' }, body: 'Please add docs', url: 'https://github.com/example/repo/pull/42#issuecomment-1' },
      { author: { login: 'ada' }, body: 'Nit', url: 'https://github.com/example/repo/pull/42#issuecomment-2' }
    ]
  })

  assert.equal(metadata?.pullRequest?.number, 42)
  assert.equal(metadata?.pullRequest?.state, 'open')
  assert.equal(metadata?.pullRequest?.branch, 'codex/review-parity')
  assert.equal(metadata?.pullRequest?.baseBranch, 'main')
  assert.equal(metadata?.checks?.status, 'failing')
  assert.deepEqual({
    total: metadata?.checks?.total,
    passed: metadata?.checks?.passed,
    failing: metadata?.checks?.failing,
    pending: metadata?.checks?.pending,
    skipped: metadata?.checks?.skipped
  }, {
    total: 4,
    passed: 1,
    failing: 1,
    pending: 1,
    skipped: 1
  })
  assert.deepEqual({
    requested: metadata?.reviewers?.requested,
    approved: metadata?.reviewers?.approved,
    changesRequested: metadata?.reviewers?.changesRequested,
    commented: metadata?.reviewers?.commented
  }, {
    requested: 2,
    approved: 1,
    changesRequested: 1,
    commented: 0
  })
  assert.deepEqual(metadata?.reviewers?.names, ['ada', 'linus', 'grace', 'ios'])
  assert.deepEqual({
    total: metadata?.comments?.total,
    authors: metadata?.comments?.authors,
    url: metadata?.comments?.url
  }, {
    total: 2,
    authors: ['mona', 'ada'],
    url: 'https://github.com/example/repo/pull/42#issuecomment-1'
  })
})

test('draft GitHub PR metadata maps to draft state', () => {
  const metadata = reviewMetadataFromGitHubPullRequestView({
    number: '7',
    title: 'Draft metadata',
    state: 'OPEN',
    isDraft: true,
    statusCheckRollup: [],
    reviewRequests: [],
    reviews: []
  })

  assert.equal(metadata?.pullRequest?.number, 7)
  assert.equal(metadata?.pullRequest?.state, 'draft')
  assert.equal(metadata?.checks, undefined)
  assert.equal(metadata?.reviewers, undefined)
  assert.equal(metadata?.comments, undefined)
})

test('GitHub Review metadata errors distinguish no PR from hosted provider failures', () => {
  assert.equal(isGitHubReviewMetadataUnavailableErrorMessage('no pull requests found for branch codex/foo'), true)
  assert.equal(isGitHubReviewMetadataUnavailableErrorMessage('There is no pull request associated with this branch'), true)
  assert.equal(isGitHubReviewMetadataUnavailableErrorMessage('error connecting to api.github.com\ncheck your internet connection'), false)
  assert.equal(isGitHubReviewMetadataUnavailableErrorMessage('HTTP 401: Bad credentials'), false)
  assert.equal(isGitHubReviewMetadataUnavailableErrorMessage('The token in default is invalid.'), false)
})

test('GitHub PR review thread JSON normalizes to inline comment metadata', () => {
  const payload = {
    data: {
      node: {
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              isOutdated: false,
              path: 'src/App.tsx',
              startLine: 11,
              line: 12,
              originalLine: 10,
              diffSide: 'RIGHT',
              comments: {
                nodes: [
                  { id: 'IC_kw1', body: 'Please handle empty state', author: { login: 'grace' }, url: 'https://github.com/example/repo/pull/42#discussion_r1', createdAt: '2026-05-25T12:00:00Z' },
                  {
                    id: 'IC_kw2',
                    body: 'Agree',
                    author: { login: 'ada' },
                    url: 'https://github.com/example/repo/pull/42#discussion_r2',
                    originalCommit: {
                      oid: 'abc1234def5678abc1234def5678abc1234def56',
                      abbreviatedOid: 'abc1234',
                      url: 'https://github.com/example/repo/commit/abc1234def5678abc1234def5678abc1234def56',
                      author: {
                        name: 'Ada Lovelace',
                        date: '2026-05-24T10:30:00Z',
                        user: { login: 'ada' }
                      }
                    }
                  }
                ]
              }
            },
            {
              isResolved: true,
              isOutdated: true,
              path: 'src/App.tsx',
              originalLine: 8,
              diffSide: 'LEFT',
              comments: {
                nodes: [
                  { id: 'IC_kw3', body: 'Old side note', author: { login: 'mona' }, url: 'https://github.com/example/repo/pull/42#discussion_r3' }
                ]
              }
            }
          ]
        }
      }
    }
  }
  const metadata = reviewThreadCommentSummaryFromGitHub(payload, 'https://github.com/example/repo/pull/42')
  const threaded = reviewThreadCommentMetadataFromGitHub(payload, 'https://github.com/example/repo/pull/42')

  assert.deepEqual(metadata, {
    total: 3,
    unresolved: 1,
    threads: 2,
    authors: ['grace', 'ada', 'mona'],
    url: 'https://github.com/example/repo/pull/42#discussion_r1'
  })
  assert.deepEqual(threaded?.commentsByPath?.['src/App.tsx'], [
    {
      id: 'IC_kw1',
      source: 'github',
      path: 'src/App.tsx',
      side: 'new',
      startLine: 11,
      lineNumber: 12,
      body: 'Please handle empty state',
      author: 'grace',
      url: 'https://github.com/example/repo/pull/42#discussion_r1',
      resolved: false,
      outdated: false,
      createdAt: '2026-05-25T12:00:00Z'
    },
    {
      id: 'IC_kw2',
      source: 'github',
      path: 'src/App.tsx',
      side: 'new',
      startLine: 11,
      lineNumber: 12,
      body: 'Agree',
      author: 'ada',
      url: 'https://github.com/example/repo/pull/42#discussion_r2',
      resolved: false,
      outdated: false,
      blame: {
        source: 'github',
        commit: 'abc1234def5678abc1234def5678abc1234def56',
        abbreviatedCommit: 'abc1234',
        author: 'ada',
        authoredAt: '2026-05-24T10:30:00Z',
        url: 'https://github.com/example/repo/commit/abc1234def5678abc1234def5678abc1234def56'
      }
    },
    {
      id: 'IC_kw3',
      source: 'github',
      path: 'src/App.tsx',
      side: 'old',
      lineNumber: 8,
      body: 'Old side note',
      author: 'mona',
      url: 'https://github.com/example/repo/pull/42#discussion_r3',
      resolved: true,
      outdated: true
    }
  ])
})

test('GitHub PR general and review-thread comment summaries merge for review metadata', () => {
  const metadata = mergeReviewCommentSummaries(
    {
      total: 2,
      authors: ['mona', 'ada'],
      url: 'https://github.com/example/repo/pull/42#issuecomment-1'
    },
    {
      total: 3,
      unresolved: 1,
      threads: 2,
      authors: ['grace', 'ada'],
      url: 'https://github.com/example/repo/pull/42#discussion_r1'
    }
  )

  assert.deepEqual(metadata, {
    total: 5,
    unresolved: 1,
    threads: 2,
    authors: ['mona', 'ada', 'grace'],
    url: 'https://github.com/example/repo/pull/42#discussion_r1'
  })
})

test('line blame returns author metadata for a tracked source line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-line-blame-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'line one\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')

    writeFileSync(join(root, 'tracked.txt'), 'line one\nline two\n')

    const committedLine = await gitManager.blameLine(root, 'tracked.txt', 1)
    const workingTreeLine = await gitManager.blameLine(root, 'tracked.txt', 2)

    assert.equal(committedLine.ok, true)
    assert.equal(committedLine.author, 'Orchestrator Test')
    assert.match(committedLine.summary ?? '', /Orchestrator Test/)
    assert.equal(workingTreeLine.ok, true)
    assert.equal(workingTreeLine.author, 'Not Committed Yet')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('create worktree accepts explicit branch name and base ref', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-git-worktree-create-'))
  try {
    writeFileSync(join(root, 'tracked.txt'), 'main\n')
    git(root, 'init')
    git(root, 'config', 'user.email', 'orchestrator-test@example.test')
    git(root, 'config', 'user.name', 'Orchestrator Test')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'baseline')
    const defaultBranch = spawnSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf-8' }).stdout.trim()
    git(root, 'checkout', '-b', 'base-smoke')
    writeFileSync(join(root, 'tracked.txt'), 'base\n')
    git(root, 'add', 'tracked.txt')
    git(root, 'commit', '-m', 'base branch')
    git(root, 'checkout', defaultBranch)

    const worktreePath = await gitManager.createWorktree(root, 'session-branch-test', {
      branchName: 'orchestrator/smoke-created',
      baseRef: 'base-smoke'
    })

    const branch = spawnSync('git', ['branch', '--show-current'], { cwd: worktreePath, encoding: 'utf-8' })
    assert.equal(branch.status, 0, branch.stderr || branch.stdout)
    assert.equal(branch.stdout.trim(), 'orchestrator/smoke-created')
    const content = spawnSync('git', ['show', 'HEAD:tracked.txt'], { cwd: worktreePath, encoding: 'utf-8' })
    assert.equal(content.status, 0, content.stderr || content.stdout)
    assert.equal(content.stdout.trim(), 'base')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}
