import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionStore } from '../../store/sessions'
import { derivePlanStates, derivePlanStatesFromMessages } from '../../types'
import type { PlanItemStatus, PlanState, RunEvent, Session, SessionRunEventRecord } from '../../types'
import { Badge, Button, IconButton, MetricPill, PanelHeader } from '../shared/designSystem'

interface Props {
  session: Session
  embedded?: boolean
}

export default function PlanPanel({ session, embedded = false }: Props): JSX.Element {
  const { eventBuffers, setShowDiff } = useSessionStore()
  const [contextStatus, setContextStatus] = useState<string | null>(null)
  const events = eventBuffers[session.id] ?? []
  const plans = useMemo(() => [
    ...derivePlanStatesFromMessages(session, session.messages),
    ...derivePlanStates(session, events)
  ].slice(-5), [events, session])
  const current = useMemo(() => combinedPlan(plans), [plans])
  const goal = useMemo(() => latestGoal(events) ?? latestGoalFromMessages(session, session.messages), [events, session])
  const reviewMode = useMemo(() => latestReviewMode(events) ?? latestReviewModeFromMessages(session, session.messages), [events, session])
  const hasContent = Boolean(current || goal || reviewMode)
  const addPlanContextToChat = (): void => {
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: planContextSummary(session, goal, reviewMode, current) }
    }))
    setContextStatus('Plan context added to chat')
  }

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
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <PlanContextActions status={contextStatus} onAdd={addPlanContextToChat} />
          {goal && <GoalBlock goal={goal} session={session} />}
          {reviewMode && <ReviewModeBlock mode={reviewMode} onOpenReview={() => setShowDiff(session.id, true)} />}
          {current && <PlanBlock plan={current} />}
        </div>
      )}
    </section>
  )
}

type GoalEvent = Extract<RunEvent, { type: 'goal.updated' }>['goal']
type ReviewModeEvent = Extract<RunEvent, { type: 'review.mode.changed' }>

function latestGoal(records: SessionRunEventRecord[]): GoalEvent | null {
  let current: GoalEvent | null = null
  for (const record of records) {
    if (record.event.type === 'goal.updated') current = record.event.goal
    if (record.event.type === 'goal.cleared') current = null
  }
  return current
}

function latestReviewMode(records: SessionRunEventRecord[]): ReviewModeEvent | null {
  let current: ReviewModeEvent | null = null
  for (const record of records) {
    if (record.event.type === 'review.mode.changed') {
      current = record.event.active ? record.event : null
    }
  }
  return current
}

function PlanContextActions({ status, onAdd }: { status: string | null; onAdd: () => void }): JSX.Element {
  return (
    <PlanSection>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold tracking-normal" style={{ color: 'var(--color-text)' }}>
            Context handoff
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            Send the current goal, review, and task state to the composer.
          </div>
        </div>
        <Button
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[11px]"
          dataTestId="plan-add-to-chat"
          ariaLabel="Add plan context to chat"
          onClick={onAdd}
        >
          Add to chat
        </Button>
      </div>
      {status && (
        <div
          className="mt-2 text-[11px]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="plan-add-to-chat-status"
          style={{ color: 'var(--accent)' }}
        >
          {status}
        </div>
      )}
    </PlanSection>
  )
}

function planContextSummary(
  session: Session,
  goal: GoalEvent | null,
  reviewMode: ReviewModeEvent | null,
  plan: PlanState | null
): string {
  const lines = [
    'Use this plan context:',
    `Thread: ${session.title || session.id}`,
    `Runtime: ${[session.provider, session.model].filter(Boolean).join(' / ') || 'Unknown runtime'}`,
    `Status: ${session.status}`,
    `Workspace: ${session.workDir || 'Unknown workspace'}`
  ]

  if (goal) {
    lines.push(
      '',
      'Goal:',
      goal.objective.trim(),
      `Goal status: ${goal.status ?? 'unknown'}`
    )
    if (typeof goal.tokensUsed === 'number') lines.push(`Tokens used: ${goal.tokensUsed}`)
    if (typeof goal.tokenBudget === 'number') lines.push(`Token budget: ${goal.tokenBudget}`)
    if (typeof goal.timeUsedSeconds === 'number') lines.push(`Elapsed: ${formatDuration(goal.timeUsedSeconds)}`)
  }

  if (reviewMode) {
    lines.push(
      '',
      'Review mode:',
      reviewMode.review?.trim() ? reviewMode.review.trim() : 'Active'
    )
  }

  if (plan) {
    const title = plan.title ?? (plan.items.length > 0 ? 'Tasks' : plan.mode === 'plan' ? 'Planning' : 'Plan')
    lines.push('', `Plan: ${title}`)
    if (plan.mode) lines.push(`Mode: ${plan.mode}`)
    if (plan.summary?.trim()) lines.push('', plan.summary.trim())
    if (plan.items.length > 0) {
      lines.push('', 'Tasks:')
      lines.push(...plan.items.slice(0, 12).map((item) => `- [${statusLabel(item.status)}] ${item.content}`))
      if (plan.items.length > 12) lines.push(`- ... ${plan.items.length - 12} more`)
    }
  }

  return lines.join('\n')
}

