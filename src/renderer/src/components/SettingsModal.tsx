import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext, closestCenter, type DragEndEvent,
  KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PROVIDER_DEFS,
  getDefaultPermissionMode,
  getPrimaryPermissionModes,
  getVisibleModels,
  type ProviderCommandSurface,
  type ProviderCommandSurfaceResult,
  type ProviderDiagnosticInfo,
  type ProviderRuntimeInfo,
  type SessionListItem,
  type UsageSummary
} from '../types'
import { useSessionStore } from '../store/sessions'
import type { SettingsSection } from '../store/sessions'
import type { AppProfile } from '../env'
import { formatShortcutKeys, formatShortcutSequence, visibleShortcutRows } from '../../../types/appCommands'
import { parsePortableTheme, serializePortableTheme } from '../../../types/themeSharing'
import ProviderIcon from './shared/ProviderIcon'
import Icon from './shared/Icon'
import {
  CompactSetting,
  DiagnosticPill,
  SettingChoiceCard,
  SettingGroup,
  SegmentedControl as SystemSegmentedControl,
  SettingsIntro,
  SettingsPanel,
  StatusPill,
  SwitchControl
} from './shared/designSystem'
import { applyAppearance, type Accent, type Appearance, type AppearanceTheme, type ChromeTheme, type Density, type TranscriptStyle } from '../theme'

type PreferredEditor = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'

const defaultLightChromeTheme: ChromeTheme = {
  accent: '#0a7cff',
  surface: '#ffffff',
  ink: '#111111',
  contrast: 45,
  opaqueWindows: false
}

const defaultDarkChromeTheme: ChromeTheme = {
  accent: '#8ab4f8',
  surface: '#20222a',
  ink: '#f3f3f0',
  contrast: 58,
  opaqueWindows: true
}

const pillButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  padding: '7px 11px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--control-bg)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11.5,
  fontWeight: 650,
  cursor: 'pointer'
}

interface Props {
  section: SettingsSection
  onClose: () => void
}

