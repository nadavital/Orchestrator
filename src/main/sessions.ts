import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { Session, ChatMessage, ProviderRuntimeKind, RunEvent, RunRequest, SessionStatus } from '../types'
import { PROVIDER_DEFS } from '../types'
import { detectNativeCliPrompt, nativeCliPromptContent, nativeCliPromptSubmitSequence, type NativeCliPromptKind } from '../types/nativeCliPrompts'
import { nativeTerminalControlResponses } from '../types/nativeTerminalControl'
import { parseClaudeTerminalSnapshot, terminalSnapshotToRunEvents, type NativeTerminalStreamState } from '../types/nativeTerminalEvents'
import { gitManager } from './git'
import { getProvider, PROVIDERS, resolveProviderBinary } from './providers'
import type { ProviderAdapter } from './providers'
import { providerRuntime, type ProviderRuntimeProcess } from './providerRuntime'
import { eventsToMessages } from './runEvents'
import { decideRunLifecycle, isPausedOrFailed } from './runLifecycle'
import { settingsStore } from './settings'
import { migrateLegacyUserData } from './userDataMigration'
import { approvalBroker } from './approvalBroker'

interface SessionStore {
  sessions: Session[]
}

migrateLegacyUserData()

const store = new Store<SessionStore>({ defaults: { sessions: [] } })

interface PendingFollowUp {
  id: string
  prompt: string
  mode: 'queued' | 'steer_next'
}

const pendingFollowUps = new Map<string, PendingFollowUp[]>()

const activeToolUseIds = new Map<string, Set<string>>()

const activeNativePrompts = new Map<string, NativeCliPromptKind>()

const nativeTerminalCompletions = new Set<string>()

const nativeTerminalStreamStates = new Map<string, NativeTerminalStreamState>()

function defaultRuntimeForProvider(_providerId: string): ProviderRuntimeKind {
  return 'headless'
}

function normalizeSession(session: Session): Session {
  return {
    ...session,
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null,
    runtime: defaultRuntimeForProvider(session.provider ?? 'claude')
  }
}

