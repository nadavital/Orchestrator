import { deriveAgentNodes, deriveAgentNodesFromMessages } from './activityView'
import type { AgentNode, AgentStatus, ChatMessage, ProviderId, Session, SessionRunEventRecord } from './index'

export type AgentThreadCapabilityStatus = 'available' | 'unavailable' | 'planned' | 'unknown'

export type AgentThreadAction =
  | 'open'
  | 'openProviderThread'
  | 'copyTranscript'
  | 'addTranscriptToChat'
  | 'stop'
  | 'resume'

export type AgentThreadTranscriptKind =
  | 'provider-thread'
  | 'embedded-transcript'
  | 'derived-summary'
  | 'unavailable'

export interface AgentThreadActionCapability {
  action: AgentThreadAction
  status: AgentThreadCapabilityStatus
  reason?: string
}

export interface AgentThreadTranscriptHandle {
  kind: AgentThreadTranscriptKind
  providerThreadId?: string
  content?: string
  unavailableReason?: string
}

export interface AgentThreadIdentity {
  id: string
  providerId: ProviderId
  sessionId: string
  providerAgentId?: string
  providerItemId?: string
  providerThreadId?: string
  parentThreadId?: string
  childThreadIds: string[]
}

export interface AgentThreadMembership {
  rootSessionId: string
  parentSessionId: string
  parentAgentId?: string
  parentThreadId?: string
  providerTurnId?: string
}

export interface AgentThreadProgress {
  status: AgentStatus
  startedAt?: number
  completedAt?: number
  model?: string
  role?: string
  summary?: string
  reasoningEffort?: string
}

export interface AgentThreadProviderEvidence {
  source: NonNullable<AgentNode['source']>
  receiverThreadIds: string[]
  receiverThreads: NonNullable<AgentNode['receiverThreads']>
}

export interface AgentThread {
  id: string
  title: string
  agent: AgentNode
  identity: AgentThreadIdentity
  membership: AgentThreadMembership
  progress: AgentThreadProgress
  transcript: AgentThreadTranscriptHandle
  capabilities: Record<AgentThreadAction, AgentThreadActionCapability>
  evidence: AgentThreadProviderEvidence
}

export interface AgentThreadGraph {
  providerId: ProviderId
  sessionId: string
  rootProviderThreadId?: string
  threads: AgentThread[]
  counts: {
    total: number
    active: number
    waiting: number
    completed: number
    issues: number
  }
}

export interface AgentThreadDeriveOptions {
  includeMessages?: boolean
}

export interface AgentThreadAdapterContract {
  providerId: ProviderId
  runtimeKinds: string[]
  supportedActions: Record<AgentThreadAction, AgentThreadCapabilityStatus>
  source: AgentThreadProviderEvidence['source']
}

export interface AgentThreadOpenRequest {
  sourceSessionId: string
  providerId: ProviderId
  title: string
  providerThreadId?: string
  parentThreadId?: string
  providerAgentId?: string
  providerItemId?: string
  transcript?: string
}

export interface AgentThreadOpenResult {
  ok: boolean
  session?: Session
  reused?: boolean
  resumePrompt?: string
  error?: string
}

const LIVE_STATUSES = new Set<AgentStatus>(['queued', 'running', 'waiting', 'blocked'])

export const AGENT_THREAD_ADAPTER_CONTRACTS: Record<string, AgentThreadAdapterContract> = {
  codex: {
    providerId: 'codex',
    runtimeKinds: ['app-server'],
    source: 'provider-thread',
    supportedActions: {
      open: 'available',
      openProviderThread: 'available',
      copyTranscript: 'available',
      addTranscriptToChat: 'available',
      stop: 'planned',
      resume: 'planned'
    }
  },
  claude: {
    providerId: 'claude',
    runtimeKinds: ['sdk', 'headless'],
    source: 'provider-event',
    supportedActions: {
      open: 'available',
      openProviderThread: 'available',
      copyTranscript: 'available',
      addTranscriptToChat: 'available',
      stop: 'planned',
      resume: 'available'
    }
  },
  cursor: {
    providerId: 'cursor',
    runtimeKinds: ['sdk', 'interactive', 'headless'],
    source: 'sdk-run',
    supportedActions: {
      open: 'available',
      openProviderThread: 'planned',
      copyTranscript: 'available',
      addTranscriptToChat: 'available',
      stop: 'planned',
      resume: 'planned'
    }
  },
  copilot: {
    providerId: 'copilot',
    runtimeKinds: ['sdk', 'cloud-agent', 'headless'],
    source: 'provider-thread',
    supportedActions: {
      open: 'planned',
      openProviderThread: 'planned',
      copyTranscript: 'available',
      addTranscriptToChat: 'available',
      stop: 'unknown',
      resume: 'unknown'
    }
  },
  antigravity: {
    providerId: 'antigravity',
    runtimeKinds: ['sdk'],
    source: 'provider-thread',
    supportedActions: {
      open: 'unknown',
      openProviderThread: 'unknown',
      copyTranscript: 'unknown',
      addTranscriptToChat: 'unknown',
      stop: 'unknown',
      resume: 'unknown'
    }
  }
}

