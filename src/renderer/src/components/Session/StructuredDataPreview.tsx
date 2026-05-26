import type { FilePreviewResult } from '../../env'
import { Badge, IconButton, PanelToolbar } from '../shared/designSystem'
import Icon from '../shared/Icon'
import type { IconName } from '../shared/Icon'

export interface PreviewHeaderAction {
  id: string
  icon: IconName
  label: string
  onClick: () => void
}

interface Props {
  name: string
  preview: FilePreviewResult
  testId: string
  statusLabel?: string
  actions?: PreviewHeaderAction[]
}

export default function StructuredDataPreview({ name, preview, testId, statusLabel, actions }: Props): JSX.Element {
  if (preview.kind === 'document') {
    return <DocumentPreview name={name} preview={preview} testId={testId} statusLabel={statusLabel} actions={actions} />
  }

  if (preview.kind === 'notebook') {
    return <NotebookPreview name={name} preview={preview} testId={testId} statusLabel={statusLabel} actions={actions} />
  }

  const label = preview.kind === 'csv' ? (name.toLowerCase().endsWith('.tsv') ? 'TSV' : 'CSV') : 'JSON'
  return (
    <div className="file-structured-preview flex h-full min-h-0 flex-col overflow-hidden" data-testid={testId}>
      <PanelToolbar className="file-preview-header" dataTestId={`${testId}-header`}>
        {statusLabel && <Badge tone="neutral">{statusLabel}</Badge>}
        <Badge tone="neutral">{label}</Badge>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <PreviewHeaderActions actions={actions} testId={testId} />
      </PanelToolbar>
      {preview.truncated && (
        <div className="file-preview-note">
          Showing first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      {preview.kind === 'csv'
        ? <CsvPreview name={name} text={preview.text ?? ''} />
        : <JsonPreview text={preview.text ?? ''} />}
    </div>
  )
}

function DocumentPreview({
  name,
  preview,
  testId,
  statusLabel,
  actions
}: {
  name: string
  preview: FilePreviewResult
  testId: string
  statusLabel?: string
  actions?: PreviewHeaderAction[]
}): JSX.Element {
  const paragraphs = (preview.text ?? '').split(/\n{2,}/).filter((paragraph) => paragraph.trim())
  return (
    <div className="file-structured-preview flex h-full min-h-0 flex-col overflow-hidden" data-testid={testId}>
      <PanelToolbar className="file-preview-header" dataTestId={`${testId}-header`}>
        {statusLabel && <Badge tone="neutral">{statusLabel}</Badge>}
        <Badge tone="neutral">DOCX</Badge>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <PreviewHeaderActions actions={actions} testId={testId} />
      </PanelToolbar>
      {preview.truncated && (
        <div className="file-preview-note">
          Showing first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      <div className="file-preview-meta-strip">
        <span>{paragraphs.length.toLocaleString()} paragraphs</span>
        <span>{formatBytes(preview.size ?? 0)}</span>
      </div>
      <div className="document-preview-body min-h-0 flex-1 overflow-auto">
        {paragraphs.length > 0 ? (
          paragraphs.slice(0, 80).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))
        ) : (
          <p className="document-preview-empty">No document text found.</p>
        )}
      </div>
    </div>
  )
}

function NotebookPreview({
  name,
  preview,
  testId,
  statusLabel,
  actions
}: {
  name: string
  preview: FilePreviewResult
  testId: string
  statusLabel?: string
  actions?: PreviewHeaderAction[]
}): JSX.Element {
  const notebook = parseNotebook(preview.text ?? '')
  return (
    <div className="file-structured-preview flex h-full min-h-0 flex-col overflow-hidden" data-testid={testId}>
      <PanelToolbar className="file-preview-header" dataTestId={`${testId}-header`}>
        {statusLabel && <Badge tone="neutral">{statusLabel}</Badge>}
        <Badge tone="neutral">Notebook</Badge>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {notebook.valid && (
          <NotebookReadOnlyControls testId={testId} />
        )}
        <PreviewHeaderActions actions={actions} testId={testId} />
      </PanelToolbar>
      {preview.truncated && (
        <div className="file-preview-note">
          Showing first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      <div className="file-preview-meta-strip">
        <span>{notebook.cells.length.toLocaleString()} cells</span>
        {notebook.kernel && <span>{notebook.kernel}</span>}
        {!notebook.valid && <span>Raw JSON shown</span>}
      </div>
      {notebook.valid ? (
        <div className="notebook-preview-list min-h-0 flex-1 overflow-auto">
          {notebook.cells.slice(0, 40).map((cell, index) => (
            <section className="notebook-preview-cell" key={index}>
              <div className="notebook-preview-cell-header">
                <Badge tone="neutral">{cell.type}</Badge>
                <span>Cell {index + 1}</span>
              </div>
              <pre>{cell.source || 'Empty cell'}</pre>
            </section>
          ))}
          {notebook.cells.length > 40 && (
            <div className="file-preview-note">First 40 cells shown.</div>
          )}
        </div>
      ) : (
        <pre className="file-preview-code min-h-0 flex-1 overflow-auto" data-valid="false">
          {preview.text ?? ''}
        </pre>
      )}
    </div>
  )
}

function NotebookReadOnlyControls({ testId }: { testId: string }): JSX.Element {
  return (
    <span
      className="notebook-preview-readonly-controls"
      data-testid={`${testId}-readonly-controls`}
      data-notebook-readonly-controls="true"
    >
      <span
        className="notebook-preview-readonly-badge"
        data-testid={`${testId}-readonly-badge`}
      >
        Read only
      </span>
      <button
        type="button"
        className="notebook-preview-readonly-control"
        disabled
        aria-disabled="true"
        aria-label="Running is not available in this preview"
        data-testid={`${testId}-run-all-disabled`}
        data-notebook-readonly-control="run-all"
      >
        <Icon name="play" size={12} />
        <span>Run all</span>
      </button>
      <button
        type="button"
        className="notebook-preview-readonly-control"
        disabled
        aria-disabled="true"
        aria-label="Kernels are not connected in this preview"
        data-testid={`${testId}-restart-kernel-disabled`}
        data-notebook-readonly-control="restart-kernel"
      >
        <Icon name="refresh" size={12} />
        <span>Restart kernel</span>
      </button>
    </span>
  )
}

function PreviewHeaderActions({
  actions,
  testId
}: {
  actions?: PreviewHeaderAction[]
  testId: string
}): JSX.Element | null {
  if (!actions?.length) return null
  return (
    <span
      className="file-preview-header-actions"
      data-testid={`${testId}-actions`}
      data-preview-controls={actions.map((action) => action.id).join(' ')}
    >
      {actions.map((action) => (
        <IconButton
          key={action.id}
          icon={action.icon}
          label={action.label}
          size="sm"
          variant="toolbar"
          dataTestId={`${testId}-action-${action.id}`}
          onClick={action.onClick}
        />
      ))}
    </span>
  )
}

function JsonPreview({ text }: { text: string }): JSX.Element {
  const formatted = formatJson(text)
  return (
    <>
      <div className="file-preview-meta-strip">
        <span>{formatted.summary}</span>
        {!formatted.valid && <span>Raw text shown</span>}
      </div>
      <pre className="file-preview-code min-h-0 flex-1 overflow-auto" data-valid={formatted.valid ? 'true' : 'false'}>
        {formatted.text}
      </pre>
    </>
  )
}

function CsvPreview({ name, text }: { name: string; text: string }): JSX.Element {
  const delimiter = name.toLowerCase().endsWith('.tsv') ? '\t' : ','
  const rows = parseDelimitedRows(text, delimiter)
  const headers = rows[0] ?? []
  const bodyRows = rows.slice(1, 81)
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), headers.length)
  return (
    <>
      <div className="file-preview-meta-strip">
        <span>{Math.max(rows.length - 1, 0).toLocaleString()} rows</span>
        <span>{columnCount.toLocaleString()} columns</span>
        {rows.length > 81 && <span>First 80 shown</span>}
      </div>
      <div className="file-preview-table-wrap min-h-0 flex-1 overflow-auto">
        <table className="file-preview-table">
          <thead>
            <tr>
              {(headers.length ? headers : Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`)).map((header, index) => (
                <th key={`${header}-${index}`}>{header || `Column ${index + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function formatJson(text: string): { text: string; valid: boolean; summary: string } {
  try {
    const parsed = JSON.parse(text)
    return { text: JSON.stringify(parsed, null, 2), valid: true, summary: jsonSummary(parsed) }
  } catch {
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length > 1) {
      try {
        const formattedLines = lines.map((line) => JSON.stringify(JSON.parse(line), null, 2))
        return { text: formattedLines.join('\n'), valid: true, summary: `${lines.length.toLocaleString()} JSON lines` }
      } catch {
        // Fall through to raw text.
      }
    }
    return { text, valid: false, summary: 'Invalid JSON' }
  }
}

function jsonSummary(value: unknown): string {
  if (Array.isArray(value)) return `${value.length.toLocaleString()} items`
  if (value && typeof value === 'object') return `${Object.keys(value).length.toLocaleString()} keys`
  return typeof value
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((currentRow) => currentRow.some((value) => value.length > 0))
}

function parseNotebook(text: string): {
  valid: boolean
  kernel: string | null
  cells: Array<{ type: string; source: string }>
} {
  try {
    const parsed = JSON.parse(text) as {
      metadata?: { kernelspec?: { display_name?: unknown; name?: unknown } }
      cells?: Array<{ cell_type?: unknown; source?: unknown }>
    }
    const cells = Array.isArray(parsed.cells)
      ? parsed.cells.map((cell) => ({
        type: typeof cell.cell_type === 'string' ? cell.cell_type : 'cell',
        source: normalizeNotebookSource(cell.source).trim()
      }))
      : []
    const kernel = parsed.metadata?.kernelspec?.display_name ?? parsed.metadata?.kernelspec?.name
    return {
      valid: true,
      kernel: typeof kernel === 'string' && kernel.trim() ? kernel : null,
      cells
    }
  } catch {
    return { valid: false, kernel: null, cells: [] }
  }
}

function normalizeNotebookSource(source: unknown): string {
  if (Array.isArray(source)) return source.map((part) => String(part)).join('')
  if (typeof source === 'string') return source
  return ''
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
