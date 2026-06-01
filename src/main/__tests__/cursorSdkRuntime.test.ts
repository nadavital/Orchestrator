import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cursorSdkAgentOptions,
  cursorSdkPromptForRequest,
  cursorSdkSendOptions,
  normalizeCursorSdkMessage,
  normalizeCursorSdkResult
} from '../cursorSdkRuntime'
import type { RunEvent, RunRequest, Session } from '../../types'

function request(patch: Partial<RunRequest> = {}): RunRequest {
  return {
    prompt: 'hello',
    cwd: '/tmp/project',
    model: 'auto',
    effort: 'normal',
    providerSessionId: null,
    executionPolicy: 'default',
    allowedTools: [],
    ...patch
  }
}

function session(patch: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'Cursor SDK Test',
    workDir: '/tmp/project',
    useWorktree: false,
    providerSessionId: null,
    provider: 'cursor',
    model: 'auto',
    effort: 'normal',
    permissionMode: 'default',
    allowedTools: [],
    messages: [],
    status: 'idle',
    createdAt: Date.now(),
    ...patch
  }
}

test('cursor sdk prompt stays plain text without image attachments', () => {
  assert.equal(cursorSdkPromptForRequest(request()), 'hello')
})

test('cursor sdk prompt maps local image attachments to SDK user message images', () => {
  assert.deepEqual(cursorSdkPromptForRequest(request({
    attachments: [
      { id: 'doc', kind: 'local_file', path: '/tmp/readme.md', name: 'readme.md' },
      { id: 'image', kind: 'local_file', path: '/tmp/screenshot.png', name: 'screenshot.png' }
    ]
  })), {
    text: 'hello',
    images: [{ url: 'file:///tmp/screenshot.png' }]
  })
})

test('cursor sdk options map model policy cwd and plan mode', () => {
  const opts = cursorSdkAgentOptions(request({
    model: 'auto',
    executionPolicy: 'sandbox'
  }), session({ workDir: '/tmp/work' }))
  assert.deepEqual(opts.model, { id: 'composer-2.5', params: [{ id: 'fast', value: 'true' }] })
  assert.deepEqual(opts.local, {
    cwd: '/tmp/work',
    settingSources: ['project', 'user', 'plugins'],
    sandboxOptions: { enabled: true }
  })

  assert.deepEqual(cursorSdkSendOptions(request({ executionPolicy: 'plan' })).mode, 'plan')
  assert.deepEqual(cursorSdkSendOptions(request({ executionPolicy: 'yolo' })).local, { force: true })
})

test('cursor sdk normalizer maps system assistant tool status task and result messages', () => {
  const events: RunEvent[] = []
  events.push(...normalizeCursorSdkMessage({
    type: 'system',
    subtype: 'init',
    agent_id: 'agent-1',
    run_id: 'run-1',
    tools: ['read', 'Task']
  }))
  events.push(...normalizeCursorSdkMessage({
    type: 'assistant',
    agent_id: 'agent-1',
    run_id: 'run-1',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Working.' },
        { type: 'tool_use', id: 'tool-1', name: 'Task', input: { subagent_type: 'research', prompt: 'Inspect docs' } }
      ]
    }
  }))
  events.push(...normalizeCursorSdkMessage({
    type: 'tool_call',
    agent_id: 'agent-1',
    run_id: 'run-1',
    call_id: 'tool-1',
    name: 'Task',
    status: 'completed',
    args: { subagent_type: 'research', prompt: 'Inspect docs' },
    result: { summary: 'done' }
  }))
  events.push(...normalizeCursorSdkMessage({
    type: 'status',
    agent_id: 'agent-1',
    run_id: 'run-1',
    status: 'RUNNING',
    message: 'Still running'
  }))
  events.push(...normalizeCursorSdkMessage({
    type: 'status',
    agent_id: 'agent-1',
    run_id: 'run-1',
    status: 'ERROR'
  }))
  events.push(...normalizeCursorSdkMessage({
    type: 'task',
    agent_id: 'agent-1',
    run_id: 'run-1',
    status: 'completed',
    text: 'Subagent summary'
  }))
  events.push(...normalizeCursorSdkResult({
    id: 'run-1',
    status: 'finished',
    result: 'CURSOR_DONE',
    durationMs: 123
  }))
  events.push(...normalizeCursorSdkResult({
    id: 'run-2',
    status: 'error',
    durationMs: 456
  }))

  assert.ok(events.some((event) => event.type === 'session.started' && event.providerSessionId === 'agent-1'))
  assert.ok(events.some((event) => event.type === 'assistant.text' && event.content === 'Working.'))
  assert.ok(events.some((event) => event.type === 'tool.started' && event.toolName === 'Task'))
  assert.ok(events.some((event) => event.type === 'agent.started'))
  assert.ok(events.some((event) => event.type === 'tool.completed' && event.toolUseId === 'tool-1'))
  assert.ok(events.some((event) => event.type === 'agent.completed'))
  assert.ok(events.some((event) => event.type === 'assistant.status' && event.content === 'Still running'))
  assert.ok(events.some((event) => event.type === 'run.failed' && event.content?.includes('requires HTTP/2')))
  assert.ok(events.some((event) => event.type === 'run.completed' && event.content === 'CURSOR_DONE' && event.usage?.durationMs === 123))
  assert.ok(events.some((event) => event.type === 'run.failed' && event.usage?.durationMs === 456 && event.content?.includes('requires HTTP/2')))
})