export default function SettingsPage({ section, onClose }: Props): JSX.Element {
  const { providerAvailability, sessions, setProviderModels: storeSetProviderModels } = useSessionStore()
  const [defaultProvider, setDefaultProvider] = useState('claude')
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [defaultEfforts, setDefaultEfforts] = useState<Record<string, string>>({})
  const [defaultPermissionModes, setDefaultPermissionModes] = useState<Record<string, string>>({})
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [providerRuntime, setProviderRuntime] = useState<Record<string, ProviderRuntimeInfo>>({})
  const [providerDiagnostics, setProviderDiagnostics] = useState<Record<string, ProviderDiagnosticInfo>>({})
  const [diagnosticsLoading, setDiagnosticsLoading] = useState<Record<string, boolean>>({})
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>('system')
  const [appearance, setAppearance] = useState<Appearance>('mist')
  const [accent, setAccent] = useState<Accent>('blue')
  const [density, setDensity] = useState<Density>('comfortable')
  const [sidebarTint, setSidebarTint] = useState(true)
  const [transcriptStyle, setTranscriptStyle] = useState<TranscriptStyle>('relaxed')
  const [customAccent, setCustomAccent] = useState('#0a7cff')
  const [interfaceScale, setInterfaceScale] = useState(1)
  const [uiFont, setUiFont] = useState('system')
  const [monoFont, setMonoFont] = useState('system')
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>('system')
  const [lightChromeTheme, setLightChromeTheme] = useState<ChromeTheme>(defaultLightChromeTheme)
  const [darkChromeTheme, setDarkChromeTheme] = useState<ChromeTheme>(defaultDarkChromeTheme)
  const [lightCodeThemeId, setLightCodeThemeId] = useState('github-light')
  const [darkCodeThemeId, setDarkCodeThemeId] = useState('github-dark')
  const [sansFontSize, setSansFontSize] = useState(13)
  const [codeFontSize, setCodeFontSize] = useState(13)
  const [useFontSmoothing, setUseFontSmoothing] = useState(true)
  const [usePointerCursors, setUsePointerCursors] = useState(true)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((s) => {
      const rec = s as unknown as Record<string, unknown>
      setDefaultProvider((rec.defaultProvider as string) ?? 'claude')
      setDefaultModels((rec.defaultModels as Record<string, string>) ?? {})
      setDefaultEfforts((rec.defaultEfforts as Record<string, string>) ?? {})
      setDefaultPermissionModes((rec.defaultPermissionModes as Record<string, string>) ?? {})
      setProviderModels((rec.providerModels as Record<string, string[]>) ?? {})
      setPreferredEditor(normalizePreferredEditor(rec.preferredEditor))
      setAppearance((rec.appearance as Appearance) ?? 'mist')
      setAccent((rec.accent as Accent) ?? 'blue')
      setDensity((rec.density as Density) ?? 'comfortable')
      setSidebarTint((rec.sidebarTint as boolean | undefined) ?? true)
      setTranscriptStyle((rec.transcriptStyle as TranscriptStyle) ?? 'relaxed')
      setCustomAccent((rec.customAccent as string) ?? '#0a7cff')
      setInterfaceScale((rec.interfaceScale as number) ?? 1)
      setUiFont((rec.uiFont as string) ?? 'system')
      setMonoFont((rec.monoFont as string) ?? 'system')
      setAppearanceTheme((rec.appearanceTheme as AppearanceTheme) ?? 'system')
      setLightChromeTheme(normalizeChromeTheme(rec.appearanceLightChromeTheme, defaultLightChromeTheme))
      setDarkChromeTheme(normalizeChromeTheme(rec.appearanceDarkChromeTheme, defaultDarkChromeTheme))
      setLightCodeThemeId((rec.appearanceLightCodeThemeId as string) ?? 'github-light')
      setDarkCodeThemeId((rec.appearanceDarkCodeThemeId as string) ?? 'github-dark')
      setSansFontSize((rec.sansFontSize as number) ?? 13)
      setCodeFontSize((rec.codeFontSize as number) ?? 13)
      setUseFontSmoothing((rec.useFontSmoothing as boolean | undefined) ?? true)
      setUsePointerCursors((rec.usePointerCursors as boolean | undefined) ?? true)
      setReduceMotion((rec.reduceMotion as boolean | undefined) ?? false)
    })
    window.api.providers.getRuntimeInfo().then(setProviderRuntime)
  }, [])

  const loadProviderDiagnostics = useCallback((providerId: string): void => {
    if (providerDiagnostics[providerId] || diagnosticsLoading[providerId]) return
    setDiagnosticsLoading((current) => ({ ...current, [providerId]: true }))
    window.api.providers.getDiagnostics(providerId)
      .then((next) => setProviderDiagnostics((current) => ({ ...current, ...next })))
      .finally(() => {
        setDiagnosticsLoading((current) => ({ ...current, [providerId]: false }))
      })
  }, [diagnosticsLoading, providerDiagnostics])

  const saveDefaultProvider = (id: string): void => {
    setDefaultProvider(id)
    window.api.settings.set('defaultProvider', id)
  }

  const saveDefaultModel = (providerId: string, modelId: string): void => {
    const next = { ...defaultModels, [providerId]: modelId }
    setDefaultModels(next)
    window.api.settings.set('defaultModels', next)
  }

  const saveDefaultEffort = (providerId: string, effortId: string): void => {
    const next = { ...defaultEfforts, [providerId]: effortId }
    setDefaultEfforts(next)
    window.api.settings.set('defaultEfforts', next)
  }

  const saveDefaultPermissionMode = (providerId: string, modeId: string): void => {
    const next = { ...defaultPermissionModes, [providerId]: modeId }
    setDefaultPermissionModes(next)
    window.api.settings.set('defaultPermissionModes', next)
  }

  const saveProviderModels = (providerId: string, models: string[]): void => {
    const next = { ...providerModels, [providerId]: models }
    setProviderModels(next)
    storeSetProviderModels(next)
    window.api.settings.set('providerModels', next)
  }

  const savePreferredEditor = (value: PreferredEditor): void => {
    setPreferredEditor(value)
    window.api.settings.set('preferredEditor', value)
  }

  const buildAppearanceModel = (overrides: Partial<{
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
  }> = {}) => ({
    appearanceTheme: overrides.appearanceTheme ?? appearanceTheme,
    appearanceLightChromeTheme: overrides.lightChromeTheme ?? lightChromeTheme,
    appearanceDarkChromeTheme: overrides.darkChromeTheme ?? darkChromeTheme,
    appearanceLightCodeThemeId: overrides.lightCodeThemeId ?? lightCodeThemeId,
    appearanceDarkCodeThemeId: overrides.darkCodeThemeId ?? darkCodeThemeId,
    sansFontSize: overrides.sansFontSize ?? sansFontSize,
    codeFontSize: overrides.codeFontSize ?? codeFontSize,
    useFontSmoothing: overrides.useFontSmoothing ?? useFontSmoothing,
    usePointerCursors: overrides.usePointerCursors ?? usePointerCursors,
    reduceMotion: overrides.reduceMotion ?? reduceMotion
  })

  const applyAppearanceModel = (overrides?: Parameters<typeof buildAppearanceModel>[0]): void => {
    applyAppearance(
      appearance,
      accent,
      density,
      sidebarTint,
      transcriptStyle,
      customAccent,
      interfaceScale,
      uiFont,
      monoFont,
      buildAppearanceModel(overrides)
    )
  }

  const saveAppearanceTheme = (value: AppearanceTheme): void => {
    setAppearanceTheme(value)
    applyAppearanceModel({ appearanceTheme: value })
    window.api.settings.set('appearanceTheme', value)
  }

  const saveChromeTheme = (variant: 'light' | 'dark', nextTheme: ChromeTheme): void => {
    if (variant === 'light') {
      setLightChromeTheme(nextTheme)
      applyAppearanceModel({ lightChromeTheme: nextTheme })
      window.api.settings.set('appearanceLightChromeTheme', nextTheme)
    } else {
      setDarkChromeTheme(nextTheme)
      applyAppearanceModel({ darkChromeTheme: nextTheme })
      window.api.settings.set('appearanceDarkChromeTheme', nextTheme)
    }
  }

  const saveThemeFontSize = (kind: 'ui' | 'code', value: number): void => {
    if (kind === 'ui') {
      setSansFontSize(value)
      applyAppearanceModel({ sansFontSize: value })
      window.api.settings.set('sansFontSize', value)
    } else {
      setCodeFontSize(value)
      applyAppearanceModel({ codeFontSize: value })
      window.api.settings.set('codeFontSize', value)
    }
  }

  const saveThemeToggle = (key: 'useFontSmoothing' | 'usePointerCursors' | 'reduceMotion', value: boolean): void => {
    if (key === 'useFontSmoothing') setUseFontSmoothing(value)
    if (key === 'usePointerCursors') setUsePointerCursors(value)
    if (key === 'reduceMotion') setReduceMotion(value)
    applyAppearanceModel({ [key]: value })
    window.api.settings.set(key, value)
  }

  const importPortableTheme = (raw: string): { ok: boolean; error?: string } => {
    const result = parsePortableTheme(raw)
    if (!result.ok) return result
    const { variant, codeThemeId, theme } = result.value
    if (variant === 'light') {
      setLightChromeTheme(theme)
      setLightCodeThemeId(codeThemeId)
      setAppearanceTheme('light')
      applyAppearanceModel({ appearanceTheme: 'light', lightChromeTheme: theme, lightCodeThemeId: codeThemeId })
      window.api.settings.set('appearanceLightChromeTheme', theme)
      window.api.settings.set('appearanceLightCodeThemeId', codeThemeId)
    } else {
      setDarkChromeTheme(theme)
      setDarkCodeThemeId(codeThemeId)
      setAppearanceTheme('dark')
      applyAppearanceModel({ appearanceTheme: 'dark', darkChromeTheme: theme, darkCodeThemeId: codeThemeId })
      window.api.settings.set('appearanceDarkChromeTheme', theme)
      window.api.settings.set('appearanceDarkCodeThemeId', codeThemeId)
    }
    window.api.settings.set('appearanceTheme', variant)
    return { ok: true }
  }

  const saveAppearance = (value: Appearance): void => {
    setAppearance(value)
    applyAppearance(value, accent, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont)
    window.api.settings.set('appearance', value)
  }

  const saveAccent = (value: Accent): void => {
    setAccent(value)
    applyAppearance(appearance, value, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont)
    window.api.settings.set('accent', value)
  }

  const saveDensity = (value: Density): void => {
    setDensity(value)
    applyAppearance(appearance, accent, value, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont)
    window.api.settings.set('density', value)
  }

  const saveSidebarTint = (value: boolean): void => {
    setSidebarTint(value)
    applyAppearance(appearance, accent, density, value, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont)
    window.api.settings.set('sidebarTint', value)
  }

  const saveTranscriptStyle = (value: TranscriptStyle): void => {
    setTranscriptStyle(value)
    applyAppearance(appearance, accent, density, sidebarTint, value, customAccent, interfaceScale, uiFont, monoFont)
    window.api.settings.set('transcriptStyle', value)
  }

  const saveCustomAccent = (value: string): void => {
    setCustomAccent(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, value, interfaceScale, uiFont, monoFont)
    window.api.settings.set('customAccent', value)
  }

  const saveInterfaceScale = (value: number): void => {
    setInterfaceScale(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, customAccent, value, uiFont, monoFont)
    window.api.settings.set('interfaceScale', value)
  }

  const saveUiFont = (value: string): void => {
    setUiFont(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, value, monoFont)
    window.api.settings.set('uiFont', value)
  }

  const saveMonoFont = (value: string): void => {
    setMonoFont(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, value)
    window.api.settings.set('monoFont', value)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--canvas-bg)' }}>
      <div
        style={{
          height: 46,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '0 14px 0 20px',
          background: 'var(--surface-bg)',
          borderBottom: '1px solid var(--border-subtle)',
          userSelect: 'none',
          WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-primary)' }}>{settingsTitle(section)}</span>
        <button
          onClick={onClose}
          title="Back to chat"
          className="flex items-center gap-1.5 text-xs"
          style={{
            WebkitAppRegion: 'no-drag',
            background: 'var(--control-bg)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 10px',
            fontWeight: 600
          } as React.CSSProperties}
        >
          <Icon name="chat" size={14} />
          Chat
        </button>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--canvas-bg)' }}>
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          {section === 'general' && (
            <GeneralSection
              preferredEditor={preferredEditor}
              onSetPreferredEditor={savePreferredEditor}
            />
          )}
          {section === 'appearance' && (
            <AppearanceSection
              appearance={appearance}
              accent={accent}
              density={density}
              sidebarTint={sidebarTint}
              transcriptStyle={transcriptStyle}
              customAccent={customAccent}
              interfaceScale={interfaceScale}
              uiFont={uiFont}
              monoFont={monoFont}
              appearanceTheme={appearanceTheme}
              lightChromeTheme={lightChromeTheme}
              darkChromeTheme={darkChromeTheme}
              lightCodeThemeId={lightCodeThemeId}
              darkCodeThemeId={darkCodeThemeId}
              sansFontSize={sansFontSize}
              codeFontSize={codeFontSize}
              useFontSmoothing={useFontSmoothing}
              usePointerCursors={usePointerCursors}
              reduceMotion={reduceMotion}
              onSetAppearance={saveAppearance}
              onSetAccent={saveAccent}
              onSetDensity={saveDensity}
              onSetSidebarTint={saveSidebarTint}
              onSetTranscriptStyle={saveTranscriptStyle}
              onSetCustomAccent={saveCustomAccent}
              onSetInterfaceScale={saveInterfaceScale}
              onSetUiFont={saveUiFont}
              onSetMonoFont={saveMonoFont}
              onSetAppearanceTheme={saveAppearanceTheme}
              onSetChromeTheme={saveChromeTheme}
              onSetThemeFontSize={saveThemeFontSize}
              onSetThemeToggle={saveThemeToggle}
              onImportPortableTheme={importPortableTheme}
            />
          )}
          {section === 'pets' && <PetsSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'data' && <DataControlsSection />}
          {section === 'providers' && (
            <ProvidersSection
              defaultProvider={defaultProvider}
              sessions={sessions}
              defaultModels={defaultModels}
              defaultEfforts={defaultEfforts}
              defaultPermissionModes={defaultPermissionModes}
              providerModels={providerModels}
              providerRuntime={providerRuntime}
              providerDiagnostics={providerDiagnostics}
              diagnosticsLoading={diagnosticsLoading}
              providerAvailability={providerAvailability}
              onSetDefaultProvider={saveDefaultProvider}
              onSetDefaultModel={saveDefaultModel}
              onSetDefaultEffort={saveDefaultEffort}
              onSetDefaultPermissionMode={saveDefaultPermissionMode}
              onSetProviderModels={saveProviderModels}
              onLoadProviderDiagnostics={loadProviderDiagnostics}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function settingsTitle(section: SettingsSection): string {
  if (section === 'appearance') return 'Appearance'
  if (section === 'providers') return 'Providers'
  if (section === 'shortcuts') return 'Shortcuts'
  if (section === 'pets') return 'Pets'
  if (section === 'data') return 'Data controls'
  return 'General'
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

function DataControlsSection(): JSX.Element {
  const [profile, setProfile] = useState<AppProfile | null>(null)

  useEffect(() => {
    window.api.app.getProfile().then(setProfile).catch(() => setProfile(null))
  }, [])

  return (
    <div data-testid="data-controls-settings-section" style={{ padding: '30px 44px 56px', maxWidth: 860, margin: '0 auto' }}>
      <SettingsIntro
        description="Review where Orchestrator stores local app data. Destructive data actions stay out of this surface until they have explicit confirmation flows."
      />

      <SettingGroup title="Local profile" description="Current Electron profile and user-data directory for this app window.">
        <SettingsPanel>
          <CompactSetting title="Profile">
            <InlineMutedText>{profile?.displayName ?? 'Default'}{profile?.isIsolated ? ' isolated profile' : ' profile'}</InlineMutedText>
          </CompactSetting>
          <CompactSetting title="User data">
            <div style={{ display: 'grid', gap: 8 }}>
              <code
                style={{
                  display: 'block',
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-bg)',
                  color: 'var(--text-secondary)',
                  padding: '8px 10px',
                  fontSize: 11
                }}
              >
                {profile?.userDataDir ?? 'Loading...'}
              </code>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  disabled={!profile?.userDataDir}
                  onClick={() => { if (profile?.userDataDir) void window.api.fs.openPath(profile.userDataDir) }}
                  style={pillButtonStyle}
                >
                  Open data folder
                </button>
                <button
                  type="button"
                  disabled={!profile?.userDataDir}
                  onClick={() => { if (profile?.userDataDir) void navigator.clipboard.writeText(profile.userDataDir) }}
                  style={pillButtonStyle}
                >
                  Copy path
                </button>
              </div>
            </div>
          </CompactSetting>
        </SettingsPanel>
      </SettingGroup>
    </div>
  )
}

function normalizeChromeTheme(value: unknown, fallback: ChromeTheme): ChromeTheme {
  if (!value || typeof value !== 'object') return fallback
  const record = value as Partial<ChromeTheme>
  return {
    ...fallback,
    accent: typeof record.accent === 'string' ? record.accent : fallback.accent,
    surface: typeof record.surface === 'string' ? record.surface : fallback.surface,
    ink: typeof record.ink === 'string' ? record.ink : fallback.ink,
    contrast: typeof record.contrast === 'number' ? record.contrast : fallback.contrast,
    opaqueWindows: typeof record.opaqueWindows === 'boolean' ? record.opaqueWindows : fallback.opaqueWindows,
    fonts: record.fonts,
    semanticColors: record.semanticColors
  }
}

// ─── General section (app-wide) ───────────────────────────────────────────────

function GeneralSection({
  preferredEditor,
  onSetPreferredEditor,
}: {
  preferredEditor: PreferredEditor
  onSetPreferredEditor: (value: PreferredEditor) => void
}): JSX.Element {
  const editorOptions: Array<{ id: PreferredEditor; label: string; desc: string }> = [
    { id: 'system', label: 'System default', desc: 'Use macOS file associations' },
    { id: 'cursor', label: 'Cursor', desc: 'Open file cards in Cursor' },
    { id: 'vscode', label: 'VS Code', desc: 'Open file cards in Visual Studio Code' },
    { id: 'vscode-insiders', label: 'VS Code Insiders', desc: 'Use the Insiders app' },
    { id: 'zed', label: 'Zed', desc: 'Open file cards in Zed' }
  ]

  return (
    <div style={{ padding: '30px 44px 56px', maxWidth: 820, margin: '0 auto' }}>
      <SettingsIntro
        description="App-level defaults that affect everyday navigation and file handoff."
      />

      <SettingGroup title="Files" description="Choose where referenced file cards open from chat.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {editorOptions.map((option) => {
            const active = preferredEditor === option.id
            return (
              <SettingChoiceCard
                key={option.id}
                label={option.label}
                description={option.desc}
                active={active}
                onClick={() => onSetPreferredEditor(option.id)}
              />
            )
          })}
        </div>
      </SettingGroup>
    </div>
  )
}

