import { spawn as spawnProcess } from 'node:child_process'
import { spawn as spawnPty } from 'node-pty'
import type { IPty } from 'node-pty'
import { BrowserWindow } from 'electron'
import { safeWindowSend } from './safeWebContents'

const shells = new Map<string, IPty>()
const buffers = new Map<string, string>()
const workDirs = new Map<string, string>()
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
    if (shells.has(terminalId)) return
    const shell = process.env.SHELL ?? '/bin/zsh'
    const pty = spawnPty(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workDir,
      env: process.env as Record<string, string>
    })
    buffers.set(terminalId, '')
    workDirs.set(terminalId, workDir)
    appendOutput(terminalId, `\x1b[2mShell ready in ${workDir}\x1b[0m\r\n`)
    pty.onData((data) => {
      appendOutput(terminalId, data)
    })
    pty.onExit(() => {
      shells.delete(terminalId)
    })
    shells.set(terminalId, pty)
  },

  getBuffer(terminalId: string): string {
    return buffers.get(terminalId) ?? ''
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
    }
  }
}
