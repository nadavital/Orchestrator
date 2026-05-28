import { useEffect, useState } from 'react'
import type { OpenTargetAvailability, PreferredOpenTarget } from '../../types'
import {
  SettingChoiceCard,
  SettingsContentLayout,
  SettingsContentGroup,
  SettingsGroupContent,
  SettingsPageSection,
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
          <SettingsContentGroup className="general-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Files</div>
              <div className="settings-content-description">Choose where referenced file cards open from chat.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="general-settings-editor-surface">
                <div className="settings-choice-grid">
                  {editorOptions.map((option) => {
                    const active = preferredEditor === option.id
                    const target = openTargets.find((candidate) => candidate.id === option.id)
                    const unavailable = Boolean(target && !target.available && option.id !== 'system')
                    const description = target
                      ? openTargetDescription(option.desc, target)
                      : option.desc
                    return (
                      <SettingChoiceCard
                        key={option.id}
                        label={option.label}
                        description={description}
                        active={active}
                        onClick={() => { void selectPreferredEditor(option) }}
                        disabled={unavailable}
                        dataTestId={`settings-general-preferred-editor-${option.id}`}
                      />
                    )
                  })}
                </div>
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
          <SettingsContentGroup className="general-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Composer</div>
              <div className="settings-content-description">Choose how the main message field handles Enter.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="general-settings-composer-surface">
                <div className="settings-choice-grid">
                  {composerEnterOptions.map((option) => (
                    <SettingChoiceCard
                      key={option.id}
                      label={option.label}
                      description={option.desc}
                      active={composerEnterBehavior === option.id}
                      onClick={() => { void selectComposerEnterBehavior(option) }}
                      dataTestId={`settings-general-composer-enter-${option.id}`}
                    />
                  ))}
                </div>
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
