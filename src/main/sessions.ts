import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { performance } from 'perf_hooks'
import { promisify } from 'util'
import type { Attachment, Session, SessionListItem, ChatMessage, ProviderRuntimeKind, RunEvent, RunRequest, SessionStatus, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult, UsageSummary } from '../types'
import { PROVIDER_DEFS, finalizeInterruptedMessages, getDefaultPermissionMode } from '../types'
import { gitManager } from './git'
import { getProvider, PROVIDERS, providerSpawnEnv, resolveProviderBinary, resolveProviderCommand } from './providers'
import type { ProviderAdapter } from './providers'
import { providerRuntime } from './providerRuntime'
import { eventsToMessages } from './runEvents'
import { decideRunLifecycle, eventsForLifecycleDecision, isPausedOrFailed } from './runLifecycle'
import { settingsStore } from './settings'
import { migrateLegacyUserData } from './userDataMigration'
import { approvalBroker } from './approvalBroker'
import { searchTranscriptMessages, transcriptPageForMessages } from './transcriptIndex'
import { recordPerformanceMetric } from './performanceTelemetry'

interface SessionStore {
  sessions: Session[]
}

migrateLegacyUserData()

const store = new Store<SessionStore>({ defaults: { sessions: [] } })
const execFileAsync = promisify(execFile)
const MAX_ATTACHMENT_CHARS = 80_000
const SESSION_LIST_TAIL_MESSAGES = 8

interface PendingFollowUp {
  id: string
  prompt: string
  mode: 'queued' | 'steer_next'
  attachments?: Attachment[]
}

const pendingFollowUps = new Map<string, PendingFollowUp[]>()

const activeToolUseIds = new Map<string, Set<string>>()

function ensurePinnedOrders(sessions: Session[]): Session[] {
  const missingOrder = sessions.filter((session) => session.pinned && typeof session.pinOrder !== 'number')
  if (missingOrder.length === 0) return sessions

  let nextOrder = sessions.reduce((max, session) => {
    return typeof session.pinOrder === 'number' ? Math.max(max, session.pinOrder) : max
  }, 0)
  const orderedMissing = [...missingOrder].sort((a, b) => {
    const aTime = a.latestMessageAt ?? a.messages.at(-1)?.timestamp ?? a.createdAt
    const bTime = b.latestMessageAt ?? b.messages.at(-1)?.timestamp ?? b.createdAt
    return bTime - aTime || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  })
  for (const session of orderedMissing) {
    nextOrder += 1
    session.pinOrder = nextOrder
  }
  store.set('sessions', sessions)
  return sessions
}

function nextPinOrder(sessions: Session[]): number {
  return sessions.reduce((max, session) => {
    return typeof session.pinOrder === 'number' ? Math.max(max, session.pinOrder) : max
  }, 0) + 1
}

function defaultRuntimeForProvider(providerId: string): ProviderRuntimeKind {
  if (providerId === 'codex') return 'app-server'
  return 'headless'
}

function sessionRuntimeForProvider(providerId: string, runtime?: ProviderRuntimeKind): ProviderRuntimeKind {
  if (providerId === 'claude' && runtime === 'interactive') return defaultRuntimeForProvider(providerId)
  return runtime ?? defaultRuntimeForProvider(providerId)
}

function hasRecoverableActiveStatus(status: SessionStatus): boolean {
  return status === 'running' ||
    status === 'waiting_for_permission' ||
    status === 'waiting_for_user' ||
    status === 'reconnecting'
}

function normalizeSession(session: Session): Session {
  const hasRuntime = providerRuntime.hasActiveRun(session.id)
  const status = !hasRuntime && hasRecoverableActiveStatus(session.status) ? 'idle' : session.status
  const providerId = session.provider ?? 'claude'
  return {
    ...session,
    status,
    messages: hasRuntime ? session.messages : finalizeInterruptedMessages(session.messages),
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null,
    runtime: sessionRuntimeForProvider(providerId, session.runtime)
  }
}

function sessionPreviewText(messages: ChatMessage[], fallback: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === 'text' && message.role !== 'system') {
      const compact = message.content.replace(/\s+/g, ' ').trim()
      if (compact && compact !== fallback) return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
    }
  }
  return ''
}

