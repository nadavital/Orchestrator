import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type ProviderPermissionRuntimeContext,
  type ProviderDiagnosticInfo,
  type ProviderRuntimeInfo,
  type PreferredOpenTarget,
} from '../types'
import {
  normalizeSettingsHostId,
  normalizeSettingsSectionForHostKind,
  settingsHostAdapterState,
  settingsHostOptionsFromSessions,
  settingsSectionScope
} from '../../../types'
import { useSessionStore } from '../store/sessions'
import type { SettingsSection } from '../store/sessions'
import type { ShortcutOverrides } from '../../../types/appCommands'
import { parsePortableTheme } from '../../../types/themeSharing'
import Icon from './shared/Icon'
import AppearanceSettingsPage, { defaultDarkChromeTheme, defaultLightChromeTheme, type AppearancePreset } from './Settings/AppearanceSettingsPage'
import AutomationsSettingsPage from './Settings/AutomationsSettingsPage'
import DataControlsSettingsPage from './Settings/DataControlsSettingsPage'
import GeneralSettingsPage from './Settings/GeneralSettingsPage'
import PetsSettingsPage from './Settings/PetsSettingsPage'
import ProvidersSettingsPage from './Settings/ProvidersSettingsPage'
import ShortcutsSettingsPage from './Settings/ShortcutsSettingsPage'
import WorktreesSettingsPage from './Settings/WorktreesSettingsPage'
import {
  PanelToolbar,
  SettingsContentGroup,
  SettingsGroupContent,
  SettingsIntro,
  SettingsPageSection,
  SettingsSurface,
  Tooltip
} from './shared/designSystem'
import { applyAppearance, type Accent, type Appearance, type AppearanceTheme, type ChromeTheme, type Density, type TranscriptStyle } from '../theme'

type PreferredEditor = PreferredOpenTarget

interface Props {
  section: SettingsSection
  onClose: () => void
}

