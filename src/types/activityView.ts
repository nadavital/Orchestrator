import type { AgentNode, ChatMessage, PlanItem, PlanState, Session, SessionRunEventRecord } from './index'

export function deriveAgentNodes(session: Pick<Session, 'id' | 'provider'>, records: SessionRunEventRecord[]): AgentNode[] {
  const agents = new Map<string, AgentNode>()

  for (const record of records) {
    const { event } = record
    if (
      event.type === 'agent.started' ||
      event.type === 'agent.updated' ||
      event.type === 'agent.completed' ||
      event.type === 'agent.failed'
    ) {
      const previous = agents.get(event.agent.id)
      agents.set(event.agent.id, {
        ...previous,
        ...event.agent,
        providerId: event.agent.providerId || session.provider,
        sessionId: event.agent.sessionId || session.id,
        name: previous?.name ?? event.agent.name,
        role: previous?.role ?? event.agent.role,
        model: previous?.model ?? event.agent.model,
        summary: event.agent.summary ?? previous?.summary,
        transcript: event.agent.transcript ?? previous?.transcript,
        startedAt: previous?.startedAt ?? event.agent.startedAt ?? record.timestamp,
        completedAt: event.agent.completedAt ?? (event.type === 'agent.completed' || event.type === 'agent.failed' ? record.timestamp : previous?.completedAt)
      })
      continue
    }

    if (event.type === 'agent.text.delta') {
      const previous = agents.get(event.agentId)
      const transcript = `${previous?.transcript ?? ''}${event.content}`
      agents.set(event.agentId, {
        ...previous,
        id: event.agentId,
        providerId: previous?.providerId ?? session.provider,
        sessionId: previous?.sessionId ?? session.id,
        status: previous?.status === 'failed' || previous?.status === 'cancelled' ? previous.status : 'running',
        startedAt: previous?.startedAt ?? record.timestamp,
        transcript,
        summary: compact(transcript)
      })
      continue
    }

    if (event.type === 'agent.text.completed') {
      const previous = agents.get(event.agentId)
      if (previous) {
        agents.set(event.agentId, {
          ...previous,
          status: previous.status === 'running' ? 'completed' : previous.status,
          completedAt: previous.completedAt ?? record.timestamp
        })
      }
      continue
    }

    if (event.type === 'tool.started' && isAgentTool(event.toolName)) {
      agents.set(event.id, {
        id: event.id,
        providerId: session.provider,
        sessionId: session.id,
        name: agentNameFromTool(event.toolName, event.toolInput),
        role: compactToolInput(event.toolInput),
        status: 'running',
        startedAt: record.timestamp
      })
      continue
    }

    if (event.type === 'tool.completed') {
      const agent = agents.get(event.toolUseId)
      if (agent) {
        agents.set(event.toolUseId, {
          ...agent,
          status: event.isError ? 'failed' : 'completed',
          completedAt: record.timestamp,
          summary: compact(event.content)
        })
      }
      continue
    }

    if (event.type === 'run.failed') {
      failActiveAgents(agents, event.content, record.timestamp)
    }
  }

  return [...agents.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

export function deriveAgentNodesFromMessages(
  session: Pick<Session, 'id' | 'provider'>,
  messages: ChatMessage[]
): AgentNode[] {
  const agents = new Map<string, AgentNode>()

  for (const message of messages) {
    if (message.type === 'tool_use' && isAgentTool(message.toolName)) {
      agents.set(message.id, {
        id: message.id,
        providerId: session.provider,
        sessionId: session.id,
        name: agentNameFromTool(message.toolName, message.toolInput),
        role: compactToolInput(message.toolInput),
        status: 'running',
        startedAt: message.timestamp
      })
      continue
    }

    if (message.type === 'tool_result') {
      const agent = agents.get(message.toolUseId)
      if (!agent) continue
      const content = readableAgentResult(message.content)
      agents.set(message.toolUseId, {
        ...agent,
        status: message.isError ? 'failed' : 'completed',
        completedAt: message.timestamp,
        summary: content ? compact(content) : agent.role,
        transcript: content
      })
      continue
    }

    if (message.type === 'result' && message.subtype !== 'success') {
      failActiveAgents(agents, message.content, message.timestamp)
    }
  }

  return [...agents.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

function failActiveAgents(agents: Map<string, AgentNode>, content: string | undefined, timestamp: number): void {
  const status = /interrupt|cancel/i.test(content ?? '') ? 'cancelled' : 'failed'
  const summary = compact(content ?? 'Run failed')
  for (const [id, agent] of agents) {
    if (agent.status === 'queued' || agent.status === 'running' || agent.status === 'waiting' || agent.status === 'blocked') {
      agents.set(id, {
        ...agent,
        status,
        completedAt: agent.completedAt ?? timestamp,
        summary: agent.summary ?? summary
      })
    }
  }
}

export function derivePlanStates(session: Pick<Session, 'id' | 'provider'>, records: SessionRunEventRecord[]): PlanState[] {
  const plans: PlanState[] = []

  for (const record of records) {
    const { event } = record
    if (event.type !== 'plan.updated') continue

    const previous = plans[plans.length - 1]
    const current: PlanState = {
      providerId: event.plan.providerId || session.provider,
      sessionId: event.plan.sessionId || session.id,
      mode: event.plan.mode ?? previous?.mode,
      title: event.plan.title ?? previous?.title,
      summary: event.plan.summary ?? previous?.summary,
      items: event.plan.items.length > 0 ? event.plan.items : previous?.items ?? []
    }
    plans.push(current)
  }

  return plans.slice(-5)
}

export function derivePlanStatesFromMessages(
  session: Pick<Session, 'id' | 'provider'>,
  messages: ChatMessage[]
): PlanState[] {
  const plans: PlanState[] = []

  for (const message of messages) {
    if (message.type === 'tool_use' && isPlanTool(message.toolName)) {
      const items = message.toolName === 'TodoWrite' ? planItemsFromTodos(message.toolInput.todos) : []
      plans.push({
        providerId: session.provider,
        sessionId: session.id,
        mode: planModeFromTool(message.toolName),
        title: message.toolName === 'TodoWrite' ? 'Tasks' : undefined,
        summary: stringField(message.toolInput, 'plan') ?? stringField(message.toolInput, 'summary') ?? stringField(message.toolInput, 'description'),
        items
      })
      continue
    }

    if (message.type === 'result') {
      const denial = message.permissionDenials?.find((item) => item.tool_name === 'ExitPlanMode')
      if (!denial) continue
      plans.push({
        providerId: session.provider,
        sessionId: session.id,
        mode: 'plan',
        summary: stringField(denial.tool_input, 'plan') ?? stringField(denial.tool_input, 'summary') ?? message.content,
        items: []
      })
    }
  }

  return plans.slice(-5)
}

export function eventCounts(events: SessionRunEventRecord[]): Record<string, number> {
  return events.reduce<Record<string, number>>((acc, record) => {
    acc[record.event.type] = (acc[record.event.type] ?? 0) + 1
    return acc
  }, {})
}

export function agentDepth(agent: AgentNode, agents: AgentNode[]): number {
  let depth = 0
  let cursor = agent
  while (cursor.parentAgentId && depth < 6) {
    const parent = agents.find((candidate) => candidate.id === cursor.parentAgentId)
    if (!parent) break
    cursor = parent
    depth += 1
  }
  return depth
}

export function isAgentTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase()
  return normalized.includes('agent') || normalized.includes('subtask') || normalized === 'task'
}

function isPlanTool(toolName: string): boolean {
  return toolName === 'TodoWrite' || toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode'
}

function planModeFromTool(toolName: string): 'plan' | 'execute' | undefined {
  if (toolName === 'EnterPlanMode') return 'plan'
  if (toolName === 'ExitPlanMode') return 'execute'
  return undefined
}

function planItemsFromTodos(input: unknown): PlanItem[] {
  if (!Array.isArray(input)) return []
  const items: PlanItem[] = []
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const content = typeof rec.content === 'string' ? rec.content : undefined
    if (!content) continue
    items.push({
      id: typeof rec.id === 'string' ? rec.id : `${index}`,
      content,
      status: normalizePlanItemStatus(rec.status)
    })
  }
  return items
}

function normalizePlanItemStatus(value: unknown): PlanItem['status'] {
  if (value === 'in_progress' || value === 'completed' || value === 'cancelled' || value === 'blocked') return value
  return 'pending'
}

function agentNameFromTool(toolName: string, input: Record<string, unknown>): string {
  const text = stringField(input, 'description') ?? stringField(input, 'prompt') ?? stringField(input, 'task')
  if (text) return compact(text, 48) ?? text
  return toolName
}

function compactToolInput(input: Record<string, unknown>): string | undefined {
  return compact(
    stringField(input, 'role') ??
    stringField(input, 'description') ??
    stringField(input, 'prompt') ??
    stringField(input, 'task') ??
    ''
  )
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readableAgentResult(content: string): string | undefined {
  const readable = stripAgentMetadataTrailer(readableToolResult(content))
  if (isAgentLaunchBoilerplate(readable)) return undefined
  return readable
}

function stripAgentMetadataTrailer(content: string): string {
  return content
    .replace(/\n?<usage>[\s\S]*?<\/usage>\s*$/u, '')
    .replace(/\nagentId:\s+[^\n]*\s*$/u, '')
    .trim()
}

function readableToolResult(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown
    if (Array.isArray(parsed)) {
      const text = parsed
        .map((item) => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && 'text' in item) {
            const value = (item as { text?: unknown }).text
            return typeof value === 'string' ? value : ''
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
      if (text) return text
    }
  } catch {
    // Plain text tool results are already display-ready.
  }
  return content
}

function isAgentLaunchBoilerplate(content: string): boolean {
  return (
    content.includes('Async agent launched successfully') &&
    content.includes('agentId:') &&
    content.includes('output_file:')
  )
}

function compact(value: string, max = 120): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}
