import { useEffect, useMemo, useState } from 'react'
import type { FilePreviewResult } from '../../env'
import type { GitLineBlameResult, OpenTargetAvailability, PreferredOpenTarget } from '../../types'
import { artifactImportKindSupportsSource, artifactTabPresentationForPath } from '../../types'
import type { RightPanelTabId, RightPanelTabState, SourceAnnotationState } from '../../store/sessions'
import { Badge, IconButton, MenuItem, MenuSection, MenuSectionLabel, MenuSurface, PanelToolbar } from '../shared/designSystem'
import Icon from '../shared/Icon'
import { FilePreview, formatBytes, joinPath } from './FilesPanel'

interface Props {
  workDir: string
  sessionId: string
  filePath: string
  fileHost?: string
  tabId: RightPanelTabId
  isPreview?: boolean
  fileViewMode?: RightPanelTabState['fileViewMode']
  sourceWrap?: boolean
  selectedSourceLine?: number | null
  sourceSearchQuery?: string
  sourceSearchIndex?: number
  sourceAnnotations?: SourceAnnotationState[]
  sourceBlameVisible?: boolean
  sourceRevealLine?: number | null
  sourceRevealRequest?: number
  onPin: (tabId: RightPanelTabId) => void
  onFileTabStateChange: (
    tabId: RightPanelTabId,
    patch: Pick<Partial<RightPanelTabState>, 'fileViewMode' | 'sourceWrap' | 'selectedSourceLine' | 'sourceSearchQuery' | 'sourceSearchIndex' | 'sourceAnnotations' | 'sourceBlameVisible' | 'sourceRevealLine' | 'sourceRevealRequest'>
  ) => void
}

