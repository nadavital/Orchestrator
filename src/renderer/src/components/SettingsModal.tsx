import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  settingsNavigationGroupsForHostKind,
  settingsRouteUrlForLocation,
  settingsSectionScope
} from '../../../types'
import { useSessionStore } from '../store/sessions'
import type { SettingsSection } from '../store/sessions'
import type { ShortcutOverrides } from '../../../types/appCommands'
import { parsePortableTheme } from '../../../types/themeSharing'
import Icon from './shared/Icon'
import AppearanceSettingsPage, { defaultDarkChromeTheme, defaultLightChromeTheme, type AppearancePreset } from './Settings/AppearanceSettingsPage'
import BrowserSettingsPage from './Settings/BrowserSettingsPage'
import DataControlsSettingsPage from './Settings/DataControlsSettingsPage'
import GeneralSettingsPage from './Settings/GeneralSettingsPage'
import PetsSettingsPage from './Settings/PetsSettingsPage'
import PersonalizationSettingsPage from './Settings/PersonalizationSettingsPage'
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
  Tooltip,
  WorkbenchSearchField
} from './shared/designSystem'
import { applyAppearance, type Accent, type Appearance, type AppearanceTheme, type ChromeTheme, type Density, type TranscriptStyle } from '../theme'

type PreferredEditor = PreferredOpenTarget
type ComposerEnterBehavior = 'send' | 'newline'

const SETTINGS_SEARCH_ITEMS: Array<{
  section: SettingsSection
  label: string
  description: string
  keywords: string
  anchor?: string
}> = [
  { section: 'general', label: 'General', description: 'App-level defaults', keywords: 'defaults general app' },
  { section: 'general', label: 'File handoff', description: 'Preferred editor for file opens', keywords: 'files editor handoff open path target cursor vscode zed', anchor: 'general-files' },
  { section: 'general', label: 'Composer', description: 'Enter behavior and send shortcut', keywords: 'composer enter send newline message input command control', anchor: 'general-composer' },
  { section: 'appearance', label: 'Appearance', description: 'Theme, density, color, and fonts', keywords: 'theme accent density font motion chrome code sidebar transparency tint' },
  { section: 'providers', label: 'Provider picker', description: 'Default provider and runtime readiness', keywords: 'provider picker default provider runtime ready install claude codex openai cursor copilot', anchor: 'provider-picker' },
  { section: 'providers', label: 'Provider defaults', description: 'Default model, reasoning, permissions, and model list', keywords: 'models model reasoning thinking permission permissions mode default visible list provider agent', anchor: 'provider-defaults' },
  { section: 'providers', label: 'Providers', description: 'Default provider, models, permissions, and diagnostics', keywords: 'model agent permission diagnostics runtime codex claude openai' },
  { section: 'worktrees', label: 'Worktree create', description: 'Project, base ref, and branch controls', keywords: 'worktree worktrees create project base ref branch isolated workspace fork', anchor: 'worktrees-create' },
  { section: 'worktrees', label: 'Worktrees', description: 'Managed isolated workspaces', keywords: 'git branch fork workspace isolated cleanup' },
  { section: 'shortcuts', label: 'Shortcut bindings', description: 'Search, edit, clear, and reset keyboard shortcuts', keywords: 'shortcut shortcuts keybinding keybindings keyboard command commands hotkey hotkeys edit clear reset capture binding bindings', anchor: 'shortcut-bindings' },
  { section: 'shortcuts', label: 'Shortcuts', description: 'Keyboard commands and bindings', keywords: 'keybinding command hotkey keyboard' },
  { section: 'personalization', label: 'Personalization', description: 'Custom instructions and coding preferences', keywords: 'memory instructions preferences pet overlay' },
  { section: 'browser', label: 'Browser', description: 'Browser data, permissions, and site policies', keywords: 'cookies cache history policy webview localhost origin' },
  { section: 'browser', label: 'Browser data', description: 'Clear cookies, cache, and site storage', keywords: 'browser browsing data clear cookies cache site data storage indexeddb service workers', anchor: 'browser-data' },
  { section: 'browser', label: 'Browser permissions', description: 'Approval, history, downloads, and uploads policy', keywords: 'browser security permission approval history download downloads upload uploads ask allow deny policy', anchor: 'browser-permissions' },
  { section: 'browser', label: 'Browser domains', description: 'Allowed and blocked domains for Browser actions', keywords: 'browser domain domains origin origins allowed blocked allowlist blocklist downloads uploads', anchor: 'browser-domains' },
  { section: 'pets', label: 'Pet overlay', description: 'Pet overlay selection and import', keywords: 'pet companion overlay import codex' },
  { section: 'data', label: 'Data controls', description: 'Archived chats and local storage', keywords: 'archive restore delete data storage path' }
]

