import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { execFile } from 'child_process'
import { readFileSync } from 'fs'
import { performance } from 'perf_hooks'
import { promisify } from 'util'
import type { AgentThreadOpenRequest, AgentThreadOpenResult, Attachment, AutomationPermissionSnapshot, CodexReviewStartRequest, Session, SessionForkMode, SessionForkOptions, SessionListItem, ChatMessage, TextMessage, ResultMessage, ProviderModelDef, ProviderRuntimeKind, ProviderSidebarSyncResult, ReviewMetadata, RunEvent, RunRequest, SessionNameSource, SessionStatus, SideQuestionMessage, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult, UsageSummary, UserInputAnswerPayload, WorktreeInventoryItem } from '../types'
import { PROVIDER_DEFS, applyAutomationPermissionSnapshot, canSwitchSessionProvider, finalizeInterruptedMessages, getConfigurableModels, getDefaultPermissionMode, mergeProviderModelCatalog, normalizeProviderModelOrder, resolveProviderRunModelSelection } from '../types'
import { gitManager } from './git'
import { buildProviderCommandForRuntime, getProvider, PROVIDERS, providerSpawnEnv, resolveProviderBinary, resolveProviderCommand, runCodexAppServerCommandSurfaceRaw } from './providers'
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
import { runClaudeSdkOneShot } from './claudeSdkRuntime'
import { promptWithCursorSdkUnansweredContext } from './cursorPromptContext'

interface SessionStore {
  sessions: Session[]
}

type SessionActionResult = { ok: boolean; error?: string }

migrateLegacyUserData()

const store = new Store<SessionStore>({ defaults: { sessions: [] } })
const execFileAsync = promisify(execFile)
const MAX_ATTACHMENT_CHARS = 80_000
const SESSION_LIST_TAIL_MESSAGES = 8
const CODEX_SIDEBAR_REFRESH_AFTER_RUN_DELAY_MS = 750
const CODEX_SIDEBAR_RECURRING_REFRESH_INTERVAL_MS = 10 * 60 * 1000
const STREAMING_MESSAGE_UPDATE_SEND_INTERVAL_MS = 80
const STREAMING_MESSAGE_PERSIST_INTERVAL_MS = 2_000

let codexSidebarRefreshAfterRunTimer: ReturnType<typeof setTimeout> | null = null
let codexSidebarRecurringRefreshTimer: ReturnType<typeof setInterval> | null = null
let codexSidebarRecurringRefreshInFlight = false
let codexSidebarLastRefreshAt: number | null = null
const smokeSideQuestionFailures = new Set<string>()
const pendingStreamingMessageUpdates = new Map<string, { id: string; message: ChatMessage }>()
let pendingStreamingMessageUpdateTimer: ReturnType<typeof setTimeout> | null = null
const activeStreamingMessages = new Map<string, { id: string; message: ChatMessage; lastPersistedAt: number }>()

function normalizeUserInputAnswer(answer: string | UserInputAnswerPayload): UserInputAnswerPayload {
  if (typeof answer === 'string') return { content: answer.trim() }
  const content = typeof answer.content === 'string' ? answer.content.trim() : ''
  const displayContent = typeof answer.displayContent === 'string' ? answer.displayContent.trim() : ''
  const answers: Record<string, string[]> = {}
  if (answer.answers && typeof answer.answers === 'object') {
    for (const [key, values] of Object.entries(answer.answers)) {
      if (!Array.isArray(values)) continue
      const cleaned = values.map((value) => String(value).trim()).filter(Boolean)
      if (cleaned.length > 0) answers[key] = cleaned
    }
  }
  return {
    content,
    displayContent: displayContent && displayContent !== content ? displayContent : undefined,
    answers: Object.keys(answers).length > 0 ? answers : undefined
  }
}

interface PendingFollowUp {
  id: string
  prompt: string
  mode: 'queued' | 'steer_next'
  attachments?: Attachment[]
}

interface SendMessageOptions {
  permissionSnapshot?: AutomationPermissionSnapshot | null
  onProviderRunComplete?: (result: { ok: boolean; error?: string | null }) => void
  editFromMessageId?: string
}

interface MessageEditSnapshot {
  messages: ChatMessage[]
  providerSessionId: string | null
  claudeSessionId?: string | null
  providerThreadSource?: Session['providerThreadSource']
  providerProjectless?: boolean
  providerProjectlessThreadId?: string | null
  previewText?: string
  latestMessageAt?: number
}

