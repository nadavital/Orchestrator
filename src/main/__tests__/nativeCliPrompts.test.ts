import test from 'node:test'
import assert from 'node:assert/strict'
import { detectNativeCliPrompt, nativeCliPromptAnswer, nativeCliPromptContent } from '../../types/nativeCliPrompts'

test('detects Claude workspace trust prompt from compact PTY text', () => {
  const raw = 'Quick safety check: Is this a project you created or one you trust? ❯ 1. Yes, I trust this folder 2. No, exit'

  assert.equal(detectNativeCliPrompt('claude', raw), 'claude_workspace_trust')
  assert.equal(detectNativeCliPrompt('codex', raw), null)
})

test('maps Claude workspace trust prompt to a compact user-input card', () => {
  const content = nativeCliPromptContent('claude_workspace_trust')

  assert.match(content.content, /workspace trust/i)
  assert.equal(content.questions[0].header, 'Workspace Trust')
  assert.equal(content.questions[0].options?.[0].label, 'Trust workspace')
  assert.equal(nativeCliPromptAnswer('claude_workspace_trust', 'Trust workspace'), '1')
  assert.equal(nativeCliPromptAnswer('claude_workspace_trust', 'Exit'), '2')
})
