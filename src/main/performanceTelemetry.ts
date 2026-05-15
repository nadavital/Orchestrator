import { randomUUID } from 'crypto'
import type { PerformanceMetric, PerformanceMetricSummary, PerformanceSnapshot } from '../types'

const MAX_METRICS = 600
const metrics: PerformanceMetric[] = []

export function recordPerformanceMetric(metric: Omit<PerformanceMetric, 'id'> & { id?: string }): PerformanceMetric {
  const recorded: PerformanceMetric = {
    ...metric,
    id: metric.id ?? randomUUID(),
    durationMs: Math.max(0, Number(metric.durationMs) || 0),
    startedAt: Math.max(0, Number(metric.startedAt) || Date.now())
  }
  metrics.push(recorded)
  if (metrics.length > MAX_METRICS) metrics.splice(0, metrics.length - MAX_METRICS)
  return recorded
}

export function performanceSnapshot(): PerformanceSnapshot {
  const grouped = new Map<string, PerformanceMetric[]>()
  for (const metric of metrics) {
    const group = grouped.get(metric.name)
    if (group) group.push(metric)
    else grouped.set(metric.name, [metric])
  }

  const summaries: PerformanceMetricSummary[] = [...grouped.entries()]
    .map(([name, items]) => summarizeMetrics(name, items))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    metrics: [...metrics],
    summaries
  }
}

export function resetPerformanceMetrics(): void {
  metrics.splice(0, metrics.length)
}

function summarizeMetrics(name: string, items: PerformanceMetric[]): PerformanceMetricSummary {
  const values = items.map((item) => item.durationMs).sort((a, b) => a - b)
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    name,
    count: items.length,
    latestMs: items[items.length - 1]?.durationMs ?? 0,
    averageMs: total / Math.max(1, values.length),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.at(-1) ?? 0
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))
  return values[index]
}
