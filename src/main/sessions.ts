import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { performance } from 'perf_hooks'
import { promisify } from 'util'
import type { Attachment, AutomationPermissionSnapshot, Session, SessionForkMode, SessionListItem, ChatMessage, ProviderRuntimeKind, ProviderSidebarSyncResult, ReviewMetadata, RunEvent, RunRequest, SessionStatus, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult, UsageSummary, WorktreeInventoryItem } from '../types'
import { PROVIDER_DEFS, applyAutomationPermissionSnapshot, finalizeInterruptedMessages, getDefaultPermissionMode } from '../types'
import { gitManager } from './git'
import { getProvider, PROVIDERS, providerSpawnEnv, resolveProviderBinary, resolveProviderCommand, runCodexAppServerCommandSurfaceRaw } from './providers'
import type { ProviderAdapter } from './providers'
import { providerRuntime } from './providerRuntime'
import { eventsToMessages } from './runEvents'
import { decideRunLifecycle, eventsForLifecycleDecision, isPausedOrFailed } from './runLifecycle'
import { settingsStore } from './settings'
import { migrateLegacyUserData } from './userDataMigration'
import { approvalBroker } from './approvalBroker'
import { safeWindowSend } from './safeWebContents'
import { searchTranscriptMessages, transcriptPageForMessages } from './transcriptIndex'
import { recordPerformanceMetric } from './performanceTelemetry'
import { applyCodexThreadListMetadata, applyProviderPinnedThreadState, ensurePinnedSessionOrders, nextPinOrder, reorderPinnedSessions } from '../types'
import { shouldRefreshCodexSidebarMetadataAfterRun, shouldRefreshCodexSidebarMetadataOnIdle, syncCodexSidebarThreadMetadata } from './providerSidebarSync'

interface SessionStore {
  sessions: Session[]
}

migrateLegacyUserData()

const store = new Store<SessionStore>({ defaults: { sessions: [] } })
const execFileAsync = promisify(execFile)
const MAX_ATTACHMENT_CHARS = 80_000
const SESSION_LIST_TAIL_MESSAGES = 8
const CODEX_SIDEBAR_REFRESH_AFTER_RUN_DELAY_MS = 750
const CODEX_SIDEBAR_RECURRING_REFRESH_INTERVAL_MS = 10 * 60 * 1000

let codexSidebarRefreshAfterRunTimer: ReturnType<typeof setTimeout> | null = null
let codexSidebarRecurringRefreshTimer: ReturnType<typeof setInterval> | null = null
let codexSidebarRecurringRefreshInFlight = false
let codexSidebarLastRefreshAt: number | null = null

interface PendingFollowUp {
  id: string
  prompt: string
  mode: 'queued' | 'steer_next'
  attachments?: Attachment[]
}

interface SendMessageOptions {
  permissionSnapshot?: AutomationPermissionSnapshot | null
  onProviderRunComplete?: (result: { ok: boolean; error?: string | null }) => void
}

const pendingFollowUps = new Map<string, PendingFollowUp[]>()

const activeToolUseIds = new Map<string, Set<string>>()

function ensurePinnedOrders(sessions: Session[]): Session[] {
  const hadMissingOrder = sessions.some((session) => session.pinned && typeof session.pinOrder !== 'number')
  const ordered = ensurePinnedSessionOrders(sessions)
  if (hadMissingOrder) store.set('sessions', ordered)
  return ordered
}

