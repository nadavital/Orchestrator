import test from 'node:test'
import assert from 'node:assert/strict'
import type { RunRequest, Session } from '../../types'
import { copilotSdkMessageOptions, copilotSdkSessionConfig, normalizeCopilotSdkEvent } from '../copilotSdkRuntime'

function request(patch: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: 'Please inspect the repo.',
    cwd: '/tmp/project',
    model: 'gpt-5.5',
    effort: 'medium',
    providerSessionId: null,
    executionPolicy: 'default',
    allowedTools: [],
    ...patch
  }
}

function session(patch: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Copilot SDK',
    projectId: 'project-1',
    useWorktree: false,
    providerSessionId: null,
    messages: [],
    status: 'idle',
    createdAt: 1,
    provider: 'copilot',
    model: 'gpt-5.5',
    effort: 'medium',
    permissionMode: 'default',
    allowedTools: [],
    workDir: '/tmp/project',
    ...patch
  }
}

test('copilot sdk config uses subscription auth by default and yolo only for explicit bypass', () => {
  const approveAll = () => ({ kind: 'approved' as const })
  const sdk = { approveAll } as unknown as typeof import('@github/copilot-sdk')
  const normal = copilotSdkSessionConfig(sdk, request(), session())
  assert.equal(normal.workingDirectory, '/tmp/project')
  assert.equal(normal.streaming, true)
  assert.equal(normal.enableConfigDiscovery, true)
  assert.equal(normal.onPermissionRequest, undefined)

  const bypass = copilotSdkSessionConfig(sdk, request({ executionPolicy: 'yolo' }), session())
  assert.equal(bypass.onPermissionRequest, approveAll)
})

test('copilot sdk config can opt into BYOK provider settings from the run request', () => {
  const previous = process.env.COPILOT_SDK_TEST_KEY
  process.env.COPILOT_SDK_TEST_KEY = 'test-secret'
  try {
    const sdk = { approveAll: () => ({ kind: 'approved' as const }) } as unknown as typeof import('@github/copilot-sdk')
    const config = copilotSdkSessionConfig(sdk, request({
      copilotByokProvider: {
        enabled: true,
        type: 'openai',
        baseUrl: 'https://llm.example.test/v1',
        apiKeyEnvKey: 'COPILOT_SDK_TEST_KEY'
      }
    }), session()) as import('@github/copilot-sdk').SessionConfig & {
      provider?: { type: string; baseUrl: string; apiKey?: string }
    }
    assert.deepEqual(config.provider, {
      type: 'openai',
      baseUrl: 'https://llm.example.test/v1',
      apiKey: 'test-secret'
    })
  } finally {
    if (previous === undefined) delete process.env.COPILOT_SDK_TEST_KEY
    else process.env.COPILOT_SDK_TEST_KEY = previous
  }
})

test('copilot sdk message options map local file attachments', () => {
  const options = copilotSdkMessageOptions(request({
    attachments: [{ id: 'a1', kind: 'local_file', path: '/tmp/project/README.md', name: 'README.md' }]
  }))
  assert.equal(options.prompt, 'Please inspect the repo.')
  assert.deepEqual(options.attachments, [{ type: 'file', path: '/tmp/project/README.md', displayName: 'README.md' }])
})

test('copilot sdk events normalize core thread, text, tools, prompts, usage, and subagents', () => {
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-1',
      parentId: null,
      timestamp: '2026-06-02T00:00:00.000Z',
      ephemeral: true,
      data: { messageId: 'message-1', deltaContent: 'hello' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1'),
    [{ type: 'assistant.text.delta', streamId: 'message-1', content: 'hello' }]
  )

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'tool.execution_start',
      id: 'event-2',
      parentId: 'event-1',
      timestamp: '2026-06-02T00:00:01.000Z',
      data: { toolCallId: 'tool-1', toolName: 'read_file', arguments: { path: 'README.md' } }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1'),
    [{ type: 'tool.started', id: 'tool-1', toolName: 'read_file', toolInput: { path: 'README.md' } }]
  )

  const permission = normalizeCopilotSdkEvent({
    type: 'permission.requested',
    id: 'event-3',
    parentId: 'event-2',
    timestamp: '2026-06-02T00:00:02.000Z',
    data: {
      requestId: 'perm-1',
      permissionRequest: { kind: 'shell', fullCommandText: 'git status', intention: 'inspect repo', canOfferSessionApproval: true, commands: [], hasWriteFileRedirection: false, possiblePaths: [], possibleUrls: [] }
    }
  } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1')
  assert.equal(permission[0]?.type, 'permission.requested')
  assert.deepEqual(permission[0]?.type === 'permission.requested' ? permission[0].denials[0] : undefined, {
    tool_name: 'git status',
    tool_use_id: 'perm-1',
    tool_input: { kind: 'shell', fullCommandText: 'git status', intention: 'inspect repo', canOfferSessionApproval: true, commands: [], hasWriteFileRedirection: false, possiblePaths: [], possibleUrls: [] }
  })

  const question = normalizeCopilotSdkEvent({
    type: 'user_input.requested',
    id: 'event-4',
    parentId: 'event-3',
    timestamp: '2026-06-02T00:00:03.000Z',
    ephemeral: true,
    data: { requestId: 'input-1', question: 'Which branch?', choices: ['main'], allowFreeform: true }
  } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1')
  assert.equal(question[0]?.type, 'user_input.requested')
  assert.equal(question[0]?.type === 'user_input.requested' ? question[0].questions?.[0]?.options?.[0]?.label : undefined, 'main')

  const subagent = normalizeCopilotSdkEvent({
    type: 'subagent.started',
    id: 'event-5',
    agentId: 'agent-1',
    parentId: 'event-4',
    timestamp: '2026-06-02T00:00:04.000Z',
    data: { toolCallId: 'tool-agent-1', agentName: 'reviewer', agentDisplayName: 'Reviewer', agentDescription: 'Review changes' }
  } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1')
  assert.equal(subagent[0]?.type, 'agent.started')
  assert.equal(subagent[0]?.type === 'agent.started' ? subagent[0].agent.providerAgentId : undefined, 'agent-1')

  const pendingUsage = {}
  const usage = normalizeCopilotSdkEvent({
    type: 'assistant.usage',
    id: 'event-6',
    parentId: 'event-5',
    timestamp: '2026-06-02T00:00:05.000Z',
    ephemeral: true,
    data: { model: 'gpt-5.5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cost: 0.01, duration: 250 }
  } as unknown as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { pendingUsage })
  assert.deepEqual(usage, [])

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'session.idle',
      id: 'event-7',
      parentId: 'event-6',
      timestamp: '2026-06-02T00:00:06.000Z',
      data: {}
    } as unknown as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { pendingUsage }),
    [{ type: 'run.completed', usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 2, totalTokens: 17, totalCostUsd: 0.01, durationMs: 250 } }]
  )
})

