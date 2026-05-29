import { simpleGit } from 'simple-git'
import { join, resolve, sep } from 'path'
import { mkdirSync } from 'fs'
import { execFile, spawnSync } from 'child_process'
import { promisify } from 'util'
import type { FileChange, GitBranchActionResult, GitCommitResult, GitLineBlameResult, GitPathActionResult, GitRefOption, ReviewDiffSource, ReviewMetadata, ReviewCheckStatus, ReviewProviderBlame } from '../types'

const execFileAsync = promisify(execFile)

interface CreateWorktreeOptions {
  branchName?: string
  baseRef?: string
}

export const gitManager = {
  async isGitRepo(dir: string): Promise<boolean> {
    try {
      const git = simpleGit(dir)
      await git.status()
      return true
    } catch {
      return false
    }
  },

  async getCurrentBranch(dir: string): Promise<string | null> {
    try {
      const git = simpleGit(dir)
      const status = await git.status()
      return status.current || null
    } catch {
      return null
    }
  },

  async listBranches(dir: string, limit = 30): Promise<GitRefOption[]> {
    try {
      const git = simpleGit(dir)
      const [current, raw] = await Promise.all([
        this.getCurrentBranch(dir),
        git.raw([
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname:short)%00%(committerdate:unix)',
          'refs/heads',
          'refs/remotes'
        ])
      ])
      const seen = new Set<string>()
      const branches: GitRefOption[] = []
      for (const line of raw.split('\n').filter(Boolean)) {
        const [name = '', timestamp = ''] = line.split('\0')
        const cleanName = name.trim()
        if (!cleanName || cleanName.endsWith('/HEAD') || seen.has(cleanName)) continue
        seen.add(cleanName)
        const isRemote = cleanName.includes('/')
        const parsedTime = Number.parseInt(timestamp, 10)
        branches.push({
          name: cleanName,
          label: cleanName,
          description: cleanName === current
            ? 'Current branch'
            : `${isRemote ? 'Remote branch' : 'Local branch'}${Number.isFinite(parsedTime) ? ` · ${formatGitRelativeDate(parsedTime)}` : ''}`,
          current: cleanName === current
        })
        if (branches.length >= limit) break
      }
      return branches
    } catch {
      return []
    }
  },

  async listRecentCommits(dir: string, limit = 30): Promise<GitRefOption[]> {
    try {
      const git = simpleGit(dir)
      const raw = await git.raw([
        'log',
        `-${Math.max(1, Math.min(limit, 100))}`,
        '--date-order',
        '--pretty=format:%H%x00%h%x00%s%x00%ct'
      ])
      return raw.split('\n').filter(Boolean).map((line) => {
        const [hash = '', shortHash = '', subject = '', timestamp = ''] = line.split('\0')
        const parsedTime = Number.parseInt(timestamp, 10)
        return {
          name: hash,
          label: shortHash || hash.slice(0, 8),
          description: `${subject || 'Commit'}${Number.isFinite(parsedTime) ? ` · ${formatGitRelativeDate(parsedTime)}` : ''}`
        }
      }).filter((option) => option.name.length > 0)
    } catch {
      return []
    }
  },

  async createBranch(cwd: string, branchName: string): Promise<GitBranchActionResult> {
    const cleanBranchName = normalizeBranchName(branchName)
    if (!cleanBranchName) {
      return { ok: false, branches: await this.listBranches(cwd), currentBranch: await this.getCurrentBranch(cwd), error: 'Enter a branch name.' }
    }

    try {
      const git = simpleGit(cwd)
      await git.raw(['check-ref-format', '--branch', cleanBranchName])
      await git.raw(['checkout', '-b', cleanBranchName])
      return {
        ok: true,
        branchName: cleanBranchName,
        currentBranch: await this.getCurrentBranch(cwd),
        branches: await this.listBranches(cwd)
      }
    } catch (error) {
      return {
        ok: false,
        branchName: cleanBranchName,
        currentBranch: await this.getCurrentBranch(cwd),
        branches: await this.listBranches(cwd),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async checkoutBranch(cwd: string, branchName: string): Promise<GitBranchActionResult> {
    const cleanBranchName = normalizeBranchName(branchName)
    if (!cleanBranchName) {
      return { ok: false, branches: await this.listBranches(cwd), currentBranch: await this.getCurrentBranch(cwd), error: 'Choose a branch.' }
    }

    try {
      const git = simpleGit(cwd)
      await git.raw(['check-ref-format', '--branch', cleanBranchName])
      await git.raw(['checkout', cleanBranchName])
      return {
        ok: true,
        branchName: cleanBranchName,
        currentBranch: await this.getCurrentBranch(cwd),
        branches: await this.listBranches(cwd)
      }
    } catch (error) {
      return {
        ok: false,
        branchName: cleanBranchName,
        currentBranch: await this.getCurrentBranch(cwd),
        branches: await this.listBranches(cwd),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async createWorktree(repoRoot: string, sessionId: string, options: CreateWorktreeOptions = {}): Promise<string> {
    const worktreesDir = join(repoRoot, '.orchestrator-worktrees')
    mkdirSync(worktreesDir, { recursive: true })
    const worktreePath = this.worktreePathForSession(repoRoot, sessionId)
    const branchName = options.branchName?.trim() || `orchestrator/${sessionId.slice(0, 8)}`
    const git = simpleGit(repoRoot)
    await git.raw(['check-ref-format', '--branch', branchName])
    const args = ['worktree', 'add', worktreePath, '-b', branchName]
    const baseRef = options.baseRef?.trim()
    if (baseRef) args.push(baseRef)
    await git.raw(args)
    return worktreePath
  },

  worktreePathForSession(repoRoot: string, sessionId: string): string {
    return join(repoRoot, '.orchestrator-worktrees', sessionId)
  },

  isManagedWorktreePathForSession(repoRoot: string, worktreePath: string, sessionId: string): boolean {
    return resolve(worktreePath) === resolve(this.worktreePathForSession(repoRoot, sessionId))
  },

  async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    const git = simpleGit(repoRoot)
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  },

  async getDiff(cwd: string): Promise<string> {
    try {
      const git = simpleGit(cwd)
      const diff = await git.diff(['HEAD'])
      if (diff) return diff
      return await git.diff()
    } catch {
      return ''
    }
  },

  async getChangedFiles(cwd: string, source: ReviewDiffSource = 'all', ref?: string): Promise<FileChange[]> {
    try {
      if (!isSupportedLocalReviewSource(source)) return []
      const git = simpleGit(cwd)
      const cleanRef = ref?.trim()
      if (source === 'branch') {
        if (!cleanRef) return []
        return await getChangedFilesForGitDiff(git, [`${cleanRef}...HEAD`])
      }
      if (source === 'commit') {
        if (!cleanRef) return []
        return await getChangedFilesForCommit(git, cleanRef)
      }

      // Get +/- counts via numstat (HEAD diff)
      const numstatRaw = await git.raw(['diff', '--numstat', 'HEAD']).catch(() => '')
      const numstatMap = new Map<string, { additions: number; deletions: number }>()
      for (const line of numstatRaw.split('\n').filter(Boolean)) {
        const parts = line.split('\t')
        if (parts.length >= 3) {
          numstatMap.set(parts[2].trim(), {
            additions: parseInt(parts[0]) || 0,
            deletions: parseInt(parts[1]) || 0
          })
        }
      }

      // Also get untracked / staged changes via status. The NUL-delimited form
      // avoids Git quoting paths that contain spaces.
      const statusRaw = await git.raw(['status', '--porcelain', '-z'])
      const files: FileChange[] = []
      const seen = new Set<string>()

      const records = statusRaw.split('\0').filter(Boolean)
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index]
        const xy = record.slice(0, 2)
        const filePath = record.slice(3)
        if (seen.has(filePath)) continue
        seen.add(filePath)

        const indexStatus = xy[0]
        const workStatus = xy[1]
        const conflicted = isGitConflictStatus(indexStatus, workStatus)
        const status = conflicted ? 'U' : (indexStatus !== ' ' && indexStatus !== '?' ? indexStatus : workStatus) as FileChange['status']
        const counts = numstatMap.get(filePath) ?? { additions: 0, deletions: 0 }
        files.push({
          path: filePath,
          status,
          indexStatus: normalizeGitStatus(indexStatus),
          worktreeStatus: normalizeGitStatus(workStatus),
          staged: indexStatus !== ' ' && indexStatus !== '?',
          unstaged: workStatus !== ' ' || indexStatus === '?',
          conflicted,
          ...(conflicted ? { conflictStatus: xy } : {}),
          ...counts
        })
        if (indexStatus === 'R' || indexStatus === 'C') index += 1
      }

      return files
    } catch {
      return []
    }
  },

  async getDiffForFile(cwd: string, filePath: string, source: ReviewDiffSource = 'all', ref?: string): Promise<string> {
    try {
      if (!isSupportedLocalReviewSource(source)) return ''
      const git = simpleGit(cwd)
      const cleanRef = ref?.trim()
      if (source === 'branch') {
        if (!cleanRef) return ''
        return await git.diff([`${cleanRef}...HEAD`, '--', filePath])
      }
      if (source === 'commit') {
        if (!cleanRef) return ''
        return await git.raw(['show', '--format=', cleanRef, '--', filePath])
      }
      if (source === 'staged') {
        return await git.diff(['--cached', '--', filePath])
      }
      if (source === 'unstaged') {
        const unstaged = await git.diff(['--', filePath])
        if (unstaged) return unstaged
        if (await isUntracked(git, filePath)) return diffUntrackedFile(cwd, filePath)
        return ''
      }
      const diff = await git.diff(['HEAD', '--', filePath])
      if (diff) return diff
      // Staged-only (e.g. newly added file, no HEAD yet)
      const staged = await git.diff(['--cached', '--', filePath])
      if (staged) return staged
      if (await isUntracked(git, filePath)) return diffUntrackedFile(cwd, filePath)
      return ''
    } catch {
      return ''
    }
  },

  async stagePaths(cwd: string, paths: string[]): Promise<GitPathActionResult> {
    const cleanPaths = normalizePathList(paths)
    if (cleanPaths.length === 0) {
      return { ok: true, paths: [], changedFiles: await this.getChangedFiles(cwd) }
    }
    try {
      const git = simpleGit(cwd)
      await git.raw(['add', '--', ...cleanPaths])
      return { ok: true, paths: cleanPaths, changedFiles: await this.getChangedFiles(cwd) }
    } catch (error) {
      return {
        ok: false,
        paths: cleanPaths,
        changedFiles: await this.getChangedFiles(cwd),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async unstagePaths(cwd: string, paths: string[]): Promise<GitPathActionResult> {
    const cleanPaths = normalizePathList(paths)
    if (cleanPaths.length === 0) {
      return { ok: true, paths: [], changedFiles: await this.getChangedFiles(cwd) }
    }
    try {
      const git = simpleGit(cwd)
      try {
        await git.raw(['restore', '--staged', '--', ...cleanPaths])
      } catch {
        await git.raw(['reset', 'HEAD', '--', ...cleanPaths])
      }
      return { ok: true, paths: cleanPaths, changedFiles: await this.getChangedFiles(cwd) }
    } catch (error) {
      return {
        ok: false,
        paths: cleanPaths,
        changedFiles: await this.getChangedFiles(cwd),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async commitStaged(cwd: string, message: string): Promise<GitCommitResult> {
    const cleanMessage = normalizeCommitMessage(message)
    const changedFiles = await this.getChangedFiles(cwd)
    if (!cleanMessage) {
      return { ok: false, changedFiles, error: 'Enter a commit message.' }
    }
    if (!changedFiles.some((file) => file.staged)) {
      return { ok: false, changedFiles, error: 'No staged changes to commit.' }
    }

    try {
      const git = simpleGit(cwd)
      await git.raw(['commit', '-m', cleanMessage])
      const commit = (await git.raw(['rev-parse', '--short', 'HEAD'])).trim()
      return {
        ok: true,
        changedFiles: await this.getChangedFiles(cwd),
        commit,
        message: cleanMessage
      }
    } catch (error) {
      return {
        ok: false,
        changedFiles: await this.getChangedFiles(cwd),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async discardPaths(cwd: string, paths: string[]): Promise<GitPathActionResult> {
    const cleanPaths = normalizePathList(paths)
    if (cleanPaths.length === 0) {
      return { ok: true, paths: [], changedFiles: await this.getChangedFiles(cwd), discarded: false }
    }
    const unsafePath = cleanPaths.find((path) => !isSafeRelativePath(cwd, path))
    if (unsafePath) {
      return {
        ok: false,
        paths: cleanPaths,
        changedFiles: await this.getChangedFiles(cwd),
        discarded: false,
        error: `Refusing to discard unsafe path: ${unsafePath}`
      }
    }
    try {
      const git = simpleGit(cwd)
      const changedFiles = await this.getChangedFiles(cwd)
      const changedByPath = new Map(changedFiles.map((file) => [file.path, file]))
      const targetPaths = cleanPaths.filter((path) => changedByPath.has(path))
      const trackedPaths = targetPaths.filter((path) => changedByPath.get(path)?.status !== '?')
      const untrackedPaths = targetPaths.filter((path) => changedByPath.get(path)?.status === '?')
      if (trackedPaths.length > 0) {
        await git.raw(['restore', '--staged', '--worktree', '--', ...trackedPaths])
      }
      if (untrackedPaths.length > 0) {
        await git.raw(['clean', '-f', '--', ...untrackedPaths])
      }
      return {
        ok: true,
        paths: targetPaths,
        changedFiles: await this.getChangedFiles(cwd),
        discarded: targetPaths.length > 0
      }
    } catch (error) {
      return {
        ok: false,
        paths: cleanPaths,
        changedFiles: await this.getChangedFiles(cwd),
        discarded: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async blameLine(cwd: string, filePath: string, line: number): Promise<GitLineBlameResult> {
    const safeLine = Number.isSafeInteger(line) && line > 0 ? line : 1
    try {
      const git = simpleGit(cwd)
      const raw = await git.raw(['blame', '--line-porcelain', '-L', `${safeLine},${safeLine}`, '--', filePath])
      const blame = parseBlamePorcelain(raw)
      return {
        ok: true,
        path: filePath,
        line: safeLine,
        ...blame,
        summary: blame.author ? `${blame.author}${blame.commit ? ` · ${blame.commit.slice(0, 8)}` : ''}` : blame.commit?.slice(0, 8)
      }
    } catch (error) {
      return {
        ok: false,
        path: filePath,
        line: safeLine,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  },

  async getDefaultBranch(repoRoot: string): Promise<string> {
    try {
      const git = simpleGit(repoRoot)
      const result = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])
      return result.trim().replace('refs/remotes/origin/', '')
    } catch {
      return 'main'
    }
  },

  async getReviewMetadata(cwd: string): Promise<ReviewMetadata | undefined> {
    try {
      const { stdout } = await execFileAsync('gh', [
        'pr',
        'view',
        '--json',
        'id,number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup,reviewRequests,reviews,comments'
      ], {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 1024 * 1024
      })
      const view = JSON.parse(stdout)
      const metadata = reviewMetadataFromGitHubPullRequestView(view)
      const prId = stringValue(asRecord(view)?.id)
      const threadComments = prId
        ? await getGitHubReviewThreadCommentSummary(cwd, prId, metadata?.pullRequest?.url ?? null)
        : undefined
      if (metadata && threadComments?.summary) {
        metadata.comments = mergeReviewCommentSummaries(metadata.comments, threadComments.summary)
      }
      if (metadata && threadComments?.commentsByPath) {
        metadata.providerCommentsByPath = threadComments.commentsByPath
      }
      return metadata
    } catch {
      return undefined
    }
  }
}

const GITHUB_REVIEW_THREADS_QUERY = `
query($pullRequestId: ID!) {
  node(id: $pullRequestId) {
    ... on PullRequest {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          comments(first: 20) {
            nodes {
              id
              body
              author {
                login
              }
              url
              createdAt
              commit {
                oid
                abbreviatedOid
                url
                author {
                  name
                  date
                  user {
                    login
                  }
                }
              }
              originalCommit {
                oid
                abbreviatedOid
                url
                author {
                  name
                  date
                  user {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`

async function getGitHubReviewThreadCommentSummary(
  cwd: string,
  pullRequestId: string,
  url: string | null
): Promise<{ summary?: ReviewMetadata['comments']; commentsByPath?: NonNullable<ReviewMetadata['providerCommentsByPath']> } | undefined> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'api',
      'graphql',
      '-F',
      `pullRequestId=${pullRequestId}`,
      '-f',
      `query=${GITHUB_REVIEW_THREADS_QUERY}`
    ], {
      cwd,
      encoding: 'utf-8',
      timeout: 7000,
      maxBuffer: 1024 * 1024
    })
    return reviewThreadCommentMetadataFromGitHub(JSON.parse(stdout), url)
  } catch {
    return undefined
  }
}

export function reviewMetadataFromGitHubPullRequestView(value: unknown): ReviewMetadata | undefined {
  const pr = asRecord(value)
  if (!pr) return undefined
  const number = numberValue(pr.number)
  if (number === undefined) return undefined

  const url = stringValue(pr.url) ?? null
  const checks = reviewChecksFromGitHubStatusRollup(pr.statusCheckRollup, url)
  const reviewers = reviewReviewerSummaryFromGitHub(pr.reviewRequests, pr.reviews, url)
  const comments = reviewCommentSummaryFromGitHub(pr.comments, url)
  return {
    pullRequest: {
      number,
      title: stringValue(pr.title),
      url,
      state: pr.isDraft === true ? 'draft' : reviewPullRequestState(pr.state),
      branch: stringValue(pr.headRefName),
      baseBranch: stringValue(pr.baseRefName)
    },
    ...(checks ? { checks } : {}),
    ...(reviewers ? { reviewers } : {}),
    ...(comments ? { comments } : {})
  }
}

function reviewChecksFromGitHubStatusRollup(value: unknown, url: string | null): ReviewMetadata['checks'] | undefined {
  if (!Array.isArray(value)) return undefined
  const total = value.length
  if (total === 0) return undefined
  let passed = 0
  let failing = 0
  let pending = 0
  let skipped = 0
  for (const item of value) {
    const check = asRecord(item)
    const status = reviewCheckStatusFromGitHub(check)
    if (status === 'passing') passed += 1
    else if (status === 'failing') failing += 1
    else if (status === 'pending') pending += 1
    else if (status === 'skipped') skipped += 1
  }
  const status: ReviewCheckStatus = failing > 0
    ? 'failing'
    : pending > 0
      ? 'pending'
      : passed > 0
        ? 'passing'
        : skipped === total
          ? 'skipped'
          : 'unknown'
  return {
    status,
    total,
    passed,
    failing,
    pending,
    skipped,
    url
  }
}

function reviewCheckStatusFromGitHub(check: Record<string, unknown> | null): ReviewCheckStatus {
  const raw = stringValue(
    check?.conclusion,
    check?.state,
    check?.status,
    check?.workflowRun && asRecord(check.workflowRun)?.conclusion,
    check?.workflowRun && asRecord(check.workflowRun)?.status
  )?.toLowerCase().replace(/[_\s-]+/g, '_')
  if (!raw) return 'pending'
  if (raw === 'success' || raw === 'neutral') return 'passing'
  if (raw === 'skipped' || raw === 'cancelled') return 'skipped'
  if (raw === 'failure' || raw === 'startup_failure' || raw === 'timed_out' || raw === 'action_required' || raw === 'error') return 'failing'
  if (raw === 'queued' || raw === 'requested' || raw === 'waiting' || raw === 'pending' || raw === 'in_progress' || raw === 'expected') return 'pending'
  if (raw === 'completed') return 'passing'
  return 'unknown'
}

function reviewReviewerSummaryFromGitHub(
  reviewRequests: unknown,
  reviews: unknown,
  url: string | null
): ReviewMetadata['reviewers'] | undefined {
  const requestedItems = Array.isArray(reviewRequests) ? reviewRequests : []
  const reviewItems = Array.isArray(reviews) ? reviews : []
  if (requestedItems.length === 0 && reviewItems.length === 0) return undefined

  const latestReviewByAuthor = new Map<string, string>()
  for (const item of reviewItems) {
    const review = asRecord(item)
    const author = reviewAuthorName(review)
    if (!author) continue
    const state = stringValue(review?.state)?.toUpperCase()
    if (state) latestReviewByAuthor.set(author, state)
  }

  let approved = 0
  let changesRequested = 0
  let commented = 0
  const names = new Set<string>()
  for (const [author, state] of latestReviewByAuthor) {
    names.add(author)
    if (state === 'APPROVED') approved += 1
    else if (state === 'CHANGES_REQUESTED') changesRequested += 1
    else if (state === 'COMMENTED') commented += 1
  }

  for (const item of requestedItems) {
    const name = reviewRequestName(item)
    if (name) names.add(name)
  }

  return {
    requested: requestedItems.length,
    approved,
    changesRequested,
    commented,
    names: [...names].slice(0, 8),
    url
  }
}

function reviewRequestName(value: unknown): string | undefined {
  const record = asRecord(value)
  return stringValue(
    record?.login,
    record?.name,
    record?.slug,
    record?.requestedReviewer && asRecord(record.requestedReviewer)?.login,
    record?.requestedReviewer && asRecord(record.requestedReviewer)?.name,
    record?.team && asRecord(record.team)?.slug,
    record?.team && asRecord(record.team)?.name
  )
}

function reviewAuthorName(review: Record<string, unknown> | null): string | undefined {
  const author = asRecord(review?.author)
  return stringValue(author?.login, author?.name, review?.author)
}

function reviewCommentSummaryFromGitHub(value: unknown, url: string | null): ReviewMetadata['comments'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const authors = new Set<string>()
  let commentUrl: string | null = null
  for (const item of value) {
    const comment = asRecord(item)
    const author = reviewAuthorName(comment)
    if (author) authors.add(author)
    commentUrl = commentUrl ?? stringValue(comment?.url, comment?.htmlUrl) ?? null
  }
  return {
    total: value.length,
    authors: [...authors].slice(0, 8),
    url: commentUrl ?? url
  }
}

export function reviewThreadCommentSummaryFromGitHub(value: unknown, url: string | null): ReviewMetadata['comments'] | undefined {
  return reviewThreadCommentMetadataFromGitHub(value, url)?.summary
}

export function reviewThreadCommentMetadataFromGitHub(
  value: unknown,
  url: string | null
): { summary?: ReviewMetadata['comments']; commentsByPath?: NonNullable<ReviewMetadata['providerCommentsByPath']> } | undefined {
  const root = asRecord(value)
  const data = asRecord(root?.data)
  const node = asRecord(data?.node) ?? asRecord(root?.node) ?? root
  const reviewThreads = asRecord(node?.reviewThreads)
  const threadNodes = Array.isArray(reviewThreads?.nodes) ? reviewThreads.nodes : []
  if (threadNodes.length === 0) return undefined

  const authors = new Set<string>()
  let total = 0
  let unresolved = 0
  let commentUrl: string | null = null
  const commentsByPath: NonNullable<ReviewMetadata['providerCommentsByPath']> = {}
  for (const item of threadNodes) {
    const thread = asRecord(item)
    if (!thread) continue
    const resolved = thread.isResolved === true
    if (!resolved) unresolved += 1
    const path = stringValue(thread.path)
    const lineNumber = numberValue(thread.line) ?? numberValue(thread.originalLine)
    const startLine = numberValue(thread.startLine) ?? numberValue(thread.originalStartLine)
    const side = reviewThreadCommentSide(thread.diffSide)
    const comments = asRecord(thread.comments)
    const commentNodes = Array.isArray(comments?.nodes) ? comments.nodes : []
    total += commentNodes.length
    for (const [index, commentItem] of commentNodes.entries()) {
      const comment = asRecord(commentItem)
      if (!comment) continue
      const author = reviewAuthorName(comment)
      if (author) authors.add(author)
      commentUrl = commentUrl ?? stringValue(comment?.url) ?? null
      const body = stringValue(comment?.body)
      if (!path || lineNumber === undefined || !body) continue
      const createdAt = stringValue(comment?.createdAt)
      const blame = reviewProviderBlameFromGitHubComment(comment)
      const providerComment = {
        id: stringValue(comment?.id, comment?.url) ?? `${path}:${side}:${lineNumber}:${index}`,
        source: 'github' as const,
        path,
        side,
        ...(startLine !== undefined && startLine !== lineNumber ? { startLine } : {}),
        lineNumber,
        body,
        ...(author ? { author } : {}),
        url: stringValue(comment?.url) ?? url,
        resolved,
        outdated: thread.isOutdated === true,
        ...(createdAt ? { createdAt } : {}),
        ...(blame ? { blame } : {})
      }
      commentsByPath[path] = [...(commentsByPath[path] ?? []), providerComment]
    }
  }
  if (total === 0 && unresolved === 0) return undefined
  const summary = {
    total,
    unresolved,
    threads: threadNodes.length,
    authors: [...authors].slice(0, 8),
    url: commentUrl ?? url
  }
  return {
    summary,
    ...(Object.keys(commentsByPath).length > 0 ? { commentsByPath } : {})
  }
}

function reviewThreadCommentSide(value: unknown): 'old' | 'new' {
  const raw = stringValue(value)?.toUpperCase()
  return raw === 'LEFT' ? 'old' : 'new'
}

function reviewProviderBlameFromGitHubComment(comment: Record<string, unknown>): ReviewProviderBlame | undefined {
  const commit = asRecord(comment.originalCommit) ?? asRecord(comment.commit)
  if (!commit) return undefined
  const author = asRecord(commit.author)
  const user = asRecord(author?.user)
  const oid = stringValue(commit.oid)
  const abbreviatedOid = stringValue(commit.abbreviatedOid)
  const authorName = stringValue(user?.login, author?.name)
  const authoredAt = stringValue(author?.date)
  const blame: ReviewProviderBlame = {
    source: 'github' as const,
    ...(oid ? { commit: oid } : {}),
    ...(abbreviatedOid ? { abbreviatedCommit: abbreviatedOid } : {}),
    ...(authorName ? { author: authorName } : {}),
    ...(authoredAt ? { authoredAt } : {}),
    url: stringValue(commit.url) ?? null
  }
  return Object.keys(blame).some((key) => key !== 'source' && key !== 'url') ? blame : undefined
}

export function mergeReviewCommentSummaries(
  first: ReviewMetadata['comments'] | undefined,
  second: ReviewMetadata['comments'] | undefined
): ReviewMetadata['comments'] | undefined {
  if (!first) return second
  if (!second) return first
  const authors = new Set<string>()
  for (const author of first.authors ?? []) authors.add(author)
  for (const author of second.authors ?? []) authors.add(author)
  const unresolved = (first.unresolved ?? 0) + (second.unresolved ?? 0)
  const threads = (first.threads ?? 0) + (second.threads ?? 0)
  return {
    total: first.total + second.total,
    ...(unresolved > 0 ? { unresolved } : {}),
    ...(threads > 0 ? { threads } : {}),
    authors: [...authors].slice(0, 8),
    url: second.url ?? first.url ?? null
  }
}

function reviewPullRequestState(value: unknown): NonNullable<ReviewMetadata['pullRequest']>['state'] {
  const raw = stringValue(value)?.toLowerCase()
  if (raw === 'merged') return 'merged'
  if (raw === 'closed') return 'closed'
  return 'open'
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function normalizePathList(paths: string[]): string[] {
  const seen = new Set<string>()
  const clean: string[] = []
  for (const path of paths) {
    const value = path.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    clean.push(value)
  }
  return clean
}

function normalizeCommitMessage(message: string): string {
  return message
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function normalizeBranchName(branchName: string): string {
  return branchName.trim()
}

function isSafeRelativePath(cwd: string, filePath: string): boolean {
  if (filePath.startsWith('/') || filePath.includes('\0')) return false
  const root = resolve(cwd)
  const target = resolve(cwd, filePath)
  return target !== root && target.startsWith(`${root}${sep}`)
}

async function getChangedFilesForGitDiff(git: ReturnType<typeof simpleGit>, diffArgs: string[]): Promise<FileChange[]> {
  const [nameStatusRaw, numstatRaw] = await Promise.all([
    git.raw(['diff', '--name-status', ...diffArgs]).catch(() => ''),
    git.raw(['diff', '--numstat', ...diffArgs]).catch(() => '')
  ])
  return changedFilesFromDiffOutput(nameStatusRaw, numstatRaw)
}

async function getChangedFilesForCommit(git: ReturnType<typeof simpleGit>, ref: string): Promise<FileChange[]> {
  const [nameStatusRaw, numstatRaw] = await Promise.all([
    git.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', ref]).catch(() => ''),
    git.raw(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', ref]).catch(() => '')
  ])
  return changedFilesFromDiffOutput(nameStatusRaw, numstatRaw)
}

function changedFilesFromDiffOutput(nameStatusRaw: string, numstatRaw: string): FileChange[] {
  const counts = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstatRaw.split('\n').filter(Boolean)) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const path = parts.at(-1)?.trim()
    if (!path) continue
    counts.set(path, {
      additions: parseGitNumstatCount(parts[0]),
      deletions: parseGitNumstatCount(parts[1])
    })
  }

  return nameStatusRaw.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t')
    const rawStatus = parts[0] ?? 'M'
    const path = (parts.at(-1) ?? '').trim()
    const status = normalizeDiffNameStatus(rawStatus)
    const stat = counts.get(path) ?? { additions: 0, deletions: 0 }
    return {
      path,
      status,
      indexStatus: status,
      worktreeStatus: ' ' as const,
      staged: false,
      unstaged: false,
      ...stat
    }
  }).filter((file) => file.path.length > 0)
}

function parseGitNumstatCount(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeDiffNameStatus(status: string): FileChange['status'] {
  const normalized = status.trim()[0]
  if (normalized === 'U') return 'U'
  if (normalized === 'A' || normalized === 'D' || normalized === 'R' || normalized === '?') return normalized
  return 'M'
}

function normalizeGitStatus(status: string): FileChange['indexStatus'] {
  if (status === 'M' || status === 'A' || status === 'D' || status === 'R' || status === 'C' || status === '?' || status === 'U' || status === ' ') {
    return status
  }
  return ' '
}

function isGitConflictStatus(indexStatus: string, worktreeStatus: string): boolean {
  return indexStatus === 'U' ||
    worktreeStatus === 'U' ||
    (indexStatus === 'A' && worktreeStatus === 'A') ||
    (indexStatus === 'D' && worktreeStatus === 'D')
}

function isSupportedLocalReviewSource(source: ReviewDiffSource): boolean {
  return source === 'all' || source === 'unstaged' || source === 'staged' || source === 'branch' || source === 'commit'
}

async function isUntracked(git: ReturnType<typeof simpleGit>, filePath: string): Promise<boolean> {
  const output = await git.raw(['ls-files', '--others', '--exclude-standard', '--', filePath]).catch(() => '')
  return output.split('\n').some((path) => path.trim() === filePath)
}

function diffUntrackedFile(cwd: string, filePath: string): string {
  // git diff --no-index exits 1 when content differs, so read stdout directly.
  const absPath = join(cwd, filePath)
  const result = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', absPath], {
    cwd,
    encoding: 'utf-8'
  })
  return result.stdout ?? ''
}

function formatGitRelativeDate(unixSeconds: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  const elapsedDays = Math.floor(elapsedSeconds / 86400)
  if (elapsedDays <= 0) return 'today'
  if (elapsedDays === 1) return '1 day ago'
  if (elapsedDays < 30) return `${elapsedDays} days ago`
  const elapsedMonths = Math.floor(elapsedDays / 30)
  if (elapsedMonths === 1) return '1 month ago'
  if (elapsedMonths < 12) return `${elapsedMonths} months ago`
  const elapsedYears = Math.floor(elapsedDays / 365)
  return elapsedYears === 1 ? '1 year ago' : `${elapsedYears} years ago`
}

function parseBlamePorcelain(raw: string): Pick<GitLineBlameResult, 'commit' | 'author' | 'authorTime'> {
  const lines = raw.split('\n')
  const first = lines[0]?.trim().split(/\s+/)[0]
  const commit = first && !/^0+$/.test(first) ? first : undefined
  let author: string | undefined
  let authorTime: number | undefined
  for (const line of lines) {
    if (line.startsWith('author ')) author = line.slice('author '.length).trim()
    if (line.startsWith('author-time ')) {
      const parsed = Number.parseInt(line.slice('author-time '.length), 10)
      if (Number.isFinite(parsed)) authorTime = parsed
    }
  }
  return { commit, author, authorTime }
}
