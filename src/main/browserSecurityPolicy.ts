export type BrowserApprovalMode = 'alwaysAsk' | 'alwaysAllow'
export type BrowserTransferKind = 'download' | 'upload'

export interface BrowserSecurityPolicy {
  downloadApprovalMode: BrowserApprovalMode
  uploadApprovalMode: BrowserApprovalMode
  allowedDownloadOrigins: string[]
  blockedDownloadOrigins: string[]
  allowedUploadOrigins: string[]
  blockedUploadOrigins: string[]
}

export const DEFAULT_BROWSER_SECURITY_POLICY: BrowserSecurityPolicy = {
  downloadApprovalMode: 'alwaysAsk',
  uploadApprovalMode: 'alwaysAsk',
  allowedDownloadOrigins: [],
  blockedDownloadOrigins: [],
  allowedUploadOrigins: [],
  blockedUploadOrigins: []
}

let browserSecurityPolicy: BrowserSecurityPolicy = { ...DEFAULT_BROWSER_SECURITY_POLICY }

export function setBrowserSecurityPolicy(patch: Partial<BrowserSecurityPolicy>): BrowserSecurityPolicy {
  browserSecurityPolicy = {
    ...browserSecurityPolicy,
    ...patch,
    downloadApprovalMode: normalizeApprovalMode(patch.downloadApprovalMode ?? browserSecurityPolicy.downloadApprovalMode),
    uploadApprovalMode: normalizeApprovalMode(patch.uploadApprovalMode ?? browserSecurityPolicy.uploadApprovalMode),
    allowedDownloadOrigins: normalizeOrigins(patch.allowedDownloadOrigins ?? browserSecurityPolicy.allowedDownloadOrigins),
    blockedDownloadOrigins: normalizeOrigins(patch.blockedDownloadOrigins ?? browserSecurityPolicy.blockedDownloadOrigins),
    allowedUploadOrigins: normalizeOrigins(patch.allowedUploadOrigins ?? browserSecurityPolicy.allowedUploadOrigins),
    blockedUploadOrigins: normalizeOrigins(patch.blockedUploadOrigins ?? browserSecurityPolicy.blockedUploadOrigins)
  }
  return getBrowserSecurityPolicy()
}

export function getBrowserSecurityPolicy(): BrowserSecurityPolicy {
  return {
    ...browserSecurityPolicy,
    allowedDownloadOrigins: [...browserSecurityPolicy.allowedDownloadOrigins],
    blockedDownloadOrigins: [...browserSecurityPolicy.blockedDownloadOrigins],
    allowedUploadOrigins: [...browserSecurityPolicy.allowedUploadOrigins],
    blockedUploadOrigins: [...browserSecurityPolicy.blockedUploadOrigins]
  }
}

export function browserSecurityPolicyAllows(kind: BrowserTransferKind, rawUrl: string): boolean {
  const policy = browserSecurityPolicy
  const origin = originKeyFromUrl(rawUrl)
  if (!origin) return false

  const allowedOrigins = kind === 'download' ? policy.allowedDownloadOrigins : policy.allowedUploadOrigins
  const blockedOrigins = kind === 'download' ? policy.blockedDownloadOrigins : policy.blockedUploadOrigins
  const approvalMode = kind === 'download' ? policy.downloadApprovalMode : policy.uploadApprovalMode

  if (blockedOrigins.includes(origin)) return false
  if (allowedOrigins.includes(origin)) return true
  return approvalMode === 'alwaysAllow'
}

export function originKeyFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    return normalizeOrigin(parsed.hostname)
  } catch {
    return normalizeOrigin(rawUrl)
  }
}

function normalizeApprovalMode(value: BrowserApprovalMode | undefined): BrowserApprovalMode {
  return value === 'alwaysAllow' ? 'alwaysAllow' : 'alwaysAsk'
}

function normalizeOrigins(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeOrigin).filter((value): value is string => Boolean(value))))
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  try {
    return new URL(trimmed).hostname.replace(/^www\./, '') || null
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}