export default function FileTabPanel({
  workDir,
  sessionId,
  filePath,
  fileHost,
  tabId,
  isPreview = false,
  fileViewMode = 'rich',
  sourceWrap = true,
  selectedSourceLine = null,
  sourceSearchQuery = '',
  sourceSearchIndex = 0,
  sourceAnnotations = [],
  sourceBlameVisible = false,
  sourceRevealLine = null,
  sourceRevealRequest = 0,
  onPin,
  onFileTabStateChange
}: Props): JSX.Element {
  const [preview, setPreview] = useState<FilePreviewResult | null>(null)
  const [copiedLineReference, setCopiedLineReference] = useState('')
  const [lineBlame, setLineBlame] = useState<GitLineBlameResult | null>(null)
  const [sourceBlameByLine, setSourceBlameByLine] = useState<Map<number, GitLineBlameResult>>(() => new Map())
  const [preferredOpenTarget, setPreferredOpenTarget] = useState<PreferredOpenTarget>('system')
  const [openTargets, setOpenTargets] = useState<OpenTargetAvailability[]>([])
  const [fileActionsOpen, setFileActionsOpen] = useState(false)
  const absolutePath = joinPath(workDir, filePath)
  const name = basename(filePath)
  const sourceMode = fileViewMode === 'source'

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setCopiedLineReference('')
    setLineBlame(null)
    setSourceBlameByLine(new Map())
    window.api.fs.previewFile(absolutePath)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch(() => {
        if (!cancelled) setPreview({ kind: 'unreadable', truncated: false })
      })
    return () => {
      cancelled = true
    }
  }, [absolutePath])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.settings.get(),
      window.api.fs.listOpenTargets()
    ])
      .then(([settings, targets]) => {
        if (cancelled) return
        setPreferredOpenTarget(normalizePreferredOpenTarget(settings.preferredEditor))
        setOpenTargets(targets)
      })
      .catch(() => {
        if (cancelled) return
        setPreferredOpenTarget('system')
        setOpenTargets([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (selectedSourceLine === null) {
      setLineBlame(null)
      return
    }
    let cancelled = false
    setLineBlame(null)
    window.api.git.blameLine(workDir, filePath, selectedSourceLine)
      .then((result) => {
        if (!cancelled) {
          setLineBlame(result)
          setSourceBlameByLine((current) => new Map(current).set(selectedSourceLine, result))
        }
      })
      .catch(() => {
        if (!cancelled) {
          const result = { ok: false, path: filePath, line: selectedSourceLine, error: 'Blame unavailable' }
          setLineBlame(result)
          setSourceBlameByLine((current) => new Map(current).set(selectedSourceLine, result))
        }
      })
    return () => {
      cancelled = true
    }
  }, [filePath, selectedSourceLine, workDir])

  const sourceBlameLineNumbers = useMemo(() => {
    const text = preview?.text
    if (text === undefined) return []
    const count = Math.max(1, text.length > 0 ? text.split('\n').length : 1)
    return Array.from({ length: Math.min(count, 400) }, (_, index) => index + 1)
  }, [preview?.text])

  useEffect(() => {
    if (!sourceBlameVisible || sourceBlameLineNumbers.length === 0) return
    const missingLines = sourceBlameLineNumbers.filter((line) => !sourceBlameByLine.has(line))
    if (missingLines.length === 0) return
    let cancelled = false
    Promise.all(missingLines.map((line) =>
      window.api.git.blameLine(workDir, filePath, line)
        .catch(() => ({ ok: false, path: filePath, line, error: 'Blame unavailable' }))
    )).then((results) => {
      if (cancelled) return
      setSourceBlameByLine((current) => {
        const next = new Map(current)
        results.forEach((result) => next.set(result.line, result))
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [filePath, sourceBlameByLine, sourceBlameLineNumbers, sourceBlameVisible, workDir])

  const updateFileTabState = (
    patch: Pick<Partial<RightPanelTabState>, 'fileViewMode' | 'sourceWrap' | 'selectedSourceLine' | 'sourceSearchQuery' | 'sourceSearchIndex' | 'sourceAnnotations' | 'sourceBlameVisible' | 'sourceRevealLine' | 'sourceRevealRequest'>
  ): void => {
    onFileTabStateChange(tabId, patch)
  }

  const copyPath = (): void => {
    void navigator.clipboard.writeText(filePath)
  }

  const copySelectedLineReference = (): void => {
    if (selectedSourceLine === null) return
    const reference = `${filePath}:${selectedSourceLine}`
    setCopiedLineReference(reference)
    void navigator.clipboard.writeText(reference)
  }

  const openSelectedLine = (): void => {
    if (selectedSourceLine === null) return
    void window.api.fs.openPath(absolutePath, { line: selectedSourceLine })
  }

  const revealSelectedLine = (): void => {
    if (selectedSourceLine === null) return
    updateFileTabState({
      fileViewMode: canToggleSourceMode ? 'source' : fileViewMode,
      sourceRevealLine: selectedSourceLine,
      sourceRevealRequest: Date.now()
    })
  }

  const addToChat = (): void => {
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-attachment', {
      detail: {
        path: absolutePath,
        name,
        size: preview?.size
      }
    }))
  }
  const canToggleSourceMode = isRichSourcePreview(preview)
  const artifactPresentation = artifactTabPresentationForPath(filePath)
  const artifactSourceSupported = artifactPresentation
    ? artifactImportKindSupportsSource(artifactPresentation.importKind)
    : false
  const openTarget = openTargetInfo(preferredOpenTarget, openTargets)
  const blame = blameInfo(lineBlame)
  const canSearchSource = preview?.text !== undefined
  const sourceSearchMatches = useMemo(
    () => collectSourceSearchMatches(preview?.text ?? '', sourceSearchQuery),
    [preview?.text, sourceSearchQuery]
  )
  const sourceSearchActiveIndex = sourceSearchMatches.length === 0
    ? -1
    : Math.min(Math.max(sourceSearchIndex, 0), sourceSearchMatches.length - 1)
  const sourceSearchActiveLine = sourceSearchActiveIndex >= 0 ? sourceSearchMatches[sourceSearchActiveIndex]?.line ?? null : null
  const sourceSearchMatchLines = useMemo(
    () => new Set(sourceSearchMatches.map((match) => match.line)),
    [sourceSearchMatches]
  )
  const sourceAnnotationLines = useMemo(
    () => new Set(sourceAnnotations.map((annotation) => annotation.line)),
    [sourceAnnotations]
  )
  const sourceBlameLoadedCount = useMemo(
    () => sourceBlameLineNumbers.filter((line) => sourceBlameByLine.has(line)).length,
    [sourceBlameByLine, sourceBlameLineNumbers]
  )

  const updateSourceSearchQuery = (query: string): void => {
    updateFileTabState({ sourceSearchQuery: query, sourceSearchIndex: 0 })
  }

  const moveSourceSearch = (direction: 1 | -1): void => {
    if (sourceSearchMatches.length === 0) return
    const nextIndex = (sourceSearchActiveIndex + direction + sourceSearchMatches.length) % sourceSearchMatches.length
    updateFileTabState({ sourceSearchIndex: nextIndex })
  }

  useEffect(() => {
    const onThreadFindQuery = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string; domain?: string; query?: string }>).detail
      if (detail?.sessionId !== sessionId || detail.domain !== 'diff') return
      updateSourceSearchQuery(detail.query ?? '')
    }
    const onThreadFindStep = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string; domain?: string; direction?: number }>).detail
      if (detail?.sessionId !== sessionId || detail.domain !== 'diff') return
      moveSourceSearch(detail.direction === -1 ? -1 : 1)
    }
    const onThreadFindClose = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (detail?.sessionId !== sessionId) return
      updateFileTabState({ sourceSearchQuery: '', sourceSearchIndex: 0 })
    }
    window.addEventListener('orchestrator:thread-find-query', onThreadFindQuery)
    window.addEventListener('orchestrator:thread-find-step', onThreadFindStep)
    window.addEventListener('orchestrator:thread-find-close', onThreadFindClose)
    return () => {
      window.removeEventListener('orchestrator:thread-find-query', onThreadFindQuery)
      window.removeEventListener('orchestrator:thread-find-step', onThreadFindStep)
      window.removeEventListener('orchestrator:thread-find-close', onThreadFindClose)
    }
  }, [moveSourceSearch, sessionId, updateSourceSearchQuery, updateFileTabState])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('orchestrator:thread-find-status', {
      detail: {
        sessionId,
        domain: 'diff',
        totalMatches: sourceSearchMatches.length,
        activeMatch: sourceSearchActiveIndex >= 0 ? sourceSearchActiveIndex + 1 : 0,
        isCapped: false,
        activePath: sourceSearchMatches.length > 0 ? filePath : null
      }
    }))
  }, [filePath, sessionId, sourceSearchActiveIndex, sourceSearchMatches.length])

  const addSourceAnnotation = (line: number | null): void => {
    if (line === null) return
    const existing = sourceAnnotations.find((annotation) => annotation.line === line)
    if (existing) {
      updateFileTabState({
        sourceAnnotations: sourceAnnotations.map((annotation) =>
          annotation.id === existing.id ? { ...annotation, status: 'draft', updatedAt: Date.now() } : annotation
        )
      })
      return
    }
    updateFileTabState({
      sourceAnnotations: [
        ...sourceAnnotations,
        {
          id: `source-annotation-${line}-${Date.now()}`,
          line,
          body: '',
          status: 'draft',
          updatedAt: Date.now()
        }
      ]
    })
  }

  const updateSourceAnnotation = (id: string, body: string): void => {
    updateFileTabState({
      sourceAnnotations: sourceAnnotations.map((annotation) =>
        annotation.id === id ? { ...annotation, body, updatedAt: Date.now() } : annotation
      )
    })
  }

  const saveSourceAnnotation = (id: string): void => {
    updateFileTabState({
      sourceAnnotations: sourceAnnotations.flatMap((annotation) => {
        if (annotation.id !== id) return [annotation]
        const body = annotation.body.trim()
        return body.length === 0 ? [] : [{ ...annotation, body, status: 'saved' as const, updatedAt: Date.now() }]
      })
    })
  }

  const deleteSourceAnnotation = (id: string): void => {
    updateFileTabState({
      sourceAnnotations: sourceAnnotations.filter((annotation) => annotation.id !== id)
    })
  }

  const fileActionsMenu = (
    <span className="file-tab-actions-menu relative">
      <IconButton
        icon="ellipsis"
        label="File viewer options"
        size="sm"
        variant="toolbar"
        active={fileActionsOpen}
        dataTestId="workbench-file-tab-actions-menu"
        onClick={() => setFileActionsOpen((open) => !open)}
      />
      {fileActionsOpen && (
        <MenuSurface
          className="file-tab-actions-menu-surface"
          onClose={() => setFileActionsOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 204, zIndex: 92 }}
        >
          {isPreview && (
            <MenuSection dataTestId="file-tab-actions-tab-section">
              <MenuSectionLabel>Tab</MenuSectionLabel>
              <MenuItem
                icon="pin"
                label="Pin file tab"
                onClick={() => { onPin(tabId); setFileActionsOpen(false) }}
              />
            </MenuSection>
          )}
          <MenuSection dataTestId="file-tab-actions-file-section">
            <MenuSectionLabel>File</MenuSectionLabel>
            <MenuItem
              icon="paperclip"
              label="Add file to chat"
              onClick={() => { addToChat(); setFileActionsOpen(false) }}
            />
            <MenuItem
              icon="copy"
              label="Copy path"
              onClick={() => { copyPath(); setFileActionsOpen(false) }}
            />
            <MenuItem
              icon="external"
              label="Open in editor"
              onClick={() => { void window.api.fs.openPath(absolutePath); setFileActionsOpen(false) }}
            />
            <MenuItem
              icon="folder"
              label="Reveal file"
              onClick={() => { void window.api.fs.showInFolder(absolutePath); setFileActionsOpen(false) }}
            />
          </MenuSection>
          <MenuSection dataTestId="file-tab-actions-view-section">
            <MenuSectionLabel>View</MenuSectionLabel>
            <MenuItem
              icon={sourceMode ? 'book' : 'file'}
              label={sourceMode ? 'Show rich preview' : artifactSourceSupported ? 'View source' : 'Show source'}
              dataTestId="workbench-file-tab-source-mode-menu-item"
              disabled={!canToggleSourceMode}
              onClick={() => {
                updateFileTabState({ fileViewMode: sourceMode ? 'rich' : 'source' })
                setFileActionsOpen(false)
              }}
            />
            <MenuItem
              icon="branch"
              label={sourceBlameVisible ? 'Hide git blame' : 'Show git blame'}
              disabled={!canSearchSource}
              onClick={() => {
                updateFileTabState({ sourceBlameVisible: !sourceBlameVisible })
                setFileActionsOpen(false)
              }}
            />
            <MenuItem
              icon="wrap"
              label={sourceWrap ? 'Disable word wrap' : 'Enable word wrap'}
              dataTestId="workbench-file-tab-wrap-source-menu-item"
              onClick={() => {
                updateFileTabState({ sourceWrap: !sourceWrap })
                setFileActionsOpen(false)
              }}
            />
          </MenuSection>
          <MenuSection dataTestId="file-tab-actions-selection-section">
            <MenuSectionLabel>Selection</MenuSectionLabel>
            <MenuItem
              icon="locate"
              label="Reveal selected line"
              disabled={selectedSourceLine === null}
              onClick={() => { revealSelectedLine(); setFileActionsOpen(false) }}
            />
            <MenuItem
              icon="copy"
              label="Copy selected line reference"
              disabled={selectedSourceLine === null}
              onClick={() => { copySelectedLineReference(); setFileActionsOpen(false) }}
            />
            <MenuItem
              icon="external"
              label="Open selected line in editor"
              disabled={selectedSourceLine === null}
              onClick={() => { openSelectedLine(); setFileActionsOpen(false) }}
            />
            <MenuItem
              icon="chat"
              label="Add source comment"
              disabled={selectedSourceLine === null}
              onClick={() => { addSourceAnnotation(selectedSourceLine); setFileActionsOpen(false) }}
            />
          </MenuSection>
        </MenuSurface>
      )}
    </span>
  )

  return (
    <div
      className="file-tab-panel-root flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-testid="workbench-file-tab"
      data-file-tab-host={fileHost ?? ''}
      data-file-tab-path={filePath}
      data-file-tab-preview={isPreview ? 'true' : 'false'}
      data-file-tab-view-mode={sourceMode && canToggleSourceMode ? 'source' : 'rich'}
      data-file-tab-selected-source-line={selectedSourceLine ?? ''}
      data-file-tab-copied-line-reference={copiedLineReference}
      data-file-tab-open-target={openTarget.id}
      data-file-tab-artifact-type={artifactPresentation?.artifactType ?? 'none'}
      data-file-tab-artifact-import-kind={artifactPresentation?.importKind ?? 'none'}
      data-file-tab-artifact-source-supported={artifactSourceSupported ? 'true' : 'false'}
      data-file-tab-loading={preview === null ? 'true' : 'false'}
      data-file-tab-source-search-query={sourceSearchQuery.trim()}
      data-file-tab-source-search-count={sourceSearchMatches.length}
      data-file-tab-source-search-index={sourceSearchActiveIndex >= 0 ? sourceSearchActiveIndex + 1 : 0}
      data-file-tab-source-search-active-line={sourceSearchActiveLine ?? ''}
      data-file-tab-source-annotation-count={sourceAnnotations.length}
      data-file-tab-source-blame-visible={sourceBlameVisible ? 'true' : 'false'}
      data-file-tab-source-blame-loaded-count={sourceBlameLoadedCount}
      data-file-tab-source-blame-line-count={sourceBlameLineNumbers.length}
      data-file-tab-source-reveal-line={sourceRevealLine ?? ''}
      data-file-tab-source-reveal-request={sourceRevealRequest}
    >
      <PanelToolbar className="file-tab-toolbar" dataTestId="workbench-file-tab-toolbar">
        <span className="file-tab-title min-w-0 flex-1">
          <Icon name="file" size={13} />
          <span className="min-w-0 truncate">{filePath}</span>
        </span>
        <span className="file-tab-info">
          {isPreview && <Badge tone="neutral">Preview</Badge>}
          {preview?.size !== undefined && (
            <span className="file-tab-meta">{formatBytes(preview.size)}</span>
          )}
          <span
            className="file-tab-open-target"
            data-testid="workbench-file-tab-open-target"
            data-open-target={openTarget.id}
            data-open-target-available={openTarget.available ? 'true' : 'false'}
            data-line-target-supported={openTarget.supportsLineTarget ? 'true' : 'false'}
          >
            {openTarget.label}
          </span>
          {selectedSourceLine !== null && (
            <span
              className="file-tab-meta file-tab-blame"
              data-testid="workbench-file-tab-line-blame"
              data-line-blame-ok={lineBlame?.ok === true ? 'true' : 'false'}
              data-line-blame-author={lineBlame?.author ?? ''}
              data-line-blame-commit={lineBlame?.commit ?? ''}
              data-line-blame-source={blame.source}
            >
              L{selectedSourceLine}{blame.label ? ` · ${blame.label}` : lineBlame?.ok === false ? ' · Blame unavailable' : ''}
            </span>
          )}
        </span>
        <span className="file-tab-actions" data-testid="workbench-file-tab-actions">
          {isPreview && (
            <IconButton
              icon="pin"
              label="Pin file tab"
              size="sm"
              variant="toolbar"
              className="file-tab-secondary-action"
              onClick={() => onPin(tabId)}
            />
          )}
          <IconButton icon="paperclip" label="Add file to chat" size="sm" variant="toolbar" className="file-tab-secondary-action" onClick={addToChat} />
          <IconButton
            icon={sourceMode ? 'book' : 'file'}
            label={sourceMode ? 'Show rich preview' : artifactSourceSupported ? 'View source' : 'Show source'}
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            active={sourceMode && canToggleSourceMode}
            disabled={!canToggleSourceMode}
            dataTestId="workbench-file-tab-source-mode"
            onClick={() => updateFileTabState({ fileViewMode: sourceMode ? 'rich' : 'source' })}
          />
          <IconButton
            icon="wrap"
            label={sourceWrap ? 'Disable word wrap' : 'Enable word wrap'}
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            active={sourceWrap}
            dataTestId="workbench-file-tab-wrap-source"
            onClick={() => updateFileTabState({ sourceWrap: !sourceWrap })}
          />
          <IconButton
            icon="branch"
            label={sourceBlameVisible ? 'Hide git blame' : 'Show git blame'}
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            active={sourceBlameVisible}
            disabled={!canSearchSource}
            dataTestId="workbench-file-tab-toggle-blame"
            onClick={() => updateFileTabState({ sourceBlameVisible: !sourceBlameVisible })}
          />
          <IconButton
            icon="locate"
            label="Reveal selected line"
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            disabled={selectedSourceLine === null}
            dataTestId="workbench-file-tab-reveal-line"
            onClick={revealSelectedLine}
          />
          <IconButton
            icon="copy"
            label="Copy selected line reference"
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            disabled={selectedSourceLine === null}
            dataTestId="workbench-file-tab-copy-line"
            onClick={copySelectedLineReference}
          />
          <IconButton
            icon="external"
            label="Open selected line in editor"
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            disabled={selectedSourceLine === null}
            dataTestId="workbench-file-tab-open-line"
            onClick={openSelectedLine}
          />
          <IconButton
            icon="chat"
            label="Add source comment"
            size="sm"
            variant="toolbar"
            className="file-tab-secondary-action"
            disabled={selectedSourceLine === null}
            dataTestId="workbench-file-tab-add-comment"
            onClick={() => addSourceAnnotation(selectedSourceLine)}
          />
          <IconButton icon="copy" label="Copy path" size="sm" variant="toolbar" className="file-tab-secondary-action" onClick={copyPath} />
          <IconButton icon="folder" label="Reveal file" size="sm" variant="toolbar" className="file-tab-secondary-action" onClick={() => { void window.api.fs.showInFolder(absolutePath) }} />
          {fileActionsMenu}
          <IconButton icon="external" label="Open in editor" size="sm" variant="toolbar" dataTestId="workbench-file-tab-open-editor" onClick={() => { void window.api.fs.openPath(absolutePath) }} />
        </span>
      </PanelToolbar>
      <div
        className="file-tab-preview min-h-0 flex-1 overflow-hidden"
        data-testid="workbench-file-tab-preview"
        data-file-preview-loading={preview === null ? 'true' : 'false'}
      >
        <FilePreview
          entry={{
            path: filePath,
            name,
            kind: 'file',
            depth: filePath.split('/').length - 1,
            size: preview?.size
          }}
          absolutePath={absolutePath}
          preview={preview}
          forceSource={sourceMode && canToggleSourceMode}
          sourceWrap={sourceWrap}
          selectedSourceLine={selectedSourceLine}
          sourceSearchQuery={sourceSearchQuery}
          sourceSearchActiveLine={sourceSearchActiveLine}
          sourceSearchMatchLines={sourceSearchMatchLines}
          sourceRevealLine={sourceRevealLine}
          sourceRevealRequest={sourceRevealRequest}
          sourceAnnotationLines={sourceAnnotationLines}
          structuredPreviewExtraActions={artifactSourceSupported && canToggleSourceMode && !sourceMode
            ? [{
                id: 'view-source',
                icon: 'file',
                label: 'View source',
                onClick: () => updateFileTabState({ fileViewMode: 'source' })
              }]
            : []}
          onSelectedSourceLineChange={(line) => updateFileTabState({ selectedSourceLine: line })}
          renderLineGutterAdornment={(line) => sourceBlameVisible ? (
            <SourceGutterBlame result={sourceBlameByLine.get(line) ?? null} line={line} />
          ) : null}
          renderLineAnnotation={(line) => (
            <SourceAnnotationStack
              annotations={sourceAnnotations.filter((annotation) => annotation.line === line)}
              onChange={updateSourceAnnotation}
              onSave={saveSourceAnnotation}
              onDelete={deleteSourceAnnotation}
            />
          )}
          renderSelectedLineActions={(line) => (
            <>
              <IconButton
                icon="copy"
                label="Copy line reference"
                size="sm"
                variant="toolbar"
                dataTestId="workspace-source-line-action-copy"
                onClick={copySelectedLineReference}
              />
              <IconButton
                icon="external"
                label={`Open line in ${openTarget.shortLabel}`}
                size="sm"
                variant="toolbar"
                dataTestId="workspace-source-line-action-open"
                onClick={openSelectedLine}
              />
              <IconButton
                icon="chat"
                label="Add comment"
                size="sm"
                variant="toolbar"
                dataTestId="workspace-source-line-action-comment"
                onClick={() => addSourceAnnotation(line)}
              />
              <span
                className="workspace-source-line-action-blame"
                data-testid="workspace-source-line-action-blame"
                data-source-line-action-blame-source={blame.source}
              >
                {blame.label || 'Blame'}
              </span>
              {sourceBlameVisible && selectedSourceLine === line && (
                <SourceBlameDetails result={lineBlame} line={line} />
              )}
            </>
          )}
        />
      </div>
    </div>
  )
}

