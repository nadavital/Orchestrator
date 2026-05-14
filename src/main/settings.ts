import Store from 'electron-store'
import { migrateLegacyUserData } from './userDataMigration'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  appearance: 'system' | 'mist' | 'graphite' | 'high-contrast' | 'dark' | 'light'
  accent: 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system' | 'custom'
  customAccent: string
  density: 'comfortable' | 'compact'
  sidebarTint: boolean
  transcriptStyle: 'relaxed' | 'dense'
  interfaceScale: number
  uiFont: string
  monoFont: string
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
    appearance: 'mist',
    accent: 'blue',
    customAccent: '#0a7cff',
    density: 'comfortable',
    sidebarTint: true,
    transcriptStyle: 'relaxed',
    interfaceScale: 1,
    uiFont: 'system',
    monoFont: 'system',
  }
})
