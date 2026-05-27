import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FilePreviewResult } from '../../env'
import type { WorkspaceSearchEntry, WorkspaceSearchResult } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { Badge, Button, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelHeader, PanelNotice, PanelToolbar, WorkbenchSearchField } from '../shared/designSystem'
import Icon from '../shared/Icon'
import ArtifactZoomControls from './ArtifactZoomControls'
import StructuredDataPreview, { ArtifactOpenOptions, ArtifactPreviewHeader, stripArtifactExtension, type PreviewHeaderAction } from './StructuredDataPreview'
import WorkbenchTree, { WorkbenchTreeMessage, type WorkbenchTreeRow } from './WorkbenchTree'

interface Props {
  sessionId?: string
  workDir: string
  embedded?: boolean
}

export default function FilesPanel({ sessionId, workDir, embedded = false }: Props): JSX.Element {
  const [searchResult, setSearchResult] = useState<WorkspaceSearchResult | null>(null)
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<FilePreviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([])
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  const openRightPanelFileTab = useSessionStore((state) => state.openRightPanelFileTab)
  const entries = searchResult?.entries ?? []
  const trimmedQuery = query.trim()
  const visibleEntries = useMemo(() => projectSearchEntries(entries, trimmedQuery), [entries, trimmedQuery])
  const selectedEntry = selectedPath ? visibleEntries.find((entry) => entry.path === selectedPath) ?? null : null
  const rowMenuEntry = rowMenu ? visibleEntries.find((entry) => entry.path === rowMenu.path) ?? null : null
  const fileTabFirst = embedded && Boolean(sessionId)
  const fileRows: WorkbenchTreeRow[] = visibleEntries.map((entry) => ({
    id: entry.path,
    name: entry.name,
    kind: entry.kind,
    depth: entry.depth,
    icon: entry.kind === 'directory' ? 'folder' : 'file',
    expandable: entry.kind === 'directory' && entry.hasChildren === true,
    expanded: entry.kind === 'directory' && expandedDirectories.includes(entry.path),
    loading: loading && entry.kind === 'directory' && expandedDirectories.includes(entry.path) && entry.loaded !== true,
    active: selectedPath === entry.path,
    title: entry.matchKind === 'content' && entry.matchText
      ? `${entry.path}:${entry.matchLine ?? ''} ${entry.matchText}`
      : entry.path,
    meta: entry.kind === 'file'
      ? entry.matchKind === 'content' && entry.matchLine
        ? `L${entry.matchLine}`
        : entry.size !== undefined
          ? formatBytes(entry.size)
          : undefined
      : undefined,
    className: 'files-entry-row',
    dataSearchMatchKind: entry.matchKind,
    dataSearchMatchLine: entry.matchLine,
    dataOpenTarget: entry.kind === 'file' && sessionId ? 'workbench-preview' : 'select',
    onSelect: () => setSelectedPath(entry.path),
    onOpen: entry.kind === 'file' && sessionId
      ? () => openRightPanelFileTab(sessionId, entry.path, { preview: true })
      : entry.kind === 'directory' && entry.hasChildren
        ? () => toggleDirectory(entry.path)
        : undefined,
    onContextMenu: (event) => openRowContextMenu(event, entry)
  }))

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    let cancelled = false
    setLoading(true)
    setPreview(null)
    const timeout = window.setTimeout(() => {
      window.api.fs.searchWorkspace({
        root: workDir,
        host: workDir,
        query,
        limit: 1200,
        includeDirectories: query.trim().length === 0,
        includeContentMatches: query.trim().length > 0,
        lazyDirectories: query.trim().length === 0,
        expandedDirectories
      })
        .then((result) => {
          if (cancelled || requestIdRef.current !== requestId) return
          setSearchResult(result)
          setSelectedPath((current) => {
            const projectedEntries = projectSearchEntries(result.entries, query.trim())
            if (current && projectedEntries.some((entry) => entry.path === current)) return current
            return result.entries.find((entry) => entry.kind === 'file')?.path ?? result.entries[0]?.path ?? null
          })
        })
        .catch(() => {
          if (cancelled || requestIdRef.current !== requestId) return
          setSearchResult({
            root: workDir,
            query,
            entries: [],
            visited: 0,
            truncated: false,
            durationMs: 0
          })
          setSelectedPath(null)
        })
        .finally(() => {
          if (!cancelled && requestIdRef.current === requestId) setLoading(false)
        })
    }, query.trim().length === 0 ? 0 : 120)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [expandedDirectories, query, workDir])

  useEffect(() => {
    setExpandedDirectories([])
  }, [workDir])

  useEffect(() => {
    const focusSearch = (): void => searchInputRef.current?.focus()
    window.addEventListener('orchestrator:focus-workspace-file-search', focusSearch)
    return () => window.removeEventListener('orchestrator:focus-workspace-file-search', focusSearch)
  }, [])

  useEffect(() => {
    if (selectedPath && !visibleEntries.some((entry) => entry.path === selectedPath)) {
      setSelectedPath(entries.find((entry) => entry.kind === 'file')?.path ?? entries[0]?.path ?? null)
    }
  }, [entries, selectedPath, visibleEntries])

  useEffect(() => {
    if (fileTabFirst || !selectedPath || selectedEntry?.kind !== 'file') {
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
  }, [fileTabFirst, selectedEntry?.kind, selectedPath, workDir])

  const openRowContextMenu = (event: ReactMouseEvent, entry: WorkspaceSearchEntry): void => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedPath(entry.path)
    setActionMenuOpen(false)
    setRowMenu({
      path: entry.path,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 196)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 238))
    })
  }

  const toggleDirectory = (path: string): void => {
    setExpandedDirectories((current) =>
      current.includes(path)
        ? current.filter((candidate) => candidate !== path && !candidate.startsWith(`${path}/`))
        : [...current, path]
    )
  }

  const openEntry = (entry: WorkspaceSearchEntry | null): void => {
    if (!entry) return
    void window.api.fs.openPath(joinPath(workDir, entry.path))
  }

  const openEntryInWorkbench = (entry: WorkspaceSearchEntry | null): void => {
    if (!sessionId || !entry || entry.kind !== 'file') return
    openRightPanelFileTab(sessionId, entry.path, { preview: true })
  }

  const revealEntry = (entry: WorkspaceSearchEntry | null): void => {
    if (!entry) return
    void window.api.fs.showInFolder(joinPath(workDir, entry.path))
  }

  const copyEntryPath = (entry: WorkspaceSearchEntry | null): void => {
    if (!entry) return
    void navigator.clipboard.writeText(entry.path)
  }

  const addEntryToChat = (entry: WorkspaceSearchEntry | null): void => {
    if (!entry || entry.kind !== 'file') return
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-attachment', {
      detail: {
        path: joinPath(workDir, entry.path),
        name: entry.name,
        size: entry.size
      }
    }))
  }

  const renderFileActionMenu = (
    entry: WorkspaceSearchEntry | null,
    close: () => void,
    testIdPrefix: string
  ): JSX.Element => (
    <>
      <MenuSection dataTestId={`${testIdPrefix}-file-section`}>
        <MenuSectionLabel>File</MenuSectionLabel>
        <MenuItem
          icon="paperclip"
          label="Add to chat"
          disabled={entry?.kind !== 'file'}
          dataTestId={`${testIdPrefix}-add-chat`}
          onClick={() => { addEntryToChat(entry); close() }}
        />
        <MenuItem
          icon="file"
          label="Open in Workbench"
          disabled={!sessionId || entry?.kind !== 'file'}
          dataTestId={`${testIdPrefix}-open-workbench`}
          onClick={() => { openEntryInWorkbench(entry); close() }}
        />
        <MenuItem icon="copy" label="Copy path" disabled={!entry} dataTestId={`${testIdPrefix}-copy-path`} onClick={() => { copyEntryPath(entry); close() }} />
      </MenuSection>
      <MenuSection dataTestId={`${testIdPrefix}-system-section`}>
        <MenuSectionLabel>System</MenuSectionLabel>
        <MenuItem icon="folder" label="Reveal file" disabled={!entry} dataTestId={`${testIdPrefix}-reveal`} onClick={() => { revealEntry(entry); close() }} />
        <MenuItem icon="file" label="Open file" disabled={!entry} dataTestId={`${testIdPrefix}-open-file`} onClick={() => { openEntry(entry); close() }} />
      </MenuSection>
    </>
  )

  const fileActions = (
    <div className="files-panel-actions relative">
      <IconButton
        icon="ellipsis"
        label="File actions"
        size="sm"
        variant="toolbar"
        disabled={!selectedEntry}
        active={actionMenuOpen}
        onClick={() => setActionMenuOpen((open) => !open)}
      />
      {actionMenuOpen && (
        <MenuSurface
          className="files-action-menu-surface"
          onClose={() => setActionMenuOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 178, zIndex: 90 }}
        >
          {renderFileActionMenu(selectedEntry, () => setActionMenuOpen(false), 'files-action-menu')}
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
      <PanelToolbar className="files-panel-toolbar" dataTestId="files-panel-toolbar">
        <WorkbenchSearchField
          inputRef={searchInputRef}
          value={query}
          onChange={setQuery}
          placeholder="Filter files..."
          clearLabel="Clear file filter"
          dataTestId="workspace-file-search"
          clearDataTestId="workspace-file-search-clear"
          className="files-panel-search flex-1"
        />
        <Badge
          tone="neutral"
          className="files-entry-count"
          title={searchResult?.truncated ? `Showing first ${entries.length} files from ${searchResult.visited} scanned entries` : undefined}
        >
          {entries.length}{searchResult?.truncated ? '+' : ''}
        </Badge>
        {embedded && fileActions}
      </PanelToolbar>
      <div
        className="files-panel-body"
        data-testid="files-panel-body"
        data-files-layout={fileTabFirst ? 'file-tabs' : 'split-preview'}
      >
        {loading && entries.length === 0 ? (
          <div className="files-panel-list" data-testid="files-panel-list">
            <FilesListState
              state={trimmedQuery ? 'searching' : 'loading'}
              title={trimmedQuery ? 'Searching files...' : 'Loading directory entries...'}
              testId="workspace-file-searching-list"
            />
          </div>
        ) : entries.length === 0 ? (
          <div className="files-panel-list" data-testid="files-panel-list">
            <FilesListState
              state={trimmedQuery ? 'no-matches' : 'empty'}
              title={trimmedQuery ? 'No matching files' : 'No files in this folder'}
              testId="workspace-file-empty-list"
            />
          </div>
        ) : (
          <WorkbenchTree
            rows={fileRows}
            ariaLabel="Workspace files"
            className="files-panel-list"
            dataTestId="files-panel-list"
            stickyDirectories
            revealActiveRow
            dataHost={workDir}
            dataLazyDirectories={trimmedQuery.length === 0}
          />
        )}
        {rowMenu && (
          <MenuSurface
            onClose={() => setRowMenu(null)}
            className="files-row-context-menu"
            style={{ position: 'fixed', left: rowMenu.x, top: rowMenu.y, width: 190, zIndex: 110 }}
          >
            <div data-testid="files-row-context-menu" data-file-row-context-path={rowMenuEntry?.path ?? ''}>
              {renderFileActionMenu(rowMenuEntry, () => setRowMenu(null), 'files-row-context-menu')}
            </div>
          </MenuSurface>
        )}
        {!fileTabFirst && (
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
        )}
      </div>
    </div>
  )
}

function FilesListState({
  title,
  testId,
  state
}: {
  title: string
  testId?: string
  state: 'loading' | 'searching' | 'empty' | 'no-matches'
}): JSX.Element {
  return (
    <WorkbenchTreeMessage dataTestId={testId} state={state}>
      {title}
    </WorkbenchTreeMessage>
  )
}