export function agentThreadAdapterContractForProvider(providerId: ProviderId): AgentThreadAdapterContract {
  return AGENT_THREAD_ADAPTER_CONTRACTS[providerId] ?? {
    providerId,
    runtimeKinds: [],
    source: 'tool-heuristic',
    supportedActions: {
      open: 'unknown',
      openProviderThread: 'unknown',
      copyTranscript: 'unknown',
      addTranscriptToChat: 'unknown',
      stop: 'unknown',
      resume: 'unknown'
    }
  }
}

export function deriveAgentThreadGraph(
  session: Pick<Session, 'id' | 'provider' | 'providerSessionId' | 'messages'>,
  events: SessionRunEventRecord[],
  options: AgentThreadDeriveOptions = {}
): AgentThreadGraph {
  const agents = mergeAgentNodes(
    options.includeMessages === false ? [] : deriveAgentNodesFromMessages(session, session.messages ?? []),
    deriveAgentNodes(session, events)
  )
  const threads = agents.map((agent) => agentThreadFromAgent(session, agent))
  return {
    providerId: session.provider,
    sessionId: session.id,
    rootProviderThreadId: session.providerSessionId ?? undefined,
    threads,
    counts: agentThreadCounts(threads)
  }
}

export function deriveAgentThreadGraphFromMessages(
  session: Pick<Session, 'id' | 'provider' | 'providerSessionId'>,
  messages: ChatMessage[]
): AgentThreadGraph {
  const agents = deriveAgentNodesFromMessages(session, messages)
  const threads = agents.map((agent) => agentThreadFromAgent(session, agent))
  return {
    providerId: session.provider,
    sessionId: session.id,
    rootProviderThreadId: session.providerSessionId ?? undefined,
    threads,
    counts: agentThreadCounts(threads)
  }
}

export function agentThreadFromAgent(
  session: Pick<Session, 'id' | 'provider' | 'providerSessionId'>,
  agent: AgentNode
): AgentThread {
  const childThreadIds = stableStrings([
    agent.providerThreadId,
    ...(agent.childThreadIds ?? []),
    ...(agent.receiverThreadIds ?? [])
  ])
  const providerThreadId = agent.providerThreadId ?? childThreadIds[0]
  const enrichedAgent: AgentNode = providerThreadId && agent.providerThreadId !== providerThreadId
    ? { ...agent, providerThreadId }
    : agent
  const source = agent.source ?? inferAgentThreadSource(agent, providerThreadId)
  const transcript = agentThreadTranscript(enrichedAgent, providerThreadId)
  const parentThreadId = agent.parentThreadId ?? session.providerSessionId ?? undefined
  return {
    id: agent.id,
    title: agent.name ?? agent.role ?? providerThreadId ?? agent.id,
    agent: enrichedAgent,
    identity: {
      id: agent.id,
      providerId: agent.providerId || session.provider,
      sessionId: agent.sessionId || session.id,
      providerAgentId: agent.providerAgentId,
      providerItemId: agent.providerItemId,
      providerThreadId,
      parentThreadId,
      childThreadIds
    },
    membership: {
      rootSessionId: session.id,
      parentSessionId: agent.sessionId || session.id,
      parentAgentId: agent.parentAgentId,
      parentThreadId,
      providerTurnId: agent.providerTurnId
    },
    progress: {
      status: agent.status,
      startedAt: agent.startedAt,
      completedAt: agent.completedAt,
      model: agent.model,
      role: agent.role,
      summary: agent.summary,
      reasoningEffort: agent.reasoningEffort
    },
    transcript,
    capabilities: agentThreadCapabilities(enrichedAgent, transcript, parentThreadId),
    evidence: {
      source,
      receiverThreadIds: [...(agent.receiverThreadIds ?? [])],
      receiverThreads: [...(agent.receiverThreads ?? [])]
    }
  }
}

