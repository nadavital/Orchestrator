import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FilePreviewResult } from '../../env'
import { Badge, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelToolbar } from '../shared/designSystem'
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

type NotebookOutput =
  | { type: 'stream'; name: string; text: string; summaryMarkdown?: string | null }
  | { type: 'text'; text: string; summaryMarkdown?: string | null }
  | { type: 'markdown'; markdown: string; summaryMarkdown?: string | null }
  | { type: 'html'; html: string; summaryMarkdown?: string | null }
  | { type: 'json'; text: string; summaryMarkdown?: string | null }
  | { type: 'image'; dataUrl: string; summaryMarkdown?: string | null }
  | { type: 'error'; name: string; message: string; traceback: string; summaryMarkdown?: string | null }

interface NotebookCell {
  type: string
  source: string
  title: string | null
  descriptionMarkdown: string | null
  executionCount: number | null
  outputs: NotebookOutput[]
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
  const title = stripArtifactExtension(name, 'docx')
  const pages = useMemo(() => chunkDocumentParagraphs(paragraphs.slice(0, 80)), [paragraphs])
  const pageCount = Math.max(1, pages.length)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoomPercent, setZoomPercent] = useState(100)
  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), pageCount))
  }, [pageCount])
  const zoomOut = (): void => {
    setZoomPercent((zoom) => Math.max(50, zoom - 25))
  }
  const zoomIn = (): void => {
    setZoomPercent((zoom) => Math.min(200, zoom + 25))
  }
  const openFileAction = actions?.find((action) => action.id === 'open-file')
  const revealFileAction = actions?.find((action) => action.id === 'reveal-file')
  const visibleActions = openFileAction && revealFileAction
    ? actions?.filter((action) => action.id !== 'open-file' && action.id !== 'reveal-file') ?? []
    : actions ?? []
  const previewControls = [
    ...visibleActions.map((action) => action.id),
    'docx-page-navigation',
    'docx-zoom',
    ...(openFileAction && revealFileAction ? ['open-options'] : [])
  ].join(' ')
  const visiblePage = pages[currentPage - 1] ?? []
  return (
    <div
      className="file-structured-preview flex h-full min-h-0 flex-col overflow-hidden"
      data-testid={testId}
      data-document-preview-page-count={pageCount}
      data-document-preview-current-page={currentPage}
      data-document-preview-zoom-percent={zoomPercent}
    >
      <ArtifactPreviewHeader
        artifactType={statusLabel ? `DOC · ${statusLabel}` : 'DOC'}
        centerContent={(
          <span
            className="file-preview-page-controls"
            data-testid={`${testId}-page-controls`}
            data-document-current-page={currentPage}
            data-document-page-count={pageCount}
          >
            <IconButton
              icon="arrowLeft"
              label="Previous page"
              size="sm"
              variant="toolbar"
              disabled={currentPage <= 1}
              dataTestId={`${testId}-page-previous`}
              onClick={() => { setCurrentPage((page) => Math.max(1, page - 1)) }}
            />
            <span className="file-preview-page-indicator" data-testid={`${testId}-page-indicator`}>
              {currentPage}/{pageCount}
            </span>
            <IconButton
              icon="arrowRight"
              label="Next page"
              size="sm"
              variant="toolbar"
              disabled={currentPage >= pageCount}
              dataTestId={`${testId}-page-next`}
              onClick={() => { setCurrentPage((page) => Math.min(pageCount, page + 1)) }}
            />
          </span>
        )}
        rightContent={(
          <span
            className="file-preview-header-actions"
            data-testid={`${testId}-actions`}
            data-preview-controls={previewControls}
            data-artifact-open-options={openFileAction && revealFileAction ? 'true' : undefined}
          >
            <span
              className="file-preview-zoom-controls"
              data-testid={`${testId}-zoom-controls`}
              data-document-zoom-percent={zoomPercent}
            >
              <IconButton
                icon="zoomOut"
                label="Zoom out"
                size="sm"
                variant="toolbar"
                disabled={zoomPercent <= 50}
                dataTestId={`${testId}-zoom-out`}
                onClick={zoomOut}
              />
              <span className="file-preview-zoom-indicator" data-testid={`${testId}-zoom-indicator`}>
                {zoomPercent}%
              </span>
              <IconButton
                icon="zoomIn"
                label="Zoom in"
                size="sm"
                variant="toolbar"
                disabled={zoomPercent >= 200}
                dataTestId={`${testId}-zoom-in`}
                onClick={zoomIn}
              />
            </span>
            {visibleActions.map((action) => (
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
            {openFileAction && revealFileAction && (
              <ArtifactOpenOptions
                openAction={openFileAction}
                revealAction={revealFileAction}
                testId={testId}
              />
            )}
          </span>
        )}
        testId={testId}
        title={title}
      />
      {preview.truncated && (
        <div className="file-preview-note">
          Showing first {formatBytes((preview.text ?? '').length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      <div className="file-preview-meta-strip">
        <span>{paragraphs.length.toLocaleString()} paragraphs</span>
        <span>{pageCount.toLocaleString()} pages</span>
        <span>{formatBytes(preview.size ?? 0)}</span>
      </div>
      <div
        className="document-preview-body min-h-0 flex-1 overflow-auto"
        data-testid={`${testId}-body`}
        data-document-preview-zoom-percent={zoomPercent}
      >
        {paragraphs.length > 0 ? (
          <section
            className="document-preview-page"
            data-testid={`${testId}-page`}
            data-document-page-number={currentPage}
            style={{ fontSize: `${Math.max(10, Math.min(22, 13 * (zoomPercent / 100)))}px` }}
          >
            {visiblePage.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </section>
        ) : (
          <p className="document-preview-empty">No document text found.</p>
        )}
      </div>
    </div>
  )
}

function chunkDocumentParagraphs(paragraphs: string[]): string[][] {
  if (paragraphs.length === 0) return [[]]
  const chunks: string[][] = []
  for (let index = 0; index < paragraphs.length; index += 6) {
    chunks.push(paragraphs.slice(index, index + 6))
  }
  return chunks
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
  const title = notebook.title ?? stripArtifactExtension(name, 'ipynb')
  const artifactType = notebook.valid
    ? `IPYNB · ${notebook.cells.length.toLocaleString()} ${notebook.cells.length === 1 ? 'cell' : 'cells'}`
    : 'IPYNB'
  return (
    <div className="file-structured-preview flex h-full min-h-0 flex-col overflow-hidden" data-testid={testId}>
      <ArtifactPreviewHeader
        artifactType={statusLabel ? `${artifactType} · ${statusLabel}` : artifactType}
        rightContent={(
          <>
            {notebook.valid && <NotebookReadOnlyControls testId={testId} />}
            <PreviewHeaderActions actions={actions} testId={testId} />
          </>
        )}
        testId={testId}
        title={title}
      />
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
          <div className="notebook-preview-list-inner" data-testid="notebook-preview-list-inner">
            {notebook.cells.slice(0, 40).map((cell, index) => (
              <details
                className="notebook-preview-cell"
                data-testid="notebook-preview-cell"
                data-notebook-cell-disclosure="true"
                data-notebook-cell-position={`${index + 1} of ${notebook.cells.length}`}
                data-notebook-execution-count={cell.executionCount ?? undefined}
                key={index}
                open
              >
                <summary className="notebook-preview-cell-header">
                  <span className="notebook-preview-cell-title-group">
                    <span className="notebook-preview-cell-disclosure-icon">
                      <Icon name="chevronRight" size={12} />
                    </span>
                    <span className="notebook-preview-cell-title" title={notebookCellTitle(cell, index + 1)}>
                      {notebookCellTitle(cell, index + 1)}
                    </span>
                    <span className="notebook-preview-cell-position">
                      Cell {index + 1} of {notebook.cells.length}
                    </span>
                  </span>
                  <span className="notebook-preview-cell-meta">
                    {cell.type === 'code' && cell.executionCount != null && (
                      <span
                        className="notebook-preview-cell-execution-count"
                        data-notebook-execution-count-label={cell.executionCount}
                      >
                        Run {cell.executionCount}
                      </span>
                    )}
                    {cell.type === 'code' && (
                      <button
                        aria-label="Running is disabled in read-only preview"
                        className="notebook-preview-cell-run-disabled"
                        data-notebook-cell-run-disabled="true"
                        disabled
                        title="Running is disabled in read-only preview"
                        type="button"
                      >
                        <Icon name="play" size={12} />
                      </button>
                    )}
                    {cell.outputs.length > 0 && <span>{cell.outputs.length} outputs</span>}
                  </span>
                </summary>
                <div className="notebook-preview-cell-body">
                  <div className="notebook-preview-cell-source">
                    {cell.type === 'code'
                      ? <NotebookCodeCellBody cell={cell} />
                      : <pre>{cell.source || 'Empty cell'}</pre>}
                  </div>
                  {cell.outputs.length > 0 && (
                    <div
                      className="notebook-preview-outputs"
                      data-testid="notebook-preview-outputs"
                      data-notebook-output-count={cell.outputs.length}
                    >
                      {cell.outputs.slice(0, 20).map((output, outputIndex) => (
                        <NotebookCellOutput key={outputIndex} output={output} outputIndex={outputIndex} />
                      ))}
                    </div>
                  )}
                </div>
              </details>
            ))}
            {notebook.cells.length > 40 && (
              <div className="file-preview-note">First 40 cells shown.</div>
            )}
          </div>
        </div>
      ) : (
        <pre className="file-preview-code min-h-0 flex-1 overflow-auto" data-valid="false">
          {preview.text ?? ''}
        </pre>
      )}
    </div>
  )
}

function NotebookCodeCellBody({ cell }: { cell: NotebookCell }): JSX.Element {
  const description = cell.descriptionMarkdown?.trim() ?? ''
  if (description) {
    return (
      <div className="notebook-preview-code-with-description">
        <div
          className="notebook-preview-code-description"
          data-testid="notebook-preview-code-description"
          data-notebook-code-description="true"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
        </div>
        {cell.source ? (
          <details
            className="notebook-preview-code-source-disclosure"
            data-testid="notebook-preview-code-source-disclosure"
          >
            <summary>
              <Icon name="chevronRight" size={12} />
              <Icon name="code" size={12} />
              <span>Code</span>
            </summary>
            <NotebookCodeBlock code={cell.source} />
          </details>
        ) : (
          <pre>Empty cell</pre>
        )}
      </div>
    )
  }
  return cell.source ? <NotebookCodeBlock code={cell.source} /> : <pre>Empty cell</pre>
}

function NotebookCodeBlock({ code }: { code: string }): JSX.Element {
  return (
    <div className="notebook-preview-code-block" data-testid="notebook-preview-code-block">
      <div className="notebook-preview-code-block-title" data-notebook-code-title="Python">
        Python
      </div>
      <pre>{code}</pre>
    </div>
  )
}

function NotebookCellOutput({
  output,
  outputIndex
}: {
  output: NotebookOutput
  outputIndex: number
}): JSX.Element {
  if (output.type === 'image') {
    return (
      <div className="notebook-preview-output" data-notebook-output-type="image">
        <img src={output.dataUrl} alt={`Notebook output ${outputIndex + 1}`} />
      </div>
    )
  }
  if (output.type === 'html') {
    return (
      <div className="notebook-preview-output" data-notebook-output-type="html">
        <iframe
          title={`Notebook HTML output ${outputIndex + 1}`}
          sandbox=""
          srcDoc={notebookHtmlDocument(output.html)}
        />
        <NotebookRawOutputDisclosure text={output.html} />
      </div>
    )
  }
  if (output.type === 'markdown') {
    return (
      <div className="notebook-preview-output notebook-preview-output-markdown" data-notebook-output-type="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{output.markdown}</ReactMarkdown>
      </div>
    )
  }
  if (output.type === 'json') {
    return (
      <div className="notebook-preview-output" data-notebook-output-type="json">
        <NotebookOutputSummary summaryMarkdown={output.summaryMarkdown} />
        <NotebookRawOutput text={output.text} disclosed={Boolean(output.summaryMarkdown?.trim())} />
      </div>
    )
  }
  if (output.type === 'error') {
    return (
      <div className="notebook-preview-output notebook-preview-output-error" data-notebook-output-type="error">
        <NotebookOutputSummary summaryMarkdown={output.summaryMarkdown} />
        {output.summaryMarkdown?.trim() ? (
          <NotebookRawOutputDisclosure text={`${output.name}${output.message ? `: ${output.message}` : ''}${output.traceback ? `\n${output.traceback}` : ''}`} />
        ) : (
          <>
            <strong>{output.name}{output.message ? `: ${output.message}` : ''}</strong>
            {output.traceback && <pre>{output.traceback}</pre>}
          </>
        )}
      </div>
    )
  }
  return (
    <div className="notebook-preview-output" data-notebook-output-type={output.type}>
      <NotebookOutputSummary summaryMarkdown={output.summaryMarkdown} />
      <NotebookRawOutput text={output.text} disclosed={Boolean(output.summaryMarkdown?.trim())} />
    </div>
  )
}

function NotebookRawOutput({
  disclosed,
  text
}: {
  disclosed: boolean
  text: string
}): JSX.Element {
  return disclosed ? <NotebookRawOutputDisclosure text={text} /> : <pre>{text}</pre>
}

function NotebookRawOutputDisclosure({ text }: { text: string }): JSX.Element {
  return (
    <details
      className="notebook-preview-raw-output-disclosure"
      data-testid="notebook-preview-raw-output-disclosure"
      data-notebook-raw-output-disclosure="true"
    >
      <summary>Raw output</summary>
      <pre>{text}</pre>
    </details>
  )
}

function NotebookOutputSummary({ summaryMarkdown }: { summaryMarkdown?: string | null }): JSX.Element | null {
  const summary = summaryMarkdown?.trim()
  if (!summary) return null
  return (
    <div
      className="notebook-preview-output-summary"
      data-testid="notebook-preview-output-summary"
      data-notebook-output-summary="true"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
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

export function PreviewHeaderActions({
  actions,
  testId
}: {
  actions?: PreviewHeaderAction[]
  testId: string
}): JSX.Element | null {
  if (!actions?.length) return null
  const openFileAction = actions.find((action) => action.id === 'open-file')
  const revealFileAction = actions.find((action) => action.id === 'reveal-file')
  const visibleActions = openFileAction && revealFileAction
    ? actions.filter((action) => action.id !== 'open-file' && action.id !== 'reveal-file')
    : actions
  const controls = openFileAction && revealFileAction
    ? [...visibleActions.map((action) => action.id), 'open-options']
    : visibleActions.map((action) => action.id)
  return (
    <span
      className="file-preview-header-actions"
      data-testid={`${testId}-actions`}
      data-preview-controls={controls.join(' ')}
      data-artifact-open-options={openFileAction && revealFileAction ? 'true' : undefined}
    >
      {visibleActions.map((action) => (
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
      {openFileAction && revealFileAction && (
        <ArtifactOpenOptions
          openAction={openFileAction}
          revealAction={revealFileAction}
          testId={testId}
        />
      )}
    </span>
  )
}

export function ArtifactOpenOptions({
  openAction,
  revealAction,
  testId
}: {
  openAction: PreviewHeaderAction
  revealAction: PreviewHeaderAction
  testId: string
}): JSX.Element {
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const openMenu = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    setMenuStyle({
      position: 'fixed',
      right: Math.max(8, window.innerWidth - (rect?.right ?? window.innerWidth) - 2),
      top: (rect?.bottom ?? 0) + 6,
      width: 190,
      zIndex: 120
    })
  }
  const closeMenu = (): void => setMenuStyle(null)
  const select = (action: PreviewHeaderAction): void => {
    action.onClick()
    closeMenu()
  }

  return (
    <span
      ref={triggerRef}
      className="artifact-preview-open-options"
      data-testid={`${testId}-open-options-control`}
    >
      <IconButton
        icon={openAction.icon}
        label={openAction.label}
        size="sm"
        variant="toolbar"
        dataTestId={`${testId}-action-open-primary`}
        onClick={openAction.onClick}
      />
      <IconButton
        icon="chevronDown"
        label="Open options"
        size="sm"
        variant="toolbar"
        active={menuStyle !== null}
        dataTestId={`${testId}-action-open-options`}
        onClick={openMenu}
      />
      {menuStyle && (
        <MenuSurface
          data-testid={`${testId}-open-options-menu`}
          onClose={closeMenu}
          style={menuStyle}
        >
          <MenuSection dataTestId={`${testId}-open-options-menu-section`}>
            <MenuSectionLabel>Open</MenuSectionLabel>
            <MenuItem
              icon={openAction.icon}
              label={openAction.label}
              dataTestId={`${testId}-open-options-open-file`}
              onClick={() => select(openAction)}
            />
            <MenuItem
              icon={revealAction.icon}
              label={revealAction.label}
              dataTestId={`${testId}-open-options-reveal-file`}
              onClick={() => select(revealAction)}
            />
          </MenuSection>
        </MenuSurface>
      )}
    </span>
  )
}

export function ArtifactPreviewHeader({
  artifactType,
  centerContent,
  rightContent,
  testId,
  title
}: {
  artifactType: string
  centerContent?: JSX.Element | null
  rightContent?: JSX.Element | null
  testId: string
  title: string
}): JSX.Element {
  return (
    <PanelToolbar className="file-preview-header artifact-preview-header" dataTestId={`${testId}-header`}>
      <span className="artifact-preview-title-group">
        <span className="artifact-preview-title" data-artifact-preview-title={title} title={title}>
          {title}
        </span>
        <span className="artifact-preview-type" data-artifact-preview-type={artifactType}>
          {artifactType}
        </span>
      </span>
      <span className="artifact-preview-header-center" aria-hidden={centerContent ? undefined : 'true'}>
        {centerContent}
      </span>
      <span className="artifact-preview-header-right">
        {rightContent}
      </span>
    </PanelToolbar>
  )
}

export function stripArtifactExtension(name: string, extension: string): string {
  const suffix = `.${extension.replace(/^\./, '')}`
  return name.toLowerCase().endsWith(suffix.toLowerCase())
    ? name.slice(0, -suffix.length)
    : name
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
  title: string | null
  kernel: string | null
  cells: NotebookCell[]
} {
  try {
    const parsed = JSON.parse(text) as {
      metadata?: { title?: unknown; kernelspec?: { display_name?: unknown; name?: unknown } }
      cells?: Array<{ cell_type?: unknown; source?: unknown; outputs?: unknown }>
    }
    const cells = Array.isArray(parsed.cells)
      ? parsed.cells.map((cell) => {
        const metadata = normalizeNotebookMetadata(cell)
        const outputSummaries = normalizeNotebookOutputSummaries(metadata)
        return {
          type: typeof cell.cell_type === 'string' ? cell.cell_type : 'cell',
          source: normalizeNotebookSource(cell.source).trim(),
          title: normalizeNotebookMetadataString(metadata, ['title', 'cellTitle', 'cell_title']),
          descriptionMarkdown: normalizeNotebookMetadataString(metadata, [
            'codeDescriptionMarkdown',
            'code_description_markdown',
            'descriptionMarkdown',
            'description_markdown',
            'description'
          ]),
          executionCount: normalizeNotebookExecutionCount((cell as { execution_count?: unknown }).execution_count),
          outputs: normalizeNotebookOutputs(cell.outputs, outputSummaries)
        }
      })
      : []
    const kernel = parsed.metadata?.kernelspec?.display_name ?? parsed.metadata?.kernelspec?.name
    const title = parsed.metadata?.title
    return {
      valid: true,
      title: typeof title === 'string' && title.trim() ? title.trim() : null,
      kernel: typeof kernel === 'string' && kernel.trim() ? kernel : null,
      cells
    }
  } catch {
    return { valid: false, title: null, kernel: null, cells: [] }
  }
}

function normalizeNotebookExecutionCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function notebookCellTitle(cell: NotebookCell, cellNumber: number): string {
  if (cell.title?.trim()) return cell.title.trim()
  if (cell.type === 'markdown') {
    const heading = cell.source.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#{1,6}\s+/.test(line))
    if (heading) return heading.replace(/^#{1,6}\s+/, '').trim() || `Markdown cell ${cellNumber}`
    return `Markdown cell ${cellNumber}`
  }
  if (cell.type === 'raw') return `Raw cell ${cellNumber}`
  if (cell.type === 'code') return `Code cell ${cellNumber}`
  return `Cell ${cellNumber}`
}

function normalizeNotebookMetadata(cell: unknown): Array<Record<string, unknown>> {
  if (!cell || typeof cell !== 'object') return []
  const metadata = (cell as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== 'object') return []
  const record = metadata as Record<string, unknown>
  const nestedKeys = ['codex', 'codexNotebook', 'codex_notebook', 'codex-app']
  const nested = nestedKeys.flatMap((key) => {
    const value = record[key]
    return value && typeof value === 'object' && !Array.isArray(value)
      ? [value as Record<string, unknown>]
      : []
  })
  return [...nested, record]
}

function normalizeNotebookMetadataString(metadata: Array<Record<string, unknown>>, keys: string[]): string | null {
  for (const record of metadata) {
    for (const key of keys) {
      const value = record[key]
      const text = normalizeNotebookSource(value).trim()
      if (text) return text
    }
  }
  return null
}

function normalizeNotebookOutputSummaries(metadata: Array<Record<string, unknown>>): Array<string | null> {
  for (const record of metadata) {
    const outputSummaries = record.outputSummaries
    if (!Array.isArray(outputSummaries)) continue
    return outputSummaries.map((summary) => {
      if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
      return normalizeNotebookMetadataString([summary as Record<string, unknown>], ['summaryMarkdown'])
    })
  }
  return []
}

function normalizeNotebookSource(source: unknown): string {
  if (Array.isArray(source)) return source.map((part) => String(part)).join('')
  if (typeof source === 'string') return source
  return ''
}

function normalizeNotebookOutputs(outputs: unknown, outputSummaries: Array<string | null> = []): NotebookOutput[] {
  if (!Array.isArray(outputs)) return []
  return outputs.flatMap((output, outputIndex) => normalizeNotebookOutput(output, outputSummaries[outputIndex] ?? null))
}

function normalizeNotebookOutput(output: unknown, summaryMarkdown: string | null): NotebookOutput[] {
  if (!output || typeof output !== 'object') return []
  const record = output as Record<string, unknown>
  const outputType = typeof record.output_type === 'string' ? record.output_type : ''
  if (outputType === 'stream') {
    const text = normalizeNotebookOutputText(record.text)
    if (!text) return []
    return [{ type: 'stream', name: typeof record.name === 'string' ? record.name : 'stdout', text, summaryMarkdown }]
  }
  if (outputType === 'error') {
    const name = typeof record.ename === 'string' ? record.ename : 'Error'
    const message = typeof record.evalue === 'string' ? record.evalue : ''
    const traceback = normalizeNotebookOutputText(record.traceback)
    return [{ type: 'error', name, message, traceback, summaryMarkdown }]
  }
  if (outputType === 'display_data' || outputType === 'execute_result') {
    const data = record.data
    if (!data || typeof data !== 'object') return []
    const dataRecord = data as Record<string, unknown>
    const image = normalizeNotebookImage(dataRecord)
    if (image) return [image]
    const html = normalizeNotebookOutputText(dataRecord['text/html'])
    if (html.trim()) return [{ type: 'html', html }]
    const markdown = normalizeNotebookOutputText(dataRecord['text/markdown'])
    if (markdown.trim()) return [{ type: 'markdown', markdown }]
    const text = normalizeNotebookOutputText(dataRecord['text/plain'])
    if (text.trim()) return [{ type: 'text', text, summaryMarkdown }]
    const json = dataRecord['application/json'] ?? dataRecord['application/vnd.vega.v5+json']
    if (json !== undefined) return [{ type: 'json', text: normalizeNotebookJsonOutput(json), summaryMarkdown }]
  }
  return []
}

function normalizeNotebookImage(data: Record<string, unknown>): NotebookOutput | null {
  const png = normalizeNotebookOutputText(data['image/png']).replaceAll(/\s/g, '')
  if (png) return { type: 'image', dataUrl: `data:image/png;base64,${png}` }
  const jpeg = normalizeNotebookOutputText(data['image/jpeg']).replaceAll(/\s/g, '')
  if (jpeg) return { type: 'image', dataUrl: `data:image/jpeg;base64,${jpeg}` }
  const svg = normalizeNotebookOutputText(data['image/svg+xml'])
  if (svg.trim()) return { type: 'image', dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }
  return null
}

function normalizeNotebookOutputText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join('')
  return ''
}

function normalizeNotebookJsonOutput(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function notebookHtmlDocument(html: string): string {
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src data: blob:",
    "media-src data: blob:",
    "object-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'"
  ].join('; ')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="color-scheme" content="light dark"></head><body>${html}</body></html>`
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
