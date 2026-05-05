import { useState, useEffect } from 'react'
import type { FileChange } from '../../types'

interface Props {
  sessionId: string
}

export default function DiffPanel({ sessionId }: Props): JSX.Element {
  const [files, setFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState('')

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
      className="flex flex-col shrink-0 overflow-hidden"
      style={{
        width: 440,
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace"
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 text-xs font-semibold"
        style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        <span>Changes {files.length > 0 ? `(${files.length})` : ''}</span>
        <button
          onClick={() => window.api.sessions.getChangedFiles(sessionId).then((f) => {
            setFiles(f)
            if (f.length > 0 && !f.find((x) => x.path === selectedFile)) setSelectedFile(f[0].path)
          })}
          title="Refresh"
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z" />
          </svg>
        </button>
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
          No changes yet
        </div>
      ) : (
        <>
          {/* File list */}
          <div
            className="overflow-y-auto shrink-0"
            style={{ maxHeight: 200, borderBottom: '1px solid var(--color-border)' }}
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
          <div className="flex-1 overflow-auto">
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
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
      style={{
        background: selected ? 'var(--color-accent-dim)' : 'transparent',
        borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent'
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--color-surface2)' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <span
        className="text-xs font-bold shrink-0"
        style={{ color: statusColor[file.status] ?? 'var(--color-text-muted)', width: 10 }}
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
          {file.additions > 0 && <span style={{ color: '#22c55e' }}>+{file.additions}</span>}
          {file.deletions > 0 && <span style={{ color: '#ef4444' }}>-{file.deletions}</span>}
        </span>
      )}
    </button>
  )
}

function DiffLines({ diff }: { diff: string }): JSX.Element {
  const lines = diff.split('\n').filter(
    (l) => !l.startsWith('diff --git') && !l.startsWith('index ') && !l.startsWith('--- ') && !l.startsWith('+++ ')
  )
  return (
    <div className="px-2 py-1" style={{ fontSize: 11, userSelect: 'text' }}>
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
          <div key={i} style={{ color, background: bg, whiteSpace: 'pre', lineHeight: 1.6 }}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}
