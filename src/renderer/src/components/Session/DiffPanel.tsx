import { useState, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { adjacentFileChangePath, buildFileChangeTreeRows, fileStatusLabel, isBinaryDiffText, shouldPreferTextDiff } from '../../types'
import type { FileChange, FileChangeTreeRow } from '../../types'
import type { FilePreviewResult } from '../../env'
import { Badge, IconButton, MenuItem, MenuSurface, PanelHeader, SurfaceRow, WorkbenchSearchField } from '../shared/designSystem'
import Icon from '../shared/Icon'
import StructuredDataPreview from './StructuredDataPreview'

interface Props {
  sessionId: string
  workDir: string
  embedded?: boolean
}

export default function DiffPanel({ sessionId, workDir, embedded = false }: Props): JSX.Element {
  const [files, setFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState('')
  const [filePreview, setFilePreview] = useState<FilePreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [wrapLines, setWrapLines] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery
      ? files.filter((file) => file.path.toLowerCase().includes(normalizedQuery))
      : files
  }, [files, query])
  const fileTreeRows = useMemo(() => buildFileChangeTreeRows(filteredFiles), [filteredFiles])
  const selectedChange = selectedFile ? filteredFiles.find((file) => file.path === selectedFile) ?? null : null

  useEffect(() => {
    window.api.sessions.getChangedFiles(sessionId).then((f) => {
      setFiles(f)
      if (f.length > 0 && !selectedFile) setSelectedFile(f[0].path)
    })
  }, [sessionId])

  useEffect(() => {
    if (!selectedFile || !selectedChange) {
      setFileDiff('')
      setFilePreview(null)
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    setFileDiff('')
    setFilePreview(null)
    setPreviewLoading(true)
    Promise.all([
      window.api.sessions.getDiffForFile(sessionId, selectedFile),
      selectedChange.status === 'D'
        ? Promise.resolve<FilePreviewResult>({ kind: 'missing', truncated: false })
        : window.api.fs.previewFile(joinPath(workDir, selectedFile))
    ])
      .then(([diff, preview]) => {
        if (cancelled) return
        setFileDiff(diff)
        setFilePreview(preview)
      })
      .catch(() => {
        if (cancelled) return
        setFileDiff('')
        setFilePreview({ kind: 'unreadable', truncated: false })
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedChange, selectedFile, sessionId, workDir])

  useEffect(() => {
    setShowPreview(false)
  }, [selectedFile])

  useEffect(() => {
    if (!selectedFile || filteredFiles.some((file) => file.path === selectedFile)) return
    setSelectedFile(filteredFiles[0]?.path ?? null)
  }, [filteredFiles, selectedFile])

  useEffect(() => {
    if (!selectedFile) return
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-review-path="${escapeCssAttribute(selectedFile)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedFile])

  const selectAdjacentFile = (direction: 'next' | 'previous'): void => {
    const nextPath = adjacentFileChangePath(filteredFiles, selectedFile, direction)
    if (nextPath) setSelectedFile(nextPath)
  }

  const selectBoundaryFile = (boundary: 'first' | 'last'): void => {
    if (filteredFiles.length === 0) return
    setSelectedFile(boundary === 'first' ? filteredFiles[0].path : filteredFiles[filteredFiles.length - 1].path)
  }

  const handleFileListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectAdjacentFile('next')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectAdjacentFile('previous')
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectBoundaryFile('first')
    } else if (event.key === 'End') {
      event.preventDefault()
      selectBoundaryFile('last')
    }
  }

  const refresh = (): void => {
    window.api.sessions.getChangedFiles(sessionId).then((f) => {
      setFiles(f)
      if (f.length > 0 && !f.find((x) => x.path === selectedFile)) setSelectedFile(f[0].path)
    })
  }

  const openSelectedFile = (): void => {
    if (!selectedFile || !selectedChange || selectedChange.status === 'D') return
    void window.api.fs.openPath(joinPath(workDir, selectedFile))
  }

  const revealSelectedFile = (): void => {
    if (!selectedFile || !selectedChange || selectedChange.status === 'D') return
    void window.api.fs.showInFolder(joinPath(workDir, selectedFile))
  }

  const copySelectedPath = (): void => {
    if (!selectedFile || !selectedChange) return
    void navigator.clipboard.writeText(selectedFile)
  }

  const copyGitApplyCommand = (): void => {
    if (!fileDiff.trim()) return
    const patch = fileDiff.endsWith('\n') ? fileDiff : `${fileDiff}\n`
    const command = `git apply <<'PATCH'\n${patch}PATCH`
    void navigator.clipboard.writeText(command)
  }

  const canTogglePreview = Boolean(selectedChange && filePreview && (shouldPreferTextDiff(fileDiff) || isBinaryDiffText(fileDiff)) && hasReviewPreview(filePreview))

  const changeActions = (
    <div className="diff-panel-actions relative">
      <IconButton
        icon="ellipsis"
        label="Change actions"
        size="sm"
        active={actionMenuOpen}
        onClick={() => setActionMenuOpen((open) => !open)}
      />
      {actionMenuOpen && (
        <MenuSurface
          onClose={() => setActionMenuOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 178, zIndex: 90 }}
        >
          <MenuItem
            icon="refresh"
            label="Refresh changes"
            onClick={() => { refresh(); setActionMenuOpen(false) }}
          />
          <MenuItem
            icon="wrap"
            label={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
            onClick={() => { setWrapLines((value) => !value); setActionMenuOpen(false) }}
          />
          <MenuItem
            icon="file"
            label={showPreview ? 'Show diff' : 'Show preview'}
            disabled={!canTogglePreview}
            onClick={() => { setShowPreview((value) => !value); setActionMenuOpen(false) }}
          />
          <MenuItem
            icon="copy"
            label="Copy git apply command"
            disabled={!fileDiff.trim()}
            onClick={() => { copyGitApplyCommand(); setActionMenuOpen(false) }}
          />
          <MenuItem
            icon="file"
            label="Open file"
            disabled={!selectedChange || selectedChange.status === 'D'}
            onClick={() => { openSelectedFile(); setActionMenuOpen(false) }}
          />
          <MenuItem
            icon="folder"
            label="Reveal file"
            disabled={!selectedChange || selectedChange.status === 'D'}
            onClick={() => { revealSelectedFile(); setActionMenuOpen(false) }}
          />
          <MenuItem
            icon="copy"
            label="Copy path"
            disabled={!selectedChange}
            onClick={() => { copySelectedPath(); setActionMenuOpen(false) }}
          />
        </MenuSurface>
      )}
    </div>
  )

  return (
    <div
      className="diff-panel-root flex flex-col shrink-0 min-w-0 overflow-hidden"
      ref={rootRef}
      data-embedded={embedded ? 'true' : 'false'}
      style={{
        width: embedded ? '100%' : 440,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        borderLeft: embedded ? 'none' : '1px solid var(--border-subtle)',
        background: 'var(--surface-bg)'
      }}
    >
      {!embedded && (
        <PanelHeader
          title={`Review${files.length > 0 ? ` (${files.length})` : ''}`}
          actions={changeActions}
        />
      )}

      <div className="diff-panel-toolbar" data-testid="diff-panel-toolbar">
        <WorkbenchSearchField
          value={query}
          onChange={setQuery}
          placeholder="Filter changes"
          clearLabel="Clear change filter"
          dataTestId="diff-file-search"
          clearDataTestId="diff-file-search-clear"
          className="diff-panel-search flex-1"
        />
        <Badge tone="neutral" className="diff-file-count shrink-0">
          {embedded ? (
            <>
              {files.length}
              <span className="sr-only"> {files.length === 1 ? 'file' : 'files'}</span>
            </>
          ) : (
            `${files.length} ${files.length === 1 ? 'file' : 'files'}`
          )}
        </Badge>
        {canTogglePreview && (
          <IconButton
            icon={showPreview ? 'branch' : 'file'}
            label={showPreview ? 'Show diff' : 'Show preview'}
            size="sm"
            active={showPreview}
            onClick={() => setShowPreview((value) => !value)}
          />
        )}
        {embedded && changeActions}
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No changes yet
        </div>
      ) : (
        <>
          <div
            className="diff-panel-list overflow-y-auto overflow-x-hidden shrink-0"
            tabIndex={0}
            onKeyDown={handleFileListKeyDown}
          >
            {filteredFiles.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                No matches
              </div>
            )}
            {fileTreeRows.map((row) => row.type === 'directory' ? (
              <DirectoryRow key={row.id} row={row} />
            ) : (
              <FileRow
                key={row.id}
                row={row}
                selected={selectedFile === row.file.path}
                onClick={() => setSelectedFile(row.file.path)}
              />
            ))}
          </div>

          {/* File diff */}
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden" data-testid="review-preview">
            <ReviewPreview
              change={selectedChange}
              diff={fileDiff}
              preview={filePreview}
              loading={previewLoading}
              wrap={wrapLines}
              preferPreview={showPreview}
              absolutePath={selectedFile ? joinPath(workDir, selectedFile) : ''}
            />
          </div>
        </>
      )}
    </div>
  )
}