interface CodexReviewStartResult {
  ok: boolean
  error?: string
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

function sessionStoreMessageCount(sessions: Session[]): number {
  return sessions.reduce((sum, session) => sum + session.messages.length, 0)
}

function setSessionsStore(
  sessions: Session[],
  reason: string,
  metadata: Record<string, string | number | boolean | null> = {}
): void {
  const startedAt = performance.now()
  store.set('sessions', sessions)
  recordPerformanceMetric({
    name: 'sessions.store.set',
    surface: 'main',
    startedAt: Date.now() - (performance.now() - startedAt),
    durationMs: performance.now() - startedAt,
    metadata: {
      reason,
      sessions: sessions.length,
      messages: sessionStoreMessageCount(sessions),
      ...metadata
    }
  })
}

function defaultRuntimeForProvider(providerId: string): ProviderRuntimeKind {
  if (providerId === 'codex') return 'app-server'
  if (providerId === 'claude' || providerId === 'copilot') return 'sdk'
  return 'headless'
}

function sessionRuntimeForProvider(providerId: string, runtime?: ProviderRuntimeKind): ProviderRuntimeKind {
  if (providerId === 'claude' && runtime !== 'sdk') return defaultRuntimeForProvider(providerId)
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

function cloneMessageForFork(message: ChatMessage): ChatMessage {
  if (message.type === 'text') {
    return {
      ...message,
      attachments: message.attachments?.map((attachment) => ({ ...attachment }))
    }
  }
  return { ...message }
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
          body: "Provider inline review from GitHub\n\n```suggestion\nafter review with provider suggestion\n```",
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
    },
    providerWarnings: ['Inline review comments unavailable: smoke warning from provider adapter']
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

function compactSessionName(input: string, maxLength = 60): string {
  const collapsed = input.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed
}

function firstUserMessageAutoName(session: Pick<Session, 'messages'>): string | null {
  const firstUser = session.messages.find((message) => message.type === 'text' && message.role === 'user')
  return firstUser?.type === 'text' ? compactSessionName(firstUser.content) : null
}

function canApplyProviderSessionName(session: Pick<Session, 'name' | 'nameSource' | 'messages'>): boolean {
  if (session.nameSource === 'user' || session.nameSource === 'provider' || session.nameSource === 'system') return false
  if (session.nameSource === 'default' || session.nameSource === 'first-message') return true
  return session.name === 'New Chat' || session.name === firstUserMessageAutoName(session)
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

function flushStreamingMessageUpdates(): void {
  pendingStreamingMessageUpdateTimer = null
  const updates = [...pendingStreamingMessageUpdates.values()]
  pendingStreamingMessageUpdates.clear()
  for (const update of updates) {
    send('session:messageUpdated', { id: update.id, message: update.message })
  }
}

function sendMessageUpdated(id: string, message: ChatMessage): void {
  const pendingKey = `${id}:${message.id}`
  if (
    (message.type === 'text' && message.role === 'assistant' && message.isStreaming === true) ||
    (message.type === 'result' && message.subtype === 'thinking' && message.isStreaming === true)
  ) {
    pendingStreamingMessageUpdates.set(pendingKey, { id, message })
    if (!pendingStreamingMessageUpdateTimer) {
      pendingStreamingMessageUpdateTimer = setTimeout(flushStreamingMessageUpdates, STREAMING_MESSAGE_UPDATE_SEND_INTERVAL_MS)
    }
    return
  }
  pendingStreamingMessageUpdates.delete(pendingKey)
  send('session:messageUpdated', { id, message })
}

function streamingMessageKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`
}

function activeStreamingRecord(sessionId: string, messageId: string): { id: string; message: ChatMessage; lastPersistedAt: number } | undefined {
  return activeStreamingMessages.get(streamingMessageKey(sessionId, messageId))
}

function clearActiveStreamingMessage(sessionId: string, messageId: string): void {
  activeStreamingMessages.delete(streamingMessageKey(sessionId, messageId))
  pendingStreamingMessageUpdates.delete(streamingMessageKey(sessionId, messageId))
}

function clearActiveStreamingMessages(sessionId: string): void {
  for (const key of activeStreamingMessages.keys()) {
    if (key.startsWith(`${sessionId}:`)) activeStreamingMessages.delete(key)
  }
  for (const key of pendingStreamingMessageUpdates.keys()) {
    if (key.startsWith(`${sessionId}:`)) pendingStreamingMessageUpdates.delete(key)
  }
}

function clearThinkingTraceMessages(sessionId: string): boolean {
  let removed = false
  for (const [key, record] of activeStreamingMessages.entries()) {
    if (record.id !== sessionId) continue
    if (record.message.type !== 'result' || record.message.subtype !== 'thinking') continue
    activeStreamingMessages.delete(key)
    pendingStreamingMessageUpdates.delete(key)
  }

  const sessions = store.get('sessions', [])
  const s = sessions.find((session) => session.id === sessionId)
  if (!s) return removed

  const nextMessages = s.messages.filter((message) => {
    const keep = message.type !== 'result' || message.subtype !== 'thinking'
    if (!keep) {
      removed = true
      send('session:messageRemoved', { id: sessionId, messageId: message.id })
    }
    return keep
  })
  if (!removed) return false
  s.messages = nextMessages
  setSessionsStore(sessions, 'clear-thinking-traces', { sessionId })
  return true
}

function shouldClearThinkingTrace(event: RunEvent): boolean {
  return event.type === 'assistant.text' ||
    event.type === 'assistant.status' ||
    event.type === 'assistant.text.delta' ||
    event.type === 'tool.started' ||
    event.type === 'tool.completed' ||
    event.type === 'agent.started' ||
    event.type === 'agent.updated' ||
    event.type === 'agent.completed' ||
    event.type === 'agent.failed' ||
    event.type === 'plan.updated' ||
    event.type === 'permission.requested' ||
    event.type === 'user_input.requested' ||
    event.type === 'run.completed' ||
    event.type === 'run.failed'
}

function flushActiveStreamingMessagesToStore(sessionId: string): void {
  const records = [...activeStreamingMessages.values()].filter((record) => record.id === sessionId)
  if (records.length === 0) return

  const sessions = store.get('sessions', [])
  const s = sessions.find((session) => session.id === sessionId)
  if (!s) {
    clearActiveStreamingMessages(sessionId)
    return
  }

  for (const record of records) {
    const index = s.messages.findIndex((candidate) => candidate.id === record.message.id)
    if (index >= 0) s.messages[index] = record.message
    else s.messages.push(record.message)
    record.lastPersistedAt = Date.now()
  }
  setSessionsStore(sessions, 'streaming-flush', { sessionId, streams: records.length })
  for (const record of records) sendMessageUpdated(sessionId, record.message)
}

function requestFromSession(session: Session, prompt: string): RunRequest {
  const providerId = session.provider ?? 'claude'
  const baseProviderDef = PROVIDER_DEFS[providerId] ?? PROVIDER_DEFS.claude
  const providerModelCatalog = settingsStore.get('providerModelCatalog', {}) as Record<string, ProviderModelDef[]>
  const providerDef = mergeProviderModelCatalog(baseProviderDef, providerModelCatalog[providerId])
  const rawModel = session.model
  const requestedFast = Boolean(session.useFast)
  const modelSelection = resolveProviderRunModelSelection(providerDef, rawModel, session.effort, requestedFast)
  const useFast = modelSelection.useFast
  const selectedRequestModel = providerId === 'cursor' || !modelSelection.baseModel
    ? modelSelection.baseModel
    : modelSelection.model
  const requestModel = selectedRequestModel ?? ''
  const preparedPrompt = claudeAgentThreadPromptForRequest(session, prompt)
  const copilotByokProvider = providerId === 'copilot'
    ? settingsStore.get('copilotByokProvider', {
        enabled: false,
        type: 'openai',
        baseUrl: '',
        apiKeyEnvKey: 'OPENAI_API_KEY'
      }) as RunRequest['copilotByokProvider']
    : undefined
  return {
    prompt: preparedPrompt,
    cwd: session.workDir,
    model: requestModel,
    effort: session.effort,
    agentName: session.agentName ?? null,
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null,
    executionPolicy: session.permissionMode ?? 'default',
    allowedTools: claudeAgentThreadAllowedTools(session, session.allowedTools ?? []),
    disallowedTools: session.disallowedTools ?? [],
    availableTools: session.availableTools ?? [],
    additionalDirs: session.additionalDirs ?? [],
    runtime: sessionRuntimeForProvider(providerId, session.runtime),
    useThinking: session.useThinking,
    useFast,
    serviceTier: providerId === 'codex' && useFast && !modelSelection.fastVariantModelId ? 'fast' : null,
    ...(copilotByokProvider ? { copilotByokProvider } : {})
  }
}

export function isClaudeAgentThreadSession(
  session: Pick<Session, 'provider' | 'providerSessionId' | 'claudeSessionId' | 'providerProjectlessThreadId'>
): boolean {
  const providerSessionId = session.providerSessionId ?? session.claudeSessionId
  const agentId = session.providerProjectlessThreadId
  return (session.provider ?? 'claude') === 'claude' &&
    Boolean(providerSessionId?.trim()) &&
    Boolean(agentId?.trim()) &&
    providerSessionId !== agentId
}

export function claudeAgentThreadPromptForRequest(
  session: Pick<Session, 'provider' | 'providerSessionId' | 'claudeSessionId' | 'providerProjectlessThreadId'>,
  prompt: string
): string {
  if (!isClaudeAgentThreadSession(session)) return prompt
  const agentId = session.providerProjectlessThreadId?.trim()
  if (!agentId) return prompt
  return [
    `Continue the existing Claude subagent with agent id ${agentId}.`,
    `Use the SendMessage tool with the "to" field set to "${agentId}". Do not start a new Agent or Task invocation for this request.`,
    'Forward the following user instruction to that subagent and return the subagent response:',
    '',
    prompt
  ].join('\n')
}

export function claudeAgentThreadAllowedTools(
  session: Pick<Session, 'provider' | 'providerSessionId' | 'claudeSessionId' | 'providerProjectlessThreadId'>,
  allowedTools: string[]
): string[] {
  if (!isClaudeAgentThreadSession(session)) return allowedTools
  return mergeToolNames(allowedTools, ['SendMessage'])
}

function shouldRefreshAgentThreadTitle(existingName: string | undefined, nextTitle: string): boolean {
  const current = existingName?.trim()
  if (!current || current === 'Agent thread') return true
  if (current === nextTitle) return false
  return /^Resume agent\b/i.test(current) || /^Opened .+ agent\b/i.test(current)
}

function agentThreadPreview(providerId: string, title: string, providerAgentId: string | undefined, providerThreadId: string | undefined): string {
  if (providerId === 'claude') return providerAgentId ? `Claude agent thread: ${title}` : `Claude thread: ${title}`
  const providerName = PROVIDER_DEFS[providerId]?.name ?? providerId
  return providerThreadId ? `${providerName} agent thread: ${title}` : `${providerName} thread: ${title}`
}

function agentThreadOpenedNote(
  providerId: string,
  title: string,
  providerAgentId: string | undefined,
  providerThreadId: string | undefined,
  parentThreadId: string | null
): string {
  if (providerId === 'claude') {
    return [
      `Claude agent thread: ${title}.`,
      providerAgentId ? `Agent ${providerAgentId}.` : undefined,
      parentThreadId ? `Parent session ${parentThreadId}.` : undefined
    ].filter(Boolean).join(' ')
  }
  const providerName = PROVIDER_DEFS[providerId]?.name ?? providerId
  return [
    `${providerName} agent thread: ${title}.`,
    providerThreadId ? `Thread ${providerThreadId}.` : undefined,
    parentThreadId ? `Parent ${parentThreadId}.` : undefined
  ].filter(Boolean).join(' ')
}

function codexReviewStartLabel(request: CodexReviewStartRequest): string {
  const target = request.target
  if (target.type === 'baseBranch') return `Review changes against ${target.branch}`
  if (target.type === 'commit') return `Review commit ${target.title || target.sha}`
  if (target.type === 'custom') return 'Review custom instructions'
  return 'Review uncommitted changes'
}

function promptWithPersonalization(prompt: string): string {
  const enabled = settingsStore.get('personalizationEnabled', false)
  if (!enabled) return prompt
  const customInstructions = settingsStore.get('personalizationCustomInstructions', '').trim()
  const codingPreferences = settingsStore.get('personalizationCodingPreferences', '').trim()
  if (!customInstructions && !codingPreferences) return prompt

  const sections = [
    '<orchestrator_personalization>',
    customInstructions ? `Custom instructions:\n${customInstructions}` : '',
    codingPreferences ? `Coding preferences:\n${codingPreferences}` : '',
    '</orchestrator_personalization>'
  ].filter(Boolean)
  return `${sections.join('\n\n')}\n\n${prompt}`
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

function sideQuestionPrompt(session: Session, question: string, sideChatMessages: SideQuestionMessage[] = []): string {
  const transcript = session.messages
    .slice(-16)
    .flatMap((message) => {
      if (message.type === 'text') return [`${message.role}: ${message.content}`]
      if (message.type === 'result' && message.content) return [`system:${message.subtype}: ${message.content}`]
      if (message.type === 'tool_use') return [`tool:${message.toolName}: ${JSON.stringify(message.toolInput).slice(0, 1200)}`]
      return []
    })
    .join('\n\n')
  const sideChatContext = sideChatMessages
    .filter((message) => message.status !== 'pending' && message.content.trim())
    .slice(-10)
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, ' ').trim().slice(0, 1600)}`)
    .join('\n\n')

  return [
    'You are answering a side question about an active Orchestrator coding-agent session.',
    'Answer directly and do not edit files. Use the side-chat context first for follow-ups, then the transcript when it is relevant.',
    '',
    'Side-chat context:',
    sideChatContext || '(No side-chat messages yet.)',
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
      sendMessageUpdated(sessionId, next)
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

function removePendingFollowUp(sessionId: string, messageId: string): boolean {
  const current = pendingFollowUps.get(sessionId)
  if (!current) return false
  const next = current.filter((item) => item.id !== messageId)
  if (next.length === current.length) return false
  if (next.length === 0) pendingFollowUps.delete(sessionId)
  else pendingFollowUps.set(sessionId, next)
  return true
}

function pendingFollowUpMessageIds(sessionId: string): Set<string> {
  return new Set((pendingFollowUps.get(sessionId) ?? []).map((item) => item.id))
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
  flushActiveStreamingMessagesToStore(sessionId)
  clearActiveStreamingMessages(sessionId)
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
    setSessionsStore(sessions, 'archive', { sessionId: session.id })
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
      setSessionsStore(sessions, 'status', { sessionId: id, status })
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

    setSessionsStore(sessions, 'recover-statuses', { updates: updates.length })
    for (const update of updates) {
      send('session:status', { id: update.id, status: update.status })
      for (const message of update.messages) {
        sendMessageUpdated(update.id, message)
      }
    }
    return updates.length
  },

  appendMessage(id: string, messages: ChatMessage[]): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.messages.push(...messages)
      setSessionsStore(sessions, 'append-message', { sessionId: id, messages: messages.length })
      send('session:messages', { id, messages })
    }
  },

