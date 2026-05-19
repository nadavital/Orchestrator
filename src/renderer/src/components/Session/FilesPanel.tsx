import { useEffect, useMemo, useState } from 'react'
import type { FilePreviewResult } from '../../env'
import { Badge, IconButton, MenuItem, MenuSurface, PanelHeader, SurfaceRow, ToolbarButton } from '../shared/designSystem'
import Icon from '../shared/Icon'

interface Props {
  workDir: string
  embedded?: boolean
}

interface WorkspaceFileEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
  depth: number
  size?: number
}

const MAX_WORKSPACE_ENTRIES = 360

export default function FilesPanel({ workDir, embedded = false }: Props): JSX.Element {
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([])
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<FilePreviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? entries.filter((entry) => entry.path.toLowerCase().includes(normalized))
      : entries
  }, [entries, query])
  const selectedEntry = selectedPath ? filteredEntries.find((entry) => entry.path === selectedPath) ?? null : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPreview(null)
    collectWorkspaceEntries(workDir)
      .then((nextEntries) => {
        if (cancelled) return
        setEntries(nextEntries)
        setSelectedPath(nextEntries.find((entry) => entry.kind === 'file')?.path ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workDir])

  useEffect(() => {
    if (selectedPath && !filteredEntries.some((entry) => entry.path === selectedPath)) {
      setSelectedPath(null)
    }
  }, [filteredEntries, selectedPath])

  useEffect(() => {
    if (!selectedPath || selectedEntry?.kind !== 'file') {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreview(null)
    window.api.fs.previewFile(joinPath(workDir, selectedPath))
      .then((result) => {
        if (cancelled) return
        setPreview(result)
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'unreadable', truncated: false })
      })
    return () => {
      cancelled = true
    }
  }, [selectedEntry?.kind, selectedPath, workDir])

  const openSelected = (): void => {
    if (!selectedEntry) return
    void window.api.fs.openPath(joinPath(workDir, selectedEntry.path))
  }

  const revealSelected = (): void => {
    if (!selectedEntry) return
    void window.api.fs.showInFolder(joinPath(workDir, selectedEntry.path))
  }

  const copySelected = (): void => {
    if (!selectedEntry) return
    void navigator.clipboard.writeText(selectedEntry.path)
  }

  const addSelectedToChat = (): void => {
    if (!selectedPath || selectedEntry?.kind !== 'file') return
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-attachment', {
      detail: {
        path: joinPath(workDir, selectedPath),
        name: selectedEntry.name,
        size: selectedEntry.size
      }
    }))
  }

  const fileActions = (
    <div className="relative flex items-center gap-1">
      <ToolbarButton icon="paperclip" label="Add file to chat" disabled={selectedEntry?.kind !== 'file'} onClick={addSelectedToChat} />
      <IconButton
        icon="ellipsis"
        label="File actions"
        disabled={!selectedEntry}
        active={actionMenuOpen}
        onClick={() => setActionMenuOpen((open) => !open)}
      />
      {actionMenuOpen && (
        <MenuSurface
          onClose={() => setActionMenuOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 170, zIndex: 90 }}
        >
          <MenuItem icon="copy" label="Copy path" disabled={!selectedEntry} onClick={() => { copySelected(); setActionMenuOpen(false) }} />
          <MenuItem icon="folder" label="Reveal file" disabled={!selectedEntry} onClick={() => { revealSelected(); setActionMenuOpen(false) }} />
          <MenuItem icon="file" label="Open file" disabled={!selectedEntry} onClick={() => { openSelected(); setActionMenuOpen(false) }} />
        </MenuSurface>
      )}
    </div>
  )

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      style={{
        width: embedded ? '100%' : 440,
        height: embedded ? '100%' : undefined,
        background: 'var(--surface-bg)'
      }}
    >
      {!embedded && <PanelHeader title="Files" actions={fileActions} />}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <input
          data-testid="workspace-file-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search workspace files"
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
          style={{
            background: 'var(--control-bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        />
        <Badge tone="neutral">{filteredEntries.length}</Badge>
        {embedded && fileActions}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(140px,0.42fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r" style={{ borderColor: 'var(--border-subtle)' }}>
          {loading ? (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Loading directory entries...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {query.trim() ? 'No matching files' : 'No files in this folder'}
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <SurfaceRow
                key={entry.path}
                as="button"
                active={selectedPath === entry.path}
                onClick={() => setSelectedPath(entry.path)}
                className="w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs"
                style={{ display: 'flex', paddingLeft: 8 + Math.min(entry.depth, 4) * 10 }}
              >
                <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={12} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.name}</span>
                  {entry.path !== entry.name && (
                    <span className="block truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {entry.path}
                    </span>
                  )}
                </span>
                {entry.kind === 'file' && entry.size !== undefined && (
                  <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    {formatBytes(entry.size)}
                  </span>
                )}
              </SurfaceRow>
            ))
          )}
        </div>
        <div className="min-h-0 min-w-0 overflow-auto">
          {selectedEntry?.kind === 'directory' ? (
            <EmptyFileState title={selectedEntry.path} body="Select a file to preview it." />
          ) : selectedEntry ? (
            <FilePreview
              entry={selectedEntry}
              absolutePath={joinPath(workDir, selectedEntry.path)}
              preview={preview}
            />
          ) : (
            <EmptyFileState title="Nothing selected" body="Choose a workspace file from the list." />
          )}
        </div>
      </div>
    </div>
  )
}

