export type TerminalThemeKey =
  | 'background'
  | 'foreground'
  | 'cursor'
  | 'selectionBackground'
  | 'selectionInactiveBackground'
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'

export type TerminalThemeTokenResolver = (token: string) => string | undefined

export type TerminalThemeTokenMap = Partial<Record<TerminalThemeKey, string>>

export const TERMINAL_THEME_TOKEN_MAP: ReadonlyArray<readonly [TerminalThemeKey, string]> = [
  ['background', '--vscode-terminal-background'],
  ['foreground', '--vscode-terminal-foreground'],
  ['cursor', '--vscode-terminal-foreground'],
  ['selectionBackground', '--vscode-terminal-selectionBackground'],
  ['selectionInactiveBackground', '--vscode-terminal-inactiveSelectionBackground'],
  ['black', '--vscode-terminal-ansiBlack'],
  ['red', '--vscode-terminal-ansiRed'],
  ['green', '--vscode-terminal-ansiGreen'],
  ['yellow', '--vscode-terminal-ansiYellow'],
  ['blue', '--vscode-terminal-ansiBlue'],
  ['magenta', '--vscode-terminal-ansiMagenta'],
  ['cyan', '--vscode-terminal-ansiCyan'],
  ['white', '--vscode-terminal-ansiWhite'],
  ['brightBlack', '--vscode-terminal-ansiBrightBlack'],
  ['brightRed', '--vscode-terminal-ansiBrightRed'],
  ['brightGreen', '--vscode-terminal-ansiBrightGreen'],
  ['brightYellow', '--vscode-terminal-ansiBrightYellow'],
  ['brightBlue', '--vscode-terminal-ansiBrightBlue'],
  ['brightMagenta', '--vscode-terminal-ansiBrightMagenta'],
  ['brightCyan', '--vscode-terminal-ansiBrightCyan'],
  ['brightWhite', '--vscode-terminal-ansiBrightWhite']
]

export function createTerminalThemeFromTokens(
  resolveToken: TerminalThemeTokenResolver,
  fallback: TerminalThemeTokenMap = {}
): TerminalThemeTokenMap {
  const theme: TerminalThemeTokenMap = {}
  for (const [key, token] of TERMINAL_THEME_TOKEN_MAP) {
    const value = resolveToken(token) ?? fallback[key]
    if (value) theme[key] = value
  }
  if (!theme.selectionInactiveBackground && theme.selectionBackground) {
    theme.selectionInactiveBackground = theme.selectionBackground
  }
  return theme
}

export function serializeTerminalThemeMatrix(theme: TerminalThemeTokenMap): string {
  return JSON.stringify(Object.fromEntries(
    TERMINAL_THEME_TOKEN_MAP.map(([key]) => [key, theme[key] ?? null])
  ))
}
