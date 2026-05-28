import { useState, type CSSProperties } from 'react'
import { serializePortableTheme } from '../../../../types/themeSharing'
import type { Accent, Appearance, AppearanceTheme, ChromeTheme, Density, TranscriptStyle } from '../../theme'
import {
  SettingChoiceCard,
  SettingsContentLayout,
  SettingsContentGroup,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface,
  SwitchControl
} from '../shared/designSystem'

export const defaultLightChromeTheme: ChromeTheme = {
  accent: '#0a7cff',
  surface: '#ffffff',
  ink: '#111111',
  contrast: 45,
  opaqueWindows: false
}

export const defaultDarkChromeTheme: ChromeTheme = {
  accent: '#8ab4f8',
  surface: '#20222a',
  ink: '#f3f3f0',
  contrast: 58,
  opaqueWindows: true
}

export interface AppearancePreset {
  id: Appearance
  label: string
  desc: string
  mode: AppearanceTheme
  lightChromeTheme?: ChromeTheme
  darkChromeTheme?: ChromeTheme
  lightCodeThemeId?: string
  darkCodeThemeId?: string
  swatches: string[]
}

const appearancePresets: AppearancePreset[] = [
  {
    id: 'system',
    label: 'System',
    desc: 'Follow macOS with balanced light and dark chrome',
    mode: 'system',
    lightChromeTheme: defaultLightChromeTheme,
    darkChromeTheme: defaultDarkChromeTheme,
    lightCodeThemeId: 'github-light',
    darkCodeThemeId: 'github-dark',
    swatches: ['#ffffff', '#20222a', '#0a7cff']
  },
  {
    id: 'mist',
    label: 'Mist Light',
    desc: 'Soft light canvas with blue focus',
    mode: 'light',
    lightChromeTheme: defaultLightChromeTheme,
    lightCodeThemeId: 'github-light',
    swatches: ['#ffffff', '#f4f5f2', '#0a7cff']
  },
  {
    id: 'graphite',
    label: 'Graphite Dark',
    desc: 'Low-glare dark workspace',
    mode: 'dark',
    darkChromeTheme: defaultDarkChromeTheme,
    darkCodeThemeId: 'github-dark',
    swatches: ['#15161b', '#20222a', '#8ab4f8']
  },
  {
    id: 'ocean',
    label: 'Ocean',
    desc: 'Deep blue material with brighter contrast',
    mode: 'dark',
    darkChromeTheme: {
      accent: '#80cbc4',
      surface: '#132338',
      ink: '#edf7ff',
      contrast: 58,
      opaqueWindows: true,
      semanticColors: {
        diffAdded: '#42c985',
        diffRemoved: '#ff6464',
        skill: '#82aaff'
      }
    },
    darkCodeThemeId: 'material-theme-ocean',
    swatches: ['#0b1624', '#132338', '#80cbc4']
  },
  {
    id: 'palenight',
    label: 'Palenight',
    desc: 'Softer violet material for evening work',
    mode: 'dark',
    darkChromeTheme: {
      accent: '#c792ea',
      surface: '#25283a',
      ink: '#f5f3ff',
      contrast: 58,
      opaqueWindows: true,
      semanticColors: {
        diffAdded: '#58c994',
        diffRemoved: '#ff6b77',
        skill: '#c792ea'
      }
    },
    darkCodeThemeId: 'material-theme-palenight',
    swatches: ['#1b1d2b', '#25283a', '#c792ea']
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    desc: 'Maximum separation and solid chrome',
    mode: 'dark',
    darkChromeTheme: {
      accent: '#4db6ff',
      surface: '#101010',
      ink: '#ffffff',
      contrast: 92,
      opaqueWindows: true,
      semanticColors: {
        diffAdded: '#52d273',
        diffRemoved: '#ff6961',
        skill: '#c9a0ff'
      }
    },
    darkCodeThemeId: 'github-dark',
    swatches: ['#000000', '#101010', '#4db6ff']
  }
]