// ─── Appearance section ──────────────────────────────────────────────────────

function AppearanceSection({
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
  onSetAppearance: (value: Appearance) => void
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
  const appearanceOptions: Array<{ id: Appearance; label: string; desc: string }> = [
    { id: 'system', label: 'System', desc: 'Follow macOS' },
    { id: 'mist', label: 'Mist Light', desc: 'Soft light canvas' },
    { id: 'graphite', label: 'Graphite Dark', desc: 'Low-glare dark workspace' },
    { id: 'ocean', label: 'Ocean', desc: 'Blue-toned dark material' },
    { id: 'palenight', label: 'Palenight', desc: 'Softer purple dark material' },
    { id: 'high-contrast', label: 'High Contrast', desc: 'Maximum contrast' },
  ]
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
    <div data-testid="appearance-settings-section" style={{ padding: '30px 44px 56px', maxWidth: 960, margin: '0 auto' }}>
      <SettingsIntro
        description="Tune the app shell, typography, density, and reading rhythm without changing how your agents work."
      />

      <SettingGroup title="Mode" description="Choose whether the app resolves to light, dark, or the current system appearance.">
        <SegmentedChoice items={themeOptions} value={appearanceTheme} onChange={onSetAppearanceTheme} />
      </SettingGroup>

      <SettingGroup title="Presets" description="Start from an Orchestrator material preset before tuning colors below.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {appearanceOptions.map((option) => {
            const active = appearance === option.id
            return (
              <SettingChoiceCard
                key={option.id}
                label={option.label}
                description={option.desc}
                active={active}
                onClick={() => onSetAppearance(option.id)}
              />
            )
          })}
        </div>
      </SettingGroup>

      <SettingGroup title="Theme editor" description="Tune chrome and semantic colors independently for light and dark variants.">
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <ChromeThemeEditor title="Light chrome" variant="light" theme={lightChromeTheme} onChange={updateChrome} />
          <ChromeThemeEditor title="Dark chrome" variant="dark" theme={darkChromeTheme} onChange={updateChrome} />
        </div>
      </SettingGroup>

      <SettingGroup title="Sharing" description="Import or copy a portable Codex theme string.">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              data-testid="copy-light-theme"
              onClick={() => copyTheme('light')}
              style={pillButtonStyle}
            >
              Copy light theme
            </button>
            <button
              type="button"
              data-testid="copy-dark-theme"
              onClick={() => copyTheme('dark')}
              style={pillButtonStyle}
            >
              Copy dark theme
            </button>
          </div>
          <textarea
            data-testid="theme-import-input"
            value={themeImportText}
            onChange={(event) => setThemeImportText(event.currentTarget.value)}
            placeholder="codex-theme-v1:{...}"
            style={{
              minHeight: 76,
              resize: 'vertical',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-bg)',
              color: 'var(--text-primary)',
              padding: 10,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              outline: 'none'
            }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="theme-import-button"
              onClick={importTheme}
              style={pillButtonStyle}
            >
              Import theme
            </button>
            {themeImportStatus && (
              <span data-testid="theme-import-status" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                {themeImportStatus}
              </span>
            )}
          </div>
        </div>
      </SettingGroup>

      <SettingGroup title="Quick accent" description="A lightweight accent preset for primary actions, focus rings, and active states.">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {accentOptions.map((option) => (
              <button
                key={option.id}
                onClick={() => onSetAccent(option.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-pill)',
                  background: accent === option.id ? 'var(--control-bg-active)' : 'var(--control-bg)',
                  border: `1px solid ${accent === option.id ? option.color : 'var(--border-subtle)'}`,
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: option.color }} />
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Custom accent
            <input
              type="color"
              value={customAccent}
              onChange={(event) => onSetCustomAccent(event.currentTarget.value)}
              style={{
                width: 34,
                height: 28,
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'transparent'
              }}
            />
          </label>
        </div>
      </SettingGroup>

      <SettingGroup title="Typography" description="Choose app and terminal type independently.">
        <div style={{ display: 'grid', gap: 12 }}>
          <SegmentedChoice items={fontOptions} value={uiFont} onChange={onSetUiFont} />
          <SegmentedChoice items={monoOptions} value={monoFont} onChange={onSetMonoFont} />
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
            Interface scale
            <input
              type="range"
              min="0.9"
              max="1.12"
              step="0.01"
              value={interfaceScale}
              onChange={(event) => onSetInterfaceScale(Number(event.currentTarget.value))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
            UI font size
            <input
              data-testid="appearance-ui-font-size"
              type="range"
              min="11"
              max="18"
              step="1"
              value={sansFontSize}
              onChange={(event) => onSetThemeFontSize('ui', Number(event.currentTarget.value))}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
            Code font size
            <input
              data-testid="appearance-code-font-size"
              type="range"
              min="11"
              max="18"
              step="1"
              value={codeFontSize}
              onChange={(event) => onSetThemeFontSize('code', Number(event.currentTarget.value))}
            />
          </label>
        </div>
      </SettingGroup>

      <SettingGroup title="Layout and reading" description="Control density, transcript rhythm, and sidebar material.">
        <div style={{ display: 'grid', gap: 12 }}>
          <SegmentedChoice items={densityOptions} value={density} onChange={onSetDensity} />
          <SegmentedChoice items={transcriptOptions} value={transcriptStyle} onChange={onSetTranscriptStyle} />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-bg)'
            }}
          >
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>Tint sidebar</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Use the soft tinted rail material.</span>
            </span>
            <Switch checked={sidebarTint} onChange={onSetSidebarTint} />
          </label>
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
        </div>
      </SettingGroup>
    </div>
  )
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
      style={{
        display: 'grid',
        gap: 12,
        padding: 14,
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-bg)'
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{title}</div>
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
      <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12 }}>
        Contrast
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={theme.contrast}
          onChange={(event) => onChange(variant, { contrast: Number(event.currentTarget.value) })}
        />
      </label>
      <PreferenceToggle
        title="Opaque windows"
        description="Use solid chrome instead of translucent sidebar material."
        checked={theme.opaqueWindows}
        onChange={(value) => onChange(variant, { opaqueWindows: value })}
      />
    </div>
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          width: 34,
          height: 28,
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          background: 'transparent'
        }}
      />
    </label>
  )
}

function PreferenceToggle({
  title,
  description,
  checked,
  onChange
}: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-bg)'
      }}
    >
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{description}</span>
      </span>
      <Switch checked={checked} onChange={onChange} />
    </label>
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

