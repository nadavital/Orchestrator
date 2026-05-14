import Store from 'electron-store'
import { migrateLegacyUserData } from './userDataMigration'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  appearance: 'system' | 'mist' | 'graphite' | 'high-contrast' | 'dark' | 'light'
  accent: 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system'
  density: 'comfortable' | 'compact'
  sidebarTint: boolean
  transcriptStyle: 'relaxed' | 'dense'
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
    appearance: 'system',
    accent: 'blue',
    density: 'comfortable',
    sidebarTint: true,
    transcriptStyle: 'relaxed',
  }
})