function GoalBlock({ goal, session }: { goal: GoalEvent; session: Session }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const budget = typeof goal.tokenBudget === 'number' && goal.tokenBudget > 0 ? goal.tokenBudget : null
  const used = typeof goal.tokensUsed === 'number' ? goal.tokensUsed : null
  const pct = budget && used !== null ? Math.min(100, Math.round((used / budget) * 100)) : null
  const compactObjective = compactGoalObjective(goal.objective)
  const canExpand = compactObjective !== goal.objective.trim()
  const isCodexGoal = goal.providerId === 'codex' || session.provider === 'codex'
  const clearUnavailableReason = 'Goal clear is unavailable in the current Codex app-server goal command path.'
  const stats = [
    used !== null ? `${used.toLocaleString()} tokens` : undefined,
    budget ? `${budget.toLocaleString()} budget` : undefined,
    typeof goal.timeUsedSeconds === 'number' ? formatDuration(goal.timeUsedSeconds) : undefined
  ].filter(Boolean)

  return (
    <PlanSection>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {canExpand && (
              <IconButton
                icon={expanded ? 'chevronDown' : 'chevronRight'}
                label={expanded ? 'Hide full objective' : 'Show full objective'}
                size="xs"
                variant="toolbar"
                className="plan-goal-toggle"
                dataTestId="plan-goal-toggle"
                ariaExpanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              />
            )}
            <div
              className="text-[11px] font-semibold tracking-normal"
              data-testid="plan-goal-label"
              style={{ color: 'var(--accent)' }}
            >
              Goal
            </div>
          </div>
          <h3
            className="mt-1 text-[13px] font-semibold leading-5"
            data-testid="plan-goal-compact-objective"
            data-plan-goal-status={goal.status ?? ''}
            style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}
          >
            {compactObjective}
          </h3>
          {expanded && (
            <div
              className="mt-2 text-xs"
              data-testid="plan-goal-full-objective"
              style={{
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
                overflowWrap: 'anywhere'
              }}
            >
              {goal.objective}
            </div>
          )}
          {(goal.status || stats.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="plan-goal-stats">
              {goal.status && (
                <span data-testid="plan-goal-status">
                  <Badge tone={goal.status === 'active' ? 'success' : 'neutral'}>{goal.status}</Badge>
                </span>
              )}
              {used !== null && (
                <span data-testid="plan-goal-tokens-used">
                  <MetricPill>{used.toLocaleString()} tokens</MetricPill>
                </span>
              )}
              {budget && (
                <span data-testid="plan-goal-token-budget">
                  <MetricPill>{budget.toLocaleString()} budget</MetricPill>
                </span>
              )}
              {typeof goal.timeUsedSeconds === 'number' && (
                <span data-testid="plan-goal-time-used">
                  <MetricPill>{formatDuration(goal.timeUsedSeconds)}</MetricPill>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {pct !== null && (
            <span data-testid="plan-goal-progress">
              <MetricPill tone={pct >= 90 ? 'warning' : 'accent'}>{pct}%</MetricPill>
            </span>
          )}
          {isCodexGoal && (
            <Button
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              dataTestId="plan-goal-clear"
              ariaLabel={clearUnavailableReason}
              title={clearUnavailableReason}
              disabled
            >
              Clear
            </Button>
          )}
        </div>
      </div>
      {isCodexGoal && (
        <div
          className="mt-2 text-[11px]"
          role="note"
          data-testid="plan-goal-clear-status"
          data-plan-goal-clear-status-tone="warning"
          style={{
            color: 'var(--text-secondary)'
          }}
        >
          Clear unavailable in current Codex app-server.
        </div>
      )}
      {pct !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--control-bg)' }}>
          <div
            className="h-full rounded-full"
            data-testid="plan-goal-progress-bar"
            style={{
              width: `${pct}%`,
              background: pct >= 90 ? 'var(--color-yellow)' : 'var(--color-accent)'
            }}
          />
        </div>
      )}
    </PlanSection>
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
    const match = /^Goal:\s*([\s\S]+?)(?:\s+\(([^)]+)\))?(?:\s+·\s+([\s\S]+))?$/i.exec(message.content.trim())
    if (!match) continue
    const usage = parsePersistedGoalUsage(match[3] ?? '')
    return {
      providerId: session.provider ?? 'provider',
      sessionId: session.id,
      objective: match[1]?.trim() ?? '',
      status: match[2]?.trim(),
      tokenBudget: usage.tokenBudget,
      tokensUsed: usage.tokensUsed,
      timeUsedSeconds: usage.timeUsedSeconds
    }
  }
  return null
}

