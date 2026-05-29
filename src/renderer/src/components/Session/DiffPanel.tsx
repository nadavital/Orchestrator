import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { flushSync } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { adjacentFileChangePath, buildFileChangeTreeRows, diffForPathFromUnifiedDiff, fileStatusLabel, isBinaryDiffText, parseFileChangesFromUnifiedDiff, resolveReviewDiffRenderWindow, shouldPreferTextDiff } from '../../types'
import type { CodexReviewStartRequest, FileChange, GitLineBlameResult, GitRefOption, ReviewCheckStatus, ReviewDiffSource, ReviewMetadata, ReviewProviderComment, SessionRunEventRecord } from '../../types'
import type { FilePreviewResult } from '../../env'
import { useSessionStore } from '../../store/sessions'
import { Badge, Button, IconButton, MenuItem, MenuMessage, MenuRow, MenuSection, MenuSectionLabel, MenuSurface, PanelHeader, PanelNotice, PanelResizeHandle, PanelToolbar, WorkbenchSearchField, useAppShellResizeController } from '../shared/designSystem'
import Icon, { type IconName } from '../shared/Icon'
import { FilePreview } from './FilesPanel'
import StructuredDataPreview from './StructuredDataPreview'
import WorkbenchTree, { type WorkbenchTreeContextMenuEvent, type WorkbenchTreeRow } from './WorkbenchTree'

interface Props {
  sessionId: string
  workDir: string
  embedded?: boolean
}

type ReviewDiffMode = 'unified' | 'split'
type ReviewMetadataPanel = 'pull-request' | 'checks' | 'reviewers' | 'comments'
type ReviewSourceSupport = {
  hasLastTurnDiff: boolean
  hasLocalProviderSource: boolean
  hasWorktreeProviderSource: boolean
  hasCloudProviderSource: boolean
}
type ReviewSearchNavigationMatch = {
  path: string
  ordinal: number
  fileMatchIndex: number
  diffMatchIndex: number | null
  kind: 'path' | 'diff' | 'preview'
}

interface ReviewFileContent {
  diff: string
  preview: FilePreviewResult | null
  loading: boolean
}

type ReviewDiffCommentUpdater = ReviewDiffComment[] | ((current: ReviewDiffComment[]) => ReviewDiffComment[])
type ReviewSuggestionStatus = 'copied' | 'applying' | 'applied' | 'failed'

const REVIEW_DIFF_SOURCES: Array<{ id: ReviewDiffSource; label: string; ariaLabel: string; group: 'local' | 'provider' }> = [
  { id: 'all', label: 'All', ariaLabel: 'Show all changes', group: 'local' },
  { id: 'unstaged', label: 'Worktree', ariaLabel: 'Show unstaged changes', group: 'local' },
  { id: 'staged', label: 'Staged', ariaLabel: 'Show staged changes', group: 'local' },
  { id: 'branch', label: 'Branch', ariaLabel: 'Compare HEAD with a base branch', group: 'local' },
  { id: 'commit', label: 'Commit', ariaLabel: 'Show changes from a commit', group: 'local' },
  { id: 'last-turn', label: 'Last turn', ariaLabel: 'Review the last provider turn when supported', group: 'provider' },
  { id: 'cloud', label: 'Cloud', ariaLabel: 'Review provider cloud changes when supported', group: 'provider' },
  { id: 'local', label: 'Local', ariaLabel: 'Review provider local changes when supported', group: 'provider' },
  { id: 'worktree', label: 'Worktree source', ariaLabel: 'Review provider worktree changes when supported', group: 'provider' }
]
const REVIEW_SOURCE_STORAGE_PREFIX = 'orchestrator.review.source:'
const REVIEW_SOURCE_REF_STORAGE_PREFIX = 'orchestrator.review.sourceRef:'
const REVIEW_SIDE_PANE_WIDTH_STORAGE_PREFIX = 'orchestrator.review.sidePaneWidth:'
const REVIEW_SIDE_PANE_VISIBLE_STORAGE_PREFIX = 'orchestrator.review.sidePaneVisible:'
const REVIEW_SIDE_PANE_MIN_WIDTH = 200
const REVIEW_SIDE_PANE_DEFAULT_WIDTH = 220
const REVIEW_SIDE_PANE_MAX_RATIO = 0.6
const REVIEW_SEARCH_MATCH_CAP = 250
const REVIEW_OPTIONS_MENU_ID = 'review-options-menu-surface'
const REVIEW_FILE_JUMP_MENU_ID = 'review-file-jump-menu-surface'
const REVIEW_METADATA_MENU_ID = 'review-metadata-menu-surface'

