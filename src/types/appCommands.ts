export type ChatSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type StableAppCommand =
  | 'open-command-menu'
  | 'new-chat'
  | 'search-transcript'
  | 'open-file-search'
  | 'focus-browser-address-bar'
  | 'browser-reload-page'
  | 'browser-hard-reload-page'
  | 'browser-navigate-back'
  | 'browser-navigate-forward'
  | 'rename-chat'
  | 'toggle-chat-pin'
  | 'previous-chat'
  | 'next-chat'
  | 'previous-recent-chat'
  | 'next-recent-chat'
  | 'toggle-inspector'
  | 'open-browser-tab'
  | 'toggle-browser-panel'
  | 'open-review-tab'
  | 'toggle-terminal'
  | 'close-active-panel-tab'
  | 'settings'
  | 'keyboard-shortcuts'

export type AppMenuCommand = StableAppCommand | `go-chat-${ChatSlot}`
export type AppCommandAvailability = Partial<Record<StableAppCommand, boolean>>

export interface AppMenuCommandState {
  command: StableAppCommand
  label: string
  accelerator?: string
  enabled: boolean
  visible: boolean
}

export type ShortcutToken = 'mod' | 'shift' | 'alt' | 'ctrl' | string
export type ShortcutSequence = readonly ShortcutToken[]
export interface ShortcutOverrideRecord {
  shortcuts?: readonly ShortcutSequence[]
  disabledDefaults?: readonly ShortcutSequence[]
}
export type ShortcutOverrideValue = ShortcutSequence | readonly ShortcutSequence[] | ShortcutOverrideRecord
export type ShortcutOverrides = Partial<Record<StableAppCommand, ShortcutOverrideValue>>

export interface AppCommandDefinition {
  id: StableAppCommand
  label: string
  menuLabel?: string
  group: 'App' | 'Chat' | 'Navigation' | 'Panels'
  description: string
  shortcuts: readonly ShortcutSequence[]
  accelerator?: string
  keywords?: readonly string[]
  showInShortcuts?: boolean
}

