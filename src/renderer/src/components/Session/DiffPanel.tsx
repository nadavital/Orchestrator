import { useState, useEffect } from 'react'
import { fileStatusLabel, summarizeFileChanges } from '../../types'
import type { FileChange } from '../../types'
import { Badge, MetricPill, PanelHeader, SurfaceRow, ToolbarButton } from '../shared/designSystem'

interface Props {
  sessionId: string
  embedded?: boolean
}

export default function DiffPanel({ sessionId, embedded = false }: Props): JSX.Element {
  const [files, setFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState('')
  const summary = summarizeFileChanges(files)

  useEffect(() => {
    window.api.sessions.getChangedFiles(sessionId).then((f) => {
      setFiles(f)
      if (f.length > 0 && !selectedFile) setSelectedFile(f[0].path)
    })
  }, [sessionId])

  useEffect(() => {
    if (!selectedFile) return
    window.api.sessions.getDiffForFile(sessionId, selectedFile).then(setFileDiff)
  }, [selectedFile, sessionId])

  return (
    <div
      className="flex flex-col shrink-0 min-w-0 overflow-hidden"
      style={{
        width: embedded ? '100%' : 440,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        borderLeft: embedded ? 'none' : '1px solid var(--border-subtle)',
        background: 'var(--surface-bg)',
        fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace"
      }}
    >
      <PanelHeader
        title={`Changes${files.length > 0 ? ` (${files.length})` : ''}`}
        actions={
          <ToolbarButton
            icon="refresh"
            label="Refresh"
          onClick={() => window.api.sessions.getChangedFiles(sessionId).then((f) => {
            setFiles(f)
            if (f.length > 0 && !f.find((x) => x.path === selectedFile)) setSelectedFile(f[0].path)
          })}
          />
        }
      />

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No changes yet
        </div>
      ) : (
        <>
          <div
            className="px-3 py-2 text-xs"
            style={{
              borderBottom: '1px solid var(--border-subtle)',
              color: summary.risk === 'high' ? 'var(--color-red)' : 'var(--color-text-muted)'
            }}
          >
            <div className="truncate">{summary.label}</div>
            {(summary.additions > 0 || summary.deletions > 0) && (
              <div className="mt-1 flex gap-2" style={{ fontSize: 10 }}>
                {summary.additions > 0 && <MetricPill tone="success">+{summary.additions}</MetricPill>}
                {summary.deletions > 0 && <MetricPill tone="danger">-{summary.deletions}</MetricPill>}
              </div>
            )}
          </div>
          {/* File list */}
          <div
            className="overflow-y-auto overflow-x-hidden shrink-0"
            style={{ maxHeight: 200, borderBottom: '1px solid var(--border-subtle)' }}
          >
            {files.map((f) => (
              <FileRow
                key={f.path}
                file={f}
                selected={selectedFile === f.path}
                onClick={() => setSelectedFile(f.path)}
              />
            ))}
          </div>

          {/* File diff */}
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            {selectedFile ? (
              fileDiff ? (
                <DiffLines diff={fileDiff} />
              ) : (
                <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  No diff available
                </div>
              )
            ) : null}
          </div>
        </>
      )}
    </div>
  )
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

function DiffLines({ diff }: { diff: string }): JSX.Element {
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
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
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
