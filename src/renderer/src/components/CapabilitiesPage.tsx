import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PROVIDER_DEFS,
  type CapabilityCreateKind,
  type CapabilityCreateRequest,
  type CapabilityMcpTransport,
  type CapabilitySyncMode,
  type CapabilitySyncPlan,
  type CapabilitySyncRequest,
  type CapabilityUpdateRequest,
  type ProviderResource,
  type ProviderResourceKind,
  type ProviderResourceSnapshot
} from '../types'
import { useProjectStore } from '../store/projects'
import { useSessionStore } from '../store/sessions'
import Icon from './shared/Icon'
import ProviderIcon from './shared/ProviderIcon'
import { Badge, Button, ConfirmDialog, MenuItem, MenuSurface, SegmentedControl, Sheet, SurfaceRow, ToolbarButton } from './shared/designSystem'

type CapabilityTab = 'skill' | 'mcp' | 'plugin' | 'app' | 'agent' | 'instruction' | 'more'
type CapabilityScopeFilter = 'all' | 'global' | 'project'

type CapabilityTabDef = {
  id: CapabilityTab
  label: string
  kinds: ProviderResourceKind[]
  empty: string
}

type ResourceGroup = {
  fingerprint: string
  kind: ProviderResourceKind
  name: string
  description?: string
  status: ProviderResource['status']
  resources: ProviderResource[]
}

const PROVIDER_IDS = Object.keys(PROVIDER_DEFS)
const TAB_DEFS: CapabilityTabDef[] = [
  { id: 'skill', label: 'Skills', kinds: ['skill'], empty: 'No skills are visible yet.' },
  { id: 'mcp', label: 'MCPs', kinds: ['mcp_server', 'mcp_tool'], empty: 'No MCP servers or tools are visible yet.' },
  { id: 'plugin', label: 'Plugins', kinds: ['plugin'], empty: 'No plugins are visible yet.' },
  { id: 'app', label: 'Apps', kinds: ['app'], empty: 'No connected apps are visible yet.' },
  { id: 'agent', label: 'Agents', kinds: ['agent'], empty: 'No provider agents are visible yet.' },
  { id: 'instruction', label: 'Instructions', kinds: ['rule'], empty: 'No project instructions are visible yet.' },
  { id: 'more', label: 'More', kinds: ['hook', 'command'], empty: 'No hooks or commands are visible yet.' }
]