function activeStoredSessions(): Session[] {
  return ensurePinnedOrders(store.get('sessions', [])).filter((session) => !session.archivedAt)
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

function automatedReviewSmokeMetadata(): ReviewMetadata | undefined {
  const view = process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW
  if (!process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT || !(view === 'diff' || view?.startsWith('diff-') || view === 'environment' || view === 'inspector')) return undefined
  return {
    pullRequest: {
      number: 42,
      title: 'Review metadata smoke',
      url: 'https://github.com/openai/orchestrator/pull/42',
      state: 'open',
      branch: 'codex/review-metadata-smoke',
      baseBranch: 'main'
    },
    checks: {
      status: 'failing',
      total: 3,
      passed: 1,
      failing: 1,
      pending: 1
    },
    reviewers: {
      requested: 2,
      approved: 1,
      changesRequested: 1,
      names: ['Ada', 'Linus']
    },
    comments: {
      total: 5,
      unresolved: 1,
      threads: 2,
      authors: ['Mona', 'Ada', 'Grace'],
      url: 'https://github.com/openai/orchestrator/pull/42#discussion_r1'
    },
    providerCommentsByPath: {
      'review-base.txt': [
        {
          id: 'github-review-thread-smoke-1',
          source: 'github',
          path: 'review-base.txt',
          side: 'new',
          lineNumber: 2,
          body: 'Provider inline review from GitHub',
          author: 'Grace',
          url: 'https://github.com/openai/orchestrator/pull/42#discussion_r1',
          resolved: false,
          outdated: false,
          createdAt: '2026-05-25T12:00:00Z',
          blame: {
            source: 'github',
            commit: 'abc1234def5678abc1234def5678abc1234def56',
            abbreviatedCommit: 'abc1234',
            author: 'Grace',
            authoredAt: '2026-05-24T10:30:00Z',
            url: 'https://github.com/openai/orchestrator/commit/abc1234def5678abc1234def5678abc1234def56'
          }
        }
      ]
    }
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
    safeWindowSend(win, channel, ...args)
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

function isTextLikeAttachment(attachment: Extract<Attachment, { kind: 'local_file' }>): boolean {
  const mimeType = attachment.mimeType?.toLowerCase()
  if (!mimeType) return true
  return mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-yaml'
}

function promptWithLocalAttachments(prompt: string, attachments: Attachment[] = []): string {
  const localFiles = localFileAttachments(attachments)
  if (localFiles.length === 0) return prompt

  const blocks = localFiles.map((attachment) => {
    const path = escapeAttachmentAttribute(attachment.path)
    const name = escapeAttachmentAttribute(attachment.name)
    const mimeType = attachment.mimeType ? ` mime_type="${escapeAttachmentAttribute(attachment.mimeType)}"` : ''
    if (!isTextLikeAttachment(attachment)) {
      return [
        `<attached_file path="${path}" name="${name}"${mimeType} binary="true">`,
        'Attachment saved by Orchestrator. Use the file path above if this provider can read local files.',
        '</attached_file>'
      ].join('\n')
    }
    try {
      const raw = readFileSync(attachment.path, 'utf8')
      const truncated = raw.length > MAX_ATTACHMENT_CHARS
      const content = truncated ? raw.slice(0, MAX_ATTACHMENT_CHARS) : raw
      return [
        `<attached_file path="${path}" name="${name}"${mimeType}>`,
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

function shouldRemoveManagedWorktree(session: Session): boolean {
  return Boolean(
    session.useWorktree &&
    session.repoRoot &&
    session.workDir &&
    gitManager.isManagedWorktreePathForSession(session.repoRoot, session.workDir, session.id)
  )
}

function worktreeStateRank(state: Session['worktreeState'] | undefined): number {
  if (state === 'failed') return 3
  if (state === 'pending') return 2
  if (state === 'ready') return 1
  return 0
}

function combinedWorktreeState(sessions: Session[]): Session['worktreeState'] {
  return sessions.reduce<Session['worktreeState']>((current, session) => (
    worktreeStateRank(session.worktreeState) > worktreeStateRank(current) ? session.worktreeState : current
  ), 'ready') ?? 'ready'
}

function worktreeInventoryFromSessions(sessions: Session[]): WorktreeInventoryItem[] {
  const groups = new Map<string, Session[]>()
  for (const session of sessions) {
    if (!session.useWorktree || !session.workDir) continue
    const key = `${session.repoRoot ?? ''}\n${session.workDir}`
    const current = groups.get(key) ?? []
    current.push(session)
    groups.set(key, current)
  }

  return Array.from(groups.values()).map((linkedSessions) => {
    const sorted = [...linkedSessions].sort((a, b) => (b.latestMessageAt ?? b.createdAt) - (a.latestMessageAt ?? a.createdAt))
    const first = sorted[0]
    const owner = sorted.find((session) => (
      Boolean(session.repoRoot) &&
      gitManager.isManagedWorktreePathForSession(session.repoRoot!, session.workDir, session.id)
    )) ?? null
    const updatedAt = Math.max(...sorted.map((session) => session.latestMessageAt ?? session.createdAt))
    return {
      id: `${first.repoRoot ?? 'no-repo'}:${first.workDir}`,
      repoRoot: first.repoRoot ?? null,
      workDir: first.workDir,
      state: combinedWorktreeState(sorted) ?? 'ready',
      managed: owner !== null,
      ownerSessionId: owner?.id ?? null,
      conversationCount: sorted.length,
      conversations: sorted.map((session) => ({
        id: session.id,
        name: session.name,
        status: session.status,
        provider: session.provider,
        worktreeState: session.worktreeState,
        updatedAt: session.latestMessageAt ?? session.createdAt
      })),
      updatedAt
    }
  }).sort((a, b) => {
    const repoCompare = (a.repoRoot ?? '').localeCompare(b.repoRoot ?? '')
    if (repoCompare !== 0) return repoCompare
    return b.updatedAt - a.updatedAt
  })
}

async function archiveSessionRecord(session: Session, options: { cleanupWorktree: boolean }): Promise<void> {
  if (session.archivedAt) return
  if (options.cleanupWorktree && shouldRemoveManagedWorktree(session)) {
    try {
      await gitManager.removeWorktree(session.repoRoot!, session.workDir)
    } catch {
      /* ignore cleanup errors */
    }
  }
  clearRuntimeState(session.id)
  session.archivedAt = Date.now()
  session.pinned = false
  session.pinOrder = undefined
  session.status = 'idle'
  send('session:archived', { id: session.id })
}

export const sessionManager = {
  list(): Session[] {
    return activeStoredSessions().map(normalizeSession)
  },

  listSummaries(): SessionListItem[] {
    const startedAt = performance.now()
    const summaries = activeStoredSessions().map(sessionListItem)
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

  listArchivedSummaries(): SessionListItem[] {
    return ensurePinnedOrders(store.get('sessions', []))
      .filter((session) => session.archivedAt)
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      .map(sessionListItem)
  },

  get(id: string): Session | undefined {
    const session = ensurePinnedOrders(store.get('sessions', [])).find((s) => s.id === id)
    return session ? normalizeSession(session) : undefined
  },

  async archive(sessionId: string): Promise<void> {
    this.stop(sessionId)
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return
    await archiveSessionRecord(session, { cleanupWorktree: true })
    store.set('sessions', sessions)
  },

  listWorktrees(): WorktreeInventoryItem[] {
    return worktreeInventoryFromSessions(activeStoredSessions().map(normalizeSession))
  },

  async deleteWorktree(workDir: string): Promise<WorktreeInventoryItem[]> {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const linkedSessions = sessions.filter((session) => !session.archivedAt && session.useWorktree && session.workDir === workDir)
    if (linkedSessions.length === 0) return worktreeInventoryFromSessions(sessions.filter((session) => !session.archivedAt).map(normalizeSession))
    const owner = linkedSessions.find((session) => (
      Boolean(session.repoRoot) &&
      gitManager.isManagedWorktreePathForSession(session.repoRoot!, session.workDir, session.id)
    ))
    if (!owner?.repoRoot) {
      throw new Error('Only app-managed worktrees can be deleted from settings')
    }

    for (const session of linkedSessions) {
      this.stop(session.id)
      await archiveSessionRecord(session, { cleanupWorktree: false })
    }

    try {
      await gitManager.removeWorktree(owner.repoRoot, workDir)
    } catch {
      /* ignore cleanup errors for missing or already-removed worktrees */
    }
    store.set('sessions', sessions)
    return worktreeInventoryFromSessions(sessions.filter((session) => !session.archivedAt).map(normalizeSession))
  },

  restoreArchived(sessionId: string): Session | undefined {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const session = sessions.find((s) => s.id === sessionId)
    if (!session?.archivedAt) return session ? normalizeSession(session) : undefined

    session.archivedAt = undefined
    session.status = 'idle'
    store.set('sessions', sessions)
    const restored = normalizeSession(session)
    send('session:created', restored)
    return restored
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

  refreshRecoverableStatuses(): number {
    const sessions = store.get('sessions', [])
    const updates: Array<{ id: string; status: SessionStatus; messages: ChatMessage[] }> = []

    for (const session of sessions) {
      if (session.archivedAt) continue
      if (!hasRecoverableActiveStatus(session.status)) continue
      if (providerRuntime.hasActiveRun(session.id)) continue

      const messages = finalizeInterruptedMessages(session.messages)
      const changedMessages = messages.filter((message, index) => message !== session.messages[index])
      if (session.status === 'idle' && changedMessages.length === 0) continue

      session.status = 'idle'
      session.messages = messages
      updates.push({ id: session.id, status: session.status, messages: changedMessages })
    }

    if (updates.length === 0) return 0

    store.set('sessions', sessions)
    for (const update of updates) {
      send('session:status', { id: update.id, status: update.status })
      for (const message of update.messages) {
        send('session:messageUpdated', { id: update.id, message })
      }
    }
    return updates.length
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
    worktreeBaseRef?: string
    worktreeBranchName?: string
  }): Promise<Session> {
    const id = uuidv4()
    let workDir = opts.workDir

    if (opts.useWorktree && opts.repoRoot) {
      workDir = await gitManager.createWorktree(opts.repoRoot, id, {
        baseRef: opts.worktreeBaseRef,
        branchName: opts.worktreeBranchName
      })
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
      worktreeState: opts.useWorktree ? 'ready' : undefined,
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
      runtime: defaultRuntimeForProvider(defaultProvider),
      reviewMetadata: automatedReviewSmokeMetadata()
    }

    this.save(session)
    send('session:created', session)
    return session
  },

  async fork(sessionId: string, mode: SessionForkMode): Promise<Session> {
    const source = this.get(sessionId)
    if (!source) throw new Error(`Session ${sessionId} not found`)

    const id = uuidv4()
    const now = Date.now()
    const localRoot = source.repoRoot ?? source.workDir
    let workDir = mode === 'local' ? localRoot : source.workDir
    let useWorktree = mode !== 'local' && source.useWorktree
    let repoRoot = source.repoRoot
    let worktreeState = mode !== 'local' ? source.worktreeState : undefined

    if (mode === 'new-worktree') {
      repoRoot = source.repoRoot ?? source.workDir
      if (!repoRoot || !(await gitManager.isGitRepo(repoRoot))) {
        throw new Error('Fork into new worktree requires a git repository')
      }
      workDir = gitManager.worktreePathForSession(repoRoot, id)
      useWorktree = true
      worktreeState = 'pending'
    } else if (mode === 'same-worktree') {
      useWorktree = source.useWorktree
      workDir = source.workDir
      repoRoot = source.repoRoot
      worktreeState = source.worktreeState
    }

    const messages: ChatMessage[] = [
      ...source.messages.map((message) => ({ ...message })),
      {
        id: `forked-from-${source.id}-${now}`,
        role: 'system',
        type: 'text',
        content: `Forked from "${source.name}".`,
        timestamp: now
      }
    ]

    const forked: Session = {
      ...source,
      id,
      name: `Forked: ${source.name}`,
      pinned: false,
      pinOrder: undefined,
      projectId: source.projectId,
      workDir,
      useWorktree,
      worktreeState,
      repoRoot,
      providerSessionId: null,
      claudeSessionId: null,
      status: worktreeState === 'pending' ? 'reconnecting' : 'idle',
      messages,
      messageCount: messages.length,
      messagesLoaded: true,
      previewText: undefined,
      latestMessageAt: now,
      archivedAt: undefined,
      createdAt: now
    }

    this.save(forked)
    send('session:created', forked)
    if (mode === 'new-worktree' && repoRoot) void this.materializePendingWorktree(forked.id, repoRoot)
    return forked
  },

  async materializePendingWorktree(sessionId: string, repoRoot: string): Promise<void> {
    try {
      const workDir = await gitManager.createWorktree(repoRoot, sessionId)
      const sessions = store.get('sessions', [])
      const session = sessions.find((s) => s.id === sessionId)
      if (!session || session.archivedAt) {
        try {
          await gitManager.removeWorktree(repoRoot, workDir)
        } catch {
          /* ignore cleanup races */
        }
        return
      }
      session.workDir = workDir
      session.useWorktree = true
      session.repoRoot = repoRoot
      session.worktreeState = 'ready'
      session.status = 'idle'
      store.set('sessions', sessions)
      send('session:updated', {
        id: sessionId,
        workDir,
        useWorktree: true,
        repoRoot,
        worktreeState: 'ready',
        status: 'idle'
      })
    } catch (error) {
      const sessions = store.get('sessions', [])
      const session = sessions.find((s) => s.id === sessionId)
      if (!session || session.archivedAt) return
      session.worktreeState = 'failed'
      session.status = 'error'
      store.set('sessions', sessions)
      send('session:updated', {
        id: sessionId,
        workDir: session.workDir,
        useWorktree: true,
        repoRoot,
        worktreeState: 'failed',
        status: 'error'
      })
      this.appendMessage(sessionId, [{
        id: `worktree-create-failed-${Date.now()}`,
        role: 'system',
        type: 'result',
        content: error instanceof Error ? error.message : String(error),
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
    }
  },

  async retryPendingWorktree(sessionId: string): Promise<Session> {
    const sessions = store.get('sessions', [])
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (!session.useWorktree || session.worktreeState !== 'failed') {
      throw new Error('Only failed pending worktree sessions can be retried')
    }
    const repoRoot = session.repoRoot
    if (!repoRoot || !(await gitManager.isGitRepo(repoRoot))) {
      throw new Error('Retry worktree creation requires a git repository')
    }
    session.workDir = gitManager.worktreePathForSession(repoRoot, sessionId)
    session.worktreeState = 'pending'
    session.status = 'reconnecting'
    store.set('sessions', sessions)
    send('session:updated', {
      id: sessionId,
      workDir: session.workDir,
      useWorktree: true,
      repoRoot,
      worktreeState: 'pending',
      status: 'reconnecting'
    })
    void this.materializePendingWorktree(sessionId, repoRoot)
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
      if (!pinned) {
        s.providerPinned = false
        s.providerPinOrder = undefined
        s.providerPinnedThreadKey = undefined
      }
      store.set('sessions', sessions)
      send('session:pinned', { id, pinned, pinOrder: s.pinOrder })
    }
  },

  reorderPinned(orderedPinnedSessionIds: string[]): void {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const nextSessions = reorderPinnedSessions(sessions, orderedPinnedSessionIds)
    const changed = nextSessions.filter((nextSession, index) => (
      nextSession.pinned !== sessions[index]?.pinned ||
      nextSession.pinOrder !== sessions[index]?.pinOrder
    ))
    if (changed.length === 0) return
    store.set('sessions', nextSessions)
    for (const session of changed) {
      send('session:pinned', { id: session.id, pinned: session.pinned === true, pinOrder: session.pinOrder })
    }
  },

  applyProviderPinnedThreads(providerId: string, threadKeys: string[]): void {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const nextSessions = applyProviderPinnedThreadState(sessions, { providerId, threadKeys })
    const changed = nextSessions.filter((nextSession, index) => nextSession !== sessions[index])
    if (changed.length === 0) return

    store.set('sessions', nextSessions)
    for (const session of changed) {
      send('session:updated', {
        id: session.id,
        providerPinned: session.providerPinned,
        providerPinOrder: session.providerPinOrder,
        providerPinnedThreadKey: session.providerPinnedThreadKey
      })
    }
  },

  applyCodexThreadListMetadata(threadListResult: unknown): number {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const nextSessions = applyCodexThreadListMetadata(sessions, threadListResult)
    const changed = nextSessions.filter((nextSession, index) => nextSession !== sessions[index])
    if (changed.length === 0) return 0

    store.set('sessions', nextSessions)
    for (const session of changed) {
      send('session:updated', {
        id: session.id,
        providerThreadSource: session.providerThreadSource,
        providerHostId: session.providerHostId,
        providerHostLabel: session.providerHostLabel,
        providerWorktreeSourceRoot: session.providerWorktreeSourceRoot,
        providerWorktreeRoot: session.providerWorktreeRoot,
        providerWorktreeHostId: session.providerWorktreeHostId,
        providerWorktreeHostLabel: session.providerWorktreeHostLabel,
        providerProjectless: session.providerProjectless,
        providerProjectlessThreadId: session.providerProjectlessThreadId,
        previewText: session.previewText,
        latestMessageAt: session.latestMessageAt
      })
    }
    return changed.length
  },

  async refreshCodexSidebarMetadata(cwd = process.cwd()): Promise<ProviderSidebarSyncResult> {
    const result = await syncCodexSidebarThreadMetadata({
      cwd,
      sessions: store.get('sessions', []),
      fetchThreadList: (targetCwd) => runCodexAppServerCommandSurfaceRaw('appserver-threads', targetCwd),
      applyThreadList: (threadListResult) => this.applyCodexThreadListMetadata(threadListResult)
    })
    if (result.skipped !== 'no-provider-sessions') {
      codexSidebarLastRefreshAt = Date.now()
    }
    return result
  },

  scheduleCodexSidebarMetadataRefresh(cwd = process.cwd()): void {
    if (codexSidebarRefreshAfterRunTimer) clearTimeout(codexSidebarRefreshAfterRunTimer)
    codexSidebarRefreshAfterRunTimer = setTimeout(() => {
      codexSidebarRefreshAfterRunTimer = null
      void this.refreshCodexSidebarMetadata(cwd)
    }, CODEX_SIDEBAR_REFRESH_AFTER_RUN_DELAY_MS)
  },

  refreshCodexSidebarMetadataIfIdle(cwd = process.cwd()): boolean {
    if (!shouldRefreshCodexSidebarMetadataOnIdle({
      now: Date.now(),
      lastRefreshAt: codexSidebarLastRefreshAt,
      minIntervalMs: CODEX_SIDEBAR_RECURRING_REFRESH_INTERVAL_MS,
      inFlight: codexSidebarRecurringRefreshInFlight,
      smokeOutput: process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT
    })) {
      return false
    }

    codexSidebarRecurringRefreshInFlight = true
    void this.refreshCodexSidebarMetadata(cwd).finally(() => {
      codexSidebarRecurringRefreshInFlight = false
    })
    return true
  },

  startCodexSidebarMetadataRecurringRefresh(cwd = process.cwd()): void {
    if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) return
    if (codexSidebarRecurringRefreshTimer) return
    codexSidebarRecurringRefreshTimer = setInterval(() => {
      this.refreshCodexSidebarMetadataIfIdle(cwd)
    }, CODEX_SIDEBAR_RECURRING_REFRESH_INTERVAL_MS)
    codexSidebarRecurringRefreshTimer.unref?.()
  },

  stopCodexSidebarMetadataRecurringRefresh(): void {
    if (!codexSidebarRecurringRefreshTimer) return
    clearInterval(codexSidebarRecurringRefreshTimer)
    codexSidebarRecurringRefreshTimer = null
  },

  async startProviderRun(
    sessionId: string,
    session: Session,
    provider: ProviderAdapter,
    request: RunRequest,
    mode: 'start' | 'resume' = 'start',
    onProviderRunComplete?: (result: { ok: boolean; error?: string | null }) => void
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
        const status = this.get(sessionId)?.status ?? 'idle'
        const ok = !isPausedOrFailed(status)
        onProviderRunComplete?.({ ok, error: ok ? null : status })
        const currentSession = this.get(sessionId) ?? session
        const runtime = request.runtime ?? currentSession.runtime ?? session.runtime ?? 'headless'
        if (shouldRefreshCodexSidebarMetadataAfterRun({
          providerId: currentSession.provider ?? provider.id,
          runtime,
          smokeOutput: process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT
        })) {
          this.scheduleCodexSidebarMetadataRefresh(request.cwd || currentSession.workDir || process.cwd())
        }
        if (ok) {
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
      onProviderRunComplete?.({ ok: false, error: result.message ?? 'Provider runtime failed to start.' })
      return false
    }

    return true
  },

  async sendMessage(sessionId: string, prompt: string, useWorktree?: boolean, attachments: Attachment[] = [], options: SendMessageOptions = {}): Promise<boolean> {
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
      return true
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
          s.worktreeState = 'ready'
        } else {
          s.useWorktree = false
          s.worktreeState = undefined
        }
        store.set('sessions', sessions)
        send('session:updated', { id: sessionId, workDir: s.workDir, useWorktree: s.useWorktree, worktreeState: s.worktreeState })
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
    let runRequest: RunRequest = applyAutomationPermissionSnapshot({
      ...requestFromSession(currentSession, effectivePrompt),
      attachments: provider.id === 'codex' ? attachments : claudeResourceAttachmentSpecs(attachments)
    }, options.permissionSnapshot)
    return this.startProviderRun(sessionId, currentSession, provider, runRequest, 'start', options.onProviderRunComplete)
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
    const session = this.get(sessionId)
    const shouldClearVisibleStatus =
      session?.status === 'running' ||
      session?.status === 'waiting_for_permission' ||
      session?.status === 'waiting_for_user' ||
      session?.status === 'reconnecting'
    if (providerRuntime.hasActiveRun(sessionId)) {
      for (const message of session?.messages ?? []) {
        if (message.type === 'text' && (message.queueState || message.isStreaming)) {
          this.upsertMessage(sessionId, { ...message, queueState: undefined, isStreaming: false })
        }
      }
      clearRuntimeState(sessionId)
      providerRuntime.stop(sessionId)
      this.updateStatus(sessionId, 'idle')
    } else if (shouldClearVisibleStatus) {
      clearRuntimeState(sessionId)
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
    if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) {
      return {
        ok: true,
        answer: `Smoke side answer for: ${trimmed}`,
        usage: {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          totalCostUsd: 0,
          durationMs: 120,
          apiDurationMs: 80,
          turns: 1
        }
      }
    }

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
    if (session && shouldRemoveManagedWorktree(session)) {
      try {
        await gitManager.removeWorktree(session.repoRoot!, session.workDir)
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
  },

  async getReviewMetadata(sessionId: string): Promise<ReviewMetadata | undefined> {
    const session = this.get(sessionId)
    if (!session) return undefined
    if (session.reviewMetadata) return session.reviewMetadata
    const metadata = await gitManager.getReviewMetadata(session.workDir)
    if (!metadata) return undefined
    const sessions = store.get('sessions', [])
    const stored = sessions.find((candidate) => candidate.id === sessionId)
    if (stored) {
      stored.reviewMetadata = metadata
      store.set('sessions', sessions)
      send('session:updated', { id: sessionId, reviewMetadata: metadata })
    }
    return metadata
  }
}