export default function DiffPanel({ sessionId, workDir, embedded = false }: Props): JSX.Element {
  const [files, setFiles] = useState<FileChange[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [reviewFileContentByPath, setReviewFileContentByPath] = useState<Record<string, ReviewFileContent>>({})
  const [reviewCommentsByPath, setReviewCommentsByPath] = useState<Record<string, ReviewDiffComment[]>>({})
  const [localReviewFiles, setLocalReviewFiles] = useState<FileChange[]>([])
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [fullSourceText, setFullSourceText] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [reviewSearchActiveMatchIndex, setReviewSearchActiveMatchIndex] = useState<number | null>(null)
  const [wrapLines, setWrapLines] = useState(true)
  const [diffMode, setDiffMode] = useState<ReviewDiffMode>('unified')
  const [diffExpanded, setDiffExpanded] = useState(true)
  const [reviewSource, setReviewSourceState] = useState<ReviewDiffSource>(() => readStoredReviewSource(workDir))
  const [branchReviewRef, setBranchReviewRef] = useState(() => readStoredReviewSourceRef(workDir, 'branch'))
  const [commitReviewRef, setCommitReviewRef] = useState(() => readStoredReviewSourceRef(workDir, 'commit'))
  const [hideWhitespace, setHideWhitespace] = useState(false)
  const [showWordDiff, setShowWordDiff] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [reviewOptionsOpen, setReviewOptionsOpen] = useState(false)
  const [fileJumpOpen, setFileJumpOpen] = useState(false)
  const [fileJumpQuery, setFileJumpQuery] = useState('')
  const [reviewSidePaneWidth, setReviewSidePaneWidth] = useState(() => readStoredReviewSidePaneWidth(workDir))
  const [reviewSidePaneVisible, setReviewSidePaneVisible] = useState(() => readStoredReviewSidePaneVisible(workDir))
  const [branchRefOptions, setBranchRefOptions] = useState<GitRefOption[]>([])
  const [commitRefOptions, setCommitRefOptions] = useState<GitRefOption[]>([])
  const [branchRefPickerOpen, setBranchRefPickerOpen] = useState(false)
  const [commitRefPickerOpen, setCommitRefPickerOpen] = useState(false)
  const [branchRefQuery, setBranchRefQuery] = useState('')
  const [commitRefQuery, setCommitRefQuery] = useState('')
  const [reviewMetadataOpen, setReviewMetadataOpen] = useState<ReviewMetadataPanel | null>(null)
  const [loadedReviewMetadata, setLoadedReviewMetadata] = useState<ReviewMetadata | undefined>(undefined)
  const [reviewGitActionMessage, setReviewGitActionMessage] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const [reviewRowMenu, setReviewRowMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const [codexReviewStartPending, setCodexReviewStartPending] = useState(false)
  const [customReviewInstructions, setCustomReviewInstructions] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reviewSearchInputRef = useRef<HTMLInputElement | null>(null)
  const openRightPanelTab = useSessionStore((state) => state.openRightPanelTab)
  const openRightPanelFileTab = useSessionStore((state) => state.openRightPanelFileTab)
  const reviewSession = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId))
  const storeReviewMetadata = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId)?.reviewMetadata)
  const lastTurnDiff = useSessionStore((state) => latestDiffUpdatedContent(state.eventBuffers[sessionId] ?? []))
  const reviewMetadata = storeReviewMetadata ?? loadedReviewMetadata
  const lastTurnReviewFiles = useMemo(() => parseFileChangesFromUnifiedDiff(lastTurnDiff), [lastTurnDiff])
  const reviewSourceSupport = useMemo<ReviewSourceSupport>(() => {
    const threadSource = reviewSession?.providerThreadSource
    const isWorktree = reviewSession?.useWorktree === true || threadSource === 'worktree'
    const isCloud = threadSource === 'cloud'
    const isRemoteOnly = threadSource === 'remote' || threadSource === 'remote-host'
    return {
      hasLastTurnDiff: lastTurnReviewFiles.length > 0,
      hasLocalProviderSource: Boolean(reviewSession) && !isWorktree && !isCloud && !isRemoteOnly,
      hasWorktreeProviderSource: Boolean(reviewSession) && isWorktree,
      hasCloudProviderSource: false
    }
  }, [lastTurnReviewFiles.length, reviewSession])
  const activeReviewRef = reviewSource === 'branch'
    ? branchReviewRef.trim()
    : reviewSource === 'commit'
      ? commitReviewRef.trim()
      : ''
  const reviewSourceSupported = isSupportedReviewDiffSource(reviewSource, reviewSourceSupport)
  const reviewSourceNeedsRef = reviewSource === 'branch' || reviewSource === 'commit'
  const reviewApiSource = localGitSourceForReviewSource(reviewSource)
  const sourceFiles = useMemo(() => files.filter((file) => fileMatchesReviewSource(file, reviewSource)), [files, reviewSource])
  const reviewSearchMatchesByPath = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const matches = new Map<string, number>()
    if (!normalizedQuery) return matches
    sourceFiles.forEach((file) => {
      const content = reviewFileContentByPath[file.path]
      const matchCount = countReviewSearchMatches(file.path, content, normalizedQuery)
      if (matchCount > 0) matches.set(file.path, matchCount)
    })
    return matches
  }, [query, reviewFileContentByPath, sourceFiles])
  const reviewSearchTotalMatchCount = useMemo(() => {
    let total = 0
    reviewSearchMatchesByPath.forEach((count) => {
      total += count
    })
    return total
  }, [reviewSearchMatchesByPath])
  const reviewSearchNavigationMatches = useMemo(() => {
    const matches: ReviewSearchNavigationMatch[] = []
    if (reviewSearchTotalMatchCount === 0) return matches
    const normalizedQuery = normalizedReviewSearchQuery(query)
    for (const file of sourceFiles) {
      const content = reviewFileContentByPath[file.path]
      pushReviewSearchNavigationMatches(matches, file.path, file.path, 'path', normalizedQuery, null)
      pushReviewSearchNavigationMatches(matches, file.path, content?.diff ?? '', 'diff', normalizedQuery, 0)
      pushReviewSearchNavigationMatches(matches, file.path, content?.preview?.text ?? '', 'preview', normalizedQuery, null)
      if (matches.length >= REVIEW_SEARCH_MATCH_CAP) break
    }
    return matches.slice(0, REVIEW_SEARCH_MATCH_CAP)
  }, [query, reviewFileContentByPath, reviewSearchTotalMatchCount, sourceFiles])
  const reviewSearchVisibleMatchCount = reviewSearchNavigationMatches.length
  const reviewSearchCapped = reviewSearchTotalMatchCount > REVIEW_SEARCH_MATCH_CAP
  const reviewSearchActiveMatch = reviewSearchActiveMatchIndex === null
    ? null
    : reviewSearchNavigationMatches[reviewSearchActiveMatchIndex] ?? null
  const reviewSearchActivePath = reviewSearchActiveMatch?.path ?? null
  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return normalizedQuery
      ? sourceFiles.filter((file) => file.path.toLowerCase().includes(normalizedQuery) || (reviewSearchMatchesByPath.get(file.path) ?? 0) > 0)
      : sourceFiles
  }, [reviewSearchMatchesByPath, sourceFiles, query])
  const sourceFilePathsKey = useMemo(() => sourceFiles.map((file) => file.path).join('\0'), [sourceFiles])
  const fileJumpMatches = useMemo(() => {
    const normalizedQuery = fileJumpQuery.trim().toLowerCase()
    return normalizedQuery
      ? sourceFiles.filter((file) => file.path.toLowerCase().includes(normalizedQuery)).slice(0, 30)
      : sourceFiles.slice(0, 30)
  }, [fileJumpQuery, sourceFiles])
  const reviewSourceCounts = useMemo<Record<'all' | 'unstaged' | 'staged', number>>(() => ({
    all: localReviewFiles.length,
    unstaged: localReviewFiles.filter((file) => file.unstaged === true).length,
    staged: localReviewFiles.filter((file) => file.staged === true).length
  }), [localReviewFiles])
  const branchRefMatches = useMemo(() => filterGitRefOptions(branchRefOptions, branchRefQuery), [branchRefOptions, branchRefQuery])
  const commitRefMatches = useMemo(() => filterGitRefOptions(commitRefOptions, commitRefQuery), [commitRefOptions, commitRefQuery])
  const fileTreeRows = useMemo(() => buildFileChangeTreeRows(filteredFiles), [filteredFiles])
  const reviewCommentCountByPath = useMemo(() => {
    const counts = new Map<string, number>()
    Object.entries(reviewCommentsByPath).forEach(([path, comments]) => {
      const count = comments.filter((comment) => comment.status === 'draft' || comment.status === 'saved' || comment.status === 'provider').length
      if (count > 0) counts.set(path, count)
    })
    return counts
  }, [reviewCommentsByPath])
  const selectedChange = selectedFile ? sourceFiles.find((file) => file.path === selectedFile) ?? null : null
  const reviewRowMenuChange = reviewRowMenu ? sourceFiles.find((file) => file.path === reviewRowMenu.path) ?? null : null
  const selectedFileIndex = selectedFile ? filteredFiles.findIndex((file) => file.path === selectedFile) : -1
  const canSelectPreviousFile = selectedFileIndex > 0
  const canSelectNextFile = selectedFileIndex >= 0 && selectedFileIndex < filteredFiles.length - 1
  const visibleReviewChanges = selectedChange ? [selectedChange] : []
  const selectedReviewContent = selectedFile ? reviewFileContentByPath[selectedFile] : undefined
  const fileDiff = selectedReviewContent?.diff ?? ''
  const filePreview = selectedReviewContent?.preview ?? null
  const reviewPatchText = useMemo(() => sourceFiles
    .map((file) => reviewFileContentByPath[file.path]?.diff ?? '')
    .filter((diff) => diff.trim().length > 0)
    .join('\n'), [reviewFileContentByPath, sourceFiles])
  const reviewPatchFileCount = useMemo(() => sourceFiles
    .filter((file) => (reviewFileContentByPath[file.path]?.diff ?? '').trim().length > 0)
    .length, [reviewFileContentByPath, sourceFiles])
  const showReviewGitHandoff = isLocalMutableReviewSource(reviewSource) && sourceFiles.length > 0
  const reviewRows: WorkbenchTreeRow[] = fileTreeRows.map((row) => {
    if (row.type === 'directory') {
      return {
        id: row.id,
        name: row.name,
        kind: 'directory',
        depth: row.depth,
        icon: 'folder',
        title: `${row.path} • ${reviewDirectoryMetadataLabel(row.fileCount, row.additions, row.deletions)}`,
        meta: (
          <span className="diff-directory-meta">
            <span>{row.fileCount} {row.fileCount === 1 ? 'file' : 'files'}</span>
            {(row.additions > 0 || row.deletions > 0) && (
              <span className="diff-directory-stats" aria-hidden="true">
                {row.additions > 0 && <span className="diff-directory-stat-additions">+{row.additions}</span>}
                {row.deletions > 0 && <span className="diff-directory-stat-deletions">-{row.deletions}</span>}
              </span>
            )}
          </span>
        ),
        dataReviewGroupPath: row.path,
        dataReviewFileCount: row.fileCount,
        dataReviewAdditions: row.additions,
        dataReviewDeletions: row.deletions,
        className: 'diff-directory-row'
      }
    }
    const file = row.file
    const commentCount = reviewCommentCountByPath.get(file.path) ?? 0
    const searchMatchCount = reviewSearchMatchesByPath.get(file.path) ?? 0
    return {
      id: row.id,
      name: row.name,
      kind: 'file',
      depth: row.depth,
      active: selectedFile === file.path,
      title: file.path,
      status: file.status,
      statusLabel: fileStatusLabel(file.status),
      statusColor: statusColor[file.status],
      decorations: commentCount > 0 || searchMatchCount > 0 ? (
        <span className="review-file-decorations">
          {searchMatchCount > 0 && (
            <span
              className="review-file-search-match-count"
              data-review-file-search-match-count={searchMatchCount}
              aria-label={`${searchMatchCount} review search ${searchMatchCount === 1 ? 'match' : 'matches'}`}
            >
              {searchMatchCount}
            </span>
          )}
          {commentCount > 0 && (
            <span
              className="review-file-comment-count"
              data-review-file-comment-count={commentCount}
              aria-label={`${commentCount} review ${commentCount === 1 ? 'comment' : 'comments'}`}
            >
              {commentCount}
            </span>
          )}
        </span>
      ) : undefined,
      className: 'diff-file-row',
      dataReviewPath: file.path,
      dataReviewSearchActive: reviewSearchActivePath === file.path,
      onSelect: () => setSelectedFile(file.path),
      onOpen: file.status === 'D' ? undefined : () => openRightPanelFileTab(sessionId, file.path, { preview: true }),
      onContextMenu: (event) => openReviewRowContextMenu(event, file)
    }
  })

  useEffect(() => {
    setReviewSearchActiveMatchIndex(null)
  }, [query, reviewSource, sourceFilePathsKey])

  const stepReviewSearchMatch = useCallback((direction: 1 | -1): void => {
    if (reviewSearchNavigationMatches.length === 0) return
    const current = reviewSearchActiveMatchIndex ?? 0
    const next = (current + direction + reviewSearchNavigationMatches.length) % reviewSearchNavigationMatches.length
    const match = reviewSearchNavigationMatches[next]
    setReviewSearchActiveMatchIndex(next)
    if (match) setSelectedFile(match.path)
  }, [reviewSearchActiveMatchIndex, reviewSearchNavigationMatches])

  useEffect(() => {
    if (storeReviewMetadata) {
      setLoadedReviewMetadata(storeReviewMetadata)
      return
    }
    let cancelled = false
    window.api.sessions.getReviewMetadata(sessionId)
      .then((metadata) => {
        if (!cancelled) setLoadedReviewMetadata(metadata)
      })
      .catch(() => {
        if (!cancelled) setLoadedReviewMetadata(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, storeReviewMetadata])

  useEffect(() => {
    const focusReviewSearch = (): void => {
      setReviewSidePaneVisible(true)
      setFileJumpOpen(false)
      setReviewOptionsOpen(false)
      setReviewMetadataOpen(null)
      window.requestAnimationFrame(() => {
        reviewSearchInputRef.current?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('orchestrator:focus-review-file-search', focusReviewSearch)
    return () => window.removeEventListener('orchestrator:focus-review-file-search', focusReviewSearch)
  }, [])

  useEffect(() => {
    const onThreadFindQuery = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string; domain?: string; query?: string }>).detail
      if (detail?.sessionId !== sessionId || detail.domain !== 'diff') return
      setReviewSidePaneVisible(true)
      setFileJumpOpen(false)
      setReviewOptionsOpen(false)
      setReviewMetadataOpen(null)
      setQuery(detail.query ?? '')
    }
    const onThreadFindStep = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string; domain?: string; direction?: number }>).detail
      if (detail?.sessionId !== sessionId || detail.domain !== 'diff') return
      stepReviewSearchMatch(detail.direction === -1 ? -1 : 1)
    }
    const onThreadFindClose = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (detail?.sessionId !== sessionId) return
      setReviewSearchActiveMatchIndex(null)
    }
    window.addEventListener('orchestrator:thread-find-query', onThreadFindQuery)
    window.addEventListener('orchestrator:thread-find-step', onThreadFindStep)
    window.addEventListener('orchestrator:thread-find-close', onThreadFindClose)
    return () => {
      window.removeEventListener('orchestrator:thread-find-query', onThreadFindQuery)
      window.removeEventListener('orchestrator:thread-find-step', onThreadFindStep)
      window.removeEventListener('orchestrator:thread-find-close', onThreadFindClose)
    }
  }, [sessionId, stepReviewSearchMatch])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('orchestrator:thread-find-status', {
      detail: {
        sessionId,
        domain: 'diff',
        totalMatches: reviewSearchVisibleMatchCount,
        activeMatch: reviewSearchActiveMatch?.ordinal ?? (reviewSearchVisibleMatchCount > 0 ? 1 : 0),
        isCapped: reviewSearchCapped,
        activePath: reviewSearchActivePath
      }
    }))
  }, [reviewSearchActiveMatch?.ordinal, reviewSearchActivePath, reviewSearchCapped, reviewSearchVisibleMatchCount, sessionId])

  useEffect(() => {
    if (!reviewSourceSupported) {
      setFiles([])
      setSelectedFile(null)
      setReviewCommentsByPath({})
      return
    }
    if (reviewSourceNeedsRef && !activeReviewRef) {
      setFiles([])
      setSelectedFile(null)
      setReviewCommentsByPath({})
      return
    }
    if (reviewSource === 'last-turn') {
      setFiles(lastTurnReviewFiles)
      setSelectedFile((current) => current && lastTurnReviewFiles.some((file) => file.path === current) ? current : lastTurnReviewFiles[0]?.path ?? null)
      return
    }
    window.api.sessions.getChangedFiles(sessionId, reviewApiSource, activeReviewRef || undefined).then((f) => {
      setFiles(f)
      setSelectedFile((current) => current && f.some((file) => file.path === current) ? current : f[0]?.path ?? null)
    })
  }, [activeReviewRef, lastTurnReviewFiles, reviewApiSource, reviewSource, reviewSourceNeedsRef, reviewSourceSupported, sessionId])

  useEffect(() => {
    window.api.sessions.getChangedFiles(sessionId, 'all').then(setLocalReviewFiles).catch(() => {
      setLocalReviewFiles([])
    })
  }, [sessionId])

  useEffect(() => {
    setReviewCommentsByPath((current) => {
      const sourcePaths = new Set(sourceFiles.map((file) => file.path))
      const next: Record<string, ReviewDiffComment[]> = {}
      Object.entries(current).forEach(([path, comments]) => {
        if (sourcePaths.has(path)) next[path] = comments
      })
      return next
    })
  }, [sourceFilePathsKey, sourceFiles])

  useEffect(() => {
    const providerCommentsByPath = reviewMetadata?.providerCommentsByPath ?? {}
    setReviewCommentsByPath((current) => mergeProviderReviewComments(current, providerCommentsByPath, sourceFiles.map((file) => file.path)))
  }, [reviewMetadata?.providerCommentsByPath, sourceFilePathsKey, sourceFiles])

  useEffect(() => {
    setReviewSourceState(readStoredReviewSource(workDir))
    setBranchReviewRef(readStoredReviewSourceRef(workDir, 'branch'))
    setCommitReviewRef(readStoredReviewSourceRef(workDir, 'commit'))
    setReviewSidePaneWidth(readStoredReviewSidePaneWidth(workDir))
    setReviewSidePaneVisible(readStoredReviewSidePaneVisible(workDir))
  }, [workDir])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.git.listBranches(workDir),
      window.api.git.listRecentCommits(workDir)
    ]).then(([branches, commits]) => {
      if (cancelled) return
      setBranchRefOptions(branches)
      setCommitRefOptions(commits)
    }).catch(() => {
      if (cancelled) return
      setBranchRefOptions([])
      setCommitRefOptions([])
    })
    return () => {
      cancelled = true
    }
  }, [workDir])

  useEffect(() => {
    if (!reviewSourceSupported) {
      setReviewFileContentByPath({})
      return
    }
    if (reviewSourceNeedsRef && !activeReviewRef) {
      setReviewFileContentByPath({})
      return
    }
    if (sourceFiles.length === 0) {
      setReviewFileContentByPath({})
      return
    }
    if (reviewSource === 'last-turn') {
      let cancelled = false
      setReviewFileContentByPath((current) => {
        const next: Record<string, ReviewFileContent> = {}
        sourceFiles.forEach((file) => {
          next[file.path] = current[file.path] ?? { diff: '', preview: null, loading: true }
        })
        return next
      })
      void Promise.all(sourceFiles.map(async (file): Promise<[string, ReviewFileContent]> => {
        try {
          const diff = diffForPathFromUnifiedDiff(lastTurnDiff, file.path)
          const preview = file.status === 'D'
            ? { kind: 'missing', truncated: false } satisfies FilePreviewResult
            : await window.api.fs.previewFile(joinPath(workDir, file.path))
          return [file.path, { diff, preview, loading: false }]
        } catch {
          return [file.path, { diff: diffForPathFromUnifiedDiff(lastTurnDiff, file.path), preview: { kind: 'unreadable', truncated: false }, loading: false }]
        }
      })).then((entries) => {
        if (cancelled) return
        setReviewFileContentByPath(Object.fromEntries(entries))
      })
      return () => {
        cancelled = true
      }
    }
    let cancelled = false
    setReviewFileContentByPath((current) => {
      const next: Record<string, ReviewFileContent> = {}
      sourceFiles.forEach((file) => {
        next[file.path] = current[file.path] ?? { diff: '', preview: null, loading: true }
      })
      return next
    })
    void Promise.all(sourceFiles.map(async (file): Promise<[string, ReviewFileContent]> => {
      try {
        const [diff, preview] = await Promise.all([
          window.api.sessions.getDiffForFile(sessionId, file.path, reviewApiSource, activeReviewRef || undefined),
          file.status === 'D'
            ? Promise.resolve<FilePreviewResult>({ kind: 'missing', truncated: false })
            : window.api.fs.previewFile(joinPath(workDir, file.path))
        ])
        return [file.path, { diff, preview, loading: false }]
      } catch {
        return [file.path, { diff: '', preview: { kind: 'unreadable', truncated: false }, loading: false }]
      }
    })).then((entries) => {
      if (cancelled) return
      setReviewFileContentByPath(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [activeReviewRef, lastTurnDiff, reviewApiSource, reviewSource, reviewSourceNeedsRef, reviewSourceSupported, sessionId, sourceFilePathsKey, sourceFiles, workDir])

  useEffect(() => {
    setShowPreview(false)
    setSourceMode(false)
    setFullSourceText(null)
    setSourceLoading(false)
  }, [selectedFile, reviewSource])

  useEffect(() => {
    if (!selectedFile || sourceFiles.some((file) => file.path === selectedFile)) return
    setSelectedFile(sourceFiles[0]?.path ?? null)
  }, [selectedFile, sourceFiles])

  useEffect(() => {
    if (!selectedFile) return
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-review-path="${escapeCssAttribute(selectedFile)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedFile])

  useEffect(() => {
    if (!selectedFile) return
    const section = rootRef.current?.querySelector<HTMLElement>(`.diff-panel-preview-pane [data-review-path="${escapeCssAttribute(selectedFile)}"]`)
    section?.scrollIntoView({ block: 'start' })
  }, [reviewFileContentByPath, selectedFile])

  const selectAdjacentFile = (direction: 'next' | 'previous'): void => {
    const nextPath = adjacentFileChangePath(filteredFiles, selectedFile, direction)
    if (nextPath) setSelectedFile(nextPath)
  }

  const selectBoundaryFile = (boundary: 'first' | 'last'): void => {
    if (filteredFiles.length === 0) return
    setSelectedFile(boundary === 'first' ? filteredFiles[0].path : filteredFiles[filteredFiles.length - 1].path)
  }

  const handleFileListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      selectAdjacentFile('next')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      selectAdjacentFile('previous')
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectBoundaryFile('first')
    } else if (event.key === 'End') {
      event.preventDefault()
      selectBoundaryFile('last')
    }
  }

  const clampReviewSidePaneWidth = (width: number): number => {
    return Math.min(Math.max(Math.round(width), REVIEW_SIDE_PANE_MIN_WIDTH), resolveReviewSidePaneMaxWidth())
  }

  const resolveReviewSidePaneMaxWidth = (): number => {
    const bodyWidth = rootRef.current?.querySelector<HTMLElement>('.diff-panel-body')?.getBoundingClientRect().width ?? 0
    return Math.max(REVIEW_SIDE_PANE_MIN_WIDTH, Math.floor(bodyWidth * REVIEW_SIDE_PANE_MAX_RATIO))
  }

  const setStoredReviewSidePaneWidth = (width: number): void => {
    const clampedWidth = clampReviewSidePaneWidth(width)
    setReviewSidePaneWidth(clampedWidth)
    setReviewSidePaneVisible(true)
    writeStoredReviewSidePaneWidth(workDir, clampedWidth)
    writeStoredReviewSidePaneVisible(workDir, true)
  }

  const setStoredReviewSidePaneVisible = (visible: boolean): void => {
    setReviewSidePaneVisible(visible)
    writeStoredReviewSidePaneVisible(workDir, visible)
  }

  const resetReviewSidePaneWidth = (): void => {
    setStoredReviewSidePaneWidth(REVIEW_SIDE_PANE_DEFAULT_WIDTH)
  }

  const toggleReviewSidePane = (): void => {
    setStoredReviewSidePaneVisible(!reviewSidePaneVisible)
  }

  const reviewSidePaneResizeController = useAppShellResizeController({
    edge: 'left',
    size: reviewSidePaneWidth,
    defaultSize: REVIEW_SIDE_PANE_DEFAULT_WIDTH,
    minSize: REVIEW_SIDE_PANE_MIN_WIDTH,
    maxSize: resolveReviewSidePaneMaxWidth,
    onSizeChange: (nextSize) => setStoredReviewSidePaneWidth(nextSize),
    onBelowMin: () => setStoredReviewSidePaneVisible(false),
    onReset: resetReviewSidePaneWidth
  })

  const refresh = (): void => {
    if (!reviewSourceSupported) {
      setFiles([])
      setSelectedFile(null)
      return
    }
    if (reviewSourceNeedsRef && !activeReviewRef) {
      setFiles([])
      setSelectedFile(null)
      return
    }
    if (reviewSource === 'last-turn') {
      setFiles(lastTurnReviewFiles)
      if (lastTurnReviewFiles.length > 0 && !lastTurnReviewFiles.find((x) => x.path === selectedFile)) setSelectedFile(lastTurnReviewFiles[0].path)
      return
    }
    window.api.sessions.getChangedFiles(sessionId, reviewApiSource, activeReviewRef || undefined).then((f) => {
      setFiles(f)
      if (f.length > 0 && !f.find((x) => x.path === selectedFile)) setSelectedFile(f[0].path)
    })
    window.api.sessions.getChangedFiles(sessionId, 'all').then(setLocalReviewFiles).catch(() => {
      setLocalReviewFiles([])
    })
  }

  const setReviewSource = (source: ReviewDiffSource): void => {
    if (!isSupportedReviewDiffSource(source, reviewSourceSupport)) return
    setReviewSourceState(source)
    setBranchRefPickerOpen(false)
    setCommitRefPickerOpen(false)
    writeStoredReviewSource(workDir, source)
  }

  useEffect(() => {
    const handleReviewOpenRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{
        sessionId?: string
        source?: ReviewDiffSource
        sidePaneVisible?: boolean
      }>).detail
      if (detail?.sessionId && detail.sessionId !== sessionId) return
      if (detail?.source && isSupportedReviewDiffSource(detail.source, reviewSourceSupport)) {
        setReviewSource(detail.source)
      }
      if (typeof detail?.sidePaneVisible === 'boolean') {
        setStoredReviewSidePaneVisible(detail.sidePaneVisible)
      }
    }
    window.addEventListener('orchestrator:review-open-request', handleReviewOpenRequest)
    return () => window.removeEventListener('orchestrator:review-open-request', handleReviewOpenRequest)
  }, [reviewSourceSupport, sessionId, workDir])

  const setReviewSourceRef = (source: 'branch' | 'commit', value: string): void => {
    if (source === 'branch') setBranchReviewRef(value)
    if (source === 'commit') setCommitReviewRef(value)
    writeStoredReviewSourceRef(workDir, source, value)
  }

  const openSelectedFile = (): void => {
    if (!selectedFile || !selectedChange || selectedChange.status === 'D') return
    void window.api.fs.openPath(joinPath(workDir, selectedFile))
  }

  const openSelectedFileTab = (): void => {
    if (!selectedFile || !selectedChange || selectedChange.status === 'D') return
    openReviewFileTab(selectedFile)
  }

  const openReviewFileTab = (path: string): void => {
    const change = sourceFiles.find((file) => file.path === path)
    if (!change || change.status === 'D') return
    openRightPanelFileTab(sessionId, path, { preview: true })
  }

  const openFileTabAtLine = (path: string, line: number): void => {
    const change = sourceFiles.find((file) => file.path === path)
    if (!change || change.status === 'D') return
    openRightPanelFileTab(sessionId, path, { preview: true, line })
  }

  const setReviewCommentsForPath = (path: string, updater: ReviewDiffCommentUpdater): void => {
    setReviewCommentsByPath((current) => {
      const currentComments = current[path] ?? []
      const nextComments = typeof updater === 'function' ? updater(currentComments) : updater
      if (nextComments.length === 0) {
        const { [path]: _removed, ...rest } = current
        return rest
      }
      return { ...current, [path]: nextComments }
    })
  }

  const revealSelectedFile = (): void => {
    if (!selectedFile || !selectedChange || selectedChange.status === 'D') return
    revealReviewFile(selectedFile)
  }

  const revealReviewFile = (path: string): void => {
    const change = sourceFiles.find((file) => file.path === path)
    if (!change || change.status === 'D') return
    void window.api.fs.showInFolder(joinPath(workDir, path))
  }

  const writeReviewClipboardText = async (text: string): Promise<void> => {
    if (typeof window.api.clipboard?.writeText === 'function') {
      const didWrite = await window.api.clipboard.writeText(text)
      if (!didWrite) throw new Error('Clipboard write failed')
      return
    }
    await navigator.clipboard.writeText(text)
  }

  const copySelectedPath = async (): Promise<void> => {
    if (!selectedFile || !selectedChange) return
    await copyReviewPath(selectedFile)
  }

  const copyReviewPath = async (path: string): Promise<void> => {
    setReviewGitActionMessage({ text: 'Copying path', tone: 'info' })
    try {
      await writeReviewClipboardText(path)
      setReviewGitActionMessage({ text: 'Path copied', tone: 'info' })
    } catch {
      setReviewGitActionMessage({ text: 'Copy path failed', tone: 'danger' })
    }
  }

  const openReviewRowContextMenu = (event: WorkbenchTreeContextMenuEvent, file: FileChange): void => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Number.isFinite(event.clientX) && event.clientX !== 0
      ? event.clientX
      : rect.left + Math.min(24, Math.max(1, rect.width / 2))
    const y = Number.isFinite(event.clientY) && event.clientY !== 0
      ? event.clientY
      : rect.top + Math.min(14, Math.max(4, rect.height / 2))
    setSelectedFile(file.path)
    setReviewOptionsOpen(false)
    setFileJumpOpen(false)
    setReviewMetadataOpen(null)
    setReviewRowMenu({
      path: file.path,
      x: Math.min(x, Math.max(8, window.innerWidth - 214)),
      y: Math.min(y, Math.max(8, window.innerHeight - 176))
    })
  }

  const copyGitApplyCommand = async (): Promise<void> => {
    if (!reviewPatchText.trim()) return
    const patch = reviewPatchText.endsWith('\n') ? reviewPatchText : `${reviewPatchText}\n`
    const command = `git apply <<'PATCH'\n${patch}PATCH`
    const globals = window as typeof window & { __orchestratorLastReviewGitApplyCommandForSmoke?: string }
    globals.__orchestratorLastReviewGitApplyCommandForSmoke = command
    setReviewGitActionMessage({ text: 'Copying git apply command', tone: 'info' })
    try {
      await writeReviewClipboardText(command)
      setReviewGitActionMessage({ text: 'Git apply command copied', tone: 'info' })
    } catch {
      setReviewGitActionMessage({ text: 'Copy git apply command failed', tone: 'danger' })
    }
  }

  const refreshReviewFileAfterMutation = async (path: string): Promise<void> => {
    if (!reviewSourceSupported || reviewSource === 'last-turn') return
    const absolutePath = joinPath(workDir, path)
    const [refreshedFiles, refreshedLocalFiles, diff, preview] = await Promise.all([
      window.api.sessions.getChangedFiles(sessionId, reviewApiSource, activeReviewRef || undefined),
      window.api.sessions.getChangedFiles(sessionId, 'all'),
      window.api.sessions.getDiffForFile(sessionId, path, reviewApiSource, activeReviewRef || undefined),
      window.api.fs.previewFile(absolutePath).catch(() => ({ kind: 'unreadable', truncated: false }) satisfies FilePreviewResult)
    ])
    setFiles(refreshedFiles)
    setLocalReviewFiles(refreshedLocalFiles)
    setReviewFileContentByPath((current) => ({
      ...current,
      [path]: { diff, preview, loading: false }
    }))
    setSelectedFile((current) => (
      current && refreshedFiles.some((file) => file.path === current)
        ? current
        : refreshedFiles.find((file) => file.path === path)?.path ?? refreshedFiles[0]?.path ?? null
    ))
  }

  const canTogglePreview = Boolean(selectedChange && filePreview && (shouldPreferTextDiff(fileDiff) || isBinaryDiffText(fileDiff)) && hasReviewPreview(filePreview))
  const canLoadFullSource = Boolean(selectedChange && selectedChange.status !== 'D' && filePreview !== null && canReadFullSource(filePreview))
  const toggleDiffMode = (): void => {
    setDiffMode((mode) => mode === 'unified' ? 'split' : 'unified')
  }

  const toggleDiffExpanded = (): void => {
    setDiffExpanded((expanded) => !expanded)
  }

  const toggleHideWhitespace = (): void => {
    setHideWhitespace((hidden) => !hidden)
  }

  const toggleWordDiff = (): void => {
    setShowWordDiff((visible) => !visible)
  }

  const refreshLabel = 'Refresh'
  const richPreviewLabel = showPreview ? 'Disable rich preview' : 'Enable rich preview'
  const loadFullFilesLabel = sourceMode ? "Don't load full files" : 'Load full files'
  const whitespaceLabel = hideWhitespace ? 'Show white space' : 'Hide white space'
  const wordDiffsLabel = showWordDiff ? 'Disable word diffs' : 'Enable word diffs'

  const loadFullSource = async (): Promise<void> => {
    if (!selectedFile || !selectedChange || !canLoadFullSource) return
    if (sourceMode) {
      setSourceMode(false)
      return
    }
    setShowPreview(false)
    setSourceMode(true)
    if (fullSourceText !== null) return
    setSourceLoading(true)
    try {
      setFullSourceText(await window.api.fs.readFile(joinPath(workDir, selectedFile)))
    } finally {
      setSourceLoading(false)
    }
  }

  const jumpToFile = (path: string): void => {
    setQuery('')
    setSelectedFile(path)
    setFileJumpOpen(false)
    setFileJumpQuery('')
  }

  const navigateReviewFile = (direction: 'next' | 'previous'): void => {
    selectAdjacentFile(direction)
    setFileJumpOpen(false)
    setReviewOptionsOpen(false)
    setReviewMetadataOpen(null)
  }

  const activeReviewSource = REVIEW_DIFF_SOURCES.find((source) => source.id === reviewSource) ?? REVIEW_DIFF_SOURCES[0]
  const reviewWorkspaceName = basename(workDir) || workDir
  const activeReviewSourceCount = reviewSourceCountFor(
    reviewSource,
    reviewSourceCounts,
    reviewSource,
    sourceFiles.length,
    lastTurnReviewFiles.length
  )
  const activeReviewSourceLabel = reviewSourceSummaryLabel(reviewSource, activeReviewSource.label, branchReviewRef, commitReviewRef)
  const canStartCodexReview = reviewSession?.provider === 'codex' && (reviewSession.runtime ?? 'app-server') === 'app-server'
  const codexReviewStartRequest = resolveCodexReviewStartRequest(reviewSource, activeReviewRef)
  const codexReviewStartLabel = codexReviewStartRequest?.target.type === 'baseBranch'
    ? 'Start Codex base review'
    : codexReviewStartRequest?.target.type === 'commit'
      ? 'Start Codex commit review'
    : 'Start Codex review'
  const customReviewInstructionsTrimmed = customReviewInstructions.trim()
  const codexReviewStartDisabled = !canStartCodexReview || !codexReviewStartRequest || codexReviewStartPending || reviewSession?.status === 'running'
  const codexCustomReviewStartDisabled = !canStartCodexReview || customReviewInstructionsTrimmed.length === 0 || codexReviewStartPending || reviewSession?.status === 'running'
  const activeReviewSourceStats = sourceFiles.reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions
    }),
    { additions: 0, deletions: 0 }
  )
  const activeReviewSourceStatsLabel = [
    activeReviewSourceStats.additions > 0 ? `+${activeReviewSourceStats.additions}` : '',
    activeReviewSourceStats.deletions > 0 ? `-${activeReviewSourceStats.deletions}` : ''
  ].filter(Boolean).join(' ')

  const startCodexReviewRequest = async (request: CodexReviewStartRequest): Promise<void> => {
    if (!canStartCodexReview || codexReviewStartPending) return
    setCodexReviewStartPending(true)
    setReviewGitActionMessage({ text: 'Starting Codex review', tone: 'info' })
    try {
      const result = await window.api.sessions.startCodexReview(sessionId, request)
      if (result.ok) {
        setReviewGitActionMessage({
          text: codexReviewStartedMessage(request),
          tone: 'info'
        })
      } else {
        setReviewGitActionMessage({ text: result.error ?? 'Codex review failed to start', tone: 'danger' })
      }
    } catch (error) {
      setReviewGitActionMessage({
        text: error instanceof Error ? error.message : 'Codex review failed to start',
        tone: 'danger'
      })
    } finally {
      setCodexReviewStartPending(false)
    }
  }

  const startCodexReview = async (): Promise<void> => {
    if (!codexReviewStartRequest || codexReviewStartDisabled) return
    await startCodexReviewRequest(codexReviewStartRequest)
  }

  const startCustomCodexReview = async (): Promise<void> => {
    if (codexCustomReviewStartDisabled) return
    setReviewOptionsOpen(false)
    await startCodexReviewRequest({
      target: { type: 'custom', instructions: customReviewInstructionsTrimmed },
      delivery: 'inline'
    })
  }

  const fileJumpControl = (
    <div className="review-file-jump relative">
      <button
        type="button"
        className="review-file-jump-button"
        aria-label="Jump to file"
        aria-expanded={fileJumpOpen}
        aria-controls={REVIEW_FILE_JUMP_MENU_ID}
        aria-haspopup="menu"
        data-testid="review-file-jump"
        onClick={() => {
          setFileJumpOpen((open) => !open)
          setReviewOptionsOpen(false)
          setReviewMetadataOpen(null)
        }}
      >
        <Icon name="search" size={13} />
      </button>
      {fileJumpOpen && (
        <MenuSurface
          id={REVIEW_FILE_JUMP_MENU_ID}
          className="review-file-jump-menu"
          onClose={() => setFileJumpOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 300, zIndex: 92 }}
        >
          <div className="review-file-jump-search">
            <WorkbenchSearchField
              value={fileJumpQuery}
              onChange={setFileJumpQuery}
              placeholder="Jump to file"
              clearLabel="Clear jump query"
              dataTestId="review-file-jump-search"
              clearDataTestId="review-file-jump-search-clear"
              className="review-file-jump-search-field"
            />
          </div>
          <div className="review-file-jump-list">
            {fileJumpMatches.length === 0 ? (
              <MenuMessage dataTestId="review-file-jump-empty" state="no-matches">
                No matching files
              </MenuMessage>
            ) : (
              fileJumpMatches.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  role="menuitem"
                  className="review-file-jump-item"
                  data-active={selectedFile === file.path ? 'true' : 'false'}
                  data-testid="review-file-jump-item"
                  onClick={() => jumpToFile(file.path)}
                >
                  <span className="review-file-jump-name">{basename(file.path)}</span>
                  <span className="review-file-jump-path">{parentPath(file.path)}</span>
                </button>
              ))
            )}
          </div>
        </MenuSurface>
      )}
    </div>
  )

  const reviewOptions = (
    <div className="diff-panel-actions relative">
      <IconButton
        icon="ellipsis"
        label="Review options"
        size="sm"
        variant="toolbar"
        active={reviewOptionsOpen}
        dataTestId="review-options-menu"
        ariaExpanded={reviewOptionsOpen}
        ariaControls={REVIEW_OPTIONS_MENU_ID}
        ariaHasPopup="menu"
        onClick={() => {
          setReviewOptionsOpen((open) => !open)
          setFileJumpOpen(false)
          setReviewMetadataOpen(null)
        }}
      />
      {reviewOptionsOpen && (
        <MenuSurface
          id={REVIEW_OPTIONS_MENU_ID}
          className="review-options-menu-surface"
          onClose={() => setReviewOptionsOpen(false)}
          style={{ position: 'absolute', right: 0, top: 34, width: 244, zIndex: 92 }}
        >
          <div className="review-options-section" aria-label="Review source">
            <div className="review-options-section-title">Source</div>
            <div className="review-source-menu-grid" data-testid="review-source-mode" role="group" aria-label="Review source">
              {REVIEW_DIFF_SOURCES.map((source, index) => {
                const sourceSupported = isSupportedReviewDiffSource(source.id, reviewSourceSupport)
                const sourceCount = reviewSourceCountFor(source.id, reviewSourceCounts, reviewSource, sourceFiles.length, lastTurnReviewFiles.length)
                const unavailableReason = sourceSupported ? '' : reviewSourceUnavailableReason(source.id, reviewSourceSupport)
                return (
                <div key={source.id} className="contents">
                  {index > 0 && REVIEW_DIFF_SOURCES[index - 1].group !== source.group && (
                    <div className="review-source-menu-divider" role="separator" />
                  )}
                  <button
                    type="button"
                    role="menuitemradio"
                    className="review-source-menu-item"
                    aria-label={sourceSupported ? source.ariaLabel : `${source.ariaLabel}. ${unavailableReason}`}
                    aria-checked={reviewSource === source.id}
                    aria-disabled={!sourceSupported}
                    disabled={!sourceSupported}
                    title={sourceSupported ? source.ariaLabel : unavailableReason}
                    data-testid={`review-source-${source.id}`}
                    data-active={reviewSource === source.id ? 'true' : 'false'}
                    data-review-source-unsupported={!sourceSupported ? 'true' : 'false'}
                    data-review-source-unavailable-reason={unavailableReason || undefined}
                    onClick={() => setReviewSource(source.id)}
                  >
                    <span className="review-source-menu-check" aria-hidden="true">
                      {reviewSource === source.id && <Icon name="check" size={12} />}
                    </span>
                    <span className="review-source-menu-label-group">
                      <span className="review-source-menu-label">{source.label}</span>
                      {!sourceSupported && <span className="review-source-menu-reason">{unavailableReason}</span>}
                    </span>
                    {sourceSupported && (
                      <span
                        className="review-source-menu-count"
                        data-review-source-count={sourceCount}
                        aria-label={`${sourceCount} ${sourceCount === 1 ? 'file' : 'files'}`}
                      >
                        {sourceCount}
                      </span>
                    )}
                    {!sourceSupported && <span className="review-source-menu-unavailable">Unavailable</span>}
                  </button>
                </div>
                )
              })}
            </div>
            {reviewSource === 'branch' && (
              <ReviewRefPicker
                label="Base ref"
                value={branchReviewRef}
                placeholder="review-base-branch"
                inputTestId="review-source-branch-ref"
                buttonTestId="review-source-branch-picker"
                queryTestId="review-source-branch-picker-search"
                itemTestId="review-source-branch-picker-item"
                query={branchRefQuery}
                open={branchRefPickerOpen}
                options={branchRefMatches}
                emptyLabel="No branches"
                onChange={(value) => setReviewSourceRef('branch', value)}
                onOpenChange={(open) => {
                  setBranchRefPickerOpen(open)
                  if (open) setCommitRefPickerOpen(false)
                }}
                onQueryChange={setBranchRefQuery}
              />
            )}
            {reviewSource === 'commit' && (
              <ReviewRefPicker
                label="Commit"
                value={commitReviewRef}
                placeholder="HEAD"
                inputTestId="review-source-commit-ref"
                buttonTestId="review-source-commit-picker"
                queryTestId="review-source-commit-picker-search"
                itemTestId="review-source-commit-picker-item"
                query={commitRefQuery}
                open={commitRefPickerOpen}
                options={commitRefMatches}
                emptyLabel="No commits"
                onChange={(value) => setReviewSourceRef('commit', value)}
                onOpenChange={(open) => {
                  setCommitRefPickerOpen(open)
                  if (open) setBranchRefPickerOpen(false)
                }}
                onQueryChange={setCommitRefQuery}
              />
            )}
          </div>
          {canStartCodexReview && (
            <>
              <div className="review-options-divider" />
              <div className="review-options-section" aria-label="Codex review">
                <div className="review-options-section-title">Codex</div>
                <textarea
                  className="review-codex-custom-input"
                  aria-label="Custom review instructions"
                  data-testid="review-start-codex-custom-instructions"
                  placeholder="Custom review instructions"
                  rows={3}
                  value={customReviewInstructions}
                  onChange={(event) => setCustomReviewInstructions(event.target.value)}
                />
                <button
                  type="button"
                  role="menuitem"
                  className="review-codex-custom-start"
                  disabled={codexCustomReviewStartDisabled}
                  data-testid="review-start-codex-custom"
                  data-codex-review-start-target="custom"
                  data-codex-review-start-custom-ready={customReviewInstructionsTrimmed.length > 0 ? 'true' : 'false'}
                  onClick={() => { void startCustomCodexReview() }}
                >
                  <Icon name="sparkles" size={13} />
                  <span>{codexReviewStartPending ? 'Starting Codex review' : 'Start custom review'}</span>
                </button>
              </div>
            </>
          )}
          <div className="review-options-divider" />
          <MenuItem
            icon="refresh"
            label={refreshLabel}
            onClick={() => { refresh(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="wrap"
            label={wrapLines ? 'Disable word wrap' : 'Enable word wrap'}
            onClick={() => { setWrapLines((value) => !value); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon={diffExpanded ? 'minimize' : 'expand'}
            label={diffExpanded ? 'Collapse all diffs' : 'Expand all diffs'}
            onClick={() => { toggleDiffExpanded(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="diff"
            label={diffMode === 'unified' ? 'Switch to split diff' : 'Switch to unified diff'}
            onClick={() => { toggleDiffMode(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="file"
            label={richPreviewLabel}
            disabled={!canTogglePreview}
            onClick={() => { setShowPreview((value) => !value); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="file"
            label={loadFullFilesLabel}
            disabled={!canLoadFullSource}
            onClick={() => { void loadFullSource(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="eraser"
            label={whitespaceLabel}
            onClick={() => { toggleHideWhitespace(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="diff"
            label={wordDiffsLabel}
            onClick={() => { toggleWordDiff(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="copy"
            label="Copy git apply command"
            disabled={!reviewPatchText.trim()}
            dataTestId="review-copy-git-apply-command"
            onClick={() => { void copyGitApplyCommand(); setReviewOptionsOpen(false) }}
          />
          <div className="review-options-divider" />
          <MenuItem
            icon="file"
            label="Open file"
            disabled={!selectedChange || selectedChange.status === 'D'}
            onClick={() => { openSelectedFileTab(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="folder"
            label="Reveal file"
            disabled={!selectedChange || selectedChange.status === 'D'}
            onClick={() => { revealSelectedFile(); setReviewOptionsOpen(false) }}
          />
          <MenuItem
            icon="copy"
            label="Copy path"
            disabled={!selectedChange}
            onClick={() => { void copySelectedPath(); setReviewOptionsOpen(false) }}
          />
        </MenuSurface>
      )}
    </div>
  )

  const reviewSourceSummary = (
    <button
      type="button"
      className="review-source-summary-button"
      aria-label={`Review source: ${activeReviewSourceLabel}, ${activeReviewSourceCount} ${activeReviewSourceCount === 1 ? 'file' : 'files'} in ${reviewWorkspaceName}${activeReviewSourceStatsLabel ? `, ${activeReviewSourceStatsLabel}` : ''}`}
      data-testid="review-source-summary"
      data-review-source-active={reviewSource}
      data-review-source-workspace-name={reviewWorkspaceName}
      data-review-source-workspace-root={workDir}
      data-review-source-summary-count={activeReviewSourceCount}
      data-review-source-summary-additions={activeReviewSourceStats.additions}
      data-review-source-summary-deletions={activeReviewSourceStats.deletions}
      onClick={() => {
        setReviewOptionsOpen((open) => !open)
        setFileJumpOpen(false)
        setReviewMetadataOpen(null)
      }}
    >
      <Icon name="branch" size={14} />
      <span className="review-source-summary-label">{activeReviewSourceLabel}</span>
      <span className="review-source-summary-root" title={workDir}>{reviewWorkspaceName}</span>
      {(activeReviewSourceStats.additions > 0 || activeReviewSourceStats.deletions > 0) && (
        <span className="review-source-summary-stats" aria-hidden="true">
          {activeReviewSourceStats.additions > 0 && (
            <span className="review-source-summary-stat-additions">+{activeReviewSourceStats.additions}</span>
          )}
          {activeReviewSourceStats.deletions > 0 && (
            <span className="review-source-summary-stat-deletions">-{activeReviewSourceStats.deletions}</span>
          )}
        </span>
      )}
    </button>
  )
  const reviewHeaderToolbar = (
    <PanelToolbar className="diff-panel-toolbar" dataTestId="diff-panel-toolbar" ariaLabel="Review toolbar">
      {reviewSourceSummary}
      <div className="diff-panel-action-strip" data-testid="review-toolbar-action-strip" data-review-toolbar-cluster="primary">
        {canStartCodexReview && (
          <span
            className="review-start-codex-target"
            data-testid="review-start-codex-target"
            data-codex-review-start-target={codexReviewStartRequest?.target.type ?? ''}
            data-codex-review-start-branch={codexReviewStartRequest?.target.type === 'baseBranch' ? codexReviewStartRequest.target.branch : ''}
            data-codex-review-start-sha={codexReviewStartRequest?.target.type === 'commit' ? codexReviewStartRequest.target.sha : ''}
          >
            <IconButton
              icon="sparkles"
              label={codexReviewStartPending ? 'Starting Codex review' : codexReviewStartLabel}
              size="sm"
              variant="toolbar"
              disabled={codexReviewStartDisabled}
              dataTestId="review-start-codex"
              onClick={() => { void startCodexReview() }}
            />
          </span>
        )}
        {reviewOptions}
        {fileJumpControl}
        {!reviewSidePaneVisible && (
          <IconButton
            icon="panelRight"
            label="Show changed files"
            size="sm"
            variant="toolbar"
            dataTestId="review-changed-files-toggle"
            onClick={toggleReviewSidePane}
          />
        )}
        <IconButton
          icon="refresh"
          label={refreshLabel}
          size="sm"
          variant="toolbar"
          dataTestId="review-refresh"
          onClick={refresh}
        />
        <IconButton
          icon="arrowUp"
          label="Previous changed file"
          size="sm"
          variant="toolbar"
          disabled={!canSelectPreviousFile}
          dataTestId="review-previous-file"
          onClick={() => navigateReviewFile('previous')}
        />
        <IconButton
          icon="arrowDown"
          label="Next changed file"
          size="sm"
          variant="toolbar"
          disabled={!canSelectNextFile}
          dataTestId="review-next-file"
          onClick={() => navigateReviewFile('next')}
        />
        {reviewMetadata && (
          <ReviewMetadataStrip
            metadata={reviewMetadata}
            openPanel={reviewMetadataOpen}
            onOpenPanelChange={(panel) => {
              setReviewMetadataOpen(panel)
              setReviewOptionsOpen(false)
              setFileJumpOpen(false)
            }}
          />
        )}
        <IconButton
          icon="wrap"
          label={wrapLines ? 'Disable word wrap' : 'Enable word wrap'}
          size="sm"
          variant="toolbar"
          active={!wrapLines}
          dataTestId="review-wrap-toggle"
          onClick={() => setWrapLines((value) => !value)}
        />
        {canTogglePreview && (
          <IconButton
            icon={showPreview ? 'branch' : 'file'}
            label={richPreviewLabel}
            size="sm"
            variant="toolbar"
            className="review-secondary-toolbar-action"
            active={showPreview}
            onClick={() => setShowPreview((value) => !value)}
          />
        )}
        <IconButton
          icon="file"
          label={loadFullFilesLabel}
          size="sm"
          variant="toolbar"
          className="review-secondary-toolbar-action"
          active={sourceMode}
          disabled={!canLoadFullSource}
          dataTestId="review-load-full-file"
          onClick={() => { void loadFullSource() }}
        />
        <IconButton
          icon="eraser"
          label={whitespaceLabel}
          size="sm"
          variant="toolbar"
          className="review-secondary-toolbar-action"
          active={hideWhitespace}
          dataTestId="review-whitespace-toggle"
          onClick={toggleHideWhitespace}
        />
        <IconButton
          icon="diff"
          label={wordDiffsLabel}
          size="sm"
          variant="toolbar"
          className="review-secondary-toolbar-action"
          active={showWordDiff}
          dataTestId="review-word-diff-toggle"
          onClick={toggleWordDiff}
        />
        <IconButton
          icon={diffExpanded ? 'minimize' : 'expand'}
          label={diffExpanded ? 'Collapse all diffs' : 'Expand all diffs'}
          size="sm"
          variant="toolbar"
          active={!diffExpanded}
          dataTestId="review-diff-expand-toggle"
          onClick={toggleDiffExpanded}
        />
        <IconButton
          icon="diff"
          label={diffMode === 'unified' ? 'Switch to split diff' : 'Switch to unified diff'}
          size="sm"
          variant="toolbar"
          active={diffMode === 'split'}
          dataTestId="review-diff-mode-toggle"
          onClick={toggleDiffMode}
        />
      </div>
    </PanelToolbar>
  )
  const reviewActionStatus = reviewGitActionMessage ? (
    <span
      className="review-floating-action-status"
      data-testid="review-floating-action-status"
      role={reviewGitActionMessage.tone === 'danger' ? 'alert' : 'status'}
      aria-live={reviewGitActionMessage.tone === 'danger' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-review-floating-action-status-tone={reviewGitActionMessage.tone}
    >
      {reviewGitActionMessage.text}
    </span>
  ) : null
  const reviewFloatingGitActions = showReviewGitHandoff ? (
    <div
      className="review-floating-action-pill"
      data-testid="review-floating-action-pill"
      data-review-floating-action-pill="git-handoff"
      data-review-floating-action-anchor="panel-root"
      data-review-git-handoff-count={sourceFiles.length}
      data-review-git-action-message={reviewGitActionMessage?.text ?? ''}
      data-review-git-action-tone={reviewGitActionMessage?.tone ?? ''}
    >
      <Button
        variant="ghost"
        className="review-floating-action-button"
        dataTestId="review-open-git-tab"
        onClick={() => openRightPanelTab(sessionId, 'git')}
      >
        <Icon name="branch" size={12} />
        <span>Open Git</span>
      </Button>
      {reviewActionStatus}
    </div>
  ) : null
  const reviewFloatingActionStatus = !showReviewGitHandoff && reviewActionStatus ? (
    <div
      className="review-floating-action-pill review-floating-action-pill-status-only"
      data-testid="review-action-status-pill"
      data-review-floating-action-pill="status"
      data-review-floating-action-anchor="panel-root"
      data-review-git-action-message={reviewGitActionMessage?.text ?? ''}
      data-review-git-action-tone={reviewGitActionMessage?.tone ?? ''}
    >
      {reviewActionStatus}
    </div>
  ) : null
  return (
    <div
      className="diff-panel-root flex flex-col shrink-0 min-w-0 overflow-hidden"
      ref={rootRef}
      data-embedded={embedded ? 'true' : 'false'}
      data-review-diff-mode={diffMode}
      data-review-diff-expanded={diffExpanded ? 'true' : 'false'}
      data-review-source={reviewSource}
      data-review-selected-file={selectedFile ?? ''}
      data-review-tree-query={query.trim()}
      data-review-tree-file-count={filteredFiles.length}
      data-review-tree-search-match-count={[...reviewSearchMatchesByPath.values()].reduce((sum, count) => sum + count, 0)}
      data-review-tree-search-visible-match-count={reviewSearchVisibleMatchCount}
      data-review-tree-search-capped={reviewSearchCapped ? 'true' : 'false'}
      data-review-tree-search-active-match={reviewSearchActiveMatch ? reviewSearchActiveMatch.ordinal : ''}
      data-review-tree-search-active-path={reviewSearchActivePath ?? ''}
      data-review-main-file-count={sourceFiles.length}
      data-review-hide-whitespace={hideWhitespace ? 'true' : 'false'}
      data-review-word-diff={showWordDiff ? 'true' : 'false'}
      data-review-rich-preview={showPreview ? 'true' : 'false'}
      data-review-side-pane-visible={reviewSidePaneVisible ? 'true' : 'false'}
      data-review-git-apply-file-count={reviewPatchFileCount}
      style={{
        width: embedded ? '100%' : 440,
        maxWidth: '100%',
        height: embedded ? '100%' : undefined,
        borderLeft: embedded ? 'none' : '1px solid var(--border-subtle)',
        background: 'var(--surface-bg)'
      }}
    >
      {!embedded && (
        <PanelHeader
          title={`Review${files.length > 0 ? ` (${files.length})` : ''}`}
        />
      )}

      {reviewHeaderToolbar}

      {files.length === 0 ? (
        <div className="diff-panel-empty-shell">
          <ReviewEmptyState
            title="No changes"
            body="There are no local changes to review."
            testId="review-empty-state"
            icon="diff"
            centered
          />
        </div>
      ) : (
        <div className="diff-panel-body">
          <div
            className="diff-panel-changed-files-pane"
            data-review-side-pane-resizable="true"
            data-review-side-pane-visible={reviewSidePaneVisible ? 'true' : 'false'}
            data-review-side-pane-resizing={reviewSidePaneResizeController.isResizing ? 'true' : 'false'}
            data-review-side-pane-width={reviewSidePaneWidth}
            aria-hidden={reviewSidePaneVisible ? undefined : true}
            style={{
              width: reviewSidePaneVisible ? reviewSidePaneWidth : 0,
              flexBasis: reviewSidePaneVisible ? reviewSidePaneWidth : 0,
              opacity: reviewSidePaneVisible ? 1 : 0,
              pointerEvents: reviewSidePaneVisible ? undefined : 'none'
            }}
          >
            {reviewSidePaneVisible && (
              <>
              <PanelResizeHandle
                orientation="vertical"
                edge="left"
                className="diff-panel-changed-files-resize-handle"
                label="Resize changed files pane"
                active={reviewSidePaneResizeController.isResizing}
                onPointerDown={reviewSidePaneResizeController.onPointerDown}
                onDoubleClick={reviewSidePaneResizeController.onDoubleClick}
                onKeyDown={reviewSidePaneResizeController.onKeyDown}
                valueNow={reviewSidePaneResizeController.valueNow}
                valueMin={reviewSidePaneResizeController.valueMin}
                valueMax={reviewSidePaneResizeController.valueMax}
                dataTestId="review-changed-files-resize"
              />
              <div className="diff-panel-file-search-row">
                <WorkbenchSearchField
                  value={query}
                  onChange={setQuery}
                  placeholder="Filter files…"
                  clearLabel="Clear change filter"
                  inputRef={reviewSearchInputRef}
                  dataTestId="diff-file-search"
                  clearDataTestId="diff-file-search-clear"
                  className="diff-panel-search"
                />
                {query.trim() && reviewSearchVisibleMatchCount > 0 && (
                  <div
                    className="review-search-match-controls"
                    data-testid="review-search-match-controls"
                    data-review-search-total-matches={reviewSearchTotalMatchCount}
                    data-review-search-visible-matches={reviewSearchVisibleMatchCount}
                    data-review-search-capped={reviewSearchCapped ? 'true' : 'false'}
                    data-review-search-active-match={reviewSearchActiveMatch ? reviewSearchActiveMatch.ordinal : ''}
                    data-review-search-active-path={reviewSearchActivePath ?? ''}
                  >
                    <span className="review-search-match-count" data-testid="review-search-match-count">
                      {reviewSearchActiveMatch
                        ? `${reviewSearchActiveMatch.ordinal}/${reviewSearchVisibleMatchCount}${reviewSearchCapped ? '+' : ''}`
                        : `${reviewSearchVisibleMatchCount}${reviewSearchCapped ? '+' : ''}`}
                    </span>
                    <IconButton
                      icon="arrowUp"
                      label="Previous review search match"
                      size="xs"
                      variant="toolbar"
                      onClick={() => stepReviewSearchMatch(-1)}
                      dataTestId="review-search-previous-match"
                    />
                    <IconButton
                      icon="arrowDown"
                      label="Next review search match"
                      size="xs"
                      variant="toolbar"
                      onClick={() => stepReviewSearchMatch(1)}
                      dataTestId="review-search-next-match"
                    />
                  </div>
                )}
              </div>
              <WorkbenchTree
                rows={reviewRows}
                ariaLabel="Changed files"
                className="diff-panel-list"
                emptyState={<div className="px-3 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>No matches</div>}
                onKeyDown={handleFileListKeyDown}
                stickyDirectories
                revealActiveRow
              />
              {reviewRowMenu && (
                <MenuSurface
                  onClose={() => setReviewRowMenu(null)}
                  className="review-row-context-menu"
                  style={{ position: 'fixed', left: reviewRowMenu.x, top: reviewRowMenu.y, width: 206, zIndex: 110 }}
                >
                  <div
                    data-testid="review-row-context-menu"
                    data-review-row-context-path={reviewRowMenuChange?.path ?? ''}
                    data-review-row-context-status={reviewRowMenuChange?.status ?? ''}
                  >
                    <MenuItem
                      icon="file"
                      label="Open in Workbench"
                      disabled={!reviewRowMenuChange || reviewRowMenuChange.status === 'D'}
                      dataTestId="review-row-open-workbench"
                      onClick={() => {
                        openReviewFileTab(reviewRowMenu.path)
                        setReviewRowMenu(null)
                      }}
                    />
                    <MenuItem
                      icon="copy"
                      label="Copy path"
                      disabled={!reviewRowMenuChange}
                      dataTestId="review-row-copy-path"
                      onClick={() => {
                        void copyReviewPath(reviewRowMenu.path)
                        setReviewRowMenu(null)
                      }}
                    />
                    <MenuItem
                      icon="folder"
                      label="Reveal file"
                      disabled={!reviewRowMenuChange || reviewRowMenuChange.status === 'D'}
                      dataTestId="review-row-reveal-file"
                      onClick={() => {
                        revealReviewFile(reviewRowMenu.path)
                        setReviewRowMenu(null)
                      }}
                    />
                  </div>
                </MenuSurface>
              )}
              </>
            )}
          </div>

          <div className="diff-panel-preview-pane" data-testid="review-preview">
            <div
              className="review-files-stack"
              data-testid="review-files-stack"
              data-review-file-section-count={sourceFiles.length}
              data-review-visible-file-section-count={visibleReviewChanges.length}
              data-review-main-render-mode="selected-file"
            >
              {visibleReviewChanges.map((change) => {
                const content = reviewFileContentByPath[change.path] ?? { diff: '', preview: null, loading: true }
                const active = selectedFile === change.path
                return (
                  <ReviewFileSection
                    key={change.path}
                    change={change}
                    content={content}
                    active={active}
                    wrap={wrapLines}
                    diffMode={diffMode}
                    expanded={diffExpanded}
                    hideWhitespace={hideWhitespace}
                    showWordDiff={showWordDiff}
                    reviewSearchQuery={query.trim()}
                    activeReviewSearchMatchIndex={reviewSearchActivePath === change.path ? reviewSearchActiveMatch?.diffMatchIndex ?? null : null}
                    sourceMode={sourceMode && active}
                    sourceLoading={sourceLoading && active}
                    fullSourceText={active ? fullSourceText : null}
                    preferPreview={showPreview}
                    workDir={workDir}
                    comments={reviewCommentsByPath[change.path] ?? []}
                    onSelect={() => setSelectedFile(change.path)}
                    onCommentsChange={(updater) => setReviewCommentsForPath(change.path, updater)}
                    onOpenFileLine={(line) => openFileTabAtLine(change.path, line)}
                    onConflictResolved={() => refreshReviewFileAfterMutation(change.path)}
                  />
                )
              })}
            </div>
          </div>
          {reviewFloatingGitActions}
          {reviewFloatingActionStatus}
        </div>
      )}
    </div>
  )
}

function ReviewMetadataStrip({
  metadata,
  openPanel,
  onOpenPanelChange
}: {
  metadata: ReviewMetadata
  openPanel: ReviewMetadataPanel | null
  onOpenPanelChange: (panel: ReviewMetadataPanel | null) => void
}): JSX.Element {
  const hasMetadata = Boolean(metadata.pullRequest || metadata.checks || metadata.reviewers || metadata.comments)
  if (!hasMetadata) return <></>
  const summary = reviewMetadataSummary(metadata)
  return (
    <div
      className="review-metadata-strip relative"
      data-testid="review-metadata-strip"
      data-review-metadata-pr={metadata.pullRequest ? 'true' : 'false'}
      data-review-metadata-checks={metadata.checks?.status ?? ''}
      data-review-metadata-reviewers={reviewReviewerCount(metadata.reviewers)}
      data-review-metadata-comments={metadata.comments?.total ?? 0}
      data-review-metadata-comments-unresolved={metadata.comments?.unresolved ?? 0}
    >
      <IconButton
        icon="plan"
        label="Review metadata"
        size="sm"
        variant="toolbar"
        active={openPanel !== null}
        dataTestId="review-metadata-menu"
        ariaExpanded={openPanel !== null}
        ariaControls={REVIEW_METADATA_MENU_ID}
        ariaHasPopup="menu"
        onClick={() => onOpenPanelChange(openPanel === null ? 'pull-request' : null)}
      />
      {openPanel !== null && (
        <MenuSurface
          id={REVIEW_METADATA_MENU_ID}
          className="review-metadata-menu"
          onClose={() => onOpenPanelChange(null)}
          style={{ position: 'absolute', right: 0, top: 34, width: 278, zIndex: 92 }}
        >
          <MenuSection className="review-metadata-section" dataTestId="review-metadata-section">
            <MenuSectionLabel>Review</MenuSectionLabel>
            {metadata.pullRequest && (
              <ReviewMetadataRow
                icon="branch"
                testId="review-metadata-pr"
                active={openPanel === 'pull-request'}
                title={`PR ${metadata.pullRequest.number}`}
                detail={metadata.pullRequest.title ?? summary.pullRequest}
                meta={reviewPullRequestMeta(metadata.pullRequest)}
                externalUrl={metadata.pullRequest.url ?? null}
                onSelect={() => onOpenPanelChange('pull-request')}
              />
            )}
            {metadata.checks && (
              <ReviewMetadataRow
                icon={reviewCheckIcon(metadata.checks.status)}
                testId="review-metadata-checks"
                active={openPanel === 'checks'}
                tone={metadata.checks.status}
                title={reviewCheckTitle(metadata.checks)}
                detail={reviewCheckDetail(metadata.checks)}
                meta={summary.checks}
                externalUrl={metadata.checks.url ?? null}
                onSelect={() => onOpenPanelChange('checks')}
              />
            )}
            {metadata.reviewers && (
              <ReviewMetadataRow
                icon="agents"
                testId="review-metadata-reviewers"
                active={openPanel === 'reviewers'}
                title={reviewReviewerTitle(metadata.reviewers)}
                detail={reviewReviewerDetail(metadata.reviewers)}
                meta={summary.reviewers}
                externalUrl={metadata.reviewers.url ?? null}
                onSelect={() => onOpenPanelChange('reviewers')}
              />
            )}
            {metadata.comments && (
              <ReviewMetadataRow
                icon="chat"
                testId="review-metadata-comments"
                active={openPanel === 'comments'}
                title={reviewCommentTitle(metadata.comments)}
                detail={reviewCommentDetail(metadata.comments)}
                meta={summary.comments}
                externalUrl={metadata.comments.url ?? metadata.pullRequest?.url ?? null}
                onSelect={() => onOpenPanelChange('comments')}
              />
            )}
          </MenuSection>
        </MenuSurface>
      )}
    </div>
  )
}

function ReviewMetadataRow({
  icon,
  testId,
  active,
  tone,
  title,
  detail,
  meta,
  externalUrl,
  onSelect
}: {
  icon: IconName
  testId: string
  active: boolean
  tone?: ReviewCheckStatus
  title: string
  detail: string
  meta: string
  externalUrl?: string | null
  onSelect: () => void
}): JSX.Element {
  return (
    <div
      className="review-metadata-row-shell"
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      data-review-check-status={tone ?? ''}
    >
      <MenuRow className="review-metadata-row" dataTestId={`${testId}-row`} onClick={onSelect}>
        <span className="review-metadata-row-icon" data-review-check-status={tone ?? ''}>
          <Icon name={icon} size={13} />
        </span>
        <span className="review-metadata-row-main">
          <span className="review-metadata-row-title">{title}</span>
          <span className="review-metadata-row-detail">{detail}</span>
        </span>
        <span className="review-metadata-row-meta">{meta}</span>
      </MenuRow>
      {externalUrl && (
        <button
          type="button"
          className="review-metadata-row-external"
          aria-label={`Open ${title}`}
          data-testid={`${testId}-external`}
          onClick={() => { void window.api.browser.openExternal(externalUrl) }}
        >
          <Icon name="external" size={12} />
        </button>
      )}
    </div>
  )
}

function reviewMetadataSummary(metadata: ReviewMetadata): { pullRequest: string; checks: string; reviewers: string; comments: string } {
  return {
    pullRequest: metadata.pullRequest ? reviewPullRequestMeta(metadata.pullRequest) : 'No pull request',
    checks: metadata.checks ? reviewCheckTitle(metadata.checks) : 'No checks',
    reviewers: metadata.reviewers ? reviewReviewerTitle(metadata.reviewers) : 'No reviewers',
    comments: metadata.comments ? reviewCommentTitle(metadata.comments) : 'No comments'
  }
}

function reviewPullRequestMeta(pullRequest: NonNullable<ReviewMetadata['pullRequest']>): string {
  const parts = [pullRequest.state ?? 'open']
  if (pullRequest.branch && pullRequest.baseBranch) parts.push(`${pullRequest.branch} -> ${pullRequest.baseBranch}`)
  else if (pullRequest.branch) parts.push(pullRequest.branch)
  else if (pullRequest.baseBranch) parts.push(`base ${pullRequest.baseBranch}`)
  return parts.join(' / ')
}

function reviewCheckTitle(checks: NonNullable<ReviewMetadata['checks']>): string {
  const status = checks.status === 'passing'
    ? 'Checks passing'
    : checks.status === 'failing'
      ? 'Checks failing'
      : checks.status === 'pending'
        ? 'Checks pending'
        : checks.status === 'skipped'
          ? 'Checks skipped'
          : 'Checks unknown'
  return `${status}${checks.total > 0 ? ` (${checks.total})` : ''}`
}

function reviewCheckDetail(checks: NonNullable<ReviewMetadata['checks']>): string {
  const parts = [
    checks.passed !== undefined ? `${checks.passed} passed` : null,
    checks.failing !== undefined ? `${checks.failing} failed` : null,
    checks.pending !== undefined ? `${checks.pending} pending` : null,
    checks.skipped !== undefined ? `${checks.skipped} skipped` : null
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : 'No check detail available'
}

function reviewCheckIcon(status: ReviewCheckStatus): IconName {
  if (status === 'passing') return 'checkCircle'
  if (status === 'failing') return 'warning'
  if (status === 'pending') return 'clock'
  return 'plan'
}

function reviewReviewerCount(reviewers: ReviewMetadata['reviewers']): number {
  if (!reviewers) return 0
  return (reviewers.requested ?? 0) + (reviewers.approved ?? 0) + (reviewers.changesRequested ?? 0) + (reviewers.commented ?? 0)
}

function reviewReviewerTitle(reviewers: NonNullable<ReviewMetadata['reviewers']>): string {
  const count = reviewReviewerCount(reviewers)
  return `${count} ${count === 1 ? 'reviewer' : 'reviewers'}`
}

function reviewReviewerDetail(reviewers: NonNullable<ReviewMetadata['reviewers']>): string {
  const statusParts = [
    reviewers.approved !== undefined ? `${reviewers.approved} approved` : null,
    reviewers.changesRequested !== undefined ? `${reviewers.changesRequested} changes requested` : null,
    reviewers.requested !== undefined ? `${reviewers.requested} requested` : null,
    reviewers.commented !== undefined ? `${reviewers.commented} commented` : null
  ].filter(Boolean)
  const names = reviewers.names?.filter((name) => name.trim().length > 0).slice(0, 3).join(', ')
  return names ? `${names} / ${statusParts.join(' / ')}` : statusParts.join(' / ') || 'No reviewer detail available'
}

function reviewCommentTitle(comments: NonNullable<ReviewMetadata['comments']>): string {
  return `${comments.total} ${comments.total === 1 ? 'comment' : 'comments'}`
}

function reviewCommentDetail(comments: NonNullable<ReviewMetadata['comments']>): string {
  const authors = comments.authors?.filter((author) => author.trim().length > 0).slice(0, 3).join(', ')
  const unresolved = comments.unresolved !== undefined ? `${comments.unresolved} unresolved` : null
  const threads = comments.threads !== undefined ? `${comments.threads} ${comments.threads === 1 ? 'thread' : 'threads'}` : null
  return [authors, unresolved, threads].filter(Boolean).join(' / ') || 'No comment detail available'
}

function ReviewFileSection({
  change,
  content,
  active,
  wrap,
  diffMode,
  expanded,
  hideWhitespace,
  showWordDiff,
  reviewSearchQuery,
  activeReviewSearchMatchIndex,
  sourceMode,
  sourceLoading,
  fullSourceText,
  preferPreview,
  workDir,
  comments,
  onSelect,
  onCommentsChange,
  onOpenFileLine,
  onConflictResolved
}: {
  change: FileChange
  content: ReviewFileContent
  active: boolean
  wrap: boolean
  diffMode: ReviewDiffMode
  expanded: boolean
  hideWhitespace: boolean
  showWordDiff: boolean
  reviewSearchQuery: string
  activeReviewSearchMatchIndex: number | null
  sourceMode: boolean
  sourceLoading: boolean
  fullSourceText: string | null
  preferPreview: boolean
  workDir: string
  comments: ReviewDiffComment[]
  onSelect: () => void
  onCommentsChange: (updater: ReviewDiffCommentUpdater) => void
  onOpenFileLine: (line: number) => void
  onConflictResolved: () => void | Promise<void>
}): JSX.Element {
  return (
    <section
      className="review-file-section"
      data-review-path={change.path}
      data-review-file-section="true"
      data-review-file-section-shell="codex-flat"
      data-review-file-conflicted={change.conflicted ? 'true' : 'false'}
      data-review-conflict-status={change.conflictStatus ?? ''}
      data-active={active ? 'true' : 'false'}
      data-testid="review-file-section"
    >
      <button
        type="button"
        className="review-file-section-header"
        data-diffs-header="default"
        data-change-type={reviewHeaderChangeType(change.status)}
        data-review-file-header="true"
        data-review-file-header-style="codex-path-first"
        onClick={onSelect}
      >
        <span className="review-file-section-leading" data-header-content="">
          <span
            className="review-file-section-change-icon"
            data-change-icon={reviewHeaderChangeType(change.status)}
            data-review-file-change-icon="decorative"
            aria-hidden="true"
          >
            <ReviewHeaderChangeGlyph changeType={reviewHeaderChangeType(change.status)} />
          </span>
          <span className="review-file-section-path" data-title="">
            <bdi>{change.path}</bdi>
          </span>
        </span>
        <span className="review-file-section-metadata" data-metadata="">
          {change.conflicted && (
            <Badge tone="warning">Conflict</Badge>
          )}
          {(change.additions > 0 || change.deletions > 0) && (
            <span className="review-file-section-stats">
              {(change.deletions > 0 || change.additions === 0) && (
                <span className="review-file-section-stat-deletions" data-deletions-count="">-{change.deletions}</span>
              )}
              {(change.additions > 0 || change.deletions === 0) && (
                <span className="review-file-section-stat-additions" data-additions-count="">+{change.additions}</span>
              )}
            </span>
          )}
        </span>
      </button>
      <div className="review-file-section-body">
        <ReviewPreview
          change={change}
          diff={content.diff}
          preview={content.preview}
          loading={content.loading}
          wrap={wrap}
          diffMode={diffMode}
          expanded={expanded}
          hideWhitespace={hideWhitespace}
          showWordDiff={showWordDiff}
          reviewSearchQuery={reviewSearchQuery}
          activeReviewSearchMatchIndex={activeReviewSearchMatchIndex}
          sourceMode={sourceMode}
          sourceLoading={sourceLoading}
          fullSourceText={fullSourceText}
          preferPreview={preferPreview}
          workDir={workDir}
          absolutePath={joinPath(workDir, change.path)}
          comments={comments}
          onCommentsChange={onCommentsChange}
          onOpenFileLine={onOpenFileLine}
          onConflictResolved={onConflictResolved}
        />
      </div>
    </section>
  )
}

function ReviewRefPicker({
  label,
  value,
  placeholder,
  inputTestId,
  buttonTestId,
  queryTestId,
  itemTestId,
  query,
  open,
  options,
  emptyLabel,
  onChange,
  onOpenChange,
  onQueryChange
}: {
  label: string
  value: string
  placeholder: string
  inputTestId: string
  buttonTestId: string
  queryTestId: string
  itemTestId: string
  query: string
  open: boolean
  options: GitRefOption[]
  emptyLabel: string
  onChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onQueryChange: (value: string) => void
}): JSX.Element {
  const menuId = `${buttonTestId}-menu`
  return (
    <div className="review-source-ref-row">
      <span>{label}</span>
      <div className="review-source-ref-control relative">
        <input
          className="review-source-ref-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          data-testid={inputTestId}
        />
        <button
          type="button"
          className="review-source-ref-picker-button"
          aria-label={`Choose ${label.toLowerCase()}`}
          aria-expanded={open}
          aria-controls={menuId}
          aria-haspopup="menu"
          data-testid={buttonTestId}
          onClick={() => onOpenChange(!open)}
        >
          <Icon name="chevronDown" size={12} />
        </button>
        {open && (
          <MenuSurface
            id={menuId}
            className="review-source-ref-menu"
            onClose={() => onOpenChange(false)}
            style={{ position: 'absolute', right: 0, top: 28, width: 290, zIndex: 94 }}
          >
            <div className="review-source-ref-menu-search">
              <WorkbenchSearchField
                value={query}
                onChange={onQueryChange}
                placeholder={`Search ${label.toLowerCase()}`}
                clearLabel={`Clear ${label.toLowerCase()} search`}
                dataTestId={queryTestId}
                className="review-source-ref-search-field"
              />
            </div>
            <div className="review-source-ref-menu-list">
              {options.length === 0 ? (
                <MenuMessage dataTestId="review-source-ref-menu-empty" state="empty">
                  {emptyLabel}
                </MenuMessage>
              ) : (
                options.map((option) => (
                  <button
                    key={option.name}
                    type="button"
                    role="menuitem"
                    className="review-source-ref-menu-item"
                    data-testid={itemTestId}
                    data-active={value === option.name ? 'true' : 'false'}
                    onClick={() => {
                      onChange(option.name)
                      onOpenChange(false)
                      onQueryChange('')
                    }}
                  >
                    <span className="review-source-ref-menu-label">
                      <span className="truncate">{option.label}</span>
                      {option.current && <Badge tone="neutral">Current</Badge>}
                    </span>
                    {option.description && <span className="review-source-ref-menu-description">{option.description}</span>}
                  </button>
                ))
              )}
            </div>
          </MenuSurface>
        )}
      </div>
    </div>
  )
}

function ReviewPreview({
  change,
  diff,
  preview,
  loading,
  wrap,
  diffMode,
  expanded,
  hideWhitespace,
  showWordDiff,
  reviewSearchQuery,
  activeReviewSearchMatchIndex,
  sourceMode,
  sourceLoading,
  fullSourceText,
  preferPreview,
  workDir,
  absolutePath,
  comments,
  onCommentsChange,
  onOpenFileLine,
  onConflictResolved
}: {
  change: FileChange | null
  diff: string
  preview: FilePreviewResult | null
  loading: boolean
  wrap: boolean
  diffMode: ReviewDiffMode
  expanded: boolean
  hideWhitespace: boolean
  showWordDiff: boolean
  reviewSearchQuery: string
  activeReviewSearchMatchIndex: number | null
  sourceMode: boolean
  sourceLoading: boolean
  fullSourceText: string | null
  preferPreview: boolean
  workDir: string
  absolutePath: string
  comments: ReviewDiffComment[]
  onCommentsChange: (updater: ReviewDiffCommentUpdater) => void
  onOpenFileLine: (line: number) => void
  onConflictResolved: () => void | Promise<void>
}): JSX.Element {
  if (!change) {
    return <ReviewEmptyState title="No file selected" body="Select a change." />
  }
  if (loading) {
    return <ReviewEmptyState title={change.path} body="Loading..." testId="review-diff-loading-state" />
  }
  if (sourceMode) {
    if (sourceLoading) {
      return <ReviewEmptyState title={change.path} body="Loading full file..." testId="review-full-source-loading" />
    }
    if (fullSourceText === null) {
      return <ReviewEmptyState title={change.path} body="Full file unavailable." testId="review-full-source-unavailable" />
    }
    return (
      <SourcePreview
        change={change}
        label="Full source"
        text={fullSourceText}
        truncated={false}
        workDir={workDir}
        testId="review-full-source"
      />
    )
  }
  if ((isBinaryDiff(diff) && !preferPreview) || preview?.kind === 'binary') {
    return (
      <ReviewEmptyState
        title={change.path}
        body="Binary file not shown."
        meta={preview?.size !== undefined ? `Binary, ${formatBytes(preview.size)}` : 'Binary'}
        testId="review-binary-state"
        actions={[
          { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
          { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
        ]}
      />
    )
  }
  if (shouldPreferTextDiff(diff) && !preferPreview) {
    return <DiffLines diff={diff} filePath={change.path} workDir={workDir} absolutePath={absolutePath} conflicted={change.conflicted === true} wrap={wrap} mode={diffMode} expanded={expanded} hideWhitespace={hideWhitespace} showWordDiff={showWordDiff} searchQuery={reviewSearchQuery} activeSearchMatchIndex={activeReviewSearchMatchIndex} comments={comments} onCommentsChange={onCommentsChange} onOpenFileLine={onOpenFileLine} onConflictResolved={onConflictResolved} />
  }
  if (preview?.kind === 'image') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-image-state">
        <ReviewPreviewHeader change={change} label="Image" />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          <img
            src={fileUrl(absolutePath)}
            alt={change.path}
            className="max-h-full max-w-full rounded-md object-contain"
            style={{ border: '1px solid var(--border-subtle)' }}
          />
        </div>
      </div>
    )
  }
  if (preview?.kind === 'pdf') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-pdf-state">
        <ReviewPreviewHeader change={change} label="PDF" />
        <iframe title={change.path} src={fileUrl(absolutePath)} className="min-h-0 flex-1 border-0" />
      </div>
    )
  }
  if (preview?.kind === 'html') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-html-state">
        <ReviewPreviewHeader change={change} label="HTML" />
        <iframe title={change.path} src={fileUrl(absolutePath)} sandbox="" className="min-h-0 flex-1 border-0" />
      </div>
    )
  }
  if (preview?.kind === 'markdown') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-markdown-state">
        <ReviewPreviewHeader change={change} label={preview.truncated ? 'Markdown truncated' : 'Markdown'} />
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="markdown-surface text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {preview.text ?? ''}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }
  if (preview?.kind === 'json') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-json-state"
      />
    )
  }
  if (preview?.kind === 'csv') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-csv-state"
      />
    )
  }
  if (preview?.kind === 'notebook') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-notebook-state"
      />
    )
  }
  if (preview?.kind === 'document') {
    return (
      <StructuredDataPreview
        name={change.path}
        preview={preview}
        statusLabel={fileStatusLabel(change.status)}
        testId="review-document-state"
      />
    )
  }
  if (preview?.kind === 'audio') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-audio-state">
        <ReviewPreviewHeader change={change} label="Audio" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{change.path}</span>
          <audio controls src={fileUrl(absolutePath)} className="w-full max-w-[360px]" />
        </div>
      </div>
    )
  }
  if (preview?.kind === 'video') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="review-video-state">
        <ReviewPreviewHeader change={change} label="Video" />
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          <video controls src={fileUrl(absolutePath)} className="max-h-full max-w-full rounded-md" />
        </div>
      </div>
    )
  }
  if (diff.trim()) {
    return <DiffLines diff={diff} filePath={change.path} workDir={workDir} absolutePath={absolutePath} conflicted={change.conflicted === true} wrap={wrap} mode={diffMode} expanded={expanded} hideWhitespace={hideWhitespace} showWordDiff={showWordDiff} searchQuery={reviewSearchQuery} activeSearchMatchIndex={activeReviewSearchMatchIndex} comments={comments} onCommentsChange={onCommentsChange} onOpenFileLine={onOpenFileLine} onConflictResolved={onConflictResolved} />
  }
  if (preview?.kind === 'text' && preview.text?.trim()) {
    return (
      <SourcePreview
        change={change}
        label={preview.truncated ? 'Source truncated' : 'Source'}
        text={preview.text}
        truncated={preview.truncated}
        workDir={workDir}
        testId="review-source-preview"
      />
    )
  }
  if (change.status === 'D') {
    return <ReviewEmptyState title={change.path} body="Deleted file." />
  }
  if (preview?.kind === 'missing') {
    return <ReviewEmptyState title={change.path} body="Missing from workspace." />
  }
  if (preview?.kind === 'unreadable') {
    return (
      <ReviewEmptyState
        title={change.path}
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
    <ReviewEmptyState
      title={change.path}
      body="No preview available."
      testId="review-no-content-state"
      actions={[
        { label: 'Open', onClick: () => { void window.api.fs.openPath(absolutePath) } },
        { label: 'Reveal', onClick: () => { void window.api.fs.showInFolder(absolutePath) } }
      ]}
    />
  )
}

function ReviewPreviewHeader({ change, label }: { change: FileChange; label: string }): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-3 py-2 text-[11px]"
      style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
    >
      <Badge tone="neutral">{fileStatusLabel(change.status)}</Badge>
      <span className="min-w-0 flex-1 truncate">{label} · {change.path}</span>
    </div>
  )
}

function fileMatchesReviewSource(file: FileChange, source: ReviewDiffSource): boolean {
  if (source === 'staged') return file.staged === true
  if (source === 'unstaged') return file.unstaged === true
  if (source === 'last-turn') return true
  if (source === 'local' || source === 'worktree') return true
  if (!isSupportedReviewDiffSource(source, emptyReviewSourceSupport())) return false
  return true
}

function isLocalMutableReviewSource(source: ReviewDiffSource): boolean {
  return source === 'all' || source === 'unstaged' || source === 'staged'
}

function filterGitRefOptions(options: GitRefOption[], query: string): GitRefOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? options.filter((option) =>
      option.name.toLowerCase().includes(normalizedQuery) ||
      option.label.toLowerCase().includes(normalizedQuery) ||
      (option.description ?? '').toLowerCase().includes(normalizedQuery)
    )
    : options
  return filtered.slice(0, 24)
}

function countSearchMatches(value: string, query: string): number {
  if (!query) return 0
  let count = 0
  let index = value.indexOf(query)
  while (index !== -1) {
    count += 1
    index = value.indexOf(query, index + query.length)
  }
  return count
}

function normalizedReviewSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

function countReviewSearchMatches(path: string, content: ReviewFileContent | undefined, normalizedQuery: string): number {
  if (!normalizedQuery) return 0
  return countSearchMatches(path.toLowerCase(), normalizedQuery) +
    countSearchMatches((content?.diff ?? '').toLowerCase(), normalizedQuery) +
    countSearchMatches((content?.preview?.text ?? '').toLowerCase(), normalizedQuery)
}

function pushReviewSearchNavigationMatches(
  matches: ReviewSearchNavigationMatch[],
  path: string,
  value: string,
  kind: ReviewSearchNavigationMatch['kind'],
  normalizedQuery: string,
  existingDiffMatches: number | null
): void {
  if (!normalizedQuery || matches.length >= REVIEW_SEARCH_MATCH_CAP) return
  const count = countSearchMatches(value.toLowerCase(), normalizedQuery)
  for (let index = 0; index < count && matches.length < REVIEW_SEARCH_MATCH_CAP; index += 1) {
    const diffMatchIndex = kind === 'diff' ? (existingDiffMatches ?? 0) + index + 1 : null
    matches.push({
      path,
      ordinal: matches.length + 1,
      fileMatchIndex: index + 1,
      diffMatchIndex,
      kind
    })
  }
}

function readStoredReviewSource(workDir: string): ReviewDiffSource {
  try {
    const value = window.localStorage.getItem(reviewSourceStorageKey(workDir))
    return isReviewDiffSource(value) && value !== 'cloud' && value !== 'local' && value !== 'worktree' ? value : 'all'
  } catch {
    return 'all'
  }
}

function writeStoredReviewSource(workDir: string, source: ReviewDiffSource): void {
  try {
    window.localStorage.setItem(reviewSourceStorageKey(workDir), source)
  } catch {
    // Storage persistence is a convenience; Review still works without it.
  }
}

function readStoredReviewSourceRef(workDir: string, source: 'branch' | 'commit'): string {
  try {
    return window.localStorage.getItem(reviewSourceRefStorageKey(workDir, source)) ?? ''
  } catch {
    return ''
  }
}

function writeStoredReviewSourceRef(workDir: string, source: 'branch' | 'commit', value: string): void {
  try {
    window.localStorage.setItem(reviewSourceRefStorageKey(workDir, source), value)
  } catch {
    // Storage persistence is a convenience; Review still works without it.
  }
}

function readStoredReviewSidePaneWidth(workDir: string): number {
  try {
    const value = Number.parseInt(window.localStorage.getItem(reviewSidePaneWidthStorageKey(workDir)) ?? '', 10)
    if (value === 260) return REVIEW_SIDE_PANE_DEFAULT_WIDTH
    return Number.isFinite(value) ? Math.max(value, REVIEW_SIDE_PANE_MIN_WIDTH) : REVIEW_SIDE_PANE_DEFAULT_WIDTH
  } catch {
    return REVIEW_SIDE_PANE_DEFAULT_WIDTH
  }
}

function writeStoredReviewSidePaneWidth(workDir: string, width: number): void {
  try {
    window.localStorage.setItem(reviewSidePaneWidthStorageKey(workDir), String(Math.round(width)))
  } catch {
    // Storage persistence is a convenience; Review still works without it.
  }
}

function readStoredReviewSidePaneVisible(workDir: string): boolean {
  try {
    return window.localStorage.getItem(reviewSidePaneVisibleStorageKey(workDir)) !== 'false'
  } catch {
    return true
  }
}

function writeStoredReviewSidePaneVisible(workDir: string, visible: boolean): void {
  try {
    window.localStorage.setItem(reviewSidePaneVisibleStorageKey(workDir), visible ? 'true' : 'false')
  } catch {
    // Storage persistence is a convenience; Review still works without it.
  }
}

function reviewSourceStorageKey(workDir: string): string {
  return `${REVIEW_SOURCE_STORAGE_PREFIX}${workDir}`
}

function reviewSourceRefStorageKey(workDir: string, source: 'branch' | 'commit'): string {
  return `${REVIEW_SOURCE_REF_STORAGE_PREFIX}${source}:${workDir}`
}

function reviewSidePaneWidthStorageKey(workDir: string): string {
  return `${REVIEW_SIDE_PANE_WIDTH_STORAGE_PREFIX}${workDir}`
}

function reviewSidePaneVisibleStorageKey(workDir: string): string {
  return `${REVIEW_SIDE_PANE_VISIBLE_STORAGE_PREFIX}${workDir}`
}

function isReviewDiffSource(value: string | null): value is ReviewDiffSource {
  return value === 'all' ||
    value === 'unstaged' ||
    value === 'staged' ||
    value === 'branch' ||
    value === 'commit' ||
    value === 'last-turn' ||
    value === 'cloud' ||
    value === 'local' ||
    value === 'worktree'
}

function isSupportedReviewDiffSource(value: ReviewDiffSource, support: ReviewSourceSupport): boolean {
  return value === 'all' ||
    value === 'unstaged' ||
    value === 'staged' ||
    value === 'branch' ||
    value === 'commit' ||
    (value === 'last-turn' && support.hasLastTurnDiff) ||
    (value === 'local' && support.hasLocalProviderSource) ||
    (value === 'worktree' && support.hasWorktreeProviderSource) ||
    (value === 'cloud' && support.hasCloudProviderSource)
}

function reviewSourceUnavailableReason(value: ReviewDiffSource, support: ReviewSourceSupport): string {
  if (isSupportedReviewDiffSource(value, support)) return ''
  if (value === 'last-turn') return 'No provider turn diff'
  if (value === 'cloud') return 'Cloud review adapter missing'
  if (value === 'local') return 'No local provider source'
  if (value === 'worktree') return 'No provider worktree source'
  return 'Unavailable for this review'
}

function emptyReviewSourceSupport(): ReviewSourceSupport {
  return {
    hasLastTurnDiff: false,
    hasLocalProviderSource: false,
    hasWorktreeProviderSource: false,
    hasCloudProviderSource: false
  }
}

function localGitSourceForReviewSource(source: ReviewDiffSource): ReviewDiffSource {
  return source === 'local' || source === 'worktree' ? 'all' : source
}

function reviewSourceCountFor(
  source: ReviewDiffSource,
  localCounts: Record<'all' | 'unstaged' | 'staged', number>,
  activeSource: ReviewDiffSource,
  activeSourceCount: number,
  lastTurnSourceCount: number
): number {
  if (source === 'all' || source === 'unstaged' || source === 'staged') return localCounts[source]
  if (source === 'local' || source === 'worktree') return localCounts.all
  if (source === 'last-turn') return lastTurnSourceCount
  if ((source === 'branch' || source === 'commit') && source === activeSource) return activeSourceCount
  return 0
}

function reviewSourceSummaryLabel(
  source: ReviewDiffSource,
  fallbackLabel: string,
  branchRef: string,
  commitRef: string
): string {
  if (source === 'all') return 'All changes'
  if (source === 'branch') {
    const trimmed = branchRef.trim()
    return trimmed ? `Branch: ${trimmed}` : 'Branch'
  }
  if (source === 'commit') {
    const trimmed = commitRef.trim()
    return trimmed ? `Commit: ${trimmed}` : 'Commit'
  }
  return fallbackLabel
}

function reviewDirectoryMetadataLabel(fileCount: number, additions: number, deletions: number): string {
  const parts = [`${fileCount} ${fileCount === 1 ? 'file' : 'files'}`]
  if (additions > 0) parts.push(`+${additions}`)
  if (deletions > 0) parts.push(`-${deletions}`)
  return parts.join(', ')
}

function latestDiffUpdatedContent(records: SessionRunEventRecord[]): string {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const event = records[index]?.event
    if (event?.type === 'diff.updated') return event.content
  }
  return ''
}

function SourcePreview({
  change,
  label,
  text,
  truncated,
  workDir,
  testId
}: {
  change: FileChange
  label: string
  text: string
  truncated: boolean
  workDir: string
  testId: string
}): JSX.Element {
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [sourceBlameVisible, setSourceBlameVisible] = useState(false)
  const [lineBlame, setLineBlame] = useState<GitLineBlameResult | null>(null)
  const [sourceBlameByLine, setSourceBlameByLine] = useState<Map<number, GitLineBlameResult>>(() => new Map())
  const lines = useMemo(() => splitSourcePreviewLines(text), [text])
  const sourceBlameLineNumbers = useMemo(
    () => Array.from({ length: Math.min(lines.length, 400) }, (_, index) => index + 1),
    [lines.length]
  )
  const sourceBlameLoadedCount = useMemo(
    () => sourceBlameLineNumbers.filter((line) => sourceBlameByLine.has(line)).length,
    [sourceBlameByLine, sourceBlameLineNumbers]
  )

  useEffect(() => {
    setSelectedLine(null)
    setSourceBlameVisible(false)
    setLineBlame(null)
    setSourceBlameByLine(new Map())
  }, [change.path, text])

  useEffect(() => {
    if (selectedLine === null) {
      setLineBlame(null)
      return
    }
    let cancelled = false
    setLineBlame(null)
    window.api.git.blameLine(workDir, change.path, selectedLine)
      .then((result) => {
        if (!cancelled) {
          setLineBlame(result)
          setSourceBlameByLine((current) => new Map(current).set(selectedLine, result))
        }
      })
      .catch(() => {
        if (!cancelled) {
          const result: GitLineBlameResult = { ok: false, path: change.path, line: selectedLine, error: 'Blame unavailable' }
          setLineBlame(result)
          setSourceBlameByLine((current) => new Map(current).set(selectedLine, result))
        }
      })
    return () => {
      cancelled = true
    }
  }, [change.path, selectedLine, workDir])

  useEffect(() => {
    if (!sourceBlameVisible || sourceBlameLineNumbers.length === 0) return
    const missingLines = sourceBlameLineNumbers.filter((line) => !sourceBlameByLine.has(line))
    if (missingLines.length === 0) return
    let cancelled = false
    Promise.all(missingLines.map((line) =>
      window.api.git.blameLine(workDir, change.path, line)
        .catch(() => ({ ok: false, path: change.path, line, error: 'Blame unavailable' }))
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
  }, [change.path, sourceBlameByLine, sourceBlameLineNumbers, sourceBlameVisible, workDir])

  const selectedLineBlameDetails = blameDetails(lineBlame)
  const selectedLineBlameLabel = blameGutterLabel(
    selectedLineBlameDetails.author,
    selectedLineBlameDetails.commit,
    selectedLineBlameDetails.source
  )
  const sharedPreview: FilePreviewResult = useMemo(() => ({
    kind: 'text',
    text,
    truncated,
    size: text.length
  }), [text, truncated])
  const sourceEntry = useMemo(() => ({
    path: change.path,
    name: basename(change.path),
    kind: 'file' as const,
    depth: change.path.split('/').filter(Boolean).length - 1,
    size: text.length
  }), [change.path, text.length])

  return (
    <div
      className="review-source-preview min-h-full"
      data-testid={testId}
      data-review-source-shared-preview="true"
      data-review-source-truncated={truncated ? 'true' : 'false'}
      data-review-source-line-count={lines.length}
      data-review-source-selected-line={selectedLine ?? ''}
      data-review-source-blame-visible={sourceBlameVisible ? 'true' : 'false'}
      data-review-source-blame-loaded-count={sourceBlameLoadedCount}
      data-review-source-blame-line-count={sourceBlameLineNumbers.length}
    >
      <ReviewPreviewHeader change={change} label={label} />
      <div className="review-source-actions" data-testid="review-source-actions">
        <IconButton
          icon="branch"
          label={sourceBlameVisible ? 'Hide review source blame' : 'Show review source blame'}
          size="sm"
          variant="toolbar"
          active={sourceBlameVisible}
          dataTestId="review-source-toggle-blame"
          onClick={() => setSourceBlameVisible((visible) => !visible)}
        />
        {selectedLine !== null && (
          <span
            className="review-source-selected-blame"
            data-testid="review-source-selected-blame"
            data-review-source-selected-blame-line={selectedLine}
            data-review-source-selected-blame-source={selectedLineBlameDetails.source}
          >
            L{selectedLine}{selectedLineBlameDetails.source === 'unknown' ? '' : ` · ${selectedLineBlameLabel}`}
          </span>
        )}
      </div>
      <div className="review-source-shared-preview" data-testid="review-source-shared-preview">
        <FilePreview
          entry={sourceEntry}
          absolutePath={joinPath(workDir, change.path)}
          preview={sharedPreview}
          forceSource
          selectedSourceLine={selectedLine}
          onSelectedSourceLineChange={setSelectedLine}
          renderLineGutterAdornment={(line) => sourceBlameVisible ? (
            <ReviewSourceGutterBlame result={sourceBlameByLine.get(line) ?? null} line={line} />
          ) : null}
          renderSelectedLineActions={(line) => (
            <>
              <span
                className="workspace-source-line-action-blame"
                data-testid="review-source-line-action-blame"
                data-review-source-line-action-blame-source={selectedLineBlameDetails.source}
              >
                {selectedLineBlameDetails.source === 'unknown' ? 'Blame' : selectedLineBlameLabel}
              </span>
              {sourceBlameVisible && selectedLine === line && (
                <ReviewSourceBlameDetails result={lineBlame} line={line} />
              )}
            </>
          )}
        />
      </div>
    </div>
  )
}

function ReviewSourceBlameDetails({ result, line }: { result: GitLineBlameResult | null; line: number }): JSX.Element {
  const details = blameDetails(result)
  return (
    <div
      className="workspace-source-blame-details"
      data-testid="review-source-blame-details"
      data-review-source-blame-line={line}
      data-review-source-blame-ok={result?.ok === true ? 'true' : 'false'}
      data-review-source-blame-source={details.source}
      data-review-source-blame-author={details.author}
      data-review-source-blame-commit={details.commit}
      data-review-source-blame-date={details.date}
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

function ReviewSourceGutterBlame({ result, line }: { result: GitLineBlameResult | null; line: number }): JSX.Element {
  const details = blameDetails(result)
  const label = blameGutterLabel(details.author, details.commit, details.source)
  return (
    <span
      className="workspace-source-gutter-blame review-source-gutter-blame"
      data-testid="review-source-gutter-blame"
      data-review-source-gutter-blame-line={line}
      data-review-source-gutter-blame-source={details.source}
      data-review-source-gutter-blame-author={details.author}
      data-review-source-gutter-blame-commit={details.commit}
      data-review-source-gutter-blame-date={details.date}
      aria-label={details.author ? `Blame: ${details.author}` : 'Blame unavailable'}
    >
      {label}
    </span>
  )
}

function splitSourcePreviewLines(text: string): string[] {
  if (text.length === 0) return ['']
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.length > 1 && lines[lines.length - 1] === '') return lines.slice(0, -1)
  return lines
}

function ReviewEmptyState({
  title,
  body,
  meta,
  testId,
  icon = 'file',
  centered = false,
  actions = []
}: {
  title: string
  body: string
  meta?: string
  testId?: string
  icon?: IconName
  centered?: boolean
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
              <Icon name={reviewActionIcon(action.label)} size={12} />
              {action.label}
            </Button>
          ))}
        </>
      ) : undefined}
      className={`file-fallback-state review-fallback-state${centered ? ' review-fallback-state-centered' : ''}`}
      code={meta}
      dataTestId={testId}
      description={body}
      icon={<Icon name={icon} size={18} />}
      rootAttrs={{ 'data-review-empty-state': 'true' }}
      title={title}
    />
  )
}

function reviewActionIcon(label: string): 'external' | 'folder' | 'file' {
  if (label === 'Open') return 'external'
  if (label === 'Reveal') return 'folder'
  return 'file'
}

function isBinaryDiff(diff: string): boolean {
  return isBinaryDiffText(diff)
}

function hasReviewPreview(preview: FilePreviewResult): boolean {
  return preview.kind === 'image' ||
    preview.kind === 'pdf' ||
    preview.kind === 'html' ||
    preview.kind === 'markdown' ||
    preview.kind === 'json' ||
    preview.kind === 'csv' ||
    preview.kind === 'notebook' ||
    preview.kind === 'document' ||
    preview.kind === 'audio' ||
    preview.kind === 'video' ||
    (preview.kind === 'text' && Boolean(preview.text?.trim()))
}

function canReadFullSource(preview: FilePreviewResult): boolean {
  return preview.kind === 'text' ||
    preview.kind === 'markdown' ||
    preview.kind === 'json' ||
    preview.kind === 'csv' ||
    preview.kind === 'notebook' ||
    preview.kind === 'html'
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const statusColor: Record<FileChange['status'], string> = {
  M: 'var(--color-accent)',
  A: '#22c55e',
  D: '#ef4444',
  R: '#f59e0b',
  U: '#f59e0b',
  '?': 'var(--color-text-muted)'
}

function reviewHeaderChangeType(status: FileChange['status']): 'change' | 'new' | 'deleted' | 'rename-changed' | 'conflict' | 'file' {
  if (status === 'A' || status === '?') return 'new'
  if (status === 'D') return 'deleted'
  if (status === 'R') return 'rename-changed'
  if (status === 'U') return 'conflict'
  if (status === 'M') return 'change'
  return 'file'
}

function ReviewHeaderChangeGlyph({
  changeType
}: {
  changeType: ReturnType<typeof reviewHeaderChangeType>
}): JSX.Element {
  if (changeType === 'conflict') {
    return <Icon name="warning" size={16} />
  }
  if (changeType === 'new') {
    return (
      <svg data-codex-review-change-icon="new" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4" />
        <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
      </svg>
    )
  }
  if (changeType === 'deleted') {
    return (
      <svg data-codex-review-change-icon="deleted" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8" />
        <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
      </svg>
    )
  }
  if (changeType === 'rename-changed') {
    return (
      <svg data-codex-review-change-icon="rename-changed" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
        <path d="M8.495 4.695a.75.75 0 0 0-.05 1.06L10.486 8l-2.041 2.246a.75.75 0 0 0 1.11 1.008l2.5-2.75a.75.75 0 0 0 0-1.008l-2.5-2.75a.75.75 0 0 0-1.06-.051m-4 0a.75.75 0 0 0-.05 1.06l2.044 2.248-1.796 1.995a.75.75 0 0 0 1.114 1.004l2.25-2.5a.75.75 0 0 0-.002-1.007l-2.5-2.75a.75.75 0 0 0-1.06-.05" />
      </svg>
    )
  }
  if (changeType === 'change') {
    return (
      <svg data-codex-review-change-icon="change" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1.5 8c0 1.613.088 2.806.288 3.704.196.88.478 1.381.802 1.706s.826.607 1.706.802c.898.2 2.091.288 3.704.288s2.806-.088 3.704-.288c.88-.195 1.381-.478 1.706-.802s.607-.826.802-1.706c.2-.898.288-2.091.288-3.704s-.088-2.806-.288-3.704c-.195-.88-.478-1.381-.802-1.706s-.826-.606-1.706-.802C10.806 1.588 9.613 1.5 8 1.5s-2.806.088-3.704.288c-.88.196-1.381.478-1.706.802s-.606.826-.802 1.706C1.588 5.194 1.5 6.387 1.5 8M0 8c0-6.588 1.412-8 8-8s8 1.412 8 8-1.412 8-8 8-8-1.412-8-8m8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
      </svg>
    )
  }
  return <Icon name="file" size={16} />
}

function DiffLines({
  diff,
  filePath,
  workDir,
  absolutePath,
  conflicted,
  wrap,
  mode,
  expanded,
  hideWhitespace,
  showWordDiff,
  searchQuery,
  activeSearchMatchIndex,
  comments,
  onCommentsChange,
  onOpenFileLine,
  onConflictResolved
}: {
  diff: string
  filePath: string
  workDir: string
  absolutePath: string
  conflicted: boolean
  wrap: boolean
  mode: ReviewDiffMode
  expanded: boolean
  hideWhitespace: boolean
  showWordDiff: boolean
  searchQuery: string
  activeSearchMatchIndex: number | null
  comments: ReviewDiffComment[]
  onCommentsChange: (updater: ReviewDiffCommentUpdater) => void
  onOpenFileLine: (line: number) => void
  onConflictResolved: () => void | Promise<void>
}): JSX.Element {
  const rawLines = diff.split('\n').filter(
    (l) => !l.startsWith('diff --git') && !l.startsWith('index ') && !l.startsWith('--- ') && !l.startsWith('+++ ')
  )
  const { lines: filteredLines, hiddenWhitespaceChanges } = hideWhitespaceOnlyChanges(rawLines, hideWhitespace)
  const [largeDiffExpanded, setLargeDiffExpanded] = useState(false)
  const diffSearchContainerRef = useRef<HTMLDivElement | null>(null)
  const renderWindow = useMemo(
    () => resolveReviewDiffRenderWindow(filteredLines, largeDiffExpanded),
    [filteredLines, largeDiffExpanded]
  )
  const lines = renderWindow.lines
  const lineMetadata = useMemo(() => annotateDiffLines(lines), [lines])
  const hunkSummaries = useMemo(() => summarizeDiffHunks(lines, lineMetadata), [lineMetadata, lines])
  const hiddenContextSegments = useMemo(() => buildHiddenContextSegments(lines), [lines])
  const hiddenContextByHunk = useMemo(() => {
    const byHunk = new Map<number, HiddenContextSegment>()
    hiddenContextSegments.forEach((segment) => byHunk.set(segment.beforeHunkIndex, segment))
    return byHunk
  }, [hiddenContextSegments])
  const wordDiffParts = useMemo(() => buildWordDiffLineParts(lines, showWordDiff), [lines, showWordDiff])
  const diffSearchState = useMemo(
    () => buildDiffSearchLineState(lines, searchQuery, activeSearchMatchIndex),
    [activeSearchMatchIndex, lines, searchQuery]
  )
  const blameLineNumbers = useMemo(() => {
    const next = new Set<number>()
    lineMetadata.forEach((metadata) => {
      if (metadata?.newLine !== undefined) next.add(metadata.newLine)
    })
    return Array.from(next).slice(0, 200)
  }, [lineMetadata])
  const [selectedLine, setSelectedLine] = useState<SelectedDiffLine | null>(null)
  const [activeDiffFocusId, setActiveDiffFocusId] = useState<string | null>(null)
  const [blameVisible, setBlameVisible] = useState(false)
  const [lineBlame, setLineBlame] = useState<GitLineBlameResult | null>(null)
  const [lineBlameByLine, setLineBlameByLine] = useState<Map<number, GitLineBlameResult>>(() => new Map())
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(() => new Set())
  const [expandedHiddenContext, setExpandedHiddenContext] = useState<Set<string>>(() => new Set())
  const [hiddenContextSource, setHiddenContextSource] = useState<string | null>(null)
  const [hiddenContextLoading, setHiddenContextLoading] = useState<string | null>(null)
  const [selectedLineActionStatus, setSelectedLineActionStatus] = useState('')
  const [copiedSelectedLineReference, setCopiedSelectedLineReference] = useState('')
  const [addedSelectedLineReference, setAddedSelectedLineReference] = useState('')
  const hiddenContextSourceLines = useMemo(() => hiddenContextSource?.split(/\r?\n/) ?? [], [hiddenContextSource])
  const [conflictSourceText, setConflictSourceText] = useState<string | null>(null)
  const [conflictActionStatus, setConflictActionStatus] = useState<string | null>(null)
  const [conflictActionError, setConflictActionError] = useState<string | null>(null)
  const [suggestionStatusById, setSuggestionStatusById] = useState<Record<string, ReviewSuggestionStatus>>({})
  const conflictBlocks = useMemo(() => parseMergeConflictBlocks(conflictSourceText ?? ''), [conflictSourceText])
  const conflictBlockByStartLine = useMemo(() => {
    const byLine = new Map<number, MergeConflictBlock>()
    conflictBlocks.forEach((block) => byLine.set(block.startLine, block))
    return byLine
  }, [conflictBlocks])
  const expandedHiddenContextLineCount = hiddenContextSegments.reduce((total, segment) =>
    total + (expandedHiddenContext.has(segment.key) ? segment.count : 0), 0)
  const totalHiddenContextLineCount = hiddenContextSegments.reduce((total, segment) => total + segment.count, 0)
  const allHiddenContextExpanded = hiddenContextSegments.length > 0 &&
    hiddenContextSegments.every((segment) => expandedHiddenContext.has(segment.key))
  const selectableDiffLines = useMemo<Array<SelectedDiffLine & { focusId: string }>>(() => {
    const next: Array<SelectedDiffLine & { focusId: string }> = []
    lines.forEach((line, index) => {
      const type = diffLineType(line)
      if (type === 'hunk') return
      const metadata = lineMetadata[index]
      const hunkIndex = metadata?.hunkIndex
      if (hunkIndex !== undefined && collapsedHunks.has(hunkIndex)) return
      if (mode === 'split') {
        if (type !== 'addition' && metadata?.oldLine !== undefined) next.push({ side: 'old', lineNumber: metadata.oldLine, focusId: `split:${index}:old` })
        if (type !== 'deletion' && metadata?.newLine !== undefined) next.push({ side: 'new', lineNumber: metadata.newLine, focusId: `split:${index}:new` })
        return
      }
      if (metadata?.newLine !== undefined) {
        next.push({ side: 'new', lineNumber: metadata.newLine, focusId: `unified:${index}:new` })
      } else if (metadata?.oldLine !== undefined) {
        next.push({ side: 'old', lineNumber: metadata.oldLine, focusId: `unified:${index}:old` })
      }
    })
    return next
  }, [collapsedHunks, lineMetadata, lines, mode])
  const focusableDiffLine = selectableDiffLines.find((line) => activeDiffFocusId !== null && line.focusId === activeDiffFocusId) ??
    selectableDiffLines.find((line) => selectedLine !== null && sameDiffLine(line, selectedLine)) ??
    selectableDiffLines[0] ??
    null
  const isFocusableDiffLine = useCallback((focusId: string | undefined): boolean =>
    focusId !== undefined && focusableDiffLine !== null && focusableDiffLine.focusId === focusId, [focusableDiffLine])
  const focusDiffLine = useCallback((line: SelectedDiffLine & { focusId: string }): void => {
    const lineSelector = `[data-review-diff-focus-id="${line.focusId}"]`
    const target =
      diffSearchContainerRef.current?.querySelector<HTMLElement>(`${lineSelector}[data-review-line-focusable="true"]`) ??
      diffSearchContainerRef.current?.querySelector<HTMLElement>(lineSelector)
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    target?.focus({ preventScroll: true })
  }, [])
  const navigateDiffLine = useCallback((currentLine: SelectedDiffLine | null, currentFocusId: string | undefined, key: string): void => {
    if (selectableDiffLines.length === 0) return
    const currentIndex = currentFocusId !== undefined
      ? selectableDiffLines.findIndex((line) => line.focusId === currentFocusId)
      : currentLine === null
        ? selectableDiffLines.findIndex((line) => focusableDiffLine !== null && line.focusId === focusableDiffLine.focusId)
      : selectableDiffLines.findIndex((line) => sameDiffLine(line, currentLine))
    const fallbackIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? selectableDiffLines.length - 1
        : key === 'ArrowUp'
          ? Math.max(0, fallbackIndex - 1)
          : key === 'ArrowDown'
            ? Math.min(selectableDiffLines.length - 1, fallbackIndex + 1)
            : fallbackIndex
    const nextLine = selectableDiffLines[nextIndex]
    flushSync(() => {
      setActiveDiffFocusId(nextLine.focusId)
      setSelectedLine({ side: nextLine.side, lineNumber: nextLine.lineNumber })
    })
    focusDiffLine(nextLine)
  }, [focusDiffLine, focusableDiffLine, selectableDiffLines])
  useEffect(() => {
    setSelectedLine(null)
    setActiveDiffFocusId(null)
    onCommentsChange((current) => current.filter((comment) => comment.status === 'provider'))
    setBlameVisible(false)
    setLineBlame(null)
    setLineBlameByLine(new Map())
    setCollapsedHunks(new Set())
    setLargeDiffExpanded(false)
    setExpandedHiddenContext(new Set())
    setHiddenContextSource(null)
    setHiddenContextLoading(null)
    setConflictActionStatus(null)
    setConflictActionError(null)
  }, [diff])
  useEffect(() => {
    if (!conflicted) {
      setConflictSourceText(null)
      setConflictActionStatus(null)
      setConflictActionError(null)
      return
    }
    let cancelled = false
    window.api.fs.readFile(absolutePath)
      .then((text) => {
        if (!cancelled) setConflictSourceText(text ?? '')
      })
      .catch(() => {
        if (!cancelled) setConflictSourceText('')
      })
    return () => {
      cancelled = true
    }
  }, [absolutePath, conflicted, diff])
  useEffect(() => {
    if (activeSearchMatchIndex === null) return
    const activeLine = diffSearchContainerRef.current?.querySelector<HTMLElement>('[data-review-search-active-line="true"]')
    activeLine?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [activeSearchMatchIndex, diffSearchState.activeLineVisible, mode])
  useEffect(() => {
    setLineBlame(null)
    if (!blameVisible || selectedLine === null) return
    if (selectedLine.side !== 'new') {
      setLineBlame({ ok: false, path: filePath, line: selectedLine.lineNumber, error: 'Blame is only available for current-file lines' })
      return
    }
    let cancelled = false
    window.api.git.blameLine(workDir, filePath, selectedLine.lineNumber)
      .then((result) => {
        if (!cancelled) {
          setLineBlame(result)
          setLineBlameByLine((current) => new Map(current).set(selectedLine.lineNumber, result))
        }
      })
      .catch(() => {
        if (!cancelled) {
          const result = { ok: false, path: filePath, line: selectedLine.lineNumber, error: 'Blame unavailable' }
          setLineBlame(result)
          setLineBlameByLine((current) => new Map(current).set(selectedLine.lineNumber, result))
        }
      })
    return () => {
      cancelled = true
    }
  }, [blameVisible, filePath, selectedLine?.lineNumber, selectedLine?.side, workDir])
  useEffect(() => {
    if (!blameVisible || blameLineNumbers.length === 0) return
    const missingLines = blameLineNumbers.filter((lineNumber) => !lineBlameByLine.has(lineNumber))
    if (missingLines.length === 0) return
    let cancelled = false
    Promise.all(missingLines.map((lineNumber) =>
      window.api.git.blameLine(workDir, filePath, lineNumber)
        .catch(() => ({ ok: false, path: filePath, line: lineNumber, error: 'Blame unavailable' }))
    )).then((results) => {
      if (cancelled) return
      setLineBlameByLine((current) => {
        const next = new Map(current)
        results.forEach((result) => next.set(result.line, result))
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [blameVisible, blameLineNumbers, filePath, lineBlameByLine, workDir])
  const blameResultForLine = (lineNumberSide?: 'old' | 'new', lineNumber?: number): GitLineBlameResult | null => {
    if (lineNumberSide !== 'new' || lineNumber === undefined) return lineBlame
    if (selectedLine?.side === 'new' && selectedLine.lineNumber === lineNumber && lineBlame !== null) return lineBlame
    return lineBlameByLine.get(lineNumber) ?? null
  }
  const selectedCurrentLine = selectedLine?.side === 'new'
    ? reviewDiffSelectedCurrentLine(lines, lineMetadata, selectedLine.lineNumber)
    : null
  const selectedCurrentLineReference = selectedCurrentLine ? `${filePath}:${selectedCurrentLine.lineNumber}` : ''
  const writeDiffClipboardText = async (text: string): Promise<void> => {
    if (typeof window.api.clipboard?.writeText === 'function') {
      const didWrite = await window.api.clipboard.writeText(text)
      if (!didWrite) throw new Error('Clipboard write failed')
      return
    }
    await navigator.clipboard.writeText(text)
  }
  const copySelectedCurrentLineReference = (): void => {
    if (!selectedCurrentLine) return
    setCopiedSelectedLineReference(selectedCurrentLineReference)
    setSelectedLineActionStatus('Copying line reference')
    void writeDiffClipboardText(selectedCurrentLineReference)
      .then(() => setSelectedLineActionStatus('Line reference copied'))
      .catch(() => setSelectedLineActionStatus('Copy failed'))
  }
  const addSelectedCurrentLineToChat = (): void => {
    if (!selectedCurrentLine) return
    setAddedSelectedLineReference(selectedCurrentLineReference)
    setSelectedLineActionStatus('Added selected line to chat')
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: {
        text: `Review line ${selectedCurrentLineReference}:\n\n\`\`\`\n${selectedCurrentLine.text}\n\`\`\``
      }
    }))
  }
  const selectedLineActions = selectedLine !== null ? (
    <div
      className="review-diff-selected-line-actions"
      data-testid="review-diff-selected-line-actions"
      data-review-selected-line-actions-for={`${selectedLine.side}:${selectedLine.lineNumber}`}
      data-review-selected-line-action-status={selectedLineActionStatus}
      data-review-selected-line-reference={selectedCurrentLineReference}
      data-review-selected-line-copied-reference={copiedSelectedLineReference}
      data-review-selected-line-added-reference={addedSelectedLineReference}
    >
      <span className="review-diff-selected-line-label">
        {selectedLine.side === 'new' ? 'Current' : 'Previous'} L{selectedLine.lineNumber}
      </span>
      <IconButton
        icon="copy"
        label="Copy selected line reference"
        size="sm"
        variant="toolbar"
        disabled={!selectedCurrentLine}
        dataTestId="review-diff-line-copy-reference"
        onClick={copySelectedCurrentLineReference}
      />
      <IconButton
        icon="chat"
        label="Add selected line to chat"
        size="sm"
        variant="toolbar"
        disabled={!selectedCurrentLine}
        dataTestId="review-diff-line-add-chat"
        onClick={addSelectedCurrentLineToChat}
      />
      <IconButton
        icon="file"
        label="Open selected line in Workbench"
        size="sm"
        variant="toolbar"
        disabled={selectedLine.side !== 'new'}
        dataTestId="review-diff-line-open-workbench"
        onClick={() => {
          if (selectedLine.side === 'new') onOpenFileLine(selectedLine.lineNumber)
        }}
      />
      <IconButton
        icon="branch"
        label={blameVisible ? 'Hide review blame' : 'Show review blame'}
        size="sm"
        variant="toolbar"
        active={blameVisible && selectedLine.side === 'new'}
        disabled={selectedLine.side !== 'new'}
        dataTestId="review-diff-line-toggle-blame"
        onClick={() => setBlameVisible((visible) => !visible)}
      />
      {selectedLineActionStatus && (
        <span className="review-diff-selected-line-status" role="status" aria-live="polite" aria-atomic="true">
          {selectedLineActionStatus}
        </span>
      )}
    </div>
  ) : null
  const selectLine = (line: SelectedDiffLine | null, focusId?: string): void => {
    setActiveDiffFocusId(focusId ?? null)
    setSelectedLine((current) => {
      if (line !== null && current?.side === line.side && current.lineNumber === line.lineNumber) return null
      return line
    })
  }
  const toggleHunk = (hunkIndex: number): void => {
    setCollapsedHunks((current) => {
      const next = new Set(current)
      if (next.has(hunkIndex)) {
        next.delete(hunkIndex)
      } else {
        next.add(hunkIndex)
      }
      return next
    })
  }
  const loadHiddenContextSource = (loadingKey: string): void => {
    if (hiddenContextSource !== null || hiddenContextLoading !== null) return
    setHiddenContextLoading(loadingKey)
    window.api.fs.readFile(joinPath(workDir, filePath))
      .then((text) => setHiddenContextSource(text))
      .catch(() => setHiddenContextSource(''))
      .finally(() => setHiddenContextLoading(null))
  }
  const toggleHiddenContext = (segment: HiddenContextSegment): void => {
    setExpandedHiddenContext((current) => {
      const next = new Set(current)
      if (next.has(segment.key)) {
        next.delete(segment.key)
        return next
      }
      next.add(segment.key)
      return next
    })
    if (!expandedHiddenContext.has(segment.key)) loadHiddenContextSource(segment.key)
  }
  const toggleAllHiddenContext = (): void => {
    if (allHiddenContextExpanded) {
      setExpandedHiddenContext(new Set())
      return
    }
    setExpandedHiddenContext(new Set(hiddenContextSegments.map((segment) => segment.key)))
    loadHiddenContextSource('all')
  }
  const hiddenContextRows = (
    segment: HiddenContextSegment,
    renderMode: ReviewDiffMode
  ): JSX.Element[] => {
    if (!expandedHiddenContext.has(segment.key)) return []
    return Array.from({ length: segment.count }, (_, index) => {
      const oldLine = segment.oldStart + index
      const newLine = segment.newStart + index
      const oldFocusId = `hidden:${segment.key}:${index}:old`
      const newFocusId = `hidden:${segment.key}:${index}:new`
      const text = hiddenContextSourceLines[newLine - 1] ?? ''
      if (renderMode === 'split') {
        return (
          <div
            key={`${segment.key}:line:${index}`}
            className="review-split-diff-row"
            data-line-type="context"
            data-review-expanded-context-line="true"
          >
            <DiffLineCell
              value={` ${text}`}
              type="context"
              wrap={wrap}
              side="left"
              lineNumber={oldLine}
              lineNumberSide="old"
              selectedLine={selectedLine}
              focusId={oldFocusId}
              focusable={isFocusableDiffLine(oldFocusId)}
              onSelectLine={selectLine}
              onNavigateLine={navigateDiffLine}
              comments={commentsForLine('old', oldLine)}
              onAddComment={addComment}
              onUpdateComment={updateComment}
              onSaveComment={saveComment}
              onDeleteComment={deleteComment}
              blameVisible={blameVisible}
              blameResult={blameResultForLine('old', oldLine)}
            />
            <DiffLineCell
              value={` ${text}`}
              type="context"
              wrap={wrap}
              side="right"
              lineNumber={newLine}
              lineNumberSide="new"
              selectedLine={selectedLine}
              focusId={newFocusId}
              focusable={isFocusableDiffLine(newFocusId)}
              onSelectLine={selectLine}
              onNavigateLine={navigateDiffLine}
              comments={commentsForLine('new', newLine)}
              onAddComment={addComment}
              onUpdateComment={updateComment}
              onSaveComment={saveComment}
              onDeleteComment={deleteComment}
              blameVisible={blameVisible}
              blameResult={blameResultForLine('new', newLine)}
            />
          </div>
        )
      }
      return (
        <DiffLineCell
          key={`${segment.key}:line:${index}`}
          value={` ${text}`}
          type="context"
          wrap={wrap}
          lineNumber={newLine}
          lineNumberSide="new"
          selectedLine={selectedLine}
          focusId={newFocusId}
          focusable={isFocusableDiffLine(newFocusId)}
          onSelectLine={selectLine}
          onNavigateLine={navigateDiffLine}
          comments={commentsForLine('new', newLine)}
          onAddComment={addComment}
          onUpdateComment={updateComment}
          onSaveComment={saveComment}
          onDeleteComment={deleteComment}
          blameVisible={blameVisible}
          blameResult={blameResultForLine('new', newLine)}
          wordParts={undefined}
        />
      )
    })
  }
  const addComment = (line: SelectedDiffLine | null): void => {
    if (line === null) return
    const existing = comments.find((comment) => comment.status !== 'provider' && sameDiffLine(comment, line))
    if (existing) {
      onCommentsChange((current) => current.map((comment) =>
        comment.id === existing.id ? { ...comment, status: 'draft', updatedAt: Date.now() } : comment
      ))
      return
    }
    onCommentsChange((current) => [
      ...current,
      {
        id: `review-comment-${line.side}-${line.lineNumber}-${Date.now()}`,
        side: line.side,
        lineNumber: line.lineNumber,
        body: '',
        status: 'draft',
        updatedAt: Date.now()
      }
    ])
  }
  const updateComment = (id: string, body: string): void => {
    onCommentsChange((current) => current.map((comment) =>
      comment.id === id ? { ...comment, body, updatedAt: Date.now() } : comment
    ))
  }
  const saveComment = (id: string): void => {
    onCommentsChange((current) => current.flatMap((comment) => {
      if (comment.id !== id) return [comment]
      const body = comment.body.trim()
      return body.length === 0 ? [] : [{ ...comment, body, status: 'saved' as const, updatedAt: Date.now() }]
    }))
  }
  const deleteComment = (id: string): void => {
    onCommentsChange((current) => current.filter((comment) => comment.id !== id))
  }
  const copySuggestion = async (comment: ReviewDiffComment, suggestion: ReviewSuggestionBlock): Promise<void> => {
    setSuggestionStatusById((current) => ({ ...current, [comment.id]: 'applying' }))
    try {
      await writeClipboardText(suggestion.text)
      setSuggestionStatusById((current) => ({ ...current, [comment.id]: 'copied' }))
    } catch {
      setSuggestionStatusById((current) => ({ ...current, [comment.id]: 'failed' }))
    }
  }
  const applySuggestion = async (comment: ReviewDiffComment, suggestion: ReviewSuggestionBlock): Promise<void> => {
    if (!canApplyReviewSuggestion(comment)) return
    setSuggestionStatusById((current) => ({ ...current, [comment.id]: 'applying' }))
    try {
      const currentText = await window.api.fs.readFile(absolutePath)
      const nextText = applyReviewSuggestionToText(currentText ?? '', comment, suggestion.text)
      await window.api.fs.writeFile(absolutePath, nextText)
      await onConflictResolved()
      setSuggestionStatusById((current) => ({ ...current, [comment.id]: 'applied' }))
    } catch {
      setSuggestionStatusById((current) => ({ ...current, [comment.id]: 'failed' }))
    }
  }
  const commentsForLine = (lineNumberSide?: 'old' | 'new', lineNumber?: number): ReviewDiffComment[] => {
    if (lineNumberSide === undefined || lineNumber === undefined) return []
    return comments.filter((comment) => comment.side === lineNumberSide && comment.lineNumber === lineNumber)
  }
  const mergeConflictHelperForLine = (
    line: string,
    metadata: DiffLineMetadata | undefined,
    index: number
  ): ReviewMergeConflictHelper | undefined => {
    if (!conflicted || metadata?.newLine === undefined || !line.startsWith('+<<<<<<<')) return undefined
    const block = conflictBlockByStartLine.get(metadata.newLine)
    if (block === undefined) return undefined
    const slotId = `merge-conflict-action-${metadata.hunkIndex ?? 0}-${index}-${block.index}`
    return {
      block,
      slotId,
      activeAction: conflictActionStatus?.startsWith(`${block.index}:`) === true ? conflictActionStatus : null,
      error: conflictActionError,
      onResolve: (resolution) => applyMergeConflictResolution(block, resolution)
    }
  }
  const applyMergeConflictResolution = async (
    block: MergeConflictBlock,
    resolution: MergeConflictResolution
  ): Promise<void> => {
    const actionKey = `${block.index}:${resolution}`
    setConflictActionStatus(actionKey)
    setConflictActionError(null)
    try {
      const currentText = await window.api.fs.readFile(absolutePath)
      const result = resolveMergeConflictBlock(currentText ?? '', block, resolution)
      if (result === null) throw new Error('Conflict block not found')
      await window.api.fs.writeFile(absolutePath, result)
      setConflictSourceText(result)
      await onConflictResolved()
    } catch (error) {
      setConflictActionError(error instanceof Error ? error.message : 'Conflict action failed')
    } finally {
      setConflictActionStatus(null)
    }
  }
  if (!expanded) {
    return <CollapsedDiffLines lines={lines} mode={mode} hiddenWhitespaceChanges={hiddenWhitespaceChanges} />
  }
  if (mode === 'split') {
    return (
      <div
        ref={diffSearchContainerRef}
        className="review-split-diff min-w-0"
        data-testid="review-split-diff"
        data-review-diff-search-query={searchQuery.trim()}
        data-review-diff-search-match-count={diffSearchState.totalMatches}
        data-review-diff-search-active-match={activeSearchMatchIndex ?? ''}
        data-review-diff-search-active-visible={diffSearchState.activeLineVisible ? 'true' : 'false'}
        data-review-hidden-whitespace-count={hiddenWhitespaceChanges}
        data-review-word-diff-count={wordDiffParts.count}
        data-review-comment-count={comments.length}
        data-review-blame-visible={blameVisible ? 'true' : 'false'}
        data-review-blame-line={blameVisible && selectedLine?.side === 'new' ? selectedLine.lineNumber : ''}
        data-review-hidden-context-count={hiddenContextSegments.length}
        data-review-expanded-context-count={expandedHiddenContextLineCount}
        data-review-large-diff={renderWindow.totalLineCount > renderWindow.renderedLineCount ? 'true' : 'false'}
        data-review-large-diff-total-lines={renderWindow.totalLineCount}
        data-review-large-diff-rendered-lines={renderWindow.renderedLineCount}
        data-review-large-diff-changed-lines={renderWindow.changedLineCount}
        data-review-large-diff-changed-bytes={renderWindow.changedBytes}
        data-review-large-diff-max-line-bytes={renderWindow.maxChangedLineBytes}
        data-review-large-diff-expanded={largeDiffExpanded ? 'true' : 'false'}
        data-review-diff-keyboard-navigation="roving"
        data-review-merge-conflict-count={conflictBlocks.length}
        style={{ fontSize: 11, userSelect: 'text' }}
      >
        {selectedLineActions}
        {hiddenWhitespaceChanges > 0 && <WhitespaceHiddenNotice count={hiddenWhitespaceChanges} />}
        {hiddenContextSegments.length > 1 && (
          <HiddenContextSummaryControls
            expanded={allHiddenContextExpanded}
            loading={hiddenContextLoading === 'all'}
            segmentCount={hiddenContextSegments.length}
            totalLineCount={totalHiddenContextLineCount}
            expandedLineCount={expandedHiddenContextLineCount}
            onToggle={toggleAllHiddenContext}
          />
        )}
        {lines.map((line, i) => {
          const type = diffLineType(line)
          const metadata = lineMetadata[i]
          const hunkIndex = metadata?.hunkIndex
          if (type === 'hunk' && hunkIndex !== undefined) {
            const hunkCollapsed = collapsedHunks.has(hunkIndex)
            const hiddenContext = hiddenContextByHunk.get(hunkIndex)
            return (
              <>
                {hiddenContext !== undefined && (
                  <>
                    <div
                      key={`${hiddenContext.key}:toggle`}
                      className="review-split-diff-row"
                      data-line-type="hidden-context"
                    >
                      <HiddenContextToggle
                        segment={hiddenContext}
                        expanded={expandedHiddenContext.has(hiddenContext.key)}
                        loading={hiddenContextLoading === hiddenContext.key}
                        onToggle={toggleHiddenContext}
                      />
                    </div>
                    {hiddenContextRows(hiddenContext, mode)}
                  </>
                )}
                <div
                  key={i}
                  className="review-split-diff-row"
                  data-line-type={type}
                  data-review-hunk-index={hunkIndex}
                  data-review-hunk-collapsed={hunkCollapsed ? 'true' : 'false'}
                >
                  <HunkHeaderCell
                    line={line}
                    mode={mode}
                    hunkIndex={hunkIndex}
                    collapsed={hunkCollapsed}
                    hiddenLineCount={hunkSummaries.get(hunkIndex)?.changedLineCount ?? 0}
                    onToggle={toggleHunk}
                  />
                </div>
              </>
            )
          }
          if (hunkIndex !== undefined && collapsedHunks.has(hunkIndex)) return null
          const left = type === 'addition' ? '' : line
          const right = type === 'deletion' ? '' : line
          const leftFocusId = left ? `split:${i}:old` : undefined
          const rightFocusId = right ? `split:${i}:new` : undefined
          const conflictHelper = mergeConflictHelperForLine(line, metadata, i)
          const searchLineState = diffSearchState.byLine.get(i)
          return (
            <div
              key={i}
              className="review-split-diff-row"
              data-line-type={type}
            >
              <DiffLineCell
                value={left}
                type={type === 'addition' ? 'context' : type}
                wrap={wrap}
                side="left"
                lineNumber={left ? metadata?.oldLine : undefined}
                lineNumberSide="old"
                selectedLine={selectedLine}
                focusId={leftFocusId}
                focusable={isFocusableDiffLine(leftFocusId)}
                onSelectLine={selectLine}
                onNavigateLine={navigateDiffLine}
                comments={left ? commentsForLine('old', metadata?.oldLine) : []}
                onAddComment={addComment}
                onUpdateComment={updateComment}
                onSaveComment={saveComment}
                onDeleteComment={deleteComment}
                suggestionStatusById={suggestionStatusById}
                onCopySuggestion={copySuggestion}
                onApplySuggestion={applySuggestion}
                blameVisible={blameVisible}
                blameResult={blameResultForLine('old', left ? metadata?.oldLine : undefined)}
                wordParts={left ? wordDiffParts.byLine.get(i) : undefined}
                searchMatch={left ? searchLineState : undefined}
              />
              <DiffLineCell
                value={right}
                type={type === 'deletion' ? 'context' : type}
                wrap={wrap}
                side="right"
                lineNumber={right ? metadata?.newLine : undefined}
                lineNumberSide="new"
                selectedLine={selectedLine}
                focusId={rightFocusId}
                focusable={isFocusableDiffLine(rightFocusId)}
                onSelectLine={selectLine}
                onNavigateLine={navigateDiffLine}
                comments={right ? commentsForLine('new', metadata?.newLine) : []}
                onAddComment={addComment}
                onUpdateComment={updateComment}
                onSaveComment={saveComment}
                onDeleteComment={deleteComment}
                suggestionStatusById={suggestionStatusById}
                onCopySuggestion={copySuggestion}
                onApplySuggestion={applySuggestion}
                blameVisible={blameVisible}
                blameResult={blameResultForLine('new', right ? metadata?.newLine : undefined)}
                wordParts={right ? wordDiffParts.byLine.get(i) : undefined}
                conflictHelper={conflictHelper}
                searchMatch={right ? searchLineState : undefined}
              />
            </div>
          )
        })}
        {renderWindow.limited && (
          <LargeDiffNotice
            totalLineCount={renderWindow.totalLineCount}
            renderedLineCount={renderWindow.renderedLineCount}
            onShowFull={() => setLargeDiffExpanded(true)}
          />
        )}
      </div>
    )
  }
  return (
    <div
      ref={diffSearchContainerRef}
      className="px-2 py-1 min-w-0"
      data-testid="review-unified-diff"
      data-review-diff-search-query={searchQuery.trim()}
      data-review-diff-search-match-count={diffSearchState.totalMatches}
      data-review-diff-search-active-match={activeSearchMatchIndex ?? ''}
      data-review-diff-search-active-visible={diffSearchState.activeLineVisible ? 'true' : 'false'}
      data-review-hidden-whitespace-count={hiddenWhitespaceChanges}
      data-review-word-diff-count={wordDiffParts.count}
      data-review-comment-count={comments.length}
      data-review-blame-visible={blameVisible ? 'true' : 'false'}
      data-review-blame-line={blameVisible && selectedLine?.side === 'new' ? selectedLine.lineNumber : ''}
      data-review-hidden-context-count={hiddenContextSegments.length}
      data-review-expanded-context-count={expandedHiddenContextLineCount}
      data-review-large-diff={renderWindow.totalLineCount > renderWindow.renderedLineCount ? 'true' : 'false'}
      data-review-large-diff-total-lines={renderWindow.totalLineCount}
      data-review-large-diff-rendered-lines={renderWindow.renderedLineCount}
      data-review-large-diff-changed-lines={renderWindow.changedLineCount}
      data-review-large-diff-changed-bytes={renderWindow.changedBytes}
      data-review-large-diff-max-line-bytes={renderWindow.maxChangedLineBytes}
      data-review-large-diff-expanded={largeDiffExpanded ? 'true' : 'false'}
      data-review-diff-keyboard-navigation="roving"
      data-review-merge-conflict-count={conflictBlocks.length}
      style={{ fontSize: 11, userSelect: 'text' }}
    >
      {selectedLineActions}
      {hiddenWhitespaceChanges > 0 && <WhitespaceHiddenNotice count={hiddenWhitespaceChanges} />}
      {hiddenContextSegments.length > 1 && (
        <HiddenContextSummaryControls
          expanded={allHiddenContextExpanded}
          loading={hiddenContextLoading === 'all'}
          segmentCount={hiddenContextSegments.length}
          totalLineCount={totalHiddenContextLineCount}
          expandedLineCount={expandedHiddenContextLineCount}
          onToggle={toggleAllHiddenContext}
        />
      )}
      {lines.map((line, i) => {
        const type = diffLineType(line)
        const metadata = lineMetadata[i]
        const hunkIndex = metadata?.hunkIndex
        if (type === 'hunk' && hunkIndex !== undefined) {
          const hunkCollapsed = collapsedHunks.has(hunkIndex)
          const hiddenContext = hiddenContextByHunk.get(hunkIndex)
          return (
            <>
              {hiddenContext !== undefined && (
                <>
                  <HiddenContextToggle
                    key={`${hiddenContext.key}:toggle`}
                    segment={hiddenContext}
                    expanded={expandedHiddenContext.has(hiddenContext.key)}
                    loading={hiddenContextLoading === hiddenContext.key}
                    onToggle={toggleHiddenContext}
                  />
                  {hiddenContextRows(hiddenContext, mode)}
                </>
              )}
              <HunkHeaderCell
                key={i}
                line={line}
                mode={mode}
                hunkIndex={hunkIndex}
                collapsed={hunkCollapsed}
                hiddenLineCount={hunkSummaries.get(hunkIndex)?.changedLineCount ?? 0}
                onToggle={toggleHunk}
              />
            </>
          )
        }
        if (hunkIndex !== undefined && collapsedHunks.has(hunkIndex)) return null
        const lineFocusId = metadata?.newLine !== undefined
          ? `unified:${i}:new`
          : metadata?.oldLine !== undefined
            ? `unified:${i}:old`
            : undefined
        const conflictHelper = mergeConflictHelperForLine(line, metadata, i)
        const searchLineState = diffSearchState.byLine.get(i)
        return (
          <DiffLineCell
            key={i}
            value={line}
            type={type}
            wrap={wrap}
            lineNumber={metadata?.newLine ?? metadata?.oldLine}
            lineNumberSide={metadata?.newLine !== undefined ? 'new' : metadata?.oldLine !== undefined ? 'old' : undefined}
            selectedLine={selectedLine}
            focusId={lineFocusId}
            focusable={isFocusableDiffLine(lineFocusId)}
            onSelectLine={selectLine}
            onNavigateLine={navigateDiffLine}
            comments={commentsForLine(
              metadata?.newLine !== undefined ? 'new' : metadata?.oldLine !== undefined ? 'old' : undefined,
              metadata?.newLine ?? metadata?.oldLine
            )}
            onAddComment={addComment}
            onUpdateComment={updateComment}
            onSaveComment={saveComment}
            onDeleteComment={deleteComment}
            suggestionStatusById={suggestionStatusById}
            onCopySuggestion={copySuggestion}
            onApplySuggestion={applySuggestion}
            blameVisible={blameVisible}
            blameResult={blameResultForLine(
              metadata?.newLine !== undefined ? 'new' : metadata?.oldLine !== undefined ? 'old' : undefined,
              metadata?.newLine ?? metadata?.oldLine
            )}
            wordParts={wordDiffParts.byLine.get(i)}
            conflictHelper={conflictHelper}
            searchMatch={searchLineState}
          />
        )
      })}
      {renderWindow.limited && (
        <LargeDiffNotice
          totalLineCount={renderWindow.totalLineCount}
          renderedLineCount={renderWindow.renderedLineCount}
          onShowFull={() => setLargeDiffExpanded(true)}
        />
      )}
    </div>
  )
}

function HunkHeaderCell({
  line,
  mode,
  hunkIndex,
  collapsed,
  hiddenLineCount,
  onToggle
}: {
  line: string
  mode: ReviewDiffMode
  hunkIndex: number
  collapsed: boolean
  hiddenLineCount: number
  onToggle: (hunkIndex: number) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="review-diff-hunk-header"
      data-testid="review-hunk-toggle"
      data-review-hunk-index={hunkIndex}
      data-review-hunk-collapsed={collapsed ? 'true' : 'false'}
      data-review-hunk-mode={mode}
      data-separator="line-info-basic"
      data-expand-index=""
      aria-expanded={collapsed ? 'false' : 'true'}
      onClick={() => onToggle(hunkIndex)}
    >
      <span className="review-diff-hunk-wrapper" data-separator-wrapper="">
        <span className="review-diff-hunk-expand" data-expand-button="">
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
        </span>
        <span className="review-diff-hunk-label" data-separator-content="">
          <span className="review-diff-hunk-range">{line}</span>
          {collapsed && (
            <span className="review-diff-hunk-summary">
              {hiddenLineCount} {hiddenLineCount === 1 ? 'changed line' : 'changed lines'} hidden
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function HiddenContextSummaryControls({
  expanded,
  loading,
  segmentCount,
  totalLineCount,
  expandedLineCount,
  onToggle
}: {
  expanded: boolean
  loading: boolean
  segmentCount: number
  totalLineCount: number
  expandedLineCount: number
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="review-hidden-context-expand-all"
      data-testid="review-hidden-context-expand-all"
      data-review-hidden-context-segments={segmentCount}
      data-review-hidden-context-total-count={totalLineCount}
      data-review-expanded-context-count={expandedLineCount}
      data-review-context-expanded={expanded ? 'true' : 'false'}
      data-review-context-loading={loading ? 'true' : 'false'}
      data-separator="line-info-basic"
      data-expand-index=""
      aria-expanded={expanded ? 'true' : 'false'}
      onClick={onToggle}
    >
      <span className="review-hidden-context-wrapper" data-separator-wrapper="">
        <span className="review-hidden-context-expand" data-expand-button="">
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
        </span>
        <span className="review-hidden-context-label" data-separator-content="">
          <span>{expanded ? 'Hide all' : 'Show all'} hidden context</span>
          <span className="review-hidden-context-status">{totalLineCount} {totalLineCount === 1 ? 'line' : 'lines'}</span>
          {loading && <span className="review-hidden-context-status">Loading</span>}
        </span>
      </span>
    </button>
  )
}

function HiddenContextToggle({
  segment,
  expanded,
  loading,
  onToggle
}: {
  segment: HiddenContextSegment
  expanded: boolean
  loading: boolean
  onToggle: (segment: HiddenContextSegment) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="review-hidden-context-toggle"
      data-testid="review-hidden-context-toggle"
      data-review-context-key={segment.key}
      data-review-context-expanded={expanded ? 'true' : 'false'}
      data-review-context-loading={loading ? 'true' : 'false'}
      data-review-context-start-line={segment.newStart}
      data-review-hidden-context-count={segment.count}
      data-separator="line-info-basic"
      data-expand-index=""
      aria-expanded={expanded ? 'true' : 'false'}
      onClick={() => onToggle(segment)}
    >
      <span className="review-hidden-context-wrapper" data-separator-wrapper="">
        <span className="review-hidden-context-expand" data-expand-button="">
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
        </span>
        <span className="review-hidden-context-label" data-separator-content="">
          <span>{expanded ? 'Hide' : 'Show'} {segment.count} unchanged {segment.count === 1 ? 'line' : 'lines'}</span>
          {loading && <span className="review-hidden-context-status">Loading</span>}
        </span>
      </span>
    </button>
  )
}

function CollapsedDiffLines({
  lines,
  mode,
  hiddenWhitespaceChanges
}: {
  lines: string[]
  mode: ReviewDiffMode
  hiddenWhitespaceChanges: number
}): JSX.Element {
  const hunkLines = lines.filter((line) => line.startsWith('@@'))
  const changedLineCount = lines.filter((line) => line.startsWith('+') || line.startsWith('-')).length
  const collapsedRows = hunkLines.length > 0 ? hunkLines : ['Diff collapsed']
  return (
    <div
      className="review-collapsed-diff"
      data-testid="review-collapsed-diff"
      data-review-collapsed-mode={mode}
    >
      {collapsedRows.map((line, index) => (
        <div key={`${line}-${index}`} className="review-collapsed-diff-row">
          <span className="review-collapsed-diff-hunk">{line}</span>
          <span className="review-collapsed-diff-summary">
            {changedLineCount} {changedLineCount === 1 ? 'changed line' : 'changed lines'} hidden
            {hiddenWhitespaceChanges > 0 ? `, ${hiddenWhitespaceChanges} whitespace-only ${hiddenWhitespaceChanges === 1 ? 'change' : 'changes'} hidden` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function WhitespaceHiddenNotice({ count }: { count: number }): JSX.Element {
  return (
    <div className="review-whitespace-hidden-notice" data-testid="review-whitespace-hidden-notice">
      {count} whitespace-only {count === 1 ? 'change' : 'changes'} hidden
    </div>
  )
}

function LargeDiffNotice({
  totalLineCount,
  renderedLineCount,
  onShowFull
}: {
  totalLineCount: number
  renderedLineCount: number
  onShowFull: () => void
}): JSX.Element {
  return (
    <PanelNotice
      icon={<Icon name="diff" size={16} />}
      title="Large diff limited"
      description={`Showing ${renderedLineCount.toLocaleString()} of ${totalLineCount.toLocaleString()} diff rows to keep Review responsive.`}
      tone="muted"
      dataTestId="review-large-diff-notice"
      state="large-diff-limited"
      className="review-large-diff-notice"
      actions={(
        <Button
          variant="secondary"
          dataTestId="review-large-diff-show-full"
          onClick={onShowFull}
        >
          Show full diff
        </Button>
      )}
    />
  )
}

function hideWhitespaceOnlyChanges(lines: string[], enabled: boolean): { lines: string[]; hiddenWhitespaceChanges: number } {
  if (!enabled) return { lines, hiddenWhitespaceChanges: 0 }
  const filtered: string[] = []
  let hiddenWhitespaceChanges = 0
  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (!line.startsWith('-')) {
      filtered.push(line)
      index += 1
      continue
    }
    const deletions: string[] = []
    while (index < lines.length && lines[index].startsWith('-')) {
      deletions.push(lines[index])
      index += 1
    }
    const additions: string[] = []
    const additionStart = index
    while (index < lines.length && lines[index].startsWith('+')) {
      additions.push(lines[index])
      index += 1
    }
    if (additions.length > 0 && whitespaceBlocksMatch(deletions, additions)) {
      hiddenWhitespaceChanges += Math.max(deletions.length, additions.length)
      continue
    }
    filtered.push(...deletions)
    if (additions.length > 0) {
      filtered.push(...additions)
    } else {
      index = additionStart
    }
  }
  return { lines: filtered, hiddenWhitespaceChanges }
}

function whitespaceBlocksMatch(deletions: string[], additions: string[]): boolean {
  if (deletions.length !== additions.length) return false
  return deletions.every((line, index) => normalizeWhitespaceForDiff(line.slice(1)) === normalizeWhitespaceForDiff(additions[index].slice(1)))
}

function normalizeWhitespaceForDiff(value: string): string {
  return value.replace(/\s+/g, '')
}

function DiffLineCell({
  value,
  type,
  wrap,
  side,
  lineNumber,
  lineNumberSide,
  selectedLine,
  focusId,
  focusable,
  onSelectLine,
  onNavigateLine,
  comments,
  onAddComment,
  onUpdateComment,
  onSaveComment,
  onDeleteComment,
  suggestionStatusById = {},
  onCopySuggestion,
  onApplySuggestion,
  blameVisible,
  blameResult,
  wordParts,
  conflictHelper,
  searchMatch
}: {
  value: string
  type: 'addition' | 'deletion' | 'hunk' | 'context'
  wrap: boolean
  side?: 'left' | 'right'
  lineNumber?: number
  lineNumberSide?: 'old' | 'new'
  selectedLine: SelectedDiffLine | null
  focusId?: string
  focusable: boolean
  onSelectLine: (line: SelectedDiffLine | null, focusId?: string) => void
  onNavigateLine: (line: SelectedDiffLine | null, focusId: string | undefined, key: string) => void
  comments: ReviewDiffComment[]
  onAddComment: (line: SelectedDiffLine | null) => void
  onUpdateComment: (id: string, body: string) => void
  onSaveComment: (id: string) => void
  onDeleteComment: (id: string) => void
  suggestionStatusById?: Record<string, ReviewSuggestionStatus>
  onCopySuggestion?: (comment: ReviewDiffComment, suggestion: ReviewSuggestionBlock) => void | Promise<void>
  onApplySuggestion?: (comment: ReviewDiffComment, suggestion: ReviewSuggestionBlock) => void | Promise<void>
  blameVisible: boolean
  blameResult: GitLineBlameResult | null
  wordParts?: WordDiffPart[]
  conflictHelper?: ReviewMergeConflictHelper
  searchMatch?: DiffSearchLineState
}): JSX.Element {
  const color = type === 'addition'
    ? 'var(--text-primary)'
    : type === 'deletion'
      ? 'var(--text-primary)'
      : type === 'hunk'
        ? '#60a5fa'
        : 'var(--text-secondary)'
  const bg = type === 'addition'
    ? 'color-mix(in srgb, var(--surface-bg) 88%, var(--color-green))'
    : type === 'deletion'
      ? 'color-mix(in srgb, var(--surface-bg) 88%, var(--color-red))'
      : 'transparent'
  const lineKey = lineNumber !== undefined && lineNumberSide !== undefined
    ? { side: lineNumberSide, lineNumber }
    : null
  const isSelected = lineKey !== null && selectedLine?.side === lineKey.side && selectedLine.lineNumber === lineKey.lineNumber
  const showGutterBlame = blameVisible && lineKey?.side === 'new'
  const isSearchMatch = searchMatch !== undefined
  const isActiveSearchMatch = searchMatch?.active === true
  const displayValue = displayDiffLineValue(value, type)
  const gutterLineType = diffGutterLineType(type)
  const handleSelect = (): void => {
    onSelectLine(lineKey, focusId)
  }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      onNavigateLine(lineKey, focusId, event.key)
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleSelect()
  }
  const reviewDiffLineKey = lineKey !== null ? `${lineKey.side}:${lineKey.lineNumber}` : undefined
  return (
    <div
      className={side ? `review-diff-line-cell review-split-diff-cell review-split-diff-cell-${side}` : 'review-diff-line-cell'}
      data-line-type={type}
      data-line-number={lineNumber}
      data-line-number-side={lineNumberSide}
      data-review-diff-line-key={reviewDiffLineKey}
      data-review-diff-focus-id={focusId}
      data-review-diff-indicators="bars"
      data-review-diff-gutter-line-type={gutterLineType}
      data-review-line-focusable={focusable ? 'true' : undefined}
      data-review-selected-line={isSelected ? 'true' : undefined}
      data-review-search-line-match={isSearchMatch ? 'true' : undefined}
      data-review-search-line-match-count={searchMatch?.matchCount}
      data-review-search-line-ordinal-start={searchMatch?.firstOrdinal}
      data-review-search-line-ordinal-end={searchMatch?.lastOrdinal}
      data-review-search-active-line={isActiveSearchMatch ? 'true' : undefined}
      data-review-line-comment-count={comments.length}
      data-review-line-has-comment={comments.length > 0 ? 'true' : undefined}
      aria-selected={isSelected ? 'true' : undefined}
      tabIndex={focusable ? 0 : lineKey !== null ? -1 : undefined}
      role={lineKey !== null ? 'button' : undefined}
      onClick={lineKey !== null ? handleSelect : undefined}
      onKeyDown={lineKey !== null ? handleKeyDown : undefined}
      style={{
        color,
        background: bg,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        overflowWrap: wrap ? 'anywhere' : 'normal',
        wordBreak: wrap ? 'break-word' : 'normal',
        overflowX: wrap ? 'hidden' : 'auto',
        lineHeight: '20px'
      }}
    >
      <span
        className="review-diff-line-number"
        data-column-number={lineNumber}
        data-review-gutter-blame-visible={showGutterBlame ? 'true' : undefined}
      >
        {gutterLineType !== 'context' && (
          <span
            className="review-diff-gutter-bar"
            data-review-diff-gutter-bar=""
            aria-hidden="true"
          />
        )}
        {lineKey !== null && (
          <span className="review-diff-gutter-utility-slot" data-gutter-utility-slot="">
            <button
              type="button"
              className="review-diff-gutter-utility-button"
              aria-label="Add review comment"
              data-utility-button=""
              data-testid={isSelected ? 'review-diff-line-add-comment' : undefined}
              onClick={(event) => {
                event.stopPropagation()
                onAddComment(lineKey)
              }}
            >
              <Icon name="plus" size={12} />
            </button>
          </span>
        )}
        <span className="review-diff-line-number-content" data-line-number-content="">
          {lineNumber ?? ''}
        </span>
        {showGutterBlame && (
          <ReviewDiffGutterBlame result={blameResult} line={lineKey.lineNumber} />
        )}
      </span>
      <span className="review-diff-line-content">
        {wordParts !== undefined && wordParts.length > 0 ? (
          wordParts.map((part, index) => (
            <span
              key={`${part.text}-${index}`}
              className={part.changed ? 'review-word-diff-token' : undefined}
              data-review-word-diff-token={part.changed ? 'true' : undefined}
            >
              {part.text}
            </span>
          ))
        ) : (
          displayValue
        )}
      </span>
      {isSelected && blameVisible && lineKey?.side === 'new' && (
        <ReviewDiffBlameDetails result={blameResult} line={lineKey.lineNumber} />
      )}
      {comments.length > 0 && (
        <ReviewDiffCommentStack
          comments={comments}
          onChange={onUpdateComment}
          onSave={onSaveComment}
          onDelete={onDeleteComment}
          suggestionStatusById={suggestionStatusById}
          onCopySuggestion={onCopySuggestion}
          onApplySuggestion={onApplySuggestion}
        />
      )}
      {conflictHelper !== undefined && (
        <ReviewMergeConflictActions helper={conflictHelper} />
      )}
    </div>
  )
}

function ReviewMergeConflictActions({ helper }: { helper: ReviewMergeConflictHelper }): JSX.Element {
  const action = (resolution: MergeConflictResolution, label: string, description: string): JSX.Element => (
    <button
      type="button"
      className="review-merge-conflict-action"
      data-testid={`review-merge-conflict-${resolution}`}
      data-review-merge-conflict-resolution={resolution}
      disabled={helper.activeAction !== null}
      onClick={(event) => {
        event.stopPropagation()
        void helper.onResolve(resolution)
      }}
    >
      <span>{label}</span>
      <span>{description}</span>
    </button>
  )
  return (
    <div
      className="review-merge-conflict-helper"
      data-testid="review-merge-conflict-helper"
      data-review-merge-conflict-action-slot={helper.slotId}
      data-review-merge-conflict-index={helper.block.index}
      data-review-merge-conflict-start-line={helper.block.startLine}
      data-review-merge-conflict-current-lines={helper.block.currentLines.length}
      data-review-merge-conflict-incoming-lines={helper.block.incomingLines.length}
      data-review-merge-conflict-active-action={helper.activeAction ?? ''}
      role="group"
      aria-label="Merge conflict actions"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="review-merge-conflict-copy">
        <Icon name="warning" size={14} />
        <span>Merge conflict</span>
        <span>{helper.block.startLabel || 'Current'} / {helper.block.endLabel || 'Incoming'}</span>
      </div>
      <div className="review-merge-conflict-actions">
        {action('current', 'Current', `${helper.block.currentLines.length} lines`)}
        {action('incoming', 'Incoming', `${helper.block.incomingLines.length} lines`)}
        {action('both', 'Both', `${helper.block.currentLines.length + helper.block.incomingLines.length} lines`)}
      </div>
      {helper.error && (
        <div className="review-merge-conflict-error" data-testid="review-merge-conflict-error">
          {helper.error}
        </div>
      )}
    </div>
  )
}

function diffGutterLineType(type: 'addition' | 'deletion' | 'hunk' | 'context'): 'change-addition' | 'change-deletion' | 'context' {
  if (type === 'addition') return 'change-addition'
  if (type === 'deletion') return 'change-deletion'
  return 'context'
}

function displayDiffLineValue(value: string, type: 'addition' | 'deletion' | 'hunk' | 'context'): string {
  if (type === 'addition' || type === 'deletion') return value.slice(1) || ' '
  if (type === 'context' && value.startsWith(' ')) return value.slice(1) || ' '
  return value || ' '
}

function ReviewDiffBlameDetails({ result, line }: { result: GitLineBlameResult | null; line: number }): JSX.Element {
  const details = blameDetails(result)
  return (
    <span
      className="review-diff-blame-details"
      data-testid="review-diff-blame-details"
      data-review-blame-line={line}
      data-review-blame-ok={result?.ok === true ? 'true' : 'false'}
      data-review-blame-source={details.source}
      data-review-blame-author={details.author}
      data-review-blame-commit={details.commit}
      data-review-blame-date={details.date}
    >
      <span className="review-diff-blame-row">
        <span>Author</span>
        <strong>{details.author || 'Unknown'}</strong>
      </span>
      <span className="review-diff-blame-row">
        <span>Commit</span>
        <strong>{details.commit || 'Unavailable'}</strong>
      </span>
      <span className="review-diff-blame-row">
        <span>Date</span>
        <strong>{details.date || 'Unavailable'}</strong>
      </span>
    </span>
  )
}

function ReviewDiffGutterBlame({ result, line }: { result: GitLineBlameResult | null; line: number }): JSX.Element {
  const details = blameDetails(result)
  const label = blameGutterLabel(details.author, details.commit, details.source)
  return (
    <span
      className="review-diff-gutter-blame"
      data-testid="review-diff-gutter-blame"
      data-review-gutter-blame-line={line}
      data-review-gutter-blame-source={details.source}
      data-review-gutter-blame-author={details.author}
      data-review-gutter-blame-commit={details.commit}
      data-review-gutter-blame-date={details.date}
      aria-label={details.author ? `Blame: ${details.author}` : 'Blame unavailable'}
    >
      {label}
    </span>
  )
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

function ReviewDiffCommentStack({
  comments,
  onChange,
  onSave,
  onDelete,
  suggestionStatusById = {},
  onCopySuggestion,
  onApplySuggestion
}: {
  comments: ReviewDiffComment[]
  onChange: (id: string, body: string) => void
  onSave: (id: string) => void
  onDelete: (id: string) => void
  suggestionStatusById?: Record<string, ReviewSuggestionStatus>
  onCopySuggestion?: (comment: ReviewDiffComment, suggestion: ReviewSuggestionBlock) => void | Promise<void>
  onApplySuggestion?: (comment: ReviewDiffComment, suggestion: ReviewSuggestionBlock) => void | Promise<void>
}): JSX.Element {
  return (
    <span className="review-diff-comments" data-testid="review-diff-comments">
      {comments.map((comment) => {
        const suggestion = extractReviewSuggestionBlocks(comment.body)[0] ?? null
        const suggestionStatus = suggestionStatusById[comment.id] ?? ''
        const suggestionApplicable = suggestion !== null && canApplyReviewSuggestion(comment)
        return (
          <span
            key={comment.id}
            className="review-diff-comment-card"
            data-testid="review-diff-comment-card"
            data-review-comment-id={comment.id}
            data-review-comment-side={comment.side}
            data-review-comment-start-line={comment.startLine ?? ''}
            data-review-comment-line={comment.lineNumber}
            data-review-comment-status={comment.status}
            data-review-comment-provider-source={comment.source ?? ''}
            data-review-comment-author={comment.author ?? ''}
            data-review-comment-url={comment.url ?? ''}
            data-review-comment-resolved={comment.resolved === undefined ? '' : comment.resolved ? 'true' : 'false'}
            data-review-comment-outdated={comment.outdated === undefined ? '' : comment.outdated ? 'true' : 'false'}
            data-review-comment-suggestion={suggestion ? 'true' : 'false'}
            data-review-comment-suggestion-status={suggestionStatus}
            data-review-comment-blame-source={comment.blame?.source ?? ''}
            data-review-comment-blame-commit={comment.blame?.commit ?? ''}
            data-review-comment-blame-author={comment.blame?.author ?? ''}
            data-review-comment-blame-date={comment.blame?.authoredAt ?? ''}
          >
            <span className="review-diff-comment-header">
              <span>{comment.status === 'provider' ? `${comment.author ?? 'GitHub'} review` : 'Review comment'}</span>
              <span>{comment.side === 'new' ? '+' : '-'}{comment.startLine && comment.startLine !== comment.lineNumber ? `${comment.startLine}-` : ''}{comment.lineNumber}</span>
            </span>
            {comment.status === 'draft' ? (
              <>
                <textarea
                  className="review-diff-comment-input"
                  data-testid="review-diff-comment-input"
                  aria-label={`Review comment for ${comment.side} line ${comment.lineNumber}`}
                  placeholder="Add a review note"
                  value={comment.body}
                  rows={2}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => onChange(comment.id, event.target.value)}
                />
                <span className="review-diff-comment-actions">
                  <IconButton
                    icon="check"
                    label="Save review comment"
                    size="sm"
                    variant="toolbar"
                    disabled={comment.body.trim().length === 0}
                    dataTestId="review-diff-comment-save"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSave(comment.id)
                    }}
                  />
                  <IconButton
                    icon="close"
                    label="Delete review comment"
                    size="sm"
                    variant="toolbar"
                    dataTestId="review-diff-comment-delete"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete(comment.id)
                    }}
                  />
                </span>
              </>
            ) : comment.status === 'provider' ? (
              <>
                <span className="review-diff-comment-provider-meta" data-testid="review-diff-comment-provider-meta">
                  <span>{comment.source === 'github' ? 'GitHub' : 'Provider'}</span>
                  {comment.resolved === false && <span>Unresolved</span>}
                  {comment.outdated === true && <span>Outdated</span>}
                  {comment.blame && (
                    <span data-testid="review-diff-comment-provider-blame">
                      {comment.blame.abbreviatedCommit ?? comment.blame.commit?.slice(0, 8) ?? 'Commit'}
                      {comment.blame.author ? ` by ${comment.blame.author}` : ''}
                    </span>
                  )}
                  {comment.url && (
                    <button
                      type="button"
                      className="review-diff-comment-link"
                      data-testid="review-diff-comment-provider-link"
                      onClick={(event) => {
                        event.stopPropagation()
                        void window.api.browser.openExternal(comment.url ?? '')
                      }}
                    >
                      Open
                    </button>
                  )}
                </span>
                <span className="review-diff-comment-body" data-testid="review-diff-comment-body">{comment.body}</span>
                {suggestion && (
                  <span
                    className="review-diff-comment-suggestion"
                    data-testid="review-diff-comment-suggestion"
                    data-review-comment-suggestion-lines={suggestion.lineCount}
                  >
                    <span className="review-diff-comment-suggestion-label">Suggested change</span>
                    <code>{suggestion.preview}</code>
                    <span className="review-diff-comment-actions">
                      <button
                        type="button"
                        className="review-diff-comment-suggestion-button"
                        data-testid="review-diff-comment-copy-suggestion"
                        disabled={!onCopySuggestion || suggestionStatus === 'applying'}
                        onClick={(event) => {
                          event.stopPropagation()
                          void onCopySuggestion?.(comment, suggestion)
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="review-diff-comment-suggestion-button"
                        data-testid="review-diff-comment-apply-suggestion"
                        disabled={!onApplySuggestion || !suggestionApplicable || suggestionStatus === 'applying'}
                        title={suggestionApplicable ? 'Apply suggestion to the local file' : 'Only current, unresolved new-side suggestions can be applied'}
                        onClick={(event) => {
                          event.stopPropagation()
                          void onApplySuggestion?.(comment, suggestion)
                        }}
                      >
                        Apply
                      </button>
                      {suggestionStatus && (
                        <span
                          className="review-diff-comment-suggestion-status"
                          data-testid="review-diff-comment-suggestion-status"
                          role={suggestionStatus === 'failed' ? 'alert' : 'status'}
                        >
                          {reviewSuggestionStatusLabel(suggestionStatus)}
                        </span>
                      )}
                    </span>
                  </span>
                )}
              </>
            ) : (
              <span className="review-diff-comment-body" data-testid="review-diff-comment-body">{comment.body}</span>
            )}
          </span>
        )
      })}
    </span>
  )
}

interface ReviewSuggestionBlock {
  text: string
  preview: string
  lineCount: number
}

function extractReviewSuggestionBlocks(body: string): ReviewSuggestionBlock[] {
  const blocks: ReviewSuggestionBlock[] = []
  const pattern = /```suggestion[^\n\r]*(?:\r?\n)([\s\S]*?)(?:\r?\n)?```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const text = normalizeSuggestionText(match[1] ?? '')
    if (!text.trim()) continue
    const lines = text.split('\n')
    blocks.push({
      text,
      preview: lines.slice(0, 4).join('\n'),
      lineCount: lines.length
    })
  }
  return blocks
}

function normalizeSuggestionText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
}

function canApplyReviewSuggestion(comment: ReviewDiffComment): boolean {
  return comment.status === 'provider' &&
    comment.side === 'new' &&
    comment.resolved !== true &&
    comment.outdated !== true &&
    comment.lineNumber > 0 &&
    (comment.startLine === undefined || comment.startLine > 0) &&
    (comment.startLine === undefined || comment.startLine <= comment.lineNumber)
}

function applyReviewSuggestionToText(text: string, comment: ReviewDiffComment, suggestion: string): string {
  if (!canApplyReviewSuggestion(comment)) throw new Error('Suggestion cannot be applied to this comment')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const hasTrailingNewline = /\r?\n$/.test(text)
  const sourceLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (hasTrailingNewline) sourceLines.pop()
  const replacementLines = normalizeSuggestionText(suggestion).split('\n')
  const startLine = comment.startLine ?? comment.lineNumber
  const startIndex = startLine - 1
  const deleteCount = comment.lineNumber - startLine + 1
  if (startIndex < 0 || startIndex >= sourceLines.length || deleteCount < 1) {
    throw new Error('Suggestion line range is outside the current file')
  }
  sourceLines.splice(startIndex, deleteCount, ...replacementLines)
  return `${sourceLines.join(newline)}${hasTrailingNewline ? newline : ''}`
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof window.api.clipboard?.writeText === 'function') {
    const didWrite = await window.api.clipboard.writeText(text)
    if (!didWrite) throw new Error('Clipboard write failed')
    return
  }
  await navigator.clipboard.writeText(text)
}

function reviewSuggestionStatusLabel(status: ReviewSuggestionStatus): string {
  if (status === 'copied') return 'Copied'
  if (status === 'applying') return 'Applying'
  if (status === 'applied') return 'Applied'
  return 'Failed'
}

function mergeProviderReviewComments(
  current: Record<string, ReviewDiffComment[]>,
  providerCommentsByPath: Record<string, ReviewProviderComment[]>,
  sourcePaths: string[]
): Record<string, ReviewDiffComment[]> {
  const sourcePathSet = new Set(sourcePaths)
  const next: Record<string, ReviewDiffComment[]> = {}
  Object.entries(current).forEach(([path, comments]) => {
    const localComments = comments.filter((comment) => comment.status !== 'provider')
    if (sourcePathSet.has(path) && localComments.length > 0) next[path] = localComments
  })
  Object.entries(providerCommentsByPath).forEach(([path, comments]) => {
    if (!sourcePathSet.has(path)) return
    const providerComments = comments.map(providerReviewCommentToDiffComment)
    if (providerComments.length === 0) return
    next[path] = [...(next[path] ?? []), ...providerComments]
  })
  return next
}

function providerReviewCommentToDiffComment(comment: ReviewProviderComment): ReviewDiffComment {
  const updatedAt = comment.createdAt ? Date.parse(comment.createdAt) : 0
  return {
    id: `provider:${comment.source}:${comment.id}`,
    side: comment.side,
    startLine: comment.startLine,
    lineNumber: comment.lineNumber,
    body: comment.body,
    status: 'provider',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    author: comment.author,
    source: comment.source,
    url: comment.url,
    resolved: comment.resolved,
    outdated: comment.outdated,
    createdAt: comment.createdAt,
    blame: comment.blame
  }
}

interface SelectedDiffLine {
  side: 'old' | 'new'
  lineNumber: number
}

interface ReviewDiffComment extends SelectedDiffLine {
  id: string
  body: string
  status: 'draft' | 'saved' | 'provider'
  updatedAt: number
  startLine?: number
  author?: string
  source?: ReviewProviderComment['source']
  url?: string | null
  resolved?: boolean
  outdated?: boolean
  createdAt?: string
  blame?: ReviewProviderComment['blame']
}

type MergeConflictResolution = 'current' | 'incoming' | 'both'

interface MergeConflictBlock {
  index: number
  startLine: number
  separatorLine: number
  endLine: number
  startLabel: string
  endLabel: string
  currentLines: string[]
  incomingLines: string[]
}

interface ReviewMergeConflictHelper {
  block: MergeConflictBlock
  slotId: string
  activeAction: string | null
  error: string | null
  onResolve: (resolution: MergeConflictResolution) => Promise<void>
}

function sameDiffLine(comment: SelectedDiffLine, line: SelectedDiffLine): boolean {
  return comment.side === line.side && comment.lineNumber === line.lineNumber
}

function blameInfo(result: GitLineBlameResult | null): { source: 'unknown' | 'commit' | 'working-tree' | 'unavailable' } {
  if (!result) return { source: 'unknown' }
  if (!result.ok) return { source: 'unavailable' }
  const author = result.author ?? ''
  return { source: result.commit ? 'commit' : author === 'Not Committed Yet' ? 'working-tree' : 'unknown' }
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
  return {
    author: result.author ?? '',
    commit: result.commit ? result.commit.slice(0, 8) : info.source === 'working-tree' ? 'Working tree' : '',
    date: result.authorTime ? new Date(result.authorTime * 1000).toLocaleDateString() : '',
    source: info.source
  }
}

interface DiffLineMetadata {
  oldLine?: number
  newLine?: number
  hunkIndex?: number
}

interface ReviewSelectedCurrentLine {
  lineNumber: number
  text: string
}

interface DiffHunkHeader {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
}

interface HiddenContextSegment {
  key: string
  beforeHunkIndex: number
  oldStart: number
  newStart: number
  count: number
}

function annotateDiffLines(lines: string[]): DiffLineMetadata[] {
  const metadata: DiffLineMetadata[] = []
  let oldLine: number | undefined
  let newLine: number | undefined
  let hunkIndex = -1
  lines.forEach((line) => {
    const hunk = parseHunkHeader(line)
    if (hunk !== null) {
      hunkIndex += 1
      oldLine = hunk.oldStart
      newLine = hunk.newStart
      metadata.push({ hunkIndex })
      return
    }
    if (oldLine === undefined || newLine === undefined || line.startsWith('\\')) {
      metadata.push(hunkIndex >= 0 ? { hunkIndex } : {})
      return
    }
    if (line.startsWith('-')) {
      metadata.push({ oldLine, hunkIndex })
      oldLine += 1
      return
    }
    if (line.startsWith('+')) {
      metadata.push({ newLine, hunkIndex })
      newLine += 1
      return
    }
    metadata.push({ oldLine, newLine, hunkIndex })
    oldLine += 1
    newLine += 1
  })
  return metadata
}

function reviewDiffSelectedCurrentLine(
  lines: string[],
  metadata: DiffLineMetadata[],
  lineNumber: number
): ReviewSelectedCurrentLine | null {
  const index = metadata.findIndex((line) => line.newLine === lineNumber)
  if (index === -1) return null
  const rawLine = lines[index] ?? ''
  return {
    lineNumber,
    text: displayDiffLineValue(rawLine, diffLineType(rawLine))
  }
}

function summarizeDiffHunks(lines: string[], metadata: DiffLineMetadata[]): Map<number, { changedLineCount: number }> {
  const summaries = new Map<number, { changedLineCount: number }>()
  lines.forEach((line, index) => {
    const hunkIndex = metadata[index]?.hunkIndex
    if (hunkIndex === undefined) return
    const summary = summaries.get(hunkIndex) ?? { changedLineCount: 0 }
    if (line.startsWith('+') || line.startsWith('-')) summary.changedLineCount += 1
    summaries.set(hunkIndex, summary)
  })
  return summaries
}

function buildHiddenContextSegments(lines: string[]): HiddenContextSegment[] {
  const hunkHeaders: Array<DiffHunkHeader & { hunkIndex: number }> = []
  lines.forEach((line) => {
    const header = parseHunkHeader(line)
    if (header !== null) hunkHeaders.push({ ...header, hunkIndex: hunkHeaders.length })
  })
  if (hunkHeaders.length === 0) return []
  const segments: HiddenContextSegment[] = []
  const first = hunkHeaders[0]
  if (first.oldStart > 1 && first.newStart > 1) {
    const count = Math.min(first.oldStart - 1, first.newStart - 1)
    if (count > 0) {
      segments.push({
        key: `before:${first.hunkIndex}:${first.newStart - count}:${count}`,
        beforeHunkIndex: first.hunkIndex,
        oldStart: first.oldStart - count,
        newStart: first.newStart - count,
        count
      })
    }
  }
  for (let index = 1; index < hunkHeaders.length; index += 1) {
    const previous = hunkHeaders[index - 1]
    const current = hunkHeaders[index]
    const previousOldEnd = previous.oldStart + previous.oldCount - 1
    const previousNewEnd = previous.newStart + previous.newCount - 1
    const oldGap = current.oldStart - previousOldEnd - 1
    const newGap = current.newStart - previousNewEnd - 1
    const count = Math.min(oldGap, newGap)
    if (count <= 0) continue
    segments.push({
      key: `between:${previous.hunkIndex}:${current.hunkIndex}:${previousNewEnd + 1}:${count}`,
      beforeHunkIndex: current.hunkIndex,
      oldStart: previousOldEnd + 1,
      newStart: previousNewEnd + 1,
      count
    })
  }
  return segments
}

function parseHunkHeader(line: string): DiffHunkHeader | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
  if (match === null) return null
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4])
  }
}

interface WordDiffPart {
  text: string
  changed: boolean
}

interface DiffSearchLineState {
  matchCount: number
  firstOrdinal: number
  lastOrdinal: number
  active: boolean
}

function buildDiffSearchLineState(
  lines: string[],
  query: string,
  activeMatchIndex: number | null
): { byLine: Map<number, DiffSearchLineState>; totalMatches: number; activeLineVisible: boolean } {
  const byLine = new Map<number, DiffSearchLineState>()
  const normalizedQuery = normalizedReviewSearchQuery(query)
  if (!normalizedQuery) return { byLine, totalMatches: 0, activeLineVisible: false }
  let totalMatches = 0
  let activeLineVisible = false
  lines.forEach((line, index) => {
    const type = diffLineType(line)
    if (type === 'hunk') return
    const searchable = displayDiffLineValue(line, type).toLowerCase()
    const matchCount = countSearchMatches(searchable, normalizedQuery)
    if (matchCount === 0) return
    const firstOrdinal = totalMatches + 1
    const lastOrdinal = totalMatches + matchCount
    const active = activeMatchIndex !== null && activeMatchIndex >= firstOrdinal && activeMatchIndex <= lastOrdinal
    if (active) activeLineVisible = true
    byLine.set(index, { matchCount, firstOrdinal, lastOrdinal, active })
    totalMatches += matchCount
  })
  return { byLine, totalMatches, activeLineVisible }
}

function buildWordDiffLineParts(lines: string[], enabled: boolean): { byLine: Map<number, WordDiffPart[]>; count: number } {
  const byLine = new Map<number, WordDiffPart[]>()
  if (!enabled) return { byLine, count: 0 }
  let count = 0
  for (let index = 0; index < lines.length;) {
    if (!lines[index].startsWith('-')) {
      index += 1
      continue
    }
    const deletions: Array<{ index: number; line: string }> = []
    while (index < lines.length && lines[index].startsWith('-')) {
      deletions.push({ index, line: lines[index] })
      index += 1
    }
    const additions: Array<{ index: number; line: string }> = []
    while (index < lines.length && lines[index].startsWith('+')) {
      additions.push({ index, line: lines[index] })
      index += 1
    }
    const pairCount = Math.min(deletions.length, additions.length)
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const deletion = deletions[pairIndex]
      const addition = additions[pairIndex]
      const pair = buildWordDiffPair(deletion.line, addition.line)
      if (pair.changedCount === 0) continue
      byLine.set(deletion.index, pair.deletion)
      byLine.set(addition.index, pair.addition)
      count += pair.changedCount
    }
  }
  return { byLine, count }
}

function buildWordDiffPair(deletionLine: string, additionLine: string): { deletion: WordDiffPart[]; addition: WordDiffPart[]; changedCount: number } {
  const deletionTokens = tokenizeDiffWords(deletionLine.slice(1))
  const additionTokens = tokenizeDiffWords(additionLine.slice(1))
  const { deletionChanged, additionChanged } = changedTokenMasks(deletionTokens, additionTokens)
  const deletion = partsFromTokens(deletionTokens, deletionChanged)
  const addition = partsFromTokens(additionTokens, additionChanged)
  return {
    deletion,
    addition,
    changedCount: deletionChanged.filter(Boolean).length + additionChanged.filter(Boolean).length
  }
}

function tokenizeDiffWords(value: string): string[] {
  return value.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+/g) ?? []
}

function changedTokenMasks(deletionTokens: string[], additionTokens: string[]): { deletionChanged: boolean[]; additionChanged: boolean[] } {
  const rows = deletionTokens.length + 1
  const columns = additionTokens.length + 1
  const table: number[][] = Array.from({ length: rows }, () => Array(columns).fill(0))
  for (let row = deletionTokens.length - 1; row >= 0; row -= 1) {
    for (let column = additionTokens.length - 1; column >= 0; column -= 1) {
      table[row][column] = deletionTokens[row] === additionTokens[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1])
    }
  }
  const deletionChanged = deletionTokens.map(() => true)
  const additionChanged = additionTokens.map(() => true)
  let row = 0
  let column = 0
  while (row < deletionTokens.length && column < additionTokens.length) {
    if (deletionTokens[row] === additionTokens[column]) {
      deletionChanged[row] = false
      additionChanged[column] = false
      row += 1
      column += 1
    } else if (table[row + 1][column] >= table[row][column + 1]) {
      row += 1
    } else {
      column += 1
    }
  }
  return { deletionChanged, additionChanged }
}

function partsFromTokens(tokens: string[], changed: boolean[]): WordDiffPart[] {
  const parts: WordDiffPart[] = []
  tokens.forEach((token, index) => {
    const tokenChanged = changed[index] && token.trim().length > 0
    const previous = parts[parts.length - 1]
    if (previous !== undefined && previous.changed === tokenChanged) {
      previous.text += token
    } else {
      parts.push({ text: token, changed: tokenChanged })
    }
  })
  return parts
}

function diffLineType(line: string): 'addition' | 'deletion' | 'hunk' | 'context' {
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  if (line.startsWith('@@')) return 'hunk'
  return 'context'
}

function parseMergeConflictBlocks(text: string): MergeConflictBlock[] {
  const lines = text.split(/\r?\n/)
  const blocks: MergeConflictBlock[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('<<<<<<<')) continue
    const separatorIndex = lines.findIndex((line, candidateIndex) => candidateIndex > index && line.startsWith('======='))
    if (separatorIndex === -1) continue
    const endIndex = lines.findIndex((line, candidateIndex) => candidateIndex > separatorIndex && line.startsWith('>>>>>>>'))
    if (endIndex === -1) continue
    blocks.push({
      index: blocks.length,
      startLine: index + 1,
      separatorLine: separatorIndex + 1,
      endLine: endIndex + 1,
      startLabel: lines[index].replace(/^<<<<<<<\s*/, '').trim(),
      endLabel: lines[endIndex].replace(/^>>>>>>>\s*/, '').trim(),
      currentLines: lines.slice(index + 1, separatorIndex),
      incomingLines: lines.slice(separatorIndex + 1, endIndex)
    })
    index = endIndex
  }
  return blocks
}

function resolveMergeConflictBlock(
  text: string,
  requestedBlock: MergeConflictBlock,
  resolution: MergeConflictResolution
): string | null {
  const hasTrailingNewline = /\r?\n$/.test(text)
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/)
  const blocks = parseMergeConflictBlocks(lines.join('\n'))
  const block = blocks.find((candidate) => candidate.startLine === requestedBlock.startLine) ?? blocks[requestedBlock.index]
  if (block === undefined) return null
  const replacement = resolution === 'current'
    ? block.currentLines
    : resolution === 'incoming'
      ? block.incomingLines
      : [...block.currentLines, ...block.incomingLines]
  const nextLines = [
    ...lines.slice(0, block.startLine - 1),
    ...replacement,
    ...lines.slice(block.endLine)
  ]
  return `${nextLines.join('\n')}${hasTrailingNewline ? '\n' : ''}`
}

function joinPath(root: string, filePath: string): string {
  return `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function resolveCodexReviewStartRequest(source: ReviewDiffSource, ref: string): CodexReviewStartRequest | null {
  if (source === 'branch') {
    const branch = ref.trim()
    return branch ? { target: { type: 'baseBranch', branch }, delivery: 'inline' } : null
  }
  if (source === 'commit') {
    const sha = ref.trim()
    return sha ? { target: { type: 'commit', sha, title: null }, delivery: 'inline' } : null
  }
  if (source === 'last-turn' || source === 'cloud') return null
  return { target: { type: 'uncommittedChanges' }, delivery: 'inline' }
}

function codexReviewStartedMessage(request: CodexReviewStartRequest): string {
  const target = request.target
  if (target.type === 'baseBranch') return `Codex review started against ${target.branch}`
  if (target.type === 'commit') return `Codex review started for commit ${target.sha.slice(0, 8)}`
  if (target.type === 'custom') return 'Codex custom review started'
  return 'Codex review started'
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

function escapeCssAttribute(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}