export interface ShortcutKeyboardEvent {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

export const APP_COMMANDS: Record<StableAppCommand, AppCommandDefinition> = {
  'open-command-menu': {
    id: 'open-command-menu',
    label: 'Command Palette',
    group: 'App',
    description: 'Open commands from anywhere in the workspace.',
    shortcuts: [['mod', 'K'], ['mod', 'shift', 'P']],
    accelerator: 'CmdOrCtrl+K',
    keywords: ['command', 'palette', 'actions'],
    showInShortcuts: true
  },
  'keyboard-shortcuts': {
    id: 'keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    group: 'App',
    description: 'Open the shortcuts reference in Settings.',
    shortcuts: [['mod', 'shift', '/']],
    accelerator: 'CmdOrCtrl+Shift+/',
    keywords: ['settings', 'keybindings'],
    showInShortcuts: true
  },
  settings: {
    id: 'settings',
    label: 'Open Settings',
    menuLabel: 'Settings',
    group: 'App',
    description: 'Open general app settings.',
    shortcuts: [['mod', ',']],
    accelerator: 'CmdOrCtrl+,',
    keywords: ['preferences'],
    showInShortcuts: true
  },
  'new-chat': {
    id: 'new-chat',
    label: 'New Chat',
    group: 'Chat',
    description: 'Start a fresh chat in the current project.',
    shortcuts: [['mod', 'N']],
    accelerator: 'CmdOrCtrl+N',
    keywords: ['thread', 'session'],
    showInShortcuts: true
  },
  'rename-chat': {
    id: 'rename-chat',
    label: 'Rename Chat',
    group: 'Chat',
    description: 'Rename the active sidebar chat.',
    shortcuts: [['mod', 'alt', 'R'], ['Double-click']],
    accelerator: 'CmdOrCtrl+Alt+R',
    keywords: ['thread', 'session', 'title'],
    showInShortcuts: true
  },
  'toggle-chat-pin': {
    id: 'toggle-chat-pin',
    label: 'Pin or Unpin Chat',
    group: 'Chat',
    description: 'Toggle the active chat in the pinned list.',
    shortcuts: [['mod', 'alt', 'P']],
    accelerator: 'CmdOrCtrl+Alt+P',
    keywords: ['thread', 'session', 'favorite', 'pinned'],
    showInShortcuts: true
  },
  'search-transcript': {
    id: 'search-transcript',
    label: 'Search Transcript',
    menuLabel: 'Find in Chat',
    group: 'Navigation',
    description: 'Find text in the current chat.',
    shortcuts: [['mod', 'F']],
    accelerator: 'CmdOrCtrl+F',
    keywords: ['find', 'history'],
    showInShortcuts: true
  },
  'open-file-search': {
    id: 'open-file-search',
    label: 'Open File Search',
    menuLabel: 'Search Files',
    group: 'Navigation',
    description: 'Open the workspace file search in the Workbench.',
    shortcuts: [['mod', 'P']],
    accelerator: 'CmdOrCtrl+P',
    keywords: ['file', 'workspace', 'quick open'],
    showInShortcuts: true
  },
  'focus-browser-address-bar': {
    id: 'focus-browser-address-bar',
    label: 'Focus Browser Address Bar',
    menuLabel: 'Focus Browser Address Bar',
    group: 'Navigation',
    description: 'Focus the active Browser tab address field when the Browser panel is focused.',
    shortcuts: [['mod', 'L']],
    accelerator: 'CmdOrCtrl+L',
    keywords: ['browser', 'address', 'url', 'location'],
    showInShortcuts: true
  },
  'browser-reload-page': {
    id: 'browser-reload-page',
    label: 'Reload Browser Page',
    menuLabel: 'Reload Browser Page',
    group: 'Navigation',
    description: 'Reload the active Browser tab when the Browser panel is focused.',
    shortcuts: [['mod', 'R']],
    accelerator: 'CmdOrCtrl+R',
    keywords: ['browser', 'reload', 'refresh'],
    showInShortcuts: true
  },
  'browser-hard-reload-page': {
    id: 'browser-hard-reload-page',
    label: 'Force Reload Browser Page',
    menuLabel: 'Force Reload Browser Page',
    group: 'Navigation',
    description: 'Reload the active Browser tab without cache when the Browser panel is focused.',
    shortcuts: [['mod', 'shift', 'R']],
    accelerator: 'CmdOrCtrl+Shift+R',
    keywords: ['browser', 'reload', 'refresh', 'cache'],
    showInShortcuts: true
  },
  'browser-navigate-back': {
    id: 'browser-navigate-back',
    label: 'Browser Back',
    menuLabel: 'Back',
    group: 'Navigation',
    description: 'Go back in the active Browser tab when the Browser panel is focused.',
    shortcuts: [['mod', '[']],
    accelerator: 'CmdOrCtrl+[',
    keywords: ['browser', 'back', 'history'],
    showInShortcuts: true
  },
  'browser-navigate-forward': {
    id: 'browser-navigate-forward',
    label: 'Browser Forward',
    menuLabel: 'Forward',
    group: 'Navigation',
    description: 'Go forward in the active Browser tab when the Browser panel is focused.',
    shortcuts: [['mod', ']']],
    accelerator: 'CmdOrCtrl+]',
    keywords: ['browser', 'forward', 'history'],
    showInShortcuts: true
  },
  'previous-chat': {
    id: 'previous-chat',
    label: 'Previous Chat',
    group: 'Navigation',
    description: 'Switch to the previous recent chat.',
    shortcuts: [['mod', 'shift', '['], ['ctrl', 'shift', 'Tab']],
    accelerator: 'CmdOrCtrl+Shift+[',
    keywords: ['thread', 'session', 'recent'],
    showInShortcuts: true
  },
  'next-chat': {
    id: 'next-chat',
    label: 'Next Chat',
    group: 'Navigation',
    description: 'Switch to the next recent chat.',
    shortcuts: [['mod', 'shift', ']'], ['ctrl', 'Tab']],
    accelerator: 'CmdOrCtrl+Shift+]',
    keywords: ['thread', 'session', 'recent'],
    showInShortcuts: true
  },
  'previous-recent-chat': {
    id: 'previous-recent-chat',
    label: 'Previous Recent Chat',
    group: 'Navigation',
    description: 'Switch to the previous recent chat.',
    shortcuts: [['ctrl', 'shift', 'Tab']],
    accelerator: 'Ctrl+Shift+Tab',
    keywords: ['thread', 'session', 'recent']
  },
  'next-recent-chat': {
    id: 'next-recent-chat',
    label: 'Next Recent Chat',
    group: 'Navigation',
    description: 'Switch to the next recent chat.',
    shortcuts: [['ctrl', 'Tab']],
    accelerator: 'Ctrl+Tab',
    keywords: ['thread', 'session', 'recent']
  },
  'toggle-inspector': {
    id: 'toggle-inspector',
    label: 'Toggle Inspector',
    group: 'Panels',
    description: 'Show or hide Diff, Agents, Plan, and detail panels.',
    shortcuts: [['mod', 'B']],
    accelerator: 'CmdOrCtrl+B',
    keywords: ['sidebar', 'diff', 'agents'],
    showInShortcuts: true
  },
  'open-browser-tab': {
    id: 'open-browser-tab',
    label: 'New Panel Tab',
    group: 'Panels',
    description: 'Open Browser from the main chat, or create a new focused Browser or Terminal tab from panel focus.',
    shortcuts: [['mod', 'T']],
    accelerator: 'CmdOrCtrl+T',
    keywords: ['browser', 'terminal', 'tab', 'web'],
    showInShortcuts: true
  },
  'toggle-browser-panel': {
    id: 'toggle-browser-panel',
    label: 'Toggle Browser Panel',
    group: 'Panels',
    description: 'Show or hide the Browser Workbench tab.',
    shortcuts: [['mod', 'shift', 'B']],
    accelerator: 'CmdOrCtrl+Shift+B',
    keywords: ['browser', 'panel', 'web'],
    showInShortcuts: true
  },
  'open-review-tab': {
    id: 'open-review-tab',
    label: 'Open Review Tab',
    group: 'Panels',
    description: 'Open the Review Workbench tab for current changes.',
    shortcuts: [],
    keywords: ['review', 'changes', 'diff']
  },
  'toggle-terminal': {
    id: 'toggle-terminal',
    label: 'Toggle Terminal',
    group: 'Panels',
    description: 'Show or hide the terminal pane.',
    shortcuts: [['mod', 'J'], ['mod', '`']],
    accelerator: 'CmdOrCtrl+J',
    keywords: ['shell'],
    showInShortcuts: true
  },
  'close-active-panel-tab': {
    id: 'close-active-panel-tab',
    label: 'Close Active Panel Tab',
    group: 'Panels',
    description: 'Close the active Workbench or Terminal tab when that panel is focused.',
    shortcuts: [['mod', 'W']],
    keywords: ['tab', 'panel', 'workbench', 'terminal'],
    showInShortcuts: true
  }
}

export const GO_CHAT_SHORTCUT_ROW = {
  id: 'go-chat-range',
  label: 'Go to Chat 1-9',
  group: 'Navigation',
  description: 'Jump directly to a recent sidebar chat.',
  shortcuts: [['mod', '1-9']] as const,
  keywords: ['thread', 'session', 'recent']
}

export function commandShortcuts(command: StableAppCommand, overrides: ShortcutOverrides = {}): readonly ShortcutSequence[] {
  const disabledDefaults = shortcutDisabledDefaultSequences(command, overrides)
  const defaults = APP_COMMANDS[command].shortcuts.filter((sequence) => {
    return !disabledDefaults.some((disabled) => shortcutSequencesEqual(disabled, sequence))
  })
  return [...shortcutOverrideSequences(command, overrides), ...defaults]
}

export function shortcutOverrideSequences(command: StableAppCommand, overrides: ShortcutOverrides = {}): readonly ShortcutSequence[] {
  const override = overrides[command]
  if (!override) return []
  if (isShortcutOverrideRecord(override)) return (override.shortcuts ?? []).filter((sequence) => sequence.length > 0)
  if (isShortcutSequenceList(override)) return override.filter((sequence) => sequence.length > 0)
  return override.length > 0 ? [override] : []
}

export function shortcutDisabledDefaultSequences(command: StableAppCommand, overrides: ShortcutOverrides = {}): readonly ShortcutSequence[] {
  const override = overrides[command]
  if (!override || !isShortcutOverrideRecord(override)) return []
  return (override.disabledDefaults ?? []).filter((sequence) => sequence.length > 0)
}

export function shortcutOverrideRecord(command: StableAppCommand, overrides: ShortcutOverrides = {}): ShortcutOverrideRecord {
  return {
    shortcuts: shortcutOverrideSequences(command, overrides),
    disabledDefaults: shortcutDisabledDefaultSequences(command, overrides)
  }
}

export function appCommandDefinitions(overrides: ShortcutOverrides = {}): AppCommandDefinition[] {
  return Object.values(APP_COMMANDS).map((command) => ({
    ...command,
    shortcuts: commandShortcuts(command.id, overrides)
  }))
}

export function visibleShortcutRows(overrides: ShortcutOverrides = {}): Array<AppCommandDefinition | typeof GO_CHAT_SHORTCUT_ROW> {
  const rows = appCommandDefinitions(overrides).filter((command) => command.showInShortcuts)
  const nextChatIndex = rows.findIndex((command) => command.id === 'next-chat')
  if (nextChatIndex === -1) return [...rows, GO_CHAT_SHORTCUT_ROW]
  return [
    ...rows.slice(0, nextChatIndex + 1),
    GO_CHAT_SHORTCUT_ROW,
    ...rows.slice(nextChatIndex + 1)
  ]
}

export function formatShortcutSequence(sequence: ShortcutSequence, platform: 'mac' | 'other' = 'mac'): string {
  return formatShortcutKeys(sequence, platform).join('')
}

export function shortcutSequenceToAccelerator(sequence: ShortcutSequence): string {
  return sequence.map((key) => {
    if (key === 'mod') return 'CmdOrCtrl'
    if (key === 'shift') return 'Shift'
    if (key === 'alt') return 'Alt'
    if (key === 'ctrl') return 'Ctrl'
    if (key === 'Space') return 'Space'
    if (key === 'Up') return 'Up'
    if (key === 'Down') return 'Down'
    if (key === 'Left') return 'Left'
    if (key === 'Right') return 'Right'
    return key
  }).join('+')
}

export function formatShortcutKeys(sequence: ShortcutSequence, platform: 'mac' | 'other' = 'mac'): string[] {
  return sequence.map((key) => {
    if (key === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl'
    if (key === 'shift') return '⇧'
    if (key === 'alt') return platform === 'mac' ? '⌥' : 'Alt'
    if (key === 'ctrl') return platform === 'mac' ? '⌃' : 'Ctrl'
    return key
  })
}

export function appMenuCommandForKeyboardEvent(event: ShortcutKeyboardEvent, overrides: ShortcutOverrides = {}): AppMenuCommand | null {
  const key = event.key.toLowerCase()
  if (hasModifier(event, 'mod') && !event.altKey && !event.shiftKey && /^[1-9]$/.test(key)) {
    return `go-chat-${Number(key) as ChatSlot}`
  }
  for (const command of appCommandDefinitions(overrides)) {
    if (command.shortcuts.some((shortcut) => shortcutMatchesEvent(shortcut, event))) return command.id
  }
  return null
}

export function findShortcutConflict(
  sequence: ShortcutSequence,
  command: StableAppCommand,
  overrides: ShortcutOverrides = {}
): AppCommandDefinition | null {
  for (const candidate of Object.values(APP_COMMANDS)) {
    if (candidate.id === command) continue
    if (commandShortcuts(candidate.id, overrides).some((shortcut) => shortcutSequencesEqual(shortcut, sequence))) {
      return candidate
    }
  }
  return null
}

export function shortcutSequencesEqual(a: ShortcutSequence, b: ShortcutSequence): boolean {
  if (a.length !== b.length) return false
  return a.every((token, index) => token.toLowerCase() === b[index]?.toLowerCase())
}

export function shortcutSequenceFromKeyboardEvent(
  event: ShortcutKeyboardEvent,
  platform: 'mac' | 'other' = 'mac'
): ShortcutSequence | null {
  const key = shortcutTokenFromEvent(event)
  if (!key) return null
  const sequence: ShortcutToken[] = []
  if (platform === 'mac') {
    if (event.metaKey) sequence.push('mod')
    if (event.ctrlKey) sequence.push('ctrl')
  } else if (event.ctrlKey || event.metaKey) {
    sequence.push('mod')
  }
  if (event.altKey) sequence.push('alt')
  if (event.shiftKey) sequence.push('shift')
  if (!sequence.some((token) => token === 'mod' || token === 'ctrl' || token === 'alt')) return null
  sequence.push(key)
  return sequence
}

export function shortcutMatchesEvent(sequence: ShortcutSequence, event: ShortcutKeyboardEvent): boolean {
  const shortcut = new Set(sequence.map((token) => token.toLowerCase()))
  const requiresMod = shortcut.has('mod')
  const requiresShift = shortcut.has('shift')
  const requiresAlt = shortcut.has('alt')
  const requiresCtrl = shortcut.has('ctrl')
  const ctrlUsedAsMod = requiresMod && !event.metaKey && Boolean(event.ctrlKey)
  const actualCtrl = Boolean(event.ctrlKey && !ctrlUsedAsMod)
  const actualMod = Boolean(event.metaKey || (event.ctrlKey && !requiresCtrl))

  if (requiresMod !== actualMod) return false
  if (requiresShift !== Boolean(event.shiftKey)) return false
  if (requiresAlt !== Boolean(event.altKey)) return false
  if (requiresCtrl !== actualCtrl) return false

  const keyToken = sequence.find((token) => !['mod', 'shift', 'alt', 'ctrl'].includes(token.toLowerCase()))
  return Boolean(keyToken && keyTokenMatchesEvent(keyToken, event))
}

function hasModifier(event: ShortcutKeyboardEvent, modifier: 'mod'): boolean {
  if (modifier === 'mod') return Boolean(event.metaKey || event.ctrlKey)
  return false
}

function keyTokenMatchesEvent(token: string, event: ShortcutKeyboardEvent): boolean {
  const expected = token.toLowerCase()
  const key = event.key.toLowerCase()
  const code = event.code?.toLowerCase()
  if (expected === 'space') return key === ' '
  if (expected === 'up') return key === 'arrowup'
  if (expected === 'down') return key === 'arrowdown'
  if (expected === 'left') return key === 'arrowleft'
  if (expected === 'right') return key === 'arrowright'
  if (expected === 'tab') return key === 'tab'
  if (expected === '[') return key === '[' || code === 'bracketleft'
  if (expected === ']') return key === ']' || code === 'bracketright'
  if (expected === '/') return key === '/' || key === '?' || code === 'slash'
  if (expected === '`') return key === '`' || code === 'backquote'
  return key === expected
}

function shortcutTokenFromEvent(event: ShortcutKeyboardEvent): string | null {
  const key = event.key
  const code = event.code
  if (!key || ['Meta', 'Control', 'Alt', 'Shift', 'Escape', 'Backspace', 'Delete'].includes(key)) return null
  if (code === 'Slash') return '/'
  if (code === 'Backquote') return '`'
  if (code === 'BracketLeft') return '['
  if (code === 'BracketRight') return ']'
  if (code === 'Minus') return '-'
  if (code === 'Equal') return '='
  if (code === 'Semicolon') return ';'
  if (code === 'Quote') return "'"
  if (code === 'Comma') return ','
  if (code === 'Period') return '.'
  const digit = code?.match(/^Digit([0-9])$/)?.[1]
  if (digit) return digit
  if (key === ' ') return 'Space'
  if (key === 'ArrowUp') return 'Up'
  if (key === 'ArrowDown') return 'Down'
  if (key === 'ArrowLeft') return 'Left'
  if (key === 'ArrowRight') return 'Right'
  if (key.length === 1) return /^[a-z]$/i.test(key) ? key.toUpperCase() : key
  return key
}

function isShortcutSequenceList(value: ShortcutOverrideValue): value is readonly ShortcutSequence[] {
  if (isShortcutOverrideRecord(value)) return false
  return Array.isArray(value[0])
}

function isShortcutOverrideRecord(value: ShortcutOverrideValue): value is ShortcutOverrideRecord {
  return typeof value === 'object' && !Array.isArray(value)
}
