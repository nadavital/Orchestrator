import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claudeProjectDir, collectJsonlFiles, createJsonlTailer } from '../jsonlTailer'

function tmpRoot(name: string): string {
  return join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

test('claudeProjectDir matches Claude Code project path encoding', () => {
  assert.equal(
    claudeProjectDir('/Users/navital/Desktop/Orchestrator', '/tmp/home'),
    '/tmp/home/.claude/projects/-Users-navital-Desktop-Orchestrator'
  )
})

test('collectJsonlFiles discovers nested subagent session files in stable order', () => {
  const root = tmpRoot('orchestrator-jsonl-files')
  try {
    mkdirSync(join(root, 'subagents'), { recursive: true })
    writeFileSync(join(root, 'b.jsonl'), '{}\n')
    writeFileSync(join(root, 'a.txt'), 'ignored\n')
    writeFileSync(join(root, 'subagents', 'a.jsonl'), '{}\n')

    assert.deepEqual(
      collectJsonlFiles(root).map((file) => file.slice(root.length + 1)),
      ['b.jsonl', 'subagents/a.jsonl']
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('jsonl tailer starts at end by default and only emits appended lines', () => {
  const root = tmpRoot('orchestrator-jsonl-tail-end')
  const file = join(root, 'session.jsonl')
  const lines: string[] = []
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(file, '{"old":true}\n')

    const tailer = createJsonlTailer(root, (line) => lines.push(line))
    tailer.poll()
    assert.deepEqual(lines, [])

    appendFileSync(file, '{"new":true}\n')
    tailer.poll()
    assert.deepEqual(lines, ['{"new":true}'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('jsonl tailer uses byte offsets for UTF-8 transcript files', () => {
  const root = tmpRoot('orchestrator-jsonl-utf8-offset')
  const file = join(root, 'session.jsonl')
  const lines: string[] = []
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(file, '{"old":"4.5 → 4.6"}\n')

    const tailer = createJsonlTailer(root, (line) => lines.push(line))
    appendFileSync(file, '{"new":true}\n')
    tailer.poll()

    assert.deepEqual(lines, ['{"new":true}'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('jsonl tailer start performs an immediate poll for fast CLI exits', () => {
  const root = tmpRoot('orchestrator-jsonl-start-poll')
  const file = join(root, 'session.jsonl')
  const lines: string[] = []
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(file, '')

    const tailer = createJsonlTailer(root, (line) => lines.push(line), { intervalMs: 60_000 })
    appendFileSync(file, '{"fast":true}\n')
    tailer.start()
    tailer.stop()

    assert.deepEqual(lines, ['{"fast":true}'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('jsonl tailer buffers partial lines until newline arrives', () => {
  const root = tmpRoot('orchestrator-jsonl-partial')
  const file = join(root, 'session.jsonl')
  const lines: string[] = []
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(file, '')

    const tailer = createJsonlTailer(root, (line) => lines.push(line))
    appendFileSync(file, '{"partial":')
    tailer.poll()
    assert.deepEqual(lines, [])

    appendFileSync(file, 'true}\n')
    tailer.poll()
    assert.deepEqual(lines, ['{"partial":true}'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('jsonl tailer reads newly created nested files from offset zero', () => {
  const root = tmpRoot('orchestrator-jsonl-nested-new')
  const lines: string[] = []
  try {
    mkdirSync(root, { recursive: true })
    const tailer = createJsonlTailer(root, (line, file) => {
      lines.push(`${file.slice(root.length + 1)}:${line}`)
    })
    tailer.poll()

    mkdirSync(join(root, 'subagents'), { recursive: true })
    writeFileSync(join(root, 'subagents', 'agent.jsonl'), '{"agent":"started"}\n')
    tailer.poll()

    assert.deepEqual(lines, ['subagents/agent.jsonl:{"agent":"started"}'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('jsonl tailer can replay from the beginning when explicitly requested', () => {
  const root = tmpRoot('orchestrator-jsonl-replay')
  const file = join(root, 'session.jsonl')
  const lines: string[] = []
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(file, '{"old":true}\n')

    const tailer = createJsonlTailer(root, (line) => lines.push(line), { startFromEnd: false })
    tailer.poll()
    assert.deepEqual(lines, ['{"old":true}'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
