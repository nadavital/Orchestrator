export interface OpenPathOptions {
  line?: number
  column?: number
}

export type PreferredOpenTarget = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
export type OpenTargetId = Exclude<PreferredOpenTarget, 'system'>

export interface EditorOpenTarget {
  id: OpenTargetId
  label: string
  macAppName: string
  urlScheme?: string
  cli?: {
    commands: string[]
    target: 'file-line-column'
  }
}

export const EDITOR_OPEN_TARGETS: Record<OpenTargetId, EditorOpenTarget> = {
  vscode: { id: 'vscode', label: 'VS Code', macAppName: 'Visual Studio Code', urlScheme: 'vscode' },
  'vscode-insiders': { id: 'vscode-insiders', label: 'VS Code Insiders', macAppName: 'Visual Studio Code - Insiders', urlScheme: 'vscode-insiders' },
  cursor: { id: 'cursor', label: 'Cursor', macAppName: 'Cursor', urlScheme: 'cursor' },
  zed: {
    id: 'zed',
    label: 'Zed',
    macAppName: 'Zed',
    cli: {
      commands: ['zed', '/opt/homebrew/bin/zed', '/usr/local/bin/zed', '/Applications/Zed.app/Contents/MacOS/cli'],
      target: 'file-line-column'
    }
  }
}

export function normalizePreferredOpenTarget(value: unknown): PreferredOpenTarget {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

export function editorOpenTarget(value: unknown): EditorOpenTarget | null {
  const target = normalizePreferredOpenTarget(value)
  return target === 'system' ? null : EDITOR_OPEN_TARGETS[target]
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

export function editorCliTargets(target: EditorOpenTarget, filePath: string, options: OpenPathOptions): string[] {
  if (!target.cli || !hasValidLineTarget(options)) return []
  if (target.cli.target === 'file-line-column') return [editorPathTarget(filePath, options)]
  return []
}

function editorTargetColumn(options: OpenPathOptions): number {
  return options.column && Number.isSafeInteger(options.column) ? options.column : 1
}
