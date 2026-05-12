import test from 'node:test'
import assert from 'node:assert/strict'
import { detectNativeCliPrompt, nativeCliPromptAnswer, nativeCliPromptContent, nativeCliPromptSubmitSequence } from '../../types/nativeCliPrompts'

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
  assert.equal(nativeCliPromptAnswer('claude_workspace_trust', 'Trust workspace'), '')
  assert.equal(nativeCliPromptAnswer('claude_workspace_trust', 'Exit'), '2')
  assert.equal(nativeCliPromptSubmitSequence('claude_workspace_trust', 'Trust workspace'), '\r')
  assert.equal(nativeCliPromptSubmitSequence('claude_workspace_trust', 'Exit'), '2\r')
})

test('detects and maps Claude MCP server enable prompt', () => {
  const raw = '3 new MCP servers found in .mcp.json Select any you wish to enable. ❯ [✔] git [✔] jira Enter to confirm · Esc to reject all'
  const content = nativeCliPromptContent('claude_mcp_servers_enable')

  assert.equal(detectNativeCliPrompt('claude', raw), 'claude_mcp_servers_enable')
  assert.match(content.content, /MCP servers/i)
  assert.equal(content.questions[0].header, 'MCP Servers')
  assert.equal(content.questions[0].options?.[0].label, 'Enable selected')
  assert.equal(nativeCliPromptAnswer('claude_mcp_servers_enable', 'Enable selected'), '')
  assert.equal(nativeCliPromptAnswer('claude_mcp_servers_enable', 'Reject all'), '\x1b')
  assert.equal(nativeCliPromptSubmitSequence('claude_mcp_servers_enable', 'Enable selected'), '\r')
  assert.equal(nativeCliPromptSubmitSequence('claude_mcp_servers_enable', 'Reject all'), '\x1b')
})
