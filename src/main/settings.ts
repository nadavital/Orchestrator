import Store from 'electron-store'
import { migrateLegacyUserData } from './userDataMigration'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  appearance: 'system' | 'dark' | 'light'
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
  }
})
