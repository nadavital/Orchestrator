import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { ProviderCommand, RunEvent, RunRequest, Session } from '../../types'
import { ProviderRuntimeManager, type ProviderRuntimeProcess } from '../providerRuntime'
import {
  clearProviderRuntimeConnections,
  clearProviderRuntimeDebugEvents,
  listProviderRuntimeConnections,
  listProviderRuntimeDebugEvents
} from '../providerRuntimeDiagnostics'
import type { ProviderAdapter } from '../providers'

class FakeProcess implements ProviderRuntimeProcess {
  dataHandlers: Array<(data: string) => void> = []
  exitHandlers: Array<() => void> = []
  writes: string[] = []
  kills: Array<string | undefined> = []

  write(data: string): void {
    this.writes.push(data)
  }

  kill(signal?: string): void {
    this.kills.push(signal)
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler)
  }

  onExit(handler: () => void): void {
    this.exitHandlers.push(handler)
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data)
  }

  emitExit(): void {
    for (const handler of this.exitHandlers) handler()
  }
}

const provider: ProviderAdapter = {
  id: 'fake',
  binary: '/bin/echo',
  capabilities: {
    resume: true,
    streamingJson: true,
    interactiveCli: true,
    interactivePermissions: true,
    allowedTools: true,
    workspaceSandbox: true,
    fullAccessMode: true
  },
  resolveExecutionPolicy(policy) {
    return {
      policy,
      support: 'exact',
      args: [],
      label: policy,
      description: policy
    }
  },
  buildStartCommand(_request: RunRequest): ProviderCommand {
    return { binary: '/bin/echo', args: ['start'] }
  },
  buildResumeCommand(_request: RunRequest): ProviderCommand {
    return { binary: '/bin/echo', args: ['resume'] }
  },
  buildInteractiveCommand(_request: RunRequest): ProviderCommand {
    return { binary: '/bin/echo', args: ['interactive'] }
  },
  parseOutputLine(line: string): RunEvent[] {
    const parsed = JSON.parse(line) as RunEvent
    return [parsed]
  }
}

const session: Session = {
  id: 'session-1',
  name: 'Runtime test',
  projectId: 'project-1',
  workDir: process.cwd(),
  useWorktree: false,
  providerSessionId: null,
  status: 'running',
  messages: [],
  createdAt: Date.now(),
  provider: 'fake',
  model: 'test',
  effort: 'normal',
  permissionMode: 'default',
  allowedTools: []
}

const request: RunRequest = {
  prompt: 'hello',
  cwd: process.cwd(),
  model: 'test',
  effort: 'normal',
  providerSessionId: null,
  executionPolicy: 'default',
  allowedTools: [],
  runtime: 'headless'
}

beforeEach(() => {
  clearProviderRuntimeDebugEvents()
  clearProviderRuntimeConnections()
})

test('provider runtime owns process stdout parsing and cleanup', () => {
  let fakeProcess: FakeProcess | null = null
  const manager = new ProviderRuntimeManager((binary, args, options) => {
    assert.equal(binary, '/bin/echo')
    assert.deepEqual(args, ['start'])
    assert.equal(options.cwd, process.cwd())
    fakeProcess = new FakeProcess()
    return fakeProcess
  })

  const raw: string[] = []
  const events: RunEvent[] = []
  let exited = false

  const result = manager.startRun({
    sessionId: session.id,
    session,
    provider,
    request,
    onRawData: (data) => raw.push(data),
    onParsedEvents: (parsed) => events.push(...parsed),
    onData: () => undefined,
    onExit: () => { exited = true }
  })

  assert.equal(result.ok, true)
  assert.equal(manager.hasActiveRun(session.id), true)
  assert.ok(fakeProcess)
  const spawnedProcess = fakeProcess as FakeProcess

  spawnedProcess.emitData('{"type":"session.started","providerSessionId":"abc"}\n{"type":"assistant.text","content":"')
  spawnedProcess.emitData('hi"}\n')
  spawnedProcess.emitExit()

  assert.deepEqual(raw, [
    '{"type":"session.started","providerSessionId":"abc"}\n{"type":"assistant.text","content":"',
    'hi"}\n'
  ])
  assert.deepEqual(events, [
    { type: 'session.started', providerSessionId: 'abc' },
    { type: 'assistant.text', content: 'hi' }
  ])
  assert.equal(exited, true)
  assert.equal(manager.hasActiveRun(session.id), false)
  assert.equal(
    listProviderRuntimeDebugEvents({ providerId: 'fake' }).some((event) => event.message === 'Started fake headless runtime.'),
    true
  )
  assert.equal(listProviderRuntimeConnections({ providerId: 'fake' }).at(-1)?.status, 'disconnected')
})

test('provider runtime interrupt keeps exit callback wired for queued steering', () => {
  let fakeProcess: FakeProcess | null = null
  const manager = new ProviderRuntimeManager(() => {
    fakeProcess = new FakeProcess()
    return fakeProcess
  })
  let exited = false

  const result = manager.startRun({
    sessionId: session.id,
    session,
    provider,
    request,
    onRawData: () => undefined,
    onParsedEvents: () => undefined,
    onData: () => undefined,
    onExit: () => { exited = true }
  })
  assert.equal(result.ok, true)

  assert.equal(manager.interrupt(session.id), true)
  assert.ok(fakeProcess)
  const spawnedProcess = fakeProcess as FakeProcess
  assert.deepEqual(spawnedProcess.writes, ['\x03'])
  assert.deepEqual(spawnedProcess.kills, ['SIGTERM'])

  spawnedProcess.emitExit()
  assert.equal(exited, true)
  assert.equal(manager.hasActiveRun(session.id), false)
})