function ShortcutsSection(): JSX.Element {
  const [query, setQuery] = useState('')
  const shortcutPlatform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
  const shortcuts = visibleShortcutRows().map((shortcut) => ({
    ...shortcut,
    category: shortcut.group,
    keys: shortcut.shortcuts.map((sequence) => formatShortcutKeys(sequence, shortcutPlatform)),
    primaryShortcut: formatShortcutSequence(shortcut.shortcuts[0], shortcutPlatform)
  }))
  const normalizedQuery = query.trim().toLowerCase()
  const visibleShortcuts = shortcuts.filter((shortcut) => {
    if (!normalizedQuery) return true
    return [
      shortcut.category,
      shortcut.label,
      shortcut.description,
      shortcut.keys.flat().join(' ')
    ].join(' ').toLowerCase().includes(normalizedQuery)
  })
  const groupedShortcuts: Array<{ category: string; rows: typeof shortcuts }> = []
  for (const shortcut of visibleShortcuts) {
    const group = groupedShortcuts.find((entry) => entry.category === shortcut.category)
    if (group) group.rows.push(shortcut)
    else groupedShortcuts.push({ category: shortcut.category, rows: [shortcut] })
  }

  return (
    <div data-testid="shortcuts-settings-section" style={{ padding: '24px 44px 52px', maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginBottom: 12 }}>
        <label className="sr-only" htmlFor="settings-shortcut-search">Search keyboard shortcuts</label>
        <input
          id="settings-shortcut-search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search shortcuts"
          className="rounded-lg px-3 text-sm outline-none"
          style={{
            width: 'min(360px, 100%)',
            height: 34,
            background: 'var(--control-bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        />
      </div>

      <div
        className="overflow-hidden rounded-lg"
        style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-bg)' }}
      >
        {groupedShortcuts.map((group, groupIndex) => (
          <div key={group.category} className={groupIndex === 0 ? '' : 'border-t'} style={{ borderColor: 'var(--border-subtle)' }}>
            <div
              className="px-3 py-1 text-[10px] font-bold uppercase"
              style={{
                background: 'var(--control-bg)',
                color: 'var(--text-tertiary)'
              }}
            >
              {group.category}
            </div>
            {group.rows.map((shortcut, rowIndex) => (
              <div
                key={shortcut.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t px-3 py-2"
                style={{
                  borderColor: rowIndex === 0 ? 'transparent' : 'var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                <span className="min-w-0 truncate text-[13px] font-medium">{shortcut.label}</span>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <kbd
                    className="rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold"
                    data-testid="settings-shortcut-key"
                    style={{
                      background: 'var(--control-bg)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    {shortcut.primaryShortcut}
                  </kbd>
                </span>
              </div>
            ))}
          </div>
        ))}
        {visibleShortcuts.length === 0 && (
          <div className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            No matching shortcuts
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Providers section ────────────────────────────────────────────────────────

function ProvidersSection({
  defaultProvider, sessions, defaultModels, defaultEfforts, defaultPermissionModes, providerModels,
  providerRuntime, providerDiagnostics, diagnosticsLoading, providerAvailability, defaultAdvancedOpen = false, onSetDefaultProvider, onSetDefaultModel, onSetDefaultEffort, onSetDefaultPermissionMode, onSetProviderModels, onLoadProviderDiagnostics
}: {
  defaultProvider: string
  sessions: SessionListItem[]
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  providerRuntime: Record<string, ProviderRuntimeInfo>
  providerDiagnostics: Record<string, ProviderDiagnosticInfo>
  diagnosticsLoading: Record<string, boolean>
  providerAvailability: Record<string, boolean>
  defaultAdvancedOpen?: boolean
  onSetDefaultProvider: (id: string) => void
  onSetDefaultModel: (providerId: string, modelId: string) => void
  onSetDefaultEffort: (providerId: string, effortId: string) => void
  onSetDefaultPermissionMode: (providerId: string, modeId: string) => void
  onSetProviderModels: (providerId: string, models: string[]) => void
  onLoadProviderDiagnostics: (providerId: string) => void
}): JSX.Element {
  const providerList = Object.values(PROVIDER_DEFS)
  const [selectedId, setSelectedId] = useState(defaultProvider)
  const providerDef = PROVIDER_DEFS[selectedId] ?? PROVIDER_DEFS.claude
  const installed = providerAvailability[selectedId] !== false
  const currentModel = defaultModels[selectedId] ?? providerDef.models[0]?.id ?? ''
  const currentEffort = defaultEfforts[selectedId] ?? providerDef.effortLevels[0]?.id ?? ''
  const currentPermissionMode = getDefaultPermissionMode(providerDef, defaultPermissionModes[selectedId])
  const visibleModels = getVisibleModels(providerDef, providerModels)
  const primaryPermissionModes = getPrimaryPermissionModes(providerDef)
  const visibleIds = visibleModels.map((m) => m.id)
  const runtime = providerRuntime[selectedId]
  const diagnostics = providerDiagnostics[selectedId]
  const loadingDiagnostics = diagnosticsLoading[selectedId] === true
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen)
  const settingsCommandSurfaces = visibleSettingsCommandSurfaces(selectedId, runtime?.registry.commandSurfaces ?? [])
  const usageSnapshot = summarizeProviderUsage(sessions, selectedId)
  const modelForPicker = visibleIds.includes(currentModel)
    ? currentModel
    : visibleModels[0]?.id ?? currentModel

  useEffect(() => {
    if (advancedOpen) onLoadProviderDiagnostics(selectedId)
  }, [advancedOpen, onLoadProviderDiagnostics, selectedId])

  const handleVisibleModelsChange = (ids: string[]): void => {
    onSetProviderModels(selectedId, ids)
    if (ids.length > 0 && !ids.includes(currentModel)) onSetDefaultModel(selectedId, ids[0])
  }

  return (
    <div data-testid="provider-settings-section" style={{ padding: '34px 44px 56px', maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <ProviderDropdown
          providers={providerList}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Per-provider content — key forces clean remount on provider switch, stopping DnD jitter */}
        <div key={selectedId}>
          <ProviderHeaderCard
            providerId={selectedId}
            providerName={providerDef.name}
            color={providerDef.color}
            installed={installed}
            isDefault={defaultProvider === selectedId}
            installCmd={providerDef.installCmd}
            onSetDefault={() => onSetDefaultProvider(selectedId)}
          />

          <SettingsPanel>
            <CompactSetting title="Default">
              <DefaultModelPicker
                providerDef={providerDef}
                models={visibleModels}
                currentModel={modelForPicker}
                onSetModel={(id) => onSetDefaultModel(selectedId, id)}
              />
            </CompactSetting>

            {providerDef.supportsEffort && providerDef.effortLevels.length > 0 && (
              <CompactSetting title="Thinking">
                <SegmentedControl
                  items={providerDef.effortLevels}
                  value={currentEffort}
                  color={providerDef.color}
                  onChange={(id) => onSetDefaultEffort(selectedId, id)}
                />
              </CompactSetting>
            )}

            {primaryPermissionModes.length > 0 && (
              <CompactSetting title="Mode">
                <SegmentedControl
                  items={primaryPermissionModes}
                  value={currentPermissionMode}
                  color={providerDef.color}
                  onChange={(id) => onSetDefaultPermissionMode(selectedId, id)}
                />
              </CompactSetting>
            )}
          </SettingsPanel>

          <SettingsPanel>
            <CompactSetting title="Models">
              <ModelListManager
                providerDef={providerDef}
                visibleIds={visibleIds}
                onChange={handleVisibleModelsChange}
              />
            </CompactSetting>
          </SettingsPanel>

          <button
            onClick={() => setAdvancedOpen((open) => !open)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              marginTop: -2,
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Diagnostics
            <span style={{ color: 'var(--color-text-muted)' }}>{advancedOpen ? 'Close' : 'Open'}</span>
          </button>

          {advancedOpen && (
            <SettingsPanel>
              {loadingDiagnostics && !diagnostics && (
                <CompactSetting title="Health">
                  <InlineMutedText>Checking local CLI...</InlineMutedText>
                </CompactSetting>
              )}
              {diagnostics && (
                <CompactSetting title="Health">
                  <ProviderDiagnosticsCard diagnostics={diagnostics} color={providerDef.color} />
                </CompactSetting>
              )}
              <CompactSetting title="Usage">
                <ProviderUsageDiagnosticsCard
                  providerId={selectedId}
                  diagnostics={diagnostics}
                  usage={usageSnapshot}
                  color={providerDef.color}
                />
              </CompactSetting>
              {diagnostics && diagnostics.probes.length > 0 && (
                <CompactSetting title="Checks">
                  <ProviderProbeGrid diagnostics={diagnostics} color={providerDef.color} />
                </CompactSetting>
              )}
              {providerDef.id === 'claude' && (
                <CompactSetting title="Endpoint">
                  <ClaudeEndpointField color={providerDef.color} />
                </CompactSetting>
              )}
              <CompactSetting title="Config">
                <ProviderConfigEditor providerId={providerDef.id} color={providerDef.color} />
              </CompactSetting>
            </SettingsPanel>
          )}

          {settingsCommandSurfaces.length > 0 && (
            <SettingsPanel>
              <CompactSetting title="Capabilities">
                <ProviderCommandSurfaces
                  providerId={selectedId}
                  color={providerDef.color}
                  surfaces={settingsCommandSurfaces}
                />
              </CompactSetting>
            </SettingsPanel>
          )}
        </div>
      </div>
    </div>
  )
}

const CODEX_SETTINGS_COMMAND_SURFACE_IDS = new Set([
  'appserver-models',
  'appserver-model-provider-capabilities',
  'appserver-features',
  'appserver-config',
  'appserver-config-requirements',
  'appserver-account',
  'appserver-rate-limits',
  'appserver-auth-status'
])

function visibleSettingsCommandSurfaces(providerId: string, surfaces: ProviderCommandSurface[]): ProviderCommandSurface[] {
  if (providerId !== 'codex') return surfaces
  return surfaces.filter((surface) => CODEX_SETTINGS_COMMAND_SURFACE_IDS.has(surface.id))
}

function ProviderDropdown({
  providers,
  selectedId,
  onSelect,
}: {
  providers: Array<typeof PROVIDER_DEFS[string]>
  selectedId: string
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ color: 'var(--color-text)', fontSize: 13, fontWeight: 700 }}>
          Provider
        </span>
      </div>
      <select
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
        style={{
          width: 'min(300px, 100%)',
          height: 32,
          borderRadius: 7,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface2)',
          color: 'var(--color-text)',
          fontSize: 12,
          fontWeight: 600,
          padding: '0 8px',
          outline: 'none',
        }}
      >
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.name}</option>
        ))}
      </select>
    </div>
  )
}

function ProviderHeaderCard({
  providerId,
  providerName,
  color,
  installed,
  isDefault,
  showDefaultControls = true,
  installCmd,
  onSetDefault,
}: {
  providerId: string
  providerName: string
  color: string
  installed: boolean
  isDefault: boolean
  showDefaultControls?: boolean
  installCmd: string
  onSetDefault: () => void
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 12,
        borderRadius: 8,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: `${color}18`,
          color,
          flexShrink: 0,
        }}
      >
        <ProviderIcon providerId={providerId} size={18} color={color} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)' }}>{providerName}</div>
          <StatusPill label={installed ? 'Ready' : 'Missing'} color={installed ? 'var(--color-green)' : '#F87171'} />
          {showDefaultControls && isDefault && <StatusPill label="Default" color={color} />}
        </div>
        {!installed && (
          <div style={{ marginTop: 8, maxWidth: 420 }}>
            <InstallCommand cmd={installCmd} />
          </div>
        )}
      </div>
      {showDefaultControls && !isDefault && (
        <button
          onClick={onSetDefault}
          disabled={!installed}
          style={{
            padding: '7px 12px',
            borderRadius: 7,
            border: `1px solid ${installed ? color : 'var(--color-border)'}`,
            background: installed ? `${color}12` : 'var(--color-surface2)',
            color: installed ? color : 'var(--color-text-muted)',
            cursor: installed ? 'pointer' : 'default',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          Set default
        </button>
      )}
    </div>
  )
}

function ProviderCommandSurfaces({
  providerId,
  color,
  surfaces
}: {
  providerId: string
  color: string
  surfaces: ProviderCommandSurface[]
}): JSX.Element {
  const runnableSurfaces = surfaces.filter((surface) => surface.quota === 'none' && !surface.mutatesState)
  const [results, setResults] = useState<Record<string, ProviderCommandSurfaceResult>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [openId, setOpenId] = useState<string | null>(surfaces[0]?.id ?? null)

  const runSurface = async (surface: ProviderCommandSurface): Promise<void> => {
    if (surface.quota !== 'none' || surface.mutatesState) return
    setOpenId(surface.id)
    setLoading((current) => ({ ...current, [surface.id]: true }))
    try {
      const result = await window.api.providers.runCommandSurface(providerId, surface.id)
      setResults((current) => ({ ...current, [surface.id]: result }))
    } finally {
      setLoading((current) => ({ ...current, [surface.id]: false }))
    }
  }

  if (surfaces.length === 0) return <></>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
        value={openId ?? ''}
        onChange={(event) => setOpenId(event.target.value)}
        style={{
          width: 'min(340px, 100%)',
          height: 32,
          borderRadius: 7,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface2)',
          color: 'var(--color-text)',
          padding: '0 10px',
          fontSize: 12,
          fontWeight: 650,
          outline: 'none',
        }}
      >
        {surfaces.map((surface) => (
          <option key={surface.id} value={surface.id}>{surface.label}</option>
        ))}
      </select>

      {openId && (
        <CommandSurfaceOutput
          color={color}
          surface={surfaces.find((surface) => surface.id === openId)}
          result={results[openId]}
          loading={loading[openId] === true}
          onRun={(surface) => runSurface(surface)}
        />
      )}
    </div>
  )
}

function CommandSurfaceOutput({
  color,
  surface,
  result,
  loading,
  onRun
}: {
  color: string
  surface?: ProviderCommandSurface
  result?: ProviderCommandSurfaceResult
  loading: boolean
  onRun: (surface: ProviderCommandSurface) => void
}): JSX.Element {
  if (!surface) return <></>
  const runnable = surface.quota === 'none' && !surface.mutatesState
  const output = result?.output.trim()
  const statusColor = result?.status === 'ok'
    ? '#22C55E'
    : result?.status === 'error'
      ? '#EF4444'
      : 'var(--color-text-muted)'

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--color-surface2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '9px 10px',
          borderBottom: output || loading || !runnable ? '1px solid var(--color-border)' : 'none',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>{surface.label}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {surface.command.length > 0 ? surface.command.join(' ') : surface.runtime}
          </div>
        </div>
        <button
          disabled={!runnable || loading}
          onClick={() => onRun(surface)}
          style={{
            padding: '6px 10px',
            borderRadius: 7,
            border: `1px solid ${runnable ? color : 'var(--color-border)'}`,
            background: runnable ? color : 'var(--color-surface)',
            color: runnable ? '#fff' : 'var(--color-text-muted)',
            cursor: runnable && !loading ? 'pointer' : 'default',
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
            opacity: loading ? 0.65 : 1,
          }}
        >
          {loading ? 'Running' : runnable ? 'Refresh' : surface.quota === 'none' ? 'Manual' : 'Quota'}
        </button>
      </div>

      {!runnable ? (
        <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
          {surface.mutatesState
            ? 'This changes provider or project state. Orchestrator keeps it as an explicit terminal handoff.'
            : 'This may spend model quota or open an interactive provider flow, so it is not run from settings.'}
          {surface.note && <div style={{ marginTop: 6 }}>{surface.note}</div>}
        </div>
      ) : output ? (
        <StructuredCommandOutput output={output} color={color} surface={surface} />
      ) : (
        <div style={{ padding: 10, fontSize: 12, color: result ? statusColor : 'var(--color-text-muted)' }}>
          {loading ? 'Running…' : result ? result.status : 'Run a refresh to load this.'}
        </div>
      )}
    </div>
  )
}

