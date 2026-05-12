import { spawn as ptySpawn } from 'node-pty'
import type { IPty } from 'node-pty'
import type { RunEvent, RunRequest, Session, ProviderRuntimeKind } from '../types'
import { approvalBroker } from './approvalBroker'
import { claudeProjectDir, createJsonlTailer, type JsonlTailer } from './jsonlTailer'
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
  private readonly activeJsonlTailers = new Map<string, JsonlTailer>()
  private readonly activeRunCleanups = new Map<string, () => void>()

  constructor(private readonly spawnProcess: ProviderRuntimeSpawn = defaultSpawn) {}

  hasActiveRun(sessionId: string): boolean {
    return this.activeProcesses.has(sessionId)
  }

  write(sessionId: string, data: string): void {
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
    const command = resolveProviderCommand(
      options.provider,
      buildProviderCommandForRuntime(options.provider, options.request, options.mode ?? 'start')
    )
    if (!command) {
      this.stopJsonlTailer(options.sessionId)
      this.cleanupBridge(options.sessionId)
      return {
        ok: false,
        error: 'missing-binary',
        message: `${options.provider.id} CLI is not available. Check provider settings or install ${options.provider.binary}.`
      }
    }

    this.startJsonlTailerIfSupported(
      options.sessionId,
      options.session,
      options.provider,
      options.request.runtime ?? 'headless',
      options.onParsedEvents
    )

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
      this.stopJsonlTailer(options.sessionId)
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
      this.flushAndStopJsonlTailer(options.sessionId)
      this.cleanupBridge(options.sessionId)
      options.onExit()
    })

    return { ok: true }
  }

  stop(sessionId: string): boolean {
    const process = this.activeProcesses.get(sessionId)
    if (!process) return false
    this.activeProcesses.delete(sessionId)
    this.cleanupSession(sessionId)
    requestProcessStop(process)
    return true
  }

  interrupt(sessionId: string): boolean {
    const process = this.activeProcesses.get(sessionId)
    if (!process) return false
    requestProcessStop(process)
    return true
  }

  stopJsonlTailer(sessionId: string): void {
    const tailer = this.activeJsonlTailers.get(sessionId)
    if (!tailer) return
    tailer.stop()
    this.activeJsonlTailers.delete(sessionId)
  }

  flushAndStopJsonlTailer(sessionId: string): void {
    const tailer = this.activeJsonlTailers.get(sessionId)
    if (!tailer) return
    tailer.poll()
    tailer.stop()
    this.activeJsonlTailers.delete(sessionId)
  }

  cleanupBridge(sessionId: string): void {
    this.activeRunCleanups.get(sessionId)?.()
    this.activeRunCleanups.delete(sessionId)
    approvalBroker.disposeSession(sessionId)
  }

  cleanupSession(sessionId: string): void {
    this.stopJsonlTailer(sessionId)
    this.cleanupBridge(sessionId)
  }

  private startJsonlTailerIfSupported(
    sessionId: string,
    session: Session,
    provider: ProviderAdapter,
    runtime: ProviderRuntimeKind,
    onParsedEvents: (events: RunEvent[]) => void
  ): void {
    if (provider.id !== 'claude' || runtime !== 'interactive') return
    this.stopJsonlTailer(sessionId)

    const dir = claudeProjectDir(session.workDir)
    const tailer = createJsonlTailer(dir, (line) => {
      onParsedEvents(provider.parseOutputLine(line))
    })
    tailer.start()

    this.activeJsonlTailers.set(sessionId, tailer)
  }
}

export const providerRuntime = new ProviderRuntimeManager()
