import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadLocalEnv(path = join(process.cwd(), '.env')) {
  if (!existsSync(path)) return {}
  const env = {}
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

export function applyLocalEnv(path) {
  const env = loadLocalEnv(path)
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null) process.env[key] = value
  }
  return env
}
