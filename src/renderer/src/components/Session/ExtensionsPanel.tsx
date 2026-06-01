import { useEffect, useState } from 'react'
import { PROVIDER_DEFS } from '../../types'
import Icon from '../shared/Icon'
import ProviderIcon from '../shared/ProviderIcon'
import {
  Badge,
  Button,
  DisclosureSection,
  IconButton,
  InspectorCard,
  MetricPill as SystemMetricPill,
  SurfaceRow,
} from '../shared/designSystem'

const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')
const EXTENSION_DIVIDER = '1px solid color-mix(in srgb, var(--border-subtle) 34%, transparent)'
const EXTENSION_ROW_BORDER = '1px solid color-mix(in srgb, var(--border-subtle) 38%, transparent)'
const EXTENSION_PANEL_BG = 'color-mix(in srgb, var(--surface-bg) 82%, transparent)'
const EXTENSION_CONTENT_BG = 'color-mix(in srgb, var(--canvas-bg) 78%, transparent)'
const EXTENSION_CONTROL_BG = 'color-mix(in srgb, var(--control-bg) 62%, transparent)'
const EXTENSION_EDITOR_BG = 'color-mix(in srgb, var(--color-surface2) 70%, transparent)'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SkillFile {
  path: string
  label: string
  content: string | null
  dirty: boolean
  saving: boolean
}

interface CommandsDir {
  path: string
  label: string
  files: string[] | null  // null = dir doesn't exist
}

interface McpServer {
  type?: string
  command?: string
  url?: string
  args?: string[]
}

type CodexExtensionSurfaceId =
  | 'appserver-mcp-status'
  | 'appserver-apps'
  | 'appserver-plugins'
  | 'appserver-skills'
  | 'appserver-hooks'
  | 'appserver-external-agent-config'

interface CodexExtensionSurface {
  id: CodexExtensionSurfaceId
  label: string
  description: string
}

interface ExtensionItem {
  id: string
  title: string
  subtitle?: string
  meta?: string
  tone?: string
}

interface ExtensionGroup {
  id: CodexExtensionSurfaceId
  label: string
  description: string
  status: 'idle' | 'ok' | 'error'
  items: ExtensionItem[]
  error?: string
}

interface AgentSection {
  providerId: string
  files: SkillFile[]
  dirs: CommandsDir[]
  mcpServers?: Record<string, McpServer>
}

const CODEX_EXTENSION_SURFACES: CodexExtensionSurface[] = [
  {
    id: 'appserver-mcp-status',
    label: 'MCP',
    description: 'Connected tool servers available in this workspace.'
  },
  {
    id: 'appserver-apps',
    label: 'Apps',
    description: 'Installed app connectors exposed to the agent.'
  },
  {
    id: 'appserver-plugins',
    label: 'Plugins',
    description: 'Plugin bundles and packaged capabilities.'
  },
  {
    id: 'appserver-skills',
    label: 'Skills',
    description: 'Skill instructions available for this workspace.'
  },
  {
    id: 'appserver-hooks',
    label: 'Hooks',
    description: 'Configured extension hooks.'
  },
  {
    id: 'appserver-external-agent-config',
    label: 'Agent Config',
    description: 'Agent instruction files detected for this workspace.'
  }
]