export default function AppearanceSettingsPage({
  appearance,
  accent,
  density,
  sidebarTint,
  transcriptStyle,
  customAccent,
  interfaceScale,
  uiFont,
  monoFont,
  appearanceTheme,
  lightChromeTheme,
  darkChromeTheme,
  lightCodeThemeId,
  darkCodeThemeId,
  sansFontSize,
  codeFontSize,
  useFontSmoothing,
  usePointerCursors,
  reduceMotion,
  onSetAppearance,
  onSetAccent,
  onSetDensity,
  onSetSidebarTint,
  onSetTranscriptStyle,
  onSetCustomAccent,
  onSetInterfaceScale,
  onSetUiFont,
  onSetMonoFont,
  onSetAppearanceTheme,
  onSetChromeTheme,
  onSetThemeFontSize,
  onSetThemeToggle,
  onImportPortableTheme,
}: {
  appearance: Appearance
  accent: Accent
  density: Density
  sidebarTint: boolean
  transcriptStyle: TranscriptStyle
  customAccent: string
  interfaceScale: number
  uiFont: string
  monoFont: string
  appearanceTheme: AppearanceTheme
  lightChromeTheme: ChromeTheme
  darkChromeTheme: ChromeTheme
  lightCodeThemeId: string
  darkCodeThemeId: string
  sansFontSize: number
  codeFontSize: number
  useFontSmoothing: boolean
  usePointerCursors: boolean
  reduceMotion: boolean
  onSetAppearance: (value: Appearance, preset?: AppearancePreset) => void
  onSetAccent: (value: Accent) => void
  onSetDensity: (value: Density) => void
  onSetSidebarTint: (value: boolean) => void
  onSetTranscriptStyle: (value: TranscriptStyle) => void
  onSetCustomAccent: (value: string) => void
  onSetInterfaceScale: (value: number) => void
  onSetUiFont: (value: string) => void
  onSetMonoFont: (value: string) => void
  onSetAppearanceTheme: (value: AppearanceTheme) => void
  onSetChromeTheme: (variant: 'light' | 'dark', value: ChromeTheme) => void
  onSetThemeFontSize: (kind: 'ui' | 'code', value: number) => void
  onSetThemeToggle: (key: 'useFontSmoothing' | 'usePointerCursors' | 'reduceMotion', value: boolean) => void
  onImportPortableTheme: (raw: string) => { ok: boolean; error?: string }
}): JSX.Element {
  const [themeImportText, setThemeImportText] = useState('')
  const [themeImportStatus, setThemeImportStatus] = useState<string | null>(null)
  const accentOptions: Array<{ id: Accent; label: string; color: string }> = [
    { id: 'blue', label: 'Blue', color: '#0a7cff' },
    { id: 'teal', label: 'Teal', color: '#14a6a1' },
    { id: 'purple', label: 'Purple', color: '#7c5cff' },
    { id: 'green', label: 'Green', color: '#16a35b' },
    { id: 'rose', label: 'Rose', color: '#d84b7c' },
    { id: 'custom', label: 'Custom', color: customAccent },
  ]
  const densityOptions: Array<{ id: Density; label: string; desc: string }> = [
    { id: 'comfortable', label: 'Comfortable', desc: 'Airier rows and panels' },
    { id: 'compact', label: 'Compact', desc: 'More state in view' }
  ]
  const transcriptOptions: Array<{ id: TranscriptStyle; label: string; desc: string }> = [
    { id: 'relaxed', label: 'Relaxed', desc: 'Readable chat rhythm' },
    { id: 'dense', label: 'Dense', desc: 'Tighter transcript spacing' }
  ]
  const themeOptions: Array<{ id: AppearanceTheme; label: string; desc: string }> = [
    { id: 'system', label: 'System', desc: 'Follow macOS' },
    { id: 'light', label: 'Light', desc: 'Use light chrome' },
    { id: 'dark', label: 'Dark', desc: 'Use dark chrome' }
  ]
  const fontOptions = [
    { id: 'system', label: 'System', desc: 'Native macOS text' },
    { id: 'rounded', label: 'Rounded', desc: 'Softer interface tone' },
    { id: 'serif', label: 'Serif', desc: 'Editorial headings and labels' }
  ]
  const monoOptions = [
    { id: 'system', label: 'System mono', desc: 'SF Mono where available' },
    { id: 'mono', label: 'Developer mono', desc: 'Code-first stack' }
  ]
  const updateChrome = (variant: 'light' | 'dark', patch: Partial<ChromeTheme>): void => {
    const current = variant === 'light' ? lightChromeTheme : darkChromeTheme
    onSetChromeTheme(variant, { ...current, ...patch })
  }
  const copyTheme = (variant: 'light' | 'dark'): void => {
    const value = serializePortableTheme(
      variant,
      variant === 'light' ? lightChromeTheme : darkChromeTheme,
      variant === 'light' ? lightCodeThemeId : darkCodeThemeId
    )
    void navigator.clipboard.writeText(value)
    setThemeImportStatus(`${variant === 'light' ? 'Light' : 'Dark'} theme copied`)
  }
  const importTheme = (): void => {
    const result = onImportPortableTheme(themeImportText)
    setThemeImportStatus(result.ok ? 'Theme imported' : result.error ?? 'Invalid theme')
  }
  return (
    <div data-settings-page-module="appearance">
      <SettingsPageSection dataTestId="appearance-settings-section" className="appearance-settings-page">
        <SettingsContentLayout
          title="Appearance"
          subtitle="Tune the app shell, typography, density, and reading rhythm without changing how your agents work."
          dataTestId="settings-content-layout-appearance"
        >
          <SettingsContentGroup className="appearance-settings-content-group">
            <SettingsSectionHeading
              title="Mode"
              description="Choose whether the app resolves to light, dark, or the current system appearance."
            />
            <SettingsGroupContent>
              <SettingsSurface className="appearance-settings-surface">
                <div className="appearance-settings-control-pad">
                  <SegmentedChoice items={themeOptions} value={appearanceTheme} onChange={onSetAppearanceTheme} />
                </div>
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
            <SettingsSectionHeading
              title="Presets"
              description="Start from a complete chrome preset, then tune either variant below."
            />
            <SettingsGroupContent>
              <SettingsSurface className="appearance-settings-surface">
                <div data-testid="appearance-preset-grid" className="appearance-preset-grid">
                  {appearancePresets.map((option) => {
                    const active = appearance === option.id
                    return (
                      <ThemePresetCard
                        key={option.id}
                        preset={option}
                        active={active}
                        onClick={() => onSetAppearance(option.id, option)}
                      />
                    )
                  })}
                </div>
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
          <SettingsSectionHeading
            title="Preview"
            description="Check the active colors against a compact chat and code surface."
          />
          <SettingsGroupContent>
            <SettingsSurface className="appearance-settings-surface">
              <div className="appearance-settings-control-pad">
                <ThemePreview
                  variant={appearanceTheme === 'light' ? 'light' : appearanceTheme === 'dark' ? 'dark' : 'system'}
                  lightTheme={lightChromeTheme}
                  darkTheme={darkChromeTheme}
                />
              </div>
            </SettingsSurface>
          </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
          <SettingsSectionHeading
            title="Theme editor"
            description="Tune chrome and semantic colors independently for light and dark variants."
          />
          <SettingsGroupContent>
            <SettingsSurface className="appearance-settings-surface">
              <div className="appearance-theme-editor-grid">
                <ChromeThemeEditor title="Light chrome" variant="light" theme={lightChromeTheme} onChange={updateChrome} />
                <ChromeThemeEditor title="Dark chrome" variant="dark" theme={darkChromeTheme} onChange={updateChrome} />
              </div>
            </SettingsSurface>
          </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
          <SettingsSectionHeading
            title="Sharing"
            description="Import or copy a portable Codex theme string."
          />
          <SettingsGroupContent>
            <SettingsSurface className="appearance-settings-surface">
              <div className="appearance-sharing-controls">
                <div className="settings-actions-inline appearance-sharing-actions">
                  <button
                    type="button"
                    data-testid="copy-light-theme"
                    className="settings-action-button"
                    onClick={() => copyTheme('light')}
                  >
                    Copy light theme
                  </button>
                  <button
                    type="button"
                    data-testid="copy-dark-theme"
                    className="settings-action-button"
                    onClick={() => copyTheme('dark')}
                  >
                    Copy dark theme
                  </button>
                </div>
                <textarea
                  data-testid="theme-import-input"
                  value={themeImportText}
                  onChange={(event) => setThemeImportText(event.currentTarget.value)}
                  placeholder="codex-theme-v1:{...}"
                  className="appearance-theme-import-input"
                />
                <div className="appearance-theme-import-footer">
                  <button
                    type="button"
                    data-testid="theme-import-button"
                    className="settings-action-button"
                    onClick={importTheme}
                  >
                    Import theme
                  </button>
                  {themeImportStatus && (
                    <span data-testid="theme-import-status" className="appearance-theme-import-status">
                      {themeImportStatus}
                    </span>
                  )}
                </div>
              </div>
            </SettingsSurface>
          </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
          <SettingsSectionHeading
            title="Quick accent"
            description="A lightweight accent preset for primary actions, focus rings, and active states."
          />
          <SettingsGroupContent>
            <SettingsSurface className="appearance-settings-surface">
              <div className="appearance-accent-controls">
                <div className="appearance-accent-options">
                  {accentOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="appearance-accent-button"
                      data-active={accent === option.id ? 'true' : 'false'}
                      style={{ '--appearance-accent-color': option.color } as CSSProperties}
                      onClick={() => onSetAccent(option.id)}
                    >
                      <span className="appearance-accent-swatch" aria-hidden="true" />
                      {option.label}
                    </button>
                  ))}
                </div>
                <SettingsRow
                  label="Custom accent"
                  description="Used when the custom accent swatch is selected."
                  control={(
                    <input
                      data-testid="appearance-custom-accent-input"
                      data-color-input-surface="shared"
                      type="color"
                      value={customAccent}
                      onChange={(event) => onSetCustomAccent(event.currentTarget.value)}
                      className="appearance-color-input"
                    />
                  )}
                />
              </div>
            </SettingsSurface>
          </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
          <SettingsSectionHeading
            title="Typography"
            description="Choose app and terminal type independently."
          />
          <SettingsGroupContent>
            <SettingsSurface className="appearance-settings-surface">
              <div className="appearance-settings-control-pad">
                <SegmentedChoice items={fontOptions} value={uiFont} onChange={onSetUiFont} />
                <SegmentedChoice items={monoOptions} value={monoFont} onChange={onSetMonoFont} />
              </div>
              <SettingsRow
                label="Interface scale"
                description={`${Math.round(interfaceScale * 100)}% app chrome scale.`}
                control={(
                  <input
                    type="range"
                    min="0.9"
                    max="1.12"
                    step="0.01"
                    value={interfaceScale}
                    onChange={(event) => onSetInterfaceScale(Number(event.currentTarget.value))}
                    className="appearance-range-input"
                  />
                )}
              />
              <SettingsRow
                label="UI font size"
                description={`${sansFontSize}px interface text.`}
                control={(
                  <input
                    data-testid="appearance-ui-font-size"
                    type="range"
                    min="11"
                    max="18"
                    step="1"
                    value={sansFontSize}
                    onChange={(event) => onSetThemeFontSize('ui', Number(event.currentTarget.value))}
                    className="appearance-range-input"
                  />
                )}
              />
              <SettingsRow
                label="Code font size"
                description={`${codeFontSize}px monospaced text.`}
                control={(
                  <input
                    data-testid="appearance-code-font-size"
                    type="range"
                    min="11"
                    max="18"
                    step="1"
                    value={codeFontSize}
                    onChange={(event) => onSetThemeFontSize('code', Number(event.currentTarget.value))}
                    className="appearance-range-input"
                  />
                )}
              />
            </SettingsSurface>
          </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="appearance-settings-content-group">
          <SettingsSectionHeading
            title="Layout and reading"
            description="Control density, transcript rhythm, and sidebar material."
          />
          <SettingsGroupContent>
            <SettingsSurface className="appearance-settings-surface">
              <div className="appearance-settings-control-pad">
                <SegmentedChoice items={densityOptions} value={density} onChange={onSetDensity} />
                <SegmentedChoice items={transcriptOptions} value={transcriptStyle} onChange={onSetTranscriptStyle} />
              </div>
              <SettingsRow
                label="Tint sidebar"
                description="Use the soft tinted rail material."
                control={<Switch checked={sidebarTint} onChange={onSetSidebarTint} />}
              />
              <PreferenceToggle
                title="Font smoothing"
                description="Use antialiased interface and code text."
                checked={useFontSmoothing}
                onChange={(value) => onSetThemeToggle('useFontSmoothing', value)}
              />
              <PreferenceToggle
                title="Pointer cursors"
                description="Use hand cursors for interactive controls."
                checked={usePointerCursors}
                onChange={(value) => onSetThemeToggle('usePointerCursors', value)}
              />
              <PreferenceToggle
                title="Reduce motion"
                description="Prefer shorter transitions in app chrome."
                checked={reduceMotion}
                onChange={(value) => onSetThemeToggle('reduceMotion', value)}
              />
            </SettingsSurface>
          </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}

