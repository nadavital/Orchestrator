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
