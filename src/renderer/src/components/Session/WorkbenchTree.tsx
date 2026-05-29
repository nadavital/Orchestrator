import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import Icon, { type IconName } from '../shared/Icon'

export interface WorkbenchTreeRow {
  id: string
  name: string
  kind: 'file' | 'directory'
  depth?: number
  icon?: IconName
  expandable?: boolean
  expanded?: boolean
  loading?: boolean
  active?: boolean
  disabled?: boolean
  title?: string
  status?: string
  statusLabel?: string
  statusColor?: string
  meta?: ReactNode
  decorations?: ReactNode
  className?: string
  dataReviewPath?: string
  dataTestId?: string
  dataOpenTarget?: string
  dataSearchMatchKind?: string
  dataSearchMatchLine?: number | string
  dataReviewSearchActive?: boolean
  dataReviewGroupPath?: string
  dataReviewFileCount?: number
  dataReviewAdditions?: number
  dataReviewDeletions?: number
  onSelect?: () => void
  onOpen?: () => void
  onContextMenu?: (event: ReactMouseEvent, row: WorkbenchTreeRow) => void
}

interface WorkbenchTreeProps {
  rows: WorkbenchTreeRow[]
  ariaLabel: string
  className?: string
  dataTestId?: string
  dataHost?: string
  dataLazyDirectories?: boolean
  emptyState?: ReactNode
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  rowHeight?: number
  revealActiveRow?: boolean
  stickyDirectories?: boolean
  virtualizedThreshold?: number
}

const overscanRows = 8

export default function WorkbenchTree({
  rows,
  ariaLabel,
  className = '',
  dataTestId,
  dataHost,
  dataLazyDirectories,
  emptyState,
  onKeyDown,
  rowHeight = 28,
  revealActiveRow = false,
  stickyDirectories = false,
  virtualizedThreshold = 80
}: WorkbenchTreeProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const shouldVirtualize = rows.length > virtualizedThreshold
  const activeRowIndex = useMemo(() => rows.findIndex((row) => row.active), [rows])
  const activeRow = activeRowIndex >= 0 ? rows[activeRowIndex] : null
  const activeRowId = activeRow?.id ?? ''

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = (): void => setViewportHeight(root.clientHeight)
    update()
    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(root)
    return () => resizeObserver.disconnect()
  }, [])

  const visibleWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        rows,
        topPadding: 0,
        bottomPadding: 0,
        startIndex: 0
      }
    }
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows)
    const visibleCount = Math.ceil((viewportHeight || rowHeight * 12) / rowHeight) + overscanRows * 2
    const endIndex = Math.min(rows.length, startIndex + visibleCount)
    return {
      rows: rows.slice(startIndex, endIndex),
      topPadding: startIndex * rowHeight,
      bottomPadding: Math.max(0, (rows.length - endIndex) * rowHeight),
      startIndex
    }
  }, [rowHeight, rows, scrollTop, shouldVirtualize, viewportHeight])
  const stickyDirectory = useMemo(() => {
    if (!stickyDirectories || visibleWindow.startIndex <= 0) return null
    for (let index = Math.min(visibleWindow.startIndex - 1, rows.length - 1); index >= 0; index -= 1) {
      const row = rows[index]
      if (row?.kind === 'directory') return { row, index }
    }
    return null
  }, [rows, stickyDirectories, visibleWindow.startIndex])
  const activeRowVisible = useMemo(() => {
    if (activeRowIndex < 0) return false
    if (!shouldVirtualize) return true
    const visibleHeight = viewportHeight || rowHeight * 12
    const activeTop = activeRowIndex * rowHeight
    const activeBottom = activeTop + rowHeight
    return activeTop >= scrollTop && activeBottom <= scrollTop + visibleHeight + 1
  }, [activeRowIndex, rowHeight, scrollTop, shouldVirtualize, viewportHeight])

  useLayoutEffect(() => {
    if (!revealActiveRow || !activeRowId || activeRowIndex < 0) return
    const root = rootRef.current
    if (!root) return
    const requestFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback): number => window.setTimeout(() => callback(performance.now()), 16)
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout
    const frame = requestFrame(() => {
      const visibleHeight = root.clientHeight || viewportHeight || rowHeight * 12
      const activeTop = activeRowIndex * rowHeight
      const activeBottom = activeTop + rowHeight
      const current = root.scrollTop
      let next = current
      if (activeTop < current) next = activeTop
      else if (activeBottom > current + visibleHeight) next = Math.max(0, activeBottom - visibleHeight)
      if (Math.abs(next - current) > 1) {
        root.scrollTop = next
        setScrollTop(next)
      }
    })
    return () => cancelFrame(frame)
  }, [activeRowId, revealActiveRow, rowHeight, viewportHeight])

  return (
    <div
      ref={rootRef}
      className={`workbench-tree ${className}`}
      data-testid={dataTestId}
      data-workbench-tree="true"
      data-workbench-tree-host={dataHost}
      data-lazy-directories={dataLazyDirectories ? 'true' : 'false'}
      data-sticky-directories={stickyDirectories ? 'true' : 'false'}
      data-virtualized={shouldVirtualize ? 'true' : 'false'}
      data-reveal-active-row={revealActiveRow ? 'true' : 'false'}
      data-active-row-index={activeRowIndex >= 0 ? String(activeRowIndex) : ''}
      data-active-row-id={activeRowId}
      data-active-row-visible={activeRowVisible ? 'true' : 'false'}
      role="tree"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ '--workbench-tree-item-height': `${rowHeight}px` } as CSSProperties}
    >
      {rows.length === 0 ? emptyState : (
        <>
          {stickyDirectory && (
            <div className="workbench-tree-sticky-overlay" aria-hidden="true">
              <WorkbenchTreeRowView
                row={{
                  ...stickyDirectory.row,
                  active: false,
                  onSelect: undefined,
                  onOpen: undefined,
                  onContextMenu: undefined
                }}
                index={stickyDirectory.index}
                stickyClone
              />
            </div>
          )}
          <div className="workbench-tree-inner">
            {visibleWindow.topPadding > 0 && <div aria-hidden="true" style={{ height: visibleWindow.topPadding }} />}
            {visibleWindow.rows.map((row, index) => (
              <WorkbenchTreeRowView
                key={row.id}
                row={row}
                index={visibleWindow.startIndex + index}
              />
            ))}
            {visibleWindow.bottomPadding > 0 && <div aria-hidden="true" style={{ height: visibleWindow.bottomPadding }} />}
          </div>
        </>
      )}
    </div>
  )
}