function FilePreview({
  entry,
  absolutePath,
  preview,
}: {
  entry: WorkspaceFileEntry
  absolutePath: string
  preview: FilePreviewResult | null
}): JSX.Element {
  if (!preview) {
    return <EmptyFileState title={entry.name} body="Loading preview..." />
  }
  if (preview.kind === 'image') {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-3" data-testid="workspace-image-preview">
        <img
          src={fileUrl(absolutePath)}
          alt={entry.name}
          className="max-h-full max-w-full rounded-md object-contain"
          style={{ border: '1px solid var(--border-subtle)' }}
        />
      </div>
    )
  }
  if (preview.kind === 'pdf') {
    return (
      <iframe
        title={entry.name}
        src={fileUrl(absolutePath)}
        className="h-full w-full border-0"
        data-testid="workspace-pdf-preview"
      />
    )
  }
  if (preview.kind === 'audio') {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-4 text-center">
        <Icon name="file" size={26} />
        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{entry.name}</div>
        <audio controls src={fileUrl(absolutePath)} className="w-full max-w-[360px]" data-testid="workspace-audio-preview" />
      </div>
    )
  }
  if (preview.kind === 'video') {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-3">
        <video controls src={fileUrl(absolutePath)} className="max-h-full max-w-full rounded-md" data-testid="workspace-video-preview" />
      </div>
    )
  }
  if (preview.kind === 'binary') {
    return <EmptyFileState title={entry.name} body="Binary file preview unavailable. Use Open file or Reveal file to inspect it." />
  }
  if (preview.kind === 'missing') {
    return <EmptyFileState title={entry.name} body="This file is no longer available in the workspace." />
  }
  if (preview.kind === 'unreadable') {
    return <EmptyFileState title={entry.name} body="Unable to load this file. Use Open file or Reveal file to inspect it." />
  }
  return (
    <div className="min-h-full">
      {preview.truncated && (
        <div
          className="px-3 py-2 text-[11px]"
          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          Preview limited to the first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      <pre
        data-testid="workspace-text-preview"
        className="min-h-full whitespace-pre-wrap break-words p-3 text-xs"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
      >
        {preview.text ?? ''}
      </pre>
    </div>
  )
}

function EmptyFileState({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
      <strong style={{ color: 'var(--text-secondary)' }}>{title}</strong>
      <span>{body}</span>
    </div>
  )
}

async function collectWorkspaceEntries(root: string): Promise<WorkspaceFileEntry[]> {
  const entries: WorkspaceFileEntry[] = []
  const ignored = new Set(['.git', 'node_modules', 'dist', 'out', 'out-test'])
  async function visit(relativeDir: string, depth: number): Promise<void> {
    if (entries.length >= MAX_WORKSPACE_ENTRIES || depth > 4) return
    const absoluteDir = relativeDir ? joinPath(root, relativeDir) : root
    const names = await window.api.fs.listDir(absoluteDir)
    if (!names) return
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (ignored.has(name) || entries.length >= MAX_WORKSPACE_ENTRIES) continue
      const relativePath = relativeDir ? `${relativeDir}/${name}` : name
      const absolutePath = joinPath(root, relativePath)
      const stat = await window.api.fs.statPath(absolutePath)
      if (!stat.exists) continue
      const kind = stat.isDirectory ? 'directory' : 'file'
      entries.push({ path: relativePath, name, kind, depth, size: stat.size })
      if (kind === 'directory') await visit(relativePath, depth + 1)
    }
  }
  await visit('', 0)
  return entries
}

function joinPath(root: string, filePath: string): string {
  return `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}
