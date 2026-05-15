import test from 'node:test'
import assert from 'node:assert/strict'
import { performanceSnapshot, recordPerformanceMetric, resetPerformanceMetrics } from '../performanceTelemetry'

test('performance telemetry records and summarizes bounded metrics', () => {
  resetPerformanceMetrics()
  recordPerformanceMetric({ name: 'chat.switch', surface: 'renderer', startedAt: 1000, durationMs: 30 })
  recordPerformanceMetric({ name: 'chat.switch', surface: 'renderer', startedAt: 1100, durationMs: 10 })
  recordPerformanceMetric({ name: 'app.boot', surface: 'renderer', startedAt: 1200, durationMs: 50 })

  const snapshot = performanceSnapshot()
  const chatSwitch = snapshot.summaries.find((summary) => summary.name === 'chat.switch')

  assert.equal(snapshot.metrics.length, 3)
  assert.equal(chatSwitch?.count, 2)
  assert.equal(chatSwitch?.maxMs, 30)
  assert.equal(chatSwitch?.latestMs, 10)
})