test('copilot sdk final assistant message completes an existing stream', () => {
  const streamedMessageIds = new Set<string>()
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-7',
      parentId: null,
      timestamp: '2026-06-02T00:00:06.000Z',
      ephemeral: true,
      data: { messageId: 'message-2', deltaContent: 'Hello! I am GitHubCopilot CLI.Howcan' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds }),
    [{ type: 'assistant.text.delta', streamId: 'message-2', content: 'Hello! I am GitHub Copilot. How can' }]
  )

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message',
      id: 'event-8',
      parentId: 'event-7',
      timestamp: '2026-06-02T00:00:07.000Z',
      data: {
        messageId: 'message-2',
        content: 'Hello! I am GitHubCopilot CLI.Howcan I help?',
        toolRequests: [
          { toolCallId: 'tool-2', name: 'read_file', arguments: { path: 'README.md' } }
        ]
      }
    } as unknown as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds }),
    [
      { type: 'assistant.text.completed', streamId: 'message-2', content: 'Hello! I am GitHub Copilot. How can I help?' },
      { type: 'tool.started', id: 'tool-2', toolName: 'read_file', toolInput: { path: 'README.md' } }
    ]
  )
  assert.equal(streamedMessageIds.has('message-2'), false)
})

test('copilot sdk streaming normalizes accumulated partial chunks', () => {
  const streamedMessageIds = new Set<string>()
  const streamBuffers = new Map()
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-9',
      parentId: null,
      timestamp: '2026-06-02T00:00:08.000Z',
      ephemeral: true,
      data: { messageId: 'message-3', deltaContent: 'GitHubCop' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, streamBuffers }),
    [{ type: 'assistant.text.delta', streamId: 'message-3', content: 'GitHubCop' }]
  )
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-10',
      parentId: 'event-9',
      timestamp: '2026-06-02T00:00:09.000Z',
      ephemeral: true,
      data: { messageId: 'message-3', deltaContent: 'ilot CLI.' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, streamBuffers }),
    [{ type: 'assistant.text.delta', streamId: 'message-3', content: 'GitHub Copilot.', replace: true }]
  )
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-11',
      parentId: 'event-10',
      timestamp: '2026-06-02T00:00:10.000Z',
      ephemeral: true,
      data: { messageId: 'message-3', deltaContent: 'How' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, streamBuffers }),
    [{ type: 'assistant.text.delta', streamId: 'message-3', content: ' How' }]
  )
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-12',
      parentId: 'event-11',
      timestamp: '2026-06-02T00:00:11.000Z',
      ephemeral: true,
      data: { messageId: 'message-3', deltaContent: 'can' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, streamBuffers }),
    [{ type: 'assistant.text.delta', streamId: 'message-3', content: ' can' }]
  )
})

test('copilot sdk usage and task completion do not end a turn before final message', () => {
  const streamedMessageIds = new Set<string>()
  const pendingUsage = {}
  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message_delta',
      id: 'event-9',
      parentId: null,
      timestamp: '2026-06-02T00:00:08.000Z',
      ephemeral: true,
      data: { messageId: 'message-3', deltaContent: 'Hey' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, pendingUsage }),
    [{ type: 'assistant.text.delta', streamId: 'message-3', content: 'Hey' }]
  )

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.usage',
      id: 'event-10',
      parentId: 'event-9',
      timestamp: '2026-06-02T00:00:09.000Z',
      ephemeral: true,
      data: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cost: 0, duration: 0 }
    } as unknown as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, pendingUsage }),
    []
  )

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'session.task_complete',
      id: 'event-11',
      parentId: 'event-10',
      timestamp: '2026-06-02T00:00:10.000Z',
      data: {}
    } as unknown as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, pendingUsage }),
    []
  )

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'assistant.message',
      id: 'event-12',
      parentId: 'event-11',
      timestamp: '2026-06-02T00:00:11.000Z',
      data: { messageId: 'message-3', content: 'Hey! How can I help you today?' }
    } as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, pendingUsage }),
    [{ type: 'assistant.text.completed', streamId: 'message-3', content: 'Hey! How can I help you today?' }]
  )

  assert.deepEqual(
    normalizeCopilotSdkEvent({
      type: 'session.idle',
      id: 'event-13',
      parentId: 'event-12',
      timestamp: '2026-06-02T00:00:12.000Z',
      data: {}
    } as unknown as import('@github/copilot-sdk').SessionEvent, 'copilot-session-1', { streamedMessageIds, pendingUsage }),
    [{ type: 'run.completed', usage: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, totalTokens: 3, totalCostUsd: 0, durationMs: 0 } }]
  )
})
