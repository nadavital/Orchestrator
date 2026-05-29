import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react'
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
  getDefaultPermissionMode,
  getPrimaryPermissionModes,
  getVisibleModels,
  type PermissionExecutionContract,
  type ProviderCapabilityGap,
  type ProviderPermissionMode,
  type ProviderPermissionRuntimeContext,
  type ProviderCommandSurface,
  type ProviderCommandSurfaceResult,
  type ProviderDiagnosticInfo,
  type ProviderRuntimeConnectionState,
  type ProviderRuntimeDebugEvent,
  type ProviderRuntimeInfo,
  type ProviderSidebarSyncResult,
  type ResolvedExecutionPolicy,
  type SessionListItem,
  type UsageSummary
} from '../../types'
import ProviderIcon from '../shared/ProviderIcon'
import Icon from '../shared/Icon'
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

function SettingsSectionHeading({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="settings-content-heading">
      <div className="settings-content-title">{title}</div>
      <div className="settings-content-description">{description}</div>
    </div>
  )
}

// ─── Providers section ────────────────────────────────────────────────────────

export default function ProvidersSettingsPage({
  defaultProvider, sessions, defaultModels, defaultEfforts, defaultPermissionModes, providerModels,
  providerRuntime, providerPermissionContexts, providerDiagnostics, diagnosticsLoading, providerAvailability, defaultAdvancedOpen = false, onSetDefaultProvider, onSetDefaultModel, onSetDefaultEffort, onSetDefaultPermissionMode, onSetProviderModels, onSetProviderPermissionContexts, onLoadProviderDiagnostics
}: {
  defaultProvider: string
  sessions: SessionListItem[]
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  providerRuntime: Record<string, ProviderRuntimeInfo>
  providerPermissionContexts: Record<string, ProviderPermissionRuntimeContext>
  providerDiagnostics: Record<string, ProviderDiagnosticInfo>
  diagnosticsLoading: Record<string, boolean>
  providerAvailability: Record<string, boolean>
  defaultAdvancedOpen?: boolean
  onSetDefaultProvider: (id: string) => void
  onSetDefaultModel: (providerId: string, modelId: string) => void
  onSetDefaultEffort: (providerId: string, effortId: string) => void
  onSetDefaultPermissionMode: (providerId: string, modeId: string) => void
  onSetProviderModels: (providerId: string, models: string[]) => void
  onSetProviderPermissionContexts: Dispatch<SetStateAction<Record<string, ProviderPermissionRuntimeContext>>>
  onLoadProviderDiagnostics: (providerId: string) => void
}): JSX.Element {
  const providerList = Object.values(PROVIDER_DEFS)
  const [selectedId, setSelectedId] = useState(defaultProvider)
  const providerDef = PROVIDER_DEFS[selectedId] ?? PROVIDER_DEFS.claude
  const installed = providerAvailability[selectedId] !== false
  const currentModel = defaultModels[selectedId] ?? providerDef.models[0]?.id ?? ''
  const currentEffort = defaultEfforts[selectedId] ?? providerDef.effortLevels[0]?.id ?? ''
  const permissionContext = providerPermissionContexts[selectedId]
  const contextDefaultPermissionMode = permissionContext?.providerId === selectedId ? permissionContext.defaultPolicy : undefined
  const currentPermissionMode = getDefaultPermissionMode(providerDef, defaultPermissionModes[selectedId] ?? contextDefaultPermissionMode)
  const visibleModels = getVisibleModels(providerDef, providerModels)
  const primaryPermissionModes = filterPermissionModes(getPrimaryPermissionModes(providerDef), permissionContext, currentPermissionMode)
  const visibleIds = visibleModels.map((m) => m.id)
  const runtime = providerRuntime[selectedId]
  const diagnostics = providerDiagnostics[selectedId]
  const loadingDiagnostics = diagnosticsLoading[selectedId] === true
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedOpen)
  const settingsCommandSurfaces = visibleSettingsCommandSurfaces(selectedId, runtime?.registry.commandSurfaces ?? [])
  const usageSnapshot = summarizeProviderUsage(sessions, selectedId)
  const modelForPicker = visibleIds.includes(currentModel)
    ? currentModel
    : visibleModels[0]?.id ?? currentModel
  const [sidebarSyncLoading, setSidebarSyncLoading] = useState(false)
  const [sidebarSyncResult, setSidebarSyncResult] = useState<ProviderSidebarSyncResult | null>(null)

  useEffect(() => {
    if (advancedOpen) onLoadProviderDiagnostics(selectedId)
  }, [advancedOpen, onLoadProviderDiagnostics, selectedId])

  useEffect(() => {
    setSidebarSyncLoading(false)
    setSidebarSyncResult(null)
  }, [selectedId])

  useEffect(() => {
    let alive = true
    const cwd = sessions.find((session) => session.provider === selectedId)?.workDir ?? sessions[0]?.workDir
    window.api.providers.getPermissionContext(selectedId, cwd)
      .then((context) => {
        if (alive) onSetProviderPermissionContexts((current) => ({ ...current, [selectedId]: context }))
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [onSetProviderPermissionContexts, selectedId, sessions])

  const handleVisibleModelsChange = (ids: string[]): void => {
    onSetProviderModels(selectedId, ids)
    if (ids.length > 0 && !ids.includes(currentModel)) onSetDefaultModel(selectedId, ids[0])
  }

  const refreshSidebarMetadata = async (): Promise<void> => {
    const cwd = sessions.find((session) => session.provider === selectedId)?.workDir ?? sessions[0]?.workDir
    setSidebarSyncLoading(true)
    try {
      setSidebarSyncResult(await window.api.providers.refreshSidebarMetadata(selectedId, cwd))
    } finally {
      setSidebarSyncLoading(false)
    }
  }

  return (
    <div data-settings-page-module="providers">
      <SettingsPageSection className="provider-settings-shell" dataTestId="provider-settings-section">
        <SettingsContentLayout
          title="Providers"
          subtitle="Choose the default agent provider and configure runtime defaults."
          dataTestId="settings-content-layout-providers"
        >
          <div className="provider-settings-stack">
            <SettingsContentGroup
              className="provider-settings-content-group"
              rootAttrs={{
                tabIndex: -1,
                'data-settings-search-anchor': 'provider-picker'
              }}
            >
              <SettingsSectionHeading
                title="Provider"
                description="Choose the default agent provider and check whether its local runtime is ready."
              />
              <SettingsGroupContent>
                <SettingsSurface className="provider-selector-surface">
                  <div className="provider-selector-pad">
                    <ProviderDropdown
                      providers={providerList}
                      selectedId={selectedId}
                      providerId={selectedId}
                      color={providerDef.color}
                      installed={installed}
                      isDefault={defaultProvider === selectedId}
                      installCmd={providerDef.installCmd}
                      onSelect={setSelectedId}
                      onSetDefault={() => onSetDefaultProvider(selectedId)}
                    />
                  </div>
                </SettingsSurface>
              </SettingsGroupContent>
            </SettingsContentGroup>

        {/* Per-provider content — key forces clean remount on provider switch, stopping DnD jitter */}
        <div key={selectedId}>
          <SettingsContentGroup
            className="provider-settings-content-group"
            rootAttrs={{
              tabIndex: -1,
              'data-settings-search-anchor': 'provider-defaults'
            }}
          >
            <SettingsSectionHeading
              title="Defaults"
              description="Configure the model, reasoning, permissions, and visible model list for this provider."
            />
            <SettingsGroupContent>
              <SettingsSurface className="provider-settings-control-surface">
                <SettingsRow
                  label="Default"
                  className="provider-settings-row"
                  control={(
                    <DefaultModelPicker
                      providerDef={providerDef}
                      models={visibleModels}
                      currentModel={modelForPicker}
                      onSetModel={(id) => onSetDefaultModel(selectedId, id)}
                    />
                  )}
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

                {primaryPermissionModes.length > 0 && (
                  <SettingsRow
                    label="Mode"
                    className="provider-settings-row provider-settings-row-stacked"
                    control={(
                      <div className="provider-settings-row-stack">
                        <SegmentedControl
                          items={primaryPermissionModes}
                          value={currentPermissionMode}
                          color={providerDef.color}
                          ariaLabel={`${providerDef.name} permission mode`}
                          onChange={(id) => onSetDefaultPermissionMode(selectedId, id)}
                        />
                        <ProviderPermissionContract
                          policy={runtime?.policies[currentPermissionMode]}
                          context={permissionContext}
                          color={providerDef.color}
                        />
                      </div>
                    )}
                  />
                )}

                <SettingsRow
                  label="Models"
                  className="provider-settings-row provider-settings-row-stacked"
                  control={(
                    <div className="provider-models-row">
                      <ModelListManager
                        providerDef={providerDef}
                        visibleIds={visibleIds}
                        onChange={handleVisibleModelsChange}
                      />
                      <button
                        className="provider-details-toggle"
                        data-testid="provider-diagnostics-toggle"
                        aria-expanded={advancedOpen}
                        aria-label={advancedOpen ? 'Hide provider details' : 'Show provider details'}
                        onClick={() => setAdvancedOpen((open) => !open)}
                      >
                        <Icon name="wrench" size={13} />
                        Details
                        <Icon name={advancedOpen ? 'chevronDown' : 'chevronRight'} size={12} />
                      </button>
                    </div>
                  )}
                />

                {settingsCommandSurfaces.length > 0 && (
                  <SettingsRow
                    label="Capabilities"
                    className="provider-settings-row provider-settings-row-stacked"
                    control={(
                      <ProviderCommandSurfaces
                        providerId={selectedId}
                        color={providerDef.color}
                        surfaces={settingsCommandSurfaces}
                      />
                    )}
                  />
                )}

                {runtime?.registry.gaps.length ? (
                  <SettingsRow
                    label="Boundaries"
                    className="provider-settings-row provider-settings-row-stacked"
                    control={<ProviderBoundarySummary gaps={runtime.registry.gaps} color={providerDef.color} />}
                  />
                ) : null}
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          {advancedOpen && (
            <SettingsContentGroup className="provider-settings-content-group">
              <SettingsSectionHeading
                title="Details"
                description="Local runtime status, setup, usage, and provider capability checks."
              />
              <SettingsGroupContent>
                <div className="provider-details-grid" data-testid="provider-details-grid">
                  <ProviderDetailCard wide>
                    <ProviderStatusDetails
                      providerId={selectedId}
                      diagnostics={diagnostics}
                      loadingDiagnostics={loadingDiagnostics}
                      usage={usageSnapshot}
                      color={providerDef.color}
                      sidebarSyncResult={sidebarSyncResult}
                      sidebarSyncLoading={sidebarSyncLoading}
                      onRefreshSidebarMetadata={selectedId === 'codex' ? refreshSidebarMetadata : undefined}
                    />
                  </ProviderDetailCard>
                  {diagnostics && diagnostics.probes.length > 0 && (
                    <ProviderDetailCard title="Checks" wide>
                      <ProviderProbeGrid diagnostics={diagnostics} color={providerDef.color} />
                    </ProviderDetailCard>
                  )}
                  <ProviderDetailCard title="Setup" wide>
                    <ProviderSetupDetails providerDef={providerDef} />
                  </ProviderDetailCard>
                </div>
              </SettingsGroupContent>
            </SettingsContentGroup>
          )}
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
  'appserver-auth-status'
])

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
  return (
    <div className="provider-status-card" data-testid="provider-status-card">
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
        {onRefreshSidebarMetadata && sidebarSyncResult && (
          <InlineMutedText>
            {sidebarSyncStatusText(sidebarSyncResult)}
          </InlineMutedText>
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

function ProviderPermissionContract({
  policy,
  context,
  color
}: {
  policy?: ResolvedExecutionPolicy
  context?: ProviderPermissionRuntimeContext
  color: string
}): JSX.Element | null {
  if (!policy?.execution && (!context || context.source === 'static')) return null
  const chips = policy?.execution ? permissionExecutionLabels(policy.execution) : []
  return (
    <div>
      {chips.length > 0 && (
        <div
          data-testid="settings-permission-execution-contract"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 5,
            marginTop: 6
          }}
        >
          {chips.map((chip) => (
            <span
              key={`${chip.label}:${chip.value}`}
              title={`${chip.label}: ${chip.value}`}
              style={{
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                padding: '3px 6px',
                borderRadius: 7,
                border: `1px solid ${chip.strong ? color : 'var(--color-border)'}`,
                color: chip.strong ? color : 'var(--color-text-muted)',
                background: 'var(--color-surface)',
                fontSize: 10,
                fontWeight: chip.strong ? 650 : 500
              }}
            >
              {chip.label} {chip.value}
            </span>
          ))}
        </div>
      )}
      {context && context.source !== 'static' && (
        <div
          data-testid="settings-permission-runtime-context"
          style={{
            marginTop: 6,
            color: context.status === 'ok' ? 'var(--color-green)' : 'var(--color-text-muted)',
            fontSize: 10.5,
            lineHeight: 1.35
          }}
          title={context.cwd ? `${context.summary ?? ''} ${context.cwd}` : context.summary}
        >
          {context.status === 'ok' ? 'Live config' : 'Config fallback'} · {context.summary ?? 'Permission config checked.'}
        </div>
      )}
    </div>
  )
}

function permissionExecutionLabels(execution: PermissionExecutionContract): Array<{ label: string; value: string; strong?: boolean }> {
  return [
    execution.nativeMode ? { label: 'Mode', value: execution.nativeMode, strong: true } : null,
    execution.approvalPolicy ? { label: 'Approval', value: execution.approvalPolicy, strong: true } : null,
    execution.approvalsReviewer && execution.approvalsReviewer !== 'user' ? { label: 'Reviewer', value: execution.approvalsReviewer } : null,
    execution.sandboxMode ? { label: 'Sandbox', value: execution.sandboxMode } : null,
    execution.toolPolicy ? { label: 'Tools', value: execution.toolPolicy } : null,
    execution.configSource ? { label: 'Source', value: execution.configSource } : null
  ].filter((chip): chip is { label: string; value: string; strong?: boolean } => Boolean(chip))
}

function filterPermissionModes(
  modes: ProviderPermissionMode[],
  context: ProviderPermissionRuntimeContext | undefined,
  selectedPolicy: string
): ProviderPermissionMode[] {
  if (!context || context.status !== 'ok' || !context.visiblePolicies || context.visiblePolicies.length === 0) return modes
  const visible = new Set(context.visiblePolicies)
  return modes.filter((mode) => visible.has(mode.id) || mode.id === selectedPolicy)
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
  const visibleEvents = events.slice(-4).reverse()
  const visibleConnections = connections.slice(-2).reverse()
  return (
    <div data-testid="provider-runtime-events-card" style={{ display: 'grid', gap: 6 }}>
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

function ProviderSetupDetails({ providerDef }: { providerDef: typeof PROVIDER_DEFS[string] }): JSX.Element {
  return (
    <div className="provider-setup-card" data-testid="provider-setup-card">
      {providerDef.id === 'claude' && (
        <div className="provider-setup-row" data-testid="provider-setup-endpoint">
          <div className="provider-setup-label">Endpoint</div>
          <ClaudeEndpointField color={providerDef.color} />
        </div>
      )}
      <div className="provider-setup-row" data-testid="provider-setup-config">
        <div className="provider-setup-label">Config</div>
        <ProviderConfigEditor providerId={providerDef.id} color={providerDef.color} />
      </div>
    </div>
  )
}

function visibleSettingsCommandSurfaces(providerId: string, surfaces: ProviderCommandSurface[]): ProviderCommandSurface[] {
  if (providerId !== 'codex') return surfaces
  return surfaces.filter((surface) => CODEX_SETTINGS_COMMAND_SURFACE_IDS.has(surface.id))
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
    ? isDefault ? 'Default · Ready' : 'Ready'
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

function ProviderCommandSurfaces({
  providerId,
  color,
  surfaces
}: {
  providerId: string
  color: string
  surfaces: ProviderCommandSurface[]
}): JSX.Element {
  const runnableSurfaces = surfaces.filter((surface) => surface.quota === 'none' && !surface.mutatesState)
  const mutatingSurfaces = surfaces.filter((surface) => surface.mutatesState)
  const quotaSurfaces = surfaces.filter((surface) => surface.quota !== 'none')
  const [results, setResults] = useState<Record<string, ProviderCommandSurfaceResult>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [openId, setOpenId] = useState<string | null>(null)
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
          color={color}
          surface={selectedSurface}
          result={results[selectedSurface.id]}
          loading={loading[selectedSurface.id] === true}
          onRun={(surface) => runSurface(surface)}
        />
      ) : null}
    </div>
  )
}

function CommandSurfaceOutput({
  color,
  surface,
  result,
  loading,
  onRun
}: {
  color: string
  surface?: ProviderCommandSurface
  result?: ProviderCommandSurfaceResult
  loading: boolean
  onRun: (surface: ProviderCommandSurface) => void
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
        <button
          className="provider-command-output-action"
          data-runnable={runnable ? 'true' : 'false'}
          disabled={!runnable || loading}
          onClick={() => onRun(surface)}
          style={{ '--provider-accent': color } as CSSProperties}
        >
          {loading ? 'Running' : runnable ? 'Refresh' : surface.quota === 'none' ? 'Manual' : 'Quota'}
        </button>
      </div>

      {!runnable ? (
        <div className="provider-command-output-message">
          {surface.mutatesState
            ? 'This changes provider or project state. Orchestrator keeps it as an explicit terminal handoff.'
            : 'This may spend model quota or open an interactive provider flow, so it is not run from settings.'}
          {surface.note && <div className="provider-command-output-note">{surface.note}</div>}
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

// ─── Default model picker ─────────────────────────────────────────────────────

function DefaultModelPicker({
  providerDef, models, currentModel, onSetModel
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  models: typeof PROVIDER_DEFS[string]['models']
  currentModel: string
  onSetModel: (id: string) => void
}): JSX.Element {
  const isPreset = models.some((m) => m.id === currentModel)
  const [customInput, setCustomInput] = useState(isPreset ? '' : currentModel)
  const [customOpen, setCustomOpen] = useState(!isPreset)

  useEffect(() => {
    const nextIsPreset = models.some((m) => m.id === currentModel)
    setCustomInput(nextIsPreset ? '' : currentModel)
    setCustomOpen(!nextIsPreset)
  }, [providerDef.id, currentModel, models])

  const applyCustom = (): void => {
    const trimmed = customInput.trim()
    if (trimmed) onSetModel(trimmed)
    else setCustomOpen(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {models.map((m) => {
          const active = currentModel === m.id
          return (
            <button
              key={m.id}
              onClick={() => { onSetModel(m.id); setCustomInput(''); setCustomOpen(false) }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 8,
                background: active ? 'var(--color-surface2)' : 'var(--color-surface)',
                border: `1px solid ${active ? providerDef.color : 'var(--color-border)'}`,
                color: active ? providerDef.color : 'var(--color-text)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 600 : 500
              }}
            >
              {m.label}
            </button>
          )
        })}
        {isPreset && !customOpen && (
          <button
            data-testid="provider-custom-model-toggle"
            onClick={() => setCustomOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 8,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600
            }}
          >
            Custom
          </button>
        )}
      </div>

      {customOpen && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 8,
            background: !isPreset && currentModel ? 'var(--color-surface2)' : 'var(--color-surface)',
            border: `1px solid ${!isPreset && currentModel ? providerDef.color : 'var(--color-border)'}`
          }}
        >
          <input
            data-testid="provider-custom-model-input"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onBlur={applyCustom}
            onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
            placeholder="Custom model ID..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 11, fontFamily: 'monospace',
              color: customInput ? 'var(--color-text)' : 'var(--color-text-muted)'
            }}
          />
          {!isPreset && currentModel && (
            <svg width="12" height="12" viewBox="0 0 16 16" fill={providerDef.color}>
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
          )}
        </div>
      )}
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))', gap: 6 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{row.label}</div>
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
              padding: '3px 6px',
              borderRadius: 7,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)'
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
              padding: '3px 6px',
              borderRadius: 7,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)'
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6 }}>
      {diagnostics.probes.map((probe) => (
        <div
          key={probe.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <div
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--color-text)'
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
  const [editing, setEditing] = useState(visibleIds.length === 0)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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

  return (
    <div
      data-testid="provider-model-list"
      data-expanded={editing ? 'true' : 'false'}
      data-model-list-surface="shared"
      data-model-list-mode={editing ? 'editing' : 'collapsed'}
      className="provider-model-list"
      style={{ '--provider-color': providerDef.color } as CSSProperties}
    >
      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            <div className="provider-model-list-stack">
              {visibleIds.map((id) => {
                const meta = providerDef.models.find((m) => m.id === id)
                return (
                  <SortableModelRow
                    key={id}
                    id={id}
                    label={meta?.label ?? id}
                    modelId={id}
                    onRemove={() => remove(id)}
                  />
                )
              })}
              {visibleIds.length === 0 && (
                <div className="provider-model-list-empty">
                  No models selected. The catalog defaults are used.
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="provider-model-list-collapsed">
          <div className="provider-model-list-preview">
            {visibleIds.length > 0 ? (
              visibleIds.slice(0, 4).map((id) => {
                const meta = providerDef.models.find((m) => m.id === id)
                return (
                  <span
                    key={id}
                    className="provider-model-chip"
                  >
                    {meta?.label ?? id}
                  </span>
                )
              })
            ) : (
              <span className="provider-model-list-muted">Catalog defaults</span>
            )}
            {visibleIds.length > 4 && (
              <span className="provider-model-list-overflow-count">
                +{visibleIds.length - 4}
              </span>
            )}
          </div>
          <button
            className="provider-model-list-edit"
            onClick={() => setEditing(true)}
          >
            Edit model list
          </button>
        </div>
      )}

      {editing && (
        <button
          className="provider-model-list-edit"
          onClick={() => setEditing(false)}
        >
          Done
        </button>
      )}

      {/* Catalog toggle chips */}
      {editing && providerDef.models.length > 0 && (
        <div className="provider-model-catalog">
          <div data-testid="provider-model-catalog-label" className="provider-model-catalog-label">
            Catalog
          </div>
          <div className="provider-model-catalog-grid">
            {providerDef.models.map((m) => {
              const included = visibleIds.includes(m.id)
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => addCatalog(m.id)}
                  className="provider-model-catalog-chip"
                  data-selected={included ? 'true' : 'false'}
                >
                  {included && <Icon name="check" size={11} />}
                  <span>{m.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Custom model ID input */}
      {editing && (
        <div className="provider-model-custom-row">
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
            placeholder="Custom model ID"
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
      )}
    </div>
  )
}

// ─── Sortable model row ────────────────────────────────────────────────────────

function SortableModelRow({ id, label, modelId, onRemove }: {
  id: string; label: string; modelId: string; onRemove: () => void
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
      <span className="provider-model-row-label">{label}</span>
      <span className="provider-model-row-id">{modelId}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="provider-model-row-remove"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  )
}

// ─── Claude endpoint field ────────────────────────────────────────────────────

function ClaudeEndpointField({ color }: { color: string }): JSX.Element {
  const [endpoint, setEndpoint] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const pathRef = useRef('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      pathRef.current = `${home}/.claude/settings.json`
      const content = await window.api.fs.readFile(pathRef.current)
      if (content) {
        try {
          const parsed = JSON.parse(content)
          setEndpoint(parsed.env?.ANTHROPIC_BASE_URL ?? '')
        } catch { /* leave empty */ }
      }
    }
    load()
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    const content = await window.api.fs.readFile(pathRef.current)
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(content ?? '{}') } catch { /* start fresh */ }
    const env = { ...(parsed.env as Record<string, string> ?? {}) }
    if (endpoint.trim()) env.ANTHROPIC_BASE_URL = endpoint.trim()
    else delete env.ANTHROPIC_BASE_URL
    parsed.env = env
    await window.api.fs.writeFile(pathRef.current, JSON.stringify(parsed, null, 2))
    setSaving(false)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={endpoint}
          onChange={(e) => { setEndpoint(e.target.value); setDirty(true); setSaved(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          placeholder="https://api.anthropic.com (default)"
          style={{
            flex: 1, padding: '7px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
            background: 'var(--color-surface2)',
            border: `1px solid ${dirty ? color : 'var(--color-border)'}`,
            color: 'var(--color-text)', outline: 'none'
          }}
        />
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            flexShrink: 0, padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
            cursor: dirty ? 'pointer' : 'default',
            background: saved ? 'var(--color-green)' : dirty ? color : 'var(--color-surface2)',
            border: `1px solid ${dirty ? color : 'var(--color-border)'}`,
            color: dirty || saved ? '#fff' : 'var(--color-text-muted)'
          }}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InstallCommand({ cmd }: { cmd: string }): JSX.Element {
  const [status, setStatus] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