export function FilePreview({
  entry,
  absolutePath,
  preview,
  forceSource = false,
  sourceWrap = true,
  selectedSourceLine,
  sourceSearchQuery = '',
  sourceSearchActiveLine,
  sourceSearchMatchLines,
  sourceRevealLine,
  sourceRevealRequest,
  sourceAnnotationLines,
  onSelectedSourceLineChange,
  renderLineGutterAdornment,
  renderLineAnnotation,
  renderSelectedLineActions,
  structuredPreviewExtraActions = []
}: {
  entry: WorkspaceSearchEntry
  absolutePath: string
  preview: FilePreviewResult | null
  forceSource?: boolean
  sourceWrap?: boolean
  selectedSourceLine?: number | null
  sourceSearchQuery?: string
  sourceSearchActiveLine?: number | null
  sourceSearchMatchLines?: Set<number>
  sourceRevealLine?: number | null
  sourceRevealRequest?: number
  sourceAnnotationLines?: Set<number>
  onSelectedSourceLineChange?: (line: number) => void
  renderLineGutterAdornment?: (line: number) => ReactNode
  renderLineAnnotation?: (line: number) => ReactNode
  renderSelectedLineActions?: (line: number) => ReactNode
  structuredPreviewExtraActions?: PreviewHeaderAction[]
}): JSX.Element {
  if (!preview) {
    return (
      <EmptyFileState
        title={entry.name}
        body="Loading file..."
        meta="Fetching preview"
        testId="workspace-file-loading-state"
        state="loading"
      />
    )
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
      <PdfPreview
        entry={entry}
        absolutePath={absolutePath}
        preview={preview}
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
  if (forceSource && preview.text !== undefined) {
    return (
      <TextSourcePreview
        entry={entry}
        preview={preview}
        wrap={sourceWrap}
        selectedSourceLine={selectedSourceLine}
        sourceSearchQuery={sourceSearchQuery}
        sourceSearchActiveLine={sourceSearchActiveLine}
        sourceSearchMatchLines={sourceSearchMatchLines}
        sourceRevealLine={sourceRevealLine}
        sourceRevealRequest={sourceRevealRequest}
        sourceAnnotationLines={sourceAnnotationLines}
        onSelectedSourceLineChange={onSelectedSourceLineChange}
        renderLineGutterAdornment={renderLineGutterAdornment}
        renderLineAnnotation={renderLineAnnotation}
        renderSelectedLineActions={renderSelectedLineActions}
      />
    )
  }
  if (preview.kind === 'markdown') {
    return <MarkdownPreview name={entry.name} preview={preview} testId="workspace-markdown-preview" />
  }
  if (preview.kind === 'json') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-json-preview" actions={artifactPreviewActions(entry, absolutePath, preview, structuredPreviewExtraActions)} />
  }
  if (preview.kind === 'csv') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-csv-preview" actions={artifactPreviewActions(entry, absolutePath, preview, structuredPreviewExtraActions)} />
  }
  if (preview.kind === 'notebook') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-notebook-preview" actions={artifactPreviewActions(entry, absolutePath, preview, structuredPreviewExtraActions)} />
  }
  if (preview.kind === 'document') {
    return <StructuredDataPreview name={entry.name} preview={preview} testId="workspace-document-preview" actions={artifactPreviewActions(entry, absolutePath, preview, structuredPreviewExtraActions)} />
  }
  if (preview.kind === 'spreadsheet') {
    return (
      <SpreadsheetArtifactPreview
        absolutePath={absolutePath}
        entry={entry}
        preview={preview}
      />
    )
  }
  if (preview.kind === 'slides') {
    return (
      <SlidesArtifactPreview
        absolutePath={absolutePath}
        entry={entry}
        preview={preview}
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
    return (
      <EmptyFileState
        title={entry.name}
        body="Binary file not shown."
        meta={`Binary, ${formatBytes(preview.size ?? entry.size ?? 0)}`}
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
    <TextSourcePreview
      entry={entry}
      preview={preview}
      wrap={sourceWrap}
      selectedSourceLine={selectedSourceLine}
      sourceSearchQuery={sourceSearchQuery}
      sourceSearchActiveLine={sourceSearchActiveLine}
      sourceSearchMatchLines={sourceSearchMatchLines}
      sourceRevealLine={sourceRevealLine}
      sourceRevealRequest={sourceRevealRequest}
      sourceAnnotationLines={sourceAnnotationLines}
      onSelectedSourceLineChange={onSelectedSourceLineChange}
      renderLineGutterAdornment={renderLineGutterAdornment}
      renderLineAnnotation={renderLineAnnotation}
      renderSelectedLineActions={renderSelectedLineActions}
    />
  )
}

function TextSourcePreview({
  entry,
  preview,
  wrap,
  selectedSourceLine,
  sourceSearchQuery = '',
  sourceSearchActiveLine,
  sourceSearchMatchLines,
  sourceRevealLine,
  sourceRevealRequest = 0,
  sourceAnnotationLines,
  onSelectedSourceLineChange,
  renderLineGutterAdornment,
  renderLineAnnotation,
  renderSelectedLineActions
}: {
  entry: WorkspaceSearchEntry
  preview: FilePreviewResult
  wrap: boolean
  selectedSourceLine?: number | null
  sourceSearchQuery?: string
  sourceSearchActiveLine?: number | null
  sourceSearchMatchLines?: Set<number>
  sourceRevealLine?: number | null
  sourceRevealRequest?: number
  sourceAnnotationLines?: Set<number>
  onSelectedSourceLineChange?: (line: number) => void
  renderLineGutterAdornment?: (line: number) => ReactNode
  renderLineAnnotation?: (line: number) => ReactNode
  renderSelectedLineActions?: (line: number) => ReactNode
}): JSX.Element {
  const [localSelectedLine, setLocalSelectedLine] = useState<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const text = preview.text ?? ''
  const lines = text.length > 0 ? text.split('\n') : ['']
  const lineHeight = 22
  const virtualize = lines.length > 800
  const overscan = 24
  const visibleCount = Math.ceil((viewportHeight || lineHeight * 28) / lineHeight) + overscan * 2
  const startIndex = virtualize ? Math.max(0, Math.floor(Math.max(0, scrollTop - 40) / lineHeight) - overscan) : 0
  const endIndex = virtualize ? Math.min(lines.length, startIndex + visibleCount) : lines.length
  const visibleLines = virtualize ? lines.slice(startIndex, endIndex) : lines
  const topPadding = virtualize ? startIndex * lineHeight : 0
  const bottomPadding = virtualize ? Math.max(0, (lines.length - endIndex) * lineHeight) : 0
  const selectedLine = selectedSourceLine === undefined ? localSelectedLine : selectedSourceLine
  const revealedLine = sourceRevealLine ?? null
  const revealVisible = revealedLine !== null && revealedLine >= startIndex + 1 && revealedLine <= endIndex
  const trimmedSearchQuery = sourceSearchQuery.trim()
  const searchMatchCount = sourceSearchMatchLines?.size ?? 0
  const annotationCount = sourceAnnotationLines?.size ?? 0
  const selectLine = (line: number): void => {
    setLocalSelectedLine(line)
    onSelectedSourceLineChange?.(line)
  }

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = (): void => setViewportHeight(scroller.clientHeight)
    update()
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(scroller)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!sourceSearchActiveLine) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const targetTop = Math.max(0, (sourceSearchActiveLine - 1) * lineHeight - scroller.clientHeight / 3)
    if (virtualize) {
      scroller.scrollTop = targetTop
      setScrollTop(targetTop)
      return
    }
    window.requestAnimationFrame(() => {
      scroller
        .querySelector<HTMLElement>(`[data-source-line-number="${sourceSearchActiveLine}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [lineHeight, sourceSearchActiveLine, virtualize])

  useEffect(() => {
    if (!sourceRevealLine) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const clampedLine = Math.max(1, Math.min(lines.length, sourceRevealLine))
    const targetTop = Math.max(0, (clampedLine - 1) * lineHeight - scroller.clientHeight / 3)
    if (virtualize) {
      scroller.scrollTop = targetTop
      setScrollTop(targetTop)
      return
    }
    window.requestAnimationFrame(() => {
      scroller
        .querySelector<HTMLElement>(`[data-source-line-number="${clampedLine}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
  }, [lineHeight, lines.length, sourceRevealLine, sourceRevealRequest, virtualize])

  return (
    <div
      ref={scrollerRef}
      className="workspace-source-preview min-h-full"
      data-testid="workspace-text-preview"
      data-source-selected-line={selectedLine ?? ''}
      data-source-wrap={wrap ? 'true' : 'false'}
      data-source-virtualized={virtualize ? 'true' : 'false'}
      data-source-total-lines={lines.length}
      data-source-render-start={startIndex + 1}
      data-source-render-end={endIndex}
      data-source-render-count={visibleLines.length}
      data-source-search-query={trimmedSearchQuery}
      data-source-search-match-count={searchMatchCount}
      data-source-search-active-line={sourceSearchActiveLine ?? ''}
      data-source-revealed-line={revealedLine ?? ''}
      data-source-reveal-request={sourceRevealRequest}
      data-source-reveal-visible={revealVisible ? 'true' : 'false'}
      data-source-annotation-count={annotationCount}
      style={{ '--workspace-source-line-height': `${lineHeight}px` } as CSSProperties}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="workspace-source-header"
        style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
      >
        <Badge tone="neutral">Source</Badge>
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {preview.truncated && <span>Truncated</span>}
      </div>
      {preview.truncated && (
        <div
          className="px-3 py-2 text-[11px]"
          style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          Showing first {formatBytes(text.length)} of {formatBytes(preview.size ?? 0)}.
        </div>
      )}
      <div className="workspace-source-lines" role="grid" aria-label={`${entry.name} source`}>
        {topPadding > 0 && <div aria-hidden="true" style={{ height: topPadding }} />}
        {visibleLines.map((line, index) => {
          const lineNumber = startIndex + index + 1
          const selected = selectedLine === lineNumber
          const searchMatch = sourceSearchMatchLines?.has(lineNumber) ?? false
          const activeSearchMatch = sourceSearchActiveLine === lineNumber
          const revealed = revealedLine === lineNumber
          const hasAnnotation = sourceAnnotationLines?.has(lineNumber) ?? false
          return (
            <div key={lineNumber} className="workspace-source-line-wrap">
              <button
                type="button"
                className="workspace-source-line"
                role="row"
                aria-selected={selected}
                data-source-line-number={lineNumber}
                data-source-line-selected={selected ? 'true' : 'false'}
                data-source-line-search-match={searchMatch ? 'true' : 'false'}
                data-source-line-search-active={activeSearchMatch ? 'true' : 'false'}
                data-source-line-revealed={revealed ? 'true' : 'false'}
                data-source-line-has-annotation={hasAnnotation ? 'true' : 'false'}
                onClick={() => selectLine(lineNumber)}
              >
                <span className="workspace-source-gutter" role="gridcell">
                  <span className="workspace-source-gutter-number" data-source-line-number-content="">
                    {lineNumber}
                  </span>
                  {renderLineGutterAdornment?.(lineNumber)}
                </span>
                <code className="workspace-source-code" role="gridcell">{line || ' '}</code>
              </button>
              {selected && renderSelectedLineActions && (
                <div
                  className="workspace-source-line-actions"
                  data-testid="workspace-source-line-actions"
                  data-source-line-actions-for={lineNumber}
                >
                  {renderSelectedLineActions(lineNumber)}
                </div>
              )}
              {renderLineAnnotation && hasAnnotation && (
                <div
                  className="workspace-source-line-annotation-slot"
                  data-testid="workspace-source-line-annotation-slot"
                  data-source-line-annotation-for={lineNumber}
                >
                  {renderLineAnnotation(lineNumber)}
                </div>
              )}
            </div>
          )
        })}
        {bottomPadding > 0 && <div aria-hidden="true" style={{ height: bottomPadding }} />}
      </div>
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
  state = 'default',
  actions = []
}: {
  title: string
  body: string
  meta?: string
  testId?: string
  state?: 'default' | 'loading'
  actions?: Array<{ label: string; onClick: () => void }>
}): JSX.Element {
  return (
    <PanelNotice
      actions={actions.length > 0 ? (
        <>
          {actions.map((action) => (
            <Button
              key={action.label}
              className="file-fallback-action"
              onClick={action.onClick}
            >
              <Icon name={fallbackActionIcon(action.label)} size={12} />
              {action.label}
            </Button>
          ))}
        </>
      ) : undefined}
      className="file-fallback-state"
      code={meta}
      dataTestId={testId}
      description={body}
      icon={<Icon name={state === 'loading' ? 'clock' : 'file'} size={18} />}
      rootAttrs={{ 'data-file-state': state }}
      state={state}
      title={title}
    />
  )
}

function fallbackActionIcon(label: string): 'external' | 'folder' | 'file' {
  if (label === 'Open') return 'external'
  if (label === 'Reveal') return 'folder'
  return 'file'
}

function ArtifactHeaderActionButtons({
  actions,
  testId
}: {
  actions: PreviewHeaderAction[]
  testId: string
}): JSX.Element {
  const openFileAction = actions.find((action) => action.id === 'open-file')
  const revealFileAction = actions.find((action) => action.id === 'reveal-file')
  const visibleActions = openFileAction && revealFileAction
    ? actions.filter((action) => action.id !== 'open-file' && action.id !== 'reveal-file')
    : actions

  return (
    <>
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
    </>
  )
}

function artifactPreviewActions(
  entry: WorkspaceSearchEntry,
  absolutePath: string,
  preview: FilePreviewResult,
  extraActions: PreviewHeaderAction[] = []
): PreviewHeaderAction[] {
  const actions: PreviewHeaderAction[] = [
    {
      id: 'copy-path',
      icon: 'copy',
      label: 'Copy path',
      onClick: () => { void navigator.clipboard.writeText(entry.path) }
    }
  ]
  actions.push(...extraActions)
  if (preview.text !== undefined) {
    actions.push({
      id: 'copy-raw',
      icon: 'copy',
      label: 'Copy raw preview',
      onClick: () => { void navigator.clipboard.writeText(preview.text ?? '') }
    })
  }
  actions.push(
    {
      id: 'open-file',
      icon: 'external',
      label: 'Open',
      onClick: () => { void window.api.fs.openPath(absolutePath) }
    },
    {
      id: 'reveal-file',
      icon: 'folder',
      label: 'Open in folder',
      onClick: () => { void window.api.fs.showInFolder(absolutePath) }
    }
  )
  return actions
}

interface SpreadsheetPreviewPayload {
  sheets: Array<{
    name: string
    rows: SpreadsheetPreviewCell[][]
    merges?: SpreadsheetPreviewMerge[]
    tables?: SpreadsheetPreviewTable[]
    charts?: SpreadsheetPreviewChart[]
    drawings?: SpreadsheetPreviewDrawing[]
    sparklines?: SpreadsheetPreviewSparkline[]
    conditionalFormatCount?: number
    dataValidationCount?: number
    commentCount?: number
    drawingCount?: number
    sparklineCount?: number
    columnWidths?: Array<number | undefined>
    rowHeights?: Array<number | undefined>
    freezePanes?: SpreadsheetFreezePanes
  }>
  truncated?: boolean
}

interface SpreadsheetPreviewCell {
  value: string
  formula?: string
  fillColor?: string
  conditionalFillColor?: string
  dataValidation?: SpreadsheetPreviewDataValidation
  comment?: SpreadsheetPreviewCellComment
  borderColor?: string
  textColor?: string
  bold?: boolean
  wrapText?: boolean
  horizontalAlignment?: 'left' | 'center' | 'right'
  verticalAlignment?: 'top' | 'middle' | 'bottom'
}

interface SpreadsheetPreviewMerge {
  ref: string
  startRow: number
  startColumn: number
  rowSpan: number
  colSpan: number
}

interface SpreadsheetPreviewTable {
  ref: string
  name: string
  styleName?: string
  startRow: number
  startColumn: number
  rowSpan: number
  colSpan: number
  showFilterButton?: boolean
  showRowStripes?: boolean
}

interface SpreadsheetPreviewChart {
  title: string
  type: string
  sourceRange?: string
}

interface SpreadsheetPreviewDrawing {
  kind: 'shape' | 'image'
  name?: string
  description?: string
  text?: string
  geometry?: string
  fillColor?: string
  lineColor?: string
  row: number
  column: number
  rowOffsetPx?: number
  columnOffsetPx?: number
  widthPx?: number
  heightPx?: number
  toRow?: number
  toColumn?: number
  imageDataUrl?: string
  imageMimeType?: string
}

interface SpreadsheetPreviewSparkline {
  type: 'line' | 'column' | 'stacked'
  targetCell: string
  sourceRange: string
  values: number[]
  markers?: boolean
}

interface SpreadsheetPreviewChartDatum {
  label: string
  value: number
  address: string
}

interface SpreadsheetPreviewDataValidation {
  type: 'list'
  values?: string[]
  sourceRange?: string
  allowBlank?: boolean
  showInputMessage?: boolean
  promptTitle?: string
  prompt?: string
  showErrorMessage?: boolean
  errorTitle?: string
  error?: string
}

interface SpreadsheetPreviewCellComment {
  author?: string
  text: string
}

interface SpreadsheetFreezePanes {
  rows: number
  columns: number
}

interface SlidesPreviewPayload {
  slides: Array<{
    index: number
    title: string
    text: string[]
    notes?: string
    backgroundColor?: string
    shapes?: Array<{ text: string[]; x: number; y: number; width: number; height: number; fillColor?: string; textColor?: string; imageDataUrl?: string; imageMimeType?: string }>
  }>
  truncated?: boolean
}

interface PdfAnnotation {
  id: string
  page: number
  body: string
}

function spreadsheetColumnLabel(index: number): string {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function spreadsheetColumnIndex(address: string): number {
  const letters = /^[A-Z]+/.exec(address.toUpperCase())?.[0] ?? ''
  let value = 0
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64)
  return Math.max(0, value - 1)
}

function cloneSpreadsheetSheets(sheets: SpreadsheetPreviewPayload['sheets']): SpreadsheetPreviewPayload['sheets'] {
  return sheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.rows.map((row) => row.map((cell) => ({
      ...cell,
      ...(cell.dataValidation
        ? { dataValidation: { ...cell.dataValidation, values: cell.dataValidation.values ? [...cell.dataValidation.values] : undefined } }
        : {}),
      ...(cell.comment ? { comment: { ...cell.comment } } : {})
    }))),
    ...(sheet.merges ? { merges: sheet.merges.map((merge) => ({ ...merge })) } : {}),
    ...(sheet.tables ? { tables: sheet.tables.map((table) => ({ ...table })) } : {}),
    ...(sheet.charts ? { charts: sheet.charts.map((chart) => ({ ...chart })) } : {}),
    ...(sheet.drawings ? { drawings: sheet.drawings.map((drawing) => ({ ...drawing })) } : {}),
    ...(sheet.sparklines ? { sparklines: sheet.sparklines.map((sparkline) => ({ ...sparkline, values: [...sparkline.values] })) } : {}),
    ...(sheet.conditionalFormatCount ? { conditionalFormatCount: sheet.conditionalFormatCount } : {}),
    ...(sheet.dataValidationCount ? { dataValidationCount: sheet.dataValidationCount } : {}),
    ...(sheet.commentCount ? { commentCount: sheet.commentCount } : {}),
    ...(sheet.drawingCount ? { drawingCount: sheet.drawingCount } : {}),
    ...(sheet.sparklineCount ? { sparklineCount: sheet.sparklineCount } : {}),
    ...(sheet.columnWidths ? { columnWidths: [...sheet.columnWidths] } : {}),
    ...(sheet.rowHeights ? { rowHeights: [...sheet.rowHeights] } : {}),
    ...(sheet.freezePanes ? { freezePanes: { ...sheet.freezePanes } } : {})
  }))
}

function updateSpreadsheetCell(
  sheets: SpreadsheetPreviewPayload['sheets'],
  sheetIndex: number,
  rowIndex: number,
  columnIndex: number,
  input: string
): SpreadsheetPreviewPayload['sheets'] {
  const nextSheets = cloneSpreadsheetSheets(sheets)
  const sheet = nextSheets[sheetIndex]
  if (!sheet) return nextSheets
  while (sheet.rows.length <= rowIndex) sheet.rows.push([])
  const row = sheet.rows[rowIndex]
  while (row.length <= columnIndex) row.push({ value: '' })
  const trimmed = input.trim()
  const existingCell = row[columnIndex] ?? { value: '' }
  row[columnIndex] = trimmed.startsWith('=')
    ? { ...existingCell, value: '', formula: trimmed }
    : { ...existingCell, value: input, formula: undefined }
  return recalculateSpreadsheetSheets(nextSheets)
}

