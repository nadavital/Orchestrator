import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHEAP_LIVE_EFFORT,
  CHEAP_LIVE_MODELS,
  liveSmokeEffort,
  liveSmokeModel
} from './provider-smoke-config.mjs'

test('live smoke defaults use cheap integration models', () => {
  assert.deepEqual(CHEAP_LIVE_MODELS, {
    claude: 'claude-sonnet-4-6',
    codex: 'gpt-5.4-mini',
    copilot: 'gpt-5-mini',
    cursor: 'gpt-5-mini'
  })

  assert.deepEqual(CHEAP_LIVE_EFFORT, {
    claude: 'low',
    codex: 'low',
    copilot: 'low',
    cursor: 'low'
  })
})

test('live smoke model and effort can be overridden per provider', () => {
  const env = {
    LIVE_MODEL_CODEX: 'gpt-5.5',
    LIVE_EFFORT_CODEX: 'high'
  }

  assert.equal(liveSmokeModel('codex', env), 'gpt-5.5')
  assert.equal(liveSmokeEffort('codex', env), 'high')
  assert.equal(liveSmokeModel('claude', env), 'claude-sonnet-4-6')
  assert.equal(liveSmokeEffort('claude', env), 'low')
})
