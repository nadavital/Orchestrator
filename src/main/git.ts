import { simpleGit } from 'simple-git'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
import type { FileChange, GitPathActionResult } from '../types'

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

  async createWorktree(repoRoot: string, sessionId: string): Promise<string> {
    const worktreesDir = join(repoRoot, '.orchestrator-worktrees')
    mkdirSync(worktreesDir, { recursive: true })
    const worktreePath = join(worktreesDir, sessionId)
    const branchName = `orchestrator/${sessionId.slice(0, 8)}`
    const git = simpleGit(repoRoot)
    await git.raw(['worktree', 'add', worktreePath, '-b', branchName])
    return worktreePath
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

  async getChangedFiles(cwd: string): Promise<FileChange[]> {
    try {
      const git = simpleGit(cwd)

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
        const status = (indexStatus !== ' ' && indexStatus !== '?' ? indexStatus : workStatus) as FileChange['status']
        const counts = numstatMap.get(filePath) ?? { additions: 0, deletions: 0 }
        files.push({
          path: filePath,
          status,
          indexStatus: normalizeGitStatus(indexStatus),
          worktreeStatus: normalizeGitStatus(workStatus),
          staged: indexStatus !== ' ' && indexStatus !== '?',
          unstaged: workStatus !== ' ' || indexStatus === '?',
          ...counts
        })
        if (indexStatus === 'R' || indexStatus === 'C') index += 1
      }

      return files
    } catch {
      return []
    }
  },

  async getDiffForFile(cwd: string, filePath: string): Promise<string> {
    try {
      const git = simpleGit(cwd)
      const diff = await git.diff(['HEAD', '--', filePath])
      if (diff) return diff
      // Staged-only (e.g. newly added file, no HEAD yet)
      const staged = await git.diff(['--cached', '--', filePath])
      if (staged) return staged
      // Untracked file — git diff --no-index always exits 1 when content differs
      const absPath = join(cwd, filePath)
      const result = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', absPath], {
        cwd,
        encoding: 'utf-8'
      })
      return result.stdout ?? ''
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

  async getDefaultBranch(repoRoot: string): Promise<string> {
    try {
      const git = simpleGit(repoRoot)
      const result = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])
      return result.trim().replace('refs/remotes/origin/', '')
    } catch {
      return 'main'
    }
  }
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

function normalizeGitStatus(status: string): FileChange['indexStatus'] {
  if (status === 'M' || status === 'A' || status === 'D' || status === 'R' || status === 'C' || status === '?' || status === ' ') {
    return status
  }
  return ' '
}
