import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createTerminalThemeFromTokens,
  serializeTerminalThemeMatrix,
  TERMINAL_THEME_TOKEN_MAP
} from '../../types/terminalAppearance'

test('terminal theme token map mirrors the Codex VS Code terminal matrix', () => {
  assert.deepEqual(TERMINAL_THEME_TOKEN_MAP, [
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
  ])
})

test('terminal theme resolver prefers token values and falls back only when missing', () => {
  const values = new Map<string, string>([
    ['--vscode-terminal-background', 'rgb(1, 2, 3)'],
    ['--vscode-terminal-foreground', 'rgb(4, 5, 6)'],
    ['--vscode-terminal-ansiRed', 'rgb(7, 8, 9)']
  ])
  const theme = createTerminalThemeFromTokens((token) => values.get(token), {
    background: 'fallback-background',
    foreground: 'fallback-foreground',
    red: 'fallback-red',
    green: 'fallback-green',
    selectionBackground: 'fallback-selection'
  })

  assert.equal(theme.background, 'rgb(1, 2, 3)')
  assert.equal(theme.foreground, 'rgb(4, 5, 6)')
  assert.equal(theme.cursor, 'rgb(4, 5, 6)')
  assert.equal(theme.red, 'rgb(7, 8, 9)')
  assert.equal(theme.green, 'fallback-green')
  assert.equal(theme.selectionInactiveBackground, 'fallback-selection')
})

test('terminal theme matrix serialization keeps every key inspectable for smoke tests', () => {
  const theme = createTerminalThemeFromTokens((token) => `${token}:resolved`)
  const serialized = JSON.parse(serializeTerminalThemeMatrix(theme)) as Record<string, string | null>

  assert.equal(Object.keys(serialized).length, TERMINAL_THEME_TOKEN_MAP.length)
  assert.equal(serialized.background, '--vscode-terminal-background:resolved')
  assert.equal(serialized.brightWhite, '--vscode-terminal-ansiBrightWhite:resolved')
})
