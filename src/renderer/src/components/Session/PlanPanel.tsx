import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionStore } from '../../store/sessions'
import { derivePlanStates, derivePlanStatesFromMessages } from '../../types'
import type { PlanItemStatus, PlanState, RunEvent, Session, SessionRunEventRecord } from '../../types'
import { Badge, InspectorCard, MetricPill, PanelHeader } from '../shared/designSystem'

interface Props {
  session: Session
  embedded?: boolean
}

export default function PlanPanel({ session, embedded = false }: Props): JSX.Element {
  const { eventBuffers } = useSessionStore()
  const events = eventBuffers[session.id] ?? []
  const plans = useMemo(() => [
    ...derivePlanStatesFromMessages(session, session.messages),
    ...derivePlanStates(session, events)
  ].slice(-5), [events, session])
  const current = useMemo(() => combinedPlan(plans), [plans])
  const goal = useMemo(() => latestGoal(events) ?? latestGoalFromMessages(session, session.messages), [events, session])
  const hasContent = Boolean(current || goal)

  return (
    <section
      className="flex min-w-0 flex-col overflow-hidden"
      data-testid="plan-panel"
      style={{
        width: embedded ? '100%' : 420,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        background: 'var(--surface-bg)'
      }}
    >
      {!embedded && <PanelHeader title="Plan" subtitle="Goal, task state, and plan mode updates." />}

      {!hasContent ? (
        <EmptyText>
          {embedded
            ? 'No plan yet.'
            : 'Goals, plan mode updates, and task lists will appear here as the agent organizes the work.'}
        </EmptyText>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-3">
          {goal && <GoalBlock goal={goal} />}
          {current && <PlanBlock plan={current} />}
        </div>
      )}
    </section>
  )
}

type GoalEvent = Extract<RunEvent, { type: 'goal.updated' }>['goal']

function latestGoal(records: SessionRunEventRecord[]): GoalEvent | null {
  let current: GoalEvent | null = null
  for (const record of records) {
    if (record.event.type === 'goal.updated') current = record.event.goal
    if (record.event.type === 'goal.cleared') current = null
  }
  return current
}

function GoalBlock({ goal }: { goal: GoalEvent }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const budget = typeof goal.tokenBudget === 'number' && goal.tokenBudget > 0 ? goal.tokenBudget : null
  const used = typeof goal.tokensUsed === 'number' ? goal.tokensUsed : null
  const pct = budget && used !== null ? Math.min(100, Math.round((used / budget) * 100)) : null
  const compactObjective = compactGoalObjective(goal.objective)
  const canExpand = compactObjective !== goal.objective.trim()
  const stats = [
    goal.status ? goal.status : undefined,
    used !== null ? `${used.toLocaleString()} tokens` : undefined,
    budget ? `${budget.toLocaleString()} budget` : undefined,
    typeof goal.timeUsedSeconds === 'number' ? formatDuration(goal.timeUsedSeconds) : undefined
  ].filter(Boolean)

  return (
    <InspectorCard className="p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-normal" style={{ color: 'var(--color-accent)' }}>
            Goal
          </div>
          <h3
            className="mt-1 text-sm font-semibold"
            data-testid="plan-goal-compact-objective"
            style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}
          >
            {compactObjective}
          </h3>
          {canExpand && (
            <button
              type="button"
              className="mt-2 text-[11px] font-semibold"
              data-testid="plan-goal-toggle"
              aria-expanded={expanded}
              style={{ color: 'var(--text-tertiary)' }}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Hide full objective' : 'Show full objective'}
            </button>
          )}
          {expanded && (
            <div
              className="mt-2 rounded-md p-2 text-xs"
              data-testid="plan-goal-full-objective"
              style={{
                background: 'var(--control-bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                overflowWrap: 'anywhere'
              }}
            >
              {goal.objective}
            </div>
          )}
          {stats.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stats.map((stat) => (
                <MetricPill key={stat}>{stat}</MetricPill>
              ))}
            </div>
          )}
        </div>
        {pct !== null && (
          <MetricPill tone={pct >= 90 ? 'warning' : 'accent'}>{pct}%</MetricPill>
        )}
      </div>
      {pct !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--control-bg)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: pct >= 90 ? 'var(--color-yellow)' : 'var(--color-accent)'
            }}
          />
        </div>
      )}
    </InspectorCard>
  )
}

