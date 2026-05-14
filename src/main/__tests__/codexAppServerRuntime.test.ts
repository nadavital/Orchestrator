import test from 'node:test'
import assert from 'node:assert/strict'
import type { SpawnOptionsWithoutStdio } from 'child_process'
import type { RunEvent, Session } from '../../types'
import { CodexAppServerRuntimeManager, type CodexAppServerSpawn } from '../codexAppServerRuntime'
import { PROVIDERS } from '../providers'

class FakePipe {
  dataHandlers: Array<(chunk: Buffer) => void> = []

  on(event: 'data', handler: (chunk: Buffer) => void): void {
    if (event === 'data') this.dataHandlers.push(handler)
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(Buffer.from(data, 'utf8'))
  }
}

class FakeStdin {
  writes: string[] = []
  ended = false

  write(data: string): void {
    this.writes.push(data)
  }

  end(): void {
    this.ended = true
  }
}

class FakeAppServerProcess {
  stdin = new FakeStdin()
  stdout = new FakePipe()
  stderr = new FakePipe()
  exitHandlers: Array<() => void> = []
  kills: Array<NodeJS.Signals | number | undefined> = []

  on(event: 'exit', handler: () => void): void {
    if (event === 'exit') this.exitHandlers.push(handler)
  }

  kill(signal?: NodeJS.Signals | number): void {
    this.kills.push(signal)
  }

  emitStdout(obj: unknown): void {
    this.stdout.emitData(`${JSON.stringify(obj)}\n`)
  }

  emitExit(): void {
    for (const handler of this.exitHandlers) handler()
  }
}

const session: Session = {
  id: 'codex-session-1',
  name: 'Codex app-server',
  projectId: 'project-1',
  workDir: process.cwd(),
  useWorktree: false,
  providerSessionId: null,
  status: 'running',
  messages: [],
  createdAt: Date.now(),
  provider: 'codex',
  model: 'gpt-5.4',
  effort: 'high',
  permissionMode: 'default',
  allowedTools: [],
  runtime: 'app-server'
}

const provider = {
  ...PROVIDERS.codex,
  binary: process.execPath,
  binaryCandidates: [process.execPath]
}

