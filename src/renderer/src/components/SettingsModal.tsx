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
import { PROVIDER_DEFS, getVisibleModels } from '../types'
import { useSessionStore } from '../store/sessions'
import ProviderIcon from './shared/ProviderIcon'

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

  useEffect(() => {
    window.api.settings.get().then((s) => {
      const rec = s as Record<string, unknown>
      setDefaultProvider((rec.defaultProvider as string) ?? 'claude')
      setDefaultModels((rec.defaultModels as Record<string, string>) ?? {})
      setDefaultEfforts((rec.defaultEfforts as Record<string, string>) ?? {})
      setProviderModels((rec.providerModels as Record<string, string[]>) ?? {})
    })
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
          {activeSection === 'general' && <GeneralSection />}
          {activeSection === 'pets' && <PetsSection />}
          {activeSection === 'providers' && (
            <ProvidersSection
              defaultProvider={defaultProvider}
              defaultModels={defaultModels}
              defaultEfforts={defaultEfforts}
              providerModels={providerModels}
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

function GeneralSection(): JSX.Element {
  return (
    <div style={{ padding: '32px 40px', maxWidth: 640 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 24 }}>General</h2>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
        App-wide settings (theming, shortcuts, etc.) coming soon.
      </div>
    </div>
  )
}

// ─── Providers section ────────────────────────────────────────────────────────

function ProvidersSection({
  defaultProvider, defaultModels, defaultEfforts, providerModels,
  providerAvailability, onSetDefaultProvider, onSetDefaultModel, onSetDefaultEffort, onSetProviderModels
}: {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  providerModels: Record<string, string[]>
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

  return (
    <div style={{ padding: '32px 40px', maxWidth: 700 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 20 }}>Providers</h2>

      {/* Provider tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, flexWrap: 'wrap' }}>
        {providerList.map((p) => {
          const ok = providerAvailability[p.id] !== false
          const active = selectedId === p.id
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 8, fontSize: 12,
                background: active ? 'var(--color-surface2)' : 'var(--color-surface)',
                border: `1px solid ${active ? p.color : 'var(--color-border)'}`,
                color: ok ? (active ? p.color : 'var(--color-text)') : 'var(--color-text-muted)',
                cursor: 'pointer', opacity: ok ? 1 : 0.5
              }}
            >
              <ProviderIcon providerId={p.id} size={12} color={ok ? p.color : 'var(--color-text-muted)'} />
              {p.name}
            </button>
          )
        })}
      </div>

      {/* Per-provider content — key forces clean remount on provider switch, stopping DnD jitter */}
      <div key={selectedId}>

      {/* Install status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span
          style={{
            fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
            background: installed ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            color: installed ? 'var(--color-green)' : '#F87171'
          }}
        >
          {installed ? 'Installed' : 'Not found'}
        </span>
        {!installed && <InstallCommand cmd={providerDef.installCmd} />}
        {installed && providerDef.id !== 'claude' && (
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)', opacity: 0.5 }}>
            {providerDef.installCmd}
          </span>
        )}
      </div>

      {/* Claude endpoint */}
      {providerDef.id === 'claude' && (
        <SettingGroup title="API Endpoint" description="Override the default Anthropic API endpoint.">
          <ClaudeEndpointField color={providerDef.color} />
        </SettingGroup>
      )}

      {/* Default provider toggle */}
      <SettingGroup title="Default provider" description="Used when creating a new session.">
        <button
          onClick={() => onSetDefaultProvider(selectedId)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 14px', borderRadius: 8, fontSize: 12,
            background: defaultProvider === selectedId ? 'var(--color-surface2)' : 'var(--color-surface)',
            border: `1px solid ${defaultProvider === selectedId ? providerDef.color : 'var(--color-border)'}`,
            color: defaultProvider === selectedId ? providerDef.color : 'var(--color-text)',
            cursor: installed ? 'pointer' : 'default', opacity: installed ? 1 : 0.5
          }}
        >
          {defaultProvider === selectedId ? 'Currently default' : `Set ${providerDef.name} as default`}
        </button>
      </SettingGroup>

      {/* Default model */}
      <SettingGroup title={`Default model · ${providerDef.name}`} description="Pre-selected when creating a new session.">
        <DefaultModelPicker
          providerDef={providerDef}
          currentModel={currentModel}
          onSetModel={(id) => onSetDefaultModel(selectedId, id)}
        />
      </SettingGroup>

      {/* Default effort */}
      {providerDef.supportsEffort && providerDef.effortLevels.length > 0 && (
        <SettingGroup title={`Default thinking · ${providerDef.name}`} description="How much reasoning effort by default.">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {providerDef.effortLevels.map((e) => {
              const active = currentEffort === e.id
              return (
                <button
                  key={e.id}
                  onClick={() => onSetDefaultEffort(selectedId, e.id)}
                  style={{
                    padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    background: active ? 'var(--color-surface2)' : 'var(--color-surface)',
                    border: `1px solid ${active ? providerDef.color : 'var(--color-border)'}`,
                    color: active ? providerDef.color : 'var(--color-text)', cursor: 'pointer'
                  }}
                >
                  {e.label}
                </button>
              )
            })}
          </div>
        </SettingGroup>
      )}

      {/* Visible model list manager */}
      <SettingGroup
        title={`Visible models · ${providerDef.name}`}
        description="Models shown in the session picker. Drag to reorder."
      >
        <ModelListManager
          providerDef={providerDef}
          visibleIds={visibleIds}
          onChange={(ids) => onSetProviderModels(selectedId, ids)}
        />
      </SettingGroup>

      </div> {/* end key={selectedId} wrapper */}
    </div>
  )
}

// ─── Default model picker ─────────────────────────────────────────────────────

function DefaultModelPicker({
  providerDef, currentModel, onSetModel
}: {
  providerDef: typeof PROVIDER_DEFS[string]
  currentModel: string
  onSetModel: (id: string) => void
}): JSX.Element {
  const isPreset = providerDef.models.some((m) => m.id === currentModel)
  const [customInput, setCustomInput] = useState(isPreset ? '' : currentModel)

  useEffect(() => {
    setCustomInput(providerDef.models.some((m) => m.id === currentModel) ? '' : currentModel)
  }, [providerDef.id])

  const applyCustom = (): void => {
    const trimmed = customInput.trim()
    if (trimmed) onSetModel(trimmed)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {providerDef.models.map((m) => {
        const active = currentModel === m.id
        return (
          <button
            key={m.id}
            onClick={() => { onSetModel(m.id); setCustomInput('') }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', borderRadius: 8,
              background: active ? 'var(--color-surface2)' : 'var(--color-surface)',
              border: `1px solid ${active ? providerDef.color : 'var(--color-border)'}`,
              color: active ? providerDef.color : 'var(--color-text)',
              cursor: 'pointer', textAlign: 'left'
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-text-muted)', marginTop: 2 }}>{m.id}</div>
            </div>
            {active && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
            )}
          </button>
        )
      })}

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
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, opacity: 0.7 }}>
        Sets <span style={{ fontFamily: 'monospace' }}>ANTHROPIC_BASE_URL</span> in ~/.claude/settings.json
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
                    backgroundSize: '768px 936px',
                    backgroundPosition: '0px 0px',
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
      <SettingGroup title="Import custom pet" description="Add a pet from a .zip bundle containing pet.json and a spritesheet.webp.">
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
      </SettingGroup>
    </div>
  )
}

function SettingGroup({ title, description, children }: {
  title: string; description: string; children: React.ReactNode
}): JSX.Element {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>{description}</div>
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
