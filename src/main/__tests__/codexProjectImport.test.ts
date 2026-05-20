import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverCodexProjectCandidates } from '../codexProjectImport'

test('discovers recent Codex workspace roots from session metadata', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-codex-import-home-'))
  const workspace = join(home, 'Desktop', 'SampleApp')
  const sessionDir = join(home, '.codex', 'sessions', '2026', '05', '20')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(
    join(sessionDir, 'rollout-2026-05-20T10-00-00-session.jsonl'),
    JSON.stringify({
      timestamp: '2026-05-20T17:00:00.000Z',
      type: 'session_meta',
      payload: {
        cwd: workspace,
        thread_name: 'Improve SampleApp'
      }
    }) + '\n'
  )

  const candidates = discoverCodexProjectCandidates({ homeDir: home })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, 'SampleApp')
  assert.equal(candidates[0].rootPath, workspace)
  assert.equal(candidates[0].threadName, 'Improve SampleApp')

  rmSync(home, { recursive: true, force: true })
})

test('skips duplicate, missing, temporary, and internal Codex workspaces', () => {
  const home = mkdtempSync(join(tmpdir(), 'orchestrator-codex-import-filter-home-'))
  const workspace = join(home, 'Desktop', 'RealApp')
  const sessionDir = join(home, '.codex', 'sessions', '2026', '05', '20')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })

  const writeSession = (name: string, cwd: string): void => {
    writeFileSync(
      join(sessionDir, name),
      JSON.stringify({ timestamp: '2026-05-20T17:00:00.000Z', type: 'session_meta', payload: { cwd } }) + '\n'
    )
  }

  writeSession('real-a.jsonl', workspace)
  writeSession('real-b.jsonl', workspace)
  writeSession('missing.jsonl', join(home, 'Desktop', 'MissingApp'))
  writeSession('codex.jsonl', join(home, '.codex', 'worktrees', 'internal'))
  writeSession('tmp.jsonl', '/tmp/orchestrator-transient')

  const candidates = discoverCodexProjectCandidates({ homeDir: home })
  assert.deepEqual(candidates.map((candidate) => candidate.rootPath), [workspace])

  rmSync(home, { recursive: true, force: true })
})
