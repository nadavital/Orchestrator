import { useState, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fileStatusLabel } from '../../types'
import type { FileChange } from '../../types'
import type { FilePreviewResult } from '../../env'
import { Badge, IconButton, MenuItem, MenuSurface, PanelHeader, SurfaceRow } from '../shared/designSystem'
import Icon from '../shared/Icon'

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
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery
      ? files.filter((file) => file.path.toLowerCase().includes(normalizedQuery))
      : files
  }, [files, query])
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
    if (!selectedFile || filteredFiles.some((file) => file.path === selectedFile)) return
    setSelectedFile(filteredFiles[0]?.path ?? null)
  }, [filteredFiles, selectedFile])

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
      className="flex flex-col shrink-0 min-w-0 overflow-hidden"
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
        <div className="inspector-search-field diff-panel-search min-w-0 flex-1" data-has-query={query.trim() ? 'true' : 'false'}>
          <Icon name="search" size={12} />
          <input
            data-testid="diff-file-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter changes"
            className="inspector-search-input min-w-0 flex-1 text-xs outline-none"
          />
          {query.trim() && (
            <button
              type="button"
              aria-label="Clear change filter"
              data-testid="diff-file-search-clear"
              className="inspector-search-clear"
              onClick={() => setQuery('')}
            >
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
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
        {embedded && changeActions}
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No changes yet
        </div>
      ) : (
        <>
          <div
            className="overflow-y-auto overflow-x-hidden shrink-0"
            style={{ maxHeight: 200, borderBottom: '1px solid var(--border-subtle)' }}
          >
            {filteredFiles.length === 0 && (
              <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                No matches
              </div>
            )}
            {filteredFiles.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                selected={selectedFile === f.path}
                onClick={() => setSelectedFile(f.path)}
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
  absolutePath
}: {
  change: FileChange | null
  diff: string
  preview: FilePreviewResult | null
  loading: boolean
  wrap: boolean
  absolutePath: string
}): JSX.Element {
  if (!change) {
    return <ReviewEmptyState title="No file selected" body="Select a change." />
  }
  if (loading) {
    return <ReviewEmptyState title={change.path} body="Loading..." />
  }
  const hasNativePreview = preview?.kind === 'image' ||
    preview?.kind === 'pdf' ||
    preview?.kind === 'html' ||
    preview?.kind === 'markdown' ||
    preview?.kind === 'audio' ||
    preview?.kind === 'video'
  if ((isBinaryDiff(diff) && !hasNativePreview) || preview?.kind === 'binary') {
    return (
      <ReviewEmptyState
        title={change.path}
        body="Cannot preview this file here."
        meta={preview?.size !== undefined ? `Binary, ${formatBytes(preview.size)}` : 'Binary'}
        testId="review-binary-state"
        actions={[
          { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
          { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
        ]}
      />
    )
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
      className="flex h-full flex-col items-start justify-start gap-2.5 px-3 py-4 text-left text-xs"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <span className="flex max-w-full items-center gap-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md"
          style={{ background: 'var(--control-bg)', color: 'var(--text-secondary)' }}
        >
          <Icon name="file" size={14} />
        </span>
        <span className="min-w-0">
          <span className="block max-w-full truncate" style={{ color: 'var(--text-secondary)', fontWeight: 650 }}>{title}</span>
          {meta && <span className="block truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{meta}</span>}
        </span>
      </span>
      <span className="max-w-[300px] leading-5">{body}</span>
      {actions.length > 0 && (
        <span className="flex items-center gap-2 pt-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="rounded-md px-2 py-1 text-[11px] font-semibold"
              style={{
                border: '1px solid var(--border-subtle)',
                background: 'var(--control-bg)',
                color: 'var(--text-secondary)'
              }}
            >
              {action.label}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}

function isBinaryDiff(diff: string): boolean {
  return diff.split('\n').some((line) => line.startsWith('Binary files ') || line.startsWith('GIT binary patch'))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function FileRow({ file, selected, onClick }: { file: FileChange; selected: boolean; onClick: () => void }): JSX.Element {
  const statusColor: Record<string, string> = {
    M: 'var(--color-accent)',
    A: '#22c55e',
    D: '#ef4444',
    R: '#f59e0b',
    '?': 'var(--color-text-muted)'
  }

  const parts = file.path.split('/')
  const filename = parts.pop()!
  const dir = parts.join('/')

  return (
    <SurfaceRow
      as="button"
      onClick={onClick}
      active={selected}
      className="w-full min-w-0 max-w-full overflow-hidden flex items-center gap-2 px-3 py-1.5 text-left"
      style={{
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent'
      }}
    >
      <span
        className="text-xs font-bold shrink-0"
        style={{ color: statusColor[file.status] ?? 'var(--color-text-muted)', width: 10 }}
        title={fileStatusLabel(file.status)}
      >
        {file.status}
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-xs truncate block" style={{ color: 'var(--color-text)', fontSize: 11 }}>
          {filename}
        </span>
        {dir && (
          <span className="text-xs truncate block" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
            {dir}/
          </span>
        )}
      </span>
      {(file.additions > 0 || file.deletions > 0) && (
        <span className="text-xs shrink-0 flex gap-1" style={{ fontSize: 10 }}>
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

function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}