interface Props {
  provider: string
  workDir: string
  onClose?: () => void
  embedded?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ExtensionsPanel({ provider, workDir, onClose, embedded = false }: Props): JSX.Element {
  const [sections, setSections] = useState<AgentSection[]>([])
  const [selectedDir, setSelectedDir] = useState<{ dirPath: string; fileName: string } | null>(null)
  const [dirFileContent, setDirFileContent] = useState<string | null>(null)
  const [dirFileDirty, setDirFileDirty] = useState(false)
  const [dirFileSaving, setDirFileSaving] = useState(false)
  const [extensionGroups, setExtensionGroups] = useState<ExtensionGroup[]>(
    CODEX_EXTENSION_SURFACES.map((surface) => ({
      ...surface,
      status: 'idle',
      items: []
    }))
  )
  const [extensionsLoading, setExtensionsLoading] = useState(false)

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      const read = (p: string): Promise<string | null> => window.api.fs.readFile(p)
      const listDir = (p: string): Promise<string[] | null> => window.api.fs.listDir(p)
      const makeFile = (path: string, label: string, content: string | null): SkillFile => ({
        path, label, content, dirty: false, saving: false
      })
      const claudeSkillEntries = async (dirPath: string, entries: string[] | null): Promise<string[] | null> => {
        if (entries === null) return null
        const nestedSkillFiles = await Promise.all(
          entries.map(async (name) => {
            if (name.endsWith('.md') || name.endsWith('.mdc')) return name
            const skillPath = join(dirPath, name, 'SKILL.md')
            const content = await read(skillPath)
            return content !== null ? join(name, 'SKILL.md') : null
          })
        )
        return nestedSkillFiles.filter((entry): entry is string => Boolean(entry)).sort((a, b) => a.localeCompare(b))
      }

      let section: AgentSection

      if (provider === 'claude') {
        const projectClaudeMd = join(workDir, 'CLAUDE.md')
        const projectClaudeMdAlt = join(workDir, '.claude', 'CLAUDE.md')
        const [globalContent, projectContent, globalCmds, projectCmds, globalSkillsRaw, projectSkillsRaw, settingsContent] = await Promise.all([
          read(join(home, '.claude', 'CLAUDE.md')),
          read(projectClaudeMd),
          listDir(join(home, '.claude', 'commands')),
          listDir(join(workDir, '.claude', 'commands')),
          listDir(join(home, '.claude', 'skills')),
          listDir(join(workDir, '.claude', 'skills')),
          read(join(home, '.claude', 'settings.json')),
        ])
        const projectPath = projectContent !== null ? projectClaudeMd : projectClaudeMdAlt
        const projectFinal = projectContent !== null ? projectContent : await read(projectClaudeMdAlt)
        const [globalSkills, projectSkills] = await Promise.all([
          claudeSkillEntries(join(home, '.claude', 'skills'), globalSkillsRaw),
          claudeSkillEntries(join(workDir, '.claude', 'skills'), projectSkillsRaw)
        ])

        let mcpServers: AgentSection['mcpServers']
        if (settingsContent) {
          try {
            const parsed = JSON.parse(settingsContent)
            if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
              mcpServers = parsed.mcpServers as Record<string, McpServer>
            }
          } catch { /* no mcpServers */ }
        }

        section = {
          providerId: 'claude',
          files: [
            makeFile(join(home, '.claude', 'CLAUDE.md'), 'Global CLAUDE.md', globalContent),
            makeFile(projectPath, 'Project CLAUDE.md', projectFinal),
          ],
          dirs: [
            { path: join(home, '.claude', 'commands'), label: 'Global commands', files: globalCmds },
            { path: join(workDir, '.claude', 'commands'), label: 'Project commands', files: projectCmds },
            { path: join(home, '.claude', 'skills'), label: 'Global skills', files: globalSkills },
            { path: join(workDir, '.claude', 'skills'), label: 'Project skills', files: projectSkills },
          ],
          mcpServers
        }

      } else if (provider === 'copilot') {
        const [copilotContent, agentsMd] = await Promise.all([
          read(join(workDir, '.github', 'copilot-instructions.md')),
          read(join(workDir, 'AGENTS.md')),
        ])
        section = {
          providerId: 'copilot',
          files: [
            makeFile(join(workDir, '.github', 'copilot-instructions.md'), 'copilot-instructions.md', copilotContent),
            makeFile(join(workDir, 'AGENTS.md'), 'AGENTS.md', agentsMd),
          ],
          dirs: []
        }

      } else if (provider === 'cursor') {
        const [cursorrules, cursorRulesDir] = await Promise.all([
          read(join(workDir, '.cursorrules')),
          listDir(join(workDir, '.cursor', 'rules')),
        ])
        section = {
          providerId: 'cursor',
          files: [
            makeFile(join(workDir, '.cursorrules'), '.cursorrules', cursorrules),
          ],
          dirs: [
            { path: join(workDir, '.cursor', 'rules'), label: '.cursor/rules/', files: cursorRulesDir }
          ]
        }

      } else {
        // codex
        const [agentsMd, skillsDirs] = await Promise.all([
          read(join(workDir, 'AGENTS.md')),
          listDir(join(home, '.codex', 'skills')),
        ])

        const skillFiles: SkillFile[] = []
        if (skillsDirs) {
          const skillContents = await Promise.all(
            skillsDirs.map((dir) => read(join(home, '.codex', 'skills', dir, 'SKILL.md')))
          )
          skillsDirs.forEach((dir, i) => {
            if (skillContents[i] !== null) {
              skillFiles.push(makeFile(
                join(home, '.codex', 'skills', dir, 'SKILL.md'),
                `skills/${dir}`,
                skillContents[i]
              ))
            }
          })
        }

        section = {
          providerId: 'codex',
          files: [
            makeFile(join(workDir, 'AGENTS.md'), 'AGENTS.md', agentsMd),
            ...skillFiles
          ],
          dirs: []
        }
      }

