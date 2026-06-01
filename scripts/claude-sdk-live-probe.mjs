#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod/v4'
import { liveSmokeEffort, liveSmokeModel } from './provider-smoke-config.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const artifactRoot = process.env.CLAUDE_SDK_PROBE_ARTIFACT_DIR
  ? process.env.CLAUDE_SDK_PROBE_ARTIFACT_DIR
  : join(repoRoot, 'tmp', 'claude-sdk-live-probe')
const timeoutMs = Number(process.env.CLAUDE_SDK_PROBE_TIMEOUT_MS ?? 120_000)

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'Usage: npm run live:claude-sdk-probe',
    '',
    'Environment:',
    '  CLAUDE_SDK_PROBE_SCENARIOS=plain,partial,message_input,host_tool,permission_deny,plan,resume,subagent,subagent_resume',
    '  CLAUDE_SDK_PROBE_TIMEOUT_MS=120000',
    '  CLAUDE_SDK_PROBE_ARTIFACT_DIR=tmp/claude-sdk-live-probe',
    '  LIVE_MODEL_CLAUDE=claude-sonnet-4-6',
    '  LIVE_EFFORT_CLAUDE=low'
  ].join('\n'))
  process.exit(0)
}

const selectedScenarioIds = (process.env.CLAUDE_SDK_PROBE_SCENARIOS ?? 'plain,partial,message_input,host_tool,permission_deny,plan,resume,subagent')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

function claudeSettingsEnv() {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(settingsPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    return Object.fromEntries(
      Object.entries(parsed.env ?? {})
        .filter((entry) => typeof entry[1] === 'string')
    )
  } catch {
    return {}
  }
}

function sdkEnv() {
  return {
    ...process.env,
    ...claudeSettingsEnv(),
    CLAUDE_AGENT_SDK_CLIENT_APP: 'orchestrator/claude-sdk-live-probe'
  }
}

function resetArtifacts() {
  rmSync(artifactRoot, { recursive: true, force: true })
  mkdirSync(artifactRoot, { recursive: true })
}

function writeArtifact(name, value) {
  mkdirSync(artifactRoot, { recursive: true })
  writeFileSync(join(artifactRoot, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
}

function makeWorkspace(id) {
  const cwd = join(tmpdir(), `orchestrator-claude-sdk-${id}-${Date.now()}`)
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(cwd, 'README.md'), `# ${id}\n\nDisposable Claude Agent SDK probe workspace.\n`)
  return cwd
}

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      if (block.type === 'text' && typeof block.text === 'string') return block.text
      if (block.type === 'tool_result' && typeof block.content === 'string') return block.content
      if (block.type === 'tool_result' && Array.isArray(block.content)) return textFromContent(block.content)
      return ''
    })
    .join('')
}

function assistantText(messages) {
  return messages
    .filter((message) => message.type === 'assistant')
    .map((message) => textFromContent(message.message?.content))
    .join('')
}

function toolUseNames(messages) {
  const names = []
  for (const message of messages) {
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') names.push(block.name)
    }
  }
  return names
}

function toolResultTexts(messages) {
  const values = []
  for (const message of messages) {
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'tool_result') values.push(textFromContent([block]))
    }
  }
  return values
}

function firstClaudeAgentId(messages) {
  const serialized = JSON.stringify(messages)
  return serialized.match(/\bagentId:\s*([a-f0-9-]+)/iu)?.[1] ?? null
}

function summarizeMessages(messages) {
  const init = messages.find((message) => message.type === 'system' && message.subtype === 'init')
  const result = [...messages].reverse().find((message) => message.type === 'result')
  return {
    messageTypes: [...new Set(messages.map((message) => message.type))],
    systemSubtypes: [...new Set(messages.filter((message) => message.type === 'system').map((message) => message.subtype).filter(Boolean))],
    toolUses: toolUseNames(messages),
    assistantText: assistantText(messages),
    toolResultTexts: toolResultTexts(messages),
    streamEventCount: messages.filter((message) => message.type === 'stream_event').length,
    sessionIds: [...new Set(messages.map((message) => message.session_id).filter(Boolean))],
    init: init ? {
      apiKeySource: init.apiKeySource,
      claudeCodeVersion: init.claude_code_version,
      model: init.model,
      permissionMode: init.permissionMode,
      tools: init.tools,
      mcpServers: init.mcp_servers,
      agents: init.agents,
      skills: init.skills,
      plugins: init.plugins?.map((plugin) => plugin.name)
    } : null,
    result: result ? {
      subtype: result.subtype,
      is_error: result.is_error,
      duration_ms: result.duration_ms,
      duration_api_ms: result.duration_api_ms,
      num_turns: result.num_turns,
      total_cost_usd: result.total_cost_usd,
      stop_reason: result.stop_reason,
      permission_denials: result.permission_denials,
      errors: result.errors
    } : null
  }
}

