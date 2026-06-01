import { useEffect, useId, useState } from 'react'
import type { BrowserUsePolicy } from '../../types'
import { browserWebviewPartitionForHost, normalizeBrowserUseOrigin, normalizeBrowserUsePolicy } from '../../types'
import Icon from '../shared/Icon'
import {
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

type BrowserClearDataKind = 'all' | 'cache' | 'cookies' | 'siteData'
type BrowserPolicyListKey =
  | 'allowedOrigins'
  | 'blockedOrigins'
  | 'allowedDownloadOrigins'
  | 'blockedDownloadOrigins'
  | 'allowedUploadOrigins'
  | 'blockedUploadOrigins'

interface BrowserSettingsPageProps {
  hostId: string
  hostLabel: string
}

const CLEAR_LABELS: Record<BrowserClearDataKind, string> = {
  all: 'Browsing data cleared',
  cache: 'Browser cache cleared',
  cookies: 'Browser cookies cleared',
  siteData: 'Browser site data cleared'
}

export default function BrowserSettingsPage({ hostId, hostLabel }: BrowserSettingsPageProps): JSX.Element {
  const [clearing, setClearing] = useState<BrowserClearDataKind | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [policy, setPolicy] = useState<BrowserUsePolicy>(() => normalizeBrowserUsePolicy(null))
  const [policyStatus, setPolicyStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.settings.get()
      .then((settings) => {
        if (!cancelled) setPolicy(normalizeBrowserUsePolicy(settings.browserUsePolicy))
      })
      .catch(() => {
        if (!cancelled) setPolicy(normalizeBrowserUsePolicy(null))
      })
    return () => { cancelled = true }
  }, [])

  const clearData = async (kind: BrowserClearDataKind): Promise<void> => {
    setClearing(kind)
    setStatus(null)
    try {
      await window.api.browser.clearData(kind, browserWebviewPartitionForHost(hostId))
      setStatus(CLEAR_LABELS[kind])
    } catch {
      setStatus('Unable to clear browsing data')
    } finally {
      setClearing(null)
    }
  }

  const savePolicy = async (patch: Partial<BrowserUsePolicy>): Promise<void> => {
    const nextPolicy = normalizeBrowserUsePolicy({ ...policy, ...patch })
    setPolicy(nextPolicy)
    setPolicyStatus(null)
    try {
      await window.api.settings.set('browserUsePolicy', nextPolicy)
      setPolicyStatus('Browser permissions saved')
    } catch {
      setPolicyStatus('Unable to save browser permissions')
    }
  }

  return (
    <div data-settings-page-module="browser">
      <SettingsPageSection dataTestId="browser-settings-section" className="browser-settings-page">
        <SettingsContentLayout
          title="Browser"
          subtitle={`Manage the built-in Browser data and permissions for ${hostLabel}.`}
          dataTestId="settings-content-layout-browser"
        >
          <SettingsContentGroup
            className="browser-settings-content-group"
            rootAttrs={{
              tabIndex: -1,
              'data-settings-search-anchor': 'browser-data'
            }}
          >
            <div className="settings-content-heading">
              <div className="settings-content-title">Data</div>
              <div className="settings-content-description">Clear site data and cache from the in-app Browser for this host.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="browser-settings-surface" dataTestId="settings-browser-data-surface">
                <SettingsRow
                  label="Browsing data"
                  description="Delete cookies, site data, cached images, and files."
                  control={(
                    <button
                      type="button"
                      className="settings-action-button"
                      disabled={clearing !== null}
                      data-testid="settings-browser-clear-all"
                      onClick={() => void clearData('all')}
                    >
                      {clearing === 'all' ? 'Clearing...' : 'Clear all browsing data'}
                    </button>
                  )}
                />
                <SettingsRow
                  label="Cookies"
                  description="Remove stored sign-in cookies from Browser webviews."
                  control={<ClearButton kind="cookies" label="Delete cookies" clearing={clearing} onClear={clearData} />}
                />
                <SettingsRow
                  label="Site data"
                  description="Remove local storage, IndexedDB, service workers, and related site state."
                  control={<ClearButton kind="siteData" label="Delete site data" clearing={clearing} onClear={clearData} />}
                />
                <SettingsRow
                  label="Cached images and files"
                  description="Remove cached responses without deleting cookies or site storage."
                  control={<ClearButton kind="cache" label="Delete cached images and files" clearing={clearing} onClear={clearData} />}
                />
              </SettingsSurface>
              {status && (
                <div
                  className="browser-settings-status"
                  data-testid="settings-browser-clear-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {status}
                </div>
              )}
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup
            className="browser-settings-content-group"
            rootAttrs={{
              tabIndex: -1,
              'data-settings-search-anchor': 'browser-permissions'
            }}
          >
            <div className="settings-content-heading">
              <div className="settings-content-title">Permissions</div>
              <div className="settings-content-description">Defaults for new Browser panels. A session can still override these in the Browser Security inspector.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="browser-settings-surface" dataTestId="settings-browser-permissions-surface">
                <SettingsRow
                  label="Approval"
                  description="Choose if Orchestrator asks before opening websites."
                  control={<PolicySelect value={policy.approvalMode} dataTestId="settings-browser-approval-mode" onChange={(approvalMode) => void savePolicy({ approvalMode })} />}
                />
                <SettingsRow
                  label="History"
                  description="Choose if Orchestrator asks before accessing Browser history."
                  control={<PolicySelect value={policy.historyApprovalMode} dataTestId="settings-browser-history-mode" onChange={(historyApprovalMode) => void savePolicy({ historyApprovalMode })} />}
                />
                <SettingsRow
                  label="Downloads"
                  description="Choose if file downloads ask first unless a domain rule applies."
                  control={<PolicySelect value={policy.downloadApprovalMode} dataTestId="settings-browser-download-mode" onChange={(downloadApprovalMode) => void savePolicy({ downloadApprovalMode })} />}
                />
                <SettingsRow
                  label="Uploads"
                  description="Choose if file uploads ask first unless a domain rule applies."
                  control={<PolicySelect value={policy.uploadApprovalMode} dataTestId="settings-browser-upload-mode" onChange={(uploadApprovalMode) => void savePolicy({ uploadApprovalMode })} />}
                />
              </SettingsSurface>
              {policyStatus && (
                <div
                  className="browser-settings-status"
                  data-testid="settings-browser-policy-status"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {policyStatus}
                </div>
              )}
            </SettingsGroupContent>
          </SettingsContentGroup>

          <details
            className="settings-advanced-disclosure browser-domains-disclosure"
            data-testid="settings-browser-domains-disclosure"
            tabIndex={-1}
            data-settings-search-anchor="browser-domains"
          >
            <summary className="settings-advanced-summary" data-testid="settings-browser-domains-toggle">
              <span className="settings-advanced-summary-copy">
                <span className="settings-advanced-summary-title">Domain rules</span>
                <span className="settings-advanced-summary-description">Allowed and blocked defaults for Browser opening, downloads, and uploads.</span>
              </span>
            </summary>

            <div className="settings-advanced-body">
              <SettingsContentGroup className="browser-settings-content-group">
                <div className="settings-content-heading">
                  <div className="settings-content-title">Domains</div>
                  <div className="settings-content-description">Persist allowed and blocked domain defaults for Browser opening, downloads, and uploads.</div>
                </div>
                <SettingsGroupContent>
                  <SettingsSurface className="browser-settings-surface browser-domain-settings-surface" dataTestId="settings-browser-domains-surface">
                    <DomainPolicyRow title="Allowed domains" description="Domains that can open without asking." listKey="allowedOrigins" values={policy.allowedOrigins} onSave={savePolicy} />
                    <DomainPolicyRow title="Blocked domains" description="Domains Orchestrator will not open." listKey="blockedOrigins" values={policy.blockedOrigins} onSave={savePolicy} />
                    <DomainPolicyRow title="Allowed download domains" description="Domains that can download files without asking." listKey="allowedDownloadOrigins" values={policy.allowedDownloadOrigins} onSave={savePolicy} />
                    <DomainPolicyRow title="Blocked download domains" description="Domains Orchestrator will not download files from." listKey="blockedDownloadOrigins" values={policy.blockedDownloadOrigins} onSave={savePolicy} />
                    <DomainPolicyRow title="Allowed upload domains" description="Domains that can receive file uploads without asking." listKey="allowedUploadOrigins" values={policy.allowedUploadOrigins} onSave={savePolicy} />
                    <DomainPolicyRow title="Blocked upload domains" description="Domains Orchestrator will not upload files to." listKey="blockedUploadOrigins" values={policy.blockedUploadOrigins} onSave={savePolicy} />
                  </SettingsSurface>
                </SettingsGroupContent>
              </SettingsContentGroup>
            </div>
          </details>
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}

function PolicySelect({
  value,
  dataTestId,
  onChange
}: {
  value: BrowserUsePolicy['approvalMode']
  dataTestId: string
  onChange: (value: BrowserUsePolicy['approvalMode']) => void
}): JSX.Element {
  return (
    <select
      value={value}
      data-testid={dataTestId}
      className="browser-settings-select"
      onChange={(event) => onChange(event.target.value as BrowserUsePolicy['approvalMode'])}
    >
      <option value="alwaysAsk">Always ask</option>
      <option value="alwaysAllow">Always allow</option>
    </select>
  )
}

function DomainPolicyRow({
  title,
  description,
  listKey,
  values,
  onSave
}: {
  title: string
  description: string
  listKey: BrowserPolicyListKey
  values: string[]
  onSave: (patch: Partial<BrowserUsePolicy>) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const titleId = useId()
  const inputId = useId()

  const addDomain = (): void => {
    const normalized = normalizeBrowserUseOrigin(draft)
    if (!normalized) return
    setDraft('')
    void onSave({ [listKey]: Array.from(new Set([...values, normalized])) } as Partial<BrowserUsePolicy>)
  }

  const removeDomain = (value: string): void => {
    void onSave({ [listKey]: values.filter((item) => item !== value) } as Partial<BrowserUsePolicy>)
  }

  return (
    <div className="browser-domain-policy-row" data-testid="settings-browser-domain-policy-row" data-browser-policy-list={listKey}>
      <div className="browser-domain-policy-copy">
        <div className="settings-row-label" id={titleId}>{title}</div>
        <div className="settings-row-description">{description}</div>
        <div
          className="browser-domain-policy-values"
          data-testid="settings-browser-domain-policy-values"
          role="list"
          aria-label={`${title} entries`}
        >
          {values.length === 0 ? (
            <span className="browser-domain-empty" role="listitem">None</span>
          ) : values.map((value) => (
            <span key={value} className="browser-domain-pill" role="listitem">
              <span className="browser-domain-pill-label">{value}</span>
              <button type="button" className="browser-domain-pill-remove" aria-label={`Remove ${value}`} onClick={() => removeDomain(value)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="browser-domain-policy-control">
        <input
          id={inputId}
          value={draft}
          className="browser-domain-input"
          data-testid={`settings-browser-${listKey}-input`}
          placeholder="example.com"
          aria-labelledby={titleId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addDomain()
            }
          }}
        />
        <button
          type="button"
          className="settings-action-button"
          disabled={!draft.trim()}
          data-testid={`settings-browser-${listKey}-add`}
          aria-label={`Add ${title.toLowerCase()}`}
          onClick={addDomain}
        >
          Add
        </button>
      </div>
    </div>
  )
}

function ClearButton({
  kind,
  label,
  clearing,
  onClear
}: {
  kind: BrowserClearDataKind
  label: string
  clearing: BrowserClearDataKind | null
  onClear: (kind: BrowserClearDataKind) => Promise<void>
}): JSX.Element {
  return (
    <button
      type="button"
      className="settings-action-button"
      disabled={clearing !== null}
      data-testid={`settings-browser-clear-${kind}`}
      onClick={() => void onClear(kind)}
    >
      {clearing === kind ? 'Clearing...' : label}
    </button>
  )
}
