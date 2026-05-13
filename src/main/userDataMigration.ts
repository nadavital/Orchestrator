import { app } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getAppProfile } from './appProfile'

let didMigrate = false

export function migrateLegacyUserData(): void {
  if (didMigrate) return
  didMigrate = true
  if (getAppProfile().isIsolated) return

  const legacyDir = join(app.getPath('appData'), 'claude-orchestrator')
  const currentDir = app.getPath('userData')
  if (!existsSync(legacyDir) || legacyDir === currentDir) return

  mkdirSync(currentDir, { recursive: true })
  for (const entry of ['config.json', 'settings.json', 'pets']) {
    const from = join(legacyDir, entry)
    const to = join(currentDir, entry)
    if (existsSync(from) && !existsSync(to)) {
      cpSync(from, to, { recursive: true })
    }
  }
}