function ReviewPreview({
  change,
  diff,
  preview,
  loading,
  wrap,
  preferPreview,
  absolutePath
}: {
  change: FileChange | null
  diff: string
  preview: FilePreviewResult | null
  loading: boolean
  wrap: boolean
  preferPreview: boolean
  absolutePath: string
}): JSX.Element {
  if (!change) {
    return <ReviewEmptyState title="No file selected" body="Select a change." />
  }
  if (loading) {
    return <ReviewEmptyState title={change.path} body="Loading..." />
  }
  if ((isBinaryDiff(diff) && !preferPreview) || preview?.kind === 'binary') {
    return (
      <ReviewEmptyState
        title={change.path}
        body="Binary file not shown."
        meta={preview?.size !== undefined ? `Binary, ${formatBytes(preview.size)}` : 'Binary'}
        testId="review-binary-state"
        actions={[
          { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
          { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
        ]}
      />
    )
  }
  if (shouldPreferTextDiff(diff) && !preferPreview) {
    return <DiffLines diff={diff} wrap={wrap} />
  }
  if (preview?.kind === 'image') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-image-state">
        <ReviewPreviewHeader change={change} label="Image" />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          <img
            src={fileUrl(absolutePath)}
            alt={change.path}
            className="max-h-full max-w-full rounded-md object-contain"
            style={{ border: '1px solid var(--border-subtle)' }}
          />
        </div>
      </div>
    )
  }
  if (preview?.kind === 'pdf') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-pdf-state">
        <ReviewPreviewHeader change={change} label="PDF" />
        <iframe title={change.path} src={fileUrl(absolutePath)} className="min-h-0 flex-1 border-0" />
      </div>
    )
  }
  if (preview?.kind === 'html') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-html-state">
        <ReviewPreviewHeader change={change} label="HTML" />
        <iframe title={change.path} src={fileUrl(absolutePath)} sandbox="" className="min-h-0 flex-1 border-0" />
      </div>
    )
  }
  if (preview?.kind === 'markdown') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-markdown-state">
        <ReviewPreviewHeader change={change} label={preview.truncated ? 'Markdown truncated' : 'Markdown'} />
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="markdown-surface text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {preview.text ?? ''}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }
  if (preview?.kind === 'json') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-json-state"
      />
    )
  }
  if (preview?.kind === 'csv') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-csv-state"
      />
    )
  }
  if (preview?.kind === 'notebook') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-notebook-state"
      />
    )
  }
  if (preview?.kind === 'document') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-document-state"
      />
    )
  }
  if (preview?.kind === 'audio') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-audio-state">
        <ReviewPreviewHeader change={change} label="Audio" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{change.path}</span>
          <audio controls src={fileUrl(absolutePath)} className="w-full max-w-[360px]" />
        </div>
      </div>
    )
  }
  if (preview?.kind === 'video') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-video-state">
        <ReviewPreviewHeader change={change} label="Video" />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          <video controls src={fileUrl(absolutePath)} className="max-h-full max-w-full rounded-md" />
        </div>
      </div>
    )
  }
  if (diff.trim()) {
    return <DiffLines diff={diff} wrap={wrap} />
  }
  if (preview?.kind === 'text' && preview.text?.trim()) {
    return (
      <div className="min-h-full" data-testid="review-source-preview">
        <ReviewPreviewHeader change={change} label={preview.truncated ? 'Source truncated' : 'Source'} />
        <pre
          className="min-h-full whitespace-pre-wrap break-words p-3 text-xs"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
        >
          {preview.text}
        </pre>
      </div>
    )
  }
  if (change.status === 'D') {
    return <ReviewEmptyState title={change.path} body="Deleted file." />
  }
  if (preview?.kind === 'missing') {
    return <ReviewEmptyState title={change.path} body="Missing from workspace." />
  }
  if (preview?.kind === 'unreadable') {
    return (
      <ReviewEmptyState
        title={change.path}
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
    <ReviewEmptyState
      title={change.path}
      body="No preview available."
      testId="review-no-content-state"
      actions={[
        { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
        { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
      ]}
    />
  )
}

function ReviewPreviewHeader({ change, label }: { change: FileChange; label: string }): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-3 py-2 text-[11px]"
      style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
    >
      <Badge tone="neutral">{fileStatusLabel(change.status)}</Badge>
      <span className="min-w-0 flex-1 truncate">{label} · {change.path}</span>
    </div>
  )
}