function latestReviewModeFromMessages(session: Session, messages: Session['messages']): ReviewModeEvent | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.type !== 'result') continue
    const match = /^Review mode:\s*(active|exited)(?:\s+·\s+([\s\S]+))?$/i.exec(message.content.trim())
    if (!match) continue
    if (match[1]?.toLowerCase() !== 'active') return null
    return {
      type: 'review.mode.changed',
      providerId: session.provider ?? 'provider',
      sessionId: session.id,
      active: true,
      review: match[2]?.trim()
    }
  }
  return null
}

function parsePersistedGoalUsage(value: string): Pick<GoalEvent, 'tokenBudget' | 'tokensUsed' | 'timeUsedSeconds'> {
  const tokensUsed = parseLocaleInteger(value.match(/([\d,]+)\s+tokens?\b/i)?.[1])
  const tokenBudget = parseLocaleInteger(value.match(/([\d,]+)\s+budget\b/i)?.[1])
  const timeUsedSeconds = parseDurationSeconds(value)
  return { tokensUsed, tokenBudget, timeUsedSeconds }
}

function parseLocaleInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value.replace(/,/g, ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseDurationSeconds(value: string): number | undefined {
  const hours = parseLocaleInteger(value.match(/\b([\d,]+)\s*h(?:ours?)?\b/i)?.[1])
  const minutes = parseLocaleInteger(value.match(/\b([\d,]+)\s*m(?:in(?:ute)?s?)?\b/i)?.[1])
  const seconds = parseLocaleInteger(value.match(/\b([\d,]+)\s*s(?:ec(?:ond)?s?)?\b/i)?.[1])
  if (hours === undefined && minutes === undefined && seconds === undefined) return undefined
  return (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = Math.round(seconds % 60)
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

function ReviewModeBlock({ mode, onOpenReview }: { mode: ReviewModeEvent; onOpenReview: () => void }): JSX.Element {
  return (
    <PlanSection>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[11px] font-semibold tracking-normal"
            data-testid="plan-review-mode-label"
            style={{ color: 'var(--accent)' }}
          >
            Review mode
          </div>
          <h3
            className="mt-1 text-[13px] font-semibold leading-5"
            data-testid="plan-review-mode-title"
            data-review-mode-provider={mode.providerId}
            data-review-mode-active={mode.active ? 'true' : 'false'}
            style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}
          >
            Codex is reviewing this thread
          </h3>
          {mode.review && (
            <div
              className="mt-1 text-xs"
              data-testid="plan-review-mode-summary"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.45, overflowWrap: 'anywhere' }}
            >
              {mode.review}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="accent">active</Badge>
            <MetricPill>app-server</MetricPill>
          </div>
        </div>
        <Button
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[11px]"
          dataTestId="plan-review-mode-open"
          ariaLabel="Open Review panel"
          onClick={onOpenReview}
        >
          Review
        </Button>
      </div>
    </PlanSection>
  )
}

function PlanBlock({ plan }: { plan: PlanState }): JSX.Element {
  const title = plan.title ?? (plan.items.length > 0 ? 'Tasks' : plan.mode === 'plan' ? 'Planning' : 'Plan')

  return (
    <PlanSection>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
            {title}
          </h3>
          {plan.mode && (
            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
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
        <div className="mt-3 flex flex-col gap-1.5" data-testid="plan-task-list">
          {plan.items.map((item, index) => (
            <div key={item.id ?? `${item.status}-${index}`} className="flex min-w-0 items-start gap-2 py-0.5">
              <StatusDot status={item.status} />
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] leading-5"
                  style={{
                    color: item.status === 'completed' ? 'var(--color-text-muted)' : 'var(--color-text)',
                    textDecoration: item.status === 'completed' ? 'line-through' : 'none',
                    overflowWrap: 'anywhere'
                  }}
                >
                  {item.content}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PlanSection>
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
      role="img"
      aria-label={statusLabel(status)}
      className="mt-1 rounded-full shrink-0"
      style={{
        width: 7,
        height: 7,
        background: statusColor(status)
      }}
    />
  )
}

function PlanSection({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <section
      className="min-w-0 px-4 py-3"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      {children}
    </section>
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
