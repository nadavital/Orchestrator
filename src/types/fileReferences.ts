export interface FileReference {
  path: string
  label: string
  source: 'absolute' | 'relative'
}

const ABSOLUTE_PATH_PATTERN = /(^|[\s([{"'`])((?:\/Users|\/Volumes|\/private|\/tmp|\/var|\/opt|\/usr|\/etc|\/home)\/[^`"'\s)\]}<>]+)/g
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g

export function extractFileReferences(content: string, cwd?: string): FileReference[] {
  const refs = new Map<string, FileReference>()
  const searchable = content.replace(/```[\s\S]*?```/g, ' ')

  for (const match of searchable.matchAll(ABSOLUTE_PATH_PATTERN)) {
    addReference(refs, cleanPath(match[2]), 'absolute')
  }

  if (cwd) {
    for (const match of searchable.matchAll(INLINE_CODE_PATTERN)) {
      const value = match[1]?.trim()
      if (!value || !looksLikeRelativeFile(value)) continue
      addReference(refs, resolveRelativePath(cwd, value), 'relative')
    }
  }

  return [...refs.values()]
}

export function extractWorkspaceRootsFromText(content: string, cwd?: string): string[] {
  const roots = new Set<string>()
  const searchable = content.replace(/```[\s\S]*?```/g, ' ')

  if (cwd) roots.add(cwd.replace(/\/+$/, ''))
  for (const match of searchable.matchAll(ABSOLUTE_PATH_PATTERN)) {
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

function cleanPath(value: string): string {
  let path = value.trim()
  path = path.replace(/^["'`({[]+/, '')
  path = path.replace(/["'`)}\]]+$/, '')
  path = path.replace(/[.,;:!?]+$/, '')
  return path
}

function looksLikeRelativeFile(value: string): boolean {
  if (value.startsWith('/') || value.startsWith('-') || value.includes('://')) return false
  if (/\s/.test(value)) return false
  if (!/[A-Za-z0-9_-]\.[A-Za-z0-9]{1,12}$/.test(value)) return false
  return value.includes('/') || /^[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,12}$/.test(value)
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
