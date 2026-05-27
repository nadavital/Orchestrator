import type { ProviderSidebarSyncResult, Session } from '../types'

export interface CodexSidebarThreadMetadataSyncOptions {
  cwd: string
  sessions: ReadonlyArray<Pick<Session, 'provider'>>
  fetchThreadList: (cwd: string) => Promise<unknown>
  applyThreadList: (threadListResult: unknown) => number
}

export interface CodexSidebarRefreshAfterRunInput {
  providerId?: string | null
  runtime?: string | null
  smokeOutput?: string | null
}

export interface CodexSidebarIdleRefreshInput {
  now: number
  lastRefreshAt?: number | null
  minIntervalMs: number
  inFlight?: boolean
  smokeOutput?: string | null
}

export function codexPinnedThreadKeysFromList(result: unknown): string[] {
  const record = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null
  const values = Array.isArray(record?.threadIds)
    ? record.threadIds
    : Array.isArray(record?.threads)
      ? record.threads.map((thread) => thread && typeof thread === 'object' ? (thread as Record<string, unknown>).id : thread)
      : Array.isArray(record?.data)
        ? record.data.map((thread) => thread && typeof thread === 'object' ? (thread as Record<string, unknown>).id : thread)
        : Array.isArray(result)
          ? result
          : []

  const seen = new Set<string>()
  const keys: string[] = []
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id) continue
    const key = id.includes(':') ? id : `remote:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

export async function syncCodexSidebarThreadMetadata(
  options: CodexSidebarThreadMetadataSyncOptions
): Promise<ProviderSidebarSyncResult> {
  if (!options.sessions.some((session) => session.provider === 'codex')) {
    return {
      ok: true,
      providerId: 'codex',
      changed: 0,
      skipped: 'no-provider-sessions'
    }
  }

  try {
    const threadList = await options.fetchThreadList(options.cwd)
    return {
      ok: true,
      providerId: 'codex',
      changed: options.applyThreadList(threadList)
    }
  } catch (error) {
    return {
      ok: false,
      providerId: 'codex',
      changed: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function shouldRefreshCodexSidebarMetadataAfterRun(input: CodexSidebarRefreshAfterRunInput): boolean {
  if (input.smokeOutput) return false
  return input.providerId === 'codex' && input.runtime === 'app-server'
}

export function shouldRefreshCodexSidebarMetadataOnIdle(input: CodexSidebarIdleRefreshInput): boolean {
  if (input.smokeOutput) return false
  if (input.inFlight) return false
  if (!input.lastRefreshAt) return true
  return input.now - input.lastRefreshAt >= input.minIntervalMs
}
