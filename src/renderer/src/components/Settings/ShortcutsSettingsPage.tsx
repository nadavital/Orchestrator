import { useState, type KeyboardEvent } from 'react'
import {
  APP_COMMANDS,
  commandShortcuts,
  findShortcutConflict,
  formatShortcutKeys,
  shortcutDisabledDefaultSequences,
  shortcutOverrideRecord,
  shortcutOverrideSequences,
  shortcutSequenceFromKeyboardEvent,
  shortcutSequencesEqual,
  visibleShortcutRows
} from '../../../../types/appCommands'
import type { ShortcutOverrides, ShortcutSequence, StableAppCommand } from '../../../../types/appCommands'
import {
  IconButton,
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsSurface,
  Tooltip,
  WorkbenchSearchField
} from '../shared/designSystem'

export default function ShortcutsSettingsPage({
  shortcutOverrides,
  onSetShortcutOverrides
}: {
  shortcutOverrides: ShortcutOverrides
  onSetShortcutOverrides: (overrides: ShortcutOverrides) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [recordingCommand, setRecordingCommand] = useState<StableAppCommand | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const shortcutPlatform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
  const shortcuts = visibleShortcutRows(shortcutOverrides).map((shortcut) => {
    const commandId = isEditableShortcutRow(shortcut.id) ? shortcut.id : null
    const customShortcuts = commandId ? shortcutOverrideSequences(commandId, shortcutOverrides) : []
    const disabledDefaults = commandId ? shortcutDisabledDefaultSequences(commandId, shortcutOverrides) : []
    const shortcutEntries = commandId
      ? [
          ...customShortcuts.map((sequence) => ({ sequence, source: 'custom' as const })),
          ...APP_COMMANDS[commandId].shortcuts
            .filter((sequence) => !disabledDefaults.some((disabled) => shortcutSequencesEqual(disabled, sequence)))
            .map((sequence) => ({ sequence, source: 'default' as const }))
        ]
      : shortcut.shortcuts.map((sequence) => ({ sequence, source: 'fixed' as const }))
    return {
      ...shortcut,
      category: shortcut.group,
      commandId,
      displayLabel: compactShortcutLabel(shortcut.label),
      editable: commandId !== null,
      overridden: customShortcuts.length > 0 || disabledDefaults.length > 0,
      customShortcutCount: customShortcuts.length,
      disabledDefaultCount: disabledDefaults.length,
      shortcutEntries: shortcutEntries.map((entry) => ({
        ...entry,
        keys: formatShortcutKeys(entry.sequence, shortcutPlatform)
      })),
      keys: shortcutEntries.map((entry) => formatShortcutKeys(entry.sequence, shortcutPlatform)),
      primaryKeys: formatShortcutKeys(shortcutEntries[0]?.sequence ?? [])
    }
  })
  const normalizedQuery = query.trim().toLowerCase()
  const visibleShortcuts = shortcuts.filter((shortcut) => {
    if (!normalizedQuery) return true
    return [
      shortcut.category,
      shortcut.label,
      shortcut.displayLabel,
      shortcut.description,
      shortcut.keys.flat().join(' ')
    ].join(' ').toLowerCase().includes(normalizedQuery)
  })

  const startRecording = (command: StableAppCommand): void => {
    setRecordingCommand(command)
    setRecordingError(null)
  }

  const resetShortcut = (command: StableAppCommand): void => {
    const { [command]: _removed, ...next } = shortcutOverrides
    onSetShortcutOverrides(next)
    if (recordingCommand === command) setRecordingCommand(null)
    setRecordingError(null)
  }

  const setShortcutBindingState = (
    command: StableAppCommand,
    customShortcuts: readonly ShortcutSequence[],
    disabledDefaults: readonly ShortcutSequence[]
  ): void => {
    const { [command]: _removed, ...next } = shortcutOverrides
    if (customShortcuts.length === 0 && disabledDefaults.length === 0) {
      onSetShortcutOverrides(next)
      return
    }
    onSetShortcutOverrides({
      ...next,
      [command]: {
        shortcuts: customShortcuts,
        disabledDefaults
      }
    })
  }

  const removeShortcutBinding = (
    command: StableAppCommand,
    sequence: ShortcutSequence,
    source: 'custom' | 'default'
  ): void => {
    const current = shortcutOverrideRecord(command, shortcutOverrides)
    const customShortcuts = (current.shortcuts ?? []).filter((shortcut) => !shortcutSequencesEqual(shortcut, sequence))
    const disabledDefaults = current.disabledDefaults ?? []
    if (source === 'custom') {
      setShortcutBindingState(command, customShortcuts, disabledDefaults)
      return
    }
    if (disabledDefaults.some((shortcut) => shortcutSequencesEqual(shortcut, sequence))) return
    setShortcutBindingState(command, customShortcuts, [...disabledDefaults, sequence])
  }

  const recordShortcut = (event: KeyboardEvent<HTMLInputElement>, command: StableAppCommand): void => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecordingCommand(null)
      setRecordingError(null)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      resetShortcut(command)
      return
    }
    const sequence = shortcutSequenceFromKeyboardEvent(event.nativeEvent, shortcutPlatform)
    if (!sequence) {
      setRecordingError('Use a modifier key')
      return
    }
    const currentCustom = shortcutOverrideSequences(command, shortcutOverrides)
    const currentAssigned = commandShortcuts(command, shortcutOverrides)
    if (currentAssigned.some((shortcut) => shortcutSequencesEqual(shortcut, sequence))) {
      setRecordingError('Shortcut already assigned')
      return
    }
    const conflict = findShortcutConflict(sequence, command, shortcutOverrides)
    if (conflict) {
      setRecordingError(`Conflicts with ${conflict.label}`)
      return
    }
    const current = shortcutOverrideRecord(command, shortcutOverrides)
    const disabledDefaults = (current.disabledDefaults ?? []).filter((shortcut) => !shortcutSequencesEqual(shortcut, sequence))
    const isDefaultShortcut = APP_COMMANDS[command].shortcuts.some((shortcut) => shortcutSequencesEqual(shortcut, sequence))
    setShortcutBindingState(command, isDefaultShortcut ? currentCustom : [sequence, ...currentCustom], disabledDefaults)
    setRecordingCommand(null)
    setRecordingError(null)
  }

  return (
    <div data-settings-page-module="shortcuts">
      <SettingsPageSection dataTestId="shortcuts-settings-section" className="shortcuts-settings-page">
        <SettingsContentLayout
          title="Shortcuts"
          subtitle="Customize keyboard shortcuts for shared app, Workbench, Browser, Review, and Terminal commands."
          dataTestId="settings-content-layout-shortcuts"
        >
          <SettingsContentGroup>
            <SettingsGroupContent>
              <SettingsSurface className="settings-shortcuts-table">
                <div className="settings-shortcuts-search">
                  <label className="sr-only" htmlFor="settings-shortcut-search">Search keyboard shortcuts</label>
                  <WorkbenchSearchField
                    id="settings-shortcut-search"
                    value={query}
                    onChange={setQuery}
                    placeholder="Search shortcuts"
                    clearLabel="Clear shortcut search"
                    clearDataTestId="settings-shortcut-search-clear"
                    className="settings-shortcuts-search-field"
                  />
                </div>
                {visibleShortcuts.length > 0 && (
                  <div className="settings-shortcuts-head">
                    <span>Command</span>
                    <span>Shortcut</span>
                    <span className="sr-only">Actions</span>
                  </div>
                )}
                {visibleShortcuts.map((shortcut, rowIndex) => (
                  <div
                    key={shortcut.label}
                    className="settings-shortcut-row"
                    data-first-row={rowIndex === 0 ? 'true' : 'false'}
                  >
                    <span className="settings-shortcut-command">{shortcut.displayLabel}</span>
                    <span
                      className="settings-shortcut-sequence"
                      data-testid="settings-shortcut-sequence"
                      aria-label={shortcut.primaryKeys.join(' ')}
                    >
                      {shortcut.commandId && recordingCommand === shortcut.commandId ? (
                        <input
                          autoFocus
                          readOnly
                          value="Press shortcut"
                          spellCheck={false}
                          inputMode="none"
                          data-testid="settings-shortcut-recorder"
                          data-shortcut-capture-field="true"
                          aria-label={`Shortcut capture for ${shortcut.label}`}
                          onKeyDown={(event) => recordShortcut(event, shortcut.commandId!)}
                          onBlur={() => setRecordingCommand(null)}
                          className="settings-shortcut-recorder"
                        />
                      ) : (
                        <span className="settings-shortcut-key-list">
                          {shortcut.shortcutEntries.length > 0 ? shortcut.shortcutEntries.map((entry, index) => (
                            <span
                              key={`${shortcut.id}-${entry.keys.join('-')}-${index}`}
                              className="settings-shortcut-binding"
                              data-testid="settings-shortcut-binding"
                              data-shortcut-binding-source={entry.source}
                            >
                              <kbd
                                className="settings-shortcut-key"
                                data-testid="settings-shortcut-key"
                                data-overridden={entry.source === 'custom' ? 'true' : 'false'}
                              >
                                {entry.keys.join('')}
                              </kbd>
                              {shortcut.commandId && entry.source !== 'fixed' && (
                                <Tooltip label={`Clear ${entry.keys.join('')} for ${shortcut.label}`}>
                                  <IconButton
                                    icon="trash"
                                    label={`Clear ${entry.keys.join('')} for ${shortcut.label}`}
                                    size="xs"
                                    variant="toolbar"
                                    tooltip={false}
                                    dataTestId="settings-shortcut-clear-binding"
                                    onClick={() => removeShortcutBinding(shortcut.commandId!, entry.sequence, entry.source)}
                                    className="settings-shortcut-binding-clear"
                                  />
                                </Tooltip>
                              )}
                            </span>
                          )) : (
                            <span className="settings-shortcut-unassigned" data-testid="settings-shortcut-unassigned">
                              Unassigned
                            </span>
                          )}
                        </span>
                      )}
                      {shortcut.commandId && (
                        <Tooltip label={`Edit ${shortcut.label} shortcut`}>
                          <IconButton
                            icon="pencil"
                            label={`Edit ${shortcut.label} shortcut`}
                            size="sm"
                            variant="toolbar"
                            tooltip={false}
                            dataTestId="settings-shortcut-edit"
                            onClick={() => startRecording(shortcut.commandId!)}
                            className="settings-shortcut-action"
                          />
                        </Tooltip>
                      )}
                      {shortcut.commandId && shortcut.overridden && (
                        <Tooltip label={`Reset ${shortcut.label} shortcut`}>
                          <IconButton
                            icon="eraser"
                            label={`Reset ${shortcut.label} shortcut`}
                            size="sm"
                            variant="toolbar"
                            tooltip={false}
                            dataTestId="settings-shortcut-reset"
                            onClick={() => resetShortcut(shortcut.commandId!)}
                            className="settings-shortcut-action"
                          />
                        </Tooltip>
                      )}
                    </span>
                  </div>
                ))}
                {visibleShortcuts.length === 0 && (
                  <div className="settings-shortcuts-empty">
                    No matching shortcuts
                  </div>
                )}
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
          {recordingError && (
            <div data-testid="settings-shortcut-recording-error" className="settings-shortcut-recording-error">
              {recordingError}
            </div>
          )}
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}

function isEditableShortcutRow(id: string): id is StableAppCommand {
  return id in APP_COMMANDS
}

function compactShortcutLabel(label: string): string {
  switch (label) {
    case 'Open Settings':
      return 'Settings'
    case 'Keyboard Shortcuts':
      return 'Shortcuts'
    case 'Search Transcript':
      return 'Search Chat'
    case 'Pin or Unpin Chat':
      return 'Pin Chat'
    case 'Toggle Inspector':
      return 'Inspector'
    case 'Toggle Terminal':
      return 'Terminal'
    case 'Go to Chat 1-9':
      return 'Chat 1-9'
    default:
      return label
  }
}