function updateSpreadsheetFreezePanes(
  sheets: SpreadsheetPreviewPayload['sheets'],
  sheetIndex: number,
  axis: 'row' | 'column',
  count: number
): SpreadsheetPreviewPayload['sheets'] {
  const nextSheets = cloneSpreadsheetSheets(sheets)
  const sheet = nextSheets[sheetIndex]
  if (!sheet) return nextSheets
  const rows = axis === 'row' ? Math.max(0, Math.min(6, Math.floor(count))) : (sheet.freezePanes?.rows ?? 0)
  const columns = axis === 'column' ? Math.max(0, Math.min(6, Math.floor(count))) : (sheet.freezePanes?.columns ?? 0)
  sheet.freezePanes = rows > 0 || columns > 0 ? { rows, columns } : undefined
  return nextSheets
}

function recalculateSpreadsheetSheets(sheets: SpreadsheetPreviewPayload['sheets']): SpreadsheetPreviewPayload['sheets'] {
  return sheets.map((sheet) => {
    const cellsByAddress = new Map<string, SpreadsheetPreviewCell>()
    sheet.rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        cellsByAddress.set(`${spreadsheetColumnLabel(columnIndex)}${rowIndex + 1}`, cell)
      })
    })
    const rows = sheet.rows.map((row) => row.map((cell) => {
      if (!cell.formula) return { ...cell }
      const computed = evaluateSpreadsheetFormula(cell.formula, cellsByAddress)
      return {
        ...cell,
        value: computed === null ? cell.value : formatSpreadsheetNumber(computed)
      }
    }))
    return { ...sheet, rows }
  })
}

function evaluateSpreadsheetFormula(formula: string, cellsByAddress: Map<string, SpreadsheetPreviewCell>): number | null {
  const expression = formula.replace(/^=/, '').trim()
  const sumMatch = /^SUM\(([^)]+)\)$/i.exec(expression)
  if (sumMatch) {
    return sumMatch[1]
      .split(',')
      .flatMap((part) => spreadsheetFormulaValues(part.trim(), cellsByAddress))
      .reduce((total, value) => total + value, 0)
  }
  const arithmetic = expression.replace(/\b[A-Z]{1,3}\d+\b/g, (address) => {
    return String(spreadsheetCellNumber(cellsByAddress.get(address.toUpperCase())))
  })
  if (!/^[\d+\-*/().\s]+$/.test(arithmetic)) return null
  return parseSpreadsheetArithmetic(arithmetic)
}

function parseSpreadsheetArithmetic(expression: string): number | null {
  let index = 0
  const skipSpace = (): void => {
    while (/\s/.test(expression[index] ?? '')) index += 1
  }
  const parseNumber = (): number | null => {
    skipSpace()
    const match = /^\d+(?:\.\d+)?/.exec(expression.slice(index))
    if (!match) return null
    index += match[0].length
    return Number(match[0])
  }
  const parseFactor = (): number | null => {
    skipSpace()
    const char = expression[index]
    if (char === '+') {
      index += 1
      return parseFactor()
    }
    if (char === '-') {
      index += 1
      const value = parseFactor()
      return value === null ? null : -value
    }
    if (char === '(') {
      index += 1
      const value = parseExpression()
      skipSpace()
      if (expression[index] !== ')') return null
      index += 1
      return value
    }
    return parseNumber()
  }
  const parseTerm = (): number | null => {
    let value = parseFactor()
    if (value === null) return null
    while (true) {
      skipSpace()
      const operator = expression[index]
      if (operator !== '*' && operator !== '/') break
      index += 1
      const right = parseFactor()
      if (right === null) return null
      value = operator === '*' ? value * right : value / right
    }
    return value
  }
  const parseExpression = (): number | null => {
    let value = parseTerm()
    if (value === null) return null
    while (true) {
      skipSpace()
      const operator = expression[index]
      if (operator !== '+' && operator !== '-') break
      index += 1
      const right = parseTerm()
      if (right === null) return null
      value = operator === '+' ? value + right : value - right
    }
    return value
  }
  const value = parseExpression()
  skipSpace()
  return value !== null && index === expression.length && Number.isFinite(value) ? value : null
}

function spreadsheetFormulaValues(reference: string, cellsByAddress: Map<string, SpreadsheetPreviewCell>): number[] {
  const rangeMatch = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i.exec(reference)
  if (!rangeMatch) return [spreadsheetCellNumber(cellsByAddress.get(reference.toUpperCase()))]
  const startColumn = spreadsheetColumnIndex(rangeMatch[1].toUpperCase())
  const endColumn = spreadsheetColumnIndex(rangeMatch[3].toUpperCase())
  const startRow = Number(rangeMatch[2])
  const endRow = Number(rangeMatch[4])
  const values: number[] = []
  for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) {
    for (let column = Math.min(startColumn, endColumn); column <= Math.max(startColumn, endColumn); column += 1) {
      values.push(spreadsheetCellNumber(cellsByAddress.get(`${spreadsheetColumnLabel(column)}${row}`)))
    }
  }
  return values
}

function parseSpreadsheetRangeRef(ref: string | undefined, sheetName: string): { startColumn: number; endColumn: number; startRow: number; endRow: number } | null {
  if (!ref) return null
  const trimmed = ref.trim()
  const sheetMatch = /^(?:'([^']+)'|([^!]+))!(.+)$/.exec(trimmed)
  const rangeRef = sheetMatch ? sheetMatch[3] : trimmed
  const refSheetName = sheetMatch?.[1] ?? sheetMatch?.[2]
  if (refSheetName && refSheetName !== sheetName) return null
  const rangeMatch = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/i.exec(rangeRef)
  if (!rangeMatch) return null
  const startColumn = spreadsheetColumnIndex(rangeMatch[1].toUpperCase())
  const endColumn = spreadsheetColumnIndex((rangeMatch[3] ?? rangeMatch[1]).toUpperCase())
  const startRow = Math.max(0, Number(rangeMatch[2]) - 1)
  const endRow = Math.max(0, Number(rangeMatch[4] ?? rangeMatch[2]) - 1)
  return {
    startColumn: Math.min(startColumn, endColumn),
    endColumn: Math.max(startColumn, endColumn),
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow)
  }
}

function spreadsheetChartData(
  sheet: SpreadsheetPreviewPayload['sheets'][number],
  chart: SpreadsheetPreviewChart
): SpreadsheetPreviewChartDatum[] {
  const range = parseSpreadsheetRangeRef(chart.sourceRange, sheet.name)
  if (!range) return []
  const rows: SpreadsheetPreviewChartDatum[] = []
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? []
    let valueColumn = -1
    let value = 0
    for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
      const candidate = Number(row[columnIndex]?.value ?? '')
      if (Number.isFinite(candidate)) {
        valueColumn = columnIndex
        value = candidate
        break
      }
    }
    if (valueColumn < 0) continue
    const labelCell = valueColumn > 0 ? row[valueColumn - 1] : undefined
    const label = labelCell?.value?.trim() || `${spreadsheetColumnLabel(valueColumn)}${rowIndex + 1}`
    rows.push({
      label,
      value,
      address: `${spreadsheetColumnLabel(valueColumn)}${rowIndex + 1}`
    })
  }
  return rows.slice(0, 12)
}

function spreadsheetDrawingAnchorLabel(drawing: SpreadsheetPreviewDrawing): string {
  const from = `${spreadsheetColumnLabel(drawing.column)}${drawing.row + 1}`
  const to = drawing.toRow !== undefined && drawing.toColumn !== undefined
    ? `${spreadsheetColumnLabel(drawing.toColumn)}${drawing.toRow + 1}`
    : ''
  const size = drawing.widthPx !== undefined && drawing.heightPx !== undefined
    ? `${drawing.widthPx}x${drawing.heightPx}px`
    : ''
  return [to ? `${from}:${to}` : from, size].filter(Boolean).join(' · ')
}

function spreadsheetSparklinePoints(values: number[]): string {
  return spreadsheetSparklinePointData(values)
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
}

function spreadsheetSparklinePointData(values: number[]): Array<{ x: number; y: number; value: number }> {
  const finiteValues = values.filter((value) => Number.isFinite(value)).slice(0, 32)
  if (finiteValues.length === 0) return []
  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  const range = max - min || 1
  return finiteValues
    .map((value, index) => {
      const x = finiteValues.length === 1 ? 48 : 8 + (index * 80) / (finiteValues.length - 1)
      const y = 24 - ((value - min) / range) * 18
      return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), value }
    })
}

function spreadsheetCellNumber(cell: SpreadsheetPreviewCell | undefined): number {
  const value = Number(cell?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

function formatSpreadsheetNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(8)))
}

function spreadsheetMergeLookup(merges: SpreadsheetPreviewMerge[]): {
  starts: Map<string, SpreadsheetPreviewMerge>
  covered: Set<string>
} {
  const starts = new Map<string, SpreadsheetPreviewMerge>()
  const covered = new Set<string>()
  for (const merge of merges) {
    starts.set(`${merge.startRow}:${merge.startColumn}`, merge)
    for (let row = merge.startRow; row < merge.startRow + merge.rowSpan; row += 1) {
      for (let column = merge.startColumn; column < merge.startColumn + merge.colSpan; column += 1) {
        if (row === merge.startRow && column === merge.startColumn) continue
        covered.add(`${row}:${column}`)
      }
    }
  }
  return { starts, covered }
}

function spreadsheetTableLookup(tables: SpreadsheetPreviewTable[]): Map<string, { table: SpreadsheetPreviewTable; isHeader: boolean; isBandedRow: boolean }> {
  const cells = new Map<string, { table: SpreadsheetPreviewTable; isHeader: boolean; isBandedRow: boolean }>()
  for (const table of tables) {
    for (let row = table.startRow; row < table.startRow + table.rowSpan; row += 1) {
      for (let column = table.startColumn; column < table.startColumn + table.colSpan; column += 1) {
        const relativeRow = row - table.startRow
        cells.set(`${row}:${column}`, {
          table,
          isHeader: relativeRow === 0,
          isBandedRow: table.showRowStripes === true && relativeRow > 0 && relativeRow % 2 === 1
        })
      }
    }
  }
  return cells
}

function spreadsheetDimensionOffset(values: Array<number | undefined> | undefined, index: number, fallback: number): number {
  let offset = 0
  for (let itemIndex = 0; itemIndex < index; itemIndex += 1) offset += values?.[itemIndex] ?? fallback
  return offset
}

function spreadsheetFreezeCountFromOffset(
  offset: number,
  values: Array<number | undefined> | undefined,
  fallback: number,
  maxCount: number
): number {
  const cappedMax = Math.max(0, Math.min(6, maxCount))
  if (offset <= 0 || cappedMax === 0) return 0
  let edge = 0
  let nearest = 0
  let nearestDistance = Math.abs(offset)
  for (let index = 0; index < cappedMax; index += 1) {
    edge += values?.[index] ?? fallback
    const distance = Math.abs(offset - edge)
    if (distance < nearestDistance) {
      nearest = index + 1
      nearestDistance = distance
    }
  }
  return nearest
}

function spreadsheetAlignItems(alignment: 'top' | 'middle' | 'bottom'): CSSProperties['alignItems'] {
  if (alignment === 'middle') return 'center'
  if (alignment === 'bottom') return 'flex-end'
  return 'flex-start'
}

function spreadsheetJustifyContent(alignment: 'left' | 'center' | 'right'): CSSProperties['justifyContent'] {
  if (alignment === 'center') return 'center'
  if (alignment === 'right') return 'flex-end'
  return 'flex-start'
}

