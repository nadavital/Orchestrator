import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PROVIDER_DEFS,
  type CapabilityCreateKind,
  type CapabilityCreateRequest,
  type CapabilityMcpTransport,
  type CapabilityUpdateRequest,
  type ProviderResource,
  type ProviderResourceKind,
  type ProviderResourceSnapshot
} from '../types'
import { useProjectStore } from '../store/projects'
import { useSessionStore } from '../store/sessions'
import Icon from './shared/Icon'
import ProviderIcon from './shared/ProviderIcon'

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
  const [message, setMessage] = useState<string | null>(null)

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
    if (!confirm(`Remove ${group.name}? This will delete editable global capability files for this item.`)) return
    try {
      const result = await window.api.providers.deleteCapability({ resources: group.resources })
      setMessage(`Removed ${group.name}. ${result.files.length} file${result.files.length === 1 ? '' : 's'} changed.${result.warnings.length ? ` ${result.warnings[0]}` : ''}`)
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
          <button className="cap-button ghost" onClick={() => void refresh()} disabled={loading}>
            <Icon name="refresh" size={14} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <div className="cap-create-wrap">
            <button className="cap-button primary" onClick={() => setCreateMenuOpen((open) => !open)}>
              <Icon name="plus" size={14} />
              Create
            </button>
            {createMenuOpen && (
              <div className="cap-create-menu">
                <button onClick={() => openCreate('skill')}>
                  <Icon name="sparkles" size={14} />
                  <span>Skill</span>
                </button>
                <button onClick={() => openCreate('mcp_server')}>
                  <Icon name="plug" size={14} />
                  <span>MCP server</span>
                </button>
                <button onClick={() => openCreate('plugin')}>
                  <Icon name="extensions" size={14} />
                  <span>Plugin</span>
                </button>
              </div>
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
            <button onClick={openProviderSettings}>
              <Icon name="wrench" size={13} />
              {errors.length} issue{errors.length === 1 ? '' : 's'}
            </button>
          )}
        </section>

        <section className="capability-tabs" aria-label="Capability sections">
          {visibleTabs.map((nextTab) => (
              <button
                key={nextTab.id}
                className={activeTab.id === nextTab.id ? 'active' : ''}
                onClick={() => setTab(nextTab.id)}
              >
                {nextTab.label}
                <span>{tabCounts[nextTab.id]}</span>
              </button>
            ))}
        </section>

        {message && (
          <div className="capability-message">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} title="Dismiss">
              <Icon name="close" size={13} />
            </button>
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
              onRemove={(group) => void removeGroup(group)}
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
    </div>
  )
}

function CapabilityList({
  activeTab,
  groups,
  loading,
  onEdit,
  onRemove
}: {
  activeTab: CapabilityTabDef
  groups: ResourceGroup[]
  loading: boolean
  onEdit: (group: ResourceGroup) => void
  onRemove: (group: ResourceGroup) => void
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
          />
        ))}
      </div>
    </div>
  )
}

function CapabilityRow({
  group,
  onEdit,
  onRemove
}: {
  group: ResourceGroup
  onEdit: () => void
  onRemove: () => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const tone = resourceStatusTone(group.status)
  const sources = Array.from(new Set(group.resources.map((resource) => resource.source).filter(Boolean)))
  const canEdit = group.resources.some((resource) => resource.actions.includes('edit'))
  const canRemove = group.resources.some((resource) => resource.actions.includes('remove'))
  const hasActions = canEdit || canRemove
  const compatibility = pluginCompatibilityLabel(group)
  return (
    <article className="capability-row">
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
        {compatibility && <span>{compatibility}</span>}
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
      <strong className="capability-row-status" style={{ color: tone }}>{group.status}</strong>
      <div className="capability-row-actions">
        {hasActions && (
          <button
            onClick={() => setMenuOpen((open) => !open)}
            title="Capability actions"
          >
            <Icon name="ellipsis" size={14} />
          </button>
        )}
        {hasActions && menuOpen && (
          <div className="capability-row-menu">
            <button
              disabled={!canEdit}
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
            >
              <Icon name="pencil" size={13} />
              <span>Edit</span>
            </button>
            <button
              disabled={!canRemove}
              className="danger"
              onClick={() => {
                setMenuOpen(false)
                onRemove()
              }}
            >
              <Icon name="close" size={13} />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    </article>
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
    <div className="capability-sheet-backdrop">
      <section className="capability-sheet">
        <div className="capability-sheet-header">
          <div>
            <h2>Create capability</h2>
            <p>Portable where possible, provider-native where necessary.</p>
          </div>
          <button onClick={onClose} title="Close"><Icon name="close" size={15} /></button>
        </div>

        <div className="cap-segmented">
          {(['skill', 'plugin', 'mcp_server'] as CapabilityCreateKind[]).map((nextKind) => (
            <button key={nextKind} className={kind === nextKind ? 'active' : ''} onClick={() => onKindChange(nextKind)}>
              {createLabel(nextKind)}
            </button>
          ))}
        </div>

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
            <div className="cap-segmented compact">
              {(['stdio', 'http'] as CapabilityMcpTransport[]).map((transport) => (
                <button key={transport} className={mcpTransport === transport ? 'active' : ''} onClick={() => onMcpTransportChange(transport)}>
                  {transport === 'stdio' ? 'Command' : 'HTTP'}
                </button>
              ))}
            </div>
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

        <div className="capability-sheet-footer">
          <span className="capability-scope-note">Global capability</span>
          <button className="cap-button ghost" onClick={onClose}>Cancel</button>
          <button className="cap-button primary" onClick={onSubmit}>Create</button>
        </div>
      </section>
    </div>
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
    <div className="capability-sheet-backdrop">
      <section className="capability-sheet">
        <div className="capability-sheet-header">
          <div>
            <h2>Edit capability</h2>
            <p>{editable ? 'Updates global capability files that Orchestrator can safely manage.' : 'This item is provider-managed.'}</p>
          </div>
          <button onClick={onClose} title="Close"><Icon name="close" size={15} /></button>
        </div>

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
            <div className="cap-segmented compact">
              {(['stdio', 'http'] as CapabilityMcpTransport[]).map((transport) => (
                <button key={transport} className={mcpTransport === transport ? 'active' : ''} onClick={() => onMcpTransportChange(transport)} disabled={!editable}>
                  {transport === 'stdio' ? 'Command' : 'HTTP'}
                </button>
              ))}
            </div>
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

        <div className="capability-sheet-footer">
          <span className="capability-scope-note">{editable ? 'Editable global file' : 'Provider-managed'}</span>
          <button className="cap-button ghost" onClick={onClose}>Cancel</button>
          <button className="cap-button primary" onClick={onSubmit} disabled={!editable}>Save</button>
        </div>
      </section>
    </div>
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

function pluginCompatibilityLabel(group: ResourceGroup): string | null {
  if (group.kind !== 'plugin') return null
  const providers = new Set(group.resources.map((resource) => resource.providerId))
  if (providers.has('claude') && providers.has('codex')) return 'Claude + Codex package'
  if (providers.has('claude')) return 'Claude package'
  if (providers.has('codex')) return 'Codex package'
  return null
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
