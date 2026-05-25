export const ORCHESTRATOR_BROWSER_WEBVIEW_PARTITION_PREFIX = 'persist:orchestrator-side-browser'

export function browserWebviewPartitionForHost(hostId?: string | null): string {
  const normalizedHostId = typeof hostId === 'string' ? hostId.trim() : ''
  if (!normalizedHostId) return ORCHESTRATOR_BROWSER_WEBVIEW_PARTITION_PREFIX
  return `${ORCHESTRATOR_BROWSER_WEBVIEW_PARTITION_PREFIX}:${encodeURIComponent(normalizedHostId)}`
}

export function isOrchestratorBrowserWebviewPartition(partition: unknown): partition is string {
  if (typeof partition !== 'string') return false
  return partition === ORCHESTRATOR_BROWSER_WEBVIEW_PARTITION_PREFIX ||
    partition.startsWith(`${ORCHESTRATOR_BROWSER_WEBVIEW_PARTITION_PREFIX}:`)
}
