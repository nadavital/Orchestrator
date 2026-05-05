import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { BrowserWindow } from 'electron'

const shells = new Map<string, IPty>()
const buffers = new Map<string, string>()
const MAX_BUFFER = 500_000

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export const terminalManager = {
  spawn(terminalId: string, workDir: string): void {
    if (shells.has(terminalId)) return
    const shell = process.env.SHELL ?? '/bin/zsh'
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workDir,
      env: process.env as Record<string, string>
    })
    buffers.set(terminalId, '')
    pty.onData((data) => {
      const prev = buffers.get(terminalId) ?? ''
      const next = prev + data
      buffers.set(terminalId, next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next)
      getWindow()?.webContents.send('terminal:data', terminalId, data)
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
    }
  }
}
