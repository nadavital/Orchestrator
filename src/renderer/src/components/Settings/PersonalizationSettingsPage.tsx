import { useState } from 'react'
import {
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

interface Props {
  enabled: boolean
  customInstructions: string
  codingPreferences: string
  onSetEnabled: (enabled: boolean) => void | Promise<void>
  onSetCustomInstructions: (value: string) => void | Promise<void>
  onSetCodingPreferences: (value: string) => void | Promise<void>
}

type PersonalizationActionStatus = {
  text: string
  tone: 'info' | 'danger'
}

export default function PersonalizationSettingsPage({
  enabled,
  customInstructions,
  codingPreferences,
  onSetEnabled,
  onSetCustomInstructions,
  onSetCodingPreferences
}: Props): JSX.Element {
  const [status, setStatus] = useState<PersonalizationActionStatus | null>(null)
  const hasContent = customInstructions.trim().length > 0 || codingPreferences.trim().length > 0

  const saveEnabled = async (value: boolean): Promise<void> => {
    try {
      await onSetEnabled(value)
      setStatus({ text: value ? 'Personalization enabled' : 'Personalization disabled', tone: 'info' })
    } catch {
      setStatus({ text: 'Unable to save personalization setting', tone: 'danger' })
    }
  }

  const saveCustomInstructions = async (value: string): Promise<void> => {
    try {
      await onSetCustomInstructions(value)
      setStatus({ text: 'Custom instructions saved', tone: 'info' })
    } catch {
      setStatus({ text: 'Unable to save custom instructions', tone: 'danger' })
    }
  }

  const saveCodingPreferences = async (value: string): Promise<void> => {
    try {
      await onSetCodingPreferences(value)
      setStatus({ text: 'Coding preferences saved', tone: 'info' })
    } catch {
      setStatus({ text: 'Unable to save coding preferences', tone: 'danger' })
    }
  }

  return (
    <div
      data-settings-page-module="personalization"
      data-settings-personalization-action-status={status?.text ?? ''}
      data-settings-personalization-action-status-tone={status?.tone ?? ''}
    >
      <SettingsPageSection dataTestId="personalization-settings-section" className="personalization-settings-page">
        <SettingsContentLayout
          title="Personalization"
          subtitle="Set local Orchestrator instructions that are included with new provider runs."
          dataTestId="settings-content-layout-personalization"
        >
          <SettingsContentGroup className="personalization-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Instructions</div>
              <div className="settings-content-description">These preferences stay local to Orchestrator and do not edit provider-host settings.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="personalization-settings-surface" dataTestId="settings-personalization-surface">
                <SettingsRow
                  label="Include in new runs"
                  description={hasContent ? 'Enabled instructions are prepended to provider prompts.' : 'Add instructions before enabling this for useful runs.'}
                  control={(
                    <label className="settings-toggle-control">
                      <input
                        type="checkbox"
                        checked={enabled}
                        data-testid="settings-personalization-enabled"
                        onChange={(event) => { void saveEnabled(event.currentTarget.checked) }}
                      />
                      <span>{enabled ? 'On' : 'Off'}</span>
                    </label>
                  )}
                />
                <div className="personalization-field-row">
                  <label htmlFor="settings-personalization-custom" className="settings-row-label">Custom instructions</label>
                  <textarea
                    id="settings-personalization-custom"
                    value={customInstructions}
                    data-testid="settings-personalization-custom"
                    className="settings-textarea"
                    placeholder="Example: Be direct, cite file paths, and keep changes scoped."
                    onChange={(event) => { void saveCustomInstructions(event.currentTarget.value) }}
                  />
                </div>
                <div className="personalization-field-row">
                  <label htmlFor="settings-personalization-coding" className="settings-row-label">Coding preferences</label>
                  <textarea
                    id="settings-personalization-coding"
                    value={codingPreferences}
                    data-testid="settings-personalization-coding"
                    className="settings-textarea"
                    placeholder="Example: Prefer targeted tests and avoid broad refactors unless needed."
                    onChange={(event) => { void saveCodingPreferences(event.currentTarget.value) }}
                  />
                </div>
                {status && (
                  <div
                    className="personalization-action-status"
                    data-testid="settings-personalization-action-status"
                    data-settings-personalization-action-status-tone={status.tone}
                    role={status.tone === 'danger' ? 'alert' : 'status'}
                    aria-live={status.tone === 'danger' ? 'assertive' : 'polite'}
                    aria-atomic="true"
                  >
                    {status.text}
                  </div>
                )}
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}
