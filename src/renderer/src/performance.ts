export function recordRendererMetric(
  name: string,
  startedAt: number,
  metadata?: Record<string, string | number | boolean | null>
): void {
  const durationMs = performance.now() - startedAt
  void window.api.performance.record({
    name,
    surface: 'renderer',
    startedAt: Date.now() - durationMs,
    durationMs,
    metadata
  })
}

export function markRendererStart(): number {
  return performance.now()
}