function sessionListItem(session: Session): SessionListItem {
  const normalized = normalizeSession(session)
  const messageCount = normalized.messages.length
  const latestMessageAt = normalized.messages.at(-1)?.timestamp ?? normalized.createdAt
  return {
    ...normalized,
    messages: normalized.messages.slice(-SESSION_LIST_TAIL_MESSAGES),
    messageCount,
    latestMessageAt,
    messagesLoaded: messageCount <= SESSION_LIST_TAIL_MESSAGES,
    previewText: sessionPreviewText(normalized.messages, normalized.name)
  }
}

function send(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

function requestFromSession(session: Session, prompt: string): RunRequest {
  const providerId = session.provider ?? 'claude'
  return {
    prompt,
    cwd: session.workDir,
    model: session.model,
    effort: session.effort,
    agentName: session.agentName ?? null,
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null,
    executionPolicy: session.permissionMode ?? 'default',
    allowedTools: session.allowedTools ?? [],
    disallowedTools: session.disallowedTools ?? [],
    availableTools: session.availableTools ?? [],
    additionalDirs: session.additionalDirs ?? [],
    runtime: sessionRuntimeForProvider(providerId, session.runtime),
    useThinking: session.useThinking,
    useFast: session.useFast
  }
}

function claudeResourceAttachmentSpecs(attachments: Attachment[] = []): Attachment[] {
  return attachments.filter((attachment) => attachment.kind === 'claude_file')
}

function localFileAttachments(attachments: Attachment[] = []): Extract<Attachment, { kind: 'local_file' }>[] {
  return attachments.filter((attachment): attachment is Extract<Attachment, { kind: 'local_file' }> => attachment.kind === 'local_file')
}

function escapeAttachmentAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function promptWithLocalAttachments(prompt: string, attachments: Attachment[] = []): string {
  const localFiles = localFileAttachments(attachments)
  if (localFiles.length === 0) return prompt

  const blocks = localFiles.map((attachment) => {
    const path = escapeAttachmentAttribute(attachment.path)
    const name = escapeAttachmentAttribute(attachment.name)
    try {
      const raw = readFileSync(attachment.path, 'utf8')
      const truncated = raw.length > MAX_ATTACHMENT_CHARS
      const content = truncated ? raw.slice(0, MAX_ATTACHMENT_CHARS) : raw
      return [
        `<attached_file path="${path}" name="${name}">`,
        content,
        truncated ? '\n[Attachment truncated by Orchestrator.]' : '',
        '</attached_file>'
      ].join('\n')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return [
        `<attached_file path="${path}" name="${name}" unreadable="true">`,
        message,
        '</attached_file>'
      ].join('\n')
    }
  })

  return [
    prompt,
    '',
    'Attached file context:',
    ...blocks
  ].join('\n')
}

function mergeUsageSummary(current: UsageSummary | undefined, next: UsageSummary | undefined): UsageSummary | undefined {
  if (!next) return current
  return {
    inputTokens: (current?.inputTokens ?? 0) + (next.inputTokens ?? 0) || undefined,
    outputTokens: (current?.outputTokens ?? 0) + (next.outputTokens ?? 0) || undefined,
    cacheCreationInputTokens: (current?.cacheCreationInputTokens ?? 0) + (next.cacheCreationInputTokens ?? 0) || undefined,
    cacheReadInputTokens: (current?.cacheReadInputTokens ?? 0) + (next.cacheReadInputTokens ?? 0) || undefined,
    totalTokens: (current?.totalTokens ?? 0) + (next.totalTokens ?? 0) || undefined,
    totalCostUsd: (current?.totalCostUsd ?? 0) + (next.totalCostUsd ?? 0) || undefined,
    durationMs: (current?.durationMs ?? 0) + (next.durationMs ?? 0) || undefined,
    apiDurationMs: (current?.apiDurationMs ?? 0) + (next.apiDurationMs ?? 0) || undefined,
    turns: (current?.turns ?? 0) + (next.turns ?? 0) || undefined,
    serviceTier: next.serviceTier ?? current?.serviceTier,
    modelUsage: { ...(current?.modelUsage ?? {}), ...(next.modelUsage ?? {}) }
  }
}

function sideQuestionPrompt(session: Session, question: string): string {
  const transcript = session.messages
    .slice(-16)
    .flatMap((message) => {
      if (message.type === 'text') return [`${message.role}: ${message.content}`]
      if (message.type === 'result' && message.content) return [`system:${message.subtype}: ${message.content}`]
      if (message.type === 'tool_use') return [`tool:${message.toolName}: ${JSON.stringify(message.toolInput).slice(0, 1200)}`]
      return []
    })
    .join('\n\n')

  return [
    'You are answering a side question about an active Orchestrator coding-agent session.',
    'Answer directly and do not edit files. Use the transcript context below when it is relevant.',
    '',
    'Transcript context:',
    transcript || '(No transcript yet.)',
    '',
    'Side question:',
    question
  ].join('\n')
}

function mergeToolNames(current: string[] | undefined, granted: string[]): string[] {
  return [...new Set([...(current ?? []), ...granted])]
}

function markLatestPermissionDecision(
  sessionId: string,
  decision: 'allowed_once' | 'allowed_session' | 'denied' | 'kept_planning'
): void {
  const sessions = store.get('sessions', [])
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return

  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index]
    if (message.type === 'result' && message.permissionDenials?.length) {
      const next = { ...message, permissionDecision: decision }
      session.messages[index] = next
      store.set('sessions', sessions)
      send('session:messageUpdated', { id: sessionId, message: next })
      return
    }
  }
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
  providerRuntime.cleanupSession(sessionId)
}

