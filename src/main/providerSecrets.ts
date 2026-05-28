import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import type { ProviderAuthSecretMutationResult, ProviderAuthSecretStatus } from '../types'

const execFileAsync = promisify(execFile)
const SECURITY_BINARY = '/usr/bin/security'

const PROVIDER_SECRET_KEYS: Record<string, string> = {
  cursor: 'CURSOR_API_KEY'
}

function secretKeyForProvider(providerId: string): string | null {
  return PROVIDER_SECRET_KEYS[providerId] ?? null
}

function keychainService(providerId: string): string {
  return `com.navital.orchestrator.provider.${providerId}`
}

export function providerKeychainEnv(providerId?: string): NodeJS.ProcessEnv {
  if (!providerId || process.env.ORCHESTRATOR_DISABLE_PROVIDER_KEYCHAIN === '1') return {}
  const key = secretKeyForProvider(providerId)
  if (!key) return {}
  const secret = readProviderSecretSync(providerId)
  return secret ? { [key]: secret } : {}
}

export function readProviderSecretSync(providerId: string): string | null {
  const key = secretKeyForProvider(providerId)
  if (!key) return null
  try {
    const value = execFileSync(SECURITY_BINARY, [
      'find-generic-password',
      '-s', keychainService(providerId),
      '-a', key,
      '-w'
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return value || null
  } catch {
    return null
  }
}

export async function getProviderAuthSecretStatus(providerId: string): Promise<ProviderAuthSecretStatus> {
  const key = secretKeyForProvider(providerId)
  if (!key) {
    return {
      providerId,
      configured: false,
      source: 'none',
      message: 'This provider does not have an app-managed secret.',
      updatedAt: Date.now()
    }
  }

  const secret = readProviderSecretSync(providerId)
  return {
    providerId,
    configured: Boolean(secret),
    source: secret ? 'keychain' : 'none',
    message: secret ? 'API key stored in macOS Keychain.' : 'No API key stored in Orchestrator.',
    updatedAt: Date.now()
  }
}

export async function setProviderAuthSecret(providerId: string, secret: string): Promise<ProviderAuthSecretMutationResult> {
  const key = secretKeyForProvider(providerId)
  const value = secret.trim()
  if (!key) return { ok: false, status: await getProviderAuthSecretStatus(providerId), message: 'Unsupported provider secret.' }
  if (!value) return { ok: false, status: await getProviderAuthSecretStatus(providerId), message: 'API key is empty.' }

  try {
    await execFileAsync(SECURITY_BINARY, [
      'add-generic-password',
      '-U',
      '-s', keychainService(providerId),
      '-a', key,
      '-w', value
    ])
    return {
      ok: true,
      status: await getProviderAuthSecretStatus(providerId),
      message: 'API key saved in macOS Keychain.'
    }
  } catch (error) {
    return {
      ok: false,
      status: await getProviderAuthSecretStatus(providerId),
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function deleteProviderAuthSecret(providerId: string): Promise<ProviderAuthSecretMutationResult> {
  const key = secretKeyForProvider(providerId)
  if (!key) return { ok: false, status: await getProviderAuthSecretStatus(providerId), message: 'Unsupported provider secret.' }

  try {
    await execFileAsync(SECURITY_BINARY, [
      'delete-generic-password',
      '-s', keychainService(providerId),
      '-a', key
    ])
  } catch {
    // Deleting an absent key should leave the app in the desired state.
  }

  return {
    ok: true,
    status: await getProviderAuthSecretStatus(providerId),
    message: 'API key removed from macOS Keychain.'
  }
}
