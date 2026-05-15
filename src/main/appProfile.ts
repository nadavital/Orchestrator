import { app } from 'electron'
import { tmpdir } from 'os'
import { isAbsolute, join, resolve } from 'path'

export interface AppProfile {
  name: string
  displayName: string
  userDataDir: string
  isIsolated: boolean
  disablePetOverlay: boolean
  forceReducedMotion: boolean
}

let configuredProfile: AppProfile | null = null

export function configureAppProfile(): AppProfile {
  if (configuredProfile) return configuredProfile

  const profileArg = getArgValue('--orchestrator-profile')
  const userDataArg = getArgValue('--orchestrator-user-data-dir')
  const disablePetArg = hasArg('--orchestrator-disable-pet')
  const rawProfileName = profileArg ?? process.env.ORCHESTRATOR_PROFILE ?? ''
  const rawUserDataDir = userDataArg ?? process.env.ORCHESTRATOR_USER_DATA_DIR ?? ''
  const name = sanitizeProfileName(rawProfileName || (rawUserDataDir ? 'custom' : 'default'))
  const isIsolated = Boolean(rawProfileName || rawUserDataDir)
  const userDataDir = isIsolated
    ? resolveUserDataDir(rawUserDataDir, name)
    : app.getPath('userData')
  const displayName = name === 'default' ? 'Default' : titleCaseProfile(name)

  if (isIsolated) {
    app.setPath('userData', userDataDir)
    app.setName(`Orchestrator ${displayName}`)
  }

  configuredProfile = {
    name,
    displayName,
    userDataDir: app.getPath('userData'),
    isIsolated,
    disablePetOverlay: disablePetArg || process.env.ORCHESTRATOR_DISABLE_PET_OVERLAY === '1',
    forceReducedMotion: hasArg('--orchestrator-reduced-motion') || process.env.ORCHESTRATOR_FORCE_REDUCED_MOTION === '1'
  }
  return configuredProfile
}

export function getAppProfile(): AppProfile {
  return configuredProfile ?? configureAppProfile()
}

function resolveUserDataDir(rawDir: string, profileName: string): string {
  if (rawDir) return isAbsolute(rawDir) ? rawDir : resolve(rawDir)
  return join(tmpdir(), 'orchestrator-profiles', profileName)
}

function getArgValue(name: string): string | undefined {
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i]
    if (arg === name) return process.argv[i + 1]
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
  }
  return undefined
}

function hasArg(name: string): boolean {
  return process.argv.includes(name)
}

function sanitizeProfileName(name: string): string {
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized || 'default'
}

function titleCaseProfile(name: string): string {
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