export const sessionManager = {
  list(): Session[] {
    return ensurePinnedOrders(store.get('sessions', [])).map(normalizeSession)
  },

  listSummaries(): SessionListItem[] {
    const startedAt = performance.now()
    const summaries = ensurePinnedOrders(store.get('sessions', [])).map(sessionListItem)
    recordPerformanceMetric({
      name: 'sessions.listSummaries',
      surface: 'main',
      startedAt: Date.now() - (performance.now() - startedAt),
      durationMs: performance.now() - startedAt,
      metadata: {
        sessions: summaries.length,
        messages: summaries.reduce((sum, session) => sum + session.messageCount, 0)
      }
    })
    return summaries
  },

  get(id: string): Session | undefined {
    const session = ensurePinnedOrders(store.get('sessions', [])).find((s) => s.id === id)
    return session ? normalizeSession(session) : undefined
  },

  getTranscriptPage(id: string, request: TranscriptPageRequest = {}): TranscriptPage | undefined {
    const startedAt = performance.now()
    const session = this.get(id)
    if (!session) return undefined
    const page = transcriptPageForMessages(id, session.messages, request)
    recordPerformanceMetric({
      name: 'transcript.page',
      surface: 'main',
      startedAt: Date.now() - (performance.now() - startedAt),
      durationMs: performance.now() - startedAt,
      metadata: {
        sessionId: id,
        messages: page.messages.length,
        messageCount: page.messageCount,
        hasMoreBefore: page.hasMoreBefore,
        hasMoreAfter: page.hasMoreAfter
      }
    })
    return page
  },

  searchTranscript(id: string, query: string, limit?: number): TranscriptSearchResult[] {
    const startedAt = performance.now()
    const session = this.get(id)
    if (!session) return []
    const results = searchTranscriptMessages(id, session.messages, query, limit)
    recordPerformanceMetric({
      name: 'transcript.search',
      surface: 'main',
      startedAt: Date.now() - (performance.now() - startedAt),
      durationMs: performance.now() - startedAt,
      metadata: {
        sessionId: id,
        results: results.length,
        messageCount: session.messages.length
      }
    })
    return results
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
    const storedPermissionModes = settingsStore.get('defaultPermissionModes', {}) as Record<string, string>
    const defaultModel = storedModels[providerDef.id] ?? providerDef.models[0]?.id ?? ''
    const defaultEffort = storedEfforts[providerDef.id] ?? providerDef.effortLevels[0]?.id ?? 'normal'
    const defaultPermissionMode = getDefaultPermissionMode(providerDef, storedPermissionModes[providerDef.id])

    const session: Session = {
      id,
      name: 'New Chat',
      pinned: false,
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
      agentName: null,
      permissionMode: defaultPermissionMode,
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
    const nextName = name.trim()
    if (!nextName) return
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.name = nextName
      store.set('sessions', sessions)
      send('session:renamed', { id, name: nextName })
    }
  },

  updatePinned(id: string, pinned: boolean): void {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.pinned = pinned
      s.pinOrder = pinned ? nextPinOrder(sessions) : undefined
      store.set('sessions', sessions)
      send('session:pinned', { id, pinned, pinOrder: s.pinOrder })
    }
  },

  async startProviderRun(
    sessionId: string,
    session: Session,
    provider: ProviderAdapter,
    request: RunRequest,
    mode: 'start' | 'resume' = 'start'
  ): Promise<boolean> {
    const startedAt = performance.now()
    const preparedRequest = await providerRuntime.prepareRunRequest(
      sessionId,
      provider,
      request,
      (targetSessionId, events) => {
        this.applyRunEvents(targetSessionId, events)
      }
    )

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
      onData: (data) => {
        if (/\[y\/n\]/i.test(data) || /\[yes\/no\]/i.test(data)) {
          this.updateStatus(sessionId, 'waiting_for_user')
          send('session:needsInput', { id: sessionId })
        }
      },
      onExit: () => {
        activeToolUseIds.delete(sessionId)
        const followUp = shiftPendingFollowUp(sessionId)
        if (followUp) {
          for (const message of this.get(sessionId)?.messages ?? []) {
            if (message.type === 'text' && message.isStreaming) {
              this.upsertMessage(sessionId, { ...message, isStreaming: false })
            }
          }
          void this.runQueuedFollowUp(sessionId, followUp)
          return
        }
        if (!isPausedOrFailed(this.get(sessionId)?.status ?? 'idle')) {
          this.updateStatus(sessionId, 'idle')
        }
      }
    })

    recordPerformanceMetric({
      name: 'provider.run.start',
      surface: 'main',
      startedAt: Date.now() - (performance.now() - startedAt),
      durationMs: performance.now() - startedAt,
      metadata: {
        sessionId,
        provider: provider.id,
        runtime: request.runtime ?? session.runtime ?? 'headless',
        mode,
        ok: result.ok
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

  async sendMessage(sessionId: string, prompt: string, useWorktree?: boolean, attachments: Attachment[] = []): Promise<void> {
    const session = this.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const activeProviderId = session.provider ?? 'claude'
    const effectivePrompt = promptWithLocalAttachments(prompt, attachments)
    const runtimeAttachments = activeProviderId === 'codex' ? attachments : claudeResourceAttachmentSpecs(attachments)
    if (providerRuntime.hasActiveRun(sessionId)) {
      if (session.runtime === 'interactive' && session.status === 'idle') {
        const userMsg: ChatMessage = {
          id: uuidv4(),
          role: 'user',
          type: 'text',
          content: prompt,
          attachments,
          timestamp: Date.now()
        }
        this.appendMessage(sessionId, [userMsg])
        this.updateStatus(sessionId, 'running')
        providerRuntime.write(sessionId, `${effectivePrompt}\r`)
      } else {
        const messageId = uuidv4()
        const userMsg: ChatMessage = {
          id: messageId,
          role: 'user',
          type: 'text',
          content: prompt,
          attachments,
          queueState: 'queued',
          timestamp: Date.now()
        }
        this.appendMessage(sessionId, [userMsg])
        appendPendingFollowUp(sessionId, { id: messageId, prompt: effectivePrompt, mode: 'queued', attachments: runtimeAttachments })
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

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      type: 'text',
      content: prompt,
      attachments,
      timestamp: Date.now()
    }
    this.appendMessage(sessionId, [userMsg])

    const currentSession = this.get(sessionId)!
    const provider = getProvider(currentSession.provider ?? 'claude')
    let runRequest: RunRequest = {
      ...requestFromSession(currentSession, effectivePrompt),
      attachments: provider.id === 'codex' ? attachments : claudeResourceAttachmentSpecs(attachments)
    }
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
    const suppressInterruptFailure = hasSteerableFollowUp(sessionId)
    const lifecycleEvents = eventsForLifecycleDecision(events, { suppressFailure: suppressInterruptFailure })
    const decision = decideRunLifecycle(currentSession, lifecycleEvents)

    if (decision.providerSessionId) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((s) => s.id === sessionId)
      if (s) {
        s.providerSessionId = decision.providerSessionId
        s.claudeSessionId = decision.claudeSessionId ?? decision.providerSessionId
        store.set('sessions', sessions)
      }
    }

    if (decision.shouldInterruptProcess) {
      providerRuntime.stop(sessionId)
    }

    if (decision.systemMessages.length > 0) this.appendMessage(sessionId, decision.systemMessages)
    if (decision.status) this.updateStatus(sessionId, decision.status)

    updateToolBoundaryState(sessionId, events)

    const usageEvents = events.filter((event): event is Extract<RunEvent, { type: 'run.completed' | 'run.failed' }> =>
      (event.type === 'run.completed' || event.type === 'run.failed') && Boolean(event.usage)
    )
    if (usageEvents.length > 0) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((candidate) => candidate.id === sessionId)
      if (s) {
        for (const event of usageEvents) {
          s.usageSummary = mergeUsageSummary(s.usageSummary, event.usage)
        }
        store.set('sessions', sessions)
        send('session:settingsUpdated', { id: sessionId, usageSummary: s.usageSummary })
      }
    }

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

    const messages = eventsToMessages(lifecycleEvents)
    if (messages.length > 0) this.appendMessage(sessionId, messages)

    if (hasSteerableFollowUp(sessionId) && !hasActiveTool(sessionId)) {
      providerRuntime.interrupt(sessionId)
    }
  },

  updateSettings(id: string, patch: {
    provider?: string
    model?: string
    effort?: string
    agentName?: string | null
    permissionMode?: string
    runtime?: ProviderRuntimeKind
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
        if (!patch.permissionMode) {
          const providerDef = PROVIDER_DEFS[patch.provider] ?? PROVIDER_DEFS.claude
          const storedPermissionModes = settingsStore.get('defaultPermissionModes', {}) as Record<string, string>
          normalizedPatch.permissionMode = getDefaultPermissionMode(providerDef, storedPermissionModes[providerDef.id])
        }
      }
      if (normalizedPatch.runtime) {
        normalizedPatch.runtime = sessionRuntimeForProvider(normalizedPatch.provider ?? s.provider ?? 'claude', normalizedPatch.runtime)
      }
      Object.assign(s, normalizedPatch)
      store.set('sessions', sessions)
      send('session:settingsUpdated', { id, ...normalizedPatch })
    }
  },

  stop(sessionId: string): void {
    if (providerRuntime.hasActiveRun(sessionId)) {
      for (const message of this.get(sessionId)?.messages ?? []) {
        if (message.type === 'text' && (message.queueState || message.isStreaming)) {
          this.upsertMessage(sessionId, { ...message, queueState: undefined, isStreaming: false })
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

    const provider = getProvider(session.provider ?? 'claude')
    const mode = session.providerSessionId ? 'resume' : 'start'
    let runRequest: RunRequest = {
      ...requestFromSession(session, followUp.prompt),
      runtime: session.runtime,
      attachments: followUp.attachments ?? []
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
    markLatestPermissionDecision(sessionId, persistGrant ? 'allowed_session' : 'allowed_once')

    if (approvalBroker.hasPendingApproval(sessionId)) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((candidate) => candidate.id === sessionId)
      if (s && persistGrant) {
        s.allowedTools = mergeToolNames(s.allowedTools, toolNames)
        store.set('sessions', sessions)
      }
      if (persistGrant) approvalBroker.grantTools(sessionId, toolNames)
      if (persistGrant) {
        approvalBroker.resolveSessionApprovals(sessionId, true, undefined, toolNames)
      } else {
        approvalBroker.resolveSessionApproval(sessionId, true)
      }
      this.updateStatus(sessionId, 'running')
      return
    }

    if (providerRuntime.resolvePermission(sessionId, true, persistGrant)) {
      if (persistGrant) {
        const sessions = store.get('sessions', [])
        const s = sessions.find((candidate) => candidate.id === sessionId)
        if (s) {
          s.allowedTools = mergeToolNames(s.allowedTools, toolNames)
          store.set('sessions', sessions)
        }
      }
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
    if (session.status === 'waiting_for_permission') markLatestPermissionDecision(sessionId, 'kept_planning')

    if (providerRuntime.answerUserInput(sessionId, trimmed)) {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'user',
        type: 'text',
        content: trimmed,
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'running')
      return
    }

    if (providerRuntime.hasActiveRun(sessionId) && session.runtime === 'interactive') {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'user',
        type: 'text',
        content: trimmed,
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'running')
      providerRuntime.write(sessionId, `${trimmed}\r`)
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
    markLatestPermissionDecision(sessionId, 'denied')
    if (providerRuntime.resolvePermission(sessionId, false, false)) {
      this.updateStatus(sessionId, 'running')
      return
    }
    if (approvalBroker.hasPendingApproval(sessionId)) {
      approvalBroker.resolveSessionApprovals(sessionId, false, 'Denied by user.')
      this.updateStatus(sessionId, 'running')
      setTimeout(() => {
        for (const message of this.get(sessionId)?.messages ?? []) {
          if (message.type === 'text' && message.queueState) {
            this.upsertMessage(sessionId, { ...message, queueState: undefined })
          }
        }
        clearRuntimeState(sessionId)
        providerRuntime.stop(sessionId)
        this.appendMessage(sessionId, [{
          id: uuidv4(),
          role: 'system',
          type: 'result',
          content: 'Permission denied by user.',
          subtype: 'permission_denied',
          timestamp: Date.now()
        }])
        this.updateStatus(sessionId, 'idle')
      }, 150)
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

  async answerSideQuestion(sessionId: string, question: string): Promise<{ ok: boolean; answer: string; error?: string; usage?: UsageSummary }> {
    const session = this.get(sessionId)
    if (!session) return { ok: false, answer: '', error: `Session ${sessionId} not found.` }
    const trimmed = question.trim()
    if (!trimmed) return { ok: false, answer: '', error: 'Question is empty.' }

    const provider = getProvider(session.provider ?? 'claude')
    const request: RunRequest = {
      ...requestFromSession(session, sideQuestionPrompt(session, trimmed)),
      providerSessionId: null,
      executionPolicy: provider.id === 'claude' ? 'dontAsk' : session.permissionMode,
      allowedTools: [],
      disallowedTools: [],
      availableTools: provider.id === 'claude' ? [''] : [],
      attachments: []
    }
    const command = resolveProviderCommand(provider, provider.buildStartCommand(request))
    if (!command) return { ok: false, answer: '', error: `${provider.id} CLI is not available.` }
    if (provider.id === 'claude') command.args.push('--max-budget-usd', '0.05')

    try {
      const { stdout } = await execFileAsync(command.binary, command.args, {
        cwd: session.workDir,
        env: providerSpawnEnv(provider.id),
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024
      })
      const events = String(stdout)
        .split('\n')
        .flatMap((line) => provider.parseOutputLine(line))
      const text = events
        .flatMap((event) => event.type === 'assistant.text' ? [event.content] : [])
        .join('\n')
        .trim()
      const terminal = [...events].reverse().find((event) => event.type === 'run.completed' || event.type === 'run.failed')
      const usage = terminal?.type === 'run.completed' || terminal?.type === 'run.failed' ? terminal.usage : undefined
      const fallback = terminal && (terminal.type === 'run.completed' || terminal.type === 'run.failed') ? terminal.content : undefined
      return {
        ok: terminal?.type !== 'run.failed',
        answer: text || fallback || '',
        error: terminal?.type === 'run.failed' ? (fallback || 'Side question failed.') : undefined,
        usage
      }
    } catch (error) {
      const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
      const stderr = Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8') : err.stderr
      const stdout = Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : err.stdout
      return {
        ok: false,
        answer: '',
        error: stderr?.trim() || stdout?.trim() || err.message || 'Side question failed.'
      }
    }
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
