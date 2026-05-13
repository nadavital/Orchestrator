import type { Session, UsageSummary } from '../../types'

interface Props {
  session: Session
  embedded?: boolean
}

export default function UsagePanel({ session, embedded }: Props): JSX.Element {
  const summaries = session.messages.flatMap((message) =>
    message.type === 'result' && message.usageSummary ? [message.usageSummary] : []
  )
  const total = session.usageSummary ?? summaries.reduce<UsageSummary | undefined>(mergeUsage, undefined)
  const last = summaries.at(-1)

  return (
    <div
      className={embedded ? 'h-full overflow-y-auto p-3 space-y-3' : 'space-y-3'}
      style={{ color: 'var(--color-text)' }}
    >
      <UsageBlock title="Session" usage={total} empty="No usage reported yet." />
      <UsageBlock title="Latest run" usage={last} empty="The latest run has not reported usage." />
      {total?.modelUsage && Object.keys(total.modelUsage).length > 0 && (
        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: 'var(--color-surface2)', border: '1px solid var(--color-border)' }}
        >
          <div className="mb-2 font-semibold">Models</div>
          <div className="space-y-1.5">
            {Object.entries(total.modelUsage).map(([model, usage]) => (
              <div key={model} className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate" title={model}>{model}</span>
                <span className="shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  {formatMoney(usage.costUSD)} · {formatNumber((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tokens
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UsageBlock({ title, usage, empty }: { title: string; usage?: UsageSummary; empty: string }): JSX.Element {
  return (
    <div
      className="rounded-lg p-3 text-xs"
      style={{ background: 'var(--color-surface2)', border: '1px solid var(--color-border)' }}
    >
      <div className="mb-2 font-semibold">{title}</div>
      {!usage ? (
        <div style={{ color: 'var(--color-text-muted)' }}>{empty}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Cost" value={formatMoney(usage.totalCostUsd)} />
          <Metric label="Tokens" value={formatNumber(usage.totalTokens)} />
          <Metric label="Input" value={formatNumber(usage.inputTokens)} />
          <Metric label="Output" value={formatNumber(usage.outputTokens)} />
          <Metric label="Cache read" value={formatNumber(usage.cacheReadInputTokens)} />
          <Metric label="Cache write" value={formatNumber(usage.cacheCreationInputTokens)} />
          <Metric label="Duration" value={formatDuration(usage.durationMs)} />
          <Metric label="Turns" value={formatNumber(usage.turns)} />
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function mergeUsage(current: UsageSummary | undefined, next: UsageSummary): UsageSummary {
  return {
    inputTokens: (current?.inputTokens ?? 0) + (next.inputTokens ?? 0) || undefined,
    outputTokens: (current?.outputTokens ?? 0) + (next.outputTokens ?? 0) || undefined,
    cacheCreationInputTokens: (current?.cacheCreationInputTokens ?? 0) + (next.cacheCreationInputTokens ?? 0) || undefined,
    cacheReadInputTokens: (current?.cacheReadInputTokens ?? 0) + (next.cacheReadInputTokens ?? 0) || undefined,
    totalTokens: (current?.totalTokens ?? 0) + (next.totalTokens ?? 0) || undefined,
    totalCostUsd: (current?.totalCostUsd ?? 0) + (next.totalCostUsd ?? 0) || undefined,
    durationMs: (current?.durationMs ?? 0) + (next.durationMs ?? 0) || undefined,
    turns: (current?.turns ?? 0) + (next.turns ?? 0) || undefined,
    serviceTier: next.serviceTier ?? current?.serviceTier,
    modelUsage: { ...(current?.modelUsage ?? {}), ...(next.modelUsage ?? {}) }
  }
}

function formatNumber(value?: number): string {
  return value === undefined ? '-' : Intl.NumberFormat().format(value)
}

function formatMoney(value?: number): string {
  return value === undefined ? '-' : `$${value.toFixed(4)}`
}

function formatDuration(value?: number): string {
  if (value === undefined) return '-'
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(1)} s`
}