function mergeAgentNodes(fromMessages: AgentNode[], fromEvents: AgentNode[]): AgentNode[] {
  const byId = new Map(fromMessages.map((agent) => [agent.id, agent]))
  for (const agent of fromEvents) {
    const previous = byId.get(agent.id)
    byId.set(agent.id, {
      ...previous,
      ...agent,
      providerAgentId: agent.providerAgentId ?? previous?.providerAgentId,
      providerItemId: agent.providerItemId ?? previous?.providerItemId,
      providerThreadId: agent.providerThreadId ?? previous?.providerThreadId,
      parentThreadId: agent.parentThreadId ?? previous?.parentThreadId,
      childThreadIds: stableStrings([...(previous?.childThreadIds ?? []), ...(agent.childThreadIds ?? [])]),
      receiverThreadIds: stableStrings([...(previous?.receiverThreadIds ?? []), ...(agent.receiverThreadIds ?? [])]),
      receiverThreads: agent.receiverThreads ?? previous?.receiverThreads,
      transcript: agent.transcript ?? previous?.transcript,
      summary: agent.summary ?? previous?.summary
    })
  }
  return [...byId.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

function agentThreadCounts(threads: AgentThread[]): AgentThreadGraph['counts'] {
  return threads.reduce<AgentThreadGraph['counts']>((current, thread) => {
    current.total += 1
    if (thread.progress.status === 'running' || thread.progress.status === 'queued') current.active += 1
    if (thread.progress.status === 'waiting' || thread.progress.status === 'blocked') current.waiting += 1
    if (thread.progress.status === 'completed') current.completed += 1
    if (thread.progress.status === 'failed' || thread.progress.status === 'cancelled') current.issues += 1
    return current
  }, { total: 0, active: 0, waiting: 0, completed: 0, issues: 0 })
}

function agentThreadTranscript(agent: AgentNode, providerThreadId: string | undefined): AgentThreadTranscriptHandle {
  const transcript = agent.transcript?.trim()
  if (providerThreadId) {
    return {
      kind: 'provider-thread',
      providerThreadId,
      content: transcript || agent.summary
    }
  }
  if (transcript) return { kind: 'embedded-transcript', content: transcript }
  if (agent.summary?.trim()) return { kind: 'derived-summary', content: agent.summary.trim() }
  return { kind: 'unavailable', unavailableReason: 'Provider has not exposed a transcript or child thread id for this agent.' }
}

function agentThreadCapabilities(
  agent: AgentNode,
  transcript: AgentThreadTranscriptHandle,
  parentThreadId: string | undefined
): Record<AgentThreadAction, AgentThreadActionCapability> {
  const hasText = Boolean(transcript.content?.trim())
  const hasProviderThread = transcript.kind === 'provider-thread' && Boolean(transcript.providerThreadId)
  const hasClaudeAgentId = agent.providerId === 'claude' && Boolean(agent.providerAgentId && parentThreadId)
  const adapter = agentThreadAdapterContractForProvider(agent.providerId as ProviderId)
  const openProviderThreadStatus = hasClaudeAgentId
    ? 'available'
    : hasProviderThread
    ? adapter.supportedActions.openProviderThread === 'available'
      ? 'available'
      : adapter.supportedActions.openProviderThread === 'planned'
        ? 'planned'
        : 'unavailable'
    : 'unavailable'
  const canInterrupt = LIVE_STATUSES.has(agent.status)
  return {
    open: {
      action: 'open',
      status: hasProviderThread || hasText ? 'available' : 'unavailable',
      reason: hasProviderThread ? 'Provider child thread is available.' : hasText ? 'Derived transcript context is available.' : transcript.unavailableReason
    },
    openProviderThread: {
      action: 'openProviderThread',
      status: openProviderThreadStatus,
      reason: hasClaudeAgentId
        ? 'Claude parent session id and subagent id are available; Orchestrator can resume the parent SDK session and route through SendMessage.'
        : hasProviderThread
        ? openProviderThreadStatus === 'available'
          ? 'Provider child thread id is available.'
          : 'Provider child thread id is preserved, but this provider adapter does not yet expose a native open action.'
        : 'Provider did not expose a child thread id for this agent.'
    },
    copyTranscript: {
      action: 'copyTranscript',
      status: hasText ? 'available' : 'unavailable',
      reason: hasText ? undefined : transcript.unavailableReason
    },
    addTranscriptToChat: {
      action: 'addTranscriptToChat',
      status: hasText ? 'available' : 'unavailable',
      reason: hasText ? undefined : transcript.unavailableReason
    },
    stop: {
      action: 'stop',
      status: canInterrupt ? 'planned' : 'unavailable',
      reason: canInterrupt
        ? 'Provider-specific interruption can be routed here once adapter stop hooks are wired.'
        : 'Only live agent threads can be interrupted.'
    },
    resume: {
      action: 'resume',
      status: hasClaudeAgentId ? 'available' : hasProviderThread ? 'planned' : 'unavailable',
      reason: hasClaudeAgentId
        ? 'Claude can resume this subagent by resuming the parent SDK session and sending to the stored agent id.'
        : hasProviderThread
          ? 'Provider child thread id is preserved for a future resume action.'
        : 'Provider did not expose a resumable child thread id.'
    }
  }
}

function inferAgentThreadSource(agent: AgentNode, providerThreadId: string | undefined): NonNullable<AgentNode['source']> {
  if (providerThreadId) return 'provider-thread'
  if (agent.providerId === 'cursor') return 'sdk-run'
  if (agent.providerId === 'claude') return 'provider-event'
  return 'tool-heuristic'
}

function stableStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}
