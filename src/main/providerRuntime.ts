import { spawn as ptySpawn } from 'node-pty'
import type { IPty } from 'node-pty'
import type { RunEvent, RunRequest, Session } from '../types'
import { approvalBroker } from './approvalBroker'
import { CodexAppServerRuntimeManager } from './codexAppServerRuntime'
import {
  buildProviderCommandForRuntime,
  providerSpawnEnv,
  resolveProviderCommand,
  type ProviderAdapter
} from './providers'

export interface ProviderRuntimeProcess {
  write(data: string): void
  kill(signal?: string): void
  onData(handler: (data: string) => void): void
  onExit(handler: () => void): void
}

export type ProviderRuntimeSpawn = (
  binary: string,
  args: string[],
  options: {
    name: string
    cwd: string
    env: NodeJS.ProcessEnv
    cols: number
    rows: number
  }
) => ProviderRuntimeProcess

export interface StartProviderRunOptions {
  sessionId: string
  session: Session
  provider: ProviderAdapter
  request: RunRequest
  mode?: 'start' | 'resume'
  onRawData: (data: string) => void
  onParsedEvents: (events: RunEvent[]) => void
  onData: (data: string, process: ProviderRuntimeProcess) => void
  onExit: () => void
}

export interface ProviderRunStartResult {
  ok: boolean
  error?: 'missing-binary' | 'spawn-failed'
  message?: string
}

function requestProcessStop(process: ProviderRuntimeProcess): void {
  try { process.write('\x03') } catch { /* ignore stop races */ }
  try { process.kill('SIGTERM') } catch { /* ignore stop races */ }
  setTimeout(() => {
    try { process.kill('SIGKILL') } catch { /* ignore stop races */ }
  }, 1500)
}

function defaultSpawn(
  binary: string,
  args: string[],
  options: Parameters<ProviderRuntimeSpawn>[2]
): ProviderRuntimeProcess {
  return ptySpawn(binary, args, options) as IPty
}

export class ProviderRuntimeManager {
  private readonly activeProcesses = new Map<string, ProviderRuntimeProcess>()
  private readonly activeRunCleanups = new Map<string, () => void>()
  private readonly appServerRuntime = new CodexAppServerRuntimeManager()

  constructor(private readonly spawnProcess: ProviderRuntimeSpawn = defaultSpawn) {}

  hasActiveRun(sessionId: string): boolean {
    return this.activeProcesses.has(sessionId) || this.appServerRuntime.has(sessionId)
  }

  write(sessionId: string, data: string): void {
    if (this.appServerRuntime.has(sessionId)) {
      this.appServerRuntime.write(sessionId, data)
      return
    }
    this.activeProcesses.get(sessionId)?.write(data)
  }

  async prepareRunRequest(
    sessionId: string,
    provider: ProviderAdapter,
    runRequest: RunRequest,
    applyEvents: (sessionId: string, events: RunEvent[]) => void
  ): Promise<RunRequest> {
    this.cleanupBridge(sessionId)
    approvalBroker.setEventSink(applyEvents)

    if (provider.id !== 'claude' || (runRequest.runtime ?? 'headless') !== 'headless') return runRequest

    const prepared = await approvalBroker.prepareClaudeRun(sessionId, runRequest.allowedTools ?? [])
    this.activeRunCleanups.set(sessionId, prepared.dispose)
    return {
      ...runRequest,
      providerContext: {
        ...runRequest.providerContext,
        settingsPath: prepared.settingsPath,
        includeHookEvents: true
      }
    }
  }

  startRun(options: StartProviderRunOptions): ProviderRunStartResult {
    if (options.provider.id === 'codex' && options.request.runtime === 'app-server') {
      const result = this.appServerRuntime.start({
        sessionId: options.sessionId,
        session: options.session,
        provider: options.provider,
        request: options.request,
        mode: options.mode ?? 'start',
        onRawData: options.onRawData,
        onParsedEvents: options.onParsedEvents,
        onExit: options.onExit
      })
      if (result.ok) return { ok: true }
      return {
        ok: false,
        error: result.message?.includes('not available') ? 'missing-binary' : 'spawn-failed',
        message: result.message
      }
    }

    const command = resolveProviderCommand(
      options.provider,
      buildProviderCommandForRuntime(options.provider, options.request, options.mode ?? 'start')
    )
    if (!command) {
      this.cleanupBridge(options.sessionId)
      return {
        ok: false,
        error: 'missing-binary',
        message: `${options.provider.id} CLI is not available. Check provider settings or install ${options.provider.binary}.`
      }
    }

    let process: ProviderRuntimeProcess
    try {
      process = this.spawnProcess(command.binary, command.args, {
        name: 'xterm-color',
        cwd: options.session.workDir,
        env: providerSpawnEnv(options.provider.id),
        cols: 220,
        rows: 50
      })
    } catch (error) {
      this.cleanupBridge(options.sessionId)
      return {
        ok: false,
        error: 'spawn-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }

    this.activeProcesses.set(options.sessionId, process)
    let buffer = ''

    process.onData((data) => {
      if (this.activeProcesses.get(options.sessionId) !== process) return
      options.onRawData(data)
      options.onData(data, process)

      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) options.onParsedEvents(options.provider.parseOutputLine(line))
    })

    process.onExit(() => {
      if (this.activeProcesses.get(options.sessionId) !== process) return
      this.activeProcesses.delete(options.sessionId)
      this.cleanupBridge(options.sessionId)
      options.onExit()
    })

    return { ok: true }
  }

  stop(sessionId: string): boolean {
    if (this.appServerRuntime.stop(sessionId)) {
      this.cleanupSession(sessionId)
      return true
    }
    const process = this.activeProcesses.get(sessionId)
    if (!process) return false
    this.activeProcesses.delete(sessionId)
    this.cleanupSession(sessionId)
    requestProcessStop(process)
    return true
  }

  interrupt(sessionId: string): boolean {
    if (this.appServerRuntime.has(sessionId)) return this.appServerRuntime.interrupt(sessionId)
    const process = this.activeProcesses.get(sessionId)
    if (!process) return false
    requestProcessStop(process)
    return true
  }

  resolvePermission(sessionId: string, allow: boolean, persistGrant: boolean): boolean {
    return this.appServerRuntime.resolvePermission(sessionId, allow, persistGrant)
  }

  answerUserInput(sessionId: string, answer: string): boolean {
    return this.appServerRuntime.answerUserInput(sessionId, answer)
  }

  cleanupBridge(sessionId: string): void {
    this.activeRunCleanups.get(sessionId)?.()
    this.activeRunCleanups.delete(sessionId)
    approvalBroker.disposeSession(sessionId)
  }

  cleanupSession(sessionId: string): void {
    this.cleanupBridge(sessionId)
  }
}

export const providerRuntime = new ProviderRuntimeManager()