  upsertMessage(id: string, message: ChatMessage): void {
    const isStreamingTranscriptMessage =
      (message.type === 'text' && message.role === 'assistant' && message.isStreaming === true) ||
      (message.type === 'result' && message.subtype === 'thinking' && message.isStreaming === true)

    if (isStreamingTranscriptMessage) {
      const key = streamingMessageKey(id, message.id)
      const activeRecord = activeStreamingMessages.get(key)
      const now = Date.now()
      if (activeRecord && now - activeRecord.lastPersistedAt < STREAMING_MESSAGE_PERSIST_INTERVAL_MS) {
        activeStreamingMessages.set(key, { id, message, lastPersistedAt: activeRecord.lastPersistedAt })
        sendMessageUpdated(id, message)
        return
      }
      activeStreamingMessages.set(key, { id, message, lastPersistedAt: now })
    } else {
      clearActiveStreamingMessage(id, message.id)
    }

    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (!s) return

    const index = s.messages.findIndex((candidate) => candidate.id === message.id)
    if (index >= 0) s.messages[index] = message
    else s.messages.push(message)
    setSessionsStore(sessions, 'upsert-message', {
      sessionId: id,
      messageType: message.type,
      streaming: isStreamingTranscriptMessage
    })
    sendMessageUpdated(id, message)
  },

  removeMessage(id: string, messageId: string): boolean {
    clearActiveStreamingMessage(id, messageId)
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (!s) return false

    const nextMessages = s.messages.filter((message) => message.id !== messageId)
    if (nextMessages.length === s.messages.length) return false
    s.messages = nextMessages
    setSessionsStore(sessions, 'remove-message', { sessionId: id })
    send('session:messageRemoved', { id, messageId })
    return true
  },

  removeMessagesFrom(id: string, messageId: string): boolean {
    const sessions = store.get('sessions', [])
    const s = sessions.find((session) => session.id === id)
    if (!s) return false
    const index = s.messages.findIndex((message) => message.id === messageId)
    if (index < 0) return false

    const removedMessages = s.messages.slice(index)
    for (const message of removedMessages) {
      clearActiveStreamingMessage(id, message.id)
      removePendingFollowUp(id, message.id)
    }
    s.messages = s.messages.slice(0, index)
    s.providerSessionId = null
    s.claudeSessionId = null
    s.providerThreadSource = undefined
    s.providerProjectless = undefined
    s.providerProjectlessThreadId = null
    s.previewText = sessionPreviewText(s.messages, s.name)
    s.latestMessageAt = s.messages.at(-1)?.timestamp ?? s.createdAt
    setSessionsStore(sessions, 'remove-messages-from', { sessionId: id, removedMessages: removedMessages.length })
    for (const message of removedMessages) send('session:messageRemoved', { id, messageId: message.id })
    send('session:updated', {
      id,
      providerSessionId: null,
      claudeSessionId: null,
      providerThreadSource: undefined,
      providerProjectless: undefined,
      providerProjectlessThreadId: null,
      previewText: s.previewText,
      latestMessageAt: s.latestMessageAt,
      messageCount: s.messages.length,
      messagesLoaded: true
    })
    return true
  },