function send(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

function requestFromSession(session: Session, prompt: string): RunRequest {
  return {
    prompt,
    cwd: session.workDir,
    model: session.model,
    effort: session.effort,
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null,
    executionPolicy: session.permissionMode ?? 'default',
    allowedTools: session.allowedTools ?? [],
    disallowedTools: session.disallowedTools ?? [],
    availableTools: session.availableTools ?? [],
    additionalDirs: session.additionalDirs ?? [],
    runtime: session.runtime ?? defaultRuntimeForProvider(session.provider ?? 'claude'),
    useThinking: session.useThinking,
    useFast: session.useFast
  }
}

function mergeToolNames(current: string[] | undefined, granted: string[]): string[] {
  return [...new Set([...(current ?? []), ...granted])]
}

function nativePromptEventsForData(
  sessionId: string,
  provider: ProviderAdapter,
  data: string
): RunEvent[] {
  if (activeNativePrompts.has(sessionId)) return []
  const kind = detectNativeCliPrompt(provider.id, data)
  if (!kind) return []

  activeNativePrompts.set(sessionId, kind)
  const prompt = nativeCliPromptContent(kind)
  return [{
    type: 'user_input.requested',
    content: prompt.content,
    questions: prompt.questions
  }]
}

function nativeTerminalEventsForData(
  sessionId: string,
  provider: ProviderAdapter,
  data: string
): RunEvent[] {
  if (provider.id !== 'claude') return []
  if (activeNativePrompts.has(sessionId)) return []
  if (nativeTerminalCompletions.has(sessionId)) return []

  const snapshot = parseClaudeTerminalSnapshot(data)
  const previous = nativeTerminalStreamStates.get(sessionId)
  const streamId = `native-terminal:${sessionId}`
  const result = terminalSnapshotToRunEvents(snapshot, previous, streamId)
  if (result.state) nativeTerminalStreamStates.set(sessionId, result.state)
  if (snapshot.completed && snapshot.assistantText) nativeTerminalCompletions.add(sessionId)
  return result.events
}

function answerNativeTerminalControlRequests(process: ProviderRuntimeProcess, data: string): void {
  for (const response of nativeTerminalControlResponses(data)) {
    try { process.write(response) } catch { /* ignore terminal query races */ }
  }
}

function answerForNativePrompt(sessionId: string, answer: string): string | null {
  const prompt = activeNativePrompts.get(sessionId)
  if (!prompt) return null
  activeNativePrompts.delete(sessionId)

  return nativeCliPromptSubmitSequence(prompt, answer)
}

function appendPendingFollowUp(sessionId: string, followUp: PendingFollowUp): void {
  const current = pendingFollowUps.get(sessionId) ?? []
  pendingFollowUps.set(sessionId, [...current, followUp])
}

function shiftPendingFollowUp(sessionId: string): PendingFollowUp | null {
  const current = pendingFollowUps.get(sessionId)
  if (!current || current.length === 0) return null
  const index = Math.max(0, current.findIndex((item) => item.mode === 'steer_next'))
  const next = current[index]
  const rest = current.filter((_, itemIndex) => itemIndex !== index)
  if (rest.length === 0) pendingFollowUps.delete(sessionId)
  else pendingFollowUps.set(sessionId, rest)
  return next
}

function markPendingFollowUp(sessionId: string, messageId: string, mode: PendingFollowUp['mode']): boolean {
  const current = pendingFollowUps.get(sessionId)
  if (!current) return false
  const index = current.findIndex((item) => item.id === messageId)
  if (index < 0) return false
  current[index] = { ...current[index], mode }
  pendingFollowUps.set(sessionId, current)
  return true
}

function hasSteerableFollowUp(sessionId: string): boolean {
  return Boolean(pendingFollowUps.get(sessionId)?.some((item) => item.mode === 'steer_next'))
}

function hasActiveTool(sessionId: string): boolean {
  return (activeToolUseIds.get(sessionId)?.size ?? 0) > 0
}

function updateToolBoundaryState(sessionId: string, events: RunEvent[]): void {
  const active = new Set(activeToolUseIds.get(sessionId) ?? [])
  for (const event of events) {
    if (event.type === 'tool.started') active.add(event.id)
    if (event.type === 'tool.completed') active.delete(event.toolUseId)
    if (event.type === 'run.completed' || event.type === 'run.failed') active.clear()
  }
  if (active.size === 0) activeToolUseIds.delete(sessionId)
  else activeToolUseIds.set(sessionId, active)
}

function clearRuntimeState(sessionId: string): void {
  pendingFollowUps.delete(sessionId)
  activeToolUseIds.delete(sessionId)
  activeNativePrompts.delete(sessionId)
  nativeTerminalCompletions.delete(sessionId)
  nativeTerminalStreamStates.delete(sessionId)
  providerRuntime.cleanupSession(sessionId)
}

function resetNativeTerminalState(sessionId: string): void {
  nativeTerminalCompletions.delete(sessionId)
  nativeTerminalStreamStates.delete(sessionId)
}

export const sessionManager = {
  list(): Session[] {
    return store.get('sessions', []).map(normalizeSession)
  },

  get(id: string): Session | undefined {
    const session = store.get('sessions', []).find((s) => s.id === id)
    return session ? normalizeSession(session) : undefined
  },

  save(session: Session): void {
    const sessions = store.get('sessions', [])
    const idx = sessions.findIndex((s) => s.id === session.id)
    if (idx >= 0) sessions[idx] = session
    else sessions.push(session)
    store.set('sessions', sessions)
  },

  updateStatus(id: string, status: SessionStatus): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.status = status
      store.set('sessions', sessions)
      send('session:status', { id, status })
    }
  },

  appendMessage(id: string, messages: ChatMessage[]): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.messages.push(...messages)
      store.set('sessions', sessions)
      send('session:messages', { id, messages })
    }
  },

  upsertMessage(id: string, message: ChatMessage): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (!s) return

    const index = s.messages.findIndex((candidate) => candidate.id === message.id)
    if (index >= 0) s.messages[index] = message
    else s.messages.push(message)
    store.set('sessions', sessions)
    send('session:messageUpdated', { id, message })
  },

  async create(opts: {
    projectId: string
    workDir: string
    useWorktree: boolean
    repoRoot?: string
  }): Promise<Session> {
    const id = uuidv4()
    let workDir = opts.workDir

    if (opts.useWorktree && opts.repoRoot) {
      workDir = await gitManager.createWorktree(opts.repoRoot, id)
    }

    const defaultProvider = settingsStore.get('defaultProvider', 'claude') as string
    const providerDef = PROVIDER_DEFS[defaultProvider] ?? PROVIDER_DEFS.claude
    const storedModels = settingsStore.get('defaultModels', {}) as Record<string, string>
    const storedEfforts = settingsStore.get('defaultEfforts', {}) as Record<string, string>
    const defaultModel = storedModels[providerDef.id] ?? providerDef.models[0]?.id ?? ''
    const defaultEffort = storedEfforts[providerDef.id] ?? providerDef.effortLevels[0]?.id ?? 'normal'

    const session: Session = {
      id,
      name: 'New Chat',
      projectId: opts.projectId,
      workDir,
      useWorktree: opts.useWorktree,
      repoRoot: opts.repoRoot,
      providerSessionId: null,
      status: 'idle',
      messages: [],
      createdAt: Date.now(),
      provider: defaultProvider,
      model: defaultModel,
      effort: defaultEffort,
      permissionMode: 'default',
      allowedTools: [],
      disallowedTools: [],
      availableTools: [],
      additionalDirs: [],
      runtime: defaultRuntimeForProvider(defaultProvider)
    }

    this.save(session)
    send('session:created', session)
    return session
  },

  updateName(id: string, name: string): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.name = name
      store.set('sessions', sessions)
      send('session:renamed', { id, name })
    }
  },

  async startProviderRun(
    sessionId: string,
    session: Session,
    provider: ProviderAdapter,
    request: RunRequest,
    mode: 'start' | 'resume' = 'start'
  ): Promise<boolean> {
    const preparedRequest = await providerRuntime.prepareRunRequest(
      sessionId,
      provider,
      request,
      (targetSessionId, events) => {
        this.applyRunEvents(targetSessionId, events)
      }
    )

    let nativePromptBuffer = ''
    const result = providerRuntime.startRun({
      sessionId,
      session,
      provider,
      request: preparedRequest,
      mode,
      onRawData: (data) => {
        send('session:raw', { id: sessionId, data })
      },
      onParsedEvents: (events) => {
        this.applyRunEvents(sessionId, events)
      },
      onData: (data, process) => {
        answerNativeTerminalControlRequests(process, data)
        nativePromptBuffer = `${nativePromptBuffer}${data}`.slice(-5000)
        this.applyRunEvents(sessionId, nativePromptEventsForData(sessionId, provider, nativePromptBuffer))
        this.applyRunEvents(sessionId, nativeTerminalEventsForData(sessionId, provider, nativePromptBuffer))

        if (/\[y\/n\]/i.test(data) || /\[yes\/no\]/i.test(data)) {
          this.updateStatus(sessionId, 'waiting_for_user')
          send('session:needsInput', { id: sessionId })
        }
      },
      onExit: () => {
        activeToolUseIds.delete(sessionId)
        activeNativePrompts.delete(sessionId)
        const followUp = shiftPendingFollowUp(sessionId)
        if (followUp) {
          void this.runQueuedFollowUp(sessionId, followUp)
          return
        }
        if (!isPausedOrFailed(this.get(sessionId)?.status ?? 'idle')) {
          this.updateStatus(sessionId, 'idle')
        }
      }
    })

    if (!result.ok) {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: result.message ?? 'Provider runtime failed to start.',
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return false
    }

    return true
  },

  async sendMessage(sessionId: string, prompt: string, useWorktree?: boolean): Promise<void> {
    const session = this.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (providerRuntime.hasActiveRun(sessionId)) {
      if (session.runtime === 'interactive' && session.status === 'idle') {
        const userMsg: ChatMessage = {
          id: uuidv4(),
          role: 'user',
          type: 'text',
          content: prompt,
          timestamp: Date.now()
        }
        this.appendMessage(sessionId, [userMsg])
        this.updateStatus(sessionId, 'running')
        resetNativeTerminalState(sessionId)
        providerRuntime.write(sessionId, `${prompt}\n`)
      } else {
        const messageId = uuidv4()
        const userMsg: ChatMessage = {
          id: messageId,
          role: 'user',
          type: 'text',
          content: prompt,
          queueState: 'queued',
          timestamp: Date.now()
        }
        this.appendMessage(sessionId, [userMsg])
        appendPendingFollowUp(sessionId, { id: messageId, prompt, mode: 'queued' })
        this.updateStatus(sessionId, 'running')
      }
      return
    }

    // Lazy worktree creation on first message if requested
    if (useWorktree !== undefined && session.messages.length === 0) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((s) => s.id === sessionId)
      if (s) {
        if (useWorktree && s.repoRoot) {
          const worktreePath = await gitManager.createWorktree(s.repoRoot, sessionId)
          s.workDir = worktreePath
          s.useWorktree = true
        } else {
          s.useWorktree = false
        }
        store.set('sessions', sessions)
        send('session:updated', { id: sessionId, workDir: s.workDir, useWorktree: s.useWorktree })
      }
    }

    // Auto-name session from first user message (uniform across all providers)
    const freshSession = this.get(sessionId)
    if (freshSession && freshSession.messages.filter((m) => m.role === 'user').length === 0) {
      const collapsed = prompt.replace(/\s+/g, ' ').trim()
      const autoName = collapsed.length > 60 ? collapsed.slice(0, 60) + '…' : collapsed
      this.updateName(sessionId, autoName)
    }

    this.updateStatus(sessionId, 'running')
    resetNativeTerminalState(sessionId)

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      type: 'text',
      content: prompt,
      timestamp: Date.now()
    }
    this.appendMessage(sessionId, [userMsg])

    const currentSession = this.get(sessionId)!
    const provider = getProvider(currentSession.provider ?? 'claude')
    let runRequest = requestFromSession(currentSession, prompt)
    await this.startProviderRun(sessionId, currentSession, provider, runRequest)
  },

  applyRunEvents(sessionId: string, events: RunEvent[]): void {
    if (events.length === 0) return

    send('session:events', {
      id: sessionId,
      events: events.map((event) => ({
        id: uuidv4(),
        timestamp: Date.now(),
        event
      }))
    })

    const currentSession = this.get(sessionId)
    const decision = decideRunLifecycle(currentSession, events)

    if (decision.providerSessionId) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((s) => s.id === sessionId)
      if (s) {
        s.providerSessionId = decision.providerSessionId
        s.claudeSessionId = decision.claudeSessionId ?? decision.providerSessionId
        store.set('sessions', sessions)
      }
    }

    if (decision.shouldKillPty) {
      providerRuntime.stop(sessionId)
    }

    if (decision.systemMessages.length > 0) this.appendMessage(sessionId, decision.systemMessages)
    if (decision.status) this.updateStatus(sessionId, decision.status)

    updateToolBoundaryState(sessionId, events)

    for (const event of events) {
      if (event.type === 'assistant.text.delta') {
        const existing = this.get(sessionId)?.messages.find((message) => message.id === event.streamId && message.type === 'text')
        this.upsertMessage(sessionId, {
          id: event.streamId,
          role: 'assistant',
          type: 'text',
          content: `${existing?.type === 'text' ? existing.content : ''}${event.content}`,
          timestamp: existing?.timestamp ?? Date.now(),
          isStreaming: true
        })
      } else if (event.type === 'assistant.text.completed') {
        const existing = this.get(sessionId)?.messages.find((message) => message.id === event.streamId && message.type === 'text')
        if (existing?.type === 'text') {
          this.upsertMessage(sessionId, { ...existing, isStreaming: false })
        }
      }
    }

    const messages = eventsToMessages(events)
    if (messages.length > 0) this.appendMessage(sessionId, messages)

    if (hasSteerableFollowUp(sessionId) && !hasActiveTool(sessionId)) {
      providerRuntime.interrupt(sessionId)
    }
  },

  updateSettings(id: string, patch: {
    provider?: string
    model?: string
    effort?: string
    permissionMode?: string
    useThinking?: boolean
    useFast?: boolean
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
  }): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      const normalizedPatch: typeof patch & { runtime?: ProviderRuntimeKind } = { ...patch }
      if (patch.provider) {
        normalizedPatch.runtime = defaultRuntimeForProvider(patch.provider)
      }
      Object.assign(s, normalizedPatch)
      store.set('sessions', sessions)
      send('session:settingsUpdated', { id, ...normalizedPatch })
    }
  },

  stop(sessionId: string): void {
    if (providerRuntime.hasActiveRun(sessionId)) {
      for (const message of this.get(sessionId)?.messages ?? []) {
        if (message.type === 'text' && message.queueState) {
          this.upsertMessage(sessionId, { ...message, queueState: undefined })
        }
      }
      clearRuntimeState(sessionId)
      providerRuntime.stop(sessionId)
      this.updateStatus(sessionId, 'idle')
    }
  },

  steerQueuedMessage(sessionId: string, messageId: string): void {
    if (!markPendingFollowUp(sessionId, messageId, 'steer_next')) return
    const existing = this.get(sessionId)?.messages.find((message) => message.id === messageId && message.type === 'text')
    if (existing?.type === 'text') {
      this.upsertMessage(sessionId, { ...existing, queueState: 'steer_next' })
    }

    if (providerRuntime.hasActiveRun(sessionId) && !hasActiveTool(sessionId)) providerRuntime.interrupt(sessionId)
  },

  async runQueuedFollowUp(sessionId: string, followUp: PendingFollowUp): Promise<void> {
    const session = this.get(sessionId)
    if (!session) return

    const queuedMessage = session.messages.find((message) => message.id === followUp.id && message.type === 'text')
    if (queuedMessage?.type === 'text') {
      this.upsertMessage(sessionId, { ...queuedMessage, queueState: undefined })
    }

    this.updateStatus(sessionId, 'running')
    resetNativeTerminalState(sessionId)

    const provider = getProvider(session.provider ?? 'claude')
    const mode = session.providerSessionId ? 'resume' : 'start'
    let runRequest: RunRequest = {
      ...requestFromSession(session, followUp.prompt),
      runtime: session.runtime
    }
    await this.startProviderRun(sessionId, session, provider, runRequest, mode)
  },

  async grantAndResume(sessionId: string, toolNames: string[]): Promise<void> {
    await this.resumeAfterPermission(sessionId, toolNames, true)
  },

  async allowOnceAndResume(sessionId: string, toolNames: string[]): Promise<void> {
    await this.resumeAfterPermission(sessionId, toolNames, false)
  },

  async resumeAfterPermission(sessionId: string, toolNames: string[], persistGrant: boolean): Promise<void> {
    const session = this.get(sessionId)
    if (!session) return

    if (approvalBroker.hasPendingApproval(sessionId)) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((candidate) => candidate.id === sessionId)
      if (s && persistGrant) {
        s.allowedTools = mergeToolNames(s.allowedTools, toolNames)
        store.set('sessions', sessions)
      }
      approvalBroker.resolveSessionApproval(sessionId, true)
      this.updateStatus(sessionId, 'running')
      return
    }

    if (!session.providerSessionId) return
    if (providerRuntime.hasActiveRun(sessionId)) providerRuntime.stop(sessionId)

    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === sessionId)
    if (s && persistGrant) {
      s.allowedTools = mergeToolNames(s.allowedTools, toolNames)
      store.set('sessions', sessions)
    }

    this.updateStatus(sessionId, 'running')
    resetNativeTerminalState(sessionId)

    const currentSession = this.get(sessionId)!
    const resumeProvider = getProvider(currentSession.provider ?? 'claude')
    let runRequest: RunRequest = {
      ...requestFromSession(currentSession, 'Permission granted. Please continue.'),
      allowedTools: persistGrant
        ? (currentSession.allowedTools ?? [])
        : mergeToolNames(currentSession.allowedTools, toolNames),
      runtime: currentSession.runtime
    }
    await this.startProviderRun(sessionId, currentSession, resumeProvider, runRequest, 'resume')
  },

  async answerUserInput(sessionId: string, answer: string): Promise<void> {
    const session = this.get(sessionId)
    if (!session) return
    const trimmed = answer.trim()
    if (!trimmed) return

    if (providerRuntime.hasActiveRun(sessionId) && session.runtime === 'interactive') {
      const nativeAnswer = answerForNativePrompt(sessionId, trimmed)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'user',
        type: 'text',
        content: trimmed,
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'running')
      providerRuntime.write(sessionId, nativeAnswer ?? `${trimmed}\n`)
      return
    }

    if (providerRuntime.hasActiveRun(sessionId)) providerRuntime.stop(sessionId)

    if (!session.providerSessionId) return

    this.appendMessage(sessionId, [{
      id: uuidv4(),
      role: 'user',
      type: 'text',
      content: trimmed,
      timestamp: Date.now()
    }])
    this.updateStatus(sessionId, 'running')
    resetNativeTerminalState(sessionId)

    const currentSession = this.get(sessionId)!
    const resumeProvider = getProvider(currentSession.provider ?? 'claude')
    let runRequest: RunRequest = {
      ...requestFromSession(
        currentSession,
        `User answered the pending question:\n\n${trimmed}\n\nPlease continue from where you stopped.`
      ),
      runtime: currentSession.runtime
    }
    await this.startProviderRun(sessionId, currentSession, resumeProvider, runRequest, 'resume')
  },

  denyPermission(sessionId: string): void {
    if (approvalBroker.hasPendingApproval(sessionId)) {
      approvalBroker.resolveSessionApproval(sessionId, false, 'Denied by user.')
      this.updateStatus(sessionId, 'running')
      return
    }

    if (providerRuntime.hasActiveRun(sessionId)) {
      for (const message of this.get(sessionId)?.messages ?? []) {
        if (message.type === 'text' && message.queueState) {
          this.upsertMessage(sessionId, { ...message, queueState: undefined })
        }
      }
      clearRuntimeState(sessionId)
      providerRuntime.stop(sessionId)
    }
    this.appendMessage(sessionId, [{
      id: uuidv4(),
      role: 'system',
      type: 'result',
      content: 'Permission denied by user.',
      subtype: 'permission_denied',
      timestamp: Date.now()
    }])
    this.updateStatus(sessionId, 'idle')
  },

  checkProviders(): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const provider of Object.values(PROVIDERS)) {
      result[provider.id] = resolveProviderBinary(provider) !== null
    }
    return result
  },

  writeToPty(sessionId: string, data: string): void {
    providerRuntime.write(sessionId, data)
  },

  async remove(sessionId: string): Promise<void> {
    this.stop(sessionId)
    providerRuntime.stopJsonlTailer(sessionId)
    const session = this.get(sessionId)
    if (session?.useWorktree && session.repoRoot && session.workDir) {
      try {
        await gitManager.removeWorktree(session.repoRoot, session.workDir)
      } catch {
        /* ignore cleanup errors */
      }
    }
    const sessions = store.get('sessions', []).filter((s) => s.id !== sessionId)
    store.set('sessions', sessions)
  },

  async getDiff(sessionId: string): Promise<string> {
    const session = this.get(sessionId)
    if (!session) return ''
    return gitManager.getDiff(session.workDir)
  }
}
