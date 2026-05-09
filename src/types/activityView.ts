import type { AgentNode, PlanState, Session, SessionRunEventRecord } from './index'

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
        startedAt: previous?.startedAt ?? event.agent.startedAt ?? record.timestamp,
        completedAt: event.agent.completedAt ?? (event.type === 'agent.completed' || event.type === 'agent.failed' ? record.timestamp : previous?.completedAt)
      })
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
    }
  }

  return [...agents.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
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

function compact(value: string, max = 120): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}