async function collectQuery(id, prompt, optionsPatch = {}) {
  const cwd = optionsPatch.cwd ?? makeWorkspace(id)
  const abortController = new AbortController()
  const messages = []
  const permissionRequests = []
  const hostToolCalls = []
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, timeoutMs)

  const baseCanUseTool = optionsPatch.canUseTool
  const options = {
    cwd,
    model: liveSmokeModel('claude'),
    effort: liveSmokeEffort('claude'),
    maxTurns: optionsPatch.maxTurns ?? 4,
    includePartialMessages: optionsPatch.includePartialMessages ?? true,
    includeHookEvents: optionsPatch.includeHookEvents ?? true,
    forwardSubagentText: optionsPatch.forwardSubagentText ?? true,
    permissionMode: optionsPatch.permissionMode ?? 'dontAsk',
    env: sdkEnv(),
    abortController,
    ...optionsPatch,
    canUseTool: baseCanUseTool
      ? async (toolName, input, details) => {
          permissionRequests.push({
            toolName,
            input,
            title: details.title,
            displayName: details.displayName,
            description: details.description,
            blockedPath: details.blockedPath,
            decisionReason: details.decisionReason,
            toolUseID: details.toolUseID,
            agentID: details.agentID
          })
          return baseCanUseTool(toolName, input, details)
        }
      : undefined
  }

  if (optionsPatch.hostToolCalls) optionsPatch.hostToolCalls.list = hostToolCalls

  try {
    for await (const message of query({ prompt, options })) messages.push(message)
  } catch (error) {
    return {
      cwd,
      timedOut,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      messages,
      permissionRequests,
      hostToolCalls,
      summary: summarizeMessages(messages)
    }
  } finally {
    clearTimeout(timer)
  }

  return {
    cwd,
    timedOut,
    messages,
    permissionRequests,
    hostToolCalls,
    summary: summarizeMessages(messages)
  }
}

function ok(message, condition) {
  return { ok: Boolean(condition), message }
}

function makeHostToolServer(hostToolCalls) {
  return createSdkMcpServer({
    name: 'orchestrator',
    version: '1.0.0',
    instructions: 'Read-only Orchestrator host tools for SDK parity probing.',
    alwaysLoad: true,
    tools: [
      tool(
        'get_context',
        'Return a fixed Orchestrator probe context marker.',
        { marker: z.string().optional() },
        async (args) => {
          hostToolCalls.push({ name: 'get_context', args })
          return {
            content: [
              {
                type: 'text',
                text: 'ORCHESTRATOR_SDK_HOST_TOOL_OK'
              }
            ]
          }
        },
        { alwaysLoad: true }
      )
    ]
  })
}

