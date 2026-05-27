import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FilePreviewResult } from '../../env'
import type { WorkspaceSearchEntry, WorkspaceSearchResult } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { Badge, Button, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelHeader, PanelNotice, PanelToolbar, WorkbenchSearchField } from '../shared/designSystem'
import Icon from '../shared/Icon'
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
  sheets: Array<{ name: string; rows: string[][] }>
  truncated?: boolean
}

interface SlidesPreviewPayload {
  slides: Array<{ index: number; title: string; text: string[]; notes?: string }>
  truncated?: boolean
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
  const payload = parseSpreadsheetPreview(preview.text)
  const sheets = payload?.sheets ?? []
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 })
  const activeSheet = sheets[activeSheetIndex] ?? null
  const sheetCount = sheets.length
  const maxColumnCount = activeSheet
    ? Math.max(1, ...activeSheet.rows.map((row) => row.length))
    : 1
  const activeCellRow = activeSheet ? Math.min(activeCell.row, Math.max(0, activeSheet.rows.length - 1)) : 0
  const activeCellColumn = activeSheet ? Math.min(activeCell.column, Math.max(0, maxColumnCount - 1)) : 0
  const activeCellAddress = `${spreadsheetColumnLabel(activeCellColumn)}${activeCellRow + 1}`
  const activeCellValue = activeSheet?.rows[activeCellRow]?.[activeCellColumn] ?? ''
  useEffect(() => {
    setActiveSheetIndex((index) => Math.min(Math.max(index, 0), Math.max(0, sheetCount - 1)))
  }, [sheetCount])
  const selectSheet = (index: number): void => {
    setActiveSheetIndex(Math.min(Math.max(index, 0), Math.max(0, sheetCount - 1)))
    setActiveCell({ row: 0, column: 0 })
  }
  const zoomOut = (): void => {
    setZoomPercent((zoom) => Math.max(50, zoom - 25))
  }
  const zoomIn = (): void => {
    setZoomPercent((zoom) => Math.min(200, zoom + 25))
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
      data-spreadsheet-active-cell-address={activeSheet ? activeCellAddress : ''}
      data-spreadsheet-active-cell-value={activeSheet ? activeCellValue : ''}
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
            data-preview-controls="copy-path spreadsheet-sheet-navigation spreadsheet-zoom open-options"
            data-artifact-open-options="true"
          >
            {payload && (
              <span
                className="file-preview-zoom-controls"
                data-testid="workspace-spreadsheet-preview-zoom-controls"
                data-spreadsheet-zoom-percent={zoomPercent}
              >
                <IconButton
                  icon="zoomOut"
                  label="Zoom out"
                  size="sm"
                  variant="toolbar"
                  disabled={zoomPercent <= 50}
                  dataTestId="workspace-spreadsheet-preview-zoom-out"
                  onClick={zoomOut}
                />
                <span className="file-preview-zoom-indicator" data-testid="workspace-spreadsheet-preview-zoom-indicator">
                  {zoomPercent}%
                </span>
                <IconButton
                  icon="zoomIn"
                  label="Zoom in"
                  size="sm"
                  variant="toolbar"
                  disabled={zoomPercent >= 200}
                  dataTestId="workspace-spreadsheet-preview-zoom-in"
                  onClick={zoomIn}
                />
              </span>
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
                  aria-label="Active cell value"
                  readOnly
                  value={activeCellValue}
                />
              </div>
              <div className="workspace-spreadsheet-table-wrap">
                <table
                  className="workspace-spreadsheet-table"
                  data-testid="workspace-spreadsheet-preview-table"
                  style={{ fontSize: `${Math.max(10, Math.min(18, 12 * (zoomPercent / 100)))}px` }}
                >
                  <thead>
                    <tr>
                      <th className="workspace-spreadsheet-corner" scope="col" aria-label="Workbook grid corner" />
                      {Array.from({ length: maxColumnCount }, (_, columnIndex) => (
                        <th
                          key={columnIndex}
                          className="workspace-spreadsheet-column-header"
                          data-testid="workspace-spreadsheet-column-header"
                          data-spreadsheet-column-label={spreadsheetColumnLabel(columnIndex)}
                          scope="col"
                        >
                          {spreadsheetColumnLabel(columnIndex)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        <th
                          className="workspace-spreadsheet-row-header"
                          data-testid="workspace-spreadsheet-row-header"
                          data-spreadsheet-row-label={rowIndex + 1}
                          scope="row"
                        >
                          {rowIndex + 1}
                        </th>
                        {Array.from({ length: maxColumnCount }, (_, cellIndex) => {
                          const cell = row[cellIndex] ?? ''
                          const cellAddress = `${spreadsheetColumnLabel(cellIndex)}${rowIndex + 1}`
                          const isActive = rowIndex === activeCellRow && cellIndex === activeCellColumn
                          return (
                            <td
                              key={cellIndex}
                              data-active={isActive ? 'true' : 'false'}
                              data-spreadsheet-cell-address={cellAddress}
                            >
                              <button
                                type="button"
                                className="workspace-spreadsheet-cell-button"
                                data-testid="workspace-spreadsheet-cell"
                                data-spreadsheet-cell-address={cellAddress}
                                data-spreadsheet-cell-value={cell}
                                data-active={isActive ? 'true' : 'false'}
                                aria-label={`${cellAddress} ${cell}`.trim()}
                                onClick={() => { setActiveCell({ row: rowIndex, column: cellIndex }) }}
                                onFocus={() => { setActiveCell({ row: rowIndex, column: cellIndex }) }}
                              >
                                {cell}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
  const slideCount = slides.length
  const currentSlide = slides[currentSlideIndex] ?? null
  const notesCount = slides.filter((slide) => slide.notes?.trim()).length
  const currentSlideNotes = currentSlide?.notes?.trim() ?? ''
  useEffect(() => {
    setCurrentSlideIndex((index) => Math.min(Math.max(index, 0), Math.max(0, slideCount - 1)))
  }, [slideCount])
  const zoomOut = (): void => {
    setZoomPercent((zoom) => Math.max(50, zoom - 25))
  }
  const zoomIn = (): void => {
    setZoomPercent((zoom) => Math.min(200, zoom + 25))
  }
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
      data-slides-preview-notes-count={notesCount}
      data-slides-preview-current-notes={currentSlideNotes}
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
            data-preview-controls="copy-path slides-slide-navigation slides-zoom open-options"
            data-artifact-open-options="true"
          >
            {payload && (
              <span
                className="file-preview-zoom-controls"
                data-testid="workspace-slides-preview-zoom-controls"
                data-slides-zoom-percent={zoomPercent}
              >
                <IconButton
                  icon="zoomOut"
                  label="Zoom out"
                  size="sm"
                  variant="toolbar"
                  disabled={zoomPercent <= 50}
                  dataTestId="workspace-slides-preview-zoom-out"
                  onClick={zoomOut}
                />
                <span className="file-preview-zoom-indicator" data-testid="workspace-slides-preview-zoom-indicator">
                  {zoomPercent}%
                </span>
                <IconButton
                  icon="zoomIn"
                  label="Zoom in"
                  size="sm"
                  variant="toolbar"
                  disabled={zoomPercent >= 200}
                  dataTestId="workspace-slides-preview-zoom-in"
                  onClick={zoomIn}
                />
              </span>
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
            <section
              className="workspace-slide-stage"
              data-testid="workspace-slides-preview-current-slide"
              data-slide-index={currentSlide.index}
              style={{ fontSize: `${Math.max(10, Math.min(18, 13 * (zoomPercent / 100)))}px` }}
            >
              <div className="workspace-slide-preview-number">{currentSlide.index}</div>
              <div className="workspace-slide-preview-content">
                <h3>{currentSlide.title}</h3>
                {currentSlide.text.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
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
          .map((row) => row.map((cell) => String(cell)))
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
        notes: typeof slide.notes === 'string' ? slide.notes : ''
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
  const [invertColors, setInvertColors] = useState(false)
  const [presentationMode, setPresentationMode] = useState(false)
  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), pageCount))
  }, [pageCount])
  const goToPreviousPage = (): void => {
    setCurrentPage((page) => Math.max(1, page - 1))
  }
  const goToNextPage = (): void => {
    setCurrentPage((page) => Math.min(pageCount, page + 1))
  }
  const zoomOut = (): void => {
    setZoomPercent((zoom) => Math.max(50, zoom - 25))
  }
  const zoomIn = (): void => {
    setZoomPercent((zoom) => Math.min(200, zoom + 25))
  }
  return (
    <div
      className="file-structured-preview workspace-pdf-preview flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="workspace-pdf-preview"
      data-pdf-preview-size={preview.size ?? entry.size ?? 0}
      data-pdf-preview-page-count={pageCount}
      data-pdf-preview-current-page={currentPage}
      data-pdf-preview-zoom-percent={zoomPercent}
      data-pdf-preview-invert-colors={invertColors ? 'true' : 'false'}
      data-pdf-preview-presentation-mode={presentationMode ? 'true' : 'false'}
    >
      {presentationMode ? (
        <PdfPresentationMode
          absolutePath={absolutePath}
          currentPage={currentPage}
          invertColors={invertColors}
          pageCount={pageCount}
          title={title}
          zoomPercent={zoomPercent}
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
                data-preview-controls="copy-path pdf-page-navigation pdf-zoom pdf-invert-colors pdf-presentation open-options"
                data-artifact-open-options="true"
              >
                <IconButton
                  active={invertColors}
                  icon="contrast"
                  label={invertColors ? 'Show original colors' : 'Invert colors'}
                  size="sm"
                  variant="toolbar"
                  dataTestId="workspace-pdf-preview-invert-colors"
                  onClick={() => { setInvertColors((value) => !value) }}
                />
                <span
                  className="file-preview-zoom-controls"
                  data-testid="workspace-pdf-preview-zoom-controls"
                  data-pdf-zoom-percent={zoomPercent}
                >
                  <IconButton
                    icon="zoomOut"
                    label="Zoom out"
                    size="sm"
                    variant="toolbar"
                    disabled={zoomPercent <= 50}
                    dataTestId="workspace-pdf-preview-zoom-out"
                    onClick={zoomOut}
                  />
                  <span className="file-preview-zoom-indicator" data-testid="workspace-pdf-preview-zoom-indicator">
                    {zoomPercent}%
                  </span>
                  <IconButton
                    icon="zoomIn"
                    label="Zoom in"
                    size="sm"
                    variant="toolbar"
                    disabled={zoomPercent >= 200}
                    dataTestId="workspace-pdf-preview-zoom-in"
                    onClick={zoomIn}
                  />
                </span>
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
          <iframe
            title={entry.name}
            src={pdfPreviewUrl(absolutePath, currentPage, zoomPercent)}
            className={`min-h-0 flex-1 border-0 ${invertColors ? 'workspace-pdf-preview-frame-inverted' : ''}`}
            data-testid="workspace-pdf-preview-frame"
            data-pdf-invert-colors={invertColors ? 'true' : 'false'}
          />
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
  zoomPercent: number
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

function pdfPreviewUrl(path: string, page: number, zoomPercent: number): string {
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