  restoreMessages(id: string, snapshot: MessageEditSnapshot): boolean {
    if (snapshot.messages.length === 0) return false
    const sessions = store.get('sessions', [])
    const s = sessions.find((session) => session.id === id)
    if (!s) return false
    const existingIds = new Set(s.messages.map((message) => message.id))
    const messages = snapshot.messages.filter((message) => !existingIds.has(message.id))
    if (messages.length === 0) return false
    s.messages = [...s.messages, ...messages]
    s.providerSessionId = snapshot.providerSessionId
    s.claudeSessionId = snapshot.claudeSessionId
    s.providerThreadSource = snapshot.providerThreadSource
    s.providerProjectless = snapshot.providerProjectless
    s.providerProjectlessThreadId = snapshot.providerProjectlessThreadId
    s.previewText = snapshot.previewText ?? sessionPreviewText(s.messages, s.name)
    s.latestMessageAt = snapshot.latestMessageAt ?? s.messages.at(-1)?.timestamp ?? s.createdAt
    setSessionsStore(sessions, 'restore-messages', { sessionId: id, messages: messages.length })
    send('session:messages', { id, messages })
    send('session:updated', {
      id,
      providerSessionId: s.providerSessionId,
      claudeSessionId: s.claudeSessionId,
      providerThreadSource: s.providerThreadSource,
      providerProjectless: s.providerProjectless,
      providerProjectlessThreadId: s.providerProjectlessThreadId,
      previewText: s.previewText,
      latestMessageAt: s.latestMessageAt,
      messageCount: s.messages.length,
      messagesLoaded: true
    })
    return true
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
    const storedProviderModels = settingsStore.get('providerModels', {}) as Record<string, string[]>
    const storedEfforts = settingsStore.get('defaultEfforts', {}) as Record<string, string>
    const storedPermissionModes = settingsStore.get('defaultPermissionModes', {}) as Record<string, string>
    const orderedModels = normalizeProviderModelOrder(providerDef, storedProviderModels[providerDef.id] ?? [])
    const defaultModel = orderedModels[0] ?? storedModels[providerDef.id] ?? getConfigurableModels(providerDef)[0]?.id ?? ''
    const defaultEffort = storedEfforts[providerDef.id] ?? providerDef.effortLevels[0]?.id ?? 'normal'
    const defaultPermissionMode = getDefaultPermissionMode(providerDef, storedPermissionModes[providerDef.id])

    const session: Session = {
      id,
      name: 'New Chat',
      nameSource: 'default',
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

  async fork(sessionId: string, mode: SessionForkMode, options: SessionForkOptions = {}): Promise<Session> {
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

    const beforeMessageIndex = options.beforeMessageId
      ? source.messages.findIndex((message) => message.id === options.beforeMessageId)
      : -1
    const throughMessageIndex = options.throughMessageId
      ? source.messages.findIndex((message) => message.id === options.throughMessageId)
      : -1
    const sourceMessages = options.beforeMessageId
      ? source.messages.slice(0, beforeMessageIndex)
      : options.throughMessageId
        ? source.messages.slice(0, throughMessageIndex + 1)
        : source.messages
    if (options.beforeMessageId && beforeMessageIndex < 0) {
      throw new Error(`Message ${options.beforeMessageId} not found`)
    }
    if (options.throughMessageId && throughMessageIndex < 0) {
      throw new Error(`Message ${options.throughMessageId} not found`)
    }

    const messages: ChatMessage[] = [
      ...sourceMessages.map(cloneMessageForFork),
      {
        id: `forked-from-${source.id}-${now}`,
        role: 'system',
        type: 'text',
        content: options.beforeMessageId
          ? `Forked from "${source.name}" before a selected message.`
          : options.throughMessageId
            ? `Forked from "${source.name}" at a selected message.`
            : `Forked from "${source.name}".`,
        timestamp: now
      }
    ]
    const forked: Session = {
      ...source,
      id,
      name: `Forked: ${source.name}`,
      nameSource: 'system',
      pinned: false,
      pinOrder: undefined,
      projectId: source.projectId,
      workDir,
      useWorktree,
      worktreeState,
      repoRoot,
      providerSessionId: null,
      claudeSessionId: null,
      providerThreadSource: undefined,
      providerHostId: undefined,
      providerHostLabel: undefined,
      providerWorktreeSourceRoot: undefined,
      providerWorktreeRoot: undefined,
      providerWorktreeHostId: undefined,
      providerWorktreeHostLabel: undefined,
      providerPinned: false,
      providerPinOrder: undefined,
      providerPinnedThreadKey: undefined,
      providerProjectless: false,
      providerProjectlessThreadId: undefined,
      status: worktreeState === 'pending' ? 'reconnecting' : 'idle',
      messages,
      messageCount: messages.length,
      messagesLoaded: true,
      previewText: undefined,
      latestMessageAt: now,
      forkedFromSessionId: source.id,
      forkedFromSessionName: source.name,
      forkedFromMessageId: options.beforeMessageId ?? options.throughMessageId,
      forkedAt: now,
      forkMode: mode,
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

  openAgentThread(request: AgentThreadOpenRequest): AgentThreadOpenResult {
    const source = this.get(request.sourceSessionId)
    if (!source) return { ok: false, error: `Session ${request.sourceSessionId} not found` }

    const providerId = request.providerId || source.provider
    const providerThreadId = request.providerThreadId?.trim()
    const providerAgentId = request.providerAgentId?.trim()
    if (providerId === 'claude' && !providerThreadId && !providerAgentId) {
      return {
        ok: false,
        error: 'Claude did not expose an agent id or child thread id for this row.'
      }
    }
    const parentThreadId = request.parentThreadId?.trim() || source.providerSessionId || source.claudeSessionId || null
    if (!providerThreadId && !parentThreadId) {
      return { ok: false, error: 'Provider did not expose a thread or session id for this agent.' }
    }
    if (providerId === 'claude' && providerAgentId && !parentThreadId) {
      return { ok: false, error: 'Claude exposed an agent id, but no parent SDK session id was available to resume.' }
    }

    const providerSessionId = providerId === 'claude'
      ? providerAgentId ? parentThreadId : providerThreadId ?? parentThreadId
      : providerThreadId ?? parentThreadId
    if (!providerSessionId) {
      return { ok: false, error: 'Provider did not expose a resumable session id for this agent.' }
    }

    const now = Date.now()
    const title = request.title.trim() || 'Agent thread'
    const sessions = store.get('sessions', [])
    const existing = sessions.find((session) => (
      session.id !== source.id &&
      session.provider === providerId &&
      session.providerSessionId === providerSessionId &&
      (
        providerId !== 'claude' ||
        session.providerProjectlessThreadId === (providerAgentId ?? providerThreadId) ||
        (!providerAgentId && !providerThreadId && !session.providerProjectlessThreadId)
      )
    ))
    const resumePrompt = undefined
    if (existing) {
      let changed = false
      if (shouldRefreshAgentThreadTitle(existing.name, title)) {
        existing.name = title
        existing.nameSource = 'provider'
        changed = true
      }
      const previewText = request.transcript?.trim() || agentThreadPreview(providerId, title, providerAgentId, providerThreadId)
      if (existing.previewText !== previewText) {
        existing.previewText = previewText
        changed = true
      }
      if (existing.providerProjectless !== true) {
        existing.providerProjectless = true
        changed = true
      }
      const expectedProjectlessThreadId = providerId === 'claude' ? providerAgentId ?? providerThreadId ?? null : providerThreadId ?? null
      if (existing.providerProjectlessThreadId !== expectedProjectlessThreadId) {
        existing.providerProjectlessThreadId = expectedProjectlessThreadId
        changed = true
      }
      if (changed) {
        existing.latestMessageAt = Math.max(existing.latestMessageAt ?? 0, now)
        setSessionsStore(sessions, 'open-agent-thread', { sessionId: existing.id, providerId })
        send('session:updated', {
          id: existing.id,
          name: existing.name,
          nameSource: existing.nameSource,
          providerProjectless: existing.providerProjectless,
          providerProjectlessThreadId: existing.providerProjectlessThreadId,
          previewText: existing.previewText,
          latestMessageAt: existing.latestMessageAt
        })
      }
      return { ok: true, session: existing, reused: true, resumePrompt }
    }

    const note = agentThreadOpenedNote(providerId, title, providerAgentId, providerThreadId, parentThreadId)
    const messages: ChatMessage[] = [{
      id: `agent-thread-opened-${now}`,
      role: 'system',
      type: 'text',
      content: note,
      timestamp: now
    }]
    if (request.transcript?.trim()) {
      messages.push({
        id: `agent-thread-transcript-${now}`,
        role: 'assistant',
        type: 'text',
        content: request.transcript.trim(),
        timestamp: now
      })
    }

    const session: Session = {
      ...source,
      id: uuidv4(),
      name: title,
      nameSource: 'provider',
      pinned: false,
      pinOrder: undefined,
      provider: providerId,
      providerSessionId,
      claudeSessionId: providerId === 'claude' ? providerSessionId : null,
      providerThreadSource: providerId === 'codex' ? 'cloud' : source.providerThreadSource,
      providerProjectless: true,
      providerProjectlessThreadId: providerId === 'claude' ? providerAgentId ?? providerThreadId ?? null : providerThreadId ?? null,
      providerPinned: false,
      providerPinOrder: undefined,
      providerPinnedThreadKey: undefined,
      status: 'idle',
      messages,
      messageCount: messages.length,
      messagesLoaded: true,
      previewText: request.transcript?.trim() || agentThreadPreview(providerId, title, providerAgentId, providerThreadId),
      latestMessageAt: now,
      forkedFromSessionId: source.id,
      forkedFromSessionName: source.name,
      forkedFromMessageId: undefined,
      forkedAt: now,
      forkMode: 'local',
      archivedAt: undefined,
      createdAt: now
    }

    this.save(session)
    send('session:created', session)
    return { ok: true, session, reused: false, resumePrompt }
  },

  updateSessionName(id: string, name: string, source: SessionNameSource): boolean {
    const nextName = name.trim()
    if (!nextName) return false
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      const changed = s.name !== nextName || s.nameSource !== source
      s.name = nextName
      s.nameSource = source
      store.set('sessions', sessions)
      if (changed) {
        send('session:renamed', { id, name: nextName, nameSource: source })
      }
      return true
    }
    return false
  },

  updateName(id: string, name: string): void {
    this.updateSessionName(id, name, 'user')
  },

  updateProviderName(id: string, name: string): boolean {
    const session = this.get(id)
    if (!session || !canApplyProviderSessionName(session)) return false
    return this.updateSessionName(id, name, 'provider')
  },

  async updatePinned(id: string, pinned: boolean): Promise<void> {
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

  async reorderPinned(orderedPinnedSessionIds: string[]): Promise<void> {
    const sessions = ensurePinnedOrders(store.get('sessions', []))
    const nextSessions = reorderPinnedSessions(sessions, orderedPinnedSessionIds)
    const changed = nextSessions.filter((nextSession, index) => (
      nextSession.pinned !== sessions[index]?.pinned ||
      nextSession.pinOrder !== sessions[index]?.pinOrder ||
      nextSession.providerPinned !== sessions[index]?.providerPinned ||
      nextSession.providerPinOrder !== sessions[index]?.providerPinOrder ||
      nextSession.providerPinnedThreadKey !== sessions[index]?.providerPinnedThreadKey
    ))
    if (changed.length === 0) return
    store.set('sessions', nextSessions)
    for (const session of changed) {
      const previous = sessions.find((candidate) => candidate.id === session.id)
      if (!previous) continue
      if (previous.pinned !== session.pinned || previous.pinOrder !== session.pinOrder) {
        send('session:pinned', { id: session.id, pinned: session.pinned === true, pinOrder: session.pinOrder })
      }
      if (
        previous.providerPinned !== session.providerPinned ||
        previous.providerPinOrder !== session.providerPinOrder ||
        previous.providerPinnedThreadKey !== session.providerPinnedThreadKey
      ) {
        send('session:updated', {
          id: session.id,
          providerPinned: session.providerPinned,
          providerPinOrder: session.providerPinOrder,
          providerPinnedThreadKey: session.providerPinnedThreadKey
        })
      }
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
        name: session.name,
        nameSource: session.nameSource,
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
        flushActiveStreamingMessagesToStore(sessionId)
        activeToolUseIds.delete(sessionId)
        const followUp = shiftPendingFollowUp(sessionId)
        if (followUp) {
          for (const message of this.get(sessionId)?.messages ?? []) {
            if (message.type === 'text' && message.isStreaming) {
              const settledMessage: TextMessage = {
                ...message,
                isStreaming: false
              }
              if (message.role === 'assistant') settledMessage.interrupted = true
              this.upsertMessage(sessionId, settledMessage)
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
    if (options.editFromMessageId && providerRuntime.hasActiveRun(sessionId)) return false
    const editIndex = options.editFromMessageId
      ? session.messages.findIndex((message) => message.id === options.editFromMessageId)
      : -1
    const editSnapshot: MessageEditSnapshot | null = editIndex >= 0
      ? {
          messages: session.messages.slice(editIndex),
          providerSessionId: session.providerSessionId,
          claudeSessionId: session.claudeSessionId,
          providerThreadSource: session.providerThreadSource,
          providerProjectless: session.providerProjectless,
          providerProjectlessThreadId: session.providerProjectlessThreadId,
          previewText: session.previewText,
          latestMessageAt: session.latestMessageAt
        }
      : null
    if (options.editFromMessageId && !this.removeMessagesFrom(sessionId, options.editFromMessageId)) return false
    const editableSession = options.editFromMessageId ? this.get(sessionId) : session
    if (!editableSession) throw new Error(`Session ${sessionId} not found`)
    const activeProviderId = editableSession.provider ?? 'claude'
    const effectivePrompt = promptWithPersonalization(promptWithLocalAttachments(prompt, attachments))
    const runtimeAttachments = activeProviderId === 'codex' ? attachments : claudeResourceAttachmentSpecs(attachments)
    const simulateSendStartFailure =
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'composer' &&
      prompt === 'SEND_PROVIDER_FALSE_SMOKE'
    if (providerRuntime.hasActiveRun(sessionId)) {
      if (editableSession.runtime === 'interactive' && editableSession.status === 'idle') {
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
    if (useWorktree !== undefined && editableSession.messages.length === 0) {
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
        setSessionsStore(sessions, 'worktree-selection', { sessionId, useWorktree: s.useWorktree === true })
        send('session:updated', { id: sessionId, workDir: s.workDir, useWorktree: s.useWorktree, worktreeState: s.worktreeState })
      }
    }

    // Auto-name session from first user message (uniform across all providers)
    const freshSession = this.get(sessionId)
    const shouldAutoName = freshSession && freshSession.messages.filter((m) => m.role === 'user').length === 0
    const previousName = freshSession?.name
    const previousNameSource = freshSession?.nameSource
    if (freshSession && shouldAutoName) {
      this.updateSessionName(sessionId, compactSessionName(prompt), 'first-message')
    }

    this.updateStatus(sessionId, 'running')

    const userMessageId = uuidv4()
    const userMsg: ChatMessage = {
      id: userMessageId,
      role: 'user',
      type: 'text',
      content: prompt,
      attachments,
      timestamp: Date.now()
    }
    this.appendMessage(sessionId, [userMsg])

    const currentSession = this.get(sessionId)!
    const provider = getProvider(currentSession.provider ?? 'claude')
    const runPrompt = promptWithCursorSdkUnansweredContext(currentSession, effectivePrompt)
    let runRequest: RunRequest = applyAutomationPermissionSnapshot({
      ...requestFromSession(currentSession, runPrompt),
      attachments: provider.id === 'codex' ? attachments : claudeResourceAttachmentSpecs(attachments)
    }, options.permissionSnapshot)
    const mode = currentSession.providerSessionId ? 'resume' : 'start'
    try {
      const started = simulateSendStartFailure
        ? false
        : await this.startProviderRun(sessionId, currentSession, provider, runRequest, mode, options.onProviderRunComplete)
      if (!started) {
        this.removeMessage(sessionId, userMessageId)
        if (editSnapshot) this.restoreMessages(sessionId, editSnapshot)
        if (previousName && shouldAutoName) this.updateSessionName(sessionId, previousName, previousNameSource ?? 'default')
        if (simulateSendStartFailure) {
          const message = 'Provider runtime failed to start.'
          this.appendMessage(sessionId, [{
            id: uuidv4(),
            role: 'system',
            type: 'result',
            content: message,
            subtype: 'error_during_execution',
            timestamp: Date.now()
          }])
          this.updateStatus(sessionId, 'error')
          options.onProviderRunComplete?.({ ok: false, error: message })
        }
      }
      return started
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.removeMessage(sessionId, userMessageId)
      if (editSnapshot) this.restoreMessages(sessionId, editSnapshot)
      if (previousName && shouldAutoName) this.updateSessionName(sessionId, previousName, previousNameSource ?? 'default')
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: message,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      options.onProviderRunComplete?.({ ok: false, error: message })
      return false
    }
  },

  async startCodexReview(sessionId: string, request: CodexReviewStartRequest): Promise<CodexReviewStartResult> {
    const session = this.get(sessionId)
    if (!session) return { ok: false, error: `Session ${sessionId} not found` }
    if ((session.provider ?? 'claude') !== 'codex') return { ok: false, error: 'Native Review mode is only available for Codex sessions.' }
    if (providerRuntime.hasActiveRun(sessionId)) return { ok: false, error: 'A provider run is already active in this session.' }

    const label = codexReviewStartLabel(request)
    this.updateStatus(sessionId, 'running')
    const userMessageId = uuidv4()
    this.appendMessage(sessionId, [{
      id: userMessageId,
      role: 'user',
      type: 'text',
      content: label,
      timestamp: Date.now()
    }])

    const currentSession = this.get(sessionId) ?? session
    const provider = getProvider('codex')
    const runRequest: RunRequest = {
      ...requestFromSession(currentSession, label),
      runtime: 'app-server',
      codexReviewStart: request
    }
    const mode = currentSession.providerSessionId ? 'resume' : 'start'
    try {
      const started = await this.startProviderRun(sessionId, currentSession, provider, runRequest, mode)
      if (!started) {
        this.removeMessage(sessionId, userMessageId)
        this.updateStatus(sessionId, 'error')
        return { ok: false, error: 'Codex Review failed to start.' }
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.removeMessage(sessionId, userMessageId)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: message,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return { ok: false, error: message }
    }
  },

  async retryLastUserMessage(sessionId: string): Promise<boolean> {
    const session = this.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const lastUserMessage = [...session.messages]
      .reverse()
      .find((message): message is TextMessage & { role: 'user' } =>
        message.type === 'text' && message.role === 'user' && message.content.trim().length > 0
    )
    if (!lastUserMessage) return false
    if (providerRuntime.hasActiveRun(sessionId)) return false
    const simulateRetryPreparationFailure =
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-layout' ||
        process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-tool-failure') &&
      lastUserMessage.content.includes('RETRY_PREPARE_THROW_SMOKE')
    if (
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-layout' ||
        process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-tool-failure') &&
      !simulateRetryPreparationFailure
    ) {
      return true
    }

    const attachments = lastUserMessage.attachments ?? []
    const provider = getProvider(session.provider ?? 'claude')
    const effectivePrompt = promptWithPersonalization(promptWithLocalAttachments(lastUserMessage.content, attachments))
    const runtimeAttachments = provider.id === 'codex' ? attachments : claudeResourceAttachmentSpecs(attachments)
    this.updateStatus(sessionId, 'running')

    const currentSession = this.get(sessionId)!
    const mode = currentSession.providerSessionId ? 'resume' : 'start'
    const runPrompt = promptWithCursorSdkUnansweredContext(currentSession, effectivePrompt)
    const runRequest: RunRequest = {
      ...requestFromSession(currentSession, runPrompt),
      runtime: currentSession.runtime,
      attachments: runtimeAttachments
    }
    try {
      if (simulateRetryPreparationFailure) throw new Error('Smoke retry request preparation failed.')
      return await this.startProviderRun(sessionId, currentSession, provider, runRequest, mode)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: message,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return false
    }
  },

  async continueLastTurn(sessionId: string): Promise<boolean> {
    const session = this.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (providerRuntime.hasActiveRun(sessionId)) return false
    const lastAssistantText = [...session.messages].reverse().find((message): message is TextMessage =>
      message.type === 'text' && message.role === 'assistant' && message.content.trim().length > 0
    )
    if (!lastAssistantText) return false
    const simulateContinueStartFailure =
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-layout' &&
      lastAssistantText.content.includes('CONTINUE_START_FAIL_SMOKE')
    if (
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-layout' &&
      !simulateContinueStartFailure
    ) {
      return true
    }

    const prompt = lastAssistantText.interrupted
      ? 'Continue from where you left off. The previous assistant response stopped mid-stream; do not repeat completed content unless necessary.'
      : 'Continue from where you left off.'
    const effectivePrompt = promptWithPersonalization(prompt)
    const continueMessageId = uuidv4()
    this.updateStatus(sessionId, 'running')
    this.appendMessage(sessionId, [{
      id: continueMessageId,
      role: 'user',
      type: 'text',
      content: prompt,
      timestamp: Date.now()
    }])

    const currentSession = this.get(sessionId)!
    const provider = getProvider(currentSession.provider ?? 'claude')
    const mode = currentSession.providerSessionId ? 'resume' : 'start'
    const runRequest: RunRequest = {
      ...requestFromSession(currentSession, effectivePrompt),
      runtime: currentSession.runtime,
      attachments: []
    }
    try {
      const started = simulateContinueStartFailure
        ? false
        : await this.startProviderRun(sessionId, currentSession, provider, runRequest, mode)
      if (!started) {
        this.removeMessage(sessionId, continueMessageId)
        if (simulateContinueStartFailure) {
          this.appendMessage(sessionId, [{
            id: uuidv4(),
            role: 'system',
            type: 'result',
            content: 'Provider runtime failed to start.',
            subtype: 'error_during_execution',
            timestamp: Date.now()
          }])
          this.updateStatus(sessionId, 'error')
        }
      }
      return started
    } catch (error) {
      this.removeMessage(sessionId, continueMessageId)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: error instanceof Error ? error.message : String(error),
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return false
    }
  },

  applyRunEvents(sessionId: string, events: RunEvent[]): void {
    if (events.length === 0) return
    const applyStartedAt = performance.now()
    const streamingDeltaCount = events.filter((event) =>
      event.type === 'assistant.text.delta' || event.type === 'assistant.thinking.delta'
    ).length

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
        setSessionsStore(sessions, 'provider-session-id', { sessionId })
      }
    }

    const providerNameEvent = [...events].reverse().find((event) => event.type === 'session.name.updated')
    if (providerNameEvent?.type === 'session.name.updated') {
      const current = this.get(sessionId)
      if (
        current &&
        canApplyProviderSessionName(current) &&
        (!providerNameEvent.providerSessionId ||
          providerNameEvent.providerSessionId === current.providerSessionId ||
          providerNameEvent.providerSessionId === decision.providerSessionId)
      ) {
        this.updateSessionName(sessionId, providerNameEvent.name, 'provider')
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
        setSessionsStore(sessions, 'usage-summary', { sessionId, usageEvents: usageEvents.length })
        send('session:settingsUpdated', { id: sessionId, usageSummary: s.usageSummary })
      }
    }

    for (const event of events) {
      if (shouldClearThinkingTrace(event)) clearThinkingTraceMessages(sessionId)

      if (event.type === 'assistant.text.delta') {
        const key = streamingMessageKey(sessionId, event.streamId)
        const activeRecord = activeStreamingMessages.get(key)
        const activeMessage = activeRecord?.message
        const existing = activeMessage?.type === 'text'
          ? activeMessage
          : this.get(sessionId)?.messages.find((message) => message.id === event.streamId && message.type === 'text')
        const message: TextMessage = {
          id: event.streamId,
          role: 'assistant',
          type: 'text',
          content: event.replace ? event.content : `${existing?.type === 'text' ? existing.content : ''}${event.content}`,
          timestamp: existing?.timestamp ?? Date.now(),
          isStreaming: true
        }
        const now = Date.now()
        if (!activeRecord) {
          this.upsertMessage(sessionId, message)
        } else if (now - activeRecord.lastPersistedAt >= STREAMING_MESSAGE_PERSIST_INTERVAL_MS) {
          this.upsertMessage(sessionId, message)
        } else {
          activeStreamingMessages.set(key, { id: sessionId, message, lastPersistedAt: activeRecord.lastPersistedAt })
          sendMessageUpdated(sessionId, message)
        }
      } else if (event.type === 'assistant.text.completed') {
        const activeMessage = activeStreamingRecord(sessionId, event.streamId)?.message
        const existing = activeMessage?.type === 'text'
          ? activeMessage
          : this.get(sessionId)?.messages.find((message) => message.id === event.streamId && message.type === 'text')
        if (existing?.type === 'text') {
          clearActiveStreamingMessage(sessionId, event.streamId)
          this.upsertMessage(sessionId, {
            ...existing,
            content: typeof event.content === 'string' ? event.content : existing.content,
            isStreaming: false
          })
        } else if (typeof event.content === 'string') {
          clearActiveStreamingMessage(sessionId, event.streamId)
          this.upsertMessage(sessionId, {
            id: event.streamId,
            role: 'assistant',
            type: 'text',
            content: event.content,
            timestamp: Date.now(),
            isStreaming: false
          })
        }
      } else if (event.type === 'assistant.thinking.delta') {
        const key = streamingMessageKey(sessionId, event.streamId)
        const activeRecord = activeStreamingMessages.get(key)
        const activeMessage = activeRecord?.message
        const existing = activeMessage?.type === 'result'
          ? activeMessage
          : this.get(sessionId)?.messages.find((message) => message.id === event.streamId && message.type === 'result')
        const message: ResultMessage = {
          id: event.streamId,
          role: 'system',
          type: 'result',
          content: event.replace ? event.content : `${existing?.type === 'result' ? existing.content : ''}${event.content}`,
          subtype: 'thinking',
          timestamp: existing?.timestamp ?? Date.now(),
          isStreaming: true
        }
        const now = Date.now()
        if (!activeRecord) {
          this.upsertMessage(sessionId, message)
        } else if (now - activeRecord.lastPersistedAt >= STREAMING_MESSAGE_PERSIST_INTERVAL_MS) {
          this.upsertMessage(sessionId, message)
        } else {
          activeStreamingMessages.set(key, { id: sessionId, message, lastPersistedAt: activeRecord.lastPersistedAt })
          sendMessageUpdated(sessionId, message)
        }
      } else if (event.type === 'assistant.thinking.completed') {
        const activeMessage = activeStreamingRecord(sessionId, event.streamId)?.message
        const existing = activeMessage?.type === 'result'
          ? activeMessage
          : this.get(sessionId)?.messages.find((message) => message.id === event.streamId && message.type === 'result')
        if (existing?.type === 'result') {
          clearActiveStreamingMessage(sessionId, event.streamId)
          this.upsertMessage(sessionId, {
            ...existing,
            content: typeof event.content === 'string' ? event.content : existing.content,
            isStreaming: false
          })
        } else if (typeof event.content === 'string') {
          clearActiveStreamingMessage(sessionId, event.streamId)
          this.upsertMessage(sessionId, {
            id: event.streamId,
            role: 'system',
            type: 'result',
            content: event.content,
            subtype: 'thinking',
            timestamp: Date.now(),
            isStreaming: false
          })
        }
      }
    }

    const messages = eventsToMessages(lifecycleEvents)
    if (messages.length > 0) this.appendMessage(sessionId, messages)

    if (hasSteerableFollowUp(sessionId) && !hasActiveTool(sessionId)) {
      providerRuntime.interrupt(sessionId)
    }

    const durationMs = performance.now() - applyStartedAt
    if (durationMs >= 4 || events.length > 1 || streamingDeltaCount > 1) {
      recordPerformanceMetric({
        name: 'session.applyRunEvents',
        surface: 'main',
        startedAt: Date.now() - durationMs,
        durationMs,
        metadata: {
          sessionId,
          events: events.length,
          streamingDeltas: streamingDeltaCount,
          activeStreamingMessages: activeStreamingMessages.size
        }
      })
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
      if (patch.provider && patch.provider !== s.provider && !canSwitchSessionProvider(s)) {
        return
      }
      if (normalizedPatch.provider) {
        normalizedPatch.runtime = defaultRuntimeForProvider(normalizedPatch.provider)
        if (!patch.permissionMode) {
          const providerDef = PROVIDER_DEFS[normalizedPatch.provider] ?? PROVIDER_DEFS.claude
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
    flushActiveStreamingMessagesToStore(sessionId)
    const session = this.get(sessionId)
    const shouldClearVisibleStatus =
      session?.status === 'running' ||
      session?.status === 'waiting_for_permission' ||
      session?.status === 'waiting_for_user' ||
      session?.status === 'reconnecting'
    const queuedMessageIds = pendingFollowUpMessageIds(sessionId)
    if (providerRuntime.hasActiveRun(sessionId)) {
      for (const message of session?.messages ?? []) {
        if (message.type === 'text' && queuedMessageIds.has(message.id)) {
          this.removeMessage(sessionId, message.id)
          continue
        }
        if (message.type === 'text' && (message.queueState || message.isStreaming)) {
          const settledMessage: TextMessage = {
            ...message,
            queueState: undefined,
            isStreaming: false
          }
          if (message.role === 'assistant' && message.isStreaming) settledMessage.interrupted = true
          this.upsertMessage(sessionId, settledMessage)
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

  cancelQueuedMessage(sessionId: string, messageId: string): boolean {
    const removedPending = removePendingFollowUp(sessionId, messageId)
    const sessions = store.get('sessions', [])
    const rawMessage = sessions
      .find((session) => session.id === sessionId)
      ?.messages.find((candidate) => candidate.id === messageId)
    if (rawMessage?.type === 'text' && (rawMessage.queueState || removedPending)) {
      return this.removeMessage(sessionId, messageId) || removedPending
    }
    return removedPending
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

    this.updateStatus(sessionId, 'running')

    const provider = getProvider(session.provider ?? 'claude')
    const mode = session.providerSessionId ? 'resume' : 'start'
    const runPrompt = promptWithCursorSdkUnansweredContext(session, followUp.prompt)
    let runRequest: RunRequest = {
      ...requestFromSession(session, runPrompt),
      runtime: session.runtime,
      attachments: followUp.attachments ?? []
    }
    try {
      if (
        process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
        followUp.prompt.includes('QUEUED_FOLLOW_UP_START_FAIL_SMOKE')
      ) {
        throw new Error('Smoke queued follow-up failed to start.')
      }
      const started = await this.startProviderRun(sessionId, session, provider, runRequest, mode)
      if (started && queuedMessage?.type === 'text') {
        this.upsertMessage(sessionId, { ...queuedMessage, queueState: undefined })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: message,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
    }
  },

  async grantAndResume(sessionId: string, toolNames: string[]): Promise<SessionActionResult> {
    return this.resumeAfterPermission(sessionId, toolNames, true)
  },

  async allowOnceAndResume(sessionId: string, toolNames: string[]): Promise<SessionActionResult> {
    return this.resumeAfterPermission(sessionId, toolNames, false)
  },

  async resumeAfterPermission(sessionId: string, toolNames: string[], persistGrant: boolean): Promise<SessionActionResult> {
    const session = this.get(sessionId)
    if (!session) return { ok: false, error: `Session ${sessionId} not found.` }

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
      markLatestPermissionDecision(sessionId, persistGrant ? 'allowed_session' : 'allowed_once')
      this.updateStatus(sessionId, 'running')
      return { ok: true }
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
      markLatestPermissionDecision(sessionId, persistGrant ? 'allowed_session' : 'allowed_once')
      this.updateStatus(sessionId, 'running')
      return { ok: true }
    }

    if (!session.providerSessionId) {
      return { ok: false, error: 'No active provider session is available to resume.' }
    }
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
    const simulatePermissionResumePreparationFailure =
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      currentSession.messages.some((message) =>
        message.type === 'text' && message.content.includes('PERMISSION_RESUME_PREPARE_THROW_SMOKE')
      )
    let runRequest: RunRequest = {
      ...requestFromSession(currentSession, 'Permission granted. Please continue.'),
      allowedTools: persistGrant
        ? (currentSession.allowedTools ?? [])
        : mergeToolNames(currentSession.allowedTools, toolNames),
      runtime: currentSession.runtime
    }
    let started = false
    try {
      if (simulatePermissionResumePreparationFailure) throw new Error('Smoke permission resume request preparation failed.')
      started = await this.startProviderRun(sessionId, currentSession, resumeProvider, runRequest, 'resume')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: message,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return { ok: false, error: message }
    }
    if (!started) return { ok: false, error: 'Provider runtime failed to resume after permission approval.' }
    markLatestPermissionDecision(sessionId, persistGrant ? 'allowed_session' : 'allowed_once')
    return { ok: true }
  },

  async answerUserInput(sessionId: string, answer: string | UserInputAnswerPayload): Promise<SessionActionResult> {
    const session = this.get(sessionId)
    if (!session) return { ok: false, error: `Session ${sessionId} not found.` }
    const payload = normalizeUserInputAnswer(answer)
    const trimmed = payload.content
    const displayContent = payload.displayContent ?? trimmed
    if (!trimmed) return { ok: false, error: 'Answer is empty.' }
    const simulateUserInputResumePreparationFailure =
      process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT &&
      trimmed.includes('SMOKE_USER_INPUT_RESUME_THROW')
    if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT && !simulateUserInputResumePreparationFailure) {
      if (trimmed.includes('SMOKE_MISSING_RESUME')) {
        return { ok: false, error: 'No active provider session is available to resume.' }
      }
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'user',
        type: 'text',
        content: displayContent,
        timestamp: Date.now()
      }])
      if (session.status === 'waiting_for_permission') markLatestPermissionDecision(sessionId, 'kept_planning')
      this.updateStatus(sessionId, 'running')
      return { ok: true }
    }

    if (providerRuntime.answerUserInput(sessionId, payload)) {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'user',
        type: 'text',
        content: displayContent,
        timestamp: Date.now()
      }])
      if (session.status === 'waiting_for_permission') markLatestPermissionDecision(sessionId, 'kept_planning')
      this.updateStatus(sessionId, 'running')
      return { ok: true }
    }

    if (providerRuntime.hasActiveRun(sessionId) && session.runtime === 'interactive') {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'user',
        type: 'text',
        content: displayContent,
        timestamp: Date.now()
      }])
      if (session.status === 'waiting_for_permission') markLatestPermissionDecision(sessionId, 'kept_planning')
      this.updateStatus(sessionId, 'running')
      providerRuntime.write(sessionId, `${trimmed}\r`)
      return { ok: true }
    }

    if (providerRuntime.hasActiveRun(sessionId)) providerRuntime.stop(sessionId)

    if (!session.providerSessionId) {
      return { ok: false, error: 'No active provider session is available to resume.' }
    }

    this.appendMessage(sessionId, [{
      id: uuidv4(),
      role: 'user',
      type: 'text',
      content: displayContent,
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
    let started = false
    try {
      if (simulateUserInputResumePreparationFailure) throw new Error('Smoke user input resume request preparation failed.')
      started = await this.startProviderRun(sessionId, currentSession, resumeProvider, runRequest, 'resume')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: message,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return { ok: false, error: message }
    }
    if (!started) return { ok: false, error: 'Provider runtime failed to resume after user input.' }
    if (session.status === 'waiting_for_permission') markLatestPermissionDecision(sessionId, 'kept_planning')
    return { ok: true }
  },

  denyPermission(sessionId: string): SessionActionResult {
    const session = this.get(sessionId)
    if (!session) return { ok: false, error: `Session ${sessionId} not found.` }
    if (providerRuntime.resolvePermission(sessionId, false, false)) {
      markLatestPermissionDecision(sessionId, 'denied')
      this.updateStatus(sessionId, 'running')
      return { ok: true }
    }
    if (approvalBroker.hasPendingApproval(sessionId)) {
      markLatestPermissionDecision(sessionId, 'denied')
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
      return { ok: true }
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
    markLatestPermissionDecision(sessionId, 'denied')
    this.appendMessage(sessionId, [{
      id: uuidv4(),
      role: 'system',
      type: 'result',
      content: 'Permission denied by user.',
      subtype: 'permission_denied',
      timestamp: Date.now()
    }])
    this.updateStatus(sessionId, 'idle')
    return { ok: true }
  },

  async answerSideQuestion(sessionId: string, question: string, sideChatMessages: SideQuestionMessage[] = []): Promise<{ ok: boolean; answer: string; error?: string; usage?: UsageSummary }> {
    const session = this.get(sessionId)
    if (!session) return { ok: false, answer: '', error: `Session ${sessionId} not found.` }
    const trimmed = question.trim()
    if (!trimmed) return { ok: false, answer: '', error: 'Question is empty.' }
    const effectivePrompt = promptWithPersonalization(sideQuestionPrompt(session, trimmed, sideChatMessages))
    if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) {
      if (trimmed.toLowerCase().includes('smoke follow-up context check')) {
        const hasPriorUser = effectivePrompt.includes('user: smoke threaded context seed')
        const hasPriorAssistant = effectivePrompt.includes('assistant: Smoke side answer for: smoke threaded context seed')
        return {
          ok: hasPriorUser && hasPriorAssistant,
          answer: hasPriorUser && hasPriorAssistant
            ? 'Smoke side follow-up retained prior side-chat context'
            : '',
          error: hasPriorUser && hasPriorAssistant ? undefined : 'Smoke side follow-up context missing.',
          usage: {
            inputTokens: 18,
            outputTokens: 9,
            totalTokens: 27,
            totalCostUsd: 0,
            durationMs: 120,
            apiDurationMs: 80,
            turns: 1
          }
        }
      }
      if (trimmed.toLowerCase().includes('smoke personalization check')) {
        const hasCustomInstructions = effectivePrompt.includes('SMOKE_SIDE_CUSTOM_INSTRUCTIONS')
        const hasCodingPreferences = effectivePrompt.includes('SMOKE_SIDE_CODING_PREFS')
        return {
          ok: hasCustomInstructions && hasCodingPreferences,
          answer: hasCustomInstructions && hasCodingPreferences
            ? 'Smoke side personalization applied: SMOKE_SIDE_CUSTOM_INSTRUCTIONS + SMOKE_SIDE_CODING_PREFS'
            : '',
          error: hasCustomInstructions && hasCodingPreferences ? undefined : 'Smoke side personalization missing.',
          usage: {
            inputTokens: 14,
            outputTokens: 7,
            totalTokens: 21,
            totalCostUsd: 0,
            durationMs: 120,
            apiDurationMs: 80,
            turns: 1
          }
        }
      }
      if (trimmed.toLowerCase().includes('smoke retry failure')) {
        const smokeFailureKey = `${sessionId}:${trimmed}`
        if (!smokeSideQuestionFailures.has(smokeFailureKey)) {
          smokeSideQuestionFailures.add(smokeFailureKey)
          return {
            ok: false,
            answer: '',
            error: `Smoke side question failed for: ${trimmed}`
          }
        }
        return {
          ok: true,
          answer: `Smoke retry recovered for: ${trimmed}`,
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
      ...requestFromSession(session, effectivePrompt),
      providerSessionId: null,
      executionPolicy: provider.id === 'claude' ? 'dontAsk' : session.permissionMode,
      allowedTools: [],
      disallowedTools: [],
      availableTools: [],
      attachments: []
    }

    if (provider.id === 'claude') {
      const { events } = await runClaudeSdkOneShot({
        sessionId: `${sessionId}-side-question-${Date.now()}`,
        session,
        provider,
        request: { ...request, runtime: 'sdk' },
        maxBudgetUsd: 0.05,
        timeoutMs: 90_000
      })
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
    }

    const commandSpec = buildProviderCommandForRuntime(provider, request)
    const command = commandSpec ? resolveProviderCommand(provider, commandSpec) : null
    if (!command) return { ok: false, answer: '', error: `${provider.id} CLI is not available.` }

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
    if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'settings-providers') {
      result.copilot = false
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

  async getReviewMetadata(sessionId: string, options: { force?: boolean } = {}): Promise<ReviewMetadata | undefined> {
    const session = this.get(sessionId)
    if (!session) return undefined
    if (session.reviewMetadata && options.force !== true) return session.reviewMetadata
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
