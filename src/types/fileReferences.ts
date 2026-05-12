export interface FileReference {
  path: string
  label: string
  source: 'absolute' | 'relative'
}

const ABSOLUTE_PATH_PATTERN = /(^|[\s([{"'`])((?:\/Users|\/Volumes|\/private|\/tmp|\/var|\/opt|\/usr|\/etc|\/home)\/[^`"'\s)\]}<>]+)/g
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g
const QUOTED_PATH_PATTERN = /["']([^"'\n]*?(?:\/|~\/)[^"'\n]*?\.[A-Za-z0-9]{1,12})["']/g
const TILDE_PATH_PATTERN = /(^|[\s([{"'`])(~\/[^`"'\s)\]}<>]+)/g

export function extractFileReferences(content: string, cwd?: string): FileReference[] {
  const refs = new Map<string, FileReference>()
  const searchable = content.replace(/```[\s\S]*?```/g, ' ')

  for (const value of wholeLinePathCandidates(searchable)) {
    addPathReference(refs, value, cwd, true)
  }

  for (const match of searchable.matchAll(QUOTED_PATH_PATTERN)) {
    addPathReference(refs, match[1], cwd, true)
  }

  for (const match of searchable.matchAll(TILDE_PATH_PATTERN)) {
    addReference(refs, cleanPath(match[2]), 'absolute')
  }

  for (const match of searchable.matchAll(ABSOLUTE_PATH_PATTERN)) {
    if (isProbablyTruncatedBySpace(searchable, match)) continue
    addReference(refs, cleanPath(match[2]), 'absolute')
  }

  if (cwd) {
    for (const match of searchable.matchAll(INLINE_CODE_PATTERN)) {
      const value = match[1]?.trim()
      if (!value) continue
      addPathReference(refs, value, cwd, true)
    }
  }

  return [...refs.values()]
}

export function extractWorkspaceRootsFromText(content: string, cwd?: string): string[] {
  const roots = new Set<string>()
  const searchable = content.replace(/```[\s\S]*?```/g, ' ')

  if (cwd) roots.add(cwd.replace(/\/+$/, ''))
  for (const value of wholeLinePathCandidates(searchable)) {
    const root = likelyWorkspaceRoot(cleanPath(value), cwd)
    if (root) roots.add(root)
  }
  for (const match of searchable.matchAll(QUOTED_PATH_PATTERN)) {
    const root = likelyWorkspaceRoot(cleanPath(match[1]), cwd)
    if (root) roots.add(root)
  }
  for (const match of searchable.matchAll(TILDE_PATH_PATTERN)) {
    const root = likelyWorkspaceRoot(cleanPath(match[2]), cwd)
    if (root) roots.add(root)
  }
  for (const match of searchable.matchAll(ABSOLUTE_PATH_PATTERN)) {
    if (isProbablyTruncatedBySpace(searchable, match)) continue
    const root = likelyWorkspaceRoot(cleanPath(match[2]), cwd)
    if (root) roots.add(root)
  }

  return [...roots]
}

function addReference(refs: Map<string, FileReference>, rawPath: string, source: FileReference['source']): void {
  const path = cleanPath(rawPath)
  if (!path || path.includes('://') || refs.has(path)) return
  refs.set(path, {
    path,
    label: path.split('/').filter(Boolean).at(-1) ?? path,
    source
  })
}

function addPathReference(
  refs: Map<string, FileReference>,
  rawPath: string,
  cwd: string | undefined,
  allowSpaces: boolean
): void {
  const path = cleanPath(rawPath)
  if (!path) return
  if (path.startsWith('/')) {
    addReference(refs, path, 'absolute')
    return
  }
  if (path.startsWith('~/')) {
    addReference(refs, path, 'absolute')
    return
  }
  if (!cwd || !looksLikeRelativeFile(path, allowSpaces)) return
  addReference(refs, resolveRelativePath(cwd, path), 'relative')
}

function cleanPath(value: string): string {
  let path = value.trim()
  path = path.replace(/^["'`({[]+/, '')
  path = path.replace(/["'`)}\]]+$/, '')
  path = path.replace(/[.,;:!?]+$/, '')
  return path
}

function looksLikeRelativeFile(value: string, allowSpaces = false): boolean {
  if (value.startsWith('/') || value.startsWith('-') || value.includes('://')) return false
  if (!allowSpaces && /\s/.test(value)) return false
  if (!/[A-Za-z0-9_-]\.[A-Za-z0-9]{1,12}$/.test(value)) return false
  return value.includes('/') || /^[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,12}$/.test(value)
}

function wholeLinePathCandidates(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const stripped = line.replace(/^\s*(?:[-*]\s+|\d+\.\s+|>\s*)/, '')
      return {
        path: cleanPath(stripped),
        wasQuoted: /^["']/.test(stripped.trim())
      }
    })
    .filter(({ path: line, wasQuoted }) => {
      if (!line || line.includes('://')) return false
      if (line.startsWith('/') || line.startsWith('~/')) return /[A-Za-z0-9_-]\.[A-Za-z0-9]{1,12}$/.test(line)
      return looksLikeRelativeFile(line, wasQuoted)
    })
    .map(({ path }) => path)
}

function isProbablyTruncatedBySpace(content: string, match: RegExpMatchArray): boolean {
  const prefix = match[1] ?? ''
  const candidate = match[2] ?? ''
  const start = match.index ?? 0
  const end = start + prefix.length + candidate.length
  return /^ [A-Za-z0-9_.@-]+\//.test(content.slice(end, end + 80))
}

function resolveRelativePath(cwd: string, value: string): string {
  const base = cwd.replace(/\/+$/, '')
  const cleaned = value.replace(/^\.\//, '')
  return `${base}/${cleaned}`
}

function likelyWorkspaceRoot(path: string, cwd?: string): string | null {
  const normalizedCwd = cwd?.replace(/\/+$/, '')
  if (normalizedCwd && (path === normalizedCwd || path.startsWith(`${normalizedCwd}/`))) {
    return normalizedCwd
  }

  const desktopProject = path.match(/^(\/Users\/[^/]+\/Desktop\/[^/]+)/)
  if (desktopProject) return desktopProject[1]

  const documentsProject = path.match(/^(\/Users\/[^/]+\/Documents\/[^/]+)/)
  if (documentsProject) return documentsProject[1]

  const tmpProject = path.match(/^(\/(?:private\/)?tmp\/[^/]+)/)
  if (tmpProject) return tmpProject[1]

  return null
}