export default function CapabilitiesPage(): JSX.Element {
  const { projects } = useProjectStore()
  const {
    activeSessionId,
    sessions,
    setShowSettings,
    setSettingsSection
  } = useSessionStore()
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const activeProject = projects.find((project) => project.id === activeSession?.projectId) ?? projects[0]
  const workDir = activeSession?.workDir ?? activeProject?.rootPath ?? ''
  const [snapshots, setSnapshots] = useState<Record<string, ProviderResourceSnapshot>>({})
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<CapabilityTab>('skill')
  const [query, setQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState<CapabilityScopeFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [createKind, setCreateKind] = useState<CapabilityCreateKind>('skill')
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [mcpTransport, setMcpTransport] = useState<CapabilityMcpTransport>('stdio')
  const [mcpCommand, setMcpCommand] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [editingGroup, setEditingGroup] = useState<ResourceGroup | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editMcpTransport, setEditMcpTransport] = useState<CapabilityMcpTransport>('stdio')
  const [editMcpCommand, setEditMcpCommand] = useState('')
  const [editMcpArgs, setEditMcpArgs] = useState('')
  const [editMcpUrl, setEditMcpUrl] = useState('')
  const [syncGroup, setSyncGroup] = useState<ResourceGroup | null>(null)
  const [syncPlan, setSyncPlan] = useState<CapabilitySyncPlan | null>(null)
  const [syncTargets, setSyncTargets] = useState<string[]>([])
  const [syncMode, setSyncMode] = useState<CapabilitySyncMode>('backfill-missing-providers')
  const [syncLoading, setSyncLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [removeCandidate, setRemoveCandidate] = useState<ResourceGroup | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!workDir) return
    setLoading(true)
    try {
      await Promise.allSettled(PROVIDER_IDS.map(async (id) => {
        const next = await window.api.providers.listResources(id, workDir)
        setSnapshots((current) => ({ ...current, ...next }))
      }))
    } finally {
      setLoading(false)
    }
  }, [workDir])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const resources = useMemo(() => (
    Object.values(snapshots)
      .flatMap((snapshot) => snapshot.resources)
      .filter((resource) => (
        scopeFilter === 'all' ||
        resource.scope === scopeFilter ||
        (scopeFilter === 'project' && resource.scope === 'workspace')
      ))
  ), [scopeFilter, snapshots])
  const groups = useMemo(() => mergeResourceGroups(resources), [resources])
  const filteredGroups = useMemo(() => filterGroups(groups, query, providerFilter), [groups, providerFilter, query])
  const errors = Object.values(snapshots).flatMap((snapshot) =>
    snapshot.errors.map((error) => ({ ...error, providerId: snapshot.providerId }))
  )
  const tabCounts = useMemo(() => {
    return Object.fromEntries(TAB_DEFS.map((tabDef) => [
      tabDef.id,
      groups.filter((group) => tabDef.kinds.includes(group.kind)).length
    ])) as Record<CapabilityTab, number>
  }, [groups])
  const visibleTabs = useMemo(() => TAB_DEFS.filter((tabDef) => tabCounts[tabDef.id] > 0), [tabCounts])
  const activeTab = visibleTabs.find((tabDef) => tabDef.id === tab) ?? visibleTabs[0] ?? TAB_DEFS[0]
  const visibleGroups = filteredGroups.filter((group) => activeTab.kinds.includes(group.kind))
  const providerCount = new Set(resources.map((resource) => resource.providerId)).size

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((tabDef) => tabDef.id === tab)) {
      setTab(visibleTabs[0].id)
    }
  }, [tab, visibleTabs])

  const openProviderSettings = (): void => {
    setSettingsSection('providers')
    setShowSettings(true)
  }

  const openCreate = (kind: CapabilityCreateKind): void => {
    setCreateKind(kind)
    setCreateMenuOpen(false)
    setCreateOpen(true)
  }

  const submitCreate = async (): Promise<void> => {
    if (!workDir) {
      setMessage('Open a project before creating capabilities.')
      return
    }
    const request: CapabilityCreateRequest = {
      kind: createKind,
      scope: 'global',
      workDir,
      name: createName,
      description: createDescription,
      body: createBody,
      transport: mcpTransport,
      command: mcpCommand,
      args: mcpArgs.split(/\s+/).map((arg) => arg.trim()).filter(Boolean),
      url: mcpUrl
    }
    try {
      const result = await window.api.providers.createCapability(request)
      setMessage(`${createLabel(createKind)} created. ${result.files.length} file${result.files.length === 1 ? '' : 's'} updated.`)
      setCreateOpen(false)
      setCreateName('')
      setCreateDescription('')
      setCreateBody('')
      setMcpCommand('')
      setMcpArgs('')
      setMcpUrl('')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const openEdit = (group: ResourceGroup): void => {
    const mcp = group.kind === 'mcp_server' ? mcpConfigFromGroup(group) : null
    setEditingGroup(group)
    setEditName(group.name)
    setEditDescription(group.description ?? '')
    setEditBody('')
    setEditMcpTransport(mcp?.transport ?? 'stdio')
    setEditMcpCommand(mcp?.command ?? '')
    setEditMcpArgs(mcp?.args?.join(' ') ?? '')
    setEditMcpUrl(mcp?.url ?? '')
  }

  const submitEdit = async (): Promise<void> => {
    if (!editingGroup) return
    const request: CapabilityUpdateRequest = {
      resources: editingGroup.resources,
      name: editName,
      description: editDescription,
      body: editBody || undefined,
      transport: editMcpTransport,
      command: editMcpCommand,
      args: editMcpArgs.split(/\s+/).map((arg) => arg.trim()).filter(Boolean),
      url: editMcpUrl
    }
    try {
      const result = await window.api.providers.updateCapability(request)
      setMessage(`Updated ${editingGroup.name}. ${result.files.length} file${result.files.length === 1 ? '' : 's'} changed.${result.warnings.length ? ` ${result.warnings[0]}` : ''}`)
      setEditingGroup(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const removeGroup = async (group: ResourceGroup): Promise<void> => {
    try {
      const result = await window.api.providers.deleteCapability({ resources: group.resources })
      setMessage(`Removed ${group.name}. ${result.files.length} file${result.files.length === 1 ? '' : 's'} changed.${result.warnings.length ? ` ${result.warnings[0]}` : ''}`)
      setRemoveCandidate(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const previewSync = async (group: ResourceGroup, targets: string[], mode: CapabilitySyncMode): Promise<void> => {
    if (!workDir) {
      setMessage('Open a project before syncing capabilities.')
      return
    }
    setSyncLoading(true)
    try {
      const plan = await window.api.providers.previewCapabilitySync(syncRequest(group, workDir, targets, mode))
      setSyncPlan(plan)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncLoading(false)
    }
  }

  const openSync = (group: ResourceGroup): void => {
    const targets = defaultSyncTargets(group)
    const mode: CapabilitySyncMode = 'backfill-missing-providers'
    setSyncGroup(group)
    setSyncTargets(targets)
    setSyncMode(mode)
    setSyncPlan(null)
    void previewSync(group, targets, mode)
  }

  const updateSyncTargets = (targets: string[]): void => {
    setSyncTargets(targets)
    if (syncGroup) void previewSync(syncGroup, targets, syncMode)
  }

  const updateSyncMode = (mode: CapabilitySyncMode): void => {
    setSyncMode(mode)
    if (syncGroup) void previewSync(syncGroup, syncTargets, mode)
  }

  const submitSync = async (): Promise<void> => {
    if (!syncGroup || syncTargets.length === 0 || !workDir) return
    try {
      const result = await window.api.providers.syncCapability(syncRequest(syncGroup, workDir, syncTargets, syncMode))
      setMessage(`Synced ${syncGroup.name}. ${result.files.length} file${result.files.length === 1 ? '' : 's'} changed.${result.warnings.length ? ` ${result.warnings[0]}` : ''}`)
      setSyncGroup(null)
      setSyncPlan(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="capabilities-page">
      <header className="capabilities-header">
        <div className="min-w-0">
          <div className="capabilities-title-row">
            <h1>Capabilities</h1>
          </div>
          <p>
            Skills, MCPs, plugins, apps, and provider-native extensions across global and project scopes.
          </p>
        </div>
        <div className="capabilities-header-actions">
          <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
            <Icon name="refresh" size={14} />
            {loading ? 'Refreshing' : 'Refresh'}
          </Button>
          <div className="cap-create-wrap">
            <Button variant="primary" onClick={() => setCreateMenuOpen((open) => !open)}>
              <Icon name="plus" size={14} />
              Create
            </Button>
            {createMenuOpen && (
              <MenuSurface className="cap-create-menu" onClose={() => setCreateMenuOpen(false)}>
                <MenuItem icon="sparkles" label="Skill" onClick={() => openCreate('skill')} />
                <MenuItem icon="plug" label="MCP server" onClick={() => openCreate('mcp_server')} />
                <MenuItem icon="extensions" label="Plugin" onClick={() => openCreate('plugin')} />
              </MenuSurface>
            )}
          </div>
        </div>
      </header>

      <main className="capabilities-main">
        <section className="capabilities-toolbar">
          <label className="capabilities-scope-select">
            <span>Scope</span>
            <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as CapabilityScopeFilter)}>
              <option value="all">All scopes</option>
              <option value="global">Global</option>
              <option value="project">Project</option>
            </select>
          </label>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search capabilities"
            className="capabilities-search"
          />
          <select
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            className="capabilities-select"
          >
            <option value="all">All providers</option>
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>{PROVIDER_DEFS[id].name}</option>
            ))}
          </select>
        </section>

        <section className="capability-status-row">
          <span>{groups.length.toLocaleString()} capabilities across {providerCount.toLocaleString()} provider{providerCount === 1 ? '' : 's'}</span>
          {errors.length > 0 && (
            <Button variant="danger" onClick={openProviderSettings}>
              <Icon name="wrench" size={13} />
              {errors.length} issue{errors.length === 1 ? '' : 's'}
            </Button>
          )}
        </section>

        <section className="capability-tabs" aria-label="Capability sections">
          <SegmentedControl
            value={activeTab.id}
            onChange={setTab}
            options={visibleTabs.map((nextTab) => ({
              value: nextTab.id,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {nextTab.label}
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>{tabCounts[nextTab.id]}</span>
                </span>
              )
            }))}
          />
        </section>

        {message && (
          <div className="capability-message">
            <span>{message}</span>
            <ToolbarButton icon="close" label="Dismiss" onClick={() => setMessage(null)} />
          </div>
        )}

        {errors.length > 0 && <IssuesBanner count={errors.length} onOpenProviders={openProviderSettings} />}

        <section className="capabilities-list">
          {visibleTabs.length === 0 ? (
            <div className="capability-empty">
              {loading ? 'Loading capabilities...' : 'No capabilities are visible yet. Create a skill, plugin, or MCP server to get started.'}
            </div>
          ) : (
            <CapabilityList
              activeTab={activeTab}
              groups={visibleGroups}
              loading={loading}
              onEdit={openEdit}
              onRemove={(group) => setRemoveCandidate(group)}
              onSync={openSync}
            />
          )}
        </section>
      </main>

      {createOpen && (
        <CreateCapabilitySheet
          kind={createKind}
          name={createName}
          description={createDescription}
          body={createBody}
          mcpTransport={mcpTransport}
          mcpCommand={mcpCommand}
          mcpArgs={mcpArgs}
          mcpUrl={mcpUrl}
          onKindChange={setCreateKind}
          onNameChange={setCreateName}
          onDescriptionChange={setCreateDescription}
          onBodyChange={setCreateBody}
          onMcpTransportChange={setMcpTransport}
          onMcpCommandChange={setMcpCommand}
          onMcpArgsChange={setMcpArgs}
          onMcpUrlChange={setMcpUrl}
          onClose={() => setCreateOpen(false)}
          onSubmit={() => void submitCreate()}
        />
      )}

      {editingGroup && (
        <EditCapabilitySheet
          group={editingGroup}
          name={editName}
          description={editDescription}
          body={editBody}
          mcpTransport={editMcpTransport}
          mcpCommand={editMcpCommand}
          mcpArgs={editMcpArgs}
          mcpUrl={editMcpUrl}
          onNameChange={setEditName}
          onDescriptionChange={setEditDescription}
          onBodyChange={setEditBody}
          onMcpTransportChange={setEditMcpTransport}
          onMcpCommandChange={setEditMcpCommand}
          onMcpArgsChange={setEditMcpArgs}
          onMcpUrlChange={setEditMcpUrl}
          onClose={() => setEditingGroup(null)}
          onSubmit={() => void submitEdit()}
        />
      )}

      {syncGroup && (
        <SyncCapabilitySheet
          group={syncGroup}
          plan={syncPlan}
          mode={syncMode}
          targets={syncTargets}
          loading={syncLoading}
          onModeChange={updateSyncMode}
          onTargetsChange={updateSyncTargets}
          onClose={() => {
            setSyncGroup(null)
            setSyncPlan(null)
          }}
          onSubmit={() => void submitSync()}
        />
      )}

      {removeCandidate && (
        <ConfirmDialog
          title={`Remove ${removeCandidate.name}?`}
          description="This will delete editable global capability files for this item."
          confirmLabel="Delete"
          onCancel={() => setRemoveCandidate(null)}
          onConfirm={() => void removeGroup(removeCandidate)}
        />
      )}
    </div>
  )
}

function CapabilityList({
  activeTab,
  groups,
  loading,
  onEdit,
  onRemove,
  onSync
}: {
  activeTab: CapabilityTabDef
  groups: ResourceGroup[]
  loading: boolean
  onEdit: (group: ResourceGroup) => void
  onRemove: (group: ResourceGroup) => void
  onSync: (group: ResourceGroup) => void
}): JSX.Element {
  if (groups.length === 0) {
    return (
      <div className="capability-empty">
        {loading ? 'Loading capabilities...' : activeTab.empty}
      </div>
    )
  }
  return (
    <div className="capability-list-stack">
      <div className="capability-list-heading">
        <h2>{activeTab.label}</h2>
        <span>{groups.length.toLocaleString()} item{groups.length === 1 ? '' : 's'}</span>
      </div>
      <div className="capability-table">
        {groups.map((group) => (
          <CapabilityRow
            key={group.fingerprint}
            group={group}
            onEdit={() => onEdit(group)}
            onRemove={() => onRemove(group)}
            onSync={() => onSync(group)}
          />
        ))}
      </div>
    </div>
  )
}

function CapabilityRow({
  group,
  onEdit,
  onRemove,
  onSync
}: {
  group: ResourceGroup
  onEdit: () => void
  onRemove: () => void
  onSync: () => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const tone = resourceStatusTone(group.status)
  const sources = Array.from(new Set(group.resources.map((resource) => resource.source).filter(Boolean)))
  const canEdit = group.resources.some((resource) => resource.actions.includes('edit'))
  const canRemove = group.resources.some((resource) => resource.actions.includes('remove'))
  const canSync = syncableKind(group.kind)
  const hasActions = canEdit || canRemove || canSync
  const coverage = providerCoverageLabel(group)
  return (
    <SurfaceRow className="capability-row">
      <div className="capability-row-main">
        <div className="capability-kind-dot" style={{ background: tone }} />
        <div className="min-w-0">
          <h3 title={group.name}>{group.name}</h3>
          <p>{group.description || resourceKindLabel(group.kind).replace(/s$/, '')}</p>
        </div>
      </div>
      <div className="capability-row-meta">
        <span>{resourceKindLabel(group.kind).replace(/s$/, '')}</span>
        {sources[0] && <span title={sources.join(', ')}>{sources[0]}</span>}
        <span>{scopeSummary(group)}</span>
        {coverage && <span>{coverage}</span>}
      </div>
      <div className="provider-chip-row">
        {group.resources.slice(0, 4).map((resource) => {
          const provider = PROVIDER_DEFS[resource.providerId]
          return (
            <span key={resource.id} title={`${provider?.name ?? resource.providerId} · ${resource.source}`}>
              {provider && <ProviderIcon providerId={provider.id} size={11} color={provider.color} />}
              {provider?.name ?? resource.providerId}
            </span>
          )
        })}
        {group.resources.length > 4 && <span>+{group.resources.length - 4}</span>}
      </div>
      <strong className="capability-row-status">
        <Badge tone={statusTone(group.status)}>{group.status}</Badge>
      </strong>
      <div className="capability-row-actions">
        {hasActions && (
          <ToolbarButton
            icon="ellipsis"
            label="Capability actions"
            onClick={() => setMenuOpen((open) => !open)}
            active={menuOpen}
          />
        )}
        {hasActions && menuOpen && (
          <MenuSurface className="capability-row-menu" onClose={() => setMenuOpen(false)}>
            <MenuItem
              icon="refresh"
              label="Sync"
              disabled={!canSync}
              onClick={() => {
                setMenuOpen(false)
                onSync()
              }}
            />
            <MenuItem
              icon="pencil"
              label="Edit"
              disabled={!canEdit}
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            />
            <MenuItem
              icon="close"
              label="Delete"
              tone="danger"
              disabled={!canRemove}
              onClick={() => {
                setMenuOpen(false)
                onRemove()
              }}
            />
          </MenuSurface>
        )}
      </div>
    </SurfaceRow>
  )
}

function IssuesBanner({
  count,
  onOpenProviders
}: {
  count: number
  onOpenProviders: () => void
}): JSX.Element {
  return (
    <section className="capability-issues">
      <div className="capability-issues-header">
        <strong>{count} capability issue{count === 1 ? '' : 's'}</strong>
        <span>Some native provider inventory calls did not respond.</span>
        <button onClick={onOpenProviders}>Open provider settings</button>
      </div>
    </section>
  )
}

function CreateCapabilitySheet({
  kind,
  name,
  description,
  body,
  mcpTransport,
  mcpCommand,
  mcpArgs,
  mcpUrl,
  onKindChange,
  onNameChange,
  onDescriptionChange,
  onBodyChange,
  onMcpTransportChange,
  onMcpCommandChange,
  onMcpArgsChange,
  onMcpUrlChange,
  onClose,
  onSubmit
}: {
  kind: CapabilityCreateKind
  name: string
  description: string
  body: string
  mcpTransport: CapabilityMcpTransport
  mcpCommand: string
  mcpArgs: string
  mcpUrl: string
  onKindChange: (kind: CapabilityCreateKind) => void
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onBodyChange: (value: string) => void
  onMcpTransportChange: (value: CapabilityMcpTransport) => void
  onMcpCommandChange: (value: string) => void
  onMcpArgsChange: (value: string) => void
  onMcpUrlChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}): JSX.Element {
  return (
    <Sheet
      onClose={onClose}
      title={
        <div>
          <h2>Create capability</h2>
          <p>Portable where possible, provider-native where necessary.</p>
        </div>
      }
      footer={
        <>
          <span className="capability-scope-note">Global capability</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit}>Create</Button>
        </>
      }
    >
        <SegmentedControl
          value={kind}
          onChange={onKindChange}
          options={(['skill', 'plugin', 'mcp_server'] as CapabilityCreateKind[]).map((nextKind) => ({
            value: nextKind,
            label: createLabel(nextKind)
          }))}
          className="mb-3"
        />

        <label className="cap-field">
          <span>Name</span>
          <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Release reviewer" />
        </label>
        <label className="cap-field">
          <span>Description</span>
          <input value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="When this capability should be used" />
        </label>

        {kind === 'mcp_server' ? (
          <>
            <SegmentedControl
              value={mcpTransport}
              onChange={onMcpTransportChange}
              options={(['stdio', 'http'] as CapabilityMcpTransport[]).map((transport) => ({
                value: transport,
                label: transport === 'stdio' ? 'Command' : 'HTTP'
              }))}
              className="mb-3"
            />
            {mcpTransport === 'stdio' ? (
              <>
                <label className="cap-field">
                  <span>Command</span>
                  <input value={mcpCommand} onChange={(event) => onMcpCommandChange(event.target.value)} placeholder="node" />
                </label>
                <label className="cap-field">
                  <span>Arguments</span>
                  <input value={mcpArgs} onChange={(event) => onMcpArgsChange(event.target.value)} placeholder="./server.js --stdio" />
                </label>
              </>
            ) : (
              <label className="cap-field">
                <span>URL</span>
                <input value={mcpUrl} onChange={(event) => onMcpUrlChange(event.target.value)} placeholder="https://example.com/mcp" />
              </label>
            )}
          </>
        ) : (
          <label className="cap-field">
            <span>Instructions</span>
            <textarea value={body} onChange={(event) => onBodyChange(event.target.value)} placeholder="Describe the workflow, rules, examples, and verification expectations." />
          </label>
        )}
    </Sheet>
  )
}

function EditCapabilitySheet({
  group,
  name,
  description,
  body,
  mcpTransport,
  mcpCommand,
  mcpArgs,
  mcpUrl,
  onNameChange,
  onDescriptionChange,
  onBodyChange,
  onMcpTransportChange,
  onMcpCommandChange,
  onMcpArgsChange,
  onMcpUrlChange,
  onClose,
  onSubmit
}: {
  group: ResourceGroup
  name: string
  description: string
  body: string
  mcpTransport: CapabilityMcpTransport
  mcpCommand: string
  mcpArgs: string
  mcpUrl: string
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onBodyChange: (value: string) => void
  onMcpTransportChange: (value: CapabilityMcpTransport) => void
  onMcpCommandChange: (value: string) => void
  onMcpArgsChange: (value: string) => void
  onMcpUrlChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}): JSX.Element {
  const editable = group.resources.some((resource) => resource.actions.includes('edit'))
  return (
    <Sheet
      onClose={onClose}
      title={
        <div>
          <h2>Edit capability</h2>
          <p>{editable ? 'Updates global capability files that Orchestrator can safely manage.' : 'This item is provider-managed.'}</p>
        </div>
      }
      footer={
        <>
          <span className="capability-scope-note">{editable ? 'Editable global file' : 'Provider-managed'}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={!editable}>Save</Button>
        </>
      }
    >
        <label className="cap-field">
          <span>Name</span>
          <input value={name} onChange={(event) => onNameChange(event.target.value)} disabled={!editable} />
        </label>
        <label className="cap-field">
          <span>Description</span>
          <input value={description} onChange={(event) => onDescriptionChange(event.target.value)} disabled={!editable} />
        </label>

        {group.kind === 'mcp_server' ? (
          <>
            <SegmentedControl
              value={mcpTransport}
              onChange={onMcpTransportChange}
              options={(['stdio', 'http'] as CapabilityMcpTransport[]).map((transport) => ({
                value: transport,
                label: transport === 'stdio' ? 'Command' : 'HTTP',
                disabled: !editable
              }))}
              className="compact mb-3"
            />
            {mcpTransport === 'stdio' ? (
              <>
                <label className="cap-field">
                  <span>Command</span>
                  <input value={mcpCommand} onChange={(event) => onMcpCommandChange(event.target.value)} disabled={!editable} />
                </label>
                <label className="cap-field">
                  <span>Arguments</span>
                  <input value={mcpArgs} onChange={(event) => onMcpArgsChange(event.target.value)} disabled={!editable} />
                </label>
              </>
            ) : (
              <label className="cap-field">
                <span>URL</span>
                <input value={mcpUrl} onChange={(event) => onMcpUrlChange(event.target.value)} disabled={!editable} />
              </label>
            )}
          </>
        ) : (
          <label className="cap-field">
            <span>Instructions</span>
            <textarea
              value={body}
              onChange={(event) => onBodyChange(event.target.value)}
              placeholder="Leave blank to preserve the existing instructions."
              disabled={!editable}
            />
          </label>
        )}
    </Sheet>
  )
}

function SyncCapabilitySheet({
  group,
  plan,
  mode,
  targets,
  loading,
  onModeChange,
  onTargetsChange,
  onClose,
  onSubmit
}: {
  group: ResourceGroup
  plan: CapabilitySyncPlan | null
  mode: CapabilitySyncMode
  targets: string[]
  loading: boolean
  onModeChange: (mode: CapabilitySyncMode) => void
  onTargetsChange: (targets: string[]) => void
  onClose: () => void
  onSubmit: () => void
}): JSX.Element {
  const providerOptions = syncProviderOptions(group.kind)
  const blockers = plan?.blockers ?? []
  const warnings = plan?.warnings ?? []
  const disabled = loading || targets.length === 0 || blockers.length > 0 || !plan

  const toggleTarget = (providerId: string): void => {
    const next = targets.includes(providerId)
      ? targets.filter((id) => id !== providerId)
      : [...targets, providerId]
    onTargetsChange(next)
  }

  return (
    <Sheet
      onClose={onClose}
      title={
        <div>
          <h2>Sync capability</h2>
          <p>{group.name}</p>
        </div>
      }
      footer={
        <>
          <span className="capability-scope-note">{scopeSummary(group)}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={disabled}>Apply</Button>
        </>
      }
    >
        <SegmentedControl
          value={mode}
          onChange={onModeChange}
          options={syncModeOptions(group.kind).map((option) => ({
            value: option.id,
            label: option.label
          }))}
          className="mb-3"
        />
        <div className="cap-sync-provider-grid">
          {providerOptions.map((providerId) => {
            const provider = PROVIDER_DEFS[providerId]
            return (
              <label key={providerId} className={targets.includes(providerId) ? 'selected' : ''}>
                <input
                  type="checkbox"
                  checked={targets.includes(providerId)}
                  onChange={() => toggleTarget(providerId)}
                />
                {provider && <ProviderIcon providerId={provider.id} size={14} color={provider.color} />}
                <span>{provider?.name ?? providerId}</span>
              </label>
            )
          })}
        </div>

        <section className="cap-sync-plan">
          <div className="cap-sync-plan-header">
            <strong>{loading ? 'Planning...' : syncModeLabel(mode)}</strong>
            {plan && <span>{plan.operations.length} operation{plan.operations.length === 1 ? '' : 's'}</span>}
          </div>

          {blockers.map((blocker) => (
            <div key={blocker} className="cap-sync-message blocker">{blocker}</div>
          ))}
          {warnings.map((warning) => (
            <div key={warning} className="cap-sync-message warning">{warning}</div>
          ))}

          {plan && plan.operations.length > 0 ? (
            <div className="cap-sync-operations">
              {plan.operations.map((operation, index) => {
                const provider = PROVIDER_DEFS[operation.providerId]
                return (
                  <article key={`${operation.providerId}:${operation.action}:${index}`} className={`cap-sync-operation risk-${operation.risk}`}>
                    <div>
                      <strong>{operation.summary}</strong>
                      <span>{provider?.name ?? operation.providerId} · {operation.action}</span>
                    </div>
                    {operation.path && <code title={operation.path}>{operation.path}</code>}
                    {operation.command && <code>{operation.command.join(' ')}</code>}
                    {operation.appServerMethod && <code>{operation.appServerMethod}</code>}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="cap-sync-empty">
              {loading ? 'Checking provider projections.' : 'No file changes are needed for the selected providers.'}
            </div>
          )}
        </section>
    </Sheet>
  )
}

function mcpConfigFromGroup(group: ResourceGroup): {
  transport: CapabilityMcpTransport
  command?: string
  args?: string[]
  url?: string
} | null {
  for (const resource of group.resources) {
    const raw = isRecord(resource.raw) ? resource.raw : null
    const config = isRecord(raw?.config) ? raw.config : null
    if (!config) continue
    const url = typeof config.url === 'string' ? config.url : undefined
    const command = typeof config.command === 'string' ? config.command : undefined
    const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === 'string') : []
    return {
      transport: url || config.type === 'http' ? 'http' : 'stdio',
      command,
      args,
      url
    }
  }
  return null
}

function syncRequest(group: ResourceGroup, workDir: string, targets: string[], mode: CapabilitySyncMode): CapabilitySyncRequest {
  return {
    resources: group.resources,
    workDir,
    scope: syncScopeFromGroup(group),
    targetProviders: targets,
    mode
  }
}

function syncScopeFromGroup(group: ResourceGroup): CapabilitySyncRequest['scope'] {
  return group.resources.some((resource) => resource.scope === 'project' || resource.scope === 'workspace')
    ? 'project'
    : 'global'
}

function defaultSyncTargets(group: ResourceGroup): string[] {
  const providers = syncProviderOptions(group.kind)
  const present = new Set(group.resources.map((resource) => resource.providerId))
  const missing = providers.filter((providerId) => !present.has(providerId))
  return missing.length > 0 ? missing : providers
}

function syncProviderOptions(kind: ProviderResourceKind): string[] {
  if (kind === 'mcp_server') return ['claude', 'codex', 'cursor', 'copilot']
  if (kind === 'skill' || kind === 'command' || kind === 'plugin') return ['claude', 'codex']
  return ['claude', 'codex']
}

function syncModeOptions(kind: ProviderResourceKind): Array<{ id: CapabilitySyncMode; label: string }> {
  const options: Array<{ id: CapabilitySyncMode; label: string }> = [
    { id: 'backfill-missing-providers', label: 'Backfill' },
    { id: 'sync-selected-providers', label: 'Overwrite selected' }
  ]
  if (kind === 'plugin') {
    options.push({ id: 'import-as-portable-copy', label: 'Portable copy' })
    options.push({ id: 'install-native', label: 'Native install' })
  }
  return options
}

function syncModeLabel(mode: CapabilitySyncMode): string {
  if (mode === 'backfill-missing-providers') return 'Backfill missing provider projections'
  if (mode === 'sync-selected-providers') return 'Sync selected provider projections'
  if (mode === 'import-as-portable-copy') return 'Import as portable Orchestrator package'
  if (mode === 'install-native') return 'Native provider install plan'
  return 'Provider projection removal plan'
}

function syncableKind(kind: ProviderResourceKind): boolean {
  return kind === 'skill' || kind === 'command' || kind === 'plugin' || kind === 'mcp_server' || kind === 'agent' || kind === 'hook' || kind === 'rule' || kind === 'app'
}

function filterGroups(groups: ResourceGroup[], query: string, providerFilter: string): ResourceGroup[] {
  const q = query.trim().toLowerCase()
  return groups.filter((group) => {
    const providerMatch = providerFilter === 'all' || group.resources.some((resource) => resource.providerId === providerFilter)
    const queryMatch = !q || [group.name, group.description, resourceKindLabel(group.kind), scopeSummary(group)]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .some((value) => value.toLowerCase().includes(q))
    return providerMatch && queryMatch
  })
}

function mergeResourceGroups(resources: ProviderResource[]): ResourceGroup[] {
  const groups = new Map<string, ResourceGroup>()
  for (const resource of resources) {
    const current = groups.get(resource.fingerprint)
    if (!current) {
      groups.set(resource.fingerprint, {
        fingerprint: resource.fingerprint,
        kind: resource.kind,
        name: resource.name,
        description: resource.description,
        status: resource.status,
        resources: [resource]
      })
      continue
    }
    current.resources.push(resource)
    current.description = current.description ?? resource.description
    current.status = mergeResourceStatus(current.status, resource.status)
  }
  return [...groups.values()].sort((a, b) => {
    const kindCompare = resourceKindLabel(a.kind).localeCompare(resourceKindLabel(b.kind))
    if (kindCompare !== 0) return kindCompare
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function mergeResourceStatus(a: ProviderResource['status'], b: ProviderResource['status']): ProviderResource['status'] {
  const rank: ProviderResource['status'][] = ['enabled', 'available', 'unknown', 'disabled', 'missing', 'error']
  return rank.indexOf(a) <= rank.indexOf(b) ? a : b
}

function providerCoverageLabel(group: ResourceGroup): string | null {
  if (!syncableKind(group.kind)) return null
  const expected = syncProviderOptions(group.kind)
  const providers = new Set(group.resources.map((resource) => resource.providerId))
  const missing = expected.filter((providerId) => !providers.has(providerId))
  if (missing.length === 0) {
    const names = expected.map((providerId) => shortProviderName(providerId))
    return group.kind === 'plugin' ? `${names.join(' + ')} package` : names.join(' + ')
  }
  if (providers.size === 1) {
    const providerId = [...providers][0]
    return `${shortProviderName(providerId)} only`
  }
  return `Missing ${missing.map((providerId) => shortProviderName(providerId)).join(', ')}`
}

function shortProviderName(providerId: string): string {
  if (providerId === 'claude') return 'Claude'
  if (providerId === 'codex') return 'Codex'
  if (providerId === 'cursor') return 'Cursor'
  if (providerId === 'copilot') return 'Copilot'
  return PROVIDER_DEFS[providerId]?.name ?? providerId
}

function scopeSummary(group: ResourceGroup): string {
  const scopes = Array.from(new Set(group.resources.map((resource) => resource.scope)))
  if (scopes.length === 1) return scopeLabel(scopes[0])
  if (scopes.includes('global') && scopes.includes('project')) return 'Global + project'
  return scopes.map(scopeLabel).join(', ')
}

function scopeLabel(scope: ProviderResource['scope']): string {
  if (scope === 'global') return 'Global'
  if (scope === 'project') return 'Project'
  if (scope === 'workspace') return 'Workspace'
  if (scope === 'session') return 'Session'
  return 'Provider'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function resourceStatusTone(status: ProviderResource['status']): string {
  if (status === 'enabled' || status === 'available') return 'var(--state-success)'
  if (status === 'disabled' || status === 'unknown') return 'var(--text-tertiary)'
  return 'var(--state-danger)'
}

function statusTone(status: ProviderResource['status']): 'success' | 'neutral' | 'danger' {
  if (status === 'enabled' || status === 'available') return 'success'
  if (status === 'disabled' || status === 'unknown') return 'neutral'
  return 'danger'
}

function resourceKindLabel(kind: ProviderResourceKind): string {
  const labels: Record<ProviderResourceKind, string> = {
    skill: 'Skills',
    plugin: 'Plugins',
    app: 'Apps',
    mcp_server: 'MCP Servers',
    mcp_tool: 'MCP Tools',
    agent: 'Agents',
    hook: 'Hooks',
    rule: 'Instructions',
    command: 'Commands'
  }
  return labels[kind]
}

function createLabel(kind: CapabilityCreateKind): string {
  if (kind === 'mcp_server') return 'MCP server'
  return kind[0].toUpperCase() + kind.slice(1)
}