function SourceBlameDetails({ result, line }: { result: GitLineBlameResult | null; line: number }): JSX.Element {
  const details = blameDetails(result)
  return (
    <div
      className="workspace-source-blame-details"
      data-testid="workspace-source-blame-details"
      data-source-blame-line={line}
      data-source-blame-ok={result?.ok === true ? 'true' : 'false'}
      data-source-blame-source={details.source}
      data-source-blame-author={details.author}
      data-source-blame-commit={details.commit}
      data-source-blame-date={details.date}
    >
      <div className="workspace-source-blame-row">
        <span>Author</span>
        <strong>{details.author || 'Unknown'}</strong>
      </div>
      <div className="workspace-source-blame-row">
        <span>Commit</span>
        <strong>{details.commit || 'Unavailable'}</strong>
      </div>
      <div className="workspace-source-blame-row">
        <span>Date</span>
        <strong>{details.date || 'Unavailable'}</strong>
      </div>
    </div>
  )
}

function SourceGutterBlame({ result, line }: { result: GitLineBlameResult | null; line: number }): JSX.Element {
  const details = blameDetails(result)
  const label = blameGutterLabel(details.author, details.commit, details.source)
  return (
    <span
      className="workspace-source-gutter-blame"
      data-testid="workspace-source-gutter-blame"
      data-source-gutter-blame-line={line}
      data-source-gutter-blame-source={details.source}
      data-source-gutter-blame-author={details.author}
      data-source-gutter-blame-commit={details.commit}
      data-source-gutter-blame-date={details.date}
      aria-label={details.author ? `Blame: ${details.author}` : 'Blame unavailable'}
    >
      {label}
    </span>
  )
}

