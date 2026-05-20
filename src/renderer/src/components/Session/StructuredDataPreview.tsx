import type { FilePreviewResult } from '../../env'
import { Badge } from '../shared/designSystem'

interface Props {
  name: string
  preview: FilePreviewResult
  testId: string
  statusLabel?: string
}

export default function StructuredDataPreview({ name, preview, testId, statusLabel }: Props): JSX.Element {
  const label = preview.kind === 'csv' ? (name.toLowerCase().endsWith('.tsv') ? 'TSV' : 'CSV') : 'JSON'
  return (
    <div className="file-structured-preview flex h-full min-h-0 flex-col overflow-hidden" data-testid={testId}>
      <div className="file-preview-header">
        {statusLabel && <Badge tone="neutral">{statusLabel}</Badge>}
        <Badge tone="neutral">{label}</Badge>
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </div>
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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