export function WorkbenchTreeMessage({
  children,
  dataTestId,
  tone = 'muted',
  state
}: {
  children: ReactNode
  dataTestId?: string
  tone?: 'muted' | 'error'
  state?: string
}): JSX.Element {
  return (
    <div
      className="workbench-tree-message"
      data-testid={dataTestId}
      data-workbench-tree-message="true"
      data-workbench-tree-message-tone={tone}
      data-workbench-tree-message-state={state}
    >
      {children}
    </div>
  )
}

function WorkbenchTreeRowView({
  row,
  index,
  stickyClone = false
}: {
  row: WorkbenchTreeRow
  index: number
  stickyClone?: boolean
}): JSX.Element {
  const icon = row.icon ?? (row.kind === 'directory' ? 'folder' : 'file')
  const depth = Math.max(0, row.depth ?? 0)
  const className = `workbench-tree-row ${stickyClone ? 'workbench-tree-sticky-row' : ''} ${row.className ?? ''}`
  const style = {
    '--workbench-tree-depth': String(Math.min(depth, 8))
  } as CSSProperties
  const shared = {
    className,
    style,
    role: stickyClone ? undefined : 'treeitem',
    'aria-level': stickyClone ? undefined : depth + 1,
    'aria-selected': stickyClone ? undefined : row.active ? 'true' : 'false',
    'aria-expanded': !stickyClone && row.expandable ? row.expanded ? 'true' : 'false' : undefined,
    'aria-disabled': !stickyClone && row.disabled ? 'true' : undefined,
    'data-active': row.active ? 'true' : 'false',
    'data-kind': row.kind,
    'data-workbench-git-status': row.status ? gitStatusAttribute(row.status) : undefined,
    'data-workbench-has-git-lane': row.status ? 'true' : undefined,
    'data-expanded': row.expandable ? row.expanded ? 'true' : 'false' : undefined,
    'data-loading': row.loading ? 'true' : undefined,
    'data-review-path': row.dataReviewPath,
    'data-testid': row.dataTestId,
    'data-open-target': row.dataOpenTarget,
    'data-search-match-kind': row.dataSearchMatchKind,
    'data-search-match-line': row.dataSearchMatchLine,
    'data-review-search-active': row.dataReviewSearchActive ? 'true' : undefined,
    'data-review-group-path': row.dataReviewGroupPath,
    'data-review-file-count': row.dataReviewFileCount,
    'data-review-additions': row.dataReviewAdditions,
    'data-review-deletions': row.dataReviewDeletions,
    'data-workbench-tree-row': 'true',
    'data-sticky-row': stickyClone ? 'true' : undefined,
    'data-row-index': index,
    'data-tooltip-label': row.title,
    'data-native-title-free': row.title ? 'true' : undefined
  }

  const content = (
    <>
      {row.expandable && (
        <span className="workbench-tree-disclosure" aria-hidden="true">
          <Icon name={row.expanded ? 'chevronDown' : 'chevronRight'} size={11} />
        </span>
      )}
      <span className="workbench-tree-icon" aria-hidden="true">
        <Icon name={icon} size={13} />
      </span>
      <span className="workbench-tree-label truncate">{row.name}</span>
      {row.meta && <span className="workbench-tree-meta">{row.meta}</span>}
      {row.decorations && <span className="workbench-tree-decorations">{row.decorations}</span>}
      {row.status && (
        <span
          className="workbench-tree-git-lane"
          style={{ color: row.statusColor }}
          aria-label={row.statusLabel}
        >
          {row.status}
        </span>
      )}
    </>
  )

  if (row.onSelect || row.onOpen) {
    return (
      <button
        type="button"
        {...shared}
        disabled={row.disabled}
        onClick={() => row.onSelect?.()}
        onDoubleClick={() => (row.onOpen ?? row.onSelect)?.()}
        onContextMenu={(event) => row.onContextMenu?.(event, row)}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      {...shared}
      onContextMenu={(event) => row.onContextMenu?.(event, row)}
    >
      {content}
    </div>
  )
}

function gitStatusAttribute(status: string): string {
  switch (status) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case '?':
      return 'untracked'
    case 'M':
    default:
      return 'modified'
  }
}
