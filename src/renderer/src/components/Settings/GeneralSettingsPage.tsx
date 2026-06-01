import { useEffect, useState } from 'react'
import type { OpenTargetAvailability, PreferredOpenTarget } from '../../types'
import {
  SettingsContentLayout,
  SettingsContentGroup,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

type PreferredEditor = PreferredOpenTarget
type ComposerEnterBehavior = 'send' | 'newline'
type GeneralActionStatus = {
  text: string
  tone: 'info' | 'danger'
}

export default function GeneralSettingsPage({
  preferredEditor,
  onSetPreferredEditor,
  composerEnterBehavior,
  onSetComposerEnterBehavior,
}: {
  preferredEditor: PreferredEditor
  onSetPreferredEditor: (value: PreferredEditor) => Promise<void>
  composerEnterBehavior: ComposerEnterBehavior
  onSetComposerEnterBehavior: (value: ComposerEnterBehavior) => Promise<void>
}): JSX.Element {
  const [openTargets, setOpenTargets] = useState<OpenTargetAvailability[]>([])
  const [actionStatus, setActionStatus] = useState<GeneralActionStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.fs.listOpenTargets()
      .then((targets) => {
        if (!cancelled) setOpenTargets(targets)
      })
      .catch(() => {
        if (!cancelled) setOpenTargets([])
      })
    return () => { cancelled = true }
  }, [])

  const editorOptions: Array<{ id: PreferredEditor; label: string; desc: string }> = [
    { id: 'system', label: 'System default', desc: 'Use macOS file associations' },
    { id: 'cursor', label: 'Cursor', desc: 'Open file cards in Cursor' },
    { id: 'vscode', label: 'VS Code', desc: 'Open file cards in Visual Studio Code' },
    { id: 'vscode-insiders', label: 'VS Code Insiders', desc: 'Use the Insiders app' },
    { id: 'zed', label: 'Zed', desc: 'Open file cards in Zed' }
  ]
  const composerEnterOptions: Array<{ id: ComposerEnterBehavior; label: string; desc: string }> = [
    { id: 'send', label: 'Enter sends', desc: 'Press Enter to send; Shift-Enter inserts a new line' },
    { id: 'newline', label: 'Enter inserts line', desc: 'Press Command-Enter or Control-Enter to send' }
  ]
  const selectedEditorOption = editorOptions.find((option) => option.id === preferredEditor) ?? editorOptions[0]
  const selectedEditorTarget = openTargets.find((target) => target.id === selectedEditorOption.id)
  const selectedEditorDescription = selectedEditorTarget
    ? openTargetDescription(selectedEditorOption.desc, selectedEditorTarget)
    : selectedEditorOption.desc

  const selectPreferredEditor = async (option: { id: PreferredEditor; label: string }): Promise<void> => {
    try {
      await onSetPreferredEditor(option.id)
      setActionStatus({ text: `${option.label} saved`, tone: 'info' })
    } catch {
      setActionStatus({ text: `Unable to save ${option.label}`, tone: 'danger' })
    }
  }

  const selectComposerEnterBehavior = async (option: { id: ComposerEnterBehavior; label: string }): Promise<void> => {
    try {
      await onSetComposerEnterBehavior(option.id)
      setActionStatus({ text: `${option.label} saved`, tone: 'info' })
    } catch {
      setActionStatus({ text: `Unable to save ${option.label}`, tone: 'danger' })
    }
  }

  return (
    <div
      data-settings-page-module="general"
      data-settings-general-preferred-editor={preferredEditor}
      data-settings-general-composer-enter-behavior={composerEnterBehavior}
      data-settings-general-action-status={actionStatus?.text ?? ''}
      data-settings-general-action-status-tone={actionStatus?.tone ?? ''}
    >
      <SettingsPageSection dataTestId="general-settings-section" className="general-settings-page">
        <SettingsContentLayout
          title="General"
          subtitle="App-level defaults that affect everyday navigation and file handoff."
          dataTestId="settings-content-layout"
        >
          <SettingsContentGroup
            className="general-settings-content-group"
            rootAttrs={{
              tabIndex: -1,
              'data-settings-search-anchor': 'general-files'
            }}
          >
            <SettingsGroupContent>
              <SettingsSurface className="general-settings-control-surface">
                <SettingsRow
                  label="Open files with"
                  description={selectedEditorDescription}
                  className="general-settings-row"
                  control={(
                    <select
                      className="settings-select general-settings-select"
                      value={preferredEditor}
                      aria-label="Preferred file editor"
                      data-testid="settings-general-preferred-editor"
                      onChange={(event) => {
                        const option = editorOptions.find((candidate) => candidate.id === event.target.value)
                        if (option) void selectPreferredEditor(option)
                      }}
                    >
                      {editorOptions.map((option) => {
                        const target = openTargets.find((candidate) => candidate.id === option.id)
                        const unavailable = Boolean(target && !target.available && option.id !== 'system')
                        return (
                          <option
                            key={option.id}
                            value={option.id}
                            disabled={unavailable}
                            data-testid={`settings-general-preferred-editor-${option.id}`}
                          >
                            {option.label}
                          </option>
                        )
                      })}
                    </select>
                  )}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
          <SettingsContentGroup
            className="general-settings-content-group"
            rootAttrs={{
              tabIndex: -1,
              'data-settings-search-anchor': 'general-composer'
            }}
          >
            <SettingsGroupContent>
              <SettingsSurface className="general-settings-control-surface">
                <SettingsRow
                  label="Enter key"
                  description={composerEnterOptions.find((option) => option.id === composerEnterBehavior)?.desc}
                  className="general-settings-row"
                  control={(
                    <div className="general-settings-segmented-control" role="group" aria-label="Composer Enter behavior">
                  {composerEnterOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="general-settings-segment"
                      data-active={composerEnterBehavior === option.id ? 'true' : 'false'}
                      aria-pressed={composerEnterBehavior === option.id}
                      onClick={() => { void selectComposerEnterBehavior(option) }}
                      data-testid={`settings-general-composer-enter-${option.id}`}
                    >
                      {option.label}
                    </button>
                  ))}
                    </div>
                  )}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
          {actionStatus && (
            <div
              className="general-settings-action-status"
              data-testid="settings-general-action-status"
              data-settings-general-action-status-tone={actionStatus.tone}
              role={actionStatus.tone === 'danger' ? 'alert' : 'status'}
              aria-live={actionStatus.tone === 'danger' ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              {actionStatus.text}
            </div>
          )}
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}

function openTargetDescription(fallback: string, target: OpenTargetAvailability): string {
  if (!target.available) return target.unavailableReason ?? 'Not found on this Mac.'
  if (target.id === 'system') return fallback
  const methodLabels = target.methods.map((method) => {
    if (method === 'url-scheme') return 'URL'
    if (method === 'cli') return 'CLI'
    return method
  })
  const lineTarget = target.supportsLineTarget ? 'line targets' : 'files only'
  return `Available via ${methodLabels.join(', ')}; ${lineTarget}.`
}
