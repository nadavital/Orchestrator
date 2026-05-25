import type { FileChange } from './index'

export const REVIEW_LARGE_DIFF_CHANGED_LINE_THRESHOLD = 15000
export const REVIEW_LARGE_DIFF_CHANGED_BYTE_THRESHOLD = 3 * 1024 * 1024
export const REVIEW_LARGE_DIFF_MAX_CHANGED_LINE_BYTES = 1024 * 1024
export const REVIEW_LARGE_DIFF_INITIAL_LINE_COUNT = 600
export const REVIEW_LARGE_DIFF_LINE_THRESHOLD = REVIEW_LARGE_DIFF_CHANGED_LINE_THRESHOLD

export interface ReviewDiffRenderWindow<TLine = string> {
  lines: TLine[]
  totalLineCount: number
  renderedLineCount: number
  limited: boolean
  changedLineCount: number
  changedBytes: number
  maxChangedLineBytes: number
}

export function resolveReviewDiffRenderWindow<TLine>(
  lines: TLine[],
  expanded: boolean,
  options: {
    changedLineThreshold?: number
    changedByteThreshold?: number
    initialLineCount?: number
    lineThreshold?: number
    maxChangedLineBytes?: number
  } = {}
): ReviewDiffRenderWindow<TLine> {
  const changedLineThreshold = options.changedLineThreshold ?? options.lineThreshold ?? REVIEW_LARGE_DIFF_CHANGED_LINE_THRESHOLD
  const changedByteThreshold = options.changedByteThreshold ?? REVIEW_LARGE_DIFF_CHANGED_BYTE_THRESHOLD
  const maxChangedLineBytesThreshold = options.maxChangedLineBytes ?? REVIEW_LARGE_DIFF_MAX_CHANGED_LINE_BYTES
  const initialLineCount = options.initialLineCount ?? REVIEW_LARGE_DIFF_INITIAL_LINE_COUNT
  const metrics = reviewDiffChangedLineMetrics(lines)
  const shouldLimit = !expanded && (
    metrics.changedLineCount > changedLineThreshold ||
    metrics.changedBytes > changedByteThreshold ||
    metrics.maxChangedLineBytes > maxChangedLineBytesThreshold
  )
  const renderedLineCount = shouldLimit ? Math.max(1, Math.min(initialLineCount, lines.length)) : lines.length
  return {
    lines: shouldLimit ? lines.slice(0, renderedLineCount) : lines,
    totalLineCount: lines.length,
    renderedLineCount,
    limited: shouldLimit,
    ...metrics
  }
}

function reviewDiffChangedLineMetrics<TLine>(lines: TLine[]): {
  changedLineCount: number
  changedBytes: number
  maxChangedLineBytes: number
} {
  let changedLineCount = 0
  let changedBytes = 0
  let maxChangedLineBytes = 0
  for (const rawLine of lines) {
    const line = String(rawLine)
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (!line.startsWith('+') && !line.startsWith('-')) continue
    const contentLength = Math.max(0, line.length - 1)
    changedLineCount += 1
    changedBytes += contentLength
    maxChangedLineBytes = Math.max(maxChangedLineBytes, contentLength)
  }
  return { changedLineCount, changedBytes, maxChangedLineBytes }
}

export function parseFileChangesFromUnifiedDiff(diffText: string): FileChange[] {
  return splitUnifiedDiffFiles(diffText)
    .map((entry) => {
      const header = parseDiffHeader(entry)
      if (!header) return null
      const status = diffStatus(entry)
      const path = status === 'D' ? header.oldPath : header.newPath
      const { additions, deletions } = diffLineCounts(entry)
      return {
        path,
        status,
        additions,
        deletions
      } satisfies FileChange
    })
    .filter((entry): entry is FileChange => entry !== null)
}

export function diffForPathFromUnifiedDiff(diffText: string, filePath: string): string {
  return splitUnifiedDiffFiles(diffText)
    .find((entry) => {
      const header = parseDiffHeader(entry)
      return header?.oldPath === filePath || header?.newPath === filePath
    }) ?? ''
}

function splitUnifiedDiffFiles(diffText: string): string[] {
  const lines = diffText.split(/\r?\n/)
  const entries: string[][] = []
  let current: string[] | null = null

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current && current.length > 0) entries.push(current)
      current = [line]
      continue
    }
    if (current) current.push(line)
  }

  if (current && current.length > 0) entries.push(current)
  return entries.map((entry) => entry.join('\n')).filter((entry) => entry.trim().length > 0)
}

function parseDiffHeader(entry: string): { oldPath: string; newPath: string } | null {
  const firstLine = entry.split(/\r?\n/, 1)[0] ?? ''
  const match = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(firstLine)
  if (!match) return null
  return {
    oldPath: unescapeGitPath(match[1]),
    newPath: unescapeGitPath(match[2])
  }
}

function diffStatus(entry: string): FileChange['status'] {
  if (/^new file mode /m.test(entry)) return 'A'
  if (/^deleted file mode /m.test(entry)) return 'D'
  if (/^rename from /m.test(entry) || /^rename to /m.test(entry)) return 'R'
  return 'M'
}

function diffLineCounts(entry: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of entry.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

function unescapeGitPath(path: string): string {
  return path.replace(/\\"/g, '"')
}
