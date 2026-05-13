import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionStore } from '../../store/sessions'
import { derivePlanStates, derivePlanStatesFromMessages } from '../../types'
import type { PlanItemStatus, PlanState, Session } from '../../types'

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

  return (
    <section
      className="flex min-w-0 flex-col overflow-hidden"
      style={{
        width: embedded ? '100%' : 420,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        background: 'var(--color-surface)'
      }}
    >
      <div className="shrink-0 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          Plan and tasks
        </div>
      </div>

      {!current ? (
        <EmptyText>Plan mode updates and TodoWrite tasks will appear here when the agent starts planning.</EmptyText>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">
          <PlanBlock plan={current} current />
        </div>
      )}
    </section>
  )
}

function PlanBlock({ plan, current = false }: { plan: PlanState; current?: boolean }): JSX.Element {
  const title = plan.title ?? (plan.items.length > 0 ? 'Tasks' : plan.mode === 'plan' ? 'Planning' : 'Plan')

  return (
    <div
      className="min-w-0 rounded-md p-3"
      style={{
        background: current ? 'var(--color-bg)' : 'var(--color-surface2)',
        border: '1px solid var(--color-border)'
      }}
    >
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
                    background: 'var(--color-surface2)',
                    border: '1px solid var(--color-border)',
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
    </div>
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
    <span
      className="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
      style={{
        color: 'var(--color-accent)',
        background: 'var(--color-accent-dim)',
        border: '1px solid var(--color-accent)'
      }}
    >
      {label}
    </span>
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