function SpreadsheetArtifactPreview({
  absolutePath,
  entry,
  preview
}: {
  absolutePath: string
  entry: WorkspaceSearchEntry
  preview: FilePreviewResult
}): JSX.Element {
  const title = stripArtifactExtension(stripArtifactExtension(entry.name, 'xlsx'), 'xlsm')
  const actions = artifactPreviewActions(entry, absolutePath, preview)
  const payload = useMemo(() => parseSpreadsheetPreview(preview.text), [preview.text])
  const initialSheets = useMemo(() => cloneSpreadsheetSheets(payload?.sheets ?? []), [payload])
  const [sheets, setSheets] = useState(initialSheets)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [fitToWidth, setFitToWidth] = useState(false)
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 })
  const [formulaDraft, setFormulaDraft] = useState('')
  const [validationOverlay, setValidationOverlay] = useState<{ row: number; column: number } | null>(null)
  const [editCount, setEditCount] = useState(0)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const activeSheet = sheets[activeSheetIndex] ?? null
  const sheetCount = sheets.length
  const effectiveZoomPercent = fitToWidth ? 100 : zoomPercent
  const activeSheetMergeLookup = useMemo(() => spreadsheetMergeLookup(activeSheet?.merges ?? []), [activeSheet?.merges])
  const activeSheetTableLookup = useMemo(() => spreadsheetTableLookup(activeSheet?.tables ?? []), [activeSheet?.tables])
  const maxColumnCount = activeSheet
    ? Math.max(
        1,
        ...activeSheet.rows.map((row) => row.length),
        ...(activeSheet.merges ?? []).map((merge) => merge.startColumn + merge.colSpan),
        ...(activeSheet.tables ?? []).map((table) => table.startColumn + table.colSpan),
        ...(activeSheet.drawings ?? []).map((drawing) => drawing.column + Math.max(1, Math.ceil((drawing.widthPx ?? 88) / 88)))
      )
    : 1
  const activeCellRow = activeSheet ? Math.min(activeCell.row, Math.max(0, activeSheet.rows.length - 1)) : 0
  const activeCellColumn = activeSheet ? Math.min(activeCell.column, Math.max(0, maxColumnCount - 1)) : 0
  const activeCellAddress = `${spreadsheetColumnLabel(activeCellColumn)}${activeCellRow + 1}`
  const activeCellData = activeSheet?.rows[activeCellRow]?.[activeCellColumn] ?? null
  const activeCellValue = activeCellData?.value ?? ''
  const activeCellFormula = activeCellData?.formula ?? ''
  const validationOverlayCell = validationOverlay && activeSheet
    ? activeSheet.rows[validationOverlay.row]?.[validationOverlay.column] ?? null
    : null
  const validationOverlayAddress = validationOverlay
    ? `${spreadsheetColumnLabel(validationOverlay.column)}${validationOverlay.row + 1}`
    : ''
  const activeValidation = activeCellData?.dataValidation
  const activeValidationHasMessage = Boolean(activeValidation?.promptTitle || activeValidation?.prompt || activeValidation?.errorTitle || activeValidation?.error)
  const styledCellCount = activeSheet
    ? activeSheet.rows.reduce((count, row) => count + row.filter((cell) => Boolean(cell.fillColor || cell.conditionalFillColor || cell.borderColor || cell.textColor || cell.bold || cell.wrapText || cell.horizontalAlignment || cell.verticalAlignment)).length, 0)
    : 0
  const alignedCellCount = activeSheet
    ? activeSheet.rows.reduce((count, row) => count + row.filter((cell) => Boolean(cell.wrapText || cell.horizontalAlignment || cell.verticalAlignment)).length, 0)
    : 0
  const mergeCount = activeSheet?.merges?.length ?? 0
  const tableCount = activeSheet?.tables?.length ?? 0
  const chartCount = activeSheet?.charts?.length ?? 0
  const drawingCount = activeSheet?.drawingCount ?? activeSheet?.drawings?.length ?? 0
  const sparklineCount = activeSheet?.sparklineCount ?? activeSheet?.sparklines?.length ?? 0
  const conditionalFormatCount = activeSheet?.conditionalFormatCount ?? 0
  const dataValidationCount = activeSheet?.dataValidationCount ?? 0
  const commentCount = activeSheet?.commentCount ?? 0
  const commentCells = activeSheet
    ? activeSheet.rows.flatMap((row, rowIndex) =>
        row
          .map((cell, columnIndex) => ({ cell, address: `${spreadsheetColumnLabel(columnIndex)}${rowIndex + 1}` }))
          .filter((entry): entry is { cell: SpreadsheetPreviewCell & { comment: SpreadsheetPreviewCellComment }; address: string } => Boolean(entry.cell.comment))
      )
    : []
  const borderCellCount = activeSheet
    ? activeSheet.rows.reduce((count, row) => count + row.filter((cell) => Boolean(cell.borderColor)).length, 0)
    : 0
  const sizedColumnCount = activeSheet?.columnWidths?.filter((width) => width !== undefined).length ?? 0
  const sizedRowCount = activeSheet?.rowHeights?.filter((height) => height !== undefined).length ?? 0
  const frozenRowCount = activeSheet?.freezePanes?.rows ?? 0
  const frozenColumnCount = activeSheet?.freezePanes?.columns ?? 0
  const freezeColumnLineLeft = 38 + spreadsheetDimensionOffset(activeSheet?.columnWidths, frozenColumnCount, 88)
  const freezeRowLineTop = 26 + spreadsheetDimensionOffset(activeSheet?.rowHeights, frozenRowCount, 29)
  useEffect(() => {
    setActiveSheetIndex((index) => Math.min(Math.max(index, 0), Math.max(0, sheetCount - 1)))
  }, [sheetCount])
  useEffect(() => {
    setSheets(initialSheets)
    setActiveSheetIndex(0)
    setActiveCell({ row: 0, column: 0 })
    setValidationOverlay(null)
    setEditCount(0)
  }, [initialSheets])
  useEffect(() => {
    setFormulaDraft(activeCellFormula || activeCellValue)
  }, [activeSheetIndex, activeCellRow, activeCellColumn, activeCellFormula, activeCellValue])
  const selectSheet = (index: number): void => {
    setActiveSheetIndex(Math.min(Math.max(index, 0), Math.max(0, sheetCount - 1)))
    setActiveCell({ row: 0, column: 0 })
    setValidationOverlay(null)
  }
  const commitFormulaDraft = (nextInput = formulaDraft): void => {
    if (!activeSheet) return
    if (nextInput === (activeCellFormula || activeCellValue)) return
    setSheets((items) => updateSpreadsheetCell(items, activeSheetIndex, activeCellRow, activeCellColumn, nextInput))
    setValidationOverlay(null)
    setEditCount((count) => count + 1)
  }
  const applyDataValidationValue = (rowIndex: number, columnIndex: number, value: string): void => {
    if (!activeSheet) return
    setActiveCell({ row: rowIndex, column: columnIndex })
    setSheets((items) => updateSpreadsheetCell(items, activeSheetIndex, rowIndex, columnIndex, value))
    setValidationOverlay(null)
    setEditCount((count) => count + 1)
  }
  const freezeCountFromPointer = (axis: 'row' | 'column', clientX: number, clientY: number): number => {
    const rect = tableWrapRef.current?.getBoundingClientRect()
    if (!rect || !activeSheet) return axis === 'row' ? frozenRowCount : frozenColumnCount
    if (axis === 'column') {
      return spreadsheetFreezeCountFromOffset(clientX - rect.left - 38, activeSheet.columnWidths, 88, maxColumnCount)
    }
    return spreadsheetFreezeCountFromOffset(clientY - rect.top - 26, activeSheet.rowHeights, 29, activeSheet.rows.length)
  }
  const beginFreezePaneDrag = (axis: 'row' | 'column', event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const update = (clientX: number, clientY: number): void => {
      const count = freezeCountFromPointer(axis, clientX, clientY)
      setSheets((items) => updateSpreadsheetFreezePanes(items, activeSheetIndex, axis, count))
    }
    update(event.clientX, event.clientY)
    const handleMove = (pointerEvent: PointerEvent): void => {
      update(pointerEvent.clientX, pointerEvent.clientY)
    }
    const handleUp = (pointerEvent: PointerEvent): void => {
      update(pointerEvent.clientX, pointerEvent.clientY)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }
  return (
    <div
      className="file-structured-preview workspace-office-artifact-preview flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="workspace-spreadsheet-preview"
      data-artifact-preview-kind={preview.kind}
      data-artifact-preview-size={preview.size ?? entry.size ?? 0}
      data-spreadsheet-preview-rendered={payload ? 'true' : 'false'}
      data-spreadsheet-preview-sheet-count={sheetCount}
      data-spreadsheet-active-sheet-index={activeSheetIndex + 1}
      data-spreadsheet-active-sheet-name={activeSheet?.name ?? ''}
      data-spreadsheet-preview-zoom-percent={zoomPercent}
      data-spreadsheet-preview-zoom-fit={fitToWidth ? 'true' : 'false'}
      data-spreadsheet-active-cell-address={activeSheet ? activeCellAddress : ''}
      data-spreadsheet-active-cell-value={activeSheet ? activeCellValue : ''}
      data-spreadsheet-active-cell-formula={activeSheet ? activeCellFormula : ''}
      data-spreadsheet-style-cell-count={styledCellCount}
      data-spreadsheet-aligned-cell-count={alignedCellCount}
      data-spreadsheet-merge-count={mergeCount}
      data-spreadsheet-table-count={tableCount}
      data-spreadsheet-chart-count={chartCount}
      data-spreadsheet-drawing-count={drawingCount}
      data-spreadsheet-sparkline-count={sparklineCount}
      data-spreadsheet-conditional-format-count={conditionalFormatCount}
      data-spreadsheet-data-validation-count={dataValidationCount}
      data-spreadsheet-comment-count={commentCount}
      data-spreadsheet-border-cell-count={borderCellCount}
      data-spreadsheet-sized-column-count={sizedColumnCount}
      data-spreadsheet-sized-row-count={sizedRowCount}
      data-spreadsheet-frozen-row-count={frozenRowCount}
      data-spreadsheet-frozen-column-count={frozenColumnCount}
      data-spreadsheet-freeze-handles="true"
      data-spreadsheet-editable="local-preview"
      data-spreadsheet-edit-count={editCount}
      data-spreadsheet-data-validation-overlay-open={validationOverlayCell?.dataValidation?.type === 'list' ? 'true' : 'false'}
      data-spreadsheet-data-validation-overlay-address={validationOverlayCell?.dataValidation?.type === 'list' ? validationOverlayAddress : ''}
      data-spreadsheet-data-validation-overlay-value={validationOverlayCell?.dataValidation?.type === 'list' ? validationOverlayCell.value : ''}
      data-spreadsheet-active-data-validation-prompt-title={activeValidation?.promptTitle ?? ''}
      data-spreadsheet-active-data-validation-prompt={activeValidation?.prompt ?? ''}
      data-spreadsheet-active-data-validation-error-title={activeValidation?.errorTitle ?? ''}
      data-spreadsheet-active-data-validation-error={activeValidation?.error ?? ''}
    >
      <ArtifactPreviewHeader
        artifactType="XLSX"
        centerContent={payload
          ? (
              <span
                className="file-preview-page-controls"
                data-testid="workspace-spreadsheet-preview-sheet-controls"
                data-spreadsheet-current-sheet={activeSheetIndex + 1}
                data-spreadsheet-sheet-count={sheetCount}
              >
                <IconButton
                  icon="arrowLeft"
                  label="Previous sheet"
                  size="sm"
                  variant="toolbar"
                  disabled={activeSheetIndex <= 0}
                  dataTestId="workspace-spreadsheet-preview-sheet-previous"
                  onClick={() => { selectSheet(activeSheetIndex - 1) }}
                />
                <span className="file-preview-page-indicator" data-testid="workspace-spreadsheet-preview-sheet-indicator">
                  {activeSheetIndex + 1}/{Math.max(1, sheetCount)}
                </span>
                <IconButton
                  icon="arrowRight"
                  label="Next sheet"
                  size="sm"
                  variant="toolbar"
                  disabled={activeSheetIndex >= sheetCount - 1}
                  dataTestId="workspace-spreadsheet-preview-sheet-next"
                  onClick={() => { selectSheet(activeSheetIndex + 1) }}
                />
              </span>
            )
          : null}
        rightContent={(
          <span
            className="file-preview-header-actions"
            data-testid="workspace-spreadsheet-preview-actions"
            data-preview-controls="copy-path spreadsheet-sheet-navigation spreadsheet-zoom spreadsheet-zoom-fit open-options"
            data-artifact-open-options="true"
          >
            {payload && (
              <ArtifactZoomControls
                fitToWidth={fitToWidth}
                kind="spreadsheet"
                onFitToWidthChange={setFitToWidth}
                onZoomPercentChange={setZoomPercent}
                testId="workspace-spreadsheet-preview"
                zoomPercent={zoomPercent}
              />
            )}
            <ArtifactHeaderActionButtons actions={actions} testId="workspace-spreadsheet-preview" />
          </span>
        )}
        testId="workspace-spreadsheet-preview"
        title={title}
      />
      <div className="workspace-office-preview-body" data-testid="workspace-spreadsheet-preview-body">
        {activeSheet ? (
          <>
            <section
              className="workspace-spreadsheet-sheet"
              data-testid="workspace-spreadsheet-preview-sheet"
              data-spreadsheet-sheet-name={activeSheet.name}
              data-spreadsheet-sheet-index={activeSheetIndex + 1}
            >
              <div className="workspace-office-section-heading">
                <Icon name="file" size={14} />
                <span>{activeSheet.name}</span>
              </div>
              <div
                className="workspace-spreadsheet-formula-bar"
                data-testid="workspace-spreadsheet-formula-bar"
                data-spreadsheet-active-cell-address={activeCellAddress}
                data-spreadsheet-active-cell-value={activeCellValue}
                data-spreadsheet-active-cell-formula={activeCellFormula}
                data-spreadsheet-active-cell-kind={activeCellFormula ? 'formula' : 'value'}
                data-spreadsheet-edit-count={editCount}
              >
                <span
                  className="workspace-spreadsheet-cell-address"
                  data-testid="workspace-spreadsheet-active-cell-address"
                >
                  {activeCellAddress}
                </span>
                <input
                  className="workspace-spreadsheet-formula-value"
                  data-testid="workspace-spreadsheet-active-cell-value"
                  data-spreadsheet-active-cell-value={activeCellValue}
                  data-spreadsheet-active-cell-formula={activeCellFormula}
                  aria-label="Active cell formula or value"
                  value={formulaDraft}
                  onChange={(event) => { setFormulaDraft(event.currentTarget.value) }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitFormulaDraft(event.currentTarget.value)
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  dataTestId="workspace-spreadsheet-formula-apply"
                  disabled={formulaDraft === (activeCellFormula || activeCellValue)}
                  onClick={commitFormulaDraft}
                >
                  Apply
                </Button>
              </div>
              {activeValidationHasMessage && (
                <div
                  className="workspace-spreadsheet-validation-message"
                  data-testid="workspace-spreadsheet-validation-message"
                  data-spreadsheet-data-validation-prompt-title={activeValidation?.promptTitle ?? ''}
                  data-spreadsheet-data-validation-prompt={activeValidation?.prompt ?? ''}
                  data-spreadsheet-data-validation-error-title={activeValidation?.errorTitle ?? ''}
                  data-spreadsheet-data-validation-error={activeValidation?.error ?? ''}
                >
                  {(activeValidation?.promptTitle || activeValidation?.prompt) && (
                    <div className="workspace-spreadsheet-validation-message-block" data-spreadsheet-validation-message-kind="input">
                      {activeValidation.promptTitle ? <div className="workspace-spreadsheet-validation-message-title">{activeValidation.promptTitle}</div> : null}
                      {activeValidation.prompt ? <div className="workspace-spreadsheet-validation-message-body">{activeValidation.prompt}</div> : null}
                    </div>
                  )}
                  {(activeValidation?.errorTitle || activeValidation?.error) && (
                    <div className="workspace-spreadsheet-validation-message-block" data-spreadsheet-validation-message-kind="error">
                      {activeValidation.errorTitle ? <div className="workspace-spreadsheet-validation-message-title">{activeValidation.errorTitle}</div> : null}
                      {activeValidation.error ? <div className="workspace-spreadsheet-validation-message-body">{activeValidation.error}</div> : null}
                    </div>
                  )}
                </div>
              )}
              <div
                ref={tableWrapRef}
                className="workspace-spreadsheet-table-wrap"
                data-testid="workspace-spreadsheet-table-wrap"
                data-spreadsheet-freeze-column-line={frozenColumnCount > 0 ? 'true' : 'false'}
                data-spreadsheet-freeze-row-line={frozenRowCount > 0 ? 'true' : 'false'}
              >
                <table
                  className="workspace-spreadsheet-table"
                  data-testid="workspace-spreadsheet-preview-table"
                  style={{ fontSize: `${Math.max(10, Math.min(18, 12 * (effectiveZoomPercent / 100)))}px` }}
                >
                  <colgroup>
                    <col style={{ width: 38, minWidth: 38 }} />
                    {Array.from({ length: maxColumnCount }, (_, columnIndex) => {
                      const width = activeSheet.columnWidths?.[columnIndex]
                      return (
                        <col
                          key={columnIndex}
                          data-testid="workspace-spreadsheet-column-size"
                          data-spreadsheet-column-label={spreadsheetColumnLabel(columnIndex)}
                          data-spreadsheet-column-width={width ?? ''}
                          style={{ width: width ?? undefined, minWidth: width ?? undefined }}
                        />
                      )
                    })}
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        className="workspace-spreadsheet-corner"
                        scope="col"
                        aria-label="Workbook grid corner"
                        style={{ position: 'sticky', left: 0, top: 0, zIndex: 6 }}
                      />
                      {Array.from({ length: maxColumnCount }, (_, columnIndex) => (
                        <th
                          key={columnIndex}
                          className="workspace-spreadsheet-column-header"
                          data-testid="workspace-spreadsheet-column-header"
                          data-spreadsheet-column-label={spreadsheetColumnLabel(columnIndex)}
                          data-spreadsheet-column-width={activeSheet.columnWidths?.[columnIndex] ?? ''}
                          data-spreadsheet-column-frozen={columnIndex < frozenColumnCount ? 'true' : 'false'}
                          style={{
                            position: 'sticky',
                            top: 0,
                            left: columnIndex < frozenColumnCount
                              ? 38 + spreadsheetDimensionOffset(activeSheet.columnWidths, columnIndex, 88)
                              : undefined,
                            width: activeSheet.columnWidths?.[columnIndex],
                            minWidth: activeSheet.columnWidths?.[columnIndex],
                            zIndex: columnIndex < frozenColumnCount ? 5 : 4
                          }}
                          scope="col"
                        >
                          {spreadsheetColumnLabel(columnIndex)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.rows.map((row, rowIndex) => {
                      const rowHeight = activeSheet.rowHeights?.[rowIndex]
                      const frozenRowTop = rowIndex < frozenRowCount
                        ? 26 + spreadsheetDimensionOffset(activeSheet.rowHeights, rowIndex, 29)
                        : undefined
                      return (
                        <tr
                          key={rowIndex}
                          data-spreadsheet-row-height={rowHeight ?? ''}
                          style={{ height: rowHeight }}
                        >
                        <th
                          className="workspace-spreadsheet-row-header"
                          data-testid="workspace-spreadsheet-row-header"
                          data-spreadsheet-row-label={rowIndex + 1}
                          data-spreadsheet-row-height={rowHeight ?? ''}
                          data-spreadsheet-row-frozen={rowIndex < frozenRowCount ? 'true' : 'false'}
                          style={{
                            position: 'sticky',
                            left: 0,
                            top: frozenRowTop,
                            zIndex: rowIndex < frozenRowCount ? 5 : 3
                          }}
                          scope="row"
                        >
                          {rowIndex + 1}
                        </th>
                        {Array.from({ length: maxColumnCount }, (_, cellIndex) => {
                          if (activeSheetMergeLookup.covered.has(`${rowIndex}:${cellIndex}`)) return null
                          const cell = row[cellIndex] ?? { value: '' }
                          const cellAddress = `${spreadsheetColumnLabel(cellIndex)}${rowIndex + 1}`
                          const isActive = rowIndex === activeCellRow && cellIndex === activeCellColumn
                          const merge = activeSheetMergeLookup.starts.get(`${rowIndex}:${cellIndex}`)
                          const tableCell = activeSheetTableLookup.get(`${rowIndex}:${cellIndex}`)
                          const tableName = tableCell?.table.name ?? ''
                          const tableStyleName = tableCell?.table.styleName ?? ''
                          const isTableHeaderCell = tableCell?.isHeader === true
                          const isTableBandedCell = tableCell?.isBandedRow === true
                          const hasTableFilterButton = isTableHeaderCell && tableCell?.table.showFilterButton === true
                          const hasDataValidationButton = cell.dataValidation?.type === 'list'
                          const dataValidationValues = cell.dataValidation?.values ?? []
                          const hasComment = Boolean(cell.comment?.text)
                          const isValidationOverlayOpen = Boolean(
                            hasDataValidationButton &&
                            validationOverlay?.row === rowIndex &&
                            validationOverlay.column === cellIndex
                          )
                          const frozenColumnLeft = cellIndex < frozenColumnCount
                            ? 38 + spreadsheetDimensionOffset(activeSheet.columnWidths, cellIndex, 88)
                            : undefined
                          const isFrozenCell = rowIndex < frozenRowCount || cellIndex < frozenColumnCount
                          const cellHorizontalAlignment = cell.horizontalAlignment ?? 'left'
                          const cellVerticalAlignment = cell.verticalAlignment ?? 'top'
                          const cellStyle: CSSProperties = {
                            backgroundColor: cell.fillColor ?? cell.conditionalFillColor ?? (isTableHeaderCell ? '#E5E7EB' : isTableBandedCell ? '#F8FAFC' : undefined),
                            color: cell.textColor,
                            fontWeight: cell.bold || isTableHeaderCell ? 700 : undefined,
                            minHeight: rowHeight,
                            whiteSpace: cell.wrapText ? 'normal' : 'nowrap',
                            textAlign: cellHorizontalAlignment,
                            boxShadow: cell.borderColor ? `inset 0 0 0 1px ${cell.borderColor}` : undefined
                          }
                          if (cell.wrapText || cell.horizontalAlignment || cell.verticalAlignment || isTableHeaderCell || hasDataValidationButton || hasComment) {
                            cellStyle.display = 'flex'
                            cellStyle.alignItems = spreadsheetAlignItems(cellVerticalAlignment)
                            cellStyle.justifyContent = isTableHeaderCell || hasDataValidationButton ? 'space-between' : spreadsheetJustifyContent(cellHorizontalAlignment)
                            cellStyle.gap = 6
                            cellStyle.height = '100%'
                          }
                          return (
                            <td
                              key={cellIndex}
                              data-active={isActive ? 'true' : 'false'}
                              data-spreadsheet-cell-address={cellAddress}
                              data-spreadsheet-cell-merge-ref={merge?.ref ?? ''}
                              data-spreadsheet-cell-table-name={tableName}
                              data-spreadsheet-cell-table-ref={tableCell?.table.ref ?? ''}
                              data-spreadsheet-cell-table-header={isTableHeaderCell ? 'true' : 'false'}
                              data-spreadsheet-cell-table-banded-row={isTableBandedCell ? 'true' : 'false'}
                              data-spreadsheet-cell-table-style={tableStyleName}
                              data-spreadsheet-column-width={activeSheet.columnWidths?.[cellIndex] ?? ''}
                              data-spreadsheet-row-height={rowHeight ?? ''}
                              data-spreadsheet-cell-frozen-row={rowIndex < frozenRowCount ? 'true' : 'false'}
                              data-spreadsheet-cell-frozen-column={cellIndex < frozenColumnCount ? 'true' : 'false'}
                              style={{
                                position: isFrozenCell ? 'sticky' : undefined,
                                top: rowIndex < frozenRowCount ? frozenRowTop : undefined,
                                left: frozenColumnLeft,
                                zIndex: rowIndex < frozenRowCount && cellIndex < frozenColumnCount ? 4 : isFrozenCell ? 3 : undefined,
                                width: activeSheet.columnWidths?.[cellIndex],
                                minWidth: activeSheet.columnWidths?.[cellIndex],
                                height: rowHeight,
                                verticalAlign: cellVerticalAlignment
                              }}
                              colSpan={merge?.colSpan}
                              rowSpan={merge?.rowSpan}
                            >
                              <button
                                type="button"
                                className="workspace-spreadsheet-cell-button"
                                data-testid="workspace-spreadsheet-cell"
                                data-spreadsheet-cell-address={cellAddress}
                                data-spreadsheet-cell-value={cell.value}
                                data-spreadsheet-cell-formula={cell.formula ?? ''}
                                data-spreadsheet-cell-kind={cell.formula ? 'formula' : 'value'}
                                data-spreadsheet-cell-fill-color={cell.fillColor ?? ''}
                                data-spreadsheet-cell-conditional-fill-color={cell.conditionalFillColor ?? ''}
                                data-spreadsheet-cell-border-color={cell.borderColor ?? ''}
                                data-spreadsheet-cell-text-color={cell.textColor ?? ''}
                                data-spreadsheet-cell-bold={cell.bold ? 'true' : 'false'}
                                data-spreadsheet-cell-wrap-text={cell.wrapText ? 'true' : 'false'}
                                data-spreadsheet-cell-horizontal-alignment={cell.horizontalAlignment ?? ''}
                                data-spreadsheet-cell-vertical-alignment={cell.verticalAlignment ?? ''}
                                data-spreadsheet-cell-merge-ref={merge?.ref ?? ''}
                                data-spreadsheet-cell-table-name={tableName}
                                data-spreadsheet-cell-table-ref={tableCell?.table.ref ?? ''}
                                data-spreadsheet-cell-table-header={isTableHeaderCell ? 'true' : 'false'}
                                data-spreadsheet-cell-table-banded-row={isTableBandedCell ? 'true' : 'false'}
                                data-spreadsheet-cell-table-style={tableStyleName}
                                data-spreadsheet-cell-table-filter-button={hasTableFilterButton ? 'true' : 'false'}
                                data-spreadsheet-cell-data-validation-type={cell.dataValidation?.type ?? ''}
                                data-spreadsheet-cell-data-validation-values={cell.dataValidation?.values?.join('|') ?? ''}
                                data-spreadsheet-cell-data-validation-source-range={cell.dataValidation?.sourceRange ?? ''}
                                data-spreadsheet-cell-data-validation-allow-blank={cell.dataValidation?.allowBlank ? 'true' : 'false'}
                                data-spreadsheet-cell-data-validation-show-input-message={cell.dataValidation?.showInputMessage ? 'true' : 'false'}
                                data-spreadsheet-cell-data-validation-prompt-title={cell.dataValidation?.promptTitle ?? ''}
                                data-spreadsheet-cell-data-validation-prompt={cell.dataValidation?.prompt ?? ''}
                                data-spreadsheet-cell-data-validation-show-error-message={cell.dataValidation?.showErrorMessage ? 'true' : 'false'}
                                data-spreadsheet-cell-data-validation-error-title={cell.dataValidation?.errorTitle ?? ''}
                                data-spreadsheet-cell-data-validation-error={cell.dataValidation?.error ?? ''}
                                data-spreadsheet-cell-comment-author={cell.comment?.author ?? ''}
                                data-spreadsheet-cell-comment-text={cell.comment?.text ?? ''}
                                data-spreadsheet-cell-merge-rowspan={merge?.rowSpan ?? 1}
                                data-spreadsheet-cell-merge-colspan={merge?.colSpan ?? 1}
                                data-spreadsheet-cell-column-width={activeSheet.columnWidths?.[cellIndex] ?? ''}
                                data-spreadsheet-cell-row-height={rowHeight ?? ''}
                                data-spreadsheet-cell-frozen-row={rowIndex < frozenRowCount ? 'true' : 'false'}
                                data-spreadsheet-cell-frozen-column={cellIndex < frozenColumnCount ? 'true' : 'false'}
                                data-active={isActive ? 'true' : 'false'}
                                aria-label={`${cellAddress} ${cell.value}`.trim()}
                                style={cellStyle}
                                onClick={() => {
                                  setActiveCell({ row: rowIndex, column: cellIndex })
                                  setValidationOverlay(hasDataValidationButton ? { row: rowIndex, column: cellIndex } : null)
                                }}
                                onFocus={() => { setActiveCell({ row: rowIndex, column: cellIndex }) }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') setValidationOverlay(null)
                                  if ((event.key === 'Enter' || event.key === ' ') && hasDataValidationButton) {
                                    event.preventDefault()
                                    setValidationOverlay({ row: rowIndex, column: cellIndex })
                                  }
                                }}
                              >
                                <span className="workspace-spreadsheet-cell-content">{cell.value}</span>
                                {hasTableFilterButton && (
                                  <span className="workspace-spreadsheet-filter-button" data-testid="workspace-spreadsheet-filter-button" aria-hidden="true">v</span>
                                )}
                                {hasDataValidationButton && (
                                  <span className="workspace-spreadsheet-validation-button" data-testid="workspace-spreadsheet-validation-button" aria-hidden="true">v</span>
                                )}
                                {hasComment && (
                                  <span className="workspace-spreadsheet-comment-indicator" data-testid="workspace-spreadsheet-comment-indicator" aria-hidden="true" />
                                )}
                              </button>
                              {isValidationOverlayOpen && (
                                <div
                                  className="workspace-spreadsheet-data-validation-overlay"
                                  data-testid="workspace-spreadsheet-data-validation-overlay"
                                  data-spreadsheet-data-validation-address={cellAddress}
                                  data-spreadsheet-data-validation-value={cell.value}
                                  data-spreadsheet-data-validation-options={dataValidationValues.join('|')}
                                  data-spreadsheet-data-validation-prompt-title={cell.dataValidation?.promptTitle ?? ''}
                                  data-spreadsheet-data-validation-prompt={cell.dataValidation?.prompt ?? ''}
                                  data-spreadsheet-data-validation-error-title={cell.dataValidation?.errorTitle ?? ''}
                                  data-spreadsheet-data-validation-error={cell.dataValidation?.error ?? ''}
                                  role="listbox"
                                  aria-label={`${cellAddress} data validation options`}
                                >
                                  {(cell.dataValidation?.promptTitle || cell.dataValidation?.prompt) && (
                                    <div className="workspace-spreadsheet-data-validation-message" data-spreadsheet-validation-message-kind="input">
                                      {cell.dataValidation.promptTitle ? <div className="workspace-spreadsheet-data-validation-message-title">{cell.dataValidation.promptTitle}</div> : null}
                                      {cell.dataValidation.prompt ? <div className="workspace-spreadsheet-data-validation-message-body">{cell.dataValidation.prompt}</div> : null}
                                    </div>
                                  )}
                                  {dataValidationValues.map((value) => (
                                    <button
                                      key={value}
                                      type="button"
                                      className="workspace-spreadsheet-data-validation-option"
                                      data-testid="workspace-spreadsheet-data-validation-option"
                                      data-spreadsheet-data-validation-option={value}
                                      data-selected={value === cell.value ? 'true' : 'false'}
                                      role="option"
                                      aria-selected={value === cell.value}
                                      onClick={() => { applyDataValidationValue(rowIndex, cellIndex, value) }}
                                    >
                                      {value}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div
                  className="workspace-spreadsheet-freeze-overlay"
                  data-testid="workspace-spreadsheet-freeze-overlay"
                  data-spreadsheet-freeze-column-count={frozenColumnCount}
                  data-spreadsheet-freeze-row-count={frozenRowCount}
                >
                  {frozenColumnCount > 0 && (
                    <span
                      className="workspace-spreadsheet-freeze-line workspace-spreadsheet-freeze-column-line"
                      data-testid="workspace-spreadsheet-freeze-column-line"
                      data-spreadsheet-freeze-column-count={frozenColumnCount}
                      aria-hidden="true"
                      style={{ left: freezeColumnLineLeft }}
                    />
                  )}
                  <button
                    type="button"
                    className="workspace-spreadsheet-freeze-handle workspace-spreadsheet-freeze-column-handle"
                    data-testid="workspace-spreadsheet-freeze-column-handle"
                    data-spreadsheet-freeze-column-count={frozenColumnCount}
                    aria-label="Drag frozen column boundary"
                    style={{ left: frozenColumnCount > 0 ? freezeColumnLineLeft : 38 }}
                    onPointerDown={(event) => { beginFreezePaneDrag('column', event) }}
                  />
                  {frozenRowCount > 0 && (
                    <span
                      className="workspace-spreadsheet-freeze-line workspace-spreadsheet-freeze-row-line"
                      data-testid="workspace-spreadsheet-freeze-row-line"
                      data-spreadsheet-freeze-row-count={frozenRowCount}
                      aria-hidden="true"
                      style={{ top: freezeRowLineTop }}
                    />
                  )}
                  <button
                    type="button"
                    className="workspace-spreadsheet-freeze-handle workspace-spreadsheet-freeze-row-handle"
                    data-testid="workspace-spreadsheet-freeze-row-handle"
                    data-spreadsheet-freeze-row-count={frozenRowCount}
                    aria-label="Drag frozen row boundary"
                    style={{ top: frozenRowCount > 0 ? freezeRowLineTop : 26 }}
                    onPointerDown={(event) => { beginFreezePaneDrag('row', event) }}
                  />
                </div>
                </div>
                {(activeSheet.drawings?.length ?? 0) > 0 && (
                  <div
                    className="workspace-spreadsheet-drawings"
                    data-testid="workspace-spreadsheet-drawings"
                    data-spreadsheet-drawing-count={activeSheet.drawings?.length ?? 0}
                  >
                    {activeSheet.drawings?.map((drawing, index) => (
                      <div
                        key={`${drawing.kind}-${drawing.name ?? drawing.text ?? index}`}
                        className="workspace-spreadsheet-drawing-card"
                        data-testid="workspace-spreadsheet-drawing"
                        data-spreadsheet-drawing-kind={drawing.kind}
                        data-spreadsheet-drawing-name={drawing.name ?? ''}
                        data-spreadsheet-drawing-description={drawing.description ?? ''}
                        data-spreadsheet-drawing-text={drawing.text ?? ''}
                        data-spreadsheet-drawing-geometry={drawing.geometry ?? ''}
                        data-spreadsheet-drawing-fill-color={drawing.fillColor ?? ''}
                        data-spreadsheet-drawing-line-color={drawing.lineColor ?? ''}
                        data-spreadsheet-drawing-anchor-row={drawing.row + 1}
                        data-spreadsheet-drawing-anchor-column={spreadsheetColumnLabel(drawing.column)}
                        data-spreadsheet-drawing-width-px={drawing.widthPx ?? ''}
                        data-spreadsheet-drawing-height-px={drawing.heightPx ?? ''}
                        data-spreadsheet-drawing-image-mime-type={drawing.imageMimeType ?? ''}
                      >
                        <div
                          className="workspace-spreadsheet-drawing-preview"
                          data-spreadsheet-drawing-preview-kind={drawing.kind}
                          style={{
                            '--spreadsheet-drawing-fill': drawing.fillColor ?? 'color-mix(in srgb, var(--accent) 16%, var(--surface-bg))',
                            '--spreadsheet-drawing-line': drawing.lineColor ?? 'var(--border-strong)'
                          } as CSSProperties}
                        >
                          {drawing.kind === 'image' && drawing.imageDataUrl ? (
                            <img
                              src={drawing.imageDataUrl}
                              alt={drawing.description ?? drawing.name ?? 'Workbook image'}
                              data-testid="workspace-spreadsheet-drawing-image"
                            />
                          ) : (
                            <span>{drawing.kind === 'image' ? 'Image' : drawing.text || drawing.geometry || 'Shape'}</span>
                          )}
                        </div>
                        <div className="workspace-spreadsheet-drawing-body">
                          <div className="workspace-spreadsheet-drawing-title">
                            {drawing.text || drawing.description || drawing.name || (drawing.kind === 'image' ? 'Image' : 'Shape')}
                          </div>
                          <div className="workspace-spreadsheet-drawing-meta">
                            {drawing.kind}{drawing.geometry ? ` · ${drawing.geometry}` : ''} · {spreadsheetDrawingAnchorLabel(drawing)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {(activeSheet.sparklines?.length ?? 0) > 0 && (
                  <div
                    className="workspace-spreadsheet-sparklines"
                    data-testid="workspace-spreadsheet-sparklines"
                    data-spreadsheet-sparkline-count={activeSheet.sparklines?.length ?? 0}
                  >
                    {activeSheet.sparklines?.map((sparkline, index) => {
                      const pointData = spreadsheetSparklinePointData(sparkline.values)
                      const points = spreadsheetSparklinePoints(sparkline.values)
                      return (
                        <div
                          key={`${sparkline.targetCell}-${sparkline.sourceRange}-${index}`}
                          className="workspace-spreadsheet-sparkline-card"
                          data-testid="workspace-spreadsheet-sparkline"
                          data-spreadsheet-sparkline-type={sparkline.type}
                          data-spreadsheet-sparkline-target-cell={sparkline.targetCell}
                          data-spreadsheet-sparkline-source-range={sparkline.sourceRange}
                          data-spreadsheet-sparkline-values={sparkline.values.join('|')}
                          data-spreadsheet-sparkline-markers={sparkline.markers ? 'true' : 'false'}
                          data-spreadsheet-sparkline-rendered={points ? 'true' : 'false'}
                        >
                          <svg
                            className="workspace-spreadsheet-sparkline-svg"
                            data-testid="workspace-spreadsheet-sparkline-svg"
                            viewBox="0 0 96 32"
                            role="img"
                            aria-label={`${sparkline.targetCell} sparkline`}
                          >
                            <line className="workspace-spreadsheet-sparkline-axis" x1="8" y1="26" x2="88" y2="26" />
                            {points && sparkline.type === 'line' && (
                              <polyline className="workspace-spreadsheet-sparkline-line" points={points} />
                            )}
                            {pointData.map((point, valueIndex) => {
                              const barHeight = Math.max(2, 26 - point.y)
                              if (sparkline.type !== 'line') {
                                return (
                                  <rect
                                    key={`${sparkline.targetCell}-${valueIndex}`}
                                    className="workspace-spreadsheet-sparkline-bar"
                                    x={point.x - 4}
                                    y={26 - barHeight}
                                    width="8"
                                    height={barHeight}
                                    rx="2"
                                  />
                                )
                              }
                              return sparkline.markers ? (
                                <circle
                                  key={`${sparkline.targetCell}-${valueIndex}`}
                                  className="workspace-spreadsheet-sparkline-marker"
                                  cx={point.x}
                                  cy={point.y}
                                  r="2.4"
                                />
                              ) : null
                            })}
                          </svg>
                          <div className="workspace-spreadsheet-sparkline-body">
                            <div className="workspace-spreadsheet-sparkline-title">{sparkline.targetCell}</div>
                            <div className="workspace-spreadsheet-sparkline-meta">
                              {sparkline.type} · {sparkline.sourceRange}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {(activeSheet.charts?.length ?? 0) > 0 && (
                  <div className="workspace-spreadsheet-charts" data-testid="workspace-spreadsheet-chart-preview-list">
                    {activeSheet.charts?.map((chart, index) => {
                      const chartData = spreadsheetChartData(activeSheet, chart)
                      const chartMax = Math.max(1, ...chartData.map((datum) => datum.value))
                      return (
                        <div
                          key={`${chart.title}-${index}`}
                          className="workspace-spreadsheet-chart-card"
                          data-testid="workspace-spreadsheet-chart-preview"
                          data-spreadsheet-chart-title={chart.title}
                          data-spreadsheet-chart-type={chart.type}
                          data-spreadsheet-chart-source-range={chart.sourceRange ?? ''}
                          data-spreadsheet-chart-rendered={chartData.length > 0 ? 'true' : 'false'}
                          data-spreadsheet-chart-datum-count={chartData.length}
                          data-spreadsheet-chart-max-value={chartMax}
                        >
                          <div className="workspace-spreadsheet-chart-header">
                            <Icon name="usage" size={14} />
                            <div className="min-w-0">
                              <div className="workspace-spreadsheet-chart-title">{chart.title}</div>
                              <div className="workspace-spreadsheet-chart-meta">{chart.type}{chart.sourceRange ? ` · ${chart.sourceRange}` : ''}</div>
                            </div>
                          </div>
                          {chartData.length > 0 && (
                            <div
                              className="workspace-spreadsheet-chart-plot"
                              data-testid="workspace-spreadsheet-chart-plot"
                              data-spreadsheet-chart-labels={chartData.map((datum) => datum.label).join('|')}
                              data-spreadsheet-chart-values={chartData.map((datum) => String(datum.value)).join('|')}
                            >
                              <svg
                                className="workspace-spreadsheet-chart-svg"
                                data-testid="workspace-spreadsheet-chart-svg"
                                viewBox="0 0 220 104"
                                role="img"
                                aria-label={`${chart.title} chart`}
                              >
                                <line className="workspace-spreadsheet-chart-axis" x1="24" y1="84" x2="212" y2="84" />
                                <line className="workspace-spreadsheet-chart-axis" x1="24" y1="12" x2="24" y2="84" />
                                {chartData.map((datum, datumIndex) => {
                                  const barWidth = Math.max(14, Math.min(32, 132 / Math.max(1, chartData.length)))
                                  const gap = Math.max(10, (164 - chartData.length * barWidth) / Math.max(1, chartData.length + 1))
                                  const barHeight = Math.max(2, Math.round((datum.value / chartMax) * 64))
                                  const x = 30 + gap + datumIndex * (barWidth + gap)
                                  const y = 84 - barHeight
                                  return (
                                    <g key={datum.address} data-spreadsheet-chart-datum-address={datum.address}>
                                      <rect
                                        className="workspace-spreadsheet-chart-bar"
                                        data-testid="workspace-spreadsheet-chart-bar"
                                        data-spreadsheet-chart-datum-label={datum.label}
                                        data-spreadsheet-chart-datum-value={datum.value}
                                        x={x}
                                        y={y}
                                        width={barWidth}
                                        height={barHeight}
                                        rx="3"
                                      />
                                      <text className="workspace-spreadsheet-chart-value" x={x + barWidth / 2} y={Math.max(10, y - 4)} textAnchor="middle">{datum.value}</text>
                                      <text className="workspace-spreadsheet-chart-label" x={x + barWidth / 2} y="98" textAnchor="middle">{datum.label}</text>
                                    </g>
                                  )
                                })}
                              </svg>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              {commentCells.length > 0 && (
                <div
                  className="workspace-spreadsheet-comments"
                  data-testid="workspace-spreadsheet-comments"
                  data-spreadsheet-comment-count={commentCells.length}
                >
                  {commentCells.map(({ cell, address }) => (
                    <div
                      key={address}
                      className="workspace-spreadsheet-comment-card"
                      data-testid="workspace-spreadsheet-comment"
                      data-spreadsheet-comment-address={address}
                      data-spreadsheet-comment-author={cell.comment.author ?? ''}
                      data-spreadsheet-comment-text={cell.comment.text}
                    >
                      <div className="workspace-spreadsheet-comment-meta">
                        <span>{address}</span>
                        {cell.comment.author ? <span>{cell.comment.author}</span> : null}
                      </div>
                      <div className="workspace-spreadsheet-comment-text">{cell.comment.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div
              className="workspace-spreadsheet-sheet-tabs"
              data-testid="workspace-spreadsheet-preview-sheet-tabs"
              data-spreadsheet-sheet-tab-count={sheetCount}
              data-spreadsheet-active-sheet-tab={activeSheet.name}
              role="tablist"
              aria-label="Workbook sheets"
            >
              <div className="workspace-spreadsheet-sheet-tabs-scroll" data-testid="workspace-spreadsheet-preview-sheet-tabs-scroll">
                {sheets.map((sheet, index) => (
                  <button
                    key={sheet.name || index}
                    type="button"
                    className="workspace-spreadsheet-sheet-tab"
                    data-testid="workspace-spreadsheet-preview-sheet-tab"
                    data-spreadsheet-sheet-tab-index={index + 1}
                    data-spreadsheet-sheet-tab-name={sheet.name}
                    data-active={index === activeSheetIndex ? 'true' : 'false'}
                    role="tab"
                    aria-selected={index === activeSheetIndex}
                    onClick={() => { selectSheet(index) }}
                  >
                    <span>{sheet.name}</span>
                  </button>
                ))}
              </div>
              <IconButton
                icon="plus"
                label="Add sheet unavailable in read-only preview"
                size="sm"
                variant="toolbar"
                disabled
                dataTestId="workspace-spreadsheet-preview-add-sheet"
              />
            </div>
          </>
        ) : (
          <ArtifactPreviewUnavailableBody size={preview.size ?? entry.size ?? 0} />
        )}
      </div>
    </div>
  )
}

function SlidesArtifactPreview({
  absolutePath,
  entry,
  preview
}: {
  absolutePath: string
  entry: WorkspaceSearchEntry
  preview: FilePreviewResult
}): JSX.Element {
  const title = stripArtifactExtension(entry.name, 'pptx')
  const actions = artifactPreviewActions(entry, absolutePath, preview)
  const payload = parseSlidesPreview(preview.text)
  const slides = payload?.slides ?? []
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [fitToWidth, setFitToWidth] = useState(false)
  const slideCount = slides.length
  const currentSlide = slides[currentSlideIndex] ?? null
  const notesCount = slides.filter((slide) => slide.notes?.trim()).length
  const currentSlideNotes = currentSlide?.notes?.trim() ?? ''
  const shapeCount = slides.reduce((count, slide) => count + (slide.shapes?.length ?? 0), 0)
  const imageShapeCount = slides.reduce((count, slide) => count + (slide.shapes?.filter((shape) => shape.imageDataUrl).length ?? 0), 0)
  const colorFillCount = slides.reduce((count, slide) => (
    count +
    (slide.backgroundColor ? 1 : 0) +
    (slide.shapes?.filter((shape) => shape.fillColor || shape.textColor).length ?? 0)
  ), 0)
  const effectiveZoomPercent = fitToWidth ? 100 : zoomPercent
  useEffect(() => {
    setCurrentSlideIndex((index) => Math.min(Math.max(index, 0), Math.max(0, slideCount - 1)))
  }, [slideCount])
  return (
    <div
      className="file-structured-preview workspace-office-artifact-preview flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="workspace-slides-preview"
      data-artifact-preview-kind={preview.kind}
      data-artifact-preview-size={preview.size ?? entry.size ?? 0}
      data-slides-preview-rendered={payload ? 'true' : 'false'}
      data-slides-preview-slide-count={slideCount}
      data-slides-preview-current-slide={currentSlideIndex + 1}
      data-slides-preview-zoom-percent={zoomPercent}
      data-slides-preview-zoom-fit={fitToWidth ? 'true' : 'false'}
      data-slides-preview-notes-count={notesCount}
      data-slides-preview-current-notes={currentSlideNotes}
      data-slides-preview-thumbnail-rail={payload ? 'codex-left' : 'none'}
      data-slides-preview-add-slide="read-only"
      data-slides-preview-shape-count={shapeCount}
      data-slides-preview-current-shape-count={currentSlide?.shapes?.length ?? 0}
      data-slides-preview-image-shape-count={imageShapeCount}
      data-slides-preview-current-image-shape-count={currentSlide?.shapes?.filter((shape) => shape.imageDataUrl).length ?? 0}
      data-slides-preview-stage-renderer={shapeCount > 0 ? 'positioned-shapes' : 'text-outline'}
      data-slides-preview-color-fill-count={colorFillCount}
      data-slides-preview-current-background-color={currentSlide?.backgroundColor ?? ''}
    >
      <ArtifactPreviewHeader
        artifactType="PPTX"
        centerContent={payload
          ? (
              <span
                className="file-preview-page-controls"
                data-testid="workspace-slides-preview-slide-controls"
                data-slides-current-slide={currentSlideIndex + 1}
                data-slides-slide-count={slideCount}
              >
                <IconButton
                  icon="arrowLeft"
                  label="Previous slide"
                  size="sm"
                  variant="toolbar"
                  disabled={currentSlideIndex <= 0}
                  dataTestId="workspace-slides-preview-slide-previous"
                  onClick={() => { setCurrentSlideIndex((index) => Math.max(0, index - 1)) }}
                />
                <span className="file-preview-page-indicator" data-testid="workspace-slides-preview-slide-indicator">
                  {currentSlideIndex + 1}/{Math.max(1, slideCount)}
                </span>
                <IconButton
                  icon="arrowRight"
                  label="Next slide"
                  size="sm"
                  variant="toolbar"
                  disabled={currentSlideIndex >= slideCount - 1}
                  dataTestId="workspace-slides-preview-slide-next"
                  onClick={() => { setCurrentSlideIndex((index) => Math.min(slideCount - 1, index + 1)) }}
                />
              </span>
            )
          : null}
        rightContent={(
          <span
            className="file-preview-header-actions"
            data-testid="workspace-slides-preview-actions"
            data-preview-controls="copy-path slides-slide-navigation slides-zoom slides-zoom-fit open-options"
            data-artifact-open-options="true"
          >
            {payload && (
              <ArtifactZoomControls
                fitToWidth={fitToWidth}
                kind="slides"
                onFitToWidthChange={setFitToWidth}
                onZoomPercentChange={setZoomPercent}
                testId="workspace-slides-preview"
                zoomPercent={zoomPercent}
              />
            )}
            <ArtifactHeaderActionButtons actions={actions} testId="workspace-slides-preview" />
          </span>
        )}
        testId="workspace-slides-preview"
        title={title}
      />
      <div className="workspace-office-preview-body" data-testid="workspace-slides-preview-body">
        {currentSlide ? (
          <>
            <div
              className="workspace-slides-editor-shell"
              data-testid="workspace-slides-preview-editor-shell"
              data-slides-editor-shell="codex-thumbnail-rail"
            >
              <aside
                className="workspace-slides-thumbnail-rail"
                data-testid="workspace-slides-preview-thumbnail-rail"
                data-slides-thumbnail-rail-placement="left"
              >
                <div className="workspace-slides-thumbnail-strip" data-testid="workspace-slides-preview-thumbnails">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.index}
                      type="button"
                      className="workspace-slide-thumbnail"
                      data-testid="workspace-slides-preview-thumbnail"
                      data-active={index === currentSlideIndex ? 'true' : 'false'}
                      data-slide-index={slide.index}
                      onClick={() => { setCurrentSlideIndex(index) }}
                    >
                      <span>{slide.index}</span>
                      <strong>{slide.title}</strong>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="workspace-slide-add-thumbnail"
                    data-testid="workspace-slides-preview-add-slide"
                    aria-label="Add slide unavailable in read-only preview"
                    disabled
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </aside>
              <div className="workspace-slides-main-panel" data-testid="workspace-slides-preview-main-panel">
                <section
                  className="workspace-slide-stage"
                  data-testid="workspace-slides-preview-current-slide"
                  data-slide-index={currentSlide.index}
                  data-slides-stage-renderer={(currentSlide.shapes?.length ?? 0) > 0 ? 'positioned-shapes' : 'text-outline'}
                  data-slides-shape-count={currentSlide.shapes?.length ?? 0}
                  data-slides-image-shape-count={currentSlide.shapes?.filter((shape) => shape.imageDataUrl).length ?? 0}
                  data-slides-background-color={currentSlide.backgroundColor ?? ''}
                  style={{ fontSize: `${Math.max(10, Math.min(18, 13 * (effectiveZoomPercent / 100)))}px` }}
                >
                  <div className="workspace-slide-preview-number">{currentSlide.index}</div>
                  {(currentSlide.shapes?.length ?? 0) > 0 ? (
                    <div
                      className="workspace-slide-positioned-canvas"
                      data-testid="workspace-slides-preview-shape-canvas"
                      data-slides-canvas-background-color={currentSlide.backgroundColor ?? ''}
                      style={currentSlide.backgroundColor ? { backgroundColor: currentSlide.backgroundColor } : undefined}
                    >
                      {currentSlide.shapes?.map((shape, index) => (
                        <div
                          key={index}
                          className="workspace-slide-positioned-shape"
                          data-testid="workspace-slides-preview-shape"
                          data-slide-shape-index={index + 1}
                          data-slide-shape-kind={shape.imageDataUrl ? 'image' : 'text'}
                          data-slide-shape-fill-color={shape.fillColor ?? ''}
                          data-slide-shape-text-color={shape.textColor ?? ''}
                          data-slide-shape-image-mime-type={shape.imageMimeType ?? ''}
                          style={{
                            left: `${shape.x}%`,
                            top: `${shape.y}%`,
                            width: `${shape.width}%`,
                            height: `${shape.height}%`,
                            ...(shape.fillColor ? { backgroundColor: shape.fillColor } : {}),
                            ...(shape.textColor ? { color: shape.textColor } : {})
                          }}
                        >
                          {shape.imageDataUrl ? (
                            <img
                              src={shape.imageDataUrl}
                              alt=""
                              className="workspace-slide-positioned-image"
                              data-testid="workspace-slides-preview-image-shape"
                              draggable={false}
                            />
                          ) : shape.text.map((line, lineIndex) => (
                            lineIndex === 0 && index === 0
                              ? <h3 key={lineIndex}>{line}</h3>
                              : <p key={lineIndex}>{line}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="workspace-slide-preview-content">
                      <h3>{currentSlide.title}</h3>
                      {currentSlide.text.map((line, index) => (
                        <p key={index}>{line}</p>
                      ))}
                    </div>
                  )}
                </section>
                {notesCount > 0 && (
                  <section
                    className="workspace-slides-notes-panel"
                    data-testid="workspace-slides-preview-notes-panel"
                    data-slides-notes-current-slide={currentSlide.index}
                    data-slides-notes-empty={currentSlideNotes ? 'false' : 'true'}
                  >
                    <div className="workspace-office-section-heading">
                      <Icon name="file" size={14} />
                      <span>Speaker notes</span>
                    </div>
                    <textarea
                      className="workspace-slides-notes-textarea"
                      data-testid="workspace-slides-preview-notes"
                      placeholder="No speaker notes"
                      readOnly
                      value={currentSlideNotes}
                    />
                  </section>
                )}
              </div>
            </div>
            <div className="workspace-slides-outline" data-testid="workspace-slides-preview-outline">
              {slides.map((slide) => (
              <section
                key={slide.index}
                className="workspace-slide-preview-card"
                data-testid="workspace-slides-preview-slide"
                data-slide-index={slide.index}
                data-active={slide.index === currentSlide.index ? 'true' : 'false'}
              >
                <div className="workspace-slide-preview-number">{slide.index}</div>
                <div className="workspace-slide-preview-content">
                  <h3>{slide.title}</h3>
                  {slide.text.map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                </div>
              </section>
              ))}
            </div>
          </>
        ) : (
          <ArtifactPreviewUnavailableBody size={preview.size ?? entry.size ?? 0} />
        )}
      </div>
    </div>
  )
}

function ArtifactPreviewUnavailableBody({ size }: { size: number }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
      <div className="flex max-w-[280px] flex-col items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <Icon name="file" size={24} />
        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>Preview unavailable</div>
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{formatBytes(size)}</div>
      </div>
    </div>
  )
}

function parseSpreadsheetPreview(text: string | undefined): SpreadsheetPreviewPayload | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Partial<SpreadsheetPreviewPayload>
    if (!Array.isArray(parsed.sheets) || parsed.sheets.length === 0) return null
    const sheets = parsed.sheets
      .filter((sheet) => typeof sheet?.name === 'string' && Array.isArray(sheet.rows))
      .map((sheet) => ({
        name: sheet.name,
        rows: sheet.rows
          .filter((row) => Array.isArray(row))
          .map((row) => row.map((cell) => normalizeSpreadsheetPreviewCell(cell))),
        merges: Array.isArray(sheet.merges)
          ? sheet.merges.map((merge) => normalizeSpreadsheetMerge(merge)).filter((merge): merge is SpreadsheetPreviewMerge => Boolean(merge))
          : undefined,
        tables: Array.isArray(sheet.tables)
          ? sheet.tables.map((table) => normalizeSpreadsheetTable(table)).filter((table): table is SpreadsheetPreviewTable => Boolean(table))
          : undefined,
        charts: Array.isArray(sheet.charts)
          ? sheet.charts.map((chart) => normalizeSpreadsheetChart(chart)).filter((chart): chart is SpreadsheetPreviewChart => Boolean(chart))
          : undefined,
        drawings: Array.isArray(sheet.drawings)
          ? sheet.drawings.map((drawing) => normalizeSpreadsheetDrawing(drawing)).filter((drawing): drawing is SpreadsheetPreviewDrawing => Boolean(drawing))
          : undefined,
        sparklines: Array.isArray(sheet.sparklines)
          ? sheet.sparklines.map((sparkline) => normalizeSpreadsheetSparkline(sparkline)).filter((sparkline): sparkline is SpreadsheetPreviewSparkline => Boolean(sparkline))
          : undefined,
        conditionalFormatCount: typeof sheet.conditionalFormatCount === 'number' && sheet.conditionalFormatCount > 0
          ? Math.min(24, Math.floor(sheet.conditionalFormatCount))
          : undefined,
        dataValidationCount: typeof sheet.dataValidationCount === 'number' && sheet.dataValidationCount > 0
          ? Math.min(24, Math.floor(sheet.dataValidationCount))
          : undefined,
        commentCount: typeof sheet.commentCount === 'number' && sheet.commentCount > 0
          ? Math.min(24, Math.floor(sheet.commentCount))
          : undefined,
        drawingCount: typeof sheet.drawingCount === 'number' && sheet.drawingCount > 0
          ? Math.min(24, Math.floor(sheet.drawingCount))
          : undefined,
        sparklineCount: typeof sheet.sparklineCount === 'number' && sheet.sparklineCount > 0
          ? Math.min(24, Math.floor(sheet.sparklineCount))
          : undefined,
        columnWidths: Array.isArray(sheet.columnWidths)
          ? normalizeSpreadsheetDimensionArray(sheet.columnWidths, 48, 320, 12)
          : undefined,
        rowHeights: Array.isArray(sheet.rowHeights)
          ? normalizeSpreadsheetDimensionArray(sheet.rowHeights, 22, 180, 24)
          : undefined,
        freezePanes: normalizeSpreadsheetFreezePanes(sheet.freezePanes)
      }))
      .filter((sheet) => sheet.rows.length > 0)
    if (sheets.length === 0) return null
    return {
      sheets,
      truncated: parsed.truncated === true
    }
  } catch {
    return null
  }
}

function normalizeSpreadsheetPreviewCell(cell: unknown): SpreadsheetPreviewCell {
  if (cell && typeof cell === 'object') {
    const candidate = cell as {
      value?: unknown
      formula?: unknown
      fillColor?: unknown
      conditionalFillColor?: unknown
      dataValidation?: unknown
      comment?: unknown
      borderColor?: unknown
      textColor?: unknown
      bold?: unknown
      wrapText?: unknown
      horizontalAlignment?: unknown
      verticalAlignment?: unknown
    }
    const fillColor = normalizeSpreadsheetColor(candidate.fillColor)
    const conditionalFillColor = normalizeSpreadsheetColor(candidate.conditionalFillColor)
    const borderColor = normalizeSpreadsheetColor(candidate.borderColor)
    const textColor = normalizeSpreadsheetColor(candidate.textColor)
    const horizontalAlignment = normalizeSpreadsheetHorizontalAlignment(candidate.horizontalAlignment)
    const verticalAlignment = normalizeSpreadsheetVerticalAlignment(candidate.verticalAlignment)
    return {
      value: String(candidate.value ?? ''),
      ...(typeof candidate.formula === 'string' && candidate.formula ? { formula: candidate.formula } : {}),
      ...(fillColor ? { fillColor } : {}),
      ...(conditionalFillColor ? { conditionalFillColor } : {}),
      ...(normalizeSpreadsheetDataValidation(candidate.dataValidation) ? { dataValidation: normalizeSpreadsheetDataValidation(candidate.dataValidation) } : {}),
      ...(normalizeSpreadsheetCellComment(candidate.comment) ? { comment: normalizeSpreadsheetCellComment(candidate.comment) } : {}),
      ...(borderColor ? { borderColor } : {}),
      ...(textColor ? { textColor } : {}),
      ...(candidate.bold === true ? { bold: true } : {}),
      ...(candidate.wrapText === true ? { wrapText: true } : {}),
      ...(horizontalAlignment ? { horizontalAlignment } : {}),
      ...(verticalAlignment ? { verticalAlignment } : {})
    }
  }
  return { value: String(cell ?? '') }
}

function normalizeSpreadsheetCellComment(value: unknown): SpreadsheetPreviewCellComment | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { author?: unknown; text?: unknown }
  const text = typeof candidate.text === 'string' ? candidate.text.trim().slice(0, 240) : ''
  if (!text) return undefined
  const author = typeof candidate.author === 'string' ? candidate.author.trim().slice(0, 80) : ''
  return {
    ...(author ? { author } : {}),
    text
  }
}

function normalizeSpreadsheetDataValidation(value: unknown): SpreadsheetPreviewDataValidation | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as {
    type?: unknown
    values?: unknown
    sourceRange?: unknown
    allowBlank?: unknown
    showInputMessage?: unknown
    promptTitle?: unknown
    prompt?: unknown
    showErrorMessage?: unknown
    errorTitle?: unknown
    error?: unknown
  }
  if (candidate.type !== 'list') return undefined
  const values = Array.isArray(candidate.values)
    ? candidate.values.map((item) => String(item)).filter(Boolean).slice(0, 24)
    : undefined
  const sourceRange = typeof candidate.sourceRange === 'string' && candidate.sourceRange.trim()
    ? candidate.sourceRange.trim().toUpperCase()
    : undefined
  const promptTitle = normalizeBoundedSpreadsheetText(candidate.promptTitle, 80)
  const prompt = normalizeBoundedSpreadsheetText(candidate.prompt, 180)
  const errorTitle = normalizeBoundedSpreadsheetText(candidate.errorTitle, 80)
  const error = normalizeBoundedSpreadsheetText(candidate.error, 180)
  return {
    type: 'list',
    ...(values && values.length > 0 ? { values } : {}),
    ...(sourceRange ? { sourceRange } : {}),
    ...(candidate.allowBlank === true ? { allowBlank: true } : {}),
    ...(candidate.showInputMessage === true ? { showInputMessage: true } : {}),
    ...(promptTitle ? { promptTitle } : {}),
    ...(prompt ? { prompt } : {}),
    ...(candidate.showErrorMessage === true ? { showErrorMessage: true } : {}),
    ...(errorTitle ? { errorTitle } : {}),
    ...(error ? { error } : {})
  }
}

function normalizeBoundedSpreadsheetText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
  return text || undefined
}

function normalizeSpreadsheetHorizontalAlignment(value: unknown): SpreadsheetPreviewCell['horizontalAlignment'] {
  if (value === 'left' || value === 'center' || value === 'right') return value
  return undefined
}

function normalizeSpreadsheetVerticalAlignment(value: unknown): SpreadsheetPreviewCell['verticalAlignment'] {
  if (value === 'top' || value === 'middle' || value === 'bottom') return value
  return undefined
}

function normalizeSpreadsheetMerge(value: unknown): SpreadsheetPreviewMerge | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { ref?: unknown; startRow?: unknown; startColumn?: unknown; rowSpan?: unknown; colSpan?: unknown }
  const startRow = normalizeSpreadsheetSpanNumber(candidate.startRow, 0, 23)
  const startColumn = normalizeSpreadsheetSpanNumber(candidate.startColumn, 0, 11)
  const rowSpan = normalizeSpreadsheetSpanNumber(candidate.rowSpan, 1, 24)
  const colSpan = normalizeSpreadsheetSpanNumber(candidate.colSpan, 1, 12)
  if (startRow === null || startColumn === null || rowSpan === null || colSpan === null) return null
  if (rowSpan <= 1 && colSpan <= 1) return null
  return {
    ref: typeof candidate.ref === 'string' && candidate.ref.trim() ? candidate.ref.trim().toUpperCase() : `${spreadsheetColumnLabel(startColumn)}${startRow + 1}:${spreadsheetColumnLabel(startColumn + colSpan - 1)}${startRow + rowSpan}`,
    startRow,
    startColumn,
    rowSpan,
    colSpan
  }
}

function normalizeSpreadsheetTable(value: unknown): SpreadsheetPreviewTable | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    ref?: unknown
    name?: unknown
    styleName?: unknown
    startRow?: unknown
    startColumn?: unknown
    rowSpan?: unknown
    colSpan?: unknown
    showFilterButton?: unknown
    showRowStripes?: unknown
  }
  const startRow = normalizeSpreadsheetSpanNumber(candidate.startRow, 0, 23)
  const startColumn = normalizeSpreadsheetSpanNumber(candidate.startColumn, 0, 11)
  const rowSpan = normalizeSpreadsheetSpanNumber(candidate.rowSpan, 1, 24)
  const colSpan = normalizeSpreadsheetSpanNumber(candidate.colSpan, 1, 12)
  if (startRow === null || startColumn === null || rowSpan === null || colSpan === null) return null
  return {
    ref: typeof candidate.ref === 'string' && candidate.ref.trim() ? candidate.ref.trim().toUpperCase() : `${spreadsheetColumnLabel(startColumn)}${startRow + 1}:${spreadsheetColumnLabel(startColumn + colSpan - 1)}${startRow + rowSpan}`,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : 'Table',
    ...(typeof candidate.styleName === 'string' && candidate.styleName.trim() ? { styleName: candidate.styleName.trim() } : {}),
    startRow,
    startColumn,
    rowSpan,
    colSpan,
    ...(candidate.showFilterButton === true ? { showFilterButton: true } : {}),
    ...(candidate.showRowStripes === true ? { showRowStripes: true } : {})
  }
}

function normalizeSpreadsheetChart(value: unknown): SpreadsheetPreviewChart | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { title?: unknown; type?: unknown; sourceRange?: unknown }
  const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : 'Chart'
  const type = typeof candidate.type === 'string' && candidate.type.trim() ? candidate.type.trim() : 'Chart'
  const sourceRange = typeof candidate.sourceRange === 'string' && candidate.sourceRange.trim()
    ? candidate.sourceRange.trim()
    : undefined
  return {
    title,
    type,
    ...(sourceRange ? { sourceRange } : {})
  }
}

function normalizeSpreadsheetDrawing(value: unknown): SpreadsheetPreviewDrawing | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    kind?: unknown
    name?: unknown
    description?: unknown
    text?: unknown
    geometry?: unknown
    fillColor?: unknown
    lineColor?: unknown
    row?: unknown
    column?: unknown
    rowOffsetPx?: unknown
    columnOffsetPx?: unknown
    widthPx?: unknown
    heightPx?: unknown
    toRow?: unknown
    toColumn?: unknown
    imageDataUrl?: unknown
    imageMimeType?: unknown
  }
  if (candidate.kind !== 'shape' && candidate.kind !== 'image') return null
  const row = normalizeSpreadsheetSpanNumber(candidate.row, 0, 999)
  const column = normalizeSpreadsheetSpanNumber(candidate.column, 0, 255)
  if (row === null || column === null) return null
  const rowOffsetPx = normalizeSpreadsheetOptionalNumber(candidate.rowOffsetPx, 0, 600)
  const columnOffsetPx = normalizeSpreadsheetOptionalNumber(candidate.columnOffsetPx, 0, 1200)
  const widthPx = normalizeSpreadsheetOptionalNumber(candidate.widthPx, 1, 1200)
  const heightPx = normalizeSpreadsheetOptionalNumber(candidate.heightPx, 1, 800)
  const toRow = normalizeSpreadsheetOptionalInteger(candidate.toRow, 0, 999)
  const toColumn = normalizeSpreadsheetOptionalInteger(candidate.toColumn, 0, 255)
  const imageDataUrl = typeof candidate.imageDataUrl === 'string' && candidate.imageDataUrl.startsWith('data:image/')
    ? candidate.imageDataUrl
    : undefined
  return {
    kind: candidate.kind,
    row,
    column,
    ...(boundedString(candidate.name, 80) ? { name: boundedString(candidate.name, 80) } : {}),
    ...(boundedString(candidate.description, 120) ? { description: boundedString(candidate.description, 120) } : {}),
    ...(boundedString(candidate.text, 160) ? { text: boundedString(candidate.text, 160) } : {}),
    ...(boundedString(candidate.geometry, 40) ? { geometry: boundedString(candidate.geometry, 40) } : {}),
    ...(boundedSpreadsheetColor(candidate.fillColor) ? { fillColor: boundedSpreadsheetColor(candidate.fillColor) } : {}),
    ...(boundedSpreadsheetColor(candidate.lineColor) ? { lineColor: boundedSpreadsheetColor(candidate.lineColor) } : {}),
    ...(rowOffsetPx !== undefined ? { rowOffsetPx } : {}),
    ...(columnOffsetPx !== undefined ? { columnOffsetPx } : {}),
    ...(widthPx !== undefined ? { widthPx } : {}),
    ...(heightPx !== undefined ? { heightPx } : {}),
    ...(toRow !== undefined ? { toRow } : {}),
    ...(toColumn !== undefined ? { toColumn } : {}),
    ...(imageDataUrl ? { imageDataUrl } : {}),
    ...(typeof candidate.imageMimeType === 'string' && candidate.imageMimeType.startsWith('image/') ? { imageMimeType: candidate.imageMimeType.slice(0, 40) } : {})
  }
}

function normalizeSpreadsheetSparkline(value: unknown): SpreadsheetPreviewSparkline | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as {
    type?: unknown
    targetCell?: unknown
    sourceRange?: unknown
    values?: unknown
    markers?: unknown
  }
  const rawType = typeof candidate.type === 'string' ? candidate.type.toLowerCase() : 'line'
  const type: SpreadsheetPreviewSparkline['type'] = rawType === 'column' || rawType === 'stacked' ? rawType : 'line'
  const targetCell = typeof candidate.targetCell === 'string'
    ? candidate.targetCell.replace(/\$/g, '').trim().toUpperCase()
    : ''
  const sourceRange = typeof candidate.sourceRange === 'string'
    ? candidate.sourceRange.replace(/\$/g, '').trim()
    : ''
  if (!/^[A-Z]{1,3}\d+$/.test(targetCell) || !sourceRange) return null
  const values = Array.isArray(candidate.values)
    ? candidate.values
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .slice(0, 32)
    : []
  return {
    type,
    targetCell,
    sourceRange,
    values,
    ...(candidate.markers === true ? { markers: true } : {})
  }
}

function normalizeSpreadsheetFreezePanes(value: unknown): SpreadsheetFreezePanes | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { rows?: unknown; columns?: unknown }
  const rows = normalizeSpreadsheetSpanNumber(candidate.rows, 0, 6)
  const columns = normalizeSpreadsheetSpanNumber(candidate.columns, 0, 6)
  if (rows === null || columns === null || (rows === 0 && columns === 0)) return undefined
  return { rows, columns }
}

function normalizeSpreadsheetOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  const normalized = normalizeSpreadsheetSpanNumber(value, min, max)
  return normalized === null ? undefined : normalized
}

function normalizeSpreadsheetOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < min || number > max) return undefined
  return Math.round(number)
}

function normalizeSpreadsheetSpanNumber(value: unknown, min: number, max: number): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < min || number > max) return null
  return number
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
  return normalized || undefined
}

function boundedSpreadsheetColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : undefined
}

function normalizeSpreadsheetDimensionArray(values: unknown[], min: number, max: number, limit: number): Array<number | undefined> {
  return values.slice(0, limit).map((value) => {
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(number) || number < min || number > max) return undefined
    return Math.round(number)
  })
}

function normalizeSpreadsheetColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^#([A-Fa-f0-9]{6})$/.exec(value.trim())
  return match ? `#${match[1].toUpperCase()}` : undefined
}

function parseSlidesPreview(text: string | undefined): SlidesPreviewPayload | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Partial<SlidesPreviewPayload>
    if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) return null
    const slides = parsed.slides
      .filter((slide) => Number.isFinite(slide?.index) && typeof slide?.title === 'string' && Array.isArray(slide.text))
      .map((slide) => ({
        index: slide.index,
        title: slide.title,
        text: slide.text.map((line) => String(line)),
        notes: typeof slide.notes === 'string' ? slide.notes : '',
        backgroundColor: normalizeHexColor(slide.backgroundColor),
        shapes: Array.isArray(slide.shapes)
          ? slide.shapes
            .map((shape) => ({
              text: Array.isArray(shape?.text) ? shape.text.map((line) => String(line)) : [],
              x: clampPercent(Number(shape?.x ?? 0)),
              y: clampPercent(Number(shape?.y ?? 0)),
              width: clampPercent(Number(shape?.width ?? 0), 1),
              height: clampPercent(Number(shape?.height ?? 0), 1),
              fillColor: normalizeHexColor(shape?.fillColor),
              textColor: normalizeHexColor(shape?.textColor),
              imageDataUrl: normalizeImageDataUrl(shape?.imageDataUrl),
              imageMimeType: normalizeImageMimeType(shape?.imageMimeType)
            }))
            .filter((shape) => (shape.text.length > 0 || shape.imageDataUrl) && shape.width > 0 && shape.height > 0)
          : []
      }))
    if (slides.length === 0) return null
    return {
      slides,
      truncated: parsed.truncated === true
    }
  } catch {
    return null
  }
}

function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : undefined
}

function normalizeImageDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined
}

function normalizeImageMimeType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(value) ? value : undefined
}

function clampPercent(value: number, minimum = 0): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(100, value))
}

function PdfPreview({
  entry,
  absolutePath,
  preview
}: {
  entry: WorkspaceSearchEntry
  absolutePath: string
  preview: FilePreviewResult
}): JSX.Element {
  const title = stripArtifactExtension(entry.name, 'pdf')
  const pageCount = Math.max(1, Math.floor(preview.pageCount ?? 1))
  const [currentPage, setCurrentPage] = useState(1)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [fitToWidth, setFitToWidth] = useState(false)
  const [invertColors, setInvertColors] = useState(false)
  const [presentationMode, setPresentationMode] = useState(false)
  const [annotationMode, setAnnotationMode] = useState(false)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const effectiveZoomPercent = fitToWidth ? 'page-fit' : zoomPercent
  const currentPageAnnotations = annotations.filter((annotation) => annotation.page === currentPage)
  const saveAnnotation = (): void => {
    const body = annotationDraft.trim()
    if (!body) return
    setAnnotations((items) => [
      ...items,
      { id: `pdf-annotation-${currentPage}-${Date.now()}`, page: currentPage, body }
    ])
    setAnnotationDraft('')
  }
  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), pageCount))
  }, [pageCount])
  const goToPreviousPage = (): void => {
    setCurrentPage((page) => Math.max(1, page - 1))
  }
  const goToNextPage = (): void => {
    setCurrentPage((page) => Math.min(pageCount, page + 1))
  }
  return (
    <div
      className="file-structured-preview workspace-pdf-preview flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="workspace-pdf-preview"
      data-pdf-preview-size={preview.size ?? entry.size ?? 0}
      data-pdf-preview-page-count={pageCount}
      data-pdf-preview-current-page={currentPage}
      data-pdf-preview-zoom-percent={zoomPercent}
      data-pdf-preview-zoom-fit={fitToWidth ? 'true' : 'false'}
      data-pdf-preview-invert-colors={invertColors ? 'true' : 'false'}
      data-pdf-preview-presentation-mode={presentationMode ? 'true' : 'false'}
      data-pdf-preview-annotation-mode={annotationMode ? 'true' : 'false'}
      data-pdf-preview-annotation-count={annotations.length}
      data-pdf-preview-current-page-annotation-count={currentPageAnnotations.length}
    >
      {presentationMode ? (
        <PdfPresentationMode
          absolutePath={absolutePath}
          currentPage={currentPage}
          invertColors={invertColors}
          pageCount={pageCount}
          title={title}
          zoomPercent={effectiveZoomPercent}
          onClose={() => { setPresentationMode(false) }}
          onPageChange={setCurrentPage}
        />
      ) : (
        <>
          <ArtifactPreviewHeader
            artifactType="PDF"
            centerContent={(
              <span
                className="file-preview-page-controls"
                data-testid="workspace-pdf-preview-page-controls"
                data-pdf-current-page={currentPage}
                data-pdf-page-count={pageCount}
              >
                <IconButton
                  icon="arrowLeft"
                  label="Previous page"
                  size="sm"
                  variant="toolbar"
                  disabled={currentPage <= 1}
                  dataTestId="workspace-pdf-preview-page-previous"
                  onClick={goToPreviousPage}
                />
                <span className="file-preview-page-indicator" data-testid="workspace-pdf-preview-page-indicator">
                  {currentPage}/{pageCount}
                </span>
                <IconButton
                  icon="arrowRight"
                  label="Next page"
                  size="sm"
                  variant="toolbar"
                  disabled={currentPage >= pageCount}
                  dataTestId="workspace-pdf-preview-page-next"
                  onClick={goToNextPage}
                />
              </span>
            )}
            rightContent={(
              <span
                className="file-preview-header-actions"
                data-testid="workspace-pdf-preview-actions"
                data-preview-controls="copy-path pdf-page-navigation pdf-zoom pdf-zoom-fit pdf-invert-colors pdf-annotate pdf-presentation open-options"
                data-artifact-open-options="true"
              >
                <IconButton
                  active={annotationMode}
                  icon="pencil"
                  label={annotationMode ? 'Annotating' : 'Annotate'}
                  size="sm"
                  variant="toolbar"
                  dataTestId="workspace-pdf-preview-annotate"
                  onClick={() => { setAnnotationMode((value) => !value) }}
                />
                <IconButton
                  active={invertColors}
                  icon="contrast"
                  label={invertColors ? 'Show original colors' : 'Invert colors'}
                  size="sm"
                  variant="toolbar"
                  dataTestId="workspace-pdf-preview-invert-colors"
                  onClick={() => { setInvertColors((value) => !value) }}
                />
                <ArtifactZoomControls
                  fitToWidth={fitToWidth}
                  kind="pdf"
                  onFitToWidthChange={setFitToWidth}
                  onZoomPercentChange={setZoomPercent}
                  testId="workspace-pdf-preview"
                  zoomPercent={zoomPercent}
                />
                <IconButton
                  icon="maximize"
                  label="Present"
                  size="sm"
                  variant="toolbar"
                  dataTestId="workspace-pdf-preview-presentation"
                  onClick={() => { setPresentationMode(true) }}
                />
                <ArtifactHeaderActionButtons actions={artifactPreviewActions(entry, absolutePath, preview)} testId="workspace-pdf-preview" />
              </span>
            )}
            testId="workspace-pdf-preview"
            title={title}
          />
          <div className="workspace-pdf-preview-body" data-testid="workspace-pdf-preview-body">
            <iframe
              title={entry.name}
              src={pdfPreviewUrl(absolutePath, currentPage, effectiveZoomPercent)}
              className={`workspace-pdf-preview-frame ${invertColors ? 'workspace-pdf-preview-frame-inverted' : ''}`}
              data-testid="workspace-pdf-preview-frame"
              data-pdf-invert-colors={invertColors ? 'true' : 'false'}
            />
            {annotationMode && (
              <aside
                className="workspace-pdf-annotation-layer"
                data-testid="workspace-pdf-annotation-layer"
                data-pdf-annotation-layer-page={currentPage}
                data-pdf-annotation-count={annotations.length}
                data-pdf-current-page-annotation-count={currentPageAnnotations.length}
              >
                <div className="workspace-pdf-annotation-header">
                  <div>
                    <div className="workspace-pdf-annotation-title">Annotating</div>
                    <div className="workspace-pdf-annotation-meta">Page {currentPage} of {pageCount}</div>
                  </div>
                  <Badge tone="neutral">{annotations.length}</Badge>
                </div>
                <textarea
                  className="workspace-pdf-annotation-input"
                  data-testid="workspace-pdf-annotation-input"
                  aria-label={`PDF comment for page ${currentPage}`}
                  placeholder="Add a comment for this page"
                  value={annotationDraft}
                  onChange={(event) => setAnnotationDraft(event.currentTarget.value)}
                />
                <div className="workspace-pdf-annotation-actions">
                  <Button
                    variant="secondary"
                    dataTestId="workspace-pdf-annotation-cancel"
                    onClick={() => {
                      setAnnotationDraft('')
                      setAnnotationMode(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    dataTestId="workspace-pdf-annotation-save"
                    disabled={annotationDraft.trim().length === 0}
                    onClick={saveAnnotation}
                  >
                    Save
                  </Button>
                </div>
                <div className="workspace-pdf-annotation-list" data-testid="workspace-pdf-annotation-list">
                  {currentPageAnnotations.length === 0 ? (
                    <div className="workspace-pdf-annotation-empty" data-testid="workspace-pdf-annotation-empty">
                      No comments on this page
                    </div>
                  ) : currentPageAnnotations.map((annotation, index) => (
                    <article
                      key={annotation.id}
                      className="workspace-pdf-annotation-card"
                      data-testid="workspace-pdf-annotation-card"
                      data-pdf-annotation-page={annotation.page}
                      data-pdf-annotation-index={index + 1}
                    >
                      <div className="workspace-pdf-annotation-card-header">Comment {index + 1}</div>
                      <div className="workspace-pdf-annotation-card-body">{annotation.body}</div>
                    </article>
                  ))}
                </div>
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function PdfPresentationMode({
  absolutePath,
  currentPage,
  invertColors,
  pageCount,
  title,
  zoomPercent,
  onClose,
  onPageChange
}: {
  absolutePath: string
  currentPage: number
  invertColors: boolean
  pageCount: number
  title: string
  zoomPercent: number | 'page-fit'
  onClose: () => void
  onPageChange: (page: number) => void
}): JSX.Element {
  const presentationRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    presentationRef.current?.focus()
  }, [])
  const goToPreviousPage = (): void => {
    onPageChange(Math.max(1, currentPage - 1))
  }
  const goToNextPage = (): void => {
    onPageChange(Math.min(pageCount, currentPage + 1))
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault()
      goToPreviousPage()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault()
      goToNextPage()
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onPageChange(1)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      onPageChange(pageCount)
    }
  }
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return
    if (event.target instanceof Element && event.target.closest('button,a,input,select,textarea,[role="button"]')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left + bounds.width / 2) {
      goToPreviousPage()
    } else {
      goToNextPage()
    }
  }
  return (
    <div
      ref={presentationRef}
      aria-label={title}
      className="workspace-pdf-presentation-mode"
      data-testid="artifact-pdf-presentation"
      data-pdf-presentation-current-page={currentPage}
      data-pdf-presentation-page-count={pageCount}
      data-pdf-presentation-invert-colors={invertColors ? 'true' : 'false'}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="workspace-pdf-presentation-page">
        <iframe
          title={`${title} presentation`}
          src={pdfPreviewUrl(absolutePath, currentPage, zoomPercent)}
          className={`workspace-pdf-presentation-frame ${invertColors ? 'workspace-pdf-preview-frame-inverted' : ''}`}
          data-testid="artifact-pdf-presentation-frame"
          data-pdf-invert-colors={invertColors ? 'true' : 'false'}
        />
      </div>
      <div className="workspace-pdf-presentation-controls" data-testid="artifact-pdf-presentation-controls">
        <IconButton
          icon="arrowLeft"
          label="Previous page"
          size="sm"
          variant="toolbar"
          className="workspace-pdf-presentation-button"
          disabled={currentPage <= 1}
          dataTestId="artifact-pdf-presentation-previous"
          onClick={goToPreviousPage}
        />
        <span className="workspace-pdf-presentation-page-indicator" data-testid="artifact-pdf-presentation-page-indicator">
          {currentPage}/{pageCount}
        </span>
        <IconButton
          icon="arrowRight"
          label="Next page"
          size="sm"
          variant="toolbar"
          className="workspace-pdf-presentation-button"
          disabled={currentPage >= pageCount}
          dataTestId="artifact-pdf-presentation-next"
          onClick={goToNextPage}
        />
        <span className="workspace-pdf-presentation-separator" aria-hidden="true" />
        <Button
          variant="ghost"
          className="workspace-pdf-presentation-exit"
          dataTestId="artifact-pdf-presentation-exit"
          onClick={onClose}
        >
          <Icon name="minimize" size={13} />
          Exit
        </Button>
      </div>
    </div>
  )
}

function pdfPreviewUrl(path: string, page: number, zoomPercent: number | 'page-fit'): string {
  return `${fileUrl(path)}#page=${page}&zoom=${zoomPercent}`
}

export function joinPath(root: string, filePath: string): string {
  return `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function projectSearchEntries(entries: WorkspaceSearchEntry[], query: string): WorkspaceSearchEntry[] {
  if (query.length === 0) return entries
  const projected = new Map<string, WorkspaceSearchEntry>()
  for (const entry of entries) {
    for (const ancestor of directoryAncestors(entry.path)) {
      if (!projected.has(ancestor.path)) projected.set(ancestor.path, ancestor)
    }
    projected.set(entry.path, entry)
  }
  return [...projected.values()]
}

function directoryAncestors(filePath: string): WorkspaceSearchEntry[] {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return []
  const ancestors: WorkspaceSearchEntry[] = []
  for (let index = 0; index < parts.length - 1; index += 1) {
    const path = parts.slice(0, index + 1).join('/')
    ancestors.push({
      path,
      name: parts[index] ?? path,
      kind: 'directory',
      depth: index
    })
  }
  return ancestors
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}