type SettingsSearchItem = (typeof SETTINGS_SEARCH_ITEMS)[number]

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
  const [composerEnterBehavior, setComposerEnterBehavior] = useState<ComposerEnterBehavior>('send')
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
  const [useTransparentSidebar, setUseTransparentSidebar] = useState(true)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>({})
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false)
  const [personalizationCustomInstructions, setPersonalizationCustomInstructions] = useState('')
  const [personalizationCodingPreferences, setPersonalizationCodingPreferences] = useState('')
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('')
  const [settingsSearchActiveIndex, setSettingsSearchActiveIndex] = useState(0)
  const [settingsSearchTarget, setSettingsSearchTarget] = useState<{ section: SettingsSection; anchor: string } | null>(null)
  const settingsHostOptions = useMemo(() => settingsHostOptionsFromSessions(sessions), [sessions])
  const normalizedSettingsHostId = normalizeSettingsHostId(selectedSettingsHostId, settingsHostOptions)
  const selectedSettingsHost = settingsHostOptions.find((host) => host.id === normalizedSettingsHostId) ?? settingsHostOptions[0]
  const effectiveSection = normalizeSettingsSectionForHostKind(section, selectedSettingsHost.kind)
  const contentScope = settingsSectionScope(effectiveSection)
  const hostAdapterState = settingsHostAdapterState(effectiveSection, selectedSettingsHost.kind)
  const visibleSettingsSections = useMemo(() => new Set(
    settingsNavigationGroupsForHostKind(selectedSettingsHost.kind)
      .flatMap((group) => group.sections)
  ), [selectedSettingsHost.kind])
  const settingsSearchMatches = useMemo(() => {
    const query = settingsSearchQuery.trim().toLowerCase()
    if (!query) return []
    return SETTINGS_SEARCH_ITEMS
      .filter((item) => visibleSettingsSections.has(item.section))
      .filter((item) => {
        const haystack = `${item.label} ${item.description} ${item.keywords} ${item.section}`.toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, 6)
  }, [settingsSearchQuery, visibleSettingsSections])
  const settingsSearchMatch = settingsSearchMatches[Math.min(settingsSearchActiveIndex, Math.max(0, settingsSearchMatches.length - 1))] ?? null
  const settingsScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.api.settings.get().then((s) => {
      const rec = s as unknown as Record<string, unknown>
      setDefaultProvider((rec.defaultProvider as string) ?? 'claude')
      setDefaultModels((rec.defaultModels as Record<string, string>) ?? {})
      setDefaultEfforts((rec.defaultEfforts as Record<string, string>) ?? {})
      setDefaultPermissionModes((rec.defaultPermissionModes as Record<string, string>) ?? {})
      setProviderModels((rec.providerModels as Record<string, string[]>) ?? {})
      setPreferredEditor(normalizePreferredEditor(rec.preferredEditor))
      setComposerEnterBehavior(normalizeComposerEnterBehavior(rec.composerEnterBehavior))
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
      setUseTransparentSidebar((rec.useTransparentSidebar as boolean | undefined) ?? true)
      setReduceMotion((rec.reduceMotion as boolean | undefined) ?? false)
      setShortcutOverrides((rec.shortcutOverrides as ShortcutOverrides | undefined) ?? {})
      setPersonalizationEnabled((rec.personalizationEnabled as boolean | undefined) ?? false)
      setPersonalizationCustomInstructions((rec.personalizationCustomInstructions as string | undefined) ?? '')
      setPersonalizationCodingPreferences((rec.personalizationCodingPreferences as string | undefined) ?? '')
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

  useLayoutEffect(() => {
    const scroll = settingsScrollRef.current
    scroll?.scrollTo({ top: 0, left: 0 })
    scroll?.focus({ preventScroll: true })
  }, [effectiveSection, selectedSettingsHost.id])

  useLayoutEffect(() => {
    if (!settingsSearchTarget || settingsSearchTarget.section !== effectiveSection) return
    const scroll = settingsScrollRef.current
    const target = scroll?.querySelector<HTMLElement>(`[data-settings-search-anchor="${cssEscape(settingsSearchTarget.anchor)}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'start', inline: 'nearest' })
    target.focus({ preventScroll: true })
    target.setAttribute('data-settings-search-active', 'true')
    const timeout = window.setTimeout(() => {
      target.removeAttribute('data-settings-search-active')
    }, 1400)
    return () => {
      window.clearTimeout(timeout)
      target.removeAttribute('data-settings-search-active')
    }
  }, [effectiveSection, settingsSearchTarget, selectedSettingsHost.id])

  useEffect(() => {
    setSettingsSearchActiveIndex(0)
  }, [settingsSearchQuery, selectedSettingsHost.id])

  const loadProviderDiagnostics = useCallback((providerId: string, options: { force?: boolean } = {}): void => {
    if (!options.force && (providerDiagnostics[providerId] || diagnosticsLoading[providerId])) return
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

  const savePreferredEditor = async (value: PreferredEditor): Promise<void> => {
    const previous = preferredEditor
    setPreferredEditor(value)
    try {
      await window.api.settings.set('preferredEditor', value)
    } catch (error) {
      setPreferredEditor(previous)
      throw error
    }
  }

  const saveComposerEnterBehavior = async (value: ComposerEnterBehavior): Promise<void> => {
    const previous = composerEnterBehavior
    setComposerEnterBehavior(value)
    try {
      await window.api.settings.set('composerEnterBehavior', value)
      window.dispatchEvent(new CustomEvent('orchestrator:settings-updated', {
        detail: { composerEnterBehavior: value }
      }))
    } catch (error) {
      setComposerEnterBehavior(previous)
      throw error
    }
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
    useTransparentSidebar: boolean
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
    useTransparentSidebar: overrides.useTransparentSidebar ?? useTransparentSidebar,
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

  const saveThemeToggle = (key: 'useFontSmoothing' | 'usePointerCursors' | 'useTransparentSidebar' | 'reduceMotion', value: boolean): void => {
    if (key === 'useFontSmoothing') setUseFontSmoothing(value)
    if (key === 'usePointerCursors') setUsePointerCursors(value)
    if (key === 'useTransparentSidebar') setUseTransparentSidebar(value)
    if (key === 'reduceMotion') setReduceMotion(value)
    applyAppearanceModel({ [key]: value })
    window.api.settings.set(key, value)
  }

  const saveShortcutOverrides = (next: ShortcutOverrides): void => {
    setShortcutOverrides(next)
    window.api.settings.set('shortcutOverrides', next)
    window.dispatchEvent(new CustomEvent('orchestrator:shortcut-overrides-changed', { detail: next }))
  }

  const savePersonalizationEnabled = async (value: boolean): Promise<void> => {
    setPersonalizationEnabled(value)
    await window.api.settings.set('personalizationEnabled', value)
  }

  const savePersonalizationCustomInstructions = async (value: string): Promise<void> => {
    setPersonalizationCustomInstructions(value)
    await window.api.settings.set('personalizationCustomInstructions', value)
  }

  const savePersonalizationCodingPreferences = async (value: string): Promise<void> => {
    setPersonalizationCodingPreferences(value)
    await window.api.settings.set('personalizationCodingPreferences', value)
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
      useTransparentSidebar,
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

  const navigateSettingsSection = (nextSection: SettingsSection): void => {
    const normalizedSection = normalizeSettingsSectionForHostKind(nextSection, selectedSettingsHost.kind)
    if (normalizedSection !== effectiveSection) {
      window.history.pushState(
        { orchestratorRoute: 'settings', section: normalizedSection, hostId: normalizedSettingsHostId },
        '',
        settingsRouteUrlForLocation(normalizedSection, normalizedSettingsHostId, window.location)
      )
    }
    setSettingsSection(normalizedSection)
  }

  const switchToLocalSettingsHost = (): void => {
    const localSection = normalizeSettingsSectionForHostKind(effectiveSection, 'local')
    window.history.pushState(
      { orchestratorRoute: 'settings', section: localSection, hostId: 'local' },
      '',
      settingsRouteUrlForLocation(localSection, 'local', window.location)
    )
    setSelectedSettingsHostId('local')
    setSettingsSection(localSection)
    window.api.settings.set('settingsHostId', 'local')
  }

  const submitSettingsSearch = (match: SettingsSearchItem | null = settingsSearchMatch): void => {
    if (!match) return
    if (match.anchor) {
      setSettingsSearchTarget({ section: match.section, anchor: match.anchor })
    }
    navigateSettingsSection(match.section)
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
      data-app-shell-focus-area="main"
    >
      <PanelToolbar
        className="settings-topbar"
        dataTestId="settings-topbar"
        ariaLabel="Settings toolbar"
        rootAttrs={{ 'data-app-shell-header-band': 'shared' }}
      >
        <div className="settings-topbar-leading">
          <span className="settings-topbar-title">Settings</span>
          <div
            className="settings-topbar-search-host"
            data-testid="settings-search-results-host"
            data-settings-search-result-count={settingsSearchMatches.length}
          >
            <WorkbenchSearchField
              value={settingsSearchQuery}
              onChange={setSettingsSearchQuery}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && settingsSearchMatches.length > 0) {
                  event.preventDefault()
                  setSettingsSearchActiveIndex((current) => Math.min(current + 1, settingsSearchMatches.length - 1))
                  return
                }
                if (event.key === 'ArrowUp' && settingsSearchMatches.length > 0) {
                  event.preventDefault()
                  setSettingsSearchActiveIndex((current) => Math.max(current - 1, 0))
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitSettingsSearch()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSettingsSearchQuery('')
                }
              }}
              placeholder="Search settings"
              clearLabel="Clear settings search"
              dataTestId="settings-search"
              clearDataTestId="settings-search-clear"
              className="settings-topbar-search"
              ariaLabel="Search settings"
              trailing={settingsSearchQuery.trim().length > 0 && (
                <button
                  type="button"
                  className="settings-search-match"
                  disabled={!settingsSearchMatch}
                  data-testid="settings-search-match"
                  data-settings-search-target={settingsSearchMatch?.section ?? ''}
                  data-settings-search-target-anchor={settingsSearchMatch?.anchor ?? ''}
                  data-settings-search-index={settingsSearchMatch ? settingsSearchActiveIndex : -1}
                  data-settings-search-result-count={settingsSearchMatches.length}
                  onClick={() => submitSettingsSearch()}
                >
                  {settingsSearchMatch ? `${settingsSearchActiveIndex + 1}/${settingsSearchMatches.length} ${settingsSearchMatch.label}` : 'No match'}
                </button>
              )}
            />
            {settingsSearchQuery.trim().length > 0 && (
              <div className="settings-search-results" data-testid="settings-search-results" role="listbox" aria-label="Settings search results">
                {settingsSearchMatches.length > 0 ? settingsSearchMatches.map((match, index) => (
                  <button
                    key={`${match.section}-${match.anchor ?? match.label}`}
                    type="button"
                    className="settings-search-result"
                    data-testid="settings-search-result"
                    data-settings-search-target={match.section}
                    data-settings-search-target-anchor={match.anchor ?? ''}
                    data-settings-search-index={index}
                    data-active={index === settingsSearchActiveIndex ? 'true' : 'false'}
                    role="option"
                    aria-selected={index === settingsSearchActiveIndex}
                    onMouseEnter={() => setSettingsSearchActiveIndex(index)}
                    onClick={() => submitSettingsSearch(match)}
                  >
                    <span className="settings-search-result-label">{match.label}</span>
                    <span className="settings-search-result-description">{settingsTitle(match.section)} · {match.description}</span>
                  </button>
                )) : (
                  <div className="settings-search-no-results" data-testid="settings-search-no-results" role="status" aria-live="polite">
                    No settings match
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
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
          ref={settingsScrollRef}
          className="settings-scroll"
          tabIndex={-1}
          role="region"
          aria-label={`${settingsTitle(effectiveSection)} settings`}
          data-settings-content-host-id={selectedSettingsHost.id}
          data-settings-content-host-kind={selectedSettingsHost.kind}
          data-settings-content-scope={contentScope}
          data-settings-host-adapter={hostAdapterState}
        >
          {hostAdapterState === 'unavailable' ? (
            <SettingsHostAdapterUnavailable
              section={effectiveSection}
              hostLabel={selectedSettingsHost.label}
              onOpenProviders={() => navigateSettingsSection('providers')}
              onSwitchLocal={switchToLocalSettingsHost}
            />
          ) : (
            <>
              {effectiveSection === 'general' && (
                <GeneralSettingsPage
                  preferredEditor={preferredEditor}
                  onSetPreferredEditor={savePreferredEditor}
                  composerEnterBehavior={composerEnterBehavior}
                  onSetComposerEnterBehavior={saveComposerEnterBehavior}
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
                  useTransparentSidebar={useTransparentSidebar}
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
              {effectiveSection === 'worktrees' && <WorktreesSettingsPage onClose={onClose} />}
              {effectiveSection === 'shortcuts' && (
                <ShortcutsSettingsPage
                  shortcutOverrides={shortcutOverrides}
                  onSetShortcutOverrides={saveShortcutOverrides}
                />
              )}
              {effectiveSection === 'data' && <DataControlsSettingsPage />}
              {effectiveSection === 'personalization' && (
                <PersonalizationSettingsPage
                  enabled={personalizationEnabled}
                  customInstructions={personalizationCustomInstructions}
                  codingPreferences={personalizationCodingPreferences}
                  onSetEnabled={savePersonalizationEnabled}
                  onSetCustomInstructions={savePersonalizationCustomInstructions}
                  onSetCodingPreferences={savePersonalizationCodingPreferences}
                />
              )}
              {effectiveSection === 'browser' && (
                <BrowserSettingsPage
                  hostId={selectedSettingsHost.id}
                  hostLabel={selectedSettingsHost.label}
                />
              )}
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
  onOpenProviders,
  onSwitchLocal,
}: {
  section: SettingsSection
  hostLabel: string
  onOpenProviders: () => void
  onSwitchLocal: () => void
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
              <div className="settings-host-adapter-actions">
                <button
                  type="button"
                  className="settings-action-button"
                  data-testid="settings-host-open-providers"
                  aria-label={`Open Provider settings for ${hostLabel}`}
                  onClick={onOpenProviders}
                >
                  Open Provider Settings
                </button>
                <button
                  type="button"
                  className="settings-action-button"
                  data-testid="settings-host-switch-local"
                  aria-label={`Switch to Local ${settingsTitle(section)} settings`}
                  onClick={onSwitchLocal}
                >
                  Switch to Local
                </button>
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
    return `Personalization settings for ${hostLabel} are host-scoped in Codex, including memory, personality, and custom instructions. Orchestrator keeps local personalization editable, but this provider host needs an adapter before remote settings can be edited here.`
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
  if (section === 'browser') return 'Browser'
  if (section === 'pets') return 'Pet overlay'
  if (section === 'data') return 'Data controls'
  return 'General'
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

function normalizeComposerEnterBehavior(value: unknown): ComposerEnterBehavior {
  return value === 'newline' ? 'newline' : 'send'
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
