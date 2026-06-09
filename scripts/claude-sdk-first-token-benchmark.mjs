#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { liveSmokeEffort, liveSmokeModel } from './provider-smoke-config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')
const claudeRuntimeModulePath = join(repoRoot, 'out-test/src/main/claudeSdkRuntime.js')
const { providerSpawnEnv } = await import(providersModulePath)
const { resolveClaudeSdkExecutablePath } = await import(claudeRuntimeModulePath)

const timeoutMs = Number(process.env.CLAUDE_SDK_FIRST_TOKEN_TIMEOUT_MS ?? 120_000)
const lineCount = Math.max(20, Math.min(80, Number(process.env.ORCHESTRATOR_LIVE_CLAUDE_STREAM_LINES ?? 40)))
const startToken = 'CLAUDE_LIVE_STREAMING_TYPING_START'
const doneToken = 'CLAUDE_LIVE_STREAMING_TYPING_DONE'
const model = liveSmokeModel('claude') || 'claude-sonnet-4-6'
const effort = liveSmokeEffort('claude')
const cwd = join(tmpdir(), `orchestrator-claude-first-token-${Date.now()}`)
const prompt = [
  'This is a live Orchestrator UI latency proof using Claude.',
  'Do not use tools and do not edit files.',
  `Begin with exactly ${startToken}.`,
  `Then write ${lineCount} short numbered lines.`,
  `Each line must contain CLAUDE_STREAM_LINE_NNN with a zero-padded number from 001 through ${String(lineCount).padStart(3, '0')}.`,
  `End with exactly ${doneToken}.`
].join(' ')

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((block) => {
    if (!block || typeof block !== 'object') return ''
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (block.type === 'tool_result' && typeof block.content === 'string') return block.content
    if (block.type === 'tool_result' && Array.isArray(block.content)) return textFromContent(block.content)
    return ''
  }).join('')
}

function assistantTextFromMessage(message) {
  if (message?.type !== 'assistant') return ''
  return textFromContent(message.message?.content)
}

rmSync(cwd, { recursive: true, force: true })
mkdirSync(cwd, { recursive: true })
writeFileSync(join(cwd, 'README.md'), 'Disposable Claude SDK first-token benchmark workspace.\n')

const abortController = new AbortController()
const startedAt = performance.now()
const timeout = setTimeout(() => abortController.abort(), timeoutMs)
const messages = []
let firstMessageMs = null
let firstAssistantMessageMs = null
let firstAssistantTextMs = null
let firstStartTokenMs = null
let completedMs = null
let assistantText = ''
let error = null

try {
  for await (const message of query({
    prompt,
    options: {
      cwd,
      model,
      effort,
      maxTurns: 1,
      tools: [],
      allowedTools: [],
      permissionMode: 'dontAsk',
      includePartialMessages: true,
      includeHookEvents: true,
      forwardSubagentText: true,
      persistSession: false,
      pathToClaudeCodeExecutable: resolveClaudeSdkExecutablePath(),
      abortController,
      env: {
        ...providerSpawnEnv('claude'),
        CLAUDE_AGENT_SDK_CLIENT_APP: 'orchestrator/claude-sdk-first-token-benchmark'
      }
    }
  })) {
    const elapsed = performance.now() - startedAt
    messages.push(message)
    if (firstMessageMs === null) firstMessageMs = elapsed
    const text = assistantTextFromMessage(message)
    if (message?.type === 'assistant' && firstAssistantMessageMs === null) firstAssistantMessageMs = elapsed
    if (text && firstAssistantTextMs === null) firstAssistantTextMs = elapsed
    if (text) assistantText += text
    if (assistantText.includes(startToken) && firstStartTokenMs === null) firstStartTokenMs = elapsed
    if (message?.type === 'result') completedMs = elapsed
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
} finally {
  clearTimeout(timeout)
  rmSync(cwd, { recursive: true, force: true })
}

const result = {
  ok: !error && assistantText.includes(startToken) && assistantText.includes(doneToken),
  model,
  effort,
  lineCount,
  firstMessageMs,
  firstAssistantMessageMs,
  firstAssistantTextMs,
  firstStartTokenMs,
  completedMs: completedMs ?? performance.now() - startedAt,
  assistantTextLength: assistantText.length,
  messageTypes: [...new Set(messages.map((message) => message.type))],
  systemSubtypes: [...new Set(messages.filter((message) => message.type === 'system').map((message) => message.subtype).filter(Boolean))],
  streamEventCount: messages.filter((message) => message.type === 'stream_event').length,
  error
}

console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exit(1)
