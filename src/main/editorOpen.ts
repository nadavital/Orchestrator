export interface OpenPathOptions {
  line?: number
  column?: number
}

export function editorFileUrl(scheme: string | undefined, filePath: string, options: OpenPathOptions): string | null {
  if (!scheme || !hasValidLineTarget(options)) return null
  const column = editorTargetColumn(options)
  return `${scheme}://file${encodeURI(filePath)}:${options.line}:${column}`
}

export function editorPathTarget(filePath: string, options: OpenPathOptions): string {
  if (!hasValidLineTarget(options)) return filePath
  return `${filePath}:${options.line}:${editorTargetColumn(options)}`
}

export function hasValidLineTarget(options: OpenPathOptions): boolean {
  return Boolean(options.line && Number.isSafeInteger(options.line))
}

function editorTargetColumn(options: OpenPathOptions): number {
  return options.column && Number.isSafeInteger(options.column) ? options.column : 1
}