export default function SettingsPage({ section, onClose }: Props): JSX.Element {
  const { providerAvailability, sessions, setProviderModels: storeSetProviderModels } = useSessionStore()
  const selectedSettingsHostId = useSessionStore((state) => state.settingsHostId)
  const setSelectedSettingsHostId = useSessionStore((state) => state.setSettingsHostId)
  const setSettingsSection = useSessionStore((state) => state.setSettingsSection)
  const [defaultProvider, setDefaultProvider] = useState('claude')
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [defaultEfforts, setDefaultEfforts] = useState<Record<string, string>>({})
  const [defaultPermissionModes, setDefaultPermissionModes] = useState<Record<string, string>>({})
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [providerRuntime, setProviderRuntime] = useState<Record<string, ProviderRuntimeInfo>>({})
  const [providerPermissionContexts, setProviderPermissionContexts] = useState<Record<string, ProviderPermissionRuntimeContext>>({})
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
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>({})
  const settingsHostOptions = useMemo(() => settingsHostOptionsFromSessions(sessions), [sessions])
  const normalizedSettingsHostId = normalizeSettingsHostId(selectedSettingsHostId, settingsHostOptions)
  const selectedSettingsHost = settingsHostOptions.find((host) => host.id === normalizedSettingsHostId) ?? settingsHostOptions[0]
  const effectiveSection = normalizeSettingsSectionForHostKind(section, selectedSettingsHost.kind)
  const contentScope = settingsSectionScope(effectiveSection)
  const hostAdapterState = settingsHostAdapterState(effectiveSection, selectedSettingsHost.kind)

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
      setShortcutOverrides((rec.shortcutOverrides as ShortcutOverrides | undefined) ?? {})
      const currentSettingsHostId = useSessionStore.getState().settingsHostId
      setSelectedSettingsHostId(currentSettingsHostId !== 'local'
        ? currentSettingsHostId
        : (rec.settingsHostId as string | undefined) ?? 'local')
    })
    window.api.providers.getRuntimeInfo().then(setProviderRuntime)
  }, [])

  useEffect(() => {
    const normalized = normalizeSettingsHostId(selectedSettingsHostId, settingsHostOptions)
    if (normalized === selectedSettingsHostId) return
    setSelectedSettingsHostId(normalized)
    window.api.settings.set('settingsHostId', normalized)
  }, [selectedSettingsHostId, settingsHostOptions])

  useEffect(() => {
    if (effectiveSection === section) return
    setSettingsSection(effectiveSection)
  }, [effectiveSection, section, setSettingsSection])

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

  const saveShortcutOverrides = (next: ShortcutOverrides): void => {
    setShortcutOverrides(next)
    window.api.settings.set('shortcutOverrides', next)
    window.dispatchEvent(new CustomEvent('orchestrator:shortcut-overrides-changed', { detail: next }))
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

  const saveAppearance = (value: Appearance, preset?: AppearancePreset): void => {
    const nextAppearanceTheme = preset?.mode ?? appearanceTheme
    const nextLightChromeTheme = preset?.lightChromeTheme ?? lightChromeTheme
    const nextDarkChromeTheme = preset?.darkChromeTheme ?? darkChromeTheme
    const nextLightCodeThemeId = preset?.lightCodeThemeId ?? lightCodeThemeId
    const nextDarkCodeThemeId = preset?.darkCodeThemeId ?? darkCodeThemeId
    setAppearance(value)
    if (preset) {
      setAppearanceTheme(nextAppearanceTheme)
      setLightChromeTheme(nextLightChromeTheme)
      setDarkChromeTheme(nextDarkChromeTheme)
      setLightCodeThemeId(nextLightCodeThemeId)
      setDarkCodeThemeId(nextDarkCodeThemeId)
    }
    applyAppearance(value, accent, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont, {
      appearanceTheme: nextAppearanceTheme,
      appearanceLightChromeTheme: nextLightChromeTheme,
      appearanceDarkChromeTheme: nextDarkChromeTheme,
      appearanceLightCodeThemeId: nextLightCodeThemeId,
      appearanceDarkCodeThemeId: nextDarkCodeThemeId,
      sansFontSize,
      codeFontSize,
      useFontSmoothing,
      usePointerCursors,
      reduceMotion
    })
    window.api.settings.set('appearance', value)
    if (preset) {
      window.api.settings.set('appearanceTheme', nextAppearanceTheme)
      window.api.settings.set('appearanceLightChromeTheme', nextLightChromeTheme)
      window.api.settings.set('appearanceDarkChromeTheme', nextDarkChromeTheme)
      window.api.settings.set('appearanceLightCodeThemeId', nextLightCodeThemeId)
      window.api.settings.set('appearanceDarkCodeThemeId', nextDarkCodeThemeId)
    }
  }

  const saveAccent = (value: Accent): void => {
    setAccent(value)
    applyAppearance(appearance, value, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont, buildAppearanceModel())
    window.api.settings.set('accent', value)
  }

  const saveDensity = (value: Density): void => {
    setDensity(value)
    applyAppearance(appearance, accent, value, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont, buildAppearanceModel())
    window.api.settings.set('density', value)
  }

  const saveSidebarTint = (value: boolean): void => {
    setSidebarTint(value)
    applyAppearance(appearance, accent, density, value, transcriptStyle, customAccent, interfaceScale, uiFont, monoFont, buildAppearanceModel())
    window.api.settings.set('sidebarTint', value)
  }

  const saveTranscriptStyle = (value: TranscriptStyle): void => {
    setTranscriptStyle(value)
    applyAppearance(appearance, accent, density, sidebarTint, value, customAccent, interfaceScale, uiFont, monoFont, buildAppearanceModel())
    window.api.settings.set('transcriptStyle', value)
  }

  const saveCustomAccent = (value: string): void => {
    setCustomAccent(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, value, interfaceScale, uiFont, monoFont, buildAppearanceModel())
    window.api.settings.set('customAccent', value)
  }

  const saveInterfaceScale = (value: number): void => {
    setInterfaceScale(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, customAccent, value, uiFont, monoFont, buildAppearanceModel())
    window.api.settings.set('interfaceScale', value)
  }

  const saveUiFont = (value: string): void => {
    setUiFont(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, value, monoFont, buildAppearanceModel())
    window.api.settings.set('uiFont', value)
  }

  const saveMonoFont = (value: string): void => {
    setMonoFont(value)
    applyAppearance(appearance, accent, density, sidebarTint, transcriptStyle, customAccent, interfaceScale, uiFont, value, buildAppearanceModel())
    window.api.settings.set('monoFont', value)
  }

  return (
    <div
      className="settings-shell"
      data-settings-host-id={selectedSettingsHost.id}
      data-settings-host-kind={selectedSettingsHost.kind}
      data-settings-active-section={effectiveSection}
      data-settings-requested-section={section}
      data-settings-host-section-filtered={effectiveSection === section ? 'false' : 'true'}
      data-settings-route={`/settings/${effectiveSection}`}
      data-settings-route-owned="true"
    >
      <PanelToolbar className="settings-topbar" dataTestId="settings-topbar">
        <span className="settings-topbar-title">{settingsTitle(effectiveSection)}</span>
        <div className="settings-topbar-actions">
          <Tooltip label="Back to chat">
            <button
              onClick={onClose}
              aria-label="Back to chat"
              data-tooltip-label="Back to chat"
              data-native-title-free="true"
              className="settings-back-button"
            >
              <Icon name="chat" size={14} />
              Chat
            </button>
          </Tooltip>
        </div>
      </PanelToolbar>
      <div className="settings-body">
        <div
          key={selectedSettingsHost.id}
          className="settings-scroll"
          data-settings-content-host-id={selectedSettingsHost.id}
          data-settings-content-host-kind={selectedSettingsHost.kind}
          data-settings-content-scope={contentScope}
          data-settings-host-adapter={hostAdapterState}
        >
          {hostAdapterState === 'unavailable' ? (
            <SettingsHostAdapterUnavailable
              section={effectiveSection}
              hostLabel={selectedSettingsHost.label}
            />
          ) : (
            <>
              {effectiveSection === 'general' && (
                <GeneralSettingsPage
                  preferredEditor={preferredEditor}
                  onSetPreferredEditor={savePreferredEditor}
                />
              )}
              {effectiveSection === 'appearance' && (
                <AppearanceSettingsPage
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
              {effectiveSection === 'pets' && <PetsSettingsPage />}
              {effectiveSection === 'automations' && <AutomationsSettingsPage sessions={sessions} />}
              {effectiveSection === 'worktrees' && <WorktreesSettingsPage onClose={onClose} />}
              {effectiveSection === 'shortcuts' && (
                <ShortcutsSettingsPage
                  shortcutOverrides={shortcutOverrides}
                  onSetShortcutOverrides={saveShortcutOverrides}
                />
              )}
              {effectiveSection === 'data' && <DataControlsSettingsPage />}
              {effectiveSection === 'providers' && (
                <ProvidersSettingsPage
                  defaultProvider={defaultProvider}
                  sessions={sessions}
                  defaultModels={defaultModels}
                  defaultEfforts={defaultEfforts}
                  defaultPermissionModes={defaultPermissionModes}
                  providerModels={providerModels}
                  providerRuntime={providerRuntime}
                  providerPermissionContexts={providerPermissionContexts}
                  providerDiagnostics={providerDiagnostics}
                  diagnosticsLoading={diagnosticsLoading}
                  providerAvailability={providerAvailability}
                  onSetDefaultProvider={saveDefaultProvider}
                  onSetDefaultModel={saveDefaultModel}
                  onSetDefaultEffort={saveDefaultEffort}
                  onSetDefaultPermissionMode={saveDefaultPermissionMode}
                  onSetProviderModels={saveProviderModels}
                  onSetProviderPermissionContexts={setProviderPermissionContexts}
                  onLoadProviderDiagnostics={loadProviderDiagnostics}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsHostAdapterUnavailable({
  section,
  hostLabel,
}: {
  section: SettingsSection
  hostLabel: string
}): JSX.Element {
  return (
    <div data-settings-page-module={`${section}-host-unavailable`}>
      <SettingsPageSection
        dataTestId="settings-host-adapter-unavailable"
        className="settings-host-adapter-unavailable"
      >
        <SettingsIntro
          description={settingsHostAdapterUnavailableDescription(section, hostLabel)}
        />
        <SettingsContentGroup>
          <SettingsGroupContent>
            <SettingsSurface>
              <div
                className="settings-host-adapter-message"
                data-testid="settings-host-adapter-message"
              >
                Use Local to edit app settings, or refresh provider metadata when a host adapter becomes available.
              </div>
            </SettingsSurface>
          </SettingsGroupContent>
        </SettingsContentGroup>
      </SettingsPageSection>
    </div>
  )
}

function settingsHostAdapterUnavailableDescription(section: SettingsSection, hostLabel: string): string {
  if (section === 'personalization') {
    return `Personalization settings for ${hostLabel} are host-scoped in Codex, including memory, personality, and custom instructions. Orchestrator needs a provider host adapter before they can be edited here.`
  }
  return `${settingsTitle(section)} settings for ${hostLabel} need a provider host adapter before they can be edited here.`
}

function settingsTitle(section: SettingsSection): string {
  if (section === 'appearance') return 'Appearance'
  if (section === 'providers') return 'Providers'
  if (section === 'automations') return 'Automations'
  if (section === 'worktrees') return 'Worktrees'
  if (section === 'shortcuts') return 'Shortcuts'
  if (section === 'personalization') return 'Personalization'
  if (section === 'pets') return 'Pet overlay'
  if (section === 'data') return 'Data controls'
  return 'General'
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
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
