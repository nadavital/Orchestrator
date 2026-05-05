import { simpleGit } from 'simple-git'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { spawnSync } from 'child_process'
import type { FileChange } from '../types'

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

      // Also get untracked / staged changes via status
      const statusRaw = await git.raw(['status', '--porcelain'])
      const files: FileChange[] = []
      const seen = new Set<string>()

      for (const line of statusRaw.split('\n').filter(Boolean)) {
        const xy = line.slice(0, 2)
        const filePath = line.slice(3).trim().split(' -> ').pop()!
        if (seen.has(filePath)) continue
        seen.add(filePath)

        const indexStatus = xy[0]
        const workStatus = xy[1]
        const status = (indexStatus !== ' ' && indexStatus !== '?' ? indexStatus : workStatus) as FileChange['status']
        const counts = numstatMap.get(filePath) ?? { additions: 0, deletions: 0 }
        files.push({ path: filePath, status, ...counts })
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
