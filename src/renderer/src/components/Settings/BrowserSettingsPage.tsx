import { useState } from 'react'
import { browserWebviewPartitionForHost } from '../../types'
import {
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

type BrowserClearDataKind = 'all' | 'cache' | 'cookies' | 'siteData'

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

  return (
    <div data-settings-page-module="browser">
      <SettingsPageSection dataTestId="browser-settings-section" className="browser-settings-page">
        <SettingsContentLayout
          title="Browser"
          subtitle={`Manage the built-in Browser data and permissions for ${hostLabel}.`}
          dataTestId="settings-content-layout-browser"
        >
          <SettingsContentGroup className="browser-settings-content-group">
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
                <div className="browser-settings-status" data-testid="settings-browser-clear-status">
                  {status}
                </div>
              )}
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="browser-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Permissions</div>
              <div className="settings-content-description">Session Browser permissions stay with each Browser panel so agent runs cannot silently inherit unrelated decisions.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="browser-settings-surface" dataTestId="settings-browser-permissions-surface">
                <SettingsRow
                  label="Approval"
                  description="Choose whether website opening asks first from the Browser panel Security inspector."
                  control={<span className="browser-settings-value">Session scoped</span>}
                />
                <SettingsRow
                  label="History"
                  description="Choose whether history access asks first from the Browser panel Security inspector."
                  control={<span className="browser-settings-value">Session scoped</span>}
                />
                <SettingsRow
                  label="Domains"
                  description="Allowed, blocked, download, and upload domain lists live in the Browser panel Security inspector."
                  control={<span className="browser-settings-value">Per Browser</span>}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
      </SettingsPageSection>
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
