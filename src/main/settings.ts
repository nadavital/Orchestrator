import Store from 'electron-store'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  providerModels: Record<string, string[]>
}

export const settingsStore = new Store<AppSettings>({
  name: 'settings',
  defaults: { defaultProvider: 'claude', defaultModels: {}, defaultEfforts: {}, providerModels: {} }
})