const scenarios = {
  async plain() {
    const result = await collectQuery(
      'plain',
      'Reply with exactly: ORCHESTRATOR_SDK_PLAIN_OK',
      { tools: [], persistSession: false, maxTurns: 1 }
    )
    return {
      ...result,
      assertions: [
        ok('assistant emitted expected plain marker', result.summary.assistantText.includes('ORCHESTRATOR_SDK_PLAIN_OK')),
        ok('system init included auth/source metadata', result.summary.init?.apiKeySource),
        ok('result message completed', result.summary.result?.subtype === 'success')
      ]
    }
  },

  async partial() {
    const result = await collectQuery(
      'partial',
      'Reply with exactly: ORCHESTRATOR_SDK_PARTIAL_OK',
      { tools: [], persistSession: false, includePartialMessages: true, maxTurns: 1 }
    )
    return {
      ...result,
      assertions: [
        ok('assistant emitted expected partial marker', result.summary.assistantText.includes('ORCHESTRATOR_SDK_PARTIAL_OK')),
        ok('stream_event messages were emitted', result.summary.streamEventCount > 0)
      ]
    }
  },

  async message_input() {
    async function* prompt() {
      yield {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Reply with exactly: ORCHESTRATOR_SDK_MESSAGE_INPUT_OK' }]
        }
      }
    }
    const result = await collectQuery(
      'message_input',
      prompt(),
      { tools: [], persistSession: false, maxTurns: 1 }
    )
    return {
      ...result,
      assertions: [
        ok('assistant emitted expected message-input marker', result.summary.assistantText.includes('ORCHESTRATOR_SDK_MESSAGE_INPUT_OK')),
        ok('result message completed', result.summary.result?.subtype === 'success')
      ]
    }
  },

  async host_tool() {
    const hostToolCalls = []
    const result = await collectQuery(
      'host_tool',
      [
        'Use the mcp__orchestrator__get_context tool exactly once.',
        'Then reply with exactly ORCHESTRATOR_SDK_HOST_TOOL_DONE and include the tool marker.'
      ].join(' '),
      {
        tools: [],
        mcpServers: { orchestrator: makeHostToolServer(hostToolCalls) },
        allowedTools: ['mcp__orchestrator__get_context'],
        permissionMode: 'default',
        hostToolCalls: { list: hostToolCalls },
        maxTurns: 3
      }
    )
    result.hostToolCalls = hostToolCalls
    return {
      ...result,
      assertions: [
        ok('SDK-local MCP host tool was called', hostToolCalls.length === 1),
        ok('assistant or tool result contains host tool marker', `${result.summary.assistantText}\n${result.summary.toolResultTexts.join('\n')}`.includes('ORCHESTRATOR_SDK_HOST_TOOL_OK')),
        ok('assistant completed host tool turn', result.summary.assistantText.includes('ORCHESTRATOR_SDK_HOST_TOOL_DONE'))
      ]
    }
  },

  async permission_deny() {
    const result = await collectQuery(
      'permission_deny',
      [
        'Use Bash to run: rm -rf /tmp/orchestrator-sdk-permission-deny-target',
        'If the host denies permission, reply with ORCHESTRATOR_SDK_PERMISSION_DENIED_OK.'
      ].join(' '),
      {
        tools: ['Bash'],
        permissionMode: 'default',
        maxTurns: 3,
        canUseTool: async (toolName, _input, details) => {
          if (toolName === 'Bash') {
            return {
              behavior: 'deny',
              message: `Orchestrator SDK probe denied ${details.toolUseID}.`,
              toolUseID: details.toolUseID
            }
          }
          return { behavior: 'allow', toolUseID: details.toolUseID }
        }
      }
    )
    return {
      ...result,
      assertions: [
        ok('canUseTool observed a Bash permission request', result.permissionRequests.some((request) => request.toolName === 'Bash')),
        ok('denial surfaced in result or tool result', JSON.stringify(result.summary.result?.permission_denials ?? result.summary.toolResultTexts).includes('Bash') || result.summary.toolResultTexts.some((text) => /denied/i.test(text))),
        ok('run completed after denial', result.summary.result?.subtype === 'success' || result.summary.result?.subtype === 'error_during_execution')
      ]
    }
  },

  async plan() {
    const result = await collectQuery(
      'plan',
      'In plan mode, do not use tools or create files. Reply with exactly: ORCHESTRATOR_SDK_PLAN_OK',
      { tools: [], permissionMode: 'plan', persistSession: false, maxTurns: 1 }
    )
    return {
      ...result,
      assertions: [
        ok('init used plan permission mode', result.summary.init?.permissionMode === 'plan'),
        ok('assistant emitted plan marker', result.summary.assistantText.includes('ORCHESTRATOR_SDK_PLAN_OK')),
        ok('result message completed', result.summary.result?.subtype === 'success')
      ]
    }
  },

  async resume() {
    const cwd = makeWorkspace('resume')
    const first = await collectQuery(
      'resume-first',
      'Reply with exactly ORCHESTRATOR_SDK_RESUME_FIRST_OK.',
      { cwd, tools: [], maxTurns: 1 }
    )
    const sessionId = first.summary.sessionIds[0]
    if (!sessionId) {
      return {
        cwd,
        messages: first.messages,
        permissionRequests: first.permissionRequests,
        hostToolCalls: [],
        summary: first.summary,
        firstSummary: first.summary,
        assertions: [ok('first SDK resume turn returned a session id', false)]
      }
    }
    const second = await collectQuery(
      'resume-second',
      'Continue the session and reply with exactly ORCHESTRATOR_SDK_RESUME_SECOND_OK.',
      { cwd, tools: [], maxTurns: 1, resume: sessionId }
    )
    return {
      cwd,
      messages: [...first.messages, ...second.messages],
      permissionRequests: [...first.permissionRequests, ...second.permissionRequests],
      hostToolCalls: [],
      summary: second.summary,
      firstSummary: first.summary,
      resumedSessionId: sessionId,
      assertions: [
        ok('first SDK resume turn returned a session id', sessionId),
        ok('first turn completed', first.summary.assistantText.includes('ORCHESTRATOR_SDK_RESUME_FIRST_OK')),
        ok('resume turn completed', second.summary.assistantText.includes('ORCHESTRATOR_SDK_RESUME_SECOND_OK'))
      ]
    }
  },

  async subagent() {
    const result = await collectQuery(
      'subagent',
      [
        'Use the Agent tool with the orchestrator-probe-agent subagent to answer this.',
        'The subagent should reply with ORCHESTRATOR_SDK_SUBAGENT_CHILD_OK.',
        'Then the main assistant should reply with ORCHESTRATOR_SDK_SUBAGENT_PARENT_OK.'
      ].join(' '),
      {
        tools: { type: 'preset', preset: 'claude_code' },
        allowedTools: ['Agent'],
        agents: {
          'orchestrator-probe-agent': {
            description: 'Returns one fixed marker for Orchestrator SDK parity probing.',
            prompt: 'Reply with exactly ORCHESTRATOR_SDK_SUBAGENT_CHILD_OK. Do not use tools.',
            tools: []
          }
        },
        permissionMode: 'default',
        maxTurns: 4,
        canUseTool: async (toolName, _input, details) => {
          if (toolName === 'Agent') return { behavior: 'allow', toolUseID: details.toolUseID }
          return {
            behavior: 'deny',
            message: `Only Agent is allowed in this subagent probe; denied ${toolName}.`,
            toolUseID: details.toolUseID
          }
        }
      }
    )
    const serialized = JSON.stringify(result.messages)
    return {
      ...result,
      assertions: [
        ok('Agent tool was used or task lifecycle was emitted', result.summary.toolUses.includes('Agent') || result.summary.systemSubtypes.some((subtype) => /^task_/.test(subtype))),
        ok('subagent child text was forwarded or persisted into stream', serialized.includes('ORCHESTRATOR_SDK_SUBAGENT_CHILD_OK')),
        ok('main assistant emitted parent marker', result.summary.assistantText.includes('ORCHESTRATOR_SDK_SUBAGENT_PARENT_OK'))
      ]
    }
  },

  async subagent_resume() {
    const cwd = makeWorkspace('subagent-resume')
    const agentTeamEnv = {
      ...sdkEnv(),
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1'
    }
    const first = await collectQuery(
      'subagent-resume-first',
      [
        'Use the Agent tool with the orchestrator-resume-probe-agent subagent to answer this.',
        'The subagent should reply with ORCHESTRATOR_SDK_SUBAGENT_RESUME_CHILD_READY.',
        'Then the main assistant should reply with ORCHESTRATOR_SDK_SUBAGENT_RESUME_PARENT_READY.'
      ].join(' '),
      {
        cwd,
        env: agentTeamEnv,
        tools: { type: 'preset', preset: 'claude_code' },
        allowedTools: ['Agent'],
        agents: {
          'orchestrator-resume-probe-agent': {
            description: 'Returns fixed markers for Orchestrator SDK subagent resume probing.',
            prompt: 'Follow the latest instruction you receive. Do not use tools.',
            tools: []
          }
        },
        permissionMode: 'default',
        maxTurns: 4,
        canUseTool: async (toolName, _input, details) => {
          if (toolName === 'Agent') return { behavior: 'allow', toolUseID: details.toolUseID }
          return {
            behavior: 'deny',
            message: `Only Agent is allowed in this first subagent resume probe; denied ${toolName}.`,
            toolUseID: details.toolUseID
          }
        }
      }
    )
    const sessionId = first.summary.sessionIds[0]
    const agentId = firstClaudeAgentId(first.messages)
    if (!sessionId || !agentId) {
      return {
        cwd,
        messages: first.messages,
        permissionRequests: first.permissionRequests,
        hostToolCalls: [],
        summary: first.summary,
        firstSummary: first.summary,
        resumedSessionId: sessionId,
        agentId,
        assertions: [
          ok('first subagent resume turn returned a session id', sessionId),
          ok('first subagent resume turn emitted an agent id', agentId)
        ]
      }
    }

    const resumed = await collectQuery(
      'subagent-resume-second',
      [
        `Continue the existing Claude subagent with agent id ${agentId}.`,
        `Use the SendMessage tool with the "to" field set to "${agentId}". Do not start a new Agent or Task invocation for this request.`,
        'Forward the following user instruction to that subagent and return the subagent response:',
        '',
        'Reply with exactly ORCHESTRATOR_SDK_SUBAGENT_RESUME_CONTINUED_OK.'
      ].join('\n'),
      {
        cwd,
        env: agentTeamEnv,
        tools: { type: 'preset', preset: 'claude_code' },
        allowedTools: ['SendMessage'],
        resume: sessionId,
        permissionMode: 'default',
        maxTurns: 4,
        canUseTool: async (toolName, input, details) => {
          if (toolName === 'SendMessage') {
            const target = input && typeof input === 'object' ? input.to : undefined
            if (target === agentId) return { behavior: 'allow', toolUseID: details.toolUseID }
            return {
              behavior: 'deny',
              message: `SendMessage target mismatch: expected ${agentId}, got ${String(target)}`,
              toolUseID: details.toolUseID
            }
          }
          return {
            behavior: 'deny',
            message: `Only SendMessage is allowed in this resumed subagent probe; denied ${toolName}.`,
            toolUseID: details.toolUseID
          }
        }
      }
    )

    const serialized = JSON.stringify([...first.messages, ...resumed.messages])
    return {
      cwd,
      messages: [...first.messages, ...resumed.messages],
      permissionRequests: [...first.permissionRequests, ...resumed.permissionRequests],
      hostToolCalls: [],
      summary: resumed.summary,
      firstSummary: first.summary,
      resumedSessionId: sessionId,
      agentId,
      assertions: [
        ok('first subagent resume turn returned a session id', sessionId),
        ok('first subagent resume turn emitted an agent id', agentId),
        ok('first turn completed child marker', serialized.includes('ORCHESTRATOR_SDK_SUBAGENT_RESUME_CHILD_READY')),
        ok('resumed turn used SendMessage', resumed.summary.toolUses.includes('SendMessage')),
        ok('resumed turn returned continued subagent marker', serialized.includes('ORCHESTRATOR_SDK_SUBAGENT_RESUME_CONTINUED_OK'))
      ]
    }
  }
}