function ReviewEmptyState({
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
      style={{ color: 'var(--color-text-muted)' }}
    >
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
        style={{ background: 'var(--control-bg)', color: 'var(--text-secondary)' }}
      >
        <Icon name="file" size={18} />
      </span>
      <span className="min-w-0 max-w-full">
        <span className="block max-w-full truncate" style={{ color: 'var(--text-secondary)', fontWeight: 650 }}>{title}</span>
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
              <Icon name={reviewActionIcon(action.label)} size={12} />
              {action.label}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

function reviewActionIcon(label: string): 'external' | 'folder' | 'file' {
  if (label === 'Open') return 'external'
  if (label === 'Reveal') return 'folder'
  return 'file'
}

function isBinaryDiff(diff: string): boolean {
  return isBinaryDiffText(diff)
}

function hasReviewPreview(preview: FilePreviewResult): boolean {
  return preview.kind === 'image' ||
    preview.kind === 'pdf' ||
    preview.kind === 'html' ||
    preview.kind === 'markdown' ||
    preview.kind === 'json' ||
    preview.kind === 'csv' ||
    preview.kind === 'notebook' ||
    preview.kind === 'document' ||
    preview.kind === 'audio' ||
    preview.kind === 'video' ||
    (preview.kind === 'text' && Boolean(preview.text?.trim()))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const statusColor: Record<FileChange['status'], string> = {
  M: 'var(--color-accent)',
  A: '#22c55e',
  D: '#ef4444',
  R: '#f59e0b',
  '?': 'var(--color-text-muted)'
}

function DirectoryRow({ row }: { row: Extract<FileChangeTreeRow, { type: 'directory' }> }): JSX.Element {
  return (
    <div
      className="diff-directory-row w-full min-w-0 max-w-full overflow-hidden flex items-center gap-2 px-3 py-1.5 text-left"
      style={{
        paddingLeft: 10 + Math.min(row.depth, 4) * 12,
        color: 'var(--text-secondary)'
      }}
      aria-label={row.path}
    >
      <Icon name="folder" size={12} />
      <span className="flex-1 min-w-0">
        <span className="truncate block">
          {row.name}
        </span>
        <span className="diff-file-dir truncate block">
          {row.fileCount} {row.fileCount === 1 ? 'file' : 'files'}
        </span>
      </span>
      {(row.additions > 0 || row.deletions > 0) && (
        <span className="diff-file-stats text-xs shrink-0 flex gap-1" style={{ fontSize: 10 }}>
          {row.additions > 0 && <Badge tone="success">+{row.additions}</Badge>}
          {row.deletions > 0 && <Badge tone="danger">-{row.deletions}</Badge>}
        </span>
      )}
    </div>
  )
}

function FileRow({
  row,
  selected,
  onClick
}: {
  row: Extract<FileChangeTreeRow, { type: 'file' }>
  selected: boolean
  onClick: () => void
}): JSX.Element {
  const file = row.file

  return (
    <SurfaceRow
      as="button"
      onClick={onClick}
      active={selected}
      className="diff-file-row w-full min-w-0 max-w-full overflow-hidden flex items-center gap-2 px-3 py-1.5 text-left"
      style={{
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        paddingLeft: 10 + Math.min(row.depth, 4) * 12
      }}
      ariaLabel={file.path}
      dataReviewPath={file.path}
    >
      <span
        className="diff-file-status shrink-0"
        style={{ color: statusColor[file.status], width: 10 }}
        title={fileStatusLabel(file.status)}
      >
        {file.status}
      </span>
      <span className="flex-1 min-w-0">
        <span className="truncate block" style={{ color: 'var(--color-text)' }}>
          {row.name}
        </span>
      </span>
      {(file.additions > 0 || file.deletions > 0) && (
        <span className="diff-file-stats text-xs shrink-0 flex gap-1" style={{ fontSize: 10 }}>
          {file.additions > 0 && <Badge tone="success">+{file.additions}</Badge>}
          {file.deletions > 0 && <Badge tone="danger">-{file.deletions}</Badge>}
        </span>
      )}
    </SurfaceRow>
  )
}

function DiffLines({ diff, wrap }: { diff: string; wrap: boolean }): JSX.Element {
  const lines = diff.split('\n').filter(
    (l) => !l.startsWith('diff --git') && !l.startsWith('index ') && !l.startsWith('--- ') && !l.startsWith('+++ ')
  )
  return (
    <div className="px-2 py-1 min-w-0" style={{ fontSize: 11, userSelect: 'text' }}>
      {lines.map((line, i) => {
        let color = 'var(--color-text-muted)'
        let bg = 'transparent'
        if (line.startsWith('+')) {
          color = '#22c55e'
          bg = 'rgba(34,197,94,0.08)'
        } else if (line.startsWith('-')) {
          color = '#ef4444'
          bg = 'rgba(239,68,68,0.08)'
        } else if (line.startsWith('@@')) {
          color = '#60a5fa'
        }
        return (
          <div
            key={i}
            style={{
              color,
              background: bg,
              whiteSpace: wrap ? 'pre-wrap' : 'pre',
              overflowWrap: wrap ? 'anywhere' : 'normal',
              wordBreak: wrap ? 'break-word' : 'normal',
              overflowX: wrap ? 'hidden' : 'auto',
              lineHeight: 1.6
            }}
          >
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function joinPath(root: string, filePath: string): string {
  return `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function escapeCssAttribute(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}