function SettingsSectionHeading({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="settings-content-heading">
      <div className="settings-content-title">{title}</div>
      <div className="settings-content-description">{description}</div>
    </div>
  )
}

function ThemePresetCard({
  preset,
  active,
  onClick
}: {
  preset: AppearancePreset
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="theme-preset-card"
      data-active={active}
      data-testid={`appearance-preset-${preset.id}`}
      onClick={onClick}
    >
      <span className="theme-preset-preview" aria-hidden="true">
        <span className="theme-preset-window" style={{ background: preset.swatches[0], color: preset.swatches[2] }}>
          <span className="theme-preset-rail" style={{ background: preset.swatches[1] }} />
          <span className="theme-preset-lines">
            <span style={{ background: preset.swatches[2] }} />
            <span style={{ background: preset.swatches[2] }} />
          </span>
        </span>
        <span className="theme-preset-swatches">
          {preset.swatches.map((swatch) => (
            <span key={swatch} style={{ background: swatch }} />
          ))}
        </span>
      </span>
      <span className="theme-preset-copy">
        <span className="theme-preset-title">{preset.label}</span>
        <span className="theme-preset-description">{preset.desc}</span>
      </span>
    </button>
  )
}

function ThemePreview({
  variant,
  lightTheme,
  darkTheme
}: {
  variant: AppearanceTheme
  lightTheme: ChromeTheme
  darkTheme: ChromeTheme
}): JSX.Element {
  const systemPrefersLight = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
  const resolvedTheme = variant === 'light' || (variant === 'system' && systemPrefersLight) ? lightTheme : darkTheme
  const modeLabel = variant === 'system' ? 'System preview' : `${variant[0].toUpperCase()}${variant.slice(1)} preview`
  const borderColor = colorMixForStyle(resolvedTheme.ink, 0.14)
  return (
    <div
      data-testid="appearance-theme-preview"
      className="theme-preview-panel"
      style={{
        background: resolvedTheme.surface,
        color: resolvedTheme.ink,
        borderColor
      }}
    >
      <div className="theme-preview-sidebar" style={{ background: colorMixForStyle(resolvedTheme.ink, 0.055), borderColor }}>
        <span style={{ background: resolvedTheme.accent }} />
        <span />
        <span />
      </div>
      <div className="theme-preview-content">
        <div className="theme-preview-header">
          <span>{modeLabel}</span>
          <span style={{ background: colorMixForStyle(resolvedTheme.accent, 0.16), color: resolvedTheme.accent }}>Ready</span>
        </div>
        <div className="theme-preview-message" style={{ borderColor }}>
          <span style={{ background: resolvedTheme.accent }} />
          <div>
            <strong>Agent summary</strong>
            <p>Updated settings, verified the UI, and left the app ready for another pass.</p>
          </div>
        </div>
        <pre className="theme-preview-code" style={{ borderColor, background: colorMixForStyle(resolvedTheme.ink, 0.04) }}>
          <code>{'const surface = "calm";'}</code>
        </pre>
      </div>
    </div>
  )
}