function SourceAnnotationStack({
  annotations,
  onChange,
  onSave,
  onDelete
}: {
  annotations: SourceAnnotationState[]
  onChange: (id: string, body: string) => void
  onSave: (id: string) => void
  onDelete: (id: string) => void
}): JSX.Element | null {
  if (annotations.length === 0) return null
  return (
    <div className="workspace-source-annotations" data-testid="workspace-source-annotations">
      {annotations.map((annotation) => (
        <div
          key={annotation.id}
          className="workspace-source-annotation-card"
          data-testid="workspace-source-annotation-card"
          data-source-annotation-id={annotation.id}
          data-source-annotation-line={annotation.line}
          data-source-annotation-status={annotation.status}
        >
          <div className="workspace-source-annotation-header">
            <span>Comment</span>
            <span>L{annotation.line}</span>
          </div>
          {annotation.status === 'draft' ? (
            <>
              <textarea
                className="workspace-source-annotation-input"
                data-testid="workspace-source-annotation-input"
                aria-label={`Comment for line ${annotation.line}`}
                value={annotation.body}
                placeholder="Add a note for this line"
                onChange={(event) => onChange(annotation.id, event.target.value)}
              />
              <div className="workspace-source-annotation-actions">
                <IconButton
                  icon="check"
                  label="Save comment"
                  size="sm"
                  variant="toolbar"
                  disabled={annotation.body.trim().length === 0}
                  dataTestId="workspace-source-annotation-save"
                  onClick={() => onSave(annotation.id)}
                />
                <IconButton
                  icon="close"
                  label="Delete comment"
                  size="sm"
                  variant="toolbar"
                  dataTestId="workspace-source-annotation-delete"
                  onClick={() => onDelete(annotation.id)}
                />
              </div>
            </>
          ) : (
            <div className="workspace-source-annotation-body" data-testid="workspace-source-annotation-body">
              {annotation.body}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function isRichSourcePreview(preview: FilePreviewResult | null): boolean {
  return Boolean(preview?.text && ['markdown', 'json', 'csv', 'notebook', 'document'].includes(preview.kind))
}

function collectSourceSearchMatches(text: string, query: string): Array<{ line: number }> {
  const trimmedQuery = query.trim().toLocaleLowerCase()
  if (!trimmedQuery) return []
  return text.split('\n').flatMap((line, index) =>
    line.toLocaleLowerCase().includes(trimmedQuery) ? [{ line: index + 1 }] : []
  )
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function normalizePreferredOpenTarget(value: unknown): PreferredOpenTarget {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

function openTargetInfo(target: PreferredOpenTarget, targets: OpenTargetAvailability[]): {
  id: PreferredOpenTarget
  label: string
  shortLabel: string
  available: boolean
  supportsLineTarget: boolean
} {
  const fallback = target === 'system'
    ? { label: 'Open', shortLabel: 'System', available: true, supportsLineTarget: false }
    : { label: openButtonLabel(target), shortLabel: openTargetShortLabel(target), available: false, supportsLineTarget: false }
  const match = targets.find((candidate) => candidate.id === target)
  if (!match) return { id: target, ...fallback }
  return {
    id: target,
    label: target === 'system' ? 'Open' : `Open in ${match.label}`,
    shortLabel: match.label,
    available: match.available,
    supportsLineTarget: match.supportsLineTarget
  }
}

function openButtonLabel(editor: PreferredOpenTarget): string {
  return editor === 'system' ? 'Open' : `Open in ${openTargetShortLabel(editor)}`
}

function openTargetShortLabel(editor: PreferredOpenTarget): string {
  switch (editor) {
    case 'cursor':
      return 'Cursor'
    case 'vscode':
      return 'VS Code'
    case 'vscode-insiders':
      return 'VS Code Insiders'
    case 'zed':
      return 'Zed'
    case 'system':
      return 'System'
  }
}

function blameInfo(result: GitLineBlameResult | null): { label: string; source: 'unknown' | 'commit' | 'working-tree' | 'unavailable' } {
  if (!result) return { label: '', source: 'unknown' }
  if (!result.ok) return { label: 'Blame unavailable', source: 'unavailable' }
  const author = result.author ?? ''
  const source = result.commit ? 'commit' : author === 'Not Committed Yet' ? 'working-tree' : 'unknown'
  const revision = result.commit ? result.commit.slice(0, 8) : source === 'working-tree' ? 'Working tree' : ''
  const label = [author || result.summary, revision].filter(Boolean).join(' · ')
  return { label, source }
}

function blameDetails(result: GitLineBlameResult | null): {
  author: string
  commit: string
  date: string
  source: 'unknown' | 'commit' | 'working-tree' | 'unavailable'
} {
  const info = blameInfo(result)
  if (!result || !result.ok) {
    return {
      author: '',
      commit: result?.error ?? '',
      date: '',
      source: info.source
    }
  }
  const commit = result.commit ? result.commit.slice(0, 8) : info.source === 'working-tree' ? 'Working tree' : ''
  return {
    author: result.author ?? '',
    commit,
    date: result.authorTime ? new Date(result.authorTime * 1000).toLocaleDateString() : '',
    source: info.source
  }
}

function blameGutterLabel(
  author: string,
  commit: string,
  source: 'unknown' | 'commit' | 'working-tree' | 'unavailable'
): string {
  if (source === 'working-tree') return 'WT'
  if (source === 'unavailable') return '!'
  if (author) {
    const initials = author
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
    return initials || author.slice(0, 2).toUpperCase()
  }
  if (commit) return commit.slice(0, 2).toUpperCase()
  return '...'
}
