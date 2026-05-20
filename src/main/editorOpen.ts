export interface OpenPathOptions {
  line?: number
  column?: number
}

export function editorFileUrl(scheme: string | undefined, filePath: string, options: OpenPathOptions): string | null {
  if (!scheme || !options.line || !Number.isSafeInteger(options.line)) return null
  const column = options.column && Number.isSafeInteger(options.column) ? options.column : 1
  return `${scheme}://file${encodeURI(filePath)}:${options.line}:${column}`
}