function StructuredCommandOutput({ output, color, surface }: { output: string; color: string; surface?: ProviderCommandSurface }): JSX.Element {
  const parsed = parseCommandOutput(output)
  if (parsed.kind === 'json') {
    if (surface?.id.startsWith('appserver-')) {
      return <AppServerSurfaceSummary surface={surface} value={parsed.value} color={color} />
    }
    if (isAutoModeDefaults(parsed.value)) {
      return <AutoModeDefaultsSummary value={parsed.value} color={color} />
    }
    if (isMcpDetails(parsed.value)) {
      return <McpDetailsSummary details={parsed.value} color={color} />
    }
    return (
      <div style={{ padding: 10, maxHeight: 220, overflow: 'auto' }}>
        <StructuredValue value={parsed.value} color={color} depth={0} />
      </div>
    )
  }

  return (
    <div style={{ padding: 10, maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {parsed.lines.map((line, index) => (
        <div
          key={`${line}-${index}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 7,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {line}
          </span>
        </div>
      ))}
    </div>
  )
}

type AutoModeDefaults = {
  allow?: unknown[]
  soft_deny?: unknown[]
  hard_deny?: unknown[]
  environment?: unknown[]
}

function isAutoModeDefaults(value: unknown): value is AutoModeDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return ['allow', 'soft_deny', 'hard_deny', 'environment'].some((key) => Array.isArray(record[key]))
}

function AutoModeDefaultsSummary({ value, color }: { value: AutoModeDefaults; color: string }): JSX.Element {
  const sections: Array<{ key: keyof AutoModeDefaults; label: string; tone: string }> = [
    { key: 'allow', label: 'Allow', tone: '#22C55E' },
    { key: 'soft_deny', label: 'Review', tone: '#F59E0B' },
    { key: 'hard_deny', label: 'Block', tone: '#EF4444' },
    { key: 'environment', label: 'Environment', tone: color },
  ]

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflow: 'auto' }}>
      {sections.map((section) => {
        const items = (value[section.key] ?? []).map((item) => String(item))
        return (
          <details key={section.key} open={section.key === 'allow' || section.key === 'soft_deny'}>
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                listStyle: 'none',
                color: 'var(--color-text)',
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: section.tone, flexShrink: 0 }} />
              {section.label}
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 650 }}>{items.length}</span>
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7, paddingLeft: 15 }}>
              {items.length === 0 ? (
                <EmptyInlineValue />
              ) : items.map((item, index) => (
                <div
                  key={`${section.key}-${index}`}
                  title={item}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    fontSize: 11,
                    lineHeight: 1.35,
                  }}
                >
                  {summarizePolicyLine(item)}
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function summarizePolicyLine(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
}

type McpDetail = { server: string; status: 'ok' | 'error'; detail: string }

function isMcpDetails(value: unknown): value is McpDetail[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    return typeof record.server === 'string' && (record.status === 'ok' || record.status === 'error')
  })
}

function McpDetailsSummary({ details, color }: { details: McpDetail[]; color: string }): JSX.Element {
  if (details.length === 0) {
    return <div style={{ padding: 10 }}><EmptyInlineValue /></div>
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 260, overflow: 'auto' }}>
      {details.map((detail) => {
        const ok = detail.status === 'ok'
        return (
          <details
            key={detail.server}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              background: 'var(--color-surface)',
              padding: 8,
            }}
          >
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                listStyle: 'none',
                color: 'var(--color-text)',
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? color : '#EF4444', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{detail.server}</span>
              <span style={{ color: ok ? color : '#EF4444', fontSize: 10, textTransform: 'uppercase' }}>{detail.status}</span>
            </summary>
            {detail.detail && (
              <pre
                style={{
                  margin: '7px 0 0',
                  padding: 8,
                  borderRadius: 7,
                  background: 'var(--color-surface2)',
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 10.5,
                  lineHeight: 1.35,
                }}
              >
                {detail.detail}
              </pre>
            )}
          </details>
        )
      })}
    </div>
  )
}

type SummaryItem = {
  id: string
  title: string
  subtitle?: string
  meta?: string
  tone?: string
}

function AppServerSurfaceSummary({
  surface,
  value,
  color
}: {
  surface: ProviderCommandSurface
  value: unknown
  color: string
}): JSX.Element {
  const items = appServerSummaryItems(surface.id, value, color)
  const stats = appServerSummaryStats(surface.id, value)
  if (items.length === 0 && stats.length === 0) {
    return (
      <div style={{ padding: 10, maxHeight: 260, overflow: 'auto' }}>
        <StructuredValue value={value} color={color} depth={0} />
      </div>
    )
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflow: 'auto' }}>
      {stats.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 7 }}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-surface)',
                padding: '8px 9px',
                minWidth: 0
              }}
            >
              <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 750, textTransform: 'uppercase' }}>{stat.label}</div>
              <div className="truncate" style={{ color: stat.tone ?? 'var(--color-text)', fontSize: 15, fontWeight: 750, marginTop: 2 }} title={stat.value}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-surface)',
                padding: 9,
                minWidth: 0
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.tone ?? color, marginTop: 5, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="truncate" style={{ color: 'var(--color-text)', fontSize: 12, fontWeight: 750 }} title={item.title}>
                  {item.title}
                </div>
                {item.subtitle && (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 11, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                    {item.subtitle}
                  </div>
                )}
              </div>
              {item.meta && (
                <span
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                  style={{
                    color: item.tone ?? color,
                    background: 'var(--color-surface2)',
                    border: '1px solid var(--color-border)'
                  }}
                >
                  {item.meta}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyInlineValue />
      )}
    </div>
  )
}

function appServerSummaryStats(surfaceId: string, value: unknown): Array<{ label: string; value: string; tone?: string }> {
  const data = appServerDataArray(value)
  const record = objectValue(value)
  if (surfaceId === 'appserver-rate-limits') {
    const limits = objectValue(record?.rateLimits ?? value)
    return Object.entries(limits ?? {}).slice(0, 4).map(([key, entry]) => ({
      label: formatObjectKey(key),
      value: compactScalar(entry),
      tone: key.toLowerCase().includes('remaining') ? 'var(--color-green)' : undefined
    }))
  }
  if (surfaceId === 'appserver-account') {
    return [
      { label: 'Plan', value: compactScalar(record?.planType ?? record?.plan ?? record?.tier ?? 'Unknown') },
      { label: 'Auth', value: compactScalar(record?.authMode ?? record?.mode ?? 'Codex') }
    ]
  }
  if (surfaceId === 'appserver-config-requirements') {
    const requirements = objectValue(record?.requirements)
    return [
      { label: 'Approval modes', value: String(arrayValue(requirements?.allowedApprovalPolicies).length || 'Any') },
      { label: 'Sandbox modes', value: String(arrayValue(requirements?.allowedSandboxModes).length || 'Any') }
    ]
  }
  if (data.length > 0) return [{ label: 'Items', value: data.length.toLocaleString() }]
  return []
}

function appServerSummaryItems(surfaceId: string, value: unknown, color: string): SummaryItem[] {
  const data = appServerDataArray(value)
  const record = objectValue(value)
  const source = data.length > 0 ? data : arrayValue(record?.plugins ?? record?.apps ?? record?.skills ?? record?.hooks ?? record?.servers ?? record?.threads)

  if (surfaceId === 'appserver-config') {
    return Object.entries(objectValue(record?.config ?? record) ?? {}).slice(0, 12).map(([key, entry]) => ({
      id: key,
      title: formatObjectKey(key),
      subtitle: compactScalar(entry),
      tone: color
    }))
  }

  if (surfaceId === 'appserver-model-provider-capabilities') {
    return Object.entries(objectValue(record?.capabilities ?? record) ?? {}).slice(0, 12).map(([key, entry]) => ({
      id: key,
      title: formatObjectKey(key),
      subtitle: compactScalar(entry),
      tone: color
    }))
  }

  if (surfaceId === 'appserver-auth-status') {
    return [{
      id: 'auth',
      title: compactScalar(record?.status ?? record?.authStatus ?? 'Auth status'),
      subtitle: compactScalar(record?.message ?? record?.accountEmail ?? record?.loginMode ?? value),
      tone: /error|fail/i.test(compactScalar(record?.status)) ? '#EF4444' : 'var(--color-green)'
    }]
  }

  return source.slice(0, 24).map((entry, index) => {
    const item = objectValue(entry)
    const title = compactScalar(
      item?.name ??
      item?.title ??
      item?.id ??
      item?.model ??
      item?.server ??
      item?.threadId ??
      item?.path ??
      `Item ${index + 1}`
    )
    const subtitle = compactScalar(
      item?.description ??
      item?.summary ??
      item?.provider ??
      item?.cwd ??
      item?.status ??
      item?.source ??
      item?.command ??
      item?.availabilityNux ??
      entry
    )
    const meta = compactScalar(item?.status ?? item?.state ?? item?.availability ?? item?.kind)
    const isBad = /error|failed|disabled|unavailable/i.test(meta)
    const isGood = /ready|ok|enabled|available|active|installed/i.test(meta)
    return {
      id: compactScalar(item?.id ?? item?.model ?? item?.name ?? index),
      title,
      subtitle: subtitle !== title ? subtitle : undefined,
      meta: meta && meta !== title ? meta : undefined,
      tone: isBad ? '#EF4444' : isGood ? 'var(--color-green)' : color
    }
  })
}

function appServerDataArray(value: unknown): unknown[] {
  const record = objectValue(value)
  return arrayValue(record?.data ?? record?.items ?? record?.results ?? value)
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function compactScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim() || 'Not set'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? 'None' : `${value.length} item${value.length === 1 ? '' : 's'}`
  const record = objectValue(value)
  if (!record) return String(value)
  const preferred = record.message ?? record.label ?? record.name ?? record.id ?? record.status
  if (preferred !== undefined) return compactScalar(preferred)
  const json = JSON.stringify(value)
  return json.length > 140 ? `${json.slice(0, 137)}...` : json
}

type ParsedCommandOutput =
  | { kind: 'json'; value: unknown }
  | { kind: 'lines'; lines: string[] }

function parseCommandOutput(output: string): ParsedCommandOutput {
  const trimmed = output.trim()
  if (!trimmed) return { kind: 'lines', lines: ['No output'] }
  try {
    return { kind: 'json', value: JSON.parse(trimmed) }
  } catch {
    const lines = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return { kind: 'lines', lines: lines.length > 0 ? lines : ['No output'] }
  }
}

function StructuredValue({
  value,
  color,
  depth
}: {
  value: unknown
  color: string
  depth: number
}): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) return <EmptyInlineValue />
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {value.map((item, index) => (
          <div
            key={index}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 7,
              background: 'var(--color-surface)',
              padding: 8,
            }}
          >
            <StructuredValue value={item} color={color} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <EmptyInlineValue />
    return (
      <div style={{ display: 'grid', gridTemplateColumns: depth > 1 ? '1fr' : 'minmax(90px, 150px) minmax(0, 1fr)', gap: 6 }}>
        {entries.map(([key, entryValue]) => (
          <ObjectRow key={key} label={formatObjectKey(key)} value={entryValue} rawKey={key} color={color} depth={depth} />
        ))}
      </div>
    )
  }

  return <ScalarValue value={value} rawKey="" color={color} />
}

function ObjectRow({
  label,
  value,
  rawKey,
  color,
  depth
}: {
  label: string
  value: unknown
  rawKey: string
  color: string
  depth: number
}): JSX.Element {
  const complex = value !== null && typeof value === 'object'
  if (depth > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 750, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>{label}</span>
        <StructuredValue value={value} color={color} depth={depth + 1} />
      </div>
    )
  }

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', paddingTop: complex ? 4 : 7 }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>
        {complex
          ? <StructuredValue value={value} color={color} depth={depth + 1} />
          : <ScalarValue value={value} rawKey={rawKey} color={color} />}
      </div>
    </>
  )
}

function ScalarValue({ value, rawKey, color }: { value: unknown; rawKey: string; color: string }): JSX.Element {
  const sensitive = /key|token|secret|password/i.test(rawKey)
  const text = sensitive
    ? '[redacted]'
    : value === null || value === undefined
      ? 'Not set'
      : typeof value === 'boolean'
        ? value ? 'Yes' : 'No'
        : String(value)

  return (
    <span
      style={{
        display: 'inline-flex',
        maxWidth: '100%',
        padding: '5px 8px',
        borderRadius: 7,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: typeof value === 'boolean' && value ? color : 'var(--color-text)',
        fontSize: 11,
        fontWeight: typeof value === 'boolean' ? 700 : 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={text}
    >
      {text}
    </span>
  )
}

function EmptyInlineValue(): JSX.Element {
  return <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>None</span>
}

function formatObjectKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function InlineMutedText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '7px 0' }}>
      {children}
    </div>
  )
}

function SegmentedControl({
  items,
  value,
  color: _color,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  value: string
  color: string
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <SystemSegmentedControl
      value={value}
      onChange={onChange}
      options={items.map((item) => ({ value: item.id, label: item.label }))}
      className="settings-segmented-control"
    />
  )
}

function configPathForProvider(providerId: string, home: string): string {
  const paths: Record<string, string> = {
    claude: `${home}/.claude/settings.json`,
    cursor: `${home}/.cursor/cli-config.json`,
    codex: `${home}/.codex/config.toml`,
    copilot: `${home}/.config/github-copilot/config.json`,
  }
  return paths[providerId] ?? `${home}/.${providerId}/config.json`
}

function redactConfigSecrets(raw: string): { content: string; redacted: boolean } {
  let redacted = false
  const secretKey = /(?:api[_-]?key|token|pat|password|passwd|secret|credential|authorization)/i
  const assignment = /^(\s*["']?[^"'\s:=]+["']?\s*[:=]\s*)(.*?)(\s*,?\s*)$/
  const content = raw.split('\n').map((line) => {
    const match = line.match(assignment)
    if (!match || !secretKey.test(match[1])) return line
    redacted = true
    return `${match[1]}"[redacted]"${match[3]}`
  }).join('\n')
  return { content, redacted }
}

function ProviderConfigEditor({ providerId, color }: { providerId: string; color: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [hasRedactions, setHasRedactions] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      const nextPath = configPathForProvider(providerId, home)
      const file = await window.api.fs.readFile(nextPath)
      const redacted = redactConfigSecrets(file ?? '')
      setPath(nextPath)
      setContent(redacted.content)
      setHasRedactions(redacted.redacted)
      setDirty(false)
      setSaved(false)
      setError('')
    }
    void load()
  }, [providerId])

  const save = async (): Promise<void> => {
    if (!path || saving) return
    if (hasRedactions) {
      setError('Secret values are redacted; edit this file outside Orchestrator.')
      return
    }
    const trimmed = content.trim()
    if (path.endsWith('.json') && trimmed) {
      try {
        JSON.parse(trimmed)
      } catch {
        setError('Invalid JSON')
        return
      }
    }
    setSaving(true)
    setError('')
    await window.api.fs.writeFile(path, content)
    setSaving(false)
    setDirty(false)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div data-testid="provider-config-editor" data-expanded={open ? 'true' : 'false'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <span
          style={{
            minWidth: 0,
            fontSize: 10.5,
            fontFamily: 'monospace',
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {path || 'Loading...'}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          style={{
            flexShrink: 0,
            padding: '5px 9px',
            borderRadius: 7,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface2)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 650,
          }}
        >
          {open ? 'Hide' : 'Edit config'}
        </button>
      </div>
      {open && (
        <>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setDirty(true)
              setSaved(false)
              setError('')
            }}
            spellCheck={false}
            placeholder={providerId === 'cursor' ? '{\n  "network": {\n    "useHttp1ForAgent": true\n  }\n}' : ''}
            style={{
              width: '100%',
              minHeight: 84,
              maxHeight: 180,
              resize: 'vertical',
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${error ? '#F87171' : dirty ? color : 'var(--color-border)'}`,
              background: 'var(--color-surface2)',
              color: 'var(--color-text)',
              outline: 'none',
              fontSize: 11,
              lineHeight: '16px',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, color: error ? '#F87171' : 'var(--color-text-muted)' }}>
              {error || (hasRedactions ? 'Secrets redacted; edit locally to change this file.' : saved ? 'Saved' : 'Local file override')}
            </div>
            <button
              onClick={save}
              disabled={!dirty || saving || hasRedactions}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                border: `1px solid ${dirty && !hasRedactions ? color : 'var(--color-border)'}`,
                background: dirty && !hasRedactions ? color : 'var(--color-surface2)',
                color: dirty && !hasRedactions ? '#fff' : 'var(--color-text-muted)',
                cursor: dirty && !hasRedactions ? 'pointer' : 'default',
                fontSize: 11,
                fontWeight: 650,
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
      {!open && (
        <div
          style={{
            fontSize: 11,
            color: error ? '#F87171' : 'var(--color-text-muted)',
          }}
        >
          {error || (hasRedactions ? 'Secrets redacted.' : saved ? 'Saved' : 'Local file override')}
        </div>
      )}
    </div>
  )
}

// ─── Default model picker ─────────────────────────────────────────────────────

function DefaultModelPicker({
  providerDef, models, currentModel, onSetModel
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  models: typeof PROVIDER_DEFS[string]['models']
  currentModel: string
  onSetModel: (id: string) => void
}): JSX.Element {
  const isPreset = models.some((m) => m.id === currentModel)
  const [customInput, setCustomInput] = useState(isPreset ? '' : currentModel)

  useEffect(() => {
    setCustomInput(models.some((m) => m.id === currentModel) ? '' : currentModel)
  }, [providerDef.id, currentModel, models])

  const applyCustom = (): void => {
    const trimmed = customInput.trim()
    if (trimmed) onSetModel(trimmed)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {models.map((m) => {
          const active = currentModel === m.id
          return (
            <button
              key={m.id}
              onClick={() => { onSetModel(m.id); setCustomInput('') }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 8,
                background: active ? 'var(--color-surface2)' : 'var(--color-surface)',
                border: `1px solid ${active ? providerDef.color : 'var(--color-border)'}`,
                color: active ? providerDef.color : 'var(--color-text)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 600 : 500
              }}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {/* Custom model ID */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8,
          background: !isPreset && currentModel ? 'var(--color-surface2)' : 'var(--color-surface)',
          border: `1px solid ${!isPreset && currentModel ? providerDef.color : 'var(--color-border)'}`
        }}
      >
        <input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onBlur={applyCustom}
          onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
          placeholder="Custom model ID…"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 11, fontFamily: 'monospace',
            color: customInput ? 'var(--color-text)' : 'var(--color-text-muted)'
          }}
        />
        {!isPreset && currentModel && (
          <svg width="12" height="12" viewBox="0 0 16 16" fill={providerDef.color}>
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
          </svg>
        )}
      </div>
    </div>
  )
}

function ProviderDiagnosticsCard({
  diagnostics,
  color
}: {
  diagnostics: ProviderDiagnosticInfo
  color: string
}): JSX.Element {
  const rows = [
    {
      label: 'Binary',
      status: diagnostics.binary.status,
      message: diagnostics.binary.path ?? 'Not found'
    },
    {
      label: 'Version',
      status: diagnostics.version.status,
      message: diagnostics.version.value ?? diagnostics.version.message ?? 'Unknown'
    },
    {
      label: 'Auth',
      status: diagnostics.auth.status,
      message: diagnostics.auth.message
    },
    {
      label: 'Models',
      status: diagnostics.models.status,
      message: diagnostics.models.message
    },
    {
      label: 'Usage',
      status: diagnostics.usage.status,
      message: diagnostics.usage.message
    },
    {
      label: 'Live smoke',
      status: diagnostics.liveSmoke.status,
      message: diagnostics.liveSmoke.message
    }
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{row.label}</div>
          <DiagnosticPill status={row.status} color={color} />
        </div>
      ))}
    </div>
  )
}

interface ProviderUsageSnapshot {
  sessionCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  totalCostUsd: number
  durationMs: number
  apiDurationMs: number
  turns: number
  models: string[]
}

function summarizeProviderUsage(sessions: SessionListItem[], providerId: string): ProviderUsageSnapshot {
  const snapshot: ProviderUsageSnapshot = {
    sessionCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    apiDurationMs: 0,
    turns: 0,
    models: []
  }
  const models = new Set<string>()

  for (const session of sessions) {
    if (session.provider !== providerId || !session.usageSummary) continue
    const usage = session.usageSummary
    snapshot.sessionCount += 1
    snapshot.inputTokens += usage.inputTokens ?? 0
    snapshot.outputTokens += usage.outputTokens ?? 0
    snapshot.cacheTokens += (usage.cacheCreationInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0)
    snapshot.totalTokens += usage.totalTokens ?? sumTokens(usage)
    snapshot.totalCostUsd += usage.totalCostUsd ?? sumModelCost(usage)
    snapshot.durationMs += usage.durationMs ?? 0
    snapshot.apiDurationMs += usage.apiDurationMs ?? 0
    snapshot.turns += usage.turns ?? 0
    for (const model of Object.keys(usage.modelUsage ?? {})) models.add(model)
  }

  snapshot.models = [...models].sort()
  return snapshot
}

function sumTokens(usage: UsageSummary): number {
  return (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0)
}

function sumModelCost(usage: UsageSummary): number {
  return Object.values(usage.modelUsage ?? {}).reduce((total, model) => total + (model.costUSD ?? 0), 0)
}

function ProviderUsageDiagnosticsCard({
  providerId,
  diagnostics,
  usage,
  color
}: {
  providerId: string
  diagnostics?: ProviderDiagnosticInfo
  usage: ProviderUsageSnapshot
  color: string
}): JSX.Element {
  const budget = providerBudgetSupport(providerId)
  const hasUsage = usage.sessionCount > 0
  const rows = [
    {
      label: 'Runs',
      status: hasUsage ? 'available' : 'unknown',
      message: hasUsage ? `${usage.sessionCount.toLocaleString()} sessions with usage metadata` : 'No usage-emitting runs recorded in this local profile yet.'
    },
    {
      label: 'Tokens',
      status: usage.totalTokens > 0 ? 'available' : 'unknown',
      message: usage.totalTokens > 0
        ? `${usage.totalTokens.toLocaleString()} total · ${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out`
        : 'No token totals captured yet.'
    },
    {
      label: 'Cost',
      status: usage.totalCostUsd > 0 ? 'available' : 'unknown',
      message: usage.totalCostUsd > 0 ? formatUsd(usage.totalCostUsd) : 'No provider cost metadata captured yet.'
    },
    {
      label: 'Time',
      status: usage.durationMs > 0 || usage.apiDurationMs > 0 ? 'available' : 'unknown',
      message: usage.durationMs > 0 || usage.apiDurationMs > 0
        ? `${formatMilliseconds(usage.durationMs)} total${usage.apiDurationMs > 0 ? ` · ${formatMilliseconds(usage.apiDurationMs)} API` : ''}`
        : 'No duration metadata captured yet.'
    },
    {
      label: 'Quota',
      status: diagnostics?.usage.status ?? 'unknown',
      message: diagnostics?.usage.message ?? 'Load provider diagnostics to check whether safe quota probes are available.'
    },
    {
      label: 'Budget',
      status: budget.status,
      message: budget.message
    }
  ]

  return (
    <div data-testid="provider-usage-diagnostics-card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              minWidth: 0,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)'
            }}
          >
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-text)'
              }}
            >
              {row.label}
            </div>
            <DiagnosticPill status={row.status} color={color} />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          fontSize: 11,
          color: 'var(--color-text-muted)'
        }}
      >
        <span>{usage.models.length > 0 ? `Models: ${usage.models.join(', ')}` : 'No models'}</span>
        <span>{usage.cacheTokens > 0 ? `Cache: ${usage.cacheTokens.toLocaleString()} tokens` : 'No cache'}</span>
        <span>{usage.turns > 0 ? `Turns: ${usage.turns.toLocaleString()}` : 'No turns'}</span>
      </div>
    </div>
  )
}

