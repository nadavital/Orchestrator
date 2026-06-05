import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  DndContext, closestCenter, type DragEndEvent,
  KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  PROVIDER_DEFS,
  fastBaseModelIdForProviderModel,
  getConfigurableModels,
  getVisibleModels,
  mergeProviderModelCatalog,
  type ProviderCapabilityGap,
  type ProviderAuthFlowResult,
  type ProviderAuthSecretStatus,
  type ProviderCommandSurface,
  type ProviderCommandSurfaceResult,
  type ProviderDiagnosticInfo,
  type ProviderRuntimeConnectionState,
  type ProviderRuntimeDebugEvent,
  type ProviderRuntimeInfo,
  type ProviderSidebarSyncResult,
  type SessionListItem,
  type UsageSummary
} from '../../types'
import ProviderIcon from '../shared/ProviderIcon'
import Icon from '../shared/Icon'
import { useSessionStore } from '../../store/sessions'
import {
  DiagnosticPill,
  SettingsContentLayout,
  SettingsContentGroup,
  SettingsGroupContent,
  SegmentedControl as SystemSegmentedControl,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

// ─── Providers section ────────────────────────────────────────────────────────

export default function ProvidersSettingsPage({
  defaultProvider, sessions, defaultEfforts, providerModels,
  providerRuntime, providerDiagnostics, providerAvailability, selectedProviderId, copilotByokProvider, onSetDefaultProvider, onSetDefaultEffort, onSetProviderModels, onSetCopilotByokProvider, onLoadProviderDiagnostics
}: {
  defaultProvider: string
  sessions: SessionListItem[]
  defaultEfforts: Record<string, string>
  providerModels: Record<string, string[]>
  providerRuntime: Record<string, ProviderRuntimeInfo>
  providerDiagnostics: Record<string, ProviderDiagnosticInfo>
  providerAvailability: Record<string, boolean>
  selectedProviderId: string
  copilotByokProvider: CopilotByokProviderSettings
  onSetDefaultProvider: (id: string) => void
  onSetDefaultEffort: (providerId: string, effortId: string) => void
  onSetProviderModels: (providerId: string, models: string[]) => void
  onSetCopilotByokProvider: (settings: CopilotByokProviderSettings) => void
  onLoadProviderDiagnostics: (providerId: string, options?: { force?: boolean }) => void
}): JSX.Element {
  const selectedId = PROVIDER_DEFS[selectedProviderId] ? selectedProviderId : defaultProvider
  const providerDef = PROVIDER_DEFS[selectedId] ?? PROVIDER_DEFS.claude
  const installed = providerAvailability[selectedId] !== false
  const diagnostics = providerDiagnostics[selectedId]
  const modelCatalogProviderDef = providerDefWithDiagnosticModels(providerDef, diagnostics)
  const currentEffort = defaultEfforts[selectedId] ?? providerDef.effortLevels[0]?.id ?? ''
  const visibleModels = getVisibleModels(modelCatalogProviderDef, providerModels)
  const visibleIds = visibleModels.map((m) => m.id)
  const runtime = providerRuntime[selectedId]
  const settingsCommandSurfaces = visibleSettingsCommandSurfaces(selectedId, runtime?.registry.commandSurfaces ?? [])
  const authCommandSurfaces = visibleProviderAuthCommandSurfaces(selectedId, settingsCommandSurfaces)
  const endpointConfig = providerEndpointConfig(selectedId)

  useEffect(() => {
    onLoadProviderDiagnostics(selectedId)
  }, [onLoadProviderDiagnostics, selectedId])

  const handleVisibleModelsChange = (ids: string[]): void => {
    onSetProviderModels(selectedId, ids)
  }

  return (
    <div data-settings-page-module="providers">
      <SettingsPageSection className="provider-settings-shell" dataTestId="provider-settings-section">
        <SettingsContentLayout
          title="Providers"
          subtitle="Configure provider accounts and model order."
          dataTestId="settings-content-layout-providers"
        >
          <div className="provider-settings-stack">
            <div key={selectedId} className="provider-settings-main">
              <SettingsContentGroup
                className="provider-settings-content-group"
                rootAttrs={{
                  tabIndex: -1,
                  'data-settings-search-anchor': 'provider-defaults'
                }}
              >
                <SettingsGroupContent>
                  <SettingsSurface className="provider-settings-control-surface">
                    <ProviderCompactHeader
                      providerDef={providerDef}
                      installed={installed}
                      isDefault={defaultProvider === selectedId}
                      onSetDefault={() => onSetDefaultProvider(selectedId)}
                    />

                {providerDef.supportsEffort && providerDef.effortLevels.length > 0 && (
                  <SettingsRow
                    label="Thinking"
                    className="provider-settings-row"
                    control={(
                      <SegmentedControl
                        items={providerDef.effortLevels}
                        value={currentEffort}
                        color={providerDef.color}
                        ariaLabel={`${providerDef.name} thinking level`}
                        onChange={(id) => onSetDefaultEffort(selectedId, id)}
                      />
                    )}
                  />
                )}

                {endpointConfig && (
                  <SettingsRow
                    label="Endpoint"
                    className="provider-settings-row provider-settings-row-stacked"
                    control={<ProviderEndpointField providerId={providerDef.id} color={providerDef.color} />}
                  />
                )}

                {providerDef.id === 'copilot' && (
                  <SettingsRow
                    label="Custom provider"
                    className="provider-settings-row provider-settings-row-stacked"
                    control={(
                      <CopilotByokProviderField
                        color={providerDef.color}
                        value={copilotByokProvider}
                        onChange={onSetCopilotByokProvider}
                      />
                    )}
                  />
                )}

                {(providerDef.id === 'cursor' || authCommandSurfaces.length > 0) && (
                  <SettingsRow
                    label="Auth"
                    className="provider-settings-row provider-settings-row-stacked"
                    control={(
                      <div className="provider-auth-stack">
                        {providerDef.id === 'cursor' && <CursorAuthField color={providerDef.color} />}
                        {authCommandSurfaces.length > 0 && (
                          <ProviderManagedAuthActions
                            providerId={providerDef.id}
                            color={providerDef.color}
                            surfaces={authCommandSurfaces}
                            sessions={sessions}
                            authStatus={diagnostics?.auth.status}
                            onAuthFlowSettled={() => onLoadProviderDiagnostics(providerDef.id, { force: true })}
                          />
                        )}
                      </div>
                    )}
                  />
                )}

                <SettingsRow
                  label="Models"
                  className="provider-settings-row provider-settings-row-stacked"
                  control={(
                    <div className="provider-models-row">
                      <div className="provider-model-list-block">
                        <div className="provider-model-list-header">
                          <div className="provider-model-row-copy">
                            <div className="provider-model-inline-label">Composer order</div>
                          </div>
                        </div>
                        <ModelListManager
                          providerDef={modelCatalogProviderDef}
                          visibleIds={visibleIds}
                          onChange={handleVisibleModelsChange}
                        />
                      </div>
                    </div>
                  )}
                />

              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

        </div>
          </div>
        </SettingsContentLayout>
      </SettingsPageSection>
    </div>
  )
}

const CODEX_SETTINGS_COMMAND_SURFACE_IDS = new Set([
  'appserver-models',
  'appserver-model-provider-capabilities',
  'appserver-features',
  'appserver-config',
  'appserver-config-requirements',
  'appserver-account',
  'appserver-rate-limits',
  'appserver-auth-status',
  'codex-login-status',
  'codex-login-device',
  'codex-login-api-key',
  'codex-logout'
])

const PROVIDER_AUTH_COMMAND_SURFACE_IDS = new Set([
  'auth-status',
  'auth-login',
  'auth-logout',
  'appserver-auth-status',
  'codex-login-status',
  'codex-login-device',
  'codex-login-api-key',
  'codex-logout',
  'copilot-login'
])

function supportsProviderManagedAuthFlow(providerId: string, surface: ProviderCommandSurface): boolean {
  return providerId === 'copilot' && surface.id === 'copilot-login'
}

function providerAuthActionLabel(surface: ProviderCommandSurface): string {
  const haystack = `${surface.id} ${surface.label}`.toLowerCase()
  if (haystack.includes('logout') || haystack.includes('sign out')) return 'Sign out'
  if (haystack.includes('login') || haystack.includes('sign in')) return 'Sign in'
  if (haystack.includes('status') || haystack.includes('account')) return 'Check status'
  return surface.label
}

function providerDefWithDiagnosticModels(
  providerDef: typeof PROVIDER_DEFS[string],
  diagnostics: ProviderDiagnosticInfo | undefined
): typeof PROVIDER_DEFS[string] {
  const items = diagnostics?.models.status === 'available' ? diagnostics.models.items ?? [] : []
  if (items.length > 0) return mergeProviderModelCatalog(providerDef, items)
  const ids = diagnostics?.models.status === 'available' ? diagnostics.models.ids ?? [] : []
  if (ids.length === 0) return providerDef
  const knownModels = new Map(providerDef.models.map((model) => [model.id, model]))
  const models = ids
    .map((id) => {
      const baseId = fastBaseModelIdForProviderModel(providerDef, id)
      return knownModels.get(baseId ?? id) ?? { id, label: readableModelLabel(id) }
    })
    .filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index)
  return {
    ...providerDef,
    models
  }
}

