import { existsSync, readdirSync, statSync } from 'fs'
import { basename, isAbsolute, join, normalize, relative, sep } from 'path'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.next',
  '.turbo',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'out-test',
  'target'
])

const MAX_VISITED_ENTRIES = 25000

export function resolveWorkspaceFileReference(cwd: string, filePath: string): string | null {
  if (!cwd || !filePath) return null

  const root = normalize(cwd)
  const literalPath = normalize(isAbsolute(filePath) ? filePath : join(root, filePath))
  if (pathExistsAsFile(literalPath)) return literalPath

  const hint = referenceHint(root, literalPath, filePath)
  const hintParts = splitPath(hint)
  const targetName = hintParts.at(-1) ?? basename(literalPath)
  if (!targetName || targetName === '.' || targetName === '..') return null

  const matches: Array<{ path: string; score: number }> = []
  let visited = 0

  const visit = (dir: string): void => {
    if (visited >= MAX_VISITED_ENTRIES) return

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (visited >= MAX_VISITED_ENTRIES) return
      visited += 1

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(fullPath)
        continue
      }

      if (!entry.isFile() || entry.name !== targetName) continue
      const relParts = splitPath(relative(root, fullPath))
      const score = suffixScore(relParts, hintParts)
      matches.push({ path: fullPath, score })
    }
  }

  visit(root)

  matches.sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return matches[0]?.path ?? null
}

function pathExistsAsFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

function referenceHint(root: string, literalPath: string, original: string): string {
  if (!isAbsolute(original)) return original.replace(/^\.\//, '')

  const rel = relative(root, literalPath)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel
  return basename(literalPath)
}

function splitPath(value: string): string[] {
  return normalize(value)
    .split(sep)
    .filter((part) => part && part !== '.')
}

function suffixScore(candidate: string[], hint: string[]): number {
  if (hint.length === 0) return 1000

  let matched = 0
  while (
    matched < hint.length &&
    matched < candidate.length &&
    candidate[candidate.length - 1 - matched] === hint[hint.length - 1 - matched]
  ) {
    matched += 1
  }

  return (hint.length - matched) * 100 + candidate.length
}
