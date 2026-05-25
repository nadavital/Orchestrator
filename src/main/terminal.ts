import { spawn as spawnProcess } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn as spawnPty } from 'node-pty'
import type { IPty } from 'node-pty'
import { BrowserWindow } from 'electron'
import { safeWindowSend } from './safeWebContents'
import { createTerminalServiceSnapshot } from './terminalServiceSnapshot'
import type { TerminalServiceSnapshot } from '../types'

type TerminalShell = {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

type ManagedTerminalShell = TerminalShell & {
  onData(listener: (data: string) => void): void
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void
}

const shells = new Map<string, TerminalShell>()
const startingShells = new Set<string>()
const buffers = new Map<string, string>()
const workDirs = new Map<string, string>()
const exitStates = new Map<string, { exitCode: number; signal: number | null }>()
const MAX_BUFFER = 500_000

function getWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return (
    windows.find((window) => {
      const url = window.webContents.getURL()
      return url.includes('/out/renderer/index.html') && !url.includes('pet-overlay')
    }) ??
    windows[0] ??
    null
  )
}

function appendOutput(terminalId: string, data: string): void {
  const prev = buffers.get(terminalId) ?? ''
  const next = prev + data
  buffers.set(terminalId, next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next)
  safeWindowSend(getWindow(), 'terminal:data', terminalId, data)
}

export const terminalManager = {
  spawn(terminalId: string, workDir: string): void {
    if (shells.has(terminalId) || startingShells.has(terminalId)) return
    startingShells.add(terminalId)
    exitStates.delete(terminalId)
    const shell = process.env.SHELL ?? '/bin/zsh'
    let shellProcess: ManagedTerminalShell
    let fallbackNotice: string | null = null
    try {
      const pty = spawnPty(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: workDir,
        env: process.env as Record<string, string>
      })
      shellProcess = wrapPty(pty)
    } catch (error) {
      const ptyMessage = error instanceof Error ? error.message : 'Pseudo-terminal unavailable.'
      try {
        const child = spawnProcess(shell, ['-l'], {
          cwd: workDir,
          env: process.env,
          stdio: 'pipe'
        })
        shellProcess = wrapPipeShell(child)
        fallbackNotice = `Pseudo-terminal unavailable (${ptyMessage}); using pipe-backed shell.`
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Failed to start terminal.'
        const message = `${ptyMessage}\n${fallbackMessage}`
        buffers.set(terminalId, message)
        workDirs.set(terminalId, workDir)
        safeWindowSend(getWindow(), 'terminal:error', terminalId, message)
        startingShells.delete(terminalId)
        throw fallbackError
      }
    }
    buffers.set(terminalId, '')
    workDirs.set(terminalId, workDir)
    if (fallbackNotice) appendOutput(terminalId, `\x1b[2m${fallbackNotice}\x1b[0m\r\n`)
    appendOutput(terminalId, `\x1b[2mShell ready in ${workDir}\x1b[0m\r\n`)
    attachShellEvents(terminalId, shellProcess)
    shells.set(terminalId, shellProcess)
    startingShells.delete(terminalId)
  },

  getBuffer(terminalId: string): string {
    return buffers.get(terminalId) ?? ''
  },

  getServiceSnapshot(): TerminalServiceSnapshot {
    return createTerminalServiceSnapshot({
      shellIds: shells.keys(),
      startingIds: startingShells,
      buffers,
      workDirs,
      exitStates
    })
  },

  write(terminalId: string, data: string): void {
    shells.get(terminalId)?.write(data)
  },

  runCommand(terminalId: string, command: string): Promise<void> {
    const trimmed = command.trim()
    if (!trimmed) return Promise.resolve()

    const shell = process.env.SHELL ?? '/bin/zsh'
    const cwd = workDirs.get(terminalId) ?? process.cwd()
    appendOutput(terminalId, `\r\n$ ${trimmed}\r\n`)

    return new Promise((resolve) => {
      const child = spawnProcess(shell, ['-lc', trimmed], {
        cwd,
        env: process.env
      })

      child.stdout.on('data', (data) => appendOutput(terminalId, data.toString()))
      child.stderr.on('data', (data) => appendOutput(terminalId, data.toString()))
      child.on('error', (error) => {
        appendOutput(terminalId, `${error.message}\r\n`)
        resolve()
      })
      child.on('close', (code) => {
        if (code && code !== 0) appendOutput(terminalId, `\r\nCommand exited with code ${code}\r\n`)
        resolve()
      })
    })
  },

  resize(terminalId: string, cols: number, rows: number): void {
    try {
      shells.get(terminalId)?.resize(cols, rows)
    } catch { /* ignore */ }
  },

  clear(terminalId: string): void {
    buffers.set(terminalId, '')
    shells.get(terminalId)?.write('\x1b[2J\x1b[H')
  },

  kill(terminalId: string): void {
    const pty = shells.get(terminalId)
    if (pty) {
      pty.kill()
      shells.delete(terminalId)
      buffers.delete(terminalId)
      workDirs.delete(terminalId)
      exitStates.delete(terminalId)
    }
  }
}

function wrapPty(pty: IPty): ManagedTerminalShell {
  return {
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
    onData: (listener) => pty.onData(listener),
    onExit: (listener) => pty.onExit(listener)
  }
}

function wrapPipeShell(child: ChildProcessWithoutNullStreams): ManagedTerminalShell {
  return {
    write: (data) => {
      if (!child.stdin.destroyed) child.stdin.write(data)
    },
    resize: () => undefined,
    kill: () => child.kill(),
    onData: (listener) => {
      child.stdout.on('data', (data) => listener(data.toString()))
      child.stderr.on('data', (data) => listener(data.toString()))
      child.on('error', (error) => listener(`${error.message}\r\n`))
    },
    onExit: (listener) => {
      child.on('close', (code, signal) => listener({ exitCode: code ?? 0, signal: signal ? 1 : undefined }))
    }
  }
}

function attachShellEvents(terminalId: string, shell: ManagedTerminalShell): void {
  shell.onData((data) => {
    appendOutput(terminalId, data)
  })
  shell.onExit(({ exitCode, signal }) => {
    shells.delete(terminalId)
    const normalizedSignal = signal ?? null
    exitStates.set(terminalId, { exitCode, signal: normalizedSignal })
    safeWindowSend(getWindow(), 'terminal:exit', terminalId, exitCode, normalizedSignal)
  })
}