function colorMixForStyle(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return `rgba(0, 0, 0, ${alpha})`
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function ChromeThemeEditor({
  title,
  variant,
  theme,
  onChange
}: {
  title: string
  variant: 'light' | 'dark'
  theme: ChromeTheme
  onChange: (variant: 'light' | 'dark', patch: Partial<ChromeTheme>) => void
}): JSX.Element {
  return (
    <div
      data-testid={`appearance-${variant}-chrome-editor`}
      data-theme-editor-surface="shared"
      className="appearance-chrome-theme-editor"
    >
      <div className="appearance-chrome-theme-editor-title">{title}</div>
      <ColorInput label="Accent" value={theme.accent} onChange={(value) => onChange(variant, { accent: value })} />
      <ColorInput label="Background" value={theme.surface} onChange={(value) => onChange(variant, { surface: value })} />
      <ColorInput label="Foreground" value={theme.ink} onChange={(value) => onChange(variant, { ink: value })} />
      <ColorInput
        label="Diff added"
        value={theme.semanticColors?.diffAdded ?? '#13a355'}
        onChange={(value) => onChange(variant, { semanticColors: { ...theme.semanticColors, diffAdded: value } })}
      />
      <ColorInput
        label="Diff removed"
        value={theme.semanticColors?.diffRemoved ?? '#dc2f2f'}
        onChange={(value) => onChange(variant, { semanticColors: { ...theme.semanticColors, diffRemoved: value } })}
      />
      <ColorInput
        label="Skill"
        value={theme.semanticColors?.skill ?? '#7c3aed'}
        onChange={(value) => onChange(variant, { semanticColors: { ...theme.semanticColors, skill: value } })}
      />
      <SettingsRow
        label="Contrast"
        variant="nested"
        control={(
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={theme.contrast}
            onChange={(event) => onChange(variant, { contrast: Number(event.currentTarget.value) })}
            className="appearance-contrast-range"
          />
        )}
      />
      <PreferenceToggle
        title="Opaque windows"
        description="Use solid chrome instead of translucent sidebar material."
        checked={theme.opaqueWindows}
        onChange={(value) => onChange(variant, { opaqueWindows: value })}
        variant="nested"
      />
    </div>
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <SettingsRow
      label={label}
      variant="nested"
      control={(
        <input
          data-testid={`appearance-color-${id}`}
          data-color-input-surface="shared"
          type="color"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="appearance-color-input"
        />
      )}
    />
  )
}

function PreferenceToggle({
  title,
  description,
  checked,
  onChange,
  variant = 'surface'
}: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  variant?: 'surface' | 'nested'
}): JSX.Element {
  return (
    <SettingsRow
      label={title}
      description={description}
      variant={variant}
      control={<Switch checked={checked} onChange={onChange} />}
    />
  )
}

function SegmentedChoice<T extends string>({
  items,
  value,
  onChange
}: {
  items: Array<{ id: T; label: string; desc: string }>
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 8 }}>
      {items.map((item) => {
        const active = item.id === value
        return (
          <SettingChoiceCard
            key={item.id}
            label={item.label}
            description={item.desc}
            active={active}
            onClick={() => onChange(item.id)}
          />
        )
      })}
    </div>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return <SwitchControl checked={checked} onChange={onChange} label="Toggle setting" />
}
