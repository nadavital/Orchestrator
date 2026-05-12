import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverClaudeExtensions } from '../claudeExtensions'

test('Claude extension discovery finds project/global commands and skills', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-claude-extensions-'))
  const workDir = join(root, 'repo')
  const homeDir = join(root, 'home')

  mkdirSync(join(workDir, '.claude', 'commands', 'git'), { recursive: true })
  mkdirSync(join(homeDir, '.claude', 'commands'), { recursive: true })
  mkdirSync(join(workDir, '.claude', 'skills', 'debug'), { recursive: true })
  mkdirSync(join(homeDir, '.claude', 'skills', 'release'), { recursive: true })

  writeFileSync(
    join(workDir, '.claude', 'commands', 'git', 'review.md'),
    [
      '---',
      'description: Review staged changes',
      'argument-hint: files',
      '---',
      'Review $ARGUMENTS carefully.'
    ].join('\n')
  )
  writeFileSync(join(homeDir, '.claude', 'commands', 'summarize.md'), '# Summarize\nSummarize the session.')
  writeFileSync(join(workDir, '.claude', 'skills', 'debug', 'SKILL.md'), '# Debug Skill\nFind the failure.')
  writeFileSync(join(homeDir, '.claude', 'skills', 'release', 'SKILL.md'), '# Release Skill\nPrepare release notes.')

  const discovered = discoverClaudeExtensions(workDir, homeDir)

  assert.deepEqual(discovered.commands.map((command) => command.name), ['/git:review', '/summarize'])
  assert.deepEqual(discovered.commands.map((command) => command.scope), ['project', 'global'])
  assert.equal(discovered.commands[0].description, 'Review staged changes')
  assert.equal(discovered.commands[0].prompt, 'Review $ARGUMENTS carefully.')
  assert.deepEqual(discovered.commands[0].arguments, [{ name: 'files', optional: true }])

  assert.deepEqual(discovered.skills.map((skill) => skill.name), ['/skill:debug', '/skill:release'])
  assert.deepEqual(discovered.skills.map((skill) => skill.source), ['skill', 'skill'])
  assert.deepEqual(discovered.skills.map((skill) => skill.scope), ['project', 'global'])
})
