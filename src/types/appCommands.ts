export type ChatSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type StableAppCommand =
  | 'open-command-menu'
  | 'new-chat'
  | 'search-transcript'
  | 'rename-chat'
  | 'toggle-chat-pin'
  | 'previous-chat'
  | 'next-chat'
  | 'previous-recent-chat'
  | 'next-recent-chat'
  | 'toggle-inspector'
  | 'toggle-terminal'
  | 'settings'
  | 'keyboard-shortcuts'

export type AppMenuCommand = StableAppCommand | `go-chat-${ChatSlot}`

export type ShortcutToken = 'mod' | 'shift' | 'alt' | 'ctrl' | string
export type ShortcutSequence = readonly ShortcutToken[]

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
  'toggle-terminal': {
    id: 'toggle-terminal',
    label: 'Toggle Terminal',
    group: 'Panels',
    description: 'Show or hide the terminal pane.',
    shortcuts: [['mod', 'J'], ['mod', '`']],
    accelerator: 'CmdOrCtrl+J',
    keywords: ['shell'],
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

export function appCommandDefinitions(): AppCommandDefinition[] {
  return Object.values(APP_COMMANDS)
}

export function visibleShortcutRows(): Array<AppCommandDefinition | typeof GO_CHAT_SHORTCUT_ROW> {
  const rows = appCommandDefinitions().filter((command) => command.showInShortcuts)
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

export function formatShortcutKeys(sequence: ShortcutSequence, platform: 'mac' | 'other' = 'mac'): string[] {
  return sequence.map((key) => {
    if (key === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl'
    if (key === 'shift') return '⇧'
    if (key === 'alt') return platform === 'mac' ? '⌥' : 'Alt'
    if (key === 'ctrl') return platform === 'mac' ? '⌃' : 'Ctrl'
    return key
  })
}