      setSections([section])
    }
    load()
  }, [workDir, provider])

  const refreshCodexExtensions = async (): Promise<void> => {
    if (provider !== 'codex') return
    setExtensionsLoading(true)
    setExtensionGroups(CODEX_EXTENSION_SURFACES.map((surface) => ({
      ...surface,
      status: 'idle',
      items: []
    })))
    const nextGroups = await Promise.all(
      CODEX_EXTENSION_SURFACES.map(async (surface) => {
        try {
          const result = await window.api.providers.runCommandSurface('codex', surface.id)
          if (result.status !== 'ok') {
            return {
              ...surface,
              status: 'error' as const,
              items: [],
              error: summarizeOutput(result.output)
            }
          }
          return {
            ...surface,
            status: 'ok' as const,
            items: codexExtensionItems(surface.id, result.output)
          }
        } catch (error) {
          return {
            ...surface,
            status: 'error' as const,
            items: [],
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })
    )
    setExtensionGroups(nextGroups)
    setExtensionsLoading(false)
  }

  useEffect(() => {
    if (provider === 'codex') void refreshCodexExtensions()
  }, [provider])

  const updateFile = (sectionIdx: number, fileIdx: number, value: string): void => {
    setSections((prev) => prev.map((s, si) =>
      si !== sectionIdx ? s : {
        ...s,
        files: s.files.map((f, fi) =>
          fi !== fileIdx ? f : { ...f, content: value, dirty: true }
        )
      }
    ))
  }

  const saveFile = async (sectionIdx: number, fileIdx: number): Promise<void> => {
    const file = sections[sectionIdx]?.files[fileIdx]
    if (!file) return
    setSections((prev) => prev.map((s, si) =>
      si !== sectionIdx ? s : {
        ...s,
        files: s.files.map((f, fi) => fi !== fileIdx ? f : { ...f, saving: true })
      }
    ))
    await window.api.fs.writeFile(file.path, file.content ?? '')
    setSections((prev) => prev.map((s, si) =>
      si !== sectionIdx ? s : {
        ...s,
        files: s.files.map((f, fi) => fi !== fileIdx ? f : { ...f, dirty: false, saving: false })
      }
    ))
  }

  const openDirFile = async (dirPath: string, fileName: string): Promise<void> => {
    const path = join(dirPath, fileName)
    const content = await window.api.fs.readFile(path)
    setSelectedDir({ dirPath, fileName })
    setDirFileContent(content ?? '')
    setDirFileDirty(false)
  }

  const saveDirFile = async (): Promise<void> => {
    if (!selectedDir) return
    setDirFileSaving(true)
    await window.api.fs.writeFile(join(selectedDir.dirPath, selectedDir.fileName), dirFileContent ?? '')
    setDirFileSaving(false)
    setDirFileDirty(false)
  }

  const providerDef = PROVIDER_DEFS[provider] ?? PROVIDER_DEFS.claude

  return (
    <div
      className="flex flex-col shrink-0 min-w-0 overflow-hidden"
      style={{
        width: embedded ? '100%' : 360,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        borderLeft: embedded ? 'none' : EXTENSION_DIVIDER,
        background: EXTENSION_PANEL_BG
      }}
    >
      {!embedded && (
        <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: EXTENSION_DIVIDER, background: EXTENSION_PANEL_BG }}>
          <ProviderIcon providerId={provider} size={12} color={providerDef.color} />
          <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
            {providerDef.name} Extensions
          </span>
          {onClose && (
            <IconButton icon="close" label="Close extensions" onClick={onClose} size="sm" />
          )}
        </div>
      )}

      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden" style={{ background: EXTENSION_CONTENT_BG }}>
        {provider === 'codex' && (
          <CodexExtensionsView
            groups={extensionGroups}
            loading={extensionsLoading}
            accentColor={providerDef.color}
            onRefresh={refreshCodexExtensions}
            embedded={embedded}
          />
        )}

        {/* Dir file editor (inline at top when a command file is open) */}
        {selectedDir && (
          <div style={{ borderBottom: EXTENSION_DIVIDER, background: EXTENSION_PANEL_BG }}>
            <div className="flex items-center justify-between px-4 py-2">
              <div className="flex items-center gap-1.5">
                <IconButton icon="chevronDown" label="Back" onClick={() => setSelectedDir(null)} size="sm" style={{ transform: 'rotate(90deg)' }} />
                <span className="text-xs font-mono" style={{ color: 'var(--color-text)', fontSize: 11 }}>
                  {selectedDir.fileName}
                </span>
              </div>
              <Button
                onClick={saveDirFile}
                disabled={!dirFileDirty || dirFileSaving}
                variant={dirFileDirty ? 'primary' : 'secondary'}
                className="px-2 py-0.5"
              >
                {dirFileSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <textarea
              value={dirFileContent ?? ''}
              onChange={(e) => { setDirFileContent(e.target.value); setDirFileDirty(true) }}
              className="w-full font-mono text-xs resize-none"
              rows={10}
              style={{
                background: EXTENSION_EDITOR_BG,
                border: 'none',
                borderTop: EXTENSION_DIVIDER,
                color: 'var(--color-text)',
                padding: '8px 16px',
                outline: 'none',
                lineHeight: 1.5
              }}
            />
          </div>
        )}

        {sections.map((section, si) => (
          <AgentSectionView
            key={section.providerId}
            section={section}
            embedded={embedded}
            onUpdateFile={(fi, v) => updateFile(si, fi, v)}
            onSaveFile={(fi) => saveFile(si, fi)}
            onOpenDirFile={openDirFile}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Codex app-server extensions ─────────────────────────────────────────────

function CodexExtensionsView({
  groups,
  loading,
  accentColor,
  onRefresh,
  embedded = false
}: {
  groups: ExtensionGroup[]
  loading: boolean
  accentColor: string
  onRefresh: () => void
  embedded?: boolean
}): JSX.Element {
  const totalItems = groups.reduce((count, group) => count + group.items.length, 0)
  const errorCount = groups.filter((group) => group.status === 'error').length

  return (
    <div style={{ borderBottom: EXTENSION_DIVIDER }}>
      <div className={embedded ? 'px-3 py-2' : 'px-4 py-3'}>
        <div className="flex items-center justify-between gap-3">
          {!embedded && (
            <div className="min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Native Extensions
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                MCP, apps, plugins, skills, hooks, and agent config in one place.
              </div>
            </div>
          )}
          {embedded && (
            <div
              className="extensions-panel-summary"
              data-testid="extensions-panel-summary"
              data-extension-summary-surface="shared"
            >
              <span>Extensions</span>
              <strong>{groups.length}</strong>
              <span>{loading ? 'loading' : `${totalItems} items`}</span>
              {errorCount > 0 && <span className="extensions-panel-summary-error">{errorCount} errors</span>}
            </div>
          )}
          <IconButton icon="refresh" label="Refresh extensions" onClick={onRefresh} disabled={loading} tone="accent" />
        </div>

        {!embedded && (
          <div className="mt-3 grid grid-cols-3 gap-1.5" data-extension-metrics-surface="shared">
            <SystemMetricPill><span>Groups</span><strong>{groups.length}</strong></SystemMetricPill>
            <SystemMetricPill><span>Items</span><strong>{loading ? '...' : totalItems}</strong></SystemMetricPill>
            <SystemMetricPill tone="danger"><span>Errors</span><strong>{errorCount}</strong></SystemMetricPill>
          </div>
        )}
      </div>

      <div className={`${embedded ? 'px-3' : 'px-4'} pb-3 grid grid-cols-1 gap-2`}>
        {groups.map((group) => (
          <ExtensionGroupCard
            key={group.id}
            group={group}
            loading={loading && group.status === 'idle'}
            accentColor={accentColor}
            embedded={embedded}
          />
        ))}
      </div>
    </div>
  )
}

function ExtensionGroupCard({
  group,
  loading,
  accentColor,
  embedded = false
}: {
  group: ExtensionGroup
  loading: boolean
  accentColor: string
  embedded?: boolean
}): JSX.Element {
  const statusText = loading
    ? 'loading'
    : group.status === 'error'
      ? 'error'
      : group.items.length === 0
        ? 'empty'
        : `${group.items.length}`

  const title = (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 7,
          height: 7,
          background: group.status === 'error' ? 'var(--state-danger)' : accentColor,
          opacity: loading || group.items.length === 0 ? 0.55 : 1
        }}
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{group.label}</span>
        {!embedded && (
          <span className="block truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>{group.description}</span>
        )}
      </span>
    </span>
  )

  return (
    <div data-extension-disclosure-surface="shared">
      <InspectorCard className="extension-panel-card overflow-hidden p-2">
        <DisclosureSection
          title={title}
          defaultOpen={embedded ? group.status === 'error' : true}
          meta={<Badge tone={group.status === 'error' ? 'danger' : 'neutral'}>{statusText}</Badge>}
          bodyClassName="pt-2"
        >
          {group.error ? (
            <div className="rounded-md px-2 py-1.5 text-xs" style={{ color: 'var(--state-danger)', background: EXTENSION_CONTROL_BG, border: EXTENSION_ROW_BORDER, fontSize: 11 }}>
              {group.error}
            </div>
          ) : group.items.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
              {loading ? 'Loading...' : 'No entries reported by Codex.'}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {group.items.map((item, index) => (
                <SurfaceRow
                  key={item.id}
                  index={index}
                  data-extension-item-row-surface="shared"
                  className="items-start gap-2 rounded-md px-2.5 py-2"
                  style={{ background: EXTENSION_CONTROL_BG, border: EXTENSION_ROW_BORDER }}
                >
                  <span className="mt-1 shrink-0 rounded-full" style={{ width: 6, height: 6, background: item.tone ?? accentColor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {item.title}
                    </span>
                    {item.subtitle && (
                      <span className="mt-0.5 block text-[10px]" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  {item.meta && <Badge tone={item.tone?.includes('EF4444') ? 'danger' : 'neutral'}>{item.meta}</Badge>}
                </SurfaceRow>
              ))}
            </div>
          )}
        </DisclosureSection>
      </InspectorCard>
    </div>
  )
}

function codexExtensionItems(surfaceId: CodexExtensionSurfaceId, output: string): ExtensionItem[] {
  const value = parseJsonOutput(output)
  const data = appServerDataArray(value)
  const record = objectValue(value)
  const source = data.length > 0
    ? data
    : arrayValue(
      record?.plugins ??
      record?.apps ??
      record?.skills ??
      record?.hooks ??
      record?.servers ??
      record?.configs ??
      record?.configFiles ??
      record?.files
    )

  if (surfaceId === 'appserver-external-agent-config' && source.length === 0 && record) {
    return Object.entries(record)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .slice(0, 16)
      .map(([key, entry]) => ({
        id: key,
        title: formatObjectKey(key),
        subtitle: compactScalar(entry),
        tone: 'var(--color-accent)'
      }))
  }

  return source.slice(0, 40).map((entry, index) => {
    const item = objectValue(entry)
    const title = compactScalar(
      item?.name ??
      item?.title ??
      item?.id ??
      item?.server ??
      item?.path ??
      item?.pluginId ??
      item?.appId ??
      item?.skillId ??
      `Item ${index + 1}`
    )
    const subtitle = compactScalar(
      item?.description ??
      item?.summary ??
      item?.provider ??
      item?.source ??
      item?.command ??
      item?.cwd ??
      item?.path ??
      entry
    )
    const meta = compactScalar(item?.status ?? item?.state ?? item?.availability ?? item?.kind ?? item?.type)
    const isBad = /error|failed|disabled|unavailable/i.test(meta)
    const isGood = /ready|ok|enabled|available|active|installed/i.test(meta)
    return {
      id: compactScalar(item?.id ?? item?.name ?? item?.path ?? index),
      title,
      subtitle: subtitle && subtitle !== title ? subtitle : undefined,
      meta: meta && meta !== title ? meta : undefined,
      tone: isBad ? '#EF4444' : isGood ? 'var(--color-green)' : undefined
    }
  })
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim()
  if (!trimmed) return []
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
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

function summarizeOutput(output: string): string {
  const summary = compactScalar(parseJsonOutput(output))
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary || 'Unable to load this extension group.'
}

function formatObjectKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

// ─── Agent section ───────────────────────────────────────────────────────────

function AgentSectionView({
  section, embedded = false, onUpdateFile, onSaveFile, onOpenDirFile
}: {
  section: AgentSection
  embedded?: boolean
  onUpdateFile: (fi: number, v: string) => void
  onSaveFile: (fi: number) => void
  onOpenDirFile: (dirPath: string, fileName: string) => void
}): JSX.Element {
  const def = PROVIDER_DEFS[section.providerId]
  const [actionStatus, setActionStatus] = useState<string | null>(null)
  const addInstructionsToChat = (): void => {
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: extensionInstructionSummary(section) }
    }))
    setActionStatus('Extension instructions added to chat')
  }

  return (
    <div>
      <div
        className={embedded ? 'extensions-panel-section-heading justify-between gap-2 px-3' : 'px-4 py-3'}
        data-extension-summary-surface={embedded ? 'shared' : undefined}
        style={{ borderTop: EXTENSION_DIVIDER, borderBottom: EXTENSION_DIVIDER, background: EXTENSION_PANEL_BG }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
          {embedded ? 'Instructions' : 'Local Instructions'}
        </div>
        {embedded && (
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="extensions-panel-summary extensions-panel-local-summary">
              <strong>{section.files.length + section.dirs.length + (section.mcpServers ? 1 : 0)}</strong>
              <span>sources</span>
            </div>
            <IconButton
              icon="chat"
              label="Add extension instructions to chat"
              size="xs"
              variant="ghost"
              dataTestId="extensions-add-instructions-chat"
              onClick={addInstructionsToChat}
            />
          </div>
        )}
        {!embedded && (
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
              Files and folders this provider reads from the workspace or home directory.
            </div>
            <IconButton
              icon="chat"
              label="Add extension instructions to chat"
              size="xs"
              variant="ghost"
              dataTestId="extensions-add-instructions-chat"
              onClick={addInstructionsToChat}
            />
          </div>
        )}
      </div>
      {actionStatus && (
        <div
          className={embedded ? 'mx-3 mt-2 rounded-md px-2 py-1 text-[11px]' : 'mx-4 mt-2 rounded-md px-2 py-1 text-[11px]'}
          data-testid="extensions-action-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            color: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-bg))',
            border: EXTENSION_ROW_BORDER
          }}
        >
          {actionStatus}
        </div>
      )}
      {section.files.map((file, fi) => (
        <FileEditor
          key={file.path}
          file={file}
          embedded={embedded}
          accentColor={def?.color}
          onUpdate={(v) => onUpdateFile(fi, v)}
          onSave={() => onSaveFile(fi)}
        />
      ))}
      {section.dirs.map((dir) => (
        <CommandsDirView
          key={dir.path}
          dir={dir}
          embedded={embedded}
          onOpenFile={(name) => onOpenDirFile(dir.path, name)}
        />
      ))}
      {section.mcpServers && (
        <McpServersView servers={section.mcpServers} accentColor={def?.color} embedded={embedded} />
      )}
    </div>
  )
}

function extensionInstructionSummary(section: AgentSection): string {
  const files = section.files.map((file) => {
    const state = file.content === null ? 'missing' : file.dirty ? 'edited' : 'loaded'
    const content = file.content?.trim()
    const excerpt = content ? boundedText(content, 900) : null
    return [
      `- ${file.label}`,
      `  Path: ${file.path}`,
      `  State: ${state}`,
      ...(excerpt ? ['  Excerpt:', indentBlock(excerpt, '    ')] : [])
    ].join('\n')
  })
  const dirs = section.dirs.map((dir) => {
    const count = dir.files?.length ?? 0
    const names = dir.files?.slice(0, 8).join(', ')
    return `- ${dir.label}: ${dir.path} (${dir.files === null ? 'not found' : `${count} entries${names ? `: ${names}` : ''}`})`
  })
  const mcpServers = section.mcpServers
    ? Object.entries(section.mcpServers).slice(0, 8).map(([name, server]) => {
        const command = [server.command ?? server.url ?? server.type ?? 'server', ...(server.args ?? [])].join(' ')
        return `- ${name}: ${command}`
      })
    : []

  return [
    'Use this extension instruction context:',
    `Provider: ${section.providerId}`,
    '',
    'Instruction files:',
    ...(files.length > 0 ? files : ['- None']),
    '',
    'Command / skill directories:',
    ...(dirs.length > 0 ? dirs : ['- None']),
    ...(mcpServers.length > 0 ? ['', 'MCP servers:', ...mcpServers] : [])
  ].join('\n')
}

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`
}

function indentBlock(value: string, prefix: string): string {
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n')
}

// ─── MCP servers (read-only) ──────────────────────────────────────────────────

function McpServersView({ servers, accentColor, embedded = false }: {
  servers: Record<string, McpServer>
  accentColor?: string
  embedded?: boolean
}): JSX.Element {
  const entries = Object.entries(servers)

  return (
    <div
      data-testid={embedded ? 'extensions-embedded-entry' : undefined}
      data-extension-disclosure-surface="shared"
      className={embedded ? 'extensions-panel-embedded-entry px-2 py-0' : 'px-4 py-3'}
      style={{ borderTop: EXTENSION_DIVIDER }}
    >
      <InspectorCard className={embedded ? 'extension-panel-card p-0' : 'p-2'}>
        <DisclosureSection
          title={<span className={embedded ? 'extensions-panel-entry-title font-mono' : 'font-mono'}>MCP servers</span>}
          defaultOpen={!embedded}
          meta={<Badge className={embedded ? 'extensions-panel-entry-badge' : ''}>{entries.length === 0 ? 'none' : entries.length}</Badge>}
          bodyClassName={embedded ? 'pt-1 pb-1' : 'pt-2'}
        >
          {entries.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
              No MCP servers configured.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {entries.map(([name, srv], index) => {
                const cmd = srv.command ?? srv.url ?? srv.type ?? '-'
                const args = srv.args?.join(' ') ?? ''
                return (
                  <SurfaceRow
                    key={name}
                    index={index}
                    data-extension-item-row-surface="shared"
                    className={embedded ? 'items-start gap-2 rounded-md px-2 py-1.5' : 'items-start gap-2 rounded-md px-2.5 py-2'}
                    style={{ background: EXTENSION_CONTROL_BG, border: EXTENSION_ROW_BORDER }}
                  >
                    <span className="mt-1 shrink-0 rounded-full" style={{ width: 6, height: 6, background: accentColor ?? 'var(--accent)' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{name}</span>
                      <span className="block truncate font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        {cmd}{args ? ` ${args}` : ''}
                      </span>
                    </span>
                    {srv.type && <Badge>{srv.type}</Badge>}
                  </SurfaceRow>
                )
              })}
            </div>
          )}
        </DisclosureSection>
      </InspectorCard>
    </div>
  )
}

// ─── File editor ─────────────────────────────────────────────────────────────

function FileEditor({ file, embedded = false, accentColor, onUpdate, onSave }: {
  file: SkillFile
  embedded?: boolean
  accentColor?: string
  onUpdate: (v: string) => void
  onSave: () => void
}): JSX.Element {
  const isNew = file.content === null

  return (
    <div
      data-testid={embedded ? 'extensions-embedded-entry' : undefined}
      data-extension-file-row-surface="shared"
      data-extension-disclosure-surface="shared"
      className={embedded ? 'extensions-panel-embedded-entry px-2 py-0' : 'px-4 py-3'}
      style={{ borderTop: EXTENSION_DIVIDER }}
    >
      <InspectorCard className={embedded ? 'extension-panel-card p-0' : 'p-2'}>
        <DisclosureSection
          title={<span className={embedded ? 'extensions-panel-entry-title font-mono' : 'font-mono'} style={{ color: isNew ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{file.label}</span>}
          defaultOpen={embedded ? false : file.content !== null}
          meta={isNew ? <Badge className={embedded ? 'extensions-panel-entry-badge' : ''}>new</Badge> : undefined}
          bodyClassName={embedded ? 'pt-1 pb-1' : 'pt-2'}
        >
          {!embedded && (
            <div className="text-xs mb-1.5 truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
              {file.path}
            </div>
          )}
          <textarea
            value={file.content ?? ''}
            onChange={(e) => onUpdate(e.target.value)}
            placeholder={isNew ? '# Add instructions here\n' : ''}
            className="w-full resize-y rounded font-mono text-xs"
            data-extension-editor-surface="shared"
            rows={embedded ? 5 : 6}
            style={{
              background: EXTENSION_EDITOR_BG,
              border: file.dirty ? `1px solid ${accentColor ?? 'var(--color-accent)'}` : EXTENSION_ROW_BORDER,
              color: 'var(--color-text)',
              padding: '6px 8px',
              minHeight: embedded ? 72 : 80,
              lineHeight: 1.5,
              outline: 'none',
              userSelect: 'text'
            }}
          />
          <div className="flex justify-end mt-1.5">
            <Button
              onClick={onSave}
              disabled={!file.dirty || file.saving}
              variant={file.dirty ? 'primary' : 'secondary'}
              className={embedded ? 'px-2 py-0.5' : 'px-3 py-1'}
              style={{
                background: file.dirty ? (accentColor ?? 'var(--accent)') : undefined
              }}
            >
              {file.saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </Button>
          </div>
        </DisclosureSection>
      </InspectorCard>
    </div>
  )
}

// ─── Commands directory ───────────────────────────────────────────────────────

function CommandsDirView({ dir, embedded = false, onOpenFile }: {
  dir: CommandsDir
  embedded?: boolean
  onOpenFile: (name: string) => void
}): JSX.Element {
  const files = dir.files?.filter((f) => f.endsWith('.md') || f.endsWith('.mdc')) ?? []
  const exists = dir.files !== null

  return (
    <div
      data-testid={embedded ? 'extensions-embedded-entry' : undefined}
      data-extension-command-section-surface="shared"
      data-extension-disclosure-surface="shared"
      className={embedded ? 'extensions-panel-embedded-entry px-2 py-0' : 'px-4 py-3'}
      style={{ borderTop: EXTENSION_DIVIDER }}
    >
      <InspectorCard className={embedded ? 'extension-panel-card p-0' : 'p-2'}>
        <DisclosureSection
          title={<span className={embedded ? 'extensions-panel-entry-title font-mono' : 'font-mono'} style={{ color: exists ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{dir.label}</span>}
          meta={<Badge className={embedded ? 'extensions-panel-entry-badge' : ''}>{!exists ? 'not found' : files.length === 0 ? 'empty' : `${files.length}`}</Badge>}
          bodyClassName={embedded ? 'pt-1 pb-1' : 'pt-2'}
        >
          {files.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
              {exists ? 'No .md/.mdc files found' : 'Directory does not exist'}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {files.map((name, index) => (
                <SurfaceRow
                  as="button"
                  key={name}
                  index={index}
                  onClick={() => onOpenFile(name)}
                  data-extension-command-row-surface="shared"
                  className="flex items-center gap-2 px-2 py-1 rounded text-left w-full"
                  style={{ background: 'transparent' }}
                >
                  <span className="extensions-panel-file-icon">
                    <Icon name="file" size={11} />
                  </span>
                  <span className="text-xs font-mono" style={{ color: 'var(--color-text)', fontSize: 11 }}>{name}</span>
                </SurfaceRow>
              ))}
            </div>
          )}
        </DisclosureSection>
      </InspectorCard>
    </div>
  )
}
