import { useEffect, useState } from 'react'
import { PROVIDER_DEFS } from '../../types'
import ProviderIcon from '../shared/ProviderIcon'

const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')

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

interface AgentSection {
  providerId: string
  files: SkillFile[]
  dirs: CommandsDir[]
  mcpServers?: Record<string, McpServer>
}

interface Props {
  provider: string
  workDir: string
  onClose?: () => void
  embedded?: boolean
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SkillsPanel({ provider, workDir, onClose, embedded = false }: Props): JSX.Element {
  const [sections, setSections] = useState<AgentSection[]>([])
  const [selectedDir, setSelectedDir] = useState<{ dirPath: string; fileName: string } | null>(null)
  const [dirFileContent, setDirFileContent] = useState<string | null>(null)
  const [dirFileDirty, setDirFileDirty] = useState(false)
  const [dirFileSaving, setDirFileSaving] = useState(false)

  useEffect(() => {
    const load = async (): Promise<void> => {
      const home = await window.api.fs.resolveHome()
      const read = (p: string): Promise<string | null> => window.api.fs.readFile(p)
      const listDir = (p: string): Promise<string[] | null> => window.api.fs.listDir(p)
      const makeFile = (path: string, label: string, content: string | null): SkillFile => ({
        path, label, content, dirty: false, saving: false
      })

      let section: AgentSection

      if (provider === 'claude') {
        const projectClaudeMd = join(workDir, 'CLAUDE.md')
        const projectClaudeMdAlt = join(workDir, '.claude', 'CLAUDE.md')
        const [globalContent, projectContent, globalCmds, projectCmds, settingsContent] = await Promise.all([
          read(join(home, '.claude', 'CLAUDE.md')),
          read(projectClaudeMd),
          listDir(join(home, '.claude', 'commands')),
          listDir(join(workDir, '.claude', 'commands')),
          read(join(home, '.claude', 'settings.json')),
        ])
        const projectPath = projectContent !== null ? projectClaudeMd : projectClaudeMdAlt
        const projectFinal = projectContent !== null ? projectContent : await read(projectClaudeMdAlt)

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
      className="flex flex-col shrink-0 overflow-hidden"
      style={{
        width: embedded ? '100%' : 360,
        height: embedded ? '100%' : undefined,
        borderLeft: embedded ? 'none' : '1px solid var(--color-border)',
        background: 'var(--color-surface)'
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <ProviderIcon providerId={provider} size={12} color={providerDef.color} />
        <span className="text-xs font-semibold flex-1" style={{ color: 'var(--color-text)' }}>
          {providerDef.name} Skills
        </span>
        {onClose && (
          <button onClick={onClose} style={{ color: 'var(--color-text-muted)' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Dir file editor (inline at top when a command file is open) */}
        {selectedDir && (
          <div style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface2)' }}>
            <div className="flex items-center justify-between px-4 py-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setSelectedDir(null)}
                  style={{ color: 'var(--color-text-muted)' }}
                  title="Back"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M7.78 12.53a.75.75 0 0 1-1.06 0L2.47 8.28a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L4.81 7h7.44a.75.75 0 0 1 0 1.5H4.81l2.97 2.97a.75.75 0 0 1 0 1.06Z" />
                  </svg>
                </button>
                <span className="text-xs font-mono" style={{ color: 'var(--color-text)', fontSize: 11 }}>
                  {selectedDir.fileName}
                </span>
              </div>
              <button
                onClick={saveDirFile}
                disabled={!dirFileDirty || dirFileSaving}
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{
                  background: dirFileDirty ? 'var(--color-accent)' : 'var(--color-surface)',
                  color: dirFileDirty ? '#fff' : 'var(--color-text-muted)',
                  cursor: dirFileDirty ? 'pointer' : 'default'
                }}
              >
                {dirFileSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <textarea
              value={dirFileContent ?? ''}
              onChange={(e) => { setDirFileContent(e.target.value); setDirFileDirty(true) }}
              className="w-full font-mono text-xs resize-none"
              rows={10}
              style={{
                background: 'var(--color-surface2)',
                border: 'none',
                borderTop: '1px solid var(--color-border)',
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
            onUpdateFile={(fi, v) => updateFile(si, fi, v)}
            onSaveFile={(fi) => saveFile(si, fi)}
            onOpenDirFile={openDirFile}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Agent section ───────────────────────────────────────────────────────────

function AgentSectionView({
  section, onUpdateFile, onSaveFile, onOpenDirFile
}: {
  section: AgentSection
  onUpdateFile: (fi: number, v: string) => void
  onSaveFile: (fi: number) => void
  onOpenDirFile: (dirPath: string, fileName: string) => void
}): JSX.Element {
  const def = PROVIDER_DEFS[section.providerId]

  return (
    <div>
      {section.files.map((file, fi) => (
        <FileEditor
          key={file.path}
          file={file}
          accentColor={def?.color}
          onUpdate={(v) => onUpdateFile(fi, v)}
          onSave={() => onSaveFile(fi)}
        />
      ))}
      {section.dirs.map((dir) => (
        <CommandsDirView
          key={dir.path}
          dir={dir}
          onOpenFile={(name) => onOpenDirFile(dir.path, name)}
        />
      ))}
      {section.mcpServers && (
        <McpServersView servers={section.mcpServers} accentColor={def?.color} />
      )}
    </div>
  )
}

// ─── MCP servers (read-only) ──────────────────────────────────────────────────

function McpServersView({ servers, accentColor }: {
  servers: Record<string, McpServer>
  accentColor?: string
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const entries = Object.entries(servers)

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <button
        className="flex items-center gap-2 w-full px-4 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent' }}
      >
        <svg
          width="8" height="8" viewBox="0 0 10 10" fill="currentColor"
          style={{ opacity: 0.3, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}
        >
          <path d="M5 7 L1 3 L9 3 Z" />
        </svg>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
        </svg>
        <span className="text-xs flex-1 font-mono" style={{ color: 'var(--color-text)', fontSize: 11 }}>
          MCP servers
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          {entries.length === 0 ? 'none' : `${entries.length}`}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {entries.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
              No MCP servers configured in ~/.claude/settings.json
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {entries.map(([name, srv]) => {
                const cmd = srv.command ?? srv.url ?? srv.type ?? '—'
                const args = srv.args?.join(' ') ?? ''
                return (
                  <div
                    key={name}
                    className="rounded px-2.5 py-2"
                    style={{ background: 'var(--color-surface2)', border: '1px solid var(--color-border)' }}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div
                        className="rounded-full shrink-0"
                        style={{ width: 6, height: 6, background: accentColor ?? 'var(--color-accent)' }}
                      />
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{name}</span>
                      {srv.type && (
                        <span className="text-xs rounded px-1" style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 10 }}>
                          {srv.type}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10, paddingLeft: 14 }}>
                      {cmd}{args ? ` ${args}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── File editor ─────────────────────────────────────────────────────────────

function FileEditor({ file, accentColor, onUpdate, onSave }: {
  file: SkillFile
  accentColor?: string
  onUpdate: (v: string) => void
  onSave: () => void
}): JSX.Element {
  const [open, setOpen] = useState(file.content !== null)
  const isNew = file.content === null

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <button
        className="flex items-center gap-2 w-full px-4 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent' }}
      >
        <svg
          width="8" height="8" viewBox="0 0 10 10" fill="currentColor"
          style={{ opacity: 0.3, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}
        >
          <path d="M5 7 L1 3 L9 3 Z" />
        </svg>
        <span className="text-xs flex-1 font-mono" style={{ color: isNew ? 'var(--color-text-muted)' : 'var(--color-text)', fontSize: 11 }}>
          {file.label}
        </span>
        {isNew && (
          <span className="text-xs rounded px-1" style={{ background: 'var(--color-surface2)', color: 'var(--color-text-muted)', fontSize: 10 }}>
            new
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-3">
          <div className="text-xs mb-1.5 truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
            {file.path}
          </div>
          <textarea
            value={file.content ?? ''}
            onChange={(e) => onUpdate(e.target.value)}
            placeholder={isNew ? '# Add instructions here\n' : ''}
            className="w-full resize-y rounded font-mono text-xs"
            rows={6}
            style={{
              background: 'var(--color-surface2)',
              border: `1px solid ${file.dirty ? (accentColor ?? 'var(--color-accent)') : 'var(--color-border)'}`,
              color: 'var(--color-text)',
              padding: '6px 8px',
              minHeight: 80,
              lineHeight: 1.5,
              outline: 'none',
              userSelect: 'text'
            }}
          />
          <div className="flex justify-end mt-1.5">
            <button
              onClick={onSave}
              disabled={!file.dirty || file.saving}
              className="rounded px-3 py-1 text-xs font-medium transition-colors"
              style={{
                background: file.dirty ? (accentColor ?? 'var(--color-accent)') : 'var(--color-surface2)',
                color: file.dirty ? '#fff' : 'var(--color-text-muted)',
                cursor: file.dirty ? 'pointer' : 'default'
              }}
            >
              {file.saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Commands directory ───────────────────────────────────────────────────────

function CommandsDirView({ dir, onOpenFile }: {
  dir: CommandsDir
  onOpenFile: (name: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const files = dir.files?.filter((f) => f.endsWith('.md') || f.endsWith('.mdc')) ?? []
  const exists = dir.files !== null

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <button
        className="flex items-center gap-2 w-full px-4 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent' }}
      >
        <svg
          width="8" height="8" viewBox="0 0 10 10" fill="currentColor"
          style={{ opacity: 0.3, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}
        >
          <path d="M5 7 L1 3 L9 3 Z" />
        </svg>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
          <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
        </svg>
        <span className="text-xs flex-1 font-mono" style={{ color: exists ? 'var(--color-text)' : 'var(--color-text-muted)', fontSize: 11 }}>
          {dir.label}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
          {!exists ? 'not found' : files.length === 0 ? 'empty' : `${files.length} file${files.length !== 1 ? 's' : ''}`}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-2">
          {files.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
              {exists ? 'No .md/.mdc files found' : 'Directory does not exist'}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {files.map((name) => (
                <button
                  key={name}
                  onClick={() => onOpenFile(name)}
                  className="flex items-center gap-2 px-2 py-1 rounded text-left w-full"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
                    <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z" />
                  </svg>
                  <span className="text-xs font-mono" style={{ color: 'var(--color-text)', fontSize: 11 }}>{name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
