import { readFile, readdir, stat } from 'fs/promises'
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
const MAX_CONTENT_SEARCH_BYTES = 128 * 1024
const MAX_CONTENT_LINE_LENGTH = 320

interface Candidate extends WorkspaceSearchEntry {
  score: number
}

interface ContentMatch {
  line: number
  text: string
  exact: boolean
}

export async function searchWorkspace(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult> {
  const startedAt = Date.now()
  const root = normalize(request.root)
  const host = request.host
  const query = (request.query ?? '').trim()
  const normalizedQuery = normalizeQuery(query)
  const limit = clampLimit(request.limit)
  const includeDirectories = request.includeDirectories ?? normalizedQuery.length === 0
  const includeHidden = request.includeHidden ?? false
  const includeContentMatches = request.includeContentMatches === true && normalizedQuery.length > 0
  const lazyDirectories = request.lazyDirectories === true && normalizedQuery.length === 0
  const expandedDirectories = new Set((request.expandedDirectories ?? []).map(normalizeRelativePath).filter((path) => path.length > 0))
  const entries: WorkspaceSearchEntry[] = []
  const candidates: Candidate[] = []
  let visited = 0
  let truncated = false

  if (!root || isAbsolute(root) === false) {
    return emptyResult(root, host, query, startedAt)
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
        const shouldLoadChildren = !lazyDirectories || expandedDirectories.has(path)
        const directoryEntry: WorkspaceSearchEntry = {
          host,
          path,
          name: child.name,
          kind: 'directory',
          depth: depthForEntry,
          hasChildren: await directoryHasVisibleChildren(join(root, path), includeHidden),
          loaded: shouldLoadChildren
        }
        await addEntry(directoryEntry, join(root, path))
        if (shouldLoadChildren) await visit(path, depth + 1)
        continue
      }
      if (!child.isFile()) continue
      const absolutePath = join(root, path)
      const size = await fileSize(absolutePath)

      const entry: WorkspaceSearchEntry = {
        host,
        path,
        name: child.name,
        kind: 'file',
        depth: depthForEntry,
        size
      }
      await addEntry(entry, absolutePath)
    }
  }

  async function addEntry(entry: WorkspaceSearchEntry, absolutePath: string): Promise<void> {
    if (normalizedQuery.length === 0) {
      if (entries.length < limit) entries.push(entry)
      else truncated = true
      return
    }

    if (entry.kind === 'directory' && !includeDirectories) return
    const score = scoreWorkspaceEntry(entry, normalizedQuery)
    if (score !== null) {
      candidates.push({ ...entry, matchKind: 'path', score })
      return
    }
    if (!includeContentMatches || entry.kind !== 'file') return
    const contentMatch = await findContentMatch(absolutePath, normalizedQuery, entry.size)
    if (!contentMatch) return
    candidates.push({
      ...entry,
      matchKind: 'content',
      matchLine: contentMatch.line,
      matchText: contentMatch.text,
      score: contentMatch.exact ? 85 : 58
    })
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
    host,
    query,
    entries: finalEntries,
    visited,
    truncated,
    durationMs: Date.now() - startedAt
  }
}

function emptyResult(root: string, host: string | undefined, query: string, startedAt: number): WorkspaceSearchResult {
  return {
    root,
    host,
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

async function findContentMatch(
  path: string,
  normalizedQuery: string,
  size: number | undefined
): Promise<ContentMatch | null> {
  if (!Number.isFinite(size) || size === undefined || size <= 0 || size > MAX_CONTENT_SEARCH_BYTES) return null
  const query = normalizedQuery.trim()
  if (!query) return null
  const terms = query.split(/\s+/).filter(Boolean)
  try {
    const buffer = await readFile(path)
    if (buffer.includes(0)) return null
    const text = buffer.toString('utf8')
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index] ?? ''
      const line = rawLine.trim()
      if (!line) continue
      const normalizedLine = normalizeQuery(line)
      const exact = normalizedLine.includes(query)
      const tokenMatch = !exact && terms.length > 1 && terms.every((term) => normalizedLine.includes(term))
      if (!exact && !tokenMatch) continue
      return {
        line: index + 1,
        text: line.length > MAX_CONTENT_LINE_LENGTH ? `${line.slice(0, MAX_CONTENT_LINE_LENGTH - 3)}...` : line,
        exact
      }
    }
  } catch {
    return null
  }
  return null
}

async function directoryHasVisibleChildren(path: string, includeHidden: boolean): Promise<boolean> {
  try {
    const children = await readdir(path, { withFileTypes: true })
    return children.some((child) => {
      if (child.isSymbolicLink()) return false
      if (!child.isDirectory() && !child.isFile()) return false
      return !shouldSkipEntry(child.name, child.isDirectory(), includeHidden)
    })
  } catch {
    return false
  }
}

function normalizeRelativePath(value: string): string {
  return normalize(value).replaceAll(sep, '/').replace(/^\/+|\/+$/g, '')
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