function writtenJson(fake: FakeAppServerProcess): Array<Record<string, unknown>> {
  return fake.stdin.writes
    .flatMap((write) => write.trim().split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('codex app-server runtime starts a thread, starts a turn, and answers native requests', () => {
  let fake: FakeAppServerProcess | null = null
  const spawn: CodexAppServerSpawn = (binary: string, args: string[], options: SpawnOptionsWithoutStdio) => {
    assert.equal(binary, process.execPath)
    assert.deepEqual(args, ['app-server', '--listen', 'stdio://'])
    assert.equal(options.cwd, process.cwd())
    fake = new FakeAppServerProcess()
    return fake
  }
  const manager = new CodexAppServerRuntimeManager(spawn)
  const raw: string[] = []
  const events: RunEvent[] = []
  let exited = false

  const result = manager.start({
    sessionId: session.id,
    session,
    provider,
    request: {
      prompt: 'hello codex',
      cwd: process.cwd(),
      model: 'gpt-5.4',
      effort: 'high',
      providerSessionId: null,
      executionPolicy: 'default',
      allowedTools: [],
      runtime: 'app-server'
    },
    mode: 'start',
    onRawData: (data) => raw.push(data),
    onParsedEvents: (parsed) => events.push(...parsed),
    onExit: () => { exited = true }
  })

  assert.equal(result.ok, true)
  assert.equal(manager.has(session.id), true)
  assert.ok(fake)
  const proc = fake as FakeAppServerProcess

  let writes = writtenJson(proc)
  assert.equal(writes[0].method, 'initialize')
  proc.emitStdout({ id: writes[0].id, result: { protocolVersion: 'v2' } })

  writes = writtenJson(proc)
  assert.equal(writes[1].method, 'initialized')
  assert.equal(writes[2].method, 'thread/start')
  assert.equal((writes[2].params as Record<string, unknown>).approvalPolicy, 'on-request')
  assert.equal((writes[2].params as Record<string, unknown>).sandbox, 'workspace-write')

  proc.emitStdout({
    id: writes[2].id,
    result: { thread: { id: 'thread-1' }, model: 'gpt-5.4', cwd: process.cwd() }
  })
  writes = writtenJson(proc)
  assert.equal(writes[3].method, 'turn/start')
  assert.equal((writes[3].params as Record<string, unknown>).threadId, 'thread-1')
  assert.deepEqual((writes[3].params as { input: unknown[] }).input[0], {
    type: 'text',
    text: 'hello codex',
    text_elements: []
  })

  proc.emitStdout({ id: writes[3].id, result: { turn: { id: 'turn-1' } } })
  proc.emitStdout({
    jsonrpc: '2.0',
    id: 'approval-1',
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'cmd-1',
      command: 'touch appserver-ok',
      cwd: process.cwd()
    }
  })

  assert.equal(events.some((event) => event.type === 'session.started' && event.providerSessionId === 'thread-1'), true)
  const permission = events.find((event) => event.type === 'permission.requested')
  assert.equal(permission?.type, 'permission.requested')
  assert.equal(permission?.denials[0]?.tool_input.command, 'touch appserver-ok')
  assert.equal(manager.resolvePermission(session.id, true, false), true)

  writes = writtenJson(proc)
  assert.deepEqual(writes[writes.length - 1], {
    id: 'approval-1',
    result: { decision: 'accept' }
  })

  proc.emitStdout({
    jsonrpc: '2.0',
    id: 'question-1',
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'question-item',
      questions: [{ id: 'target', question: 'Pick target?', options: [{ label: 'staging' }] }]
    }
  })
  assert.equal(manager.answerUserInput(session.id, 'staging'), true)
  writes = writtenJson(proc)
  assert.deepEqual(writes[writes.length - 1], {
    id: 'question-1',
    result: { answers: { target: { answers: ['staging'] } } }
  })

  proc.emitStdout({
    jsonrpc: '2.0',
    id: 'legacy-approval-1',
    method: 'execCommandApproval',
    params: {
      conversationId: 'thread-1',
      callId: 'legacy-cmd-1',
      approvalId: 'legacy-approval-id',
      command: ['git', 'status'],
      cwd: process.cwd(),
      reason: null,
      parsedCmd: []
    }
  })
  assert.equal(manager.resolvePermission(session.id, true, true), true)
  writes = writtenJson(proc)
  assert.deepEqual(writes[writes.length - 1], {
    id: 'legacy-approval-1',
    result: { decision: 'approved_for_session' }
  })

  proc.emitStdout({
    jsonrpc: '2.0',
    id: 'dynamic-tool-1',
    method: 'item/tool/call',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: null,
      tool: 'unsupported_tool',
      arguments: {}
    }
  })
  writes = writtenJson(proc)
  assert.equal(writes[writes.length - 1].id, 'dynamic-tool-1')
  assert.deepEqual(writes[writes.length - 1].error, {
    code: -32601,
    message: 'Orchestrator does not provide client-side dynamic tools yet.'
  })

  proc.emitStdout({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'hi' } })
  proc.emitStdout({ jsonrpc: '2.0', method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'msg-1', text: 'hi', phase: null, memoryCitation: null } } })
  proc.emitStdout({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })

  assert.equal(events.some((event) => event.type === 'assistant.text.delta' && event.content === 'hi'), true)
  assert.equal(events.some((event) => event.type === 'assistant.text' && event.content === 'hi'), false)
  assert.equal(events.some((event) => event.type === 'assistant.text.completed' && event.streamId === 'msg-1'), true)
  assert.equal(events.some((event) => event.type === 'run.completed'), true)

  proc.emitExit()
  assert.equal(exited, true)
  assert.equal(manager.has(session.id), false)
})
