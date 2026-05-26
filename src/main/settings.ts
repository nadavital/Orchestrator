import Store from 'electron-store'
import { migrateLegacyUserData } from './userDataMigration'
import type { ShortcutOverrides } from '../types/appCommands'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  preferredEditor: 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
  appearance: 'system' | 'mist' | 'graphite' | 'ocean' | 'palenight' | 'high-contrast' | 'dark' | 'light'
  accent: 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system' | 'custom'
  customAccent: string
  density: 'comfortable' | 'compact'
  sidebarTint: boolean
  transcriptStyle: 'relaxed' | 'dense'
  interfaceScale: number
  uiFont: string
  monoFont: string
  appearanceTheme: 'light' | 'dark' | 'system'
  appearanceLightChromeTheme: ChromeTheme
  appearanceDarkChromeTheme: ChromeTheme
  appearanceLightCodeThemeId: string
  appearanceDarkCodeThemeId: string
  sansFontSize: number
  codeFontSize: number
  useFontSmoothing: boolean
  usePointerCursors: boolean
  reduceMotion: boolean
  shortcutOverrides: ShortcutOverrides
}

interface ChromeTheme {
  accent: string
  surface: string
  ink: string
  contrast: number
  opaqueWindows: boolean
  fonts?: {
    ui?: string
    code?: string
  }
  semanticColors?: {
    diffAdded?: string
    diffRemoved?: string
    skill?: string
  }
}

migrateLegacyUserData()

export const settingsStore = new Store<AppSettings>({
  name: 'settings',
  defaults: {
    defaultProvider: 'claude',
    defaultModels: {},
    defaultEfforts: {},
    defaultPermissionModes: {},
    providerModels: {},
    preferredEditor: 'system',
    appearance: 'mist',
    accent: 'blue',
    customAccent: '#0a7cff',
    density: 'comfortable',
    sidebarTint: true,
    transcriptStyle: 'relaxed',
    interfaceScale: 1,
    uiFont: 'system',
    monoFont: 'system',
    appearanceTheme: 'system',
    appearanceLightChromeTheme: {
      accent: '#0a7cff',
      surface: '#ffffff',
      ink: '#111111',
      contrast: 45,
      opaqueWindows: false,
      semanticColors: {
        diffAdded: '#13a355',
        diffRemoved: '#dc2f2f',
        skill: '#7c3aed'
      }
    },
    appearanceDarkChromeTheme: {
      accent: '#8ab4f8',
      surface: '#20222a',
      ink: '#f3f3f0',
      contrast: 58,
      opaqueWindows: true,
      semanticColors: {
        diffAdded: '#36c172',
        diffRemoved: '#ff5f5f',
        skill: '#a78bfa'
      }
    },
    appearanceLightCodeThemeId: 'github-light',
    appearanceDarkCodeThemeId: 'github-dark',
    sansFontSize: 13,
    codeFontSize: 13,
    useFontSmoothing: true,
    usePointerCursors: true,
    reduceMotion: false,
    shortcutOverrides: {},
  }
})

if (
  process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
  process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_PRESERVE_THEME !== '1'
) {
  settingsStore.set('appearance', 'graphite')
  settingsStore.set('appearanceTheme', 'dark')
}