function compactGoalObjective(objective: string): string {
  const normalized = objective
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^(destination|objective|goal|scope):\s*/i, '')
    .trim() ?? objective.trim()
  const firstSentence = normalized.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim() ?? normalized
  if (firstSentence.length <= 132) return firstSentence
  return `${firstSentence.slice(0, 129).trimEnd()}...`
}

function latestGoalFromMessages(session: Session, messages: Session['messages']): GoalEvent | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.type !== 'result') continue
    if (/^Goal cleared\b/i.test(message.content)) return null
    const match = /^Goal:\s*([\s\S]+?)(?:\s+\(([^)]+)\))?(?:\s+·\s+.*)?$/i.exec(message.content.trim())
    if (!match) continue
    return {
      providerId: session.provider ?? 'provider',
      sessionId: session.id,
      objective: match[1]?.trim() ?? '',
      status: match[2]?.trim()
    }
  }
  return null
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

function PlanBlock({ plan }: { plan: PlanState }): JSX.Element {
  const title = plan.title ?? (plan.items.length > 0 ? 'Tasks' : plan.mode === 'plan' ? 'Planning' : 'Plan')

  return (
    <InspectorCard className="p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </h3>
          {plan.mode && (
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {plan.mode === 'plan' ? 'Planning' : 'Ready to execute'}
            </div>
          )}
        </div>
        <PlanBadge plan={plan} />
      </div>

      {plan.summary && (
        <div
          className="mt-3 text-sm plan-summary"
          style={{
            color: 'var(--color-text)',
            lineHeight: 1.5,
            overflowWrap: 'anywhere'
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <div className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{children}</div>,
              h2: ({ children }) => <div className="mb-1 mt-3 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{children}</div>,
              h3: ({ children }) => <div className="mb-1 mt-2 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{children}</div>,
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
              code: ({ children }) => (
                <code
                  className="rounded px-1"
                  style={{
                    background: 'var(--control-bg)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.86em',
                    overflowWrap: 'anywhere'
                  }}
                >
                  {children}
                </code>
              )
            }}
          >
            {plan.summary}
          </ReactMarkdown>
        </div>
      )}

      {plan.items.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {plan.items.map((item, index) => (
            <div key={item.id ?? `${item.status}-${index}`} className="flex min-w-0 items-start gap-2">
              <StatusDot status={item.status} />
              <div className="min-w-0 flex-1">
                <div
                  className="text-sm"
                  style={{
                    color: item.status === 'completed' ? 'var(--color-text-muted)' : 'var(--color-text)',
                    textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                    overflowWrap: 'anywhere'
                  }}
                >
                  {item.content}
                </div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {statusLabel(item.status)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </InspectorCard>
  )
}

function combinedPlan(plans: PlanState[]): PlanState | null {
  if (plans.length === 0) return null
  const latest = plans[plans.length - 1]!
  return {
    providerId: latest.providerId,
    sessionId: latest.sessionId,
    mode: findLatest(plans, (plan) => plan.mode),
    title: findLatest(plans, (plan) => plan.title),
    summary: findLatest(plans, (plan) => plan.summary),
    items: findLatest(plans, (plan) => (plan.items.length > 0 ? plan.items : undefined)) ?? []
  }
}

function findLatest<T>(plans: PlanState[], pick: (plan: PlanState) => T | undefined): T | undefined {
  for (let i = plans.length - 1; i >= 0; i -= 1) {
    const value = pick(plans[i]!)
    if (value !== undefined) return value
  }
  return undefined
}

function PlanBadge({ plan }: { plan: PlanState }): JSX.Element {
  const total = plan.items.length
  const done = plan.items.filter((item) => item.status === 'completed').length
  const label = total > 0 ? `${done}/${total}` : plan.mode === 'execute' ? 'ready' : 'plan'

  return (
    <Badge tone="accent">{label}</Badge>
  )
}

function StatusDot({ status }: { status: PlanItemStatus }): JSX.Element {
  return (
    <span
      className="mt-1 rounded-full shrink-0"
      style={{
        width: 7,
        height: 7,
        background: statusColor(status)
      }}
    />
  )
}

function statusColor(status: PlanItemStatus): string {
  if (status === 'completed') return 'var(--color-green)'
  if (status === 'in_progress') return 'var(--color-yellow)'
  if (status === 'blocked' || status === 'cancelled') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}

function statusLabel(status: PlanItemStatus): string {
  if (status === 'in_progress') return 'In progress'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function EmptyText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="text-xs p-3 min-w-0" style={{ color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
      {children}
    </div>
  )
}
