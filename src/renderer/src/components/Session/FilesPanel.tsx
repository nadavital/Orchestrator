import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FilePreviewResult } from '../../env'
import { Badge, IconButton, MenuItem, MenuSurface, PanelHeader, SurfaceRow } from '../shared/designSystem'
import Icon from '../shared/Icon'
import StructuredDataPreview from './StructuredDataPreview'

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
    <div className="files-panel-actions relative">
      <IconButton
        icon="ellipsis"
        label="File actions"
        size="sm"
        disabled={!selectedEntry}
        active={actionMenuOpen}
        onClick={() => setActionMenuOpen((open) => !open)}
      />
      {actionMenuOpen && (
        <MenuSurface
          onClose={() => setActionMenuOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 178, zIndex: 90 }}
        >
          <MenuItem
            icon="paperclip"
            label="Add to chat"
            disabled={selectedEntry?.kind !== 'file'}
            onClick={() => { addSelectedToChat(); setActionMenuOpen(false) }}
          />
          <MenuItem icon="copy" label="Copy path" disabled={!selectedEntry} onClick={() => { copySelected(); setActionMenuOpen(false) }} />
          <MenuItem icon="folder" label="Reveal file" disabled={!selectedEntry} onClick={() => { revealSelected(); setActionMenuOpen(false) }} />
          <MenuItem icon="file" label="Open file" disabled={!selectedEntry} onClick={() => { openSelected(); setActionMenuOpen(false) }} />
        </MenuSurface>
      )}
    </div>
  )

  return (
    <div
      className="files-panel-root flex min-h-0 min-w-0 flex-col overflow-hidden"
      data-embedded={embedded ? 'true' : 'false'}
      style={{
        width: embedded ? '100%' : 440,
        height: embedded ? '100%' : undefined,
        background: 'var(--surface-bg)'
      }}
    >
      {!embedded && <PanelHeader title="Files" actions={fileActions} />}
      <div className="files-panel-toolbar" data-testid="files-panel-toolbar">
        <div className="inspector-search-field files-panel-search min-w-0 flex-1" data-has-query={query.trim() ? 'true' : 'false'}>
          <Icon name="search" size={12} />
          <input
            data-testid="workspace-file-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter files"
            className="inspector-search-input min-w-0 flex-1 text-xs outline-none"
          />
          {query.trim() && (
            <button
              type="button"
              aria-label="Clear file filter"
              data-testid="workspace-file-search-clear"
              className="inspector-search-clear"
              onClick={() => setQuery('')}
            >
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <Badge tone="neutral" className="files-entry-count">{filteredEntries.length}</Badge>
        {embedded && fileActions}
      </div>
      <div className="files-panel-body" data-testid="files-panel-body">
        <div className="files-panel-list" data-testid="files-panel-list">
          {loading ? (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Loading...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div data-testid="workspace-file-empty-list" className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {query.trim() ? 'No matches' : 'No files'}
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <SurfaceRow
                key={entry.path}
                as="button"
                active={selectedPath === entry.path}
                onClick={() => setSelectedPath(entry.path)}
                className="files-entry-row w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs"
                style={{ display: 'flex', paddingLeft: 8 + Math.min(entry.depth, 4) * 10 }}
              >
                <Icon name={entry.kind === 'directory' ? 'folder' : 'file'} size={12} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.name}</span>
                  {entry.path !== entry.name && (
                    <span className="files-entry-path block truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
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
        <div className="files-panel-preview" data-testid="files-panel-preview">
          {selectedEntry?.kind === 'directory' ? (
            <EmptyFileState title={selectedEntry.path} body="Select a file." />
          ) : selectedEntry ? (
            <FilePreview
              entry={selectedEntry}
              absolutePath={joinPath(workDir, selectedEntry.path)}
              preview={preview}
            />
          ) : (
            <EmptyFileState title="No file selected" body="Select a file." />
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
    return <EmptyFileState title={entry.name} body="Loading..." />
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
  if (preview.kind === 'html') {
    return (
      <iframe
        title={entry.name}
        src={fileUrl(absolutePath)}
        sandbox=""
        className="h-full w-full border-0"
        data-testid="workspace-html-preview"
      />
    )
  }
  if (preview.kind === 'markdown') {
    return <MarkdownPreview name={entry.name} preview={preview} testId="workspace-markdown-preview" />
  }
  if (preview.kind === 'json') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-json-preview" />
  }
  if (preview.kind === 'csv') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-csv-preview" />
  }
  if (preview.kind === 'notebook') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-notebook-preview" />
  }
  if (preview.kind === 'document') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-document-preview" />
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
    return (
      <EmptyFileState
        title={entry.name}
        body="Binary file not shown."
        meta={`Binary, ${formatBytes(preview.size)}`}
        testId="workspace-binary-state"
        actions={[
          { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
          { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
        ]}
      />
    )
  }
  if (preview.kind === 'missing') {
    return <EmptyFileState title={entry.name} body="Missing from workspace." meta="Missing" />
  }
  if (preview.kind === 'unreadable') {
    return (
      <EmptyFileState
        title={entry.name}
        body="Preview unavailable."
        meta={preview.size !== undefined ? `Unavailable, ${formatBytes(preview.size)}` : 'Unavailable'}
        actions={[
          { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
          { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
        ]}
      />
    )
  }
  return (
    <div className="min-h-full">
      {preview.truncated && (
        <div
          className="px-3 py-2 text-[11px]"
          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          Showing first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
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

function MarkdownPreview({ name, preview, testId }: { name: string; preview: FilePreviewResult; testId: string }): JSX.Element {
  return (
    <div className="min-h-full overflow-auto" data-testid={testId}>
      <div
        className="flex items-center gap-2 px-3 py-2 text-[11px]"
        style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
      >
        <Badge tone="neutral">Markdown</Badge>
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </div>
      {preview.truncated && (
        <div
          className="px-3 py-2 text-[11px]"
          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          Showing first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      <div className="markdown-surface p-3 text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {preview.text ?? ''}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function EmptyFileState({
  title,
  body,
  meta,
  testId,
  actions = []
}: {
  title: string
  body: string
  meta?: string
  testId?: string
  actions?: Array<{ label: string; onClick: () => void }>
}): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="file-fallback-state"
      style={{ color: 'var(--text-tertiary)' }}
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
        style={{ background: 'var(--control-bg)', color: 'var(--text-secondary)' }}
      >
        <Icon name="file" size={18} />
      </span>
      <span className="min-w-0 max-w-full">
        <strong className="block max-w-full truncate" style={{ color: 'var(--text-secondary)' }}>{title}</strong>
        {meta && <span className="mt-1 block truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{meta}</span>}
      </span>
      <span className="max-w-[280px] leading-5">{body}</span>
      {actions.length > 0 && (
        <span className="file-fallback-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
            >
              <Icon name={fallbackActionIcon(action.label)} size={12} />
              {action.label}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

function fallbackActionIcon(label: string): 'external' | 'folder' | 'file' {
  if (label === 'Open') return 'external'
  if (label === 'Reveal') return 'folder'
  return 'file'
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
