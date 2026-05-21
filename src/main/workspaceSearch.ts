import { readdir, stat } from 'fs/promises'
import { isAbsolute, join, normalize, sep } from 'path'
import type { WorkspaceSearchEntry, WorkspaceSearchRequest, WorkspaceSearchResult } from '../types'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.hg',
  '.idea',
  '.next',
  '.pnpm-store',
  '.svn',
  '.turbo',
  '.venv',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'out-test',
  'target'
])

const DEFAULT_LIMIT = 1200
const MAX_LIMIT = 3000
const MAX_VISITED_ENTRIES = 25000

interface Candidate extends WorkspaceSearchEntry {
  score: number
}

export async function searchWorkspace(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult> {
  const startedAt = Date.now()
  const root = normalize(request.root)
  const query = (request.query ?? '').trim()
  const normalizedQuery = normalizeQuery(query)
  const limit = clampLimit(request.limit)
  const includeDirectories = request.includeDirectories ?? normalizedQuery.length === 0
  const includeHidden = request.includeHidden ?? false
  const entries: WorkspaceSearchEntry[] = []
  const candidates: Candidate[] = []
  let visited = 0
  let truncated = false

  if (!root || isAbsolute(root) === false) {
    return emptyResult(root, query, startedAt)
  }

  async function visit(relativeDir: string, depth: number): Promise<void> {
    if (visited >= MAX_VISITED_ENTRIES || (entries.length >= limit && normalizedQuery.length === 0)) {
      truncated = true
      return
    }

    const absoluteDir = relativeDir ? join(root, relativeDir) : root
    let children: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }>
    try {
      children = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }

    children.sort(compareDirents)
    for (const child of children) {
      if (visited >= MAX_VISITED_ENTRIES) {
        truncated = true
        return
      }
      if (child.isSymbolicLink()) continue
      if (shouldSkipEntry(child.name, child.isDirectory(), includeHidden)) continue

      visited += 1
      const path = relativeDir ? `${relativeDir}/${child.name}` : child.name
      const depthForEntry = splitPath(path).length - 1
      if (child.isDirectory()) {
        const directoryEntry: WorkspaceSearchEntry = {
          path,
          name: child.name,
          kind: 'directory',
          depth: depthForEntry
        }
        addEntry(directoryEntry)
        await visit(path, depth + 1)
        continue
      }
      if (!child.isFile()) continue

      const entry: WorkspaceSearchEntry = {
        path,
        name: child.name,
        kind: 'file',
        depth: depthForEntry,
        size: await fileSize(join(root, path))
      }
      addEntry(entry)
    }
  }

  function addEntry(entry: WorkspaceSearchEntry): void {
    if (normalizedQuery.length === 0) {
      if (entries.length < limit) entries.push(entry)
      else truncated = true
      return
    }

    if (entry.kind === 'directory' && !includeDirectories) return
    const score = scoreWorkspaceEntry(entry, normalizedQuery)
    if (score === null) return
    candidates.push({ ...entry, score })
  }

  await visit('', 0)

  const finalEntries = normalizedQuery.length === 0
    ? entries
    : candidates
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
      .slice(0, limit)
      .map((entry) => ({ ...entry }))

  if (normalizedQuery.length > 0 && candidates.length > limit) truncated = true

  return {
    root,
    query,
    entries: finalEntries,
    visited,
    truncated,
    durationMs: Date.now() - startedAt
  }
}

function emptyResult(root: string, query: string, startedAt: number): WorkspaceSearchResult {
  return {
    root,
    query,
    entries: [],
    visited: 0,
    truncated: false,
    durationMs: Date.now() - startedAt
  }
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(Math.floor(limit ?? DEFAULT_LIMIT), MAX_LIMIT))
}

function compareDirents(
  a: { name: string; isDirectory: () => boolean },
  b: { name: string; isDirectory: () => boolean }
): number {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
  return a.name.localeCompare(b.name)
}

function shouldSkipEntry(name: string, isDirectory: boolean, includeHidden: boolean): boolean {
  if (isDirectory && IGNORED_DIRECTORIES.has(name)) return true
  if (!includeHidden && name.startsWith('.')) return true
  return false
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
    return undefined
  }
}

function scoreWorkspaceEntry(entry: WorkspaceSearchEntry, normalizedQuery: string): number | null {
  const name = normalizeQuery(entry.name)
  const path = normalizeQuery(entry.path)
  const compactName = compact(name)
  const compactPath = compact(path)
  const compactQuery = compact(normalizedQuery)
  let score = 0

  if (name === normalizedQuery) score += 500
  if (name.startsWith(normalizedQuery)) score += 260
  if (name.includes(normalizedQuery)) score += 180
  if (path.includes(normalizedQuery)) score += 90
  if (compactName.includes(compactQuery)) score += 130
  if (compactPath.includes(compactQuery)) score += 70

  const fuzzyName = fuzzyScore(compactName, compactQuery)
  const fuzzyPath = fuzzyScore(compactPath, compactQuery)
  score += Math.max(fuzzyName * 1.5, fuzzyPath)

  if (score <= 0) return null
  score += entry.kind === 'file' ? 20 : 0
  score -= entry.depth * 2
  return score
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replaceAll(sep, '/')
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]/g, '')
}

function fuzzyScore(value: string, query: string): number {
  if (!query) return 0
  let valueIndex = 0
  let run = 0
  let score = 0
  for (const char of query) {
    const nextIndex = value.indexOf(char, valueIndex)
    if (nextIndex === -1) return 0
    run = nextIndex === valueIndex ? run + 1 : 1
    score += 12 + run * 4 - Math.min(nextIndex - valueIndex, 8)
    valueIndex = nextIndex + 1
  }
  return score
}

function splitPath(value: string): string[] {
  return normalize(value).split(sep).filter(Boolean)
}