function providerBudgetSupport(providerId: string): { status: string; message: string } {
  if (providerId === 'claude') {
    return {
      status: 'available',
      message: 'Claude runs can use max-budget launch limits; fallback policy is still a future advanced launch setting.'
    }
  }
  if (providerId === 'codex') {
    return {
      status: 'unknown',
      message: 'Codex app-server token usage can be captured, but local budget/fallback controls are not promoted yet.'
    }
  }
  return {
    status: 'unknown',
    message: 'Budget and fallback controls are not exposed for this provider in Orchestrator yet.'
  }
}

function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatMilliseconds(ms: number): string {
  if (ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

function ProviderProbeGrid({
  diagnostics,
  color
}: {
  diagnostics: ProviderDiagnosticInfo
  color: string
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {diagnostics.probes.map((probe) => (
        <div
          key={probe.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <div
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text)'
            }}
          >
            {probe.label}
          </div>
          <DiagnosticPill status={probe.status} color={color} />
        </div>
      ))}
    </div>
  )
}

// ─── Model list manager ────────────────────────────────────────────────────────

function ModelListManager({
  providerDef, visibleIds, onChange
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  visibleIds: string[]
  onChange: (ids: string[]) => void
}): JSX.Element {
  const [customInput, setCustomInput] = useState('')
  const [editing, setEditing] = useState(visibleIds.length === 0)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIdx = visibleIds.indexOf(active.id as string)
      const newIdx = visibleIds.indexOf(over.id as string)
      onChange(arrayMove(visibleIds, oldIdx, newIdx))
    }
  }

  const remove = (id: string): void => {
    onChange(visibleIds.filter((x) => x !== id))
  }

  const addCatalog = (id: string): void => {
    if (!visibleIds.includes(id)) onChange([...visibleIds, id])
    else remove(id)
  }

  const addCustom = (): void => {
    const id = customInput.trim()
    if (id && !visibleIds.includes(id)) {
      onChange([...visibleIds, id])
      setCustomInput('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Sortable list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visibleIds.map((id) => {
              const meta = providerDef.models.find((m) => m.id === id)
              return (
                <SortableModelRow
                  key={id}
                  id={id}
                  label={meta?.label ?? id}
                  modelId={id}
                  onRemove={() => remove(id)}
                />
              )
            })}
            {visibleIds.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 0' }}>
                No models selected — showing first 5 from catalog by default.
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      <button
        onClick={() => setEditing((open) => !open)}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface2)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600
        }}
      >
        {editing ? 'Done' : 'Edit model list'}
      </button>

      {/* Catalog toggle chips */}
      {editing && providerDef.models.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 650, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
            Catalog
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {providerDef.models.map((m) => {
              const included = visibleIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => addCatalog(m.id)}
                  style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 11,
                    background: included ? `${providerDef.color}10` : 'var(--color-surface)',
                    border: `1px solid ${included ? providerDef.color : 'var(--color-border)'}`,
                    color: included ? providerDef.color : 'var(--color-text)',
                    cursor: 'pointer'
                  }}
                >
                  {included ? '✓ ' : ''}{m.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Custom model ID input */}
      {editing && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
            placeholder="Custom model ID"
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
              background: 'var(--color-surface2)', border: '1px solid var(--color-border)',
              color: 'var(--color-text)', outline: 'none'
            }}
          />
          <button
            onClick={addCustom}
            disabled={!customInput.trim()}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: customInput.trim() ? 'var(--color-accent)' : 'var(--color-surface2)',
              border: `1px solid ${customInput.trim() ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: customInput.trim() ? '#fff' : 'var(--color-text-muted)',
              cursor: customInput.trim() ? 'pointer' : 'default'
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Sortable model row ────────────────────────────────────────────────────────

function SortableModelRow({ id, label, modelId, onRemove }: {
  id: string; label: string; modelId: string; onRemove: () => void
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: 8,
        minHeight: 30,
        padding: '4px 9px', borderRadius: 7,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)'
      }}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1, userSelect: 'none' }}
      >
        ⠿
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{label}</span>
      <span style={{ minWidth: 0, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>{modelId}</span>
      <button
        onClick={onRemove}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px'
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#F87171')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
      >
        ×
      </button>
    </div>
  )
}

// ─── Claude endpoint field ────────────────────────────────────────────────────

function ClaudeEndpointField({ color }: { color: string }): JSX.Element {
  const [endpoint, setEndpoint] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const pathRef = useRef('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      pathRef.current = `${home}/.claude/settings.json`
      const content = await window.api.fs.readFile(pathRef.current)
      if (content) {
        try {
          const parsed = JSON.parse(content)
          setEndpoint(parsed.env?.ANTHROPIC_BASE_URL ?? '')
        } catch { /* leave empty */ }
      }
    }
    load()
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    const content = await window.api.fs.readFile(pathRef.current)
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(content ?? '{}') } catch { /* start fresh */ }
    const env = { ...(parsed.env as Record<string, string> ?? {}) }
    if (endpoint.trim()) env.ANTHROPIC_BASE_URL = endpoint.trim()
    else delete env.ANTHROPIC_BASE_URL
    parsed.env = env
    await window.api.fs.writeFile(pathRef.current, JSON.stringify(parsed, null, 2))
    setSaving(false)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={endpoint}
          onChange={(e) => { setEndpoint(e.target.value); setDirty(true); setSaved(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          placeholder="https://api.anthropic.com (default)"
          style={{
            flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
            background: 'var(--color-surface2)',
            border: `1px solid ${dirty ? color : 'var(--color-border)'}`,
            color: 'var(--color-text)', outline: 'none'
          }}
        />
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            flexShrink: 0, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
            cursor: dirty ? 'pointer' : 'default',
            background: saved ? 'var(--color-green)' : dirty ? color : 'var(--color-surface2)',
            border: `1px solid ${dirty ? color : 'var(--color-border)'}`,
            color: dirty || saved ? '#fff' : 'var(--color-text-muted)'
          }}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Pets section ─────────────────────────────────────────────────────────────

interface PetEntry {
  id: string
  displayName: string
  description: string
  spritesheetDataUrl: string
}

const DEFAULT_PET_ID = 'orchestrator'

function PetsSection(): JSX.Element {
  const [pets, setPets] = useState<PetEntry[]>([])
  const [selectedPetId, setSelectedPetId] = useState(DEFAULT_PET_ID)
  const [isOpen, setIsOpen] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importingCodex, setImportingCodex] = useState(false)

  useEffect(() => {
    window.api.pet.getConfig().then((cfg) => {
      const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
      setPets(c.pets ?? [])
      setSelectedPetId(c.selectedPetId ?? DEFAULT_PET_ID)
      setIsOpen(c.isOpen ?? true)
    })
  }, [])

  const handleSelect = (id: string): void => {
    setSelectedPetId(id)
    window.api.pet.selectPet(id)
  }

  const handleToggleOpen = (): void => {
    const next = !isOpen
    setIsOpen(next)
    window.api.pet.setOpen(next)
  }

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await window.api.pet.importPet()
      if (result) {
        const cfg = await window.api.pet.getConfig()
        const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
        setPets(c.pets ?? [])
      }
    } finally {
      setImporting(false)
    }
  }

  const handleImportCodexPets = async (): Promise<void> => {
    setImportingCodex(true)
    try {
      await window.api.pet.importCodexPets()
      const cfg = await window.api.pet.getConfig()
      const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
      setPets(c.pets ?? [])
    } finally {
      setImportingCodex(false)
    }
  }

  return (
    <div style={{ padding: '30px 44px 56px', maxWidth: 1080, margin: '0 auto' }}>
      <SettingsIntro
        description="Choose the overlay companion and import local or Codex-compatible pet bundles."
      />

      {/* Toggle */}
      <SettingGroup title="Pet overlay" description="Floating companion that shows session activity above all windows.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            aria-pressed={isOpen}
            onClick={handleToggleOpen}
            style={{
              width: 40, height: 22, borderRadius: 11, cursor: 'pointer', position: 'relative',
              background: isOpen ? 'var(--color-accent)' : 'var(--control-bg)',
              border: `1px solid ${isOpen ? 'var(--color-accent)' : 'var(--border-subtle)'}`,
              transition: 'background 0.15s',
              flexShrink: 0,
              padding: 0
            }}
          >
            <div style={{
              position: 'absolute', top: 2, left: isOpen ? 20 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </button>
          <span style={{ fontSize: 12, color: isOpen ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
            {isOpen ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </SettingGroup>

      {/* Pet picker */}
      <SettingGroup title="Choose your pet" description="Select which companion appears in the overlay.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 12 }}>
          {pets.map((pet) => {
            const active = pet.id === selectedPetId
            return (
              <button
                type="button"
                key={pet.id}
                onClick={() => handleSelect(pet.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '12px 14px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                  minHeight: 164,
                  background: active ? 'var(--control-bg-active)' : 'var(--surface-bg)',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--border-subtle)'}`,
                  boxShadow: active ? 'var(--shadow-card)' : 'none',
                  textAlign: 'center'
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--control-bg-hover)' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-bg)' }}
              >
                {/* Idle frame thumbnail */}
                <div
                  style={{
                    width: 96,
                    height: 104,
                    backgroundImage: `url(${pet.spritesheetDataUrl})`,
                    backgroundSize: '800% 900%',
                    backgroundPosition: '0% 0%',
                    backgroundRepeat: 'no-repeat',
                    imageRendering: 'pixelated',
                    flexShrink: 0
                  }}
                />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
                    {pet.displayName}
                  </div>
                  {active && (
                    <div style={{ fontSize: 10, color: 'var(--color-accent)', marginTop: 2 }}>Selected</div>
                  )}
                </div>
              </button>
            )
          })}
          {pets.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: 14,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--surface-bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: 12
              }}
            >
              No pets are available yet.
            </div>
          )}
        </div>
      </SettingGroup>

      {/* Import */}
      <SettingGroup title="Import pets" description="Add pets from a local bundle or copy presets and custom pets from Codex.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            onClick={handleImportCodexPets}
            disabled={importingCodex}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'var(--control-bg)', border: '1px solid var(--border-subtle)',
              color: importingCodex ? 'var(--color-text-muted)' : 'var(--color-text)',
            }}
          >
            {importingCodex ? 'Importing…' : 'Import from Codex'}
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'var(--control-bg)', border: '1px solid var(--border-subtle)',
              color: importing ? 'var(--color-text-muted)' : 'var(--color-text)',
            }}
          >
            {importing ? 'Importing…' : 'Import from .zip'}
          </button>
        </div>
      </SettingGroup>
    </div>
  )
}

function InstallCommand({ cmd }: { cmd: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const handleCopy = (): void => {
    navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 10px', borderRadius: 8,
        background: 'var(--color-surface2)', border: '1px solid var(--color-border)'
      }}
    >
      <span style={{
        flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)',
        userSelect: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      }}>
        {cmd}
      </span>
      <button
        onClick={handleCopy}
        style={{
          flexShrink: 0, padding: '2px 8px', borderRadius: 4, fontSize: 11,
          background: copied ? 'var(--color-green)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: copied ? '#fff' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 500
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
