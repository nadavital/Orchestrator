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