resetArtifacts()
const results = []
console.log(`Running Claude Agent SDK probe scenarios: ${selectedScenarioIds.join(', ')}`)
console.log(`Artifacts: ${artifactRoot}`)
console.log(`Model: ${liveSmokeModel('claude') || 'sdk default'}; effort: ${liveSmokeEffort('claude')}`)

for (const id of selectedScenarioIds) {
  const scenario = scenarios[id]
  if (!scenario) {
    results.push({ id, ok: false, reason: 'unknown scenario', assertions: [ok('scenario exists', false)] })
    continue
  }
  try {
    const result = await scenario()
    const assertions = result.assertions ?? []
    const failures = assertions.filter((assertion) => !assertion.ok)
    const okResult = failures.length === 0 && !result.timedOut
      const publicResult = {
      id,
      ok: okResult,
      reason: okResult ? 'passed' : failures.map((failure) => failure.message).join('; ') || 'timed out',
      assertions,
      permissionRequests: result.permissionRequests,
      hostToolCalls: result.hostToolCalls,
      summary: result.summary,
      error: result.error,
      errorStack: result.errorStack,
      firstSummary: result.firstSummary,
      resumedSessionId: result.resumedSessionId,
      agentId: result.agentId,
      rawMessages: result.messages
    }
    writeArtifact(`${id}.json`, publicResult)
    results.push(publicResult)
    console.log(`${okResult ? 'PASS' : 'FAIL'} ${id}: ${publicResult.reason}`)
    console.log(`  events: ${publicResult.summary?.messageTypes?.join(', ') || 'none'}`)
    if (publicResult.summary?.assistantText) console.log(`  assistant: ${publicResult.summary.assistantText.slice(0, 180).replace(/\s+/g, ' ')}`)
  } catch (error) {
    const failed = {
      id,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }
    writeArtifact(`${id}.json`, failed)
    results.push(failed)
    console.log(`FAIL ${id}: ${failed.reason}`)
  }
}

const summary = {
  ok: results.every((result) => result.ok),
  model: liveSmokeModel('claude') || null,
  effort: liveSmokeEffort('claude'),
  sdkPackage: '@anthropic-ai/claude-agent-sdk',
  envSources: {
    processHasAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    claudeSettingsEnvKeys: Object.keys(claudeSettingsEnv()).sort()
  },
  results: results.map((result) => ({
    id: result.id,
    ok: result.ok,
    reason: result.reason,
    init: result.summary?.init ?? null,
    result: result.summary?.result ?? null,
    messageTypes: result.summary?.messageTypes ?? [],
    systemSubtypes: result.summary?.systemSubtypes ?? [],
    toolUses: result.summary?.toolUses ?? [],
    streamEventCount: result.summary?.streamEventCount ?? 0,
    permissionRequestCount: result.permissionRequests?.length ?? 0,
    hostToolCallCount: result.hostToolCalls?.length ?? 0
  }))
}
writeArtifact('result.json', summary)

const failures = results.filter((result) => !result.ok)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures) console.log(`  - ${failure.id}: ${failure.reason}`)
  process.exit(1)
}

console.log('\nClaude Agent SDK probe passed.')
