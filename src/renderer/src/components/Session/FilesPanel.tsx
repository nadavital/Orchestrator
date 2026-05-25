import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FilePreviewResult } from '../../env'
import type { WorkspaceSearchEntry, WorkspaceSearchResult } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { Badge, Button, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelHeader, PanelNotice, PanelToolbar, WorkbenchSearchField } from '../shared/designSystem'
import Icon from '../shared/Icon'
import StructuredDataPreview, { type PreviewHeaderAction } from './StructuredDataPreview'
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
      label: 'Open file',
      onClick: () => { void window.api.fs.openPath(absolutePath) }
    },
    {
      id: 'reveal-file',
      icon: 'folder',
      label: 'Reveal file',
      onClick: () => { void window.api.fs.showInFolder(absolutePath) }
    }
  )
  return actions
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
  return (
    <div
      className="file-structured-preview workspace-pdf-preview flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="workspace-pdf-preview"
      data-pdf-preview-size={preview.size ?? entry.size ?? 0}
    >
      <PanelToolbar className="file-preview-header" dataTestId="workspace-pdf-preview-header">
        <Badge tone="neutral">PDF</Badge>
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        <span className="file-tab-meta">{formatBytes(preview.size ?? entry.size ?? 0)}</span>
        <span
          className="file-preview-header-actions"
          data-testid="workspace-pdf-preview-actions"
          data-preview-controls="copy-path open-file reveal-file"
        >
          {artifactPreviewActions(entry, absolutePath, preview).map((action) => (
            <IconButton
              key={action.id}
              icon={action.icon}
              label={action.label}
              size="sm"
              variant="toolbar"
              dataTestId={`workspace-pdf-preview-action-${action.id}`}
              onClick={action.onClick}
            />
          ))}
        </span>
      </PanelToolbar>
      <iframe
        title={entry.name}
        src={fileUrl(absolutePath)}
        className="min-h-0 flex-1 border-0"
        data-testid="workspace-pdf-preview-frame"
      />
    </div>
  )
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
