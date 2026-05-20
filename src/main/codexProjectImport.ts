import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, join, normalize, resolve } from 'path'

export interface CodexProjectCandidate {
  name: string
  rootPath: string
  threadName?: string
  updatedAt?: string
}

interface CodexSessionMeta {
  timestamp?: string
  payload?: {
    cwd?: string
    thread_name?: string
    timestamp?: string
  }
}

interface SessionFile {
  path: string
  mtimeMs: number
}

interface DiscoverOptions {
  homeDir?: string
  maxFiles?: number
  maxCandidates?: number
}

const DEFAULT_MAX_FILES = 1200
const DEFAULT_MAX_CANDIDATES = 12

export function discoverCodexProjectCandidates(options: DiscoverOptions = {}): CodexProjectCandidate[] {
  const homeDir = options.homeDir ?? homedir()
  const codexDir = join(homeDir, '.codex')
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  const sessionRoots = [join(codexDir, 'sessions'), join(codexDir, 'archived_sessions')]
  const files = sessionRoots
    .flatMap((root) => collectJsonlFiles(root, maxFiles))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)

  const seenRoots = new Set<string>()
  const candidates: CodexProjectCandidate[] = []

  for (const file of files) {
    const meta = readSessionMeta(file.path)
    const cwd = meta?.payload?.cwd
    if (!cwd || !isImportableWorkspace(cwd, homeDir)) continue

    const rootPath = normalizeWorkspacePath(cwd)
    const key = rootPath.toLowerCase()
    if (seenRoots.has(key)) continue

    seenRoots.add(key)
    candidates.push({
      name: basename(rootPath) || rootPath,
      rootPath,
      threadName: meta?.payload?.thread_name,
      updatedAt: meta?.timestamp ?? meta?.payload?.timestamp
    })
    if (candidates.length >= maxCandidates) break
  }

  return candidates
}

function collectJsonlFiles(root: string, maxFiles: number): SessionFile[] {
  const files: SessionFile[] = []
  const visit = (dir: string): void => {
    if (files.length >= maxFiles || !existsSync(dir)) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      if (files.length >= maxFiles) return
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      try {
        files.push({ path, mtimeMs: statSync(path).mtimeMs })
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }

  visit(root)
  return files
}

function readSessionMeta(path: string): CodexSessionMeta | null {
  try {
    const firstLine = readFirstLine(path)
    if (!firstLine) return null
    const parsed = JSON.parse(firstLine) as { type?: string; payload?: unknown; timestamp?: string }
    if (parsed.type !== 'session_meta') return null
    return parsed as CodexSessionMeta
  } catch {
    return null
  }
}

function readFirstLine(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0] ?? ''
  } finally {
    closeSync(fd)
  }
}

function isImportableWorkspace(path: string, homeDir: string): boolean {
  if (!path.startsWith('/')) return false
  const normalizedPath = normalizeWorkspacePath(path)
  const codexPath = normalizeWorkspacePath(join(homeDir, '.codex'))
  if (normalizedPath === codexPath || normalizedPath.startsWith(`${codexPath}/`)) return false
  if (normalizedPath.startsWith('/private/tmp/') || normalizedPath.startsWith('/tmp/')) return false
  if (normalizedPath.startsWith('/private/var/folders/')) return false

  try {
    return statSync(normalizedPath).isDirectory()
  } catch {
    return false
  }
}

export function normalizeWorkspacePath(path: string): string {
  return normalize(resolve(path)).replace(/\/+$/, '')
}
