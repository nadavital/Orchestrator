import { useEffect, useRef, useState } from 'react'
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
  getVisibleModels,
  type ProviderFeature,
  type ProviderFeatureArea,
  type ProviderDiagnosticInfo,
  type ProviderRuntimeInfo
} from '../types'
import { useSessionStore } from '../store/sessions'
import ProviderIcon from './shared/ProviderIcon'
import { applyAppearance, type Appearance } from '../theme'

type NavSection = 'general' | 'providers' | 'pets'

interface Props {
  onClose: () => void
}

export default function SettingsPage({ onClose }: Props): JSX.Element {
  const { providerAvailability, setProviderModels: storeSetProviderModels } = useSessionStore()
  const [activeSection, setActiveSection] = useState<NavSection>('providers')
  const [defaultProvider, setDefaultProvider] = useState('claude')
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [defaultEfforts, setDefaultEfforts] = useState<Record<string, string>>({})
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [providerRuntime, setProviderRuntime] = useState<Record<string, ProviderRuntimeInfo>>({})
  const [providerDiagnostics, setProviderDiagnostics] = useState<Record<string, ProviderDiagnosticInfo>>({})
  const [appearance, setAppearance] = useState<Appearance>('system')

  useEffect(() => {
    window.api.settings.get().then((s) => {
      const rec = s as unknown as Record<string, unknown>
      setDefaultProvider((rec.defaultProvider as string) ?? 'claude')
      setDefaultModels((rec.defaultModels as Record<string, string>) ?? {})
      setDefaultEfforts((rec.defaultEfforts as Record<string, string>) ?? {})
      setProviderModels((rec.providerModels as Record<string, string[]>) ?? {})
      setAppearance((rec.appearance as Appearance) ?? 'system')
    })
    window.api.providers.getRuntimeInfo().then(setProviderRuntime)
    window.api.providers.getDiagnostics().then(setProviderDiagnostics)
  }, [])

  const saveDefaultProvider = (id: string): void => {
    setDefaultProvider(id)
    window.api.settings.set('defaultProvider', id)
  }

  const saveDefaultModel = (providerId: string, modelId: string): void => {
    const next = { ...defaultModels, [providerId]: modelId }
    setDefaultModels(next)
    window.api.settings.set('defaultModels', next)
  }

  const saveDefaultEffort = (providerId: string, effortId: string): void => {
    const next = { ...defaultEfforts, [providerId]: effortId }
    setDefaultEfforts(next)
    window.api.settings.set('defaultEfforts', next)
  }

  const saveProviderModels = (providerId: string, models: string[]): void => {
    const next = { ...providerModels, [providerId]: models }
    setProviderModels(next)
    storeSetProviderModels(next)
    window.api.settings.set('providerModels', next)
  }

  const saveAppearance = (value: Appearance): void => {
    setAppearance(value)
    applyAppearance(value)
    window.api.settings.set('appearance', value)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--color-bg)' }}>
      {/* Titlebar */}
      <div
        style={{
          height: 38, flexShrink: 0, display: 'flex', alignItems: 'center',
          background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)',
          userSelect: 'none', WebkitAppRegion: 'drag'
        } as React.CSSProperties}
      >
        <div style={{ width: 80, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>Settings</span>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Sidebar nav */}
        <div
          style={{
            width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)',
            padding: '16px 0'
          }}
        >
          <NavItem active={activeSection === 'general'} onClick={() => setActiveSection('general')}>General</NavItem>
          <NavItem active={activeSection === 'providers'} onClick={() => setActiveSection('providers')}>Providers</NavItem>
          <NavItem active={activeSection === 'pets'} onClick={() => setActiveSection('pets')}>Pets</NavItem>
          <div style={{ flex: 1 }} />
          <div style={{ padding: '0 8px 8px' }}>
            <button
              onClick={onClose}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                width: '100%', padding: '6px 12px', borderRadius: 6,
                background: 'transparent', border: 'none',
                color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer', textAlign: 'left'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
              </svg>
              Back
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeSection === 'general' && <GeneralSection appearance={appearance} onSetAppearance={saveAppearance} />}
          {activeSection === 'pets' && <PetsSection />}
          {activeSection === 'providers' && (
            <ProvidersSection
              defaultProvider={defaultProvider}
              defaultModels={defaultModels}
              defaultEfforts={defaultEfforts}
              providerModels={providerModels}
              providerRuntime={providerRuntime}
              providerDiagnostics={providerDiagnostics}
              providerAvailability={providerAvailability}
              onSetDefaultProvider={saveDefaultProvider}
              onSetDefaultModel={saveDefaultModel}
              onSetDefaultEffort={saveDefaultEffort}
              onSetProviderModels={saveProviderModels}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: 'calc(100% - 16px)', margin: '1px 8px',
        padding: '6px 12px', borderRadius: 6,
        background: active ? 'var(--color-surface2)' : 'transparent',
        border: 'none', color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer', textAlign: 'left'
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-surface2)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

// ─── General section (app-wide) ───────────────────────────────────────────────

function GeneralSection({
  appearance,
  onSetAppearance,
}: {
  appearance: Appearance
  onSetAppearance: (value: Appearance) => void
}): JSX.Element {
  const options: Array<{ id: Appearance; label: string }> = [
    { id: 'system', label: 'System' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ]

  return (
    <div style={{ padding: '32px 40px', maxWidth: 640 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 24 }}>General</h2>
      <SettingGroup title="Appearance" description="Choose how Orchestrator should look.">
        <div style={{ display: 'flex', gap: 8 }}>
          {options.map((option) => {
            const active = appearance === option.id
            return (
              <button
                key={option.id}
                onClick={() => onSetAppearance(option.id)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-accent-dim)' : 'var(--color-surface)',
                  color: active ? 'var(--color-accent)' : 'var(--color-text)',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </SettingGroup>
    </div>
  )
}

// ─── Providers section ────────────────────────────────────────────────────────

function ProvidersSection({
  defaultProvider, defaultModels, defaultEfforts, providerModels,
  providerRuntime, providerDiagnostics, providerAvailability, onSetDefaultProvider, onSetDefaultModel, onSetDefaultEffort, onSetProviderModels
}: {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  providerModels: Record<string, string[]>
  providerRuntime: Record<string, ProviderRuntimeInfo>
  providerDiagnostics: Record<string, ProviderDiagnosticInfo>
  providerAvailability: Record<string, boolean>
  onSetDefaultProvider: (id: string) => void
  onSetDefaultModel: (providerId: string, modelId: string) => void
  onSetDefaultEffort: (providerId: string, effortId: string) => void
  onSetProviderModels: (providerId: string, models: string[]) => void
}): JSX.Element {
  const providerList = Object.values(PROVIDER_DEFS)
  const [selectedId, setSelectedId] = useState(defaultProvider)
  const providerDef = PROVIDER_DEFS[selectedId] ?? PROVIDER_DEFS.claude
  const installed = providerAvailability[selectedId] !== false
  const currentModel = defaultModels[selectedId] ?? providerDef.models[0]?.id ?? ''
  const currentEffort = defaultEfforts[selectedId] ?? providerDef.effortLevels[0]?.id ?? ''
  const visibleModels = getVisibleModels(providerDef, providerModels)
  const visibleIds = visibleModels.map((m) => m.id)
  const runtime = providerRuntime[selectedId]
  const diagnostics = providerDiagnostics[selectedId]
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const modelForPicker = visibleIds.includes(currentModel)
    ? currentModel
    : visibleModels[0]?.id ?? currentModel

  const handleVisibleModelsChange = (ids: string[]): void => {
    onSetProviderModels(selectedId, ids)
    if (ids.length > 0 && !ids.includes(currentModel)) onSetDefaultModel(selectedId, ids[0])
  }

  return (
    <div style={{ padding: '28px 36px', maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-text)', margin: 0 }}>Providers</h2>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Pick a provider, choose models, and keep local CLI config separate.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '190px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <ProviderSidePicker
          providers={providerList}
          selectedId={selectedId}
          availability={providerAvailability}
          onSelect={setSelectedId}
        />

        {/* Per-provider content — key forces clean remount on provider switch, stopping DnD jitter */}
        <div key={selectedId}>
        <ProviderHeaderCard
          providerId={selectedId}
          providerName={providerDef.name}
          color={providerDef.color}
          installed={installed}
          isDefault={defaultProvider === selectedId}
          installCmd={providerDef.installCmd}
          onSetDefault={() => onSetDefaultProvider(selectedId)}
        />

        {runtime && (
          <ProviderCapabilitySummary
            features={runtime.registry.features}
            color={providerDef.color}
          />
        )}

        <SettingsPanel>
          <CompactSetting title="Models">
            <ModelListManager
              providerDef={providerDef}
              visibleIds={visibleIds}
              onChange={handleVisibleModelsChange}
            />
          </CompactSetting>
        </SettingsPanel>

        <SettingsPanel>
          <CompactSetting title="Default">
            <DefaultModelPicker
              providerDef={providerDef}
              models={visibleModels}
              currentModel={modelForPicker}
              onSetModel={(id) => onSetDefaultModel(selectedId, id)}
            />
          </CompactSetting>

          {providerDef.supportsEffort && providerDef.effortLevels.length > 0 && (
            <CompactSetting title="Thinking">
              <SegmentedControl
                items={providerDef.effortLevels}
                value={currentEffort}
                color={providerDef.color}
                onChange={(id) => onSetDefaultEffort(selectedId, id)}
              />
            </CompactSetting>
          )}
        </SettingsPanel>

        <button
          onClick={() => setAdvancedOpen((open) => !open)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            marginTop: 14,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Advanced
          <span style={{ color: 'var(--color-text-muted)' }}>{advancedOpen ? 'Hide' : 'Show'}</span>
        </button>

        {advancedOpen && (
          <SettingsPanel>
            {providerDef.id === 'claude' && (
              <CompactSetting title="Endpoint">
                <ClaudeEndpointField color={providerDef.color} />
              </CompactSetting>
            )}
            <CompactSetting title="Config file">
              <ProviderConfigEditor providerId={providerDef.id} color={providerDef.color} />
            </CompactSetting>
            {diagnostics && (
              <CompactSetting title="Status">
                <ProviderDiagnosticsCard diagnostics={diagnostics} color={providerDef.color} />
              </CompactSetting>
            )}
            {diagnostics && diagnostics.probes.length > 0 && (
              <CompactSetting title="Probes">
                <ProviderProbeGrid diagnostics={diagnostics} color={providerDef.color} />
              </CompactSetting>
            )}
          </SettingsPanel>
        )}
        </div>
      </div>
    </div>
  )
}

function ProviderSidePicker({
  providers,
  selectedId,
  availability,
  onSelect,
}: {
  providers: Array<typeof PROVIDER_DEFS[string]>
  selectedId: string
  availability: Record<string, boolean>
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <select
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
        style={{
          width: '100%',
          height: 32,
          marginBottom: 8,
          borderRadius: 7,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface2)',
          color: 'var(--color-text)',
          fontSize: 12,
          fontWeight: 600,
          padding: '0 8px',
          outline: 'none',
        }}
      >
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>{provider.name}</option>
        ))}
      </select>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {providers.map((provider) => {
          const ok = availability[provider.id] !== false
          const active = selectedId === provider.id
          return (
            <button
              key={provider.id}
              onClick={() => onSelect(provider.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 9px',
                borderRadius: 7,
                border: `1px solid ${active ? provider.color : 'transparent'}`,
                background: active ? `${provider.color}12` : 'transparent',
                color: ok ? (active ? provider.color : 'var(--color-text)') : 'var(--color-text-muted)',
                cursor: 'pointer',
                opacity: ok ? 1 : 0.55,
                textAlign: 'left',
                fontSize: 12,
                fontWeight: active ? 650 : 500,
              }}
            >
              <ProviderIcon providerId={provider.id} size={13} color={ok ? provider.color : 'var(--color-text-muted)'} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {provider.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProviderHeaderCard({
  providerId,
  providerName,
  color,
  installed,
  isDefault,
  installCmd,
  onSetDefault,
}: {
  providerId: string
  providerName: string
  color: string
  installed: boolean
  isDefault: boolean
  installCmd: string
  onSetDefault: () => void
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderRadius: 10,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: `${color}18`,
          color,
          flexShrink: 0,
        }}
      >
        <ProviderIcon providerId={providerId} size={18} color={color} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text)' }}>{providerName}</div>
          <StatusPill label={installed ? 'Ready' : 'Missing'} color={installed ? 'var(--color-green)' : '#F87171'} />
          {isDefault && <StatusPill label="Default" color={color} />}
        </div>
        {!installed && (
          <div style={{ marginTop: 8, maxWidth: 420 }}>
            <InstallCommand cmd={installCmd} />
          </div>
        )}
      </div>
      {!isDefault && (
        <button
          onClick={onSetDefault}
          disabled={!installed}
          style={{
            padding: '7px 12px',
            borderRadius: 7,
            border: `1px solid ${installed ? color : 'var(--color-border)'}`,
            background: installed ? `${color}12` : 'var(--color-surface2)',
            color: installed ? color : 'var(--color-text-muted)',
            cursor: installed ? 'pointer' : 'default',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          Set default
        </button>
      )}
    </div>
  )
}

const FEATURE_AREAS: Array<{ id: ProviderFeatureArea; label: string }> = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'permissions', label: 'Modes' },
  { id: 'commands', label: 'Commands' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP' },
  { id: 'extensions', label: 'Plugins' },
  { id: 'review', label: 'Review' },
  { id: 'workspace', label: 'Workspace' },
]

function ProviderCapabilitySummary({
  features,
  color
}: {
  features: ProviderFeature[]
  color: string
}): JSX.Element {
  const [activeArea, setActiveArea] = useState<ProviderFeatureArea>('runtime')
  const areaCounts = new Map<ProviderFeatureArea, number>()
  for (const feature of features) {
    if (feature.support !== 'unsupported') {
      areaCounts.set(feature.area, (areaCounts.get(feature.area) ?? 0) + 1)
    }
  }
  const availableAreas = FEATURE_AREAS.filter((area) => areaCounts.has(area.id))
  const selectedArea = availableAreas.some((area) => area.id === activeArea)
    ? activeArea
    : availableAreas[0]?.id ?? 'runtime'
  const visibleFeatures = features.filter((feature) => feature.area === selectedArea && feature.support !== 'unsupported')

  useEffect(() => {
    if (!availableAreas.some((area) => area.id === activeArea) && availableAreas[0]) {
      setActiveArea(availableAreas[0].id)
    }
  }, [activeArea, availableAreas])

  if (availableAreas.length === 0) return <></>

  return (
    <SettingsPanel>
      <CompactSetting title="Capabilities">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availableAreas.map((area) => {
              const active = selectedArea === area.id
              return (
                <button
                  key={area.id}
                  onClick={() => setActiveArea(area.id)}
                  style={{
                    padding: '5px 9px',
                    borderRadius: 7,
                    border: `1px solid ${active ? color : 'var(--color-border)'}`,
                    background: active ? `${color}12` : 'var(--color-surface)',
                    color: active ? color : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: active ? 650 : 500,
                  }}
                >
                  {area.label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {visibleFeatures.map((feature) => (
              <FeatureChip key={feature.id} feature={feature} color={color} />
            ))}
          </div>
        </div>
      </CompactSetting>
    </SettingsPanel>
  )
}

function FeatureChip({ feature, color }: { feature: ProviderFeature; color: string }): JSX.Element {
  const isSupported = feature.support === 'supported'
  const isPlanned = feature.support === 'planned'
  const isBlocked = feature.support === 'blocked'
  const chipColor = isSupported
    ? color
    : isPlanned
      ? 'var(--color-text-muted)'
      : isBlocked
        ? '#F87171'
        : 'var(--color-yellow)'
  const label = feature.support === 'supported'
    ? feature.label
    : `${feature.label} · ${feature.support}`

  return (
    <span
      title={feature.note ?? `${feature.source} · ${feature.runtimes.join(', ')}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 220,
        padding: '5px 8px',
        borderRadius: 7,
        border: `1px solid ${chipColor}`,
        color: chipColor,
        background: 'var(--color-surface)',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: chipColor,
          flexShrink: 0,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </span>
  )
}

function SettingsPanel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 16,
        borderRadius: 10,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        marginTop: 14,
      }}
    >
      {children}
    </div>
  )
}

function CompactSetting({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
      <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--color-text)', paddingTop: 7 }}>{title}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

function SegmentedControl({
  items,
  value,
  color,
  onChange,
}: {
  items: Array<{ id: string; label: string }>
  value: string
  color: string
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <div
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        borderRadius: 8,
        background: 'var(--color-surface2)',
        border: '1px solid var(--color-border)',
      }}
    >
      {items.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            style={{
              padding: '5px 11px',
              borderRadius: 6,
              border: 'none',
              background: active ? color : 'transparent',
              color: active ? '#fff' : 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: active ? 650 : 500,
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

function StatusPill({ label, color }: { label: string; color: string }): JSX.Element {
  return (
    <span
      style={{
        padding: '2px 7px',
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 10,
        fontWeight: 650,
        lineHeight: 1.2,
      }}
    >
      {label}
    </span>
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

function ProviderConfigEditor({ providerId, color }: { providerId: string; color: string }): JSX.Element {
  const [path, setPath] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      const nextPath = configPathForProvider(providerId, home)
      const file = await window.api.fs.readFile(nextPath)
      setPath(nextPath)
      setContent(file ?? '')
      setDirty(false)
      setSaved(false)
      setError('')
    }
    void load()
  }, [providerId])

  const save = async (): Promise<void> => {
    if (!path || saving) return
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        title={path}
        style={{
          fontSize: 10.5,
          fontFamily: 'monospace',
          color: 'var(--color-text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {path || 'Loading...'}
      </div>
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
        style={{
          width: '100%',
          minHeight: 120,
          resize: 'vertical',
          padding: 10,
          borderRadius: 8,
          border: `1px solid ${error ? '#F87171' : dirty ? color : 'var(--color-border)'}`,
          background: 'var(--color-surface2)',
          color: 'var(--color-text)',
          outline: 'none',
          fontSize: 11,
          lineHeight: '16px',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 11, color: error ? '#F87171' : 'var(--color-text-muted)' }}>
          {error || (saved ? 'Saved' : 'Local file override')}
        </div>
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{
            padding: '6px 12px',
            borderRadius: 7,
            border: `1px solid ${dirty ? color : 'var(--color-border)'}`,
            background: dirty ? color : 'var(--color-surface2)',
            color: dirty ? '#fff' : 'var(--color-text-muted)',
            cursor: dirty ? 'pointer' : 'default',
            fontSize: 11,
            fontWeight: 650,
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
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

  useEffect(() => {
    setCustomInput(models.some((m) => m.id === currentModel) ? '' : currentModel)
  }, [providerDef.id, currentModel, models])

  const applyCustom = (): void => {
    const trimmed = customInput.trim()
    if (trimmed) onSetModel(trimmed)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {models.map((m) => {
          const active = currentModel === m.id
          return (
            <button
              key={m.id}
              onClick={() => { onSetModel(m.id); setCustomInput('') }}
              title={m.id}
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
      </div>

      {/* Custom model ID */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8,
          background: !isPreset && currentModel ? 'var(--color-surface2)' : 'var(--color-surface)',
          border: `1px solid ${!isPreset && currentModel ? providerDef.color : 'var(--color-border)'}`
        }}
      >
        <input
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onBlur={applyCustom}
          onKeyDown={(e) => { if (e.key === 'Enter') applyCustom() }}
          placeholder="Custom model ID…"
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          title={row.message}
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

function ProviderProbeGrid({
  diagnostics,
  color
}: {
  diagnostics: ProviderDiagnosticInfo
  color: string
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {diagnostics.probes.map((probe) => (
        <div
          key={probe.id}
          title={`${probe.args.join(' ')}\n${probe.output}`}
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

function DiagnosticPill({ status, color }: { status: string; color: string }): JSX.Element {
  const normalized = status.toLowerCase()
  const isGood = ['found', 'ok', 'available', 'configured', 'passed'].includes(normalized)
  const isBad = ['missing', 'error', 'empty', 'failed'].includes(normalized)
  const pillColor = isGood ? color : isBad ? '#F87171' : 'var(--color-text-muted)'
  const labels: Record<string, string> = {
    found: 'OK',
    ok: 'OK',
    available: 'OK',
    configured: 'OK',
    passed: 'OK',
    missing: 'Missing',
    error: 'Error',
    empty: 'Empty',
    failed: 'Failed',
    skipped: 'Skip',
    unavailable: 'N/A',
    unknown: 'Unknown',
    'not-run': 'Off'
  }
  return (
    <span
      style={{
        justifySelf: 'start',
        padding: '2px 7px',
        borderRadius: 999,
        border: `1px solid ${pillColor}`,
        color: pillColor,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1.2
      }}
    >
      {labels[normalized] ?? status.replace('-', ' ')}
    </span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Sortable list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 0' }}>
                No models selected — showing first 5 from catalog by default.
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* Catalog toggle chips */}
      {providerDef.models.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Add from catalog
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {providerDef.models.map((m) => {
              const included = visibleIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => addCatalog(m.id)}
                  style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: 11,
                    background: included ? 'var(--color-accent-dim)' : 'var(--color-surface)',
                    border: `1px solid ${included ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    color: included ? 'var(--color-accent)' : 'var(--color-text)',
                    cursor: 'pointer'
                  }}
                >
                  {included ? '✓ ' : ''}{m.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Custom model ID input */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          Custom model ID
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustom() }}
            placeholder="e.g. gpt-5.5-preview"
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'monospace',
              background: 'var(--color-surface2)', border: '1px solid var(--color-border)',
              color: 'var(--color-text)', outline: 'none'
            }}
          />
          <button
            onClick={addCustom}
            disabled={!customInput.trim()}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: customInput.trim() ? 'var(--color-accent)' : 'var(--color-surface2)',
              border: `1px solid ${customInput.trim() ? 'var(--color-accent)' : 'var(--color-border)'}`,
              color: customInput.trim() ? '#fff' : 'var(--color-text-muted)',
              cursor: customInput.trim() ? 'pointer' : 'default'
            }}
          >
            Add
          </button>
        </div>
      </div>
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
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', borderRadius: 8,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)'
      }}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1, userSelect: 'none' }}
      >
        ⠿
      </span>
      <span style={{ flex: 1, fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>{modelId}</span>
      <button
        onClick={onRemove}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px'
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#F87171')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
      >
        ×
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

// ─── Pets section ─────────────────────────────────────────────────────────────

interface PetEntry {
  id: string
  displayName: string
  description: string
  spritesheetDataUrl: string
}

function PetsSection(): JSX.Element {
  const [pets, setPets] = useState<PetEntry[]>([])
  const [selectedPetId, setSelectedPetId] = useState('ditto')
  const [isOpen, setIsOpen] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importingCodex, setImportingCodex] = useState(false)

  useEffect(() => {
    window.api.pet.getConfig().then((cfg) => {
      const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
      setPets(c.pets ?? [])
      setSelectedPetId(c.selectedPetId ?? 'ditto')
      setIsOpen(c.isOpen ?? true)
    })
  }, [])

  const handleSelect = (id: string): void => {
    setSelectedPetId(id)
    window.api.pet.selectPet(id)
  }

  const handleToggleOpen = (): void => {
    const next = !isOpen
    setIsOpen(next)
    window.api.pet.setOpen(next)
  }

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const result = await window.api.pet.importPet()
      if (result) {
        const cfg = await window.api.pet.getConfig()
        const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
        setPets(c.pets ?? [])
      }
    } finally {
      setImporting(false)
    }
  }

  const handleImportCodexPets = async (): Promise<void> => {
    setImportingCodex(true)
    try {
      await window.api.pet.importCodexPets()
      const cfg = await window.api.pet.getConfig()
      const c = cfg as { pets: PetEntry[]; selectedPetId: string; isOpen: boolean }
      setPets(c.pets ?? [])
    } finally {
      setImportingCodex(false)
    }
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 640 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 24 }}>Pets</h2>

      {/* Toggle */}
      <SettingGroup title="Pet overlay" description="Floating companion that shows session activity above all windows.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            onClick={handleToggleOpen}
            style={{
              width: 40, height: 22, borderRadius: 11, cursor: 'pointer', position: 'relative',
              background: isOpen ? 'var(--color-accent)' : 'var(--color-surface2)',
              border: `1px solid ${isOpen ? 'var(--color-accent)' : 'var(--color-border)'}`,
              transition: 'background 0.15s',
              flexShrink: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: 2, left: isOpen ? 20 : 2,
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
          <span style={{ fontSize: 12, color: isOpen ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
            {isOpen ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </SettingGroup>

      {/* Pet picker */}
      <SettingGroup title="Choose your pet" description="Select which companion appears in the overlay.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {pets.map((pet) => {
            const active = pet.id === selectedPetId
            return (
              <div
                key={pet.id}
                onClick={() => handleSelect(pet.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '12px 16px', borderRadius: 12, cursor: 'pointer', minWidth: 120,
                  background: active ? 'var(--color-surface2)' : 'var(--color-surface)',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-surface2)' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--color-surface)' }}
              >
                {/* Idle frame thumbnail */}
                <div
                  style={{
                    width: 96,
                    height: 104,
                    backgroundImage: `url(${pet.spritesheetDataUrl})`,
                    backgroundSize: '800% 900%',
                    backgroundPosition: '0% 0%',
                    backgroundRepeat: 'no-repeat',
                    imageRendering: 'pixelated',
                  }}
                />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)' }}>
                    {pet.displayName}
                  </div>
                  {active && (
                    <div style={{ fontSize: 10, color: 'var(--color-accent)', marginTop: 2 }}>Selected</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </SettingGroup>

      {/* Import */}
      <SettingGroup title="Import pets" description="Add pets from a local bundle or copy presets and custom pets from Codex.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            onClick={handleImportCodexPets}
            disabled={importingCodex}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              color: importingCodex ? 'var(--color-text-muted)' : 'var(--color-text)',
            }}
          >
            {importingCodex ? 'Importing…' : 'Import from Codex'}
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              color: importing ? 'var(--color-text-muted)' : 'var(--color-text)',
            }}
          >
            {importing ? 'Importing…' : 'Import from .zip'}
          </button>
        </div>
      </SettingGroup>
    </div>
  )
}

function SettingGroup({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode
}): JSX.Element {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>{description}</div>}
      {children}
    </div>
  )
}

function InstallCommand({ cmd }: { cmd: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const handleCopy = (): void => {
    navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div
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
        onClick={handleCopy}
        style={{
          flexShrink: 0, padding: '2px 8px', borderRadius: 4, fontSize: 11,
          background: copied ? 'var(--color-green)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: copied ? '#fff' : 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 500
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
