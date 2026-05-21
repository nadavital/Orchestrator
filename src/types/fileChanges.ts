import type { FileChange } from './index'

export interface FileChangeSummary {
  total: number
  added: number
  modified: number
  deleted: number
  renamed: number
  untracked: number
  additions: number
  deletions: number
  risk: 'low' | 'medium' | 'high'
  label: string
}

export type FileChangeTreeRow =
  | {
      type: 'directory'
      id: string
      path: string
      name: string
      depth: number
      fileCount: number
      additions: number
      deletions: number
    }
  | {
      type: 'file'
      id: string
      path: string
      name: string
      depth: number
      file: FileChange
    }

export function summarizeFileChanges(files: FileChange[]): FileChangeSummary {
  const summary: FileChangeSummary = {
    total: files.length,
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    additions: 0,
    deletions: 0,
    risk: 'low',
    label: 'No changes'
  }

  for (const file of files) {
    summary.additions += file.additions
    summary.deletions += file.deletions
    if (file.status === 'A') summary.added += 1
    if (file.status === 'M') summary.modified += 1
    if (file.status === 'D') summary.deleted += 1
    if (file.status === 'R') summary.renamed += 1
    if (file.status === '?') summary.untracked += 1
  }

  summary.risk = summary.deleted > 0 ? 'high' : summary.additions + summary.deletions > 250 ? 'medium' : 'low'
  summary.label = fileChangeLabel(summary)
  return summary
}

export function fileStatusLabel(status: FileChange['status']): string {
  if (status === 'A') return 'Added'
  if (status === 'M') return 'Modified'
  if (status === 'D') return 'Deleted'
  if (status === 'R') return 'Renamed'
  return 'Untracked'
}

export function buildFileChangeTreeRows(files: FileChange[]): FileChangeTreeRow[] {
  const directoryStats = new Map<string, { fileCount: number; additions: number; deletions: number }>()
  for (const file of files) {
    for (const directoryPath of directoryAncestors(file.path)) {
      const current = directoryStats.get(directoryPath) ?? { fileCount: 0, additions: 0, deletions: 0 }
      current.fileCount += 1
      current.additions += file.additions
      current.deletions += file.deletions
      directoryStats.set(directoryPath, current)
    }
  }

  const rows: FileChangeTreeRow[] = []
  const emittedDirectories = new Set<string>()
  for (const file of files) {
    for (const directoryPath of directoryAncestors(file.path)) {
      if (emittedDirectories.has(directoryPath)) continue
      emittedDirectories.add(directoryPath)
      const parts = directoryPath.split('/')
      const stats = directoryStats.get(directoryPath) ?? { fileCount: 0, additions: 0, deletions: 0 }
      rows.push({
        type: 'directory',
        id: `directory:${directoryPath}`,
        path: directoryPath,
        name: parts[parts.length - 1] ?? directoryPath,
        depth: parts.length - 1,
        fileCount: stats.fileCount,
        additions: stats.additions,
        deletions: stats.deletions
      })
    }

    const parts = file.path.split('/').filter(Boolean)
    rows.push({
      type: 'file',
      id: `file:${file.path}`,
      path: file.path,
      name: parts[parts.length - 1] ?? file.path,
      depth: Math.max(0, parts.length - 1),
      file
    })
  }

  return rows
}

function fileChangeLabel(summary: FileChangeSummary): string {
  if (summary.total === 0) return 'No changes'
  const parts: string[] = []
  if (summary.modified > 0) parts.push(`${summary.modified} modified`)
  if (summary.added > 0) parts.push(`${summary.added} added`)
  if (summary.deleted > 0) parts.push(`${summary.deleted} deleted`)
  if (summary.renamed > 0) parts.push(`${summary.renamed} renamed`)
  if (summary.untracked > 0) parts.push(`${summary.untracked} untracked`)
  return parts.join(' · ')
}

function directoryAncestors(filePath: string): string[] {
  const parts = filePath.split('/').filter(Boolean)
  const ancestors: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join('/'))
  }
  return ancestors
}
