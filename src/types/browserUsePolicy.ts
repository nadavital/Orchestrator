export type BrowserUseApprovalMode = 'alwaysAsk' | 'alwaysAllow'

export interface BrowserUsePolicy {
  approvalMode: BrowserUseApprovalMode
  historyApprovalMode: BrowserUseApprovalMode
  downloadApprovalMode: BrowserUseApprovalMode
  uploadApprovalMode: BrowserUseApprovalMode
  allowedOrigins: string[]
  blockedOrigins: string[]
  allowedDownloadOrigins: string[]
  blockedDownloadOrigins: string[]
  allowedUploadOrigins: string[]
  blockedUploadOrigins: string[]
}

export const DEFAULT_BROWSER_USE_POLICY: BrowserUsePolicy = {
  approvalMode: 'alwaysAsk',
  historyApprovalMode: 'alwaysAsk',
  downloadApprovalMode: 'alwaysAsk',
  uploadApprovalMode: 'alwaysAsk',
  allowedOrigins: ['localhost', '127.0.0.1'],
  blockedOrigins: [],
  allowedDownloadOrigins: [],
  blockedDownloadOrigins: [],
  allowedUploadOrigins: [],
  blockedUploadOrigins: []
}

export function normalizeBrowserUsePolicy(value: unknown): BrowserUsePolicy {
  const record = value && typeof value === 'object' ? value as Partial<BrowserUsePolicy> : {}
  return {
    approvalMode: normalizeBrowserUseApprovalMode(record.approvalMode, DEFAULT_BROWSER_USE_POLICY.approvalMode),
    historyApprovalMode: normalizeBrowserUseApprovalMode(record.historyApprovalMode, DEFAULT_BROWSER_USE_POLICY.historyApprovalMode),
    downloadApprovalMode: normalizeBrowserUseApprovalMode(record.downloadApprovalMode, DEFAULT_BROWSER_USE_POLICY.downloadApprovalMode),
    uploadApprovalMode: normalizeBrowserUseApprovalMode(record.uploadApprovalMode, DEFAULT_BROWSER_USE_POLICY.uploadApprovalMode),
    allowedOrigins: normalizeBrowserUseOrigins(record.allowedOrigins, DEFAULT_BROWSER_USE_POLICY.allowedOrigins),
    blockedOrigins: normalizeBrowserUseOrigins(record.blockedOrigins, DEFAULT_BROWSER_USE_POLICY.blockedOrigins),
    allowedDownloadOrigins: normalizeBrowserUseOrigins(record.allowedDownloadOrigins, DEFAULT_BROWSER_USE_POLICY.allowedDownloadOrigins),
    blockedDownloadOrigins: normalizeBrowserUseOrigins(record.blockedDownloadOrigins, DEFAULT_BROWSER_USE_POLICY.blockedDownloadOrigins),
    allowedUploadOrigins: normalizeBrowserUseOrigins(record.allowedUploadOrigins, DEFAULT_BROWSER_USE_POLICY.allowedUploadOrigins),
    blockedUploadOrigins: normalizeBrowserUseOrigins(record.blockedUploadOrigins, DEFAULT_BROWSER_USE_POLICY.blockedUploadOrigins)
  }
}

export function normalizeBrowserUseApprovalMode(value: unknown, fallback: BrowserUseApprovalMode = 'alwaysAsk'): BrowserUseApprovalMode {
  return value === 'alwaysAsk' || value === 'alwaysAllow' ? value : fallback
}

export function normalizeBrowserUseOrigin(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const parsed = new URL(withProtocol)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim()
      .toLowerCase()
  }
}

export function normalizeBrowserUseOrigins(value: unknown, fallback: string[] = []): string[] {
  const rawValues = Array.isArray(value) ? value : fallback
  return Array.from(new Set(
    rawValues
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeBrowserUseOrigin)
      .filter(Boolean)
  ))
}
