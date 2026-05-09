import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface JsonlTailer {
  poll(): void
  start(): void
  stop(): void
}

export function claudeProjectDir(cwd: string, home = homedir()): string {
  const encoded = cwd.replace(/\//g, '-')
  return join(home, '.claude', 'projects', encoded)
}

export function collectJsonlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(path))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path)
    }
  }
  return files.sort()
}

export function snapshotJsonlOffsets(dir: string): Map<string, number> {
  const offsets = new Map<string, number>()
  for (const file of collectJsonlFiles(dir)) {
    offsets.set(file, statSync(file).size)
  }
  return offsets
}

export function createJsonlTailer(
  dir: string,
  onLine: (line: string, file: string) => void,
  options: {
    intervalMs?: number
    startFromEnd?: boolean
  } = {}
): JsonlTailer {
  const offsets = options.startFromEnd === false ? new Map<string, number>() : snapshotJsonlOffsets(dir)
  const buffers = new Map<string, string>()
  let timer: NodeJS.Timeout | null = null

  const poll = (): void => {
    for (const file of collectJsonlFiles(dir)) {
      const previousOffset = offsets.get(file) ?? 0
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        continue
      }

      if (size < previousOffset) {
        offsets.set(file, 0)
        buffers.delete(file)
      }

      const effectiveOffset = Math.min(offsets.get(file) ?? 0, size)
      if (size <= effectiveOffset) {
        offsets.set(file, size)
        continue
      }

      let chunk = ''
      try {
        chunk = readFileSync(file).subarray(effectiveOffset).toString('utf8')
      } catch {
        continue
      }
      offsets.set(file, size)

      const pending = (buffers.get(file) ?? '') + chunk
      const lines = pending.split('\n')
      buffers.set(file, lines.pop() ?? '')

      for (const line of lines) {
        if (line.trim()) onLine(line, file)
      }
    }
  }

  return {
    poll,
    start() {
      if (timer) return
      poll()
      timer = setInterval(poll, options.intervalMs ?? 500)
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
  }
}
