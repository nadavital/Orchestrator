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
  onSetEnabled: (enabled: boolean) => void
  onSetCustomInstructions: (value: string) => void
  onSetCodingPreferences: (value: string) => void
}

export default function PersonalizationSettingsPage({
  enabled,
  customInstructions,
  codingPreferences,
  onSetEnabled,
  onSetCustomInstructions,
  onSetCodingPreferences
}: Props): JSX.Element {
  const hasContent = customInstructions.trim().length > 0 || codingPreferences.trim().length > 0

  return (
    <div data-settings-page-module="personalization">
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
                        onChange={(event) => onSetEnabled(event.currentTarget.checked)}
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
                    onChange={(event) => onSetCustomInstructions(event.currentTarget.value)}
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
                    onChange={(event) => onSetCodingPreferences(event.currentTarget.value)}
                  />
                </div>
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}