function readableModelLabel(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function ProviderCompactHeader({
  providerDef,
  installed,
  isDefault,
  onSetDefault
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  installed: boolean
  isDefault: boolean
  onSetDefault: () => void
}): JSX.Element {
  return (
    <div className="provider-compact-header">
      <div className="provider-compact-identity">
        <span className="provider-compact-identity-icon" aria-hidden="true">
          <ProviderIcon providerId={providerDef.id} size={17} color={providerDef.color} />
        </span>
        <span className="provider-compact-identity-copy">
          <span className="provider-compact-identity-name">{providerDef.name}</span>
          <span className="provider-compact-identity-status">{isDefault ? 'Default · ' : ''}{installed ? 'Installed' : 'Missing'}</span>
        </span>
      </div>
      {!isDefault && (
        <div className="provider-compact-header-actions">
          <button
            onClick={onSetDefault}
            disabled={!installed}
            className="settings-action-button provider-compact-default-action"
          >
            Set default
          </button>
        </div>
      )}
      {!installed && <InstallCommand cmd={providerDef.installCmd} />}
    </div>
  )
}

function ProviderDetailCard({
  title,
  children,
  wide = false
}: {
  title?: string
  children: ReactNode
  wide?: boolean
}): JSX.Element {
  return (
    <section className="provider-detail-card" data-wide={wide ? 'true' : 'false'}>
      {title && <div className="provider-detail-card-title">{title}</div>}
      <div className="provider-detail-card-body">{children}</div>
    </section>
  )
}

function ProviderStatusDetails({
  providerId,
  diagnostics,
  loadingDiagnostics,
  usage,
  color,
  sidebarSyncResult,
  sidebarSyncLoading,
  onRefreshSidebarMetadata
}: {
  providerId: string
  diagnostics?: ProviderDiagnosticInfo
  loadingDiagnostics: boolean
  usage: ProviderUsageSnapshot
  color: string
  sidebarSyncResult?: ProviderSidebarSyncResult | null
  sidebarSyncLoading?: boolean
  onRefreshSidebarMetadata?: () => Promise<void>
}): JSX.Element {
  const providerSidebarStatusId = useId()
  const sidebarSyncStatus = sidebarSyncStatusState(sidebarSyncLoading === true, sidebarSyncResult)
  return (
    <div
      className="provider-status-card"
      data-testid="provider-status-card"
      data-provider-sidebar-refresh-status={sidebarSyncStatus?.text ?? ''}
      data-provider-sidebar-refresh-status-tone={sidebarSyncStatus?.tone ?? ''}
    >
      <div className="provider-status-section">
        <div className="provider-status-section-title">
          <span>Status</span>
          {onRefreshSidebarMetadata && (
            <button
              type="button"
              className="settings-action-button"
              data-testid="provider-sidebar-metadata-refresh"
              onClick={() => { void onRefreshSidebarMetadata() }}
              disabled={sidebarSyncLoading === true}
              aria-describedby={sidebarSyncStatus ? providerSidebarStatusId : undefined}
            >
              {sidebarSyncLoading ? 'Refreshing...' : 'Refresh chats'}
            </button>
          )}
        </div>
        {loadingDiagnostics && !diagnostics ? (
          <InlineMutedText>Checking local CLI...</InlineMutedText>
        ) : diagnostics ? (
          <ProviderDiagnosticsCard diagnostics={diagnostics} color={color} />
        ) : (
          <InlineMutedText>Open details to check local CLI status.</InlineMutedText>
        )}
        {onRefreshSidebarMetadata && sidebarSyncStatus && (
          <div
            id={providerSidebarStatusId}
            className="provider-sidebar-refresh-status"
            data-testid="provider-sidebar-metadata-refresh-status"
            data-provider-sidebar-refresh-status-tone={sidebarSyncStatus.tone}
            role={sidebarSyncStatus.tone === 'danger' ? 'alert' : 'status'}
            aria-live={sidebarSyncStatus.tone === 'danger' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {sidebarSyncStatus.text}
          </div>
        )}
      </div>
      <div className="provider-status-section">
        <div className="provider-status-section-title">Usage</div>
        <ProviderUsageDiagnosticsCard
          providerId={providerId}
          diagnostics={diagnostics}
          usage={usage}
          color={color}
        />
      </div>
      {diagnostics && (
        <div className="provider-status-section">
          <div className="provider-status-section-title">Runtime</div>
          <ProviderRuntimeEventsCard
            connections={diagnostics.runtimeConnections ?? []}
            events={diagnostics.runtimeEvents ?? []}
            color={color}
          />
        </div>
      )}
    </div>
  )
}

function sidebarSyncStatusText(result: ProviderSidebarSyncResult): string {
  if (!result.ok) return result.error ? `Refresh failed: ${result.error}` : 'Refresh failed.'
  if (result.skipped === 'no-provider-sessions') return 'No Codex chats are present to refresh.'
  if (result.skipped === 'unsupported-provider') return 'This provider does not expose sidebar metadata refresh.'
  if (result.changed === 0) return 'Chat metadata is already up to date.'
  return `Updated ${result.changed} chat${result.changed === 1 ? '' : 's'}.`
}

function sidebarSyncStatusState(
  loading: boolean,
  result: ProviderSidebarSyncResult | null | undefined
): { text: string; tone: 'info' | 'danger' } | null {
  if (loading) return { text: 'Refreshing chats', tone: 'info' }
  if (!result) return null
  return { text: sidebarSyncStatusText(result), tone: result.ok ? 'info' : 'danger' }
}

function ProviderRuntimeEventsCard({
  connections,
  events,
  color
}: {
  connections: ProviderRuntimeConnectionState[]
  events: ProviderRuntimeDebugEvent[]
  color: string
}): JSX.Element {
  const [actionStatus, setActionStatus] = useState<{ text: string; tone: 'info' | 'danger'; action: 'copy' | 'chat' } | null>(null)
  const statusTimeoutRef = useRef<number | null>(null)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const setComposerDraft = useSessionStore((state) => state.setComposerDraft)
  const visibleEvents = events.slice(-4).reverse()
  const visibleConnections = connections.slice(-2).reverse()
  useEffect(() => () => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
  }, [])
  const handleCopy = async (): Promise<void> => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
    try {
      await writeClipboardText(formatProviderRuntimeActivity(connections, events))
      setActionStatus({ text: 'Runtime activity copied', tone: 'info', action: 'copy' })
    } catch (error) {
      setActionStatus({ text: `Copy failed: ${errorText(error)}`, tone: 'danger', action: 'copy' })
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setActionStatus(null)
      statusTimeoutRef.current = null
    }, 1800)
  }

  const addRuntimeActivityToChat = (): void => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
    if (!activeSessionId) {
      setActionStatus({ text: 'No active chat selected', tone: 'danger', action: 'chat' })
    } else {
      const text = [
        'Use this provider runtime activity:',
        formatProviderRuntimeActivity(connections, events)
      ].join('\n')
      const currentDraft = useSessionStore.getState().uiState[activeSessionId]?.composerDraft?.trimEnd() ?? ''
      const globals = window as typeof window & { __orchestratorLastProviderRuntimeActivityForSmoke?: string }
      globals.__orchestratorLastProviderRuntimeActivityForSmoke = text
      setComposerDraft(activeSessionId, currentDraft ? `${currentDraft}\n\n${text}` : text)
      setActionStatus({ text: 'Runtime activity added to chat', tone: 'info', action: 'chat' })
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setActionStatus(null)
      statusTimeoutRef.current = null
    }, 1800)
  }

  const copySucceeded = actionStatus?.action === 'copy' && actionStatus.tone === 'info'
  return (
    <div
      data-testid="provider-runtime-events-card"
      data-provider-runtime-copy-status={actionStatus?.action === 'copy' ? actionStatus.text : ''}
      data-provider-runtime-copy-status-tone={actionStatus?.action === 'copy' ? actionStatus.tone : ''}
      data-provider-runtime-add-chat-status={actionStatus?.action === 'chat' ? actionStatus.text : ''}
      data-provider-runtime-add-chat-status-tone={actionStatus?.action === 'chat' ? actionStatus.tone : ''}
      style={{ display: 'grid', gap: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, minWidth: 0 }}>
        <InlineMutedText>Latest runtime activity</InlineMutedText>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
          <button
            type="button"
            className="provider-details-inline-action"
            data-testid="provider-runtime-events-add-chat"
            aria-label="Add provider runtime activity to chat"
            onClick={addRuntimeActivityToChat}
            style={{ '--provider-color': color } as CSSProperties}
          >
            <Icon name="chat" size={11} />
            Add to chat
          </button>
          <button
            type="button"
            className="provider-details-inline-action"
            data-testid="provider-runtime-events-copy"
            aria-label="Copy provider runtime activity"
            onClick={() => { void handleCopy() }}
            style={{ '--provider-color': color } as CSSProperties}
          >
            <Icon name="copy" size={11} />
            {copySucceeded ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {actionStatus && (
        <div
          data-testid="provider-runtime-events-action-status"
          role={actionStatus.tone === 'danger' ? 'alert' : 'status'}
          aria-live={actionStatus.tone === 'danger' ? 'assertive' : 'polite'}
          aria-atomic="true"
          style={{
            color: actionStatus.tone === 'danger' ? 'var(--state-danger)' : 'var(--text-secondary)',
            fontSize: 10.5,
            fontWeight: 600
          }}
        >
          {actionStatus.text}
        </div>
      )}
      {visibleConnections.length === 0 && visibleEvents.length === 0 && (
        <InlineMutedText>No runtime activity recorded for this provider yet.</InlineMutedText>
      )}
      {visibleConnections.map((connection) => (
        <div
          key={connection.id}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(72px, auto) minmax(0, 1fr)',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            padding: '6px 8px',
            borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <DiagnosticPill status={connection.status} color={color} />
          <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
                color: 'var(--color-text)'
              }}
            >
              {connection.message ?? `${connection.providerId} ${connection.runtime}`}
            </div>
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 10,
                color: 'var(--color-text-muted)'
              }}
            >
              {[connection.runtime, connection.version, connection.hostId].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      ))}
      {visibleEvents.map((event) => (
        <div
          key={event.id}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(54px, auto) minmax(0, 1fr)',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            padding: '6px 8px',
            borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <DiagnosticPill status={event.severity} color={color} />
          <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
                color: 'var(--color-text)'
              }}
            >
              {event.message}
            </div>
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 10,
                color: 'var(--color-text-muted)'
              }}
            >
              {[event.runtime, event.method, event.hostId].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatProviderRuntimeActivity(
  connections: ProviderRuntimeConnectionState[],
  events: ProviderRuntimeDebugEvent[]
): string {
  const lines = ['Provider runtime activity']
  const visibleConnections = connections.slice(-4).reverse()
  const visibleEvents = events.slice(-8).reverse()

  if (visibleConnections.length === 0 && visibleEvents.length === 0) {
    lines.push('No runtime activity recorded for this provider yet.')
    return lines.join('\n')
  }

  if (visibleConnections.length > 0) {
    lines.push('', 'Connections:')
    for (const connection of visibleConnections) {
      lines.push([
        `- ${connection.status}`,
        connection.providerId,
        connection.runtime,
        connection.version,
        connection.hostId,
        connection.message
      ].filter(Boolean).join(' · '))
    }
  }

  if (visibleEvents.length > 0) {
    lines.push('', 'Events:')
    for (const event of visibleEvents) {
      lines.push([
        `- ${event.severity}`,
        event.runtime,
        event.method,
        event.hostId,
        event.message
      ].filter(Boolean).join(' · '))
    }
  }

  return lines.join('\n')
}

function ProviderSetupDetails({
  providerDef,
  authCommandSurfaces,
  sessions,
  authStatus,
  onAuthFlowSettled
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  authCommandSurfaces: ProviderCommandSurface[]
  sessions: SessionListItem[]
  authStatus?: ProviderDiagnosticInfo['auth']['status']
  onAuthFlowSettled?: () => void
}): JSX.Element {
  return (
    <div className="provider-setup-card" data-testid="provider-setup-card">
      {providerDef.id === 'claude' && (
        <div className="provider-setup-row" data-testid="provider-setup-endpoint">
          <div className="provider-setup-label">Endpoint</div>
          <ProviderEndpointField providerId={providerDef.id} color={providerDef.color} />
        </div>
      )}
      {providerDef.id === 'cursor' && (
        <div className="provider-setup-row" data-testid="provider-setup-cursor-auth">
          <div className="provider-setup-label">Auth</div>
          <CursorAuthField color={providerDef.color} />
        </div>
      )}
      {authCommandSurfaces.length > 0 && (
        <div className="provider-setup-row" data-testid="provider-setup-managed-auth">
          <div className="provider-setup-label">Auth</div>
          <ProviderManagedAuthActions
            providerId={providerDef.id}
            color={providerDef.color}
            surfaces={authCommandSurfaces}
            sessions={sessions}
            authStatus={authStatus}
            onAuthFlowSettled={onAuthFlowSettled}
          />
        </div>
      )}
      <div className="provider-setup-row" data-testid="provider-setup-config">
        <div className="provider-setup-label">Config</div>
        <ProviderConfigEditor providerId={providerDef.id} color={providerDef.color} />
      </div>
    </div>
  )
}

function ProviderManagedAuthActions({
  providerId,
  color,
  surfaces,
  sessions,
  authStatus,
  onAuthFlowSettled
}: {
  providerId: string
  color: string
  surfaces: ProviderCommandSurface[]
  sessions: SessionListItem[]
  authStatus?: ProviderDiagnosticInfo['auth']['status']
  onAuthFlowSettled?: () => void
}): JSX.Element {
  const [results, setResults] = useState<Record<string, ProviderCommandSurfaceResult>>({})
  const [authFlows, setAuthFlows] = useState<Record<string, ProviderAuthFlowResult>>({})
  const [copiedCodes, setCopiedCodes] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const { terminalStatus, insertSurfaceInTerminal } = useProviderCommandTerminalHandoff(providerId, sessions)

  useEffect(() => {
    return window.api.providers.onAuthFlowUpdate((result) => {
      if (result.providerId !== providerId) return
      setAuthFlows((current) => ({ ...current, [result.surfaceId]: result }))
      if (result.status === 'completed' || result.status === 'error') onAuthFlowSettled?.()
    })
  }, [onAuthFlowSettled, providerId])

  const runSurface = async (surface: ProviderCommandSurface): Promise<void> => {
    if (surface.quota !== 'none' || surface.mutatesState) return
    setLoading((current) => ({ ...current, [surface.id]: true }))
    try {
      const result = await window.api.providers.runCommandSurface(providerId, surface.id)
      setResults((current) => ({ ...current, [surface.id]: result }))
    } finally {
      setLoading((current) => ({ ...current, [surface.id]: false }))
    }
  }

  const copyAuthCode = async (surfaceId: string, code: string): Promise<void> => {
    await writeClipboardText(code)
    setCopiedCodes((current) => ({ ...current, [surfaceId]: true }))
    window.setTimeout(() => {
      setCopiedCodes((current) => ({ ...current, [surfaceId]: false }))
    }, 1400)
  }

  const startAuthFlow = async (surface: ProviderCommandSurface): Promise<void> => {
    setLoading((current) => ({ ...current, [surface.id]: true }))
    try {
      const result = await window.api.providers.startAuthFlow(providerId, surface.id)
      setAuthFlows((current) => ({ ...current, [surface.id]: result }))
      if (result.status === 'completed' || result.status === 'error') onAuthFlowSettled?.()
    } catch (error) {
      setAuthFlows((current) => ({
        ...current,
        [surface.id]: {
          providerId,
          surfaceId: surface.id,
          status: 'error',
          message: errorText(error)
        }
      }))
    } finally {
      setLoading((current) => ({ ...current, [surface.id]: false }))
    }
  }

  return (
    <div data-testid="provider-managed-auth-actions" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {surfaces.map((surface) => {
          const runnable = surface.quota === 'none' && !surface.mutatesState
          const managedAuthFlow = supportsProviderManagedAuthFlow(providerId, surface)
          const waitingForBrowserAuth = managedAuthFlow && authFlows[surface.id]?.status === 'started'
          const signedIn = managedAuthFlow && (authFlows[surface.id]?.status === 'completed' || authStatus === 'ok')
          const busy = loading[surface.id] === true
          const actionLabel = providerAuthActionLabel(surface)
          return (
            <button
              key={surface.id}
              type="button"
              className="provider-command-output-action"
              data-testid={`provider-managed-auth-action-${surface.id}`}
              data-runnable="true"
              disabled={busy || waitingForBrowserAuth || signedIn || (!runnable && !managedAuthFlow && sessions.length === 0)}
              aria-label={`${managedAuthFlow ? 'Start' : runnable ? 'Check' : 'Open terminal for'} ${surface.label}`}
              onClick={() => {
                if (managedAuthFlow) void startAuthFlow(surface)
                else if (runnable) void runSurface(surface)
                else void insertSurfaceInTerminal(surface)
              }}
              style={{ '--provider-accent': color } as CSSProperties}
            >
              {busy ? (managedAuthFlow ? 'Starting' : 'Checking') : signedIn ? 'Signed in' : waitingForBrowserAuth ? 'Waiting for browser' : actionLabel}
            </button>
          )
        })}
      </div>
      {surfaces.map((surface) => {
        const runnable = surface.quota === 'none' && !surface.mutatesState
        const managedAuthFlow = supportsProviderManagedAuthFlow(providerId, surface)
        const result = results[surface.id]
        const authFlow = authFlows[surface.id]
        const status = terminalStatus?.surfaceId === surface.id ? terminalStatus : null
        return (
          <div
            key={`${surface.id}-detail`}
            data-testid={`provider-managed-auth-detail-${surface.id}`}
            style={{ display: 'grid', gap: 4, minWidth: 0 }}
          >
            {result && (
              <div
                style={{
                  color: result.status === 'ok' ? 'var(--color-green)' : result.status === 'error' ? 'var(--color-red)' : 'var(--color-text-muted)',
                  fontSize: 11,
                  lineHeight: 1.35
                }}
              >
                {result.status}: {compactProviderCommandOutput(result.output)}
              </div>
            )}
            {authFlow && (
              <div
                role={authFlow.status === 'error' ? 'alert' : 'status'}
                aria-live={authFlow.status === 'error' ? 'assertive' : 'polite'}
                data-testid={`provider-managed-auth-flow-${surface.id}`}
                style={{ display: 'grid', gap: 6, minWidth: 0 }}
              >
                <div
                  style={{
                    color: authFlow.status === 'error' ? 'var(--color-red)' : authFlow.status === 'unsupported' ? 'var(--color-text-muted)' : 'var(--color-green)',
                    fontSize: 11,
                    lineHeight: 1.35
                  }}
                >
                  {authFlow.message}
                </div>
                {authFlow.status === 'started' && authFlow.code && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
                    <code className="provider-command-output-command" data-testid={`provider-managed-auth-code-${surface.id}`}>
                      {authFlow.code}
                    </code>
                    <button
                      type="button"
                      className="provider-command-output-action"
                      onClick={() => void copyAuthCode(surface.id, authFlow.code ?? '')}
                      style={{ '--provider-accent': color } as CSSProperties}
                    >
                      {copiedCodes[surface.id] ? 'Copied' : 'Copy code'}
                    </button>
                  </div>
                )}
                {authFlow.status === 'started' && authFlow.url && (
                  <button
                    type="button"
                    className="provider-command-output-action"
                    onClick={() => void window.api.browser.openExternal(authFlow.url ?? '')}
                    style={{ '--provider-accent': color, justifySelf: 'start' } as CSSProperties}
                  >
                    Open GitHub sign-in
                  </button>
                )}
              </div>
            )}
            {status && (
              <div
                role={status.tone === 'danger' ? 'alert' : 'status'}
                aria-live={status.tone === 'danger' ? 'assertive' : 'polite'}
                data-testid="provider-managed-auth-terminal-status"
                style={{
                  color: status.tone === 'danger' ? 'var(--color-red)' : 'var(--color-text-muted)',
                  fontSize: 11,
                  lineHeight: 1.35
                }}
              >
                {status.text}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CursorAuthField({ color }: { color: string }): JSX.Element {
  const [status, setStatus] = useState<ProviderAuthSecretStatus | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'muted' | 'success' | 'error'>('muted')

  const refresh = async (): Promise<void> => {
    const next = await window.api.providers.getAuthSecretStatus('cursor')
    setStatus(next)
    setTone(next.configured ? 'success' : 'muted')
    setMessage(next.message ?? (next.configured ? 'API key saved in Keychain.' : 'No API key saved.'))
  }

  useEffect(() => {
    void refresh()
  }, [])

  const save = async (): Promise<void> => {
    const trimmed = keyValue.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const result = await window.api.providers.setAuthSecret('cursor', trimmed)
    setStatus(result.status)
    setKeyValue('')
    setTone(result.ok ? 'success' : 'error')
    setMessage(result.message ?? result.status.message ?? (result.ok ? 'Saved' : 'Save failed'))
    setBusy(false)
  }

  const validate = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setTone('muted')
    setMessage('Testing Cursor auth...')
    const result = await window.api.providers.validateAuthSecret('cursor')
    setTone(result.ok ? 'success' : 'error')
    setMessage(result.message)
    setBusy(false)
  }

  const remove = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const result = await window.api.providers.deleteAuthSecret('cursor')
    setStatus(result.status)
    setTone(result.ok ? 'muted' : 'error')
    setMessage(result.message ?? result.status.message ?? (result.ok ? 'Removed' : 'Remove failed'))
    setBusy(false)
  }

  const statusColor = tone === 'success'
    ? 'var(--color-green)'
    : tone === 'error'
      ? 'var(--color-red)'
      : 'var(--color-text-muted)'

  return (
    <div data-testid="cursor-auth-keychain-field" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ color: 'var(--color-text)', fontSize: 12, fontWeight: 650 }}>
          User API Key
        </div>
        <span
          data-testid="cursor-auth-keychain-status"
          data-cursor-auth-configured={status?.configured ? 'true' : 'false'}
          style={{
            fontSize: 10,
            color: statusColor,
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            padding: '1px 6px',
            background: 'var(--color-surface2)'
          }}
        >
          {status?.configured ? 'Keychain' : 'Not set'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
        <input
          type="password"
          value={keyValue}
          onChange={(event) => {
            setKeyValue(event.target.value)
            setTone('muted')
            setMessage(status?.configured ? 'Replace saved key' : 'Ready to save')
          }}
          placeholder={status?.configured ? 'Key saved in Keychain' : 'Cursor User API key'}
          data-testid="cursor-auth-key-input"
          style={{
            flex: '1 1 220px',
            minWidth: 0,
            padding: '7px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontFamily: 'monospace',
            background: 'var(--color-surface2)',
            border: `1px solid ${keyValue.trim() ? color : 'var(--color-border)'}`,
            color: 'var(--color-text)',
            outline: 'none'
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={!keyValue.trim() || busy}
          className="settings-action-button"
          data-testid="cursor-auth-save"
        >
          {busy && keyValue.trim() ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={validate}
          disabled={!status?.configured || busy}
          className="settings-action-button"
          data-testid="cursor-auth-test"
        >
          {busy && !keyValue.trim() ? 'Testing...' : 'Test'}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={!status?.configured || busy}
          className="settings-action-button"
          data-testid="cursor-auth-remove"
        >
          Remove
        </button>
      </div>
      <div
        data-testid="cursor-auth-message"
        data-cursor-auth-tone={tone}
        style={{ color: statusColor, fontSize: 11, lineHeight: 1.35 }}
      >
        {message || 'Cursor Dashboard / Integrations / User API Keys'}
      </div>
    </div>
  )
}

function visibleSettingsCommandSurfaces(providerId: string, surfaces: ProviderCommandSurface[]): ProviderCommandSurface[] {
  if (providerId !== 'codex') return surfaces
  return surfaces.filter((surface) => CODEX_SETTINGS_COMMAND_SURFACE_IDS.has(surface.id))
}

function visibleProviderAuthCommandSurfaces(_providerId: string, surfaces: ProviderCommandSurface[]): ProviderCommandSurface[] {
  return surfaces.filter((surface) => PROVIDER_AUTH_COMMAND_SURFACE_IDS.has(surface.id))
}

function compactProviderCommandOutput(output: string): string {
  const compact = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
  if (!compact) return 'No output'
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact
}

function ProviderDropdown({
  providers,
  selectedId,
  providerId,
  color,
  installed,
  isDefault,
  installCmd,
  onSelect,
  onSetDefault,
}: {
  providers: Array<typeof PROVIDER_DEFS[string]>
  selectedId: string
  providerId: string
  color: string
  installed: boolean
  isDefault: boolean
  installCmd: string
  onSelect: (id: string) => void
  onSetDefault: () => void
}): JSX.Element {
  const selectedProvider = providers.find((provider) => provider.id === providerId)
  const providerStatus = installed
    ? isDefault ? 'Default · Installed' : 'Installed'
    : installCmd

  return (
    <div
      data-testid="provider-selector-card"
      data-provider-selector-surface="shared"
      className="provider-selector-card"
      style={{ '--provider-color': color } as CSSProperties}
    >
      <div className="provider-selector-grid">
        <div
          data-testid="provider-selector-summary"
          className="provider-selector-summary"
        >
          <span className="provider-selector-icon">
            <ProviderIcon providerId={providerId} size={16} color={color} />
          </span>
          <span className="provider-selector-copy">
            <span className="provider-selector-name">
              {selectedProvider?.name ?? 'Provider'}
            </span>
            <span className="provider-selector-status">
              {providerStatus}
            </span>
          </span>
        </div>
        <select
          aria-label="Provider"
          value={selectedId}
          onChange={(event) => onSelect(event.target.value)}
          className="provider-selector-select"
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.name}</option>
          ))}
        </select>
        {!isDefault && (
          <button
            onClick={onSetDefault}
            disabled={!installed}
            className="settings-action-button provider-selector-default-action"
          >
            Set default
          </button>
        )}
      </div>
      {!installed && <InstallCommand cmd={installCmd} />}
    </div>
  )
}

function ProviderBoundarySummary({ gaps, color }: { gaps: ProviderCapabilityGap[]; color: string }): JSX.Element {
  const counts = gaps.reduce((acc, gap) => {
    acc[gap.status] = (acc[gap.status] ?? 0) + 1
    return acc
  }, {} as Record<ProviderCapabilityGap['status'], number>)
  const highPriorityGap = gaps.find((gap) => gap.severity === 'high') ?? gaps[0]
  const summary = [
    counts.partial ? `${counts.partial} partial` : null,
    counts.missing ? `${counts.missing} missing` : null,
    counts.blocked ? `${counts.blocked} blocked` : null
  ].filter(Boolean).join(' · ')

  return (
    <div
      className="provider-boundary-summary"
      data-testid="provider-boundary-summary"
      data-provider-boundary-count={gaps.length}
      data-provider-boundary-partial-count={counts.partial ?? 0}
      data-provider-boundary-missing-count={counts.missing ?? 0}
      data-provider-boundary-blocked-count={counts.blocked ?? 0}
    >
      <div className="provider-boundary-summary-main">
        <span className="provider-boundary-summary-count" style={{ color }}>{summary || `${gaps.length} tracked`}</span>
        <span className="provider-boundary-summary-text">{highPriorityGap.summary}</span>
      </div>
      <div className="provider-boundary-summary-next">{highPriorityGap.nextStep}</div>
    </div>
  )
}

function useProviderCommandTerminalHandoff(
  providerId: string,
  sessions: SessionListItem[]
): {
  terminalStatus: { surfaceId: string; text: string; tone: 'info' | 'danger' } | null
  insertSurfaceInTerminal: (surface: ProviderCommandSurface) => Promise<void>
} {
  const [terminalStatus, setTerminalStatus] = useState<{ surfaceId: string; text: string; tone: 'info' | 'danger' } | null>(null)
  const statusTimeoutRef = useRef<number | null>(null)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const addTerminalTab = useSessionStore((state) => state.addTerminalTab)
  const setActiveTerminalTab = useSessionStore((state) => state.setActiveTerminalTab)

  useEffect(() => () => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
  }, [])

  const showTerminalStatus = useCallback((surfaceId: string, text: string, tone: 'info' | 'danger'): void => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
    setTerminalStatus({ surfaceId, text, tone })
    statusTimeoutRef.current = window.setTimeout(() => {
      setTerminalStatus((current) => current?.surfaceId === surfaceId ? null : current)
      statusTimeoutRef.current = null
    }, 1800)
  }, [])

  const insertSurfaceInTerminal = useCallback(async (surface: ProviderCommandSurface): Promise<void> => {
    const terminalSession =
      sessions.find((session) => session.id === activeSessionId) ??
      sessions.find((session) => session.provider === providerId) ??
      sessions[0]
    if (!terminalSession) {
      showTerminalStatus(surface.id, 'No chat available for terminal handoff', 'danger')
      return
    }
    const commandText = providerSurfaceTerminalCommand(providerId, surface)
    showTerminalStatus(surface.id, 'Opening terminal for provider command', 'info')
    try {
      const state = useSessionStore.getState()
      const currentPanel = state.uiState[terminalSession.id]?.terminalPanel
      const existingTab = typeof currentPanel?.activeTabId === 'number'
        ? currentPanel.activeTabId
        : currentPanel?.tabs.find((tab): tab is number => typeof tab === 'number')
      const tabId = existingTab ?? addTerminalTab(terminalSession.id)
      setActiveSession(terminalSession.id)
      setShowTerminal(terminalSession.id, true)
      setActiveTerminalTab(terminalSession.id, tabId)
      const terminalId = `${terminalSession.id}-${tabId}`
      const globals = window as typeof window & {
        __orchestratorLastProviderCommandTerminalCommandForSmoke?: string
        __orchestratorLastProviderCommandTerminalIdForSmoke?: string
        __orchestratorLastProviderCommandTerminalSurfaceForSmoke?: string
      }
      globals.__orchestratorLastProviderCommandTerminalCommandForSmoke = commandText
      globals.__orchestratorLastProviderCommandTerminalIdForSmoke = terminalId
      globals.__orchestratorLastProviderCommandTerminalSurfaceForSmoke = surface.id
      await window.api.terminal.spawn(terminalId, terminalSession.workDir)
      await window.api.terminal.write(terminalId, commandText)
      showTerminalStatus(surface.id, 'Provider command inserted in terminal', 'info')
    } catch {
      showTerminalStatus(surface.id, 'Insert provider command in terminal failed', 'danger')
    }
  }, [
    activeSessionId,
    addTerminalTab,
    providerId,
    sessions,
    setActiveSession,
    setActiveTerminalTab,
    setShowTerminal,
    showTerminalStatus
  ])

  return { terminalStatus, insertSurfaceInTerminal }
}

function ProviderCommandSurfaces({
  providerId,
  color,
  surfaces,
  sessions
}: {
  providerId: string
  color: string
  surfaces: ProviderCommandSurface[]
  sessions: SessionListItem[]
}): JSX.Element {
  const runnableSurfaces = surfaces.filter((surface) => surface.quota === 'none' && !surface.mutatesState)
  const mutatingSurfaces = surfaces.filter((surface) => surface.mutatesState)
  const quotaSurfaces = surfaces.filter((surface) => surface.quota !== 'none')
  const [results, setResults] = useState<Record<string, ProviderCommandSurfaceResult>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const { terminalStatus, insertSurfaceInTerminal } = useProviderCommandTerminalHandoff(providerId, sessions)
  const selectedSurface = surfaces.find((surface) => surface.id === openId)

  const runSurface = async (surface: ProviderCommandSurface): Promise<void> => {
    if (surface.quota !== 'none' || surface.mutatesState) return
    setOpenId(surface.id)
    setLoading((current) => ({ ...current, [surface.id]: true }))
    try {
      const result = await window.api.providers.runCommandSurface(providerId, surface.id)
      setResults((current) => ({ ...current, [surface.id]: result }))
    } finally {
      setLoading((current) => ({ ...current, [surface.id]: false }))
    }
  }

  if (surfaces.length === 0) return <></>

  const capabilitySummary = [
    `${runnableSurfaces.length} Checks`,
    mutatingSurfaces.length > 0 ? `${mutatingSurfaces.length} Actions` : null,
    quotaSurfaces.length > 0 ? `${quotaSurfaces.length} Quota` : null
  ].filter(Boolean).join(' · ')

  return (
    <div className="provider-capability-controls">
      <div
        data-testid="provider-capability-summary"
        className="provider-capability-summary"
        style={{ color }}
      >
        {capabilitySummary}
      </div>
      <select
        data-testid="provider-capability-select"
        className="provider-capability-select"
        value={openId ?? ''}
        onChange={(event) => setOpenId(event.target.value || null)}
      >
        <option value="">Choose a check</option>
        {surfaces.map((surface) => (
          <option key={surface.id} value={surface.id}>{surface.label}</option>
        ))}
      </select>

      {selectedSurface ? (
        <CommandSurfaceOutput
          providerId={providerId}
          color={color}
          surface={selectedSurface}
          result={results[selectedSurface.id]}
          loading={loading[selectedSurface.id] === true}
          onRun={(surface) => runSurface(surface)}
          onInsertTerminal={(surface) => { void insertSurfaceInTerminal(surface) }}
          terminalStatus={terminalStatus?.surfaceId === selectedSurface.id ? terminalStatus : null}
          terminalAvailable={sessions.length > 0}
        />
      ) : null}
    </div>
  )
}

function CommandSurfaceOutput({
  providerId,
  color,
  surface,
  result,
  loading,
  onRun,
  onInsertTerminal,
  terminalStatus,
  terminalAvailable
}: {
  providerId: string
  color: string
  surface?: ProviderCommandSurface
  result?: ProviderCommandSurfaceResult
  loading: boolean
  onRun: (surface: ProviderCommandSurface) => void
  onInsertTerminal: (surface: ProviderCommandSurface) => void
  terminalStatus: { text: string; tone: 'info' | 'danger' } | null
  terminalAvailable: boolean
}): JSX.Element {
  if (!surface) return <></>
  const runnable = surface.quota === 'none' && !surface.mutatesState
  const output = result?.output.trim()
  const meta = [
    surface.runtime === 'headless' ? 'Headless' : surface.runtime === 'interactive' ? 'Interactive' : surface.runtime,
    surface.quota === 'none' ? 'No quota' : 'May use quota',
    surface.mutatesState ? 'Changes state' : 'Read-only'
  ]
  const statusColor = result?.status === 'ok'
    ? '#22C55E'
    : result?.status === 'error'
      ? '#EF4444'
      : 'var(--color-text-muted)'

  return (
    <div
      data-testid="provider-capability-output"
      data-provider-command-output-surface="shared"
      data-provider-command-runnable={runnable ? 'true' : 'false'}
      data-provider-command-terminal-status={terminalStatus?.text ?? ''}
      data-provider-command-terminal-status-tone={terminalStatus?.tone ?? ''}
      className="provider-command-output"
    >
      <div
        className="provider-command-output-header"
        data-has-body={output || loading || !runnable ? 'true' : 'false'}
      >
        <div className="provider-command-output-copy">
          <div className="provider-command-output-title">{surface.label}</div>
          <div className="provider-command-output-meta">
            {meta.map((item) => (
              <span
                key={item}
                className="provider-command-output-chip"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="provider-command-output-actions">
          <button
            className="provider-command-output-action"
            data-runnable={runnable ? 'true' : 'false'}
            disabled={!runnable || loading}
            onClick={() => onRun(surface)}
            style={{ '--provider-accent': color } as CSSProperties}
          >
            {loading ? 'Running' : runnable ? 'Refresh' : surface.quota === 'none' ? 'Manual' : 'Quota'}
          </button>
          {!runnable && (
            <button
              type="button"
              className="provider-command-output-action"
              data-runnable="true"
              disabled={!terminalAvailable}
              data-testid="provider-command-output-terminal"
              aria-label={`Insert ${surface.label} command in terminal`}
              onClick={() => onInsertTerminal(surface)}
              style={{ '--provider-accent': color } as CSSProperties}
            >
              Terminal
            </button>
          )}
        </div>
      </div>

      {!runnable ? (
        <div className="provider-command-output-message">
          {surface.mutatesState
            ? 'This changes provider or project state. Orchestrator keeps it as an explicit terminal handoff.'
            : 'This may spend model quota or open an interactive provider flow, so it is not run from settings.'}
          <code className="provider-command-output-command">{providerSurfaceTerminalCommand(providerId, surface)}</code>
          {surface.note && <div className="provider-command-output-note">{surface.note}</div>}
          {terminalStatus && (
            <div
              data-testid="provider-command-output-terminal-status"
              role={terminalStatus.tone === 'danger' ? 'alert' : 'status'}
              aria-live={terminalStatus.tone === 'danger' ? 'assertive' : 'polite'}
              aria-atomic="true"
              className="provider-command-output-terminal-status"
              data-provider-command-terminal-status-tone={terminalStatus.tone}
            >
              {terminalStatus.text}
            </div>
          )}
        </div>
      ) : output ? (
        <StructuredCommandOutput output={output} color={color} surface={surface} />
      ) : (
        <div
          className="provider-command-output-message"
          style={{ color: result ? statusColor : undefined }}
        >
          {loading ? 'Running…' : result ? result.status : 'Refresh to check this capability.'}
        </div>
      )}
    </div>
  )
}

function providerSurfaceTerminalCommand(providerId: string, surface: ProviderCommandSurface): string {
  return [providerSurfaceBinary(providerId), ...surface.command].map(shellQuoteCommandArg).join(' ')
}

function providerSurfaceBinary(providerId: string): string {
  switch (providerId) {
    case 'claude':
      return 'claude'
    case 'codex':
      return 'codex'
    case 'copilot':
      return 'copilot'
    case 'cursor':
      return 'agent'
    case 'gemini':
      return 'gemini'
    default:
      return providerId || 'provider'
  }
}

function shellQuoteCommandArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

function StructuredCommandOutput({ output, color, surface }: { output: string; color: string; surface?: ProviderCommandSurface }): JSX.Element {
  const parsed = parseCommandOutput(output)
  if (parsed.kind === 'json') {
    if (surface?.id.startsWith('appserver-')) {
      return <AppServerSurfaceSummary surface={surface} value={parsed.value} color={color} />
    }
    if (isAutoModeDefaults(parsed.value)) {
      return <AutoModeDefaultsSummary value={parsed.value} color={color} />
    }
    if (isMcpDetails(parsed.value)) {
      return <McpDetailsSummary details={parsed.value} color={color} />
    }
    return (
      <div style={{ padding: 10, maxHeight: 220, overflow: 'auto' }}>
        <StructuredValue value={parsed.value} color={color} depth={0} />
      </div>
    )
  }

  return (
    <div style={{ padding: 10, maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {parsed.lines.map((line, index) => (
        <div
          key={`${line}-${index}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 7,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            fontSize: 11,
            lineHeight: 1.35,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {line}
          </span>
        </div>
      ))}
    </div>
  )
}

type AutoModeDefaults = {
  allow?: unknown[]
  soft_deny?: unknown[]
  hard_deny?: unknown[]
  environment?: unknown[]
}

function isAutoModeDefaults(value: unknown): value is AutoModeDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return ['allow', 'soft_deny', 'hard_deny', 'environment'].some((key) => Array.isArray(record[key]))
}

function AutoModeDefaultsSummary({ value, color }: { value: AutoModeDefaults; color: string }): JSX.Element {
  const sections: Array<{ key: keyof AutoModeDefaults; label: string; tone: string }> = [
    { key: 'allow', label: 'Allow', tone: '#22C55E' },
    { key: 'soft_deny', label: 'Review', tone: '#F59E0B' },
    { key: 'hard_deny', label: 'Block', tone: '#EF4444' },
    { key: 'environment', label: 'Environment', tone: color },
  ]

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflow: 'auto' }}>
      {sections.map((section) => {
        const items = (value[section.key] ?? []).map((item) => String(item))
        return (
          <details key={section.key} open={section.key === 'allow' || section.key === 'soft_deny'}>
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                listStyle: 'none',
                color: 'var(--color-text)',
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: section.tone, flexShrink: 0 }} />
              {section.label}
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 650 }}>{items.length}</span>
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7, paddingLeft: 15 }}>
              {items.length === 0 ? (
                <EmptyInlineValue />
              ) : items.map((item, index) => (
                <div
                  key={`${section.key}-${index}`}
                  title={item}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 7,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    fontSize: 11,
                    lineHeight: 1.35,
                  }}
                >
                  {summarizePolicyLine(item)}
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function summarizePolicyLine(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
}

type McpDetail = { server: string; status: 'ok' | 'error'; detail: string }

function isMcpDetails(value: unknown): value is McpDetail[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    return typeof record.server === 'string' && (record.status === 'ok' || record.status === 'error')
  })
}

function McpDetailsSummary({ details, color }: { details: McpDetail[]; color: string }): JSX.Element {
  if (details.length === 0) {
    return <div style={{ padding: 10 }}><EmptyInlineValue /></div>
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 260, overflow: 'auto' }}>
      {details.map((detail) => {
        const ok = detail.status === 'ok'
        return (
          <details
            key={detail.server}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              background: 'var(--color-surface)',
              padding: 8,
            }}
          >
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                listStyle: 'none',
                color: 'var(--color-text)',
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? color : '#EF4444', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{detail.server}</span>
              <span style={{ color: ok ? color : '#EF4444', fontSize: 11, fontWeight: 650 }}>{detail.status}</span>
            </summary>
            {detail.detail && (
              <pre
                style={{
                  margin: '7px 0 0',
                  padding: 8,
                  borderRadius: 7,
                  background: 'var(--color-surface2)',
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 10.5,
                  lineHeight: 1.35,
                }}
              >
                {detail.detail}
              </pre>
            )}
          </details>
        )
      })}
    </div>
  )
}

type SummaryItem = {
  id: string
  title: string
  subtitle?: string
  meta?: string
  tone?: string
}

function AppServerSurfaceSummary({
  surface,
  value,
  color
}: {
  surface: ProviderCommandSurface
  value: unknown
  color: string
}): JSX.Element {
  const items = appServerSummaryItems(surface.id, value, color)
  const stats = appServerSummaryStats(surface.id, value)
  if (items.length === 0 && stats.length === 0) {
    return (
      <div style={{ padding: 10, maxHeight: 260, overflow: 'auto' }}>
        <StructuredValue value={value} color={color} depth={0} />
      </div>
    )
  }

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 300, overflow: 'auto' }}>
      {stats.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 7 }}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-surface)',
                padding: '8px 9px',
                minWidth: 0
              }}
            >
              <div style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 650 }}>{stat.label}</div>
              <div className="truncate" style={{ color: stat.tone ?? 'var(--color-text)', fontSize: 15, fontWeight: 750, marginTop: 2 }} title={stat.value}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                background: 'var(--color-surface)',
                padding: 9,
                minWidth: 0
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: item.tone ?? color, marginTop: 5, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="truncate" style={{ color: 'var(--color-text)', fontSize: 12, fontWeight: 750 }} title={item.title}>
                  {item.title}
                </div>
                {item.subtitle && (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 11, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                    {item.subtitle}
                  </div>
                )}
              </div>
              {item.meta && (
                <span
                  className="shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    color: item.tone ?? color,
                    background: 'var(--color-surface2)',
                    border: '1px solid var(--color-border)'
                  }}
                >
                  {item.meta}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyInlineValue />
      )}
    </div>
  )
}

function appServerSummaryStats(surfaceId: string, value: unknown): Array<{ label: string; value: string; tone?: string }> {
  const data = appServerDataArray(value)
  const record = objectValue(value)
  if (surfaceId === 'appserver-rate-limits') {
    const limits = objectValue(record?.rateLimits ?? value)
    return Object.entries(limits ?? {}).slice(0, 4).map(([key, entry]) => ({
      label: formatObjectKey(key),
      value: compactScalar(entry),
      tone: key.toLowerCase().includes('remaining') ? 'var(--color-green)' : undefined
    }))
  }
  if (surfaceId === 'appserver-account') {
    return [
      { label: 'Plan', value: compactScalar(record?.planType ?? record?.plan ?? record?.tier ?? 'Unknown') },
      { label: 'Auth', value: compactScalar(record?.authMode ?? record?.mode ?? 'Codex') }
    ]
  }
  if (surfaceId === 'appserver-config-requirements') {
    const requirements = objectValue(record?.requirements)
    return [
      { label: 'Approval modes', value: String(arrayValue(requirements?.allowedApprovalPolicies).length || 'Any') },
      { label: 'Sandbox modes', value: String(arrayValue(requirements?.allowedSandboxModes).length || 'Any') }
    ]
  }
  if (data.length > 0) return [{ label: 'Items', value: data.length.toLocaleString() }]
  return []
}

function appServerSummaryItems(surfaceId: string, value: unknown, color: string): SummaryItem[] {
  const data = appServerDataArray(value)
  const record = objectValue(value)
  const source = data.length > 0 ? data : arrayValue(record?.plugins ?? record?.apps ?? record?.skills ?? record?.hooks ?? record?.servers ?? record?.threads)

  if (surfaceId === 'appserver-config') {
    return Object.entries(objectValue(record?.config ?? record) ?? {}).slice(0, 12).map(([key, entry]) => ({
      id: key,
      title: formatObjectKey(key),
      subtitle: compactScalar(entry),
      tone: color
    }))
  }

  if (surfaceId === 'appserver-model-provider-capabilities') {
    return Object.entries(objectValue(record?.capabilities ?? record) ?? {}).slice(0, 12).map(([key, entry]) => ({
      id: key,
      title: formatObjectKey(key),
      subtitle: compactScalar(entry),
      tone: color
    }))
  }

  if (surfaceId === 'appserver-auth-status') {
    return [{
      id: 'auth',
      title: compactScalar(record?.status ?? record?.authStatus ?? 'Auth status'),
      subtitle: compactScalar(record?.message ?? record?.accountEmail ?? record?.loginMode ?? value),
      tone: /error|fail/i.test(compactScalar(record?.status)) ? '#EF4444' : 'var(--color-green)'
    }]
  }

  return source.slice(0, 24).map((entry, index) => {
    const item = objectValue(entry)
    const title = compactScalar(
      item?.name ??
      item?.title ??
      item?.id ??
      item?.model ??
      item?.server ??
      item?.threadId ??
      item?.path ??
      `Item ${index + 1}`
    )
    const subtitle = compactScalar(
      item?.description ??
      item?.summary ??
      item?.provider ??
      item?.cwd ??
      item?.status ??
      item?.source ??
      item?.command ??
      item?.availabilityNux ??
      entry
    )
    const meta = compactScalar(item?.status ?? item?.state ?? item?.availability ?? item?.kind)
    const isBad = /error|failed|disabled|unavailable/i.test(meta)
    const isGood = /ready|ok|enabled|available|active|installed/i.test(meta)
    return {
      id: compactScalar(item?.id ?? item?.model ?? item?.name ?? index),
      title,
      subtitle: subtitle !== title ? subtitle : undefined,
      meta: meta && meta !== title ? meta : undefined,
      tone: isBad ? '#EF4444' : isGood ? 'var(--color-green)' : color
    }
  })
}

function appServerDataArray(value: unknown): unknown[] {
  const record = objectValue(value)
  return arrayValue(record?.data ?? record?.items ?? record?.results ?? value)
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function compactScalar(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim() || 'Not set'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? 'None' : `${value.length} item${value.length === 1 ? '' : 's'}`
  const record = objectValue(value)
  if (!record) return String(value)
  const preferred = record.message ?? record.label ?? record.name ?? record.id ?? record.status
  if (preferred !== undefined) return compactScalar(preferred)
  const json = JSON.stringify(value)
  return json.length > 140 ? `${json.slice(0, 137)}...` : json
}

type ParsedCommandOutput =
  | { kind: 'json'; value: unknown }
  | { kind: 'lines'; lines: string[] }

function parseCommandOutput(output: string): ParsedCommandOutput {
  const trimmed = output.trim()
  if (!trimmed) return { kind: 'lines', lines: ['No output'] }
  try {
    return { kind: 'json', value: JSON.parse(trimmed) }
  } catch {
    const lines = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return { kind: 'lines', lines: lines.length > 0 ? lines : ['No output'] }
  }
}

function StructuredValue({
  value,
  color,
  depth
}: {
  value: unknown
  color: string
  depth: number
}): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) return <EmptyInlineValue />
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {value.map((item, index) => (
          <div
            key={index}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 7,
              background: 'var(--color-surface)',
              padding: 8,
            }}
          >
            <StructuredValue value={item} color={color} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <EmptyInlineValue />
    return (
      <div style={{ display: 'grid', gridTemplateColumns: depth > 1 ? '1fr' : 'minmax(90px, 150px) minmax(0, 1fr)', gap: 6 }}>
        {entries.map(([key, entryValue]) => (
          <ObjectRow key={key} label={formatObjectKey(key)} value={entryValue} rawKey={key} color={color} depth={depth} />
        ))}
      </div>
    )
  }

  return <ScalarValue value={value} rawKey="" color={color} />
}

function ObjectRow({
  label,
  value,
  rawKey,
  color,
  depth
}: {
  label: string
  value: unknown
  rawKey: string
  color: string
  depth: number
}): JSX.Element {
  const complex = value !== null && typeof value === 'object'
  if (depth > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 650, color: 'var(--color-text-muted)' }}>{label}</span>
        <StructuredValue value={value} color={color} depth={depth + 1} />
      </div>
    )
  }

  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', paddingTop: complex ? 4 : 7 }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>
        {complex
          ? <StructuredValue value={value} color={color} depth={depth + 1} />
          : <ScalarValue value={value} rawKey={rawKey} color={color} />}
      </div>
    </>
  )
}

function ScalarValue({ value, rawKey, color }: { value: unknown; rawKey: string; color: string }): JSX.Element {
  const sensitive = /key|token|secret|password/i.test(rawKey)
  const text = sensitive
    ? '[redacted]'
    : value === null || value === undefined
      ? 'Not set'
      : typeof value === 'boolean'
        ? value ? 'Yes' : 'No'
        : String(value)

  return (
    <span
      style={{
        display: 'inline-flex',
        maxWidth: '100%',
        padding: '5px 8px',
        borderRadius: 7,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: typeof value === 'boolean' && value ? color : 'var(--color-text)',
        fontSize: 11,
        fontWeight: typeof value === 'boolean' ? 700 : 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
      title={text}
    >
      {text}
    </span>
  )
}

function EmptyInlineValue(): JSX.Element {
  return <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>None</span>
}

function formatObjectKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function InlineMutedText({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '7px 0' }}>
      {children}
    </div>
  )
}

function SegmentedControl({
  items,
  value,
  color: _color,
  ariaLabel,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  value: string
  color: string
  ariaLabel: string
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <SystemSegmentedControl
      value={value}
      onChange={onChange}
      options={items.map((item) => ({ value: item.id, label: item.label }))}
      ariaLabel={ariaLabel}
      className="settings-segmented-control"
    />
  )
}

function configPathForProvider(providerId: string, home: string): string {
  const paths: Record<string, string> = {
    claude: `${home}/.claude/settings.json`,
    cursor: `${home}/.cursor/cli-config.json`,
    codex: `${home}/.codex/config.toml`,
    copilot: `${home}/.config/github-copilot/config.json`,
  }
  return paths[providerId] ?? `${home}/.${providerId}/config.json`
}

function redactConfigSecrets(raw: string): { content: string; redacted: boolean } {
  let redacted = false
  const secretKey = /(?:api[_-]?key|token|pat|password|passwd|secret|credential|authorization)/i
  const assignment = /^(\s*["']?[^"'\s:=]+["']?\s*[:=]\s*)(.*?)(\s*,?\s*)$/
  const content = raw.split('\n').map((line) => {
    const match = line.match(assignment)
    if (!match || !secretKey.test(match[1])) return line
    redacted = true
    return `${match[1]}"[redacted]"${match[3]}`
  }).join('\n')
  return { content, redacted }
}

function ProviderConfigEditor({ providerId, color }: { providerId: string; color: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [hasRedactions, setHasRedactions] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const editorState = error ? 'error' : dirty ? 'dirty' : 'clean'
  const statusTone = error ? 'error' : saved ? 'success' : hasRedactions ? 'warning' : 'muted'

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      const nextPath = configPathForProvider(providerId, home)
      const file = await window.api.fs.readFile(nextPath)
      const redacted = redactConfigSecrets(file ?? '')
      setPath(nextPath)
      setContent(redacted.content)
      setHasRedactions(redacted.redacted)
      setDirty(false)
      setSaved(false)
      setError('')
    }
    void load()
  }, [providerId])

  const save = async (): Promise<void> => {
    if (!path || saving) return
    if (hasRedactions) {
      setError('Secret values are redacted; edit this file outside Orchestrator.')
      return
    }
    const trimmed = content.trim()
    if (path.endsWith('.json') && trimmed) {
      try {
        JSON.parse(trimmed)
      } catch {
        setError('Invalid JSON')
        return
      }
    }
    setSaving(true)
    setError('')
    await window.api.fs.writeFile(path, content)
    setSaving(false)
    setDirty(false)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div
      data-testid="provider-config-editor"
      data-expanded={open ? 'true' : 'false'}
      data-config-editor-surface="shared"
      data-config-editor-state={editorState}
      className="provider-config-editor"
      style={{ '--provider-color': color } as CSSProperties}
    >
      <div className="provider-config-editor-header">
        <span className="provider-config-path">
          {path || 'Loading...'}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="settings-action-button provider-config-toggle"
        >
          {open ? 'Hide' : 'Edit config'}
        </button>
      </div>
      {open && (
        <>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setDirty(true)
              setSaved(false)
              setError('')
            }}
            spellCheck={false}
            placeholder={providerId === 'cursor' ? '{\n  "network": {\n    "useHttp1ForAgent": true\n  }\n}' : ''}
            className="provider-config-textarea"
          />
          <div className="provider-config-footer">
            <ProviderConfigStatus tone={statusTone}>
              {error || (hasRedactions ? 'Secrets redacted; edit locally to change this file.' : saved ? 'Saved' : 'Local file override')}
            </ProviderConfigStatus>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || hasRedactions}
              className="settings-action-button provider-config-save"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
      {!open && (
        <ProviderConfigStatus tone={statusTone}>
          {error || (hasRedactions ? 'Secrets redacted.' : saved ? 'Saved' : 'Local file override')}
        </ProviderConfigStatus>
      )}
    </div>
  )
}

function ProviderConfigStatus({
  tone,
  children
}: {
  tone: 'error' | 'success' | 'warning' | 'muted'
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="provider-config-status"
      data-tone={tone}
      data-provider-config-status-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {children}
    </div>
  )
}

function ProviderDiagnosticsCard({
  diagnostics,
  color
}: {
  diagnostics: ProviderDiagnosticInfo
  color: string
}): JSX.Element {
  const rows = [
    {
      label: 'Binary',
      status: diagnostics.binary.status,
      message: diagnostics.binary.path ?? 'Not found'
    },
    {
      label: 'Version',
      status: diagnostics.version.status,
      message: diagnostics.version.value ?? diagnostics.version.message ?? 'Unknown'
    },
    {
      label: 'Auth',
      status: diagnostics.auth.status,
      message: diagnostics.auth.message
    },
    {
      label: 'Models',
      status: diagnostics.models.status,
      message: diagnostics.models.message
    },
    {
      label: 'Usage',
      status: diagnostics.usage.status,
      message: diagnostics.usage.message
    },
    {
      label: 'Live smoke',
      status: diagnostics.liveSmoke.status,
      message: diagnostics.liveSmoke.message
    }
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 2 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minHeight: 24,
            padding: '2px 0',
            borderTop: '1px solid color-mix(in srgb, var(--border-subtle) 12%, transparent)'
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 560, color: 'var(--text-secondary)' }}>{row.label}</div>
          <DiagnosticPill status={row.status} color={color} />
        </div>
      ))}
    </div>
  )
}

interface ProviderUsageSnapshot {
  sessionCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  totalCostUsd: number
  durationMs: number
  apiDurationMs: number
  turns: number
  models: string[]
}

function summarizeProviderUsage(sessions: SessionListItem[], providerId: string): ProviderUsageSnapshot {
  const snapshot: ProviderUsageSnapshot = {
    sessionCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    apiDurationMs: 0,
    turns: 0,
    models: []
  }
  const models = new Set<string>()

  for (const session of sessions) {
    if (session.provider !== providerId || !session.usageSummary) continue
    const usage = session.usageSummary
    snapshot.sessionCount += 1
    snapshot.inputTokens += usage.inputTokens ?? 0
    snapshot.outputTokens += usage.outputTokens ?? 0
    snapshot.cacheTokens += (usage.cacheCreationInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0)
    snapshot.totalTokens += usage.totalTokens ?? sumTokens(usage)
    snapshot.totalCostUsd += usage.totalCostUsd ?? sumModelCost(usage)
    snapshot.durationMs += usage.durationMs ?? 0
    snapshot.apiDurationMs += usage.apiDurationMs ?? 0
    snapshot.turns += usage.turns ?? 0
    for (const model of Object.keys(usage.modelUsage ?? {})) models.add(model)
  }

  snapshot.models = [...models].sort()
  return snapshot
}

function sumTokens(usage: UsageSummary): number {
  return (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0)
}

function sumModelCost(usage: UsageSummary): number {
  return Object.values(usage.modelUsage ?? {}).reduce((total, model) => total + (model.costUSD ?? 0), 0)
}

function ProviderUsageDiagnosticsCard({
  providerId,
  diagnostics,
  usage,
  color
}: {
  providerId: string
  diagnostics?: ProviderDiagnosticInfo
  usage: ProviderUsageSnapshot
  color: string
}): JSX.Element {
  const budget = providerBudgetSupport(providerId)
  const hasUsage = usage.sessionCount > 0
  const hasUsageMetrics =
    hasUsage ||
    usage.totalTokens > 0 ||
    usage.totalCostUsd > 0 ||
    usage.durationMs > 0 ||
    usage.apiDurationMs > 0 ||
    (diagnostics?.usage.status !== undefined && diagnostics.usage.status !== 'unknown')
  const rows = [
    {
      label: 'Runs',
      status: hasUsage ? 'available' : 'unknown',
      message: hasUsage ? `${usage.sessionCount.toLocaleString()} sessions with usage metadata` : 'No usage-emitting runs recorded in this local profile yet.'
    },
    {
      label: 'Tokens',
      status: usage.totalTokens > 0 ? 'available' : 'unknown',
      message: usage.totalTokens > 0
        ? `${usage.totalTokens.toLocaleString()} total · ${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out`
        : 'No token totals captured yet.'
    },
    {
      label: 'Cost',
      status: usage.totalCostUsd > 0 ? 'available' : 'unknown',
      message: usage.totalCostUsd > 0 ? formatUsd(usage.totalCostUsd) : 'No provider cost metadata captured yet.'
    },
    {
      label: 'Time',
      status: usage.durationMs > 0 || usage.apiDurationMs > 0 ? 'available' : 'unknown',
      message: usage.durationMs > 0 || usage.apiDurationMs > 0
        ? `${formatMilliseconds(usage.durationMs)} total${usage.apiDurationMs > 0 ? ` · ${formatMilliseconds(usage.apiDurationMs)} API` : ''}`
        : 'No duration metadata captured yet.'
    },
    {
      label: 'Quota',
      status: diagnostics?.usage.status ?? 'unknown',
      message: diagnostics?.usage.message ?? 'Load provider diagnostics to check whether safe quota probes are available.'
    },
    {
      label: 'Budget',
      status: budget.status,
      message: budget.message
    }
  ]
  const visibleRows = rows.filter((row) => row.status !== 'unknown' || row.label === 'Budget')
  const detailChips = [
    usage.models.length > 0 ? `Models ${usage.models.join(', ')}` : null,
    usage.cacheTokens > 0 ? `Cache ${usage.cacheTokens.toLocaleString()}` : null,
    usage.turns > 0 ? `Turns ${usage.turns.toLocaleString()}` : null
  ].filter((chip): chip is string => Boolean(chip))

  return (
    <div data-testid="provider-usage-diagnostics-card" style={{ display: 'grid', gap: 10 }}>
      <div
        data-testid="provider-usage-status-strip"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))',
          gap: 3
        }}
      >
        {!hasUsageMetrics && (
          <div
            data-testid="provider-usage-empty"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              minWidth: 0,
              minHeight: 22,
              padding: '3px 0',
              borderTop: '1px solid color-mix(in srgb, var(--border-subtle) 24%, transparent)'
            }}
          >
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--color-text)'
              }}
            >
              Runs
            </div>
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 10,
                color: 'var(--color-text-muted)'
              }}
            >
              No usage yet
            </div>
          </div>
        )}
        {visibleRows.map((row) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 5,
              minWidth: 0,
              minHeight: 22,
              padding: '3px 0',
              borderTop: '1px solid color-mix(in srgb, var(--border-subtle) 24%, transparent)'
            }}
          >
            <div
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--color-text)'
              }}
            >
              {row.label}
            </div>
            <DiagnosticPill status={row.status} color={color} />
          </div>
        ))}
      </div>
      {detailChips.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            fontSize: 11,
            color: 'var(--color-text-muted)'
          }}
        >
          {detailChips.map((chip) => <span key={chip}>{chip}</span>)}
        </div>
      )}
    </div>
  )
}

function providerBudgetSupport(providerId: string): { status: string; message: string } {
  if (providerId === 'claude') {
    return {
      status: 'available',
      message: 'Claude runs can use max-budget launch limits; fallback policy is still a future advanced launch setting.'
    }
  }
  if (providerId === 'codex') {
    return {
      status: 'unknown',
      message: 'Codex app-server token usage can be captured, but local budget/fallback controls are not promoted yet.'
    }
  }
  return {
    status: 'unknown',
    message: 'Budget and fallback controls are not exposed for this provider in Orchestrator yet.'
  }
}

function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatMilliseconds(ms: number): string {
  if (ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

function ProviderProbeGrid({
  diagnostics,
  color
}: {
  diagnostics: ProviderDiagnosticInfo
  color: string
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 4 }}>
      {diagnostics.probes.map((probe) => (
        <div
          key={probe.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minWidth: 0,
            minHeight: 26,
            padding: '2px 0',
            borderTop: '1px solid color-mix(in srgb, var(--border-subtle) 12%, transparent)'
          }}
        >
          <div
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              fontWeight: 560,
              color: 'var(--text-secondary)'
            }}
          >
            {probe.label}
          </div>
          <DiagnosticPill status={probe.status} color={color} />
        </div>
      ))}
    </div>
  )
}

// ─── Model list manager ────────────────────────────────────────────────────────

function ModelListManager({
  providerDef, visibleIds, onChange
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  visibleIds: string[]
  onChange: (ids: string[]) => void
}): JSX.Element {
  const [customInput, setCustomInput] = useState('')
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const visibleSet = new Set(visibleIds)
  const configurableModels = getConfigurableModels(providerDef)
  const catalogIds = configurableModels.map((model) => model.id)
  const uncheckedModels = configurableModels.filter((model) => !visibleSet.has(model.id))

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIdx = visibleIds.indexOf(active.id as string)
      const newIdx = visibleIds.indexOf(over.id as string)
      onChange(arrayMove(visibleIds, oldIdx, newIdx))
    }
  }

  const remove = (id: string): void => {
    onChange(visibleIds.filter((x) => x !== id))
  }

  const addCatalog = (id: string): void => {
    if (!visibleIds.includes(id)) onChange([...visibleIds, id])
    else remove(id)
  }

  const addCustom = (): void => {
    const id = customInput.trim()
    if (id && !visibleIds.includes(id)) {
      onChange([...visibleIds, id])
      setCustomInput('')
    }
  }

  const toggleModel = (id: string): void => {
    if (visibleIds.includes(id)) {
      onChange(visibleIds.filter((modelId) => modelId !== id))
      return
    }
    onChange([...visibleIds, id])
  }

  return (
    <div
      data-testid="provider-model-list"
      data-expanded="true"
      data-model-list-surface="shared"
      data-model-list-mode="checklist"
      className="provider-model-list"
      style={{ '--provider-color': providerDef.color } as CSSProperties}
    >
      <div className="provider-model-checklist-body">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            <div className="provider-model-list-stack">
              {visibleIds.map((id, index) => {
                const meta = providerDef.models.find((m) => m.id === id)
                const isCustom = !catalogIds.includes(id)
                return (
                  <SortableModelRow
                    key={id}
                    id={id}
                    label={meta?.label ?? readableModelLabel(id)}
                    modelId={id}
                    index={index + 1}
                    checked
                    isDefault={index === 0}
                    isCustom={isCustom}
                    onToggle={() => toggleModel(id)}
                    onDelete={isCustom ? () => remove(id) : undefined}
                  />
                )
              })}
              {visibleIds.length === 0 && (
                <div className="provider-model-list-empty">
                  Composer uses the provider catalog order.
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>

        {uncheckedModels.length > 0 && (
          <div className="provider-model-list-stack provider-model-list-stack-secondary">
            {uncheckedModels.map((model) => (
              <StaticModelChecklistRow
                key={model.id}
                label={model.label}
                modelId={model.id}
                checked={false}
                onToggle={() => addCatalog(model.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="provider-model-custom-row">
        <input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
          placeholder="Custom model ID"
          data-testid="provider-custom-model-input"
          className="provider-model-custom-input"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customInput.trim()}
          className="settings-action-button provider-model-custom-add"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ─── Sortable model row ────────────────────────────────────────────────────────

function SortableModelRow({ id, label, modelId, index, checked, isCustom, isDefault, onToggle, onDelete }: {
  id: string; label: string; modelId: string; index: number; checked: boolean; isCustom?: boolean; isDefault?: boolean; onToggle: () => void; onDelete?: () => void
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className="provider-model-sortable-row"
      data-dragging={isDragging ? 'true' : 'false'}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
    >
      <button
        type="button"
        aria-label={`Reorder ${label}`}
        className="provider-model-row-grip"
        {...attributes}
        {...listeners}
      >
        <Icon name="menu" size={13} />
      </button>
      <button
        type="button"
        aria-label={`${checked ? 'Hide' : 'Show'} ${label}`}
        aria-pressed={checked}
        onClick={onToggle}
        className="provider-model-row-check"
      >
        {checked && <Icon name="check" size={12} />}
      </button>
      <span className="provider-model-row-index">{index}</span>
      <span className="provider-model-row-label">{label}</span>
      <span className="provider-model-row-id">{modelId}</span>
      {isDefault && <span className="provider-model-row-badge">Default</span>}
      {isCustom && <span className="provider-model-row-badge">Custom</span>}
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete custom model ${label}`}
          className="provider-model-row-delete"
          onClick={onDelete}
        >
          <Icon name="trash" size={12} />
        </button>
      )}
    </div>
  )
}

function StaticModelChecklistRow({ label, modelId, checked, onToggle }: {
  label: string; modelId: string; checked: boolean; onToggle: () => void
}): JSX.Element {
  return (
    <div className="provider-model-sortable-row provider-model-static-row" data-checked={checked ? 'true' : 'false'}>
      <span className="provider-model-row-grip-placeholder" />
      <button
        type="button"
        aria-label={`${checked ? 'Hide' : 'Show'} ${label}`}
        aria-pressed={checked}
        onClick={onToggle}
        className="provider-model-row-check"
      >
        {checked && <Icon name="check" size={12} />}
      </button>
      <span className="provider-model-row-index" />
      <span className="provider-model-row-label">{label}</span>
      <span className="provider-model-row-id">{modelId}</span>
    </div>
  )
}

// ─── Provider endpoint field ──────────────────────────────────────────────────

type ProviderEndpointConfig = {
  kind: 'json-env' | 'codex-openai-base-url'
  envKey?: string
  configPath: (home: string) => string
  placeholder: string
}

export type CopilotByokProviderSettings = {
  enabled: boolean
  type: 'openai' | 'azure' | 'anthropic'
  baseUrl: string
  apiKeyEnvKey: string
}

function providerEndpointConfig(providerId: string): ProviderEndpointConfig | null {
  if (providerId === 'claude') {
    return {
      kind: 'json-env',
      envKey: 'ANTHROPIC_BASE_URL',
      configPath: (home) => `${home}/.claude/settings.json`,
      placeholder: 'https://api.anthropic.com (default)'
    }
  }
  if (providerId === 'cursor') {
    return {
      kind: 'json-env',
      envKey: 'CURSOR_API_BASE_URL',
      configPath: (home) => `${home}/.cursor/cli-config.json`,
      placeholder: 'Provider default'
    }
  }
  if (providerId === 'codex') {
    return {
      kind: 'codex-openai-base-url',
      configPath: (home) => `${home}/.codex/config.toml`,
      placeholder: 'https://api.openai.com/v1 (default)'
    }
  }
  return null
}

function ProviderEndpointField({ providerId, color }: { providerId: string; color: string }): JSX.Element {
  const config = useMemo(() => providerEndpointConfig(providerId), [providerId])
  const [endpoint, setEndpoint] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const pathRef = useRef('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      if (!config) return
      const home = await window.api.fs.resolveHome()
      pathRef.current = config.configPath(home)
      const content = await window.api.fs.readFile(pathRef.current)
      if (content) {
        setEndpoint(readEndpointFromConfig(content, config))
      }
    }
    load()
  }, [config])

  const save = async (): Promise<void> => {
    if (!config) return
    setSaving(true)
    const content = await window.api.fs.readFile(pathRef.current)
    await window.api.fs.writeFile(pathRef.current, writeEndpointToConfig(content ?? '', config, endpoint.trim()))
    setSaving(false)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="provider-endpoint-field">
      <div className="provider-endpoint-row">
        <input
          value={endpoint}
          onChange={(e) => { setEndpoint(e.target.value); setDirty(true); setSaved(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          placeholder={config?.placeholder ?? 'Provider default'}
          className="provider-endpoint-input"
          style={{ '--provider-color': color } as CSSProperties}
        />
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="provider-endpoint-save"
          data-dirty={dirty ? 'true' : 'false'}
          data-saved={saved ? 'true' : 'false'}
          style={{ '--provider-color': color } as CSSProperties}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function readEndpointFromConfig(content: string, config: ProviderEndpointConfig): string {
  if (config.kind === 'json-env') {
    try {
      const parsed = JSON.parse(content)
      return config.envKey ? parsed.env?.[config.envKey] ?? '' : ''
    } catch {
      return ''
    }
  }
  const match = content.match(/^openai_base_url\s*=\s*(['"])(.*?)\1\s*$/m)
  return match?.[2] ?? ''
}

function writeEndpointToConfig(content: string, config: ProviderEndpointConfig, endpoint: string): string {
  if (config.kind === 'json-env') {
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(content || '{}') } catch { /* start fresh */ }
    const env = { ...(parsed.env as Record<string, string> ?? {}) }
    if (config.envKey && endpoint) env[config.envKey] = endpoint
    else if (config.envKey) delete env[config.envKey]
    parsed.env = env
    return JSON.stringify(parsed, null, 2)
  }

  const linePattern = /^openai_base_url\s*=\s*(['"]).*?\1\s*$/m
  if (!endpoint) return content.replace(linePattern, '').replace(/\n{3,}/g, '\n\n').trimStart()
  const nextLine = `openai_base_url = ${JSON.stringify(endpoint)}`
  if (linePattern.test(content)) return content.replace(linePattern, nextLine)
  return content.trim() ? `${nextLine}\n${content}` : `${nextLine}\n`
}

function CopilotByokProviderField({
  color,
  value,
  onChange
}: {
  color: string
  value: CopilotByokProviderSettings
  onChange: (settings: CopilotByokProviderSettings) => void
}): JSX.Element {
  const [draft, setDraft] = useState<CopilotByokProviderSettings>(normalizeCopilotByokSettings(value))
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setDraft(normalizeCopilotByokSettings(value))
  }, [value])

  const updateDraft = (patch: Partial<CopilotByokProviderSettings>): void => {
    setDraft((current) => normalizeCopilotByokSettings({ ...current, ...patch }))
    setSaved(false)
  }

  const save = (): void => {
    const normalized = normalizeCopilotByokSettings(draft)
    onChange(normalized)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="provider-endpoint-field provider-byok-field">
      <label className="provider-byok-toggle">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => updateDraft({ enabled: event.target.checked })}
        />
        <span>Use BYOK provider</span>
      </label>
      {draft.enabled && (
        <>
          <div className="provider-byok-grid">
            <select
              aria-label="Copilot BYOK provider type"
              value={draft.type}
              onChange={(event) => updateDraft({ type: normalizeCopilotByokType(event.target.value) })}
              className="provider-byok-select"
              style={{ '--provider-color': color } as CSSProperties}
            >
              <option value="openai">OpenAI compatible</option>
              <option value="azure">Azure OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
            <input
              value={draft.apiKeyEnvKey}
              onChange={(event) => updateDraft({ apiKeyEnvKey: event.target.value })}
              placeholder="API key env var"
              className="provider-endpoint-input"
              style={{ '--provider-color': color } as CSSProperties}
            />
          </div>
          <div className="provider-endpoint-row">
            <input
              value={draft.baseUrl}
              onChange={(event) => updateDraft({ baseUrl: event.target.value })}
              placeholder={draft.type === 'azure' ? 'https://resource.openai.azure.com' : 'https://api.openai.com/v1'}
              className="provider-endpoint-input"
              style={{ '--provider-color': color } as CSSProperties}
            />
            <button
              type="button"
              onClick={save}
              className="provider-endpoint-save"
              data-dirty="true"
              data-saved={saved ? 'true' : 'false'}
              style={{ '--provider-color': color } as CSSProperties}
            >
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </>
      )}
      {!draft.enabled && (
        <button
          type="button"
          onClick={save}
          className="provider-endpoint-save provider-byok-save-collapsed"
          data-dirty="true"
          data-saved={saved ? 'true' : 'false'}
          style={{ '--provider-color': color } as CSSProperties}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      )}
    </div>
  )
}

function normalizeCopilotByokSettings(value: Partial<CopilotByokProviderSettings> | null | undefined): CopilotByokProviderSettings {
  return {
    enabled: value?.enabled === true,
    type: normalizeCopilotByokType(value?.type),
    baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : '',
    apiKeyEnvKey: typeof value?.apiKeyEnvKey === 'string' && value.apiKeyEnvKey.trim() ? value.apiKeyEnvKey.trim() : 'OPENAI_API_KEY'
  }
}

function normalizeCopilotByokType(value: unknown): CopilotByokProviderSettings['type'] {
  return value === 'azure' || value === 'anthropic' ? value : 'openai'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InstallCommand({ cmd }: { cmd: string }): JSX.Element {
  const [status, setStatus] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const statusTimeoutRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
  }, [])
  const handleCopy = async (): Promise<void> => {
    if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current)
    try {
      await writeClipboardText(cmd)
      setStatus({ text: 'Install command copied', tone: 'info' })
    } catch (error) {
      setStatus({ text: `Copy failed: ${errorText(error)}`, tone: 'danger' })
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setStatus(null)
      statusTimeoutRef.current = null
    }, 1800)
  }
  return (
    <div
      data-testid="provider-install-command"
      data-provider-install-command-status-tone={status?.tone ?? ''}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 10px', borderRadius: 8,
        background: 'var(--color-surface2)', border: '1px solid var(--color-border)'
      }}
    >
      <span style={{
        flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--color-text-muted)',
        userSelect: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      }}>
        {cmd}
      </span>
      <button
        data-testid="provider-install-command-copy"
        onClick={() => { void handleCopy() }}
        style={{
          flexShrink: 0, padding: '2px 8px', borderRadius: 4, fontSize: 11,
          background: status?.tone === 'info' ? 'var(--color-green)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: status?.tone === 'info' ? '#fff' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 500
        }}
      >
        {status?.tone === 'info' ? 'Copied' : 'Copy'}
      </button>
      {status && (
        <span
          data-testid="provider-install-command-status"
          role={status.tone === 'danger' ? 'alert' : 'status'}
          aria-live={status.tone === 'danger' ? 'assertive' : 'polite'}
          aria-atomic="true"
          style={{
            flexShrink: 0,
            maxWidth: 160,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11,
            fontWeight: 500,
            color: status.tone === 'danger' ? 'var(--state-danger)' : 'var(--color-text-muted)'
          }}
        >
          {status.text}
        </span>
      )}
    </div>
  )
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof window.api.clipboard?.writeText === 'function') {
    const didWrite = await window.api.clipboard.writeText(text)
    if (didWrite) return
  }
  await navigator.clipboard.writeText(text)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
