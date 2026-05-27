import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent } from 'react'
import type { BrowserApprovalMode, BrowserDeviceMode, BrowserHistoryEntry, BrowserLocalServerRoute, BrowserTabState, BrowserUseCursorState, BrowserUseSurfaceBounds, BrowserUseSurfaceSize, BrowserWorkbenchState } from '../../store/sessions'
import type { BrowserUsePolicy } from '../../types'
import { browserWebviewPartitionForHost, DEFAULT_BROWSER_USE_POLICY, normalizeBrowserUsePolicy } from '../../types'
import { Badge, Button, IconButton, InspectorDisclosure, InspectorRow, InspectorSection, MenuItem, MenuMessage, MenuRow, MenuSection, MenuSectionLabel, MenuSurface, PanelMessage, PanelNotice, PanelTabStrip, PanelToolbar, ToolbarButton, WorkbenchSearchField } from '../shared/designSystem'
import Icon from '../shared/Icon'
import BrowserWebviewManager, { type BrowserVisibleGeometry, type WebviewElement } from './BrowserWebviewManager'

interface Props {
  initialUrl?: string
  embedded?: boolean
  hostId?: string
  onUrlChange?: (url: string) => void
  browserState?: BrowserWorkbenchState
  onBrowserStateChange?: (patch: Partial<BrowserWorkbenchState>) => void
}

interface BrowserLogEntry {
  level: 'debug' | 'info' | 'log' | 'warn' | 'error'
  message: string
  timestamp: string
  url?: string
}

interface PageAsset {
  id: string
  kind: 'script' | 'font' | 'image' | 'stylesheet' | 'video' | 'other'
  name: string
  url: string
  sources: Array<{ kind: string; property?: string }>
}

interface InlineSvgAsset {
  id: string
  name: string
  markup: string
}

interface PageAssetInventory {
  id: string
  pageUrl: string | null
  assets: PageAsset[]
  inlineSvgs: InlineSvgAsset[]
  summary: {
    totalCount: number
    inlineSvgCount: number
    byKind: Record<string, number>
  }
}

interface VisibleTarget {
  nodeId: string
  tagName: string
  role: string | null
  ariaName: string | null
  visibleText: string | null
  preview: string
  boundingBox: { x: number; y: number; width: number; height: number }
  selector: { primary: string | null; candidates: string[] }
}

interface BrowserTargetReadResult {
  tagName: string
  role: string | null
  ariaName: string | null
  text: string | null
  value: string | null
  href: string | null
  checked: boolean | null
  enabled: boolean
  visible: boolean
  selector: string | null
}

interface BrowserPendingComment {
  xPercent: number
  yPercent: number
  leftPercent: number
  topPercent: number
  region?: BrowserCommentRegion
  visibleStructure: string
}

interface BrowserCommentRegion {
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
  leftPercent: number
  topPercent: number
}

type BrowserCommentIntent = 'comment' | 'design-tweak'

type BrowserTargetAction = 'click' | 'double_click' | 'type' | 'fill' | 'key' | 'select' | 'check' | 'read' | 'scroll'
interface BrowserClientToolActionResult {
  ok: boolean
  action: string
  error?: string
  target?: BrowserTargetReadResult | null
  targetCount?: number
}
type BrowserClearDataKind = 'all' | 'cache' | 'cookies' | 'siteData'
type BrowserInspectorMode = BrowserWorkbenchState['inspectorMode']
type BrowserManagerBridgeEvent = CustomEvent<{
  hostId?: string
  active?: boolean
  turnId?: string | null
  viewportSize?: BrowserUseSurfaceSize | null
  captureSurfaceSize?: BrowserUseSurfaceSize | null
  captureBounds?: BrowserUseSurfaceBounds | null
  cursorState?: BrowserUseCursorState | null
  localServerRoutes?: BrowserLocalServerRoute[] | null
  hiddenLocalServerRoutes?: string[] | null
}>
type BrowserManagerBridgeDetail = BrowserManagerBridgeEvent['detail']
type BrowserManagerBridgeWindow = typeof window & {
  __orchestratorSetBrowserManagerState?: (detail: BrowserManagerBridgeDetail) => void
}

const VIEWPORT_PRESETS: Array<{ mode: BrowserDeviceMode; label: string; group: 'Responsive' | 'Phone' | 'Tablet' | 'Desktop' }> = [
  { mode: 'desktop', label: 'Responsive', group: 'Responsive' },
  { mode: 'mobile', label: 'iPhone 15 Pro', group: 'Phone' },
  { mode: 'iphoneSe', label: 'iPhone SE', group: 'Phone' },
  { mode: 'iphone15ProMax', label: 'iPhone 15 Pro Max', group: 'Phone' },
  { mode: 'pixel', label: 'Pixel 8', group: 'Phone' },
  { mode: 'galaxyS24Ultra', label: 'Galaxy S24 Ultra', group: 'Phone' },
  { mode: 'ipadMini', label: 'iPad Mini', group: 'Tablet' },
  { mode: 'ipad', label: 'iPad Air', group: 'Tablet' },
  { mode: 'surfaceDuo', label: 'Surface Duo', group: 'Tablet' },
  { mode: 'surfacePro7', label: 'Surface Pro 7', group: 'Tablet' },
  { mode: 'laptop', label: 'Laptop', group: 'Desktop' },
  { mode: 'laptopLarge', label: 'Laptop L', group: 'Desktop' },
  { mode: 'desktop4k', label: '4K', group: 'Desktop' },
  { mode: 'custom', label: 'Custom', group: 'Responsive' }
]

const BROWSER_INSPECTOR_TABS: Array<{ mode: BrowserInspectorMode; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { mode: 'console', label: 'Console', icon: 'terminal' },
  { mode: 'dom', label: 'DOM', icon: 'file' },
  { mode: 'targets', label: 'Targets', icon: 'dot' },
  { mode: 'assets', label: 'Assets', icon: 'folder' },
  { mode: 'security', label: 'Security', icon: 'warning' }
]

interface LocalBrowserTarget {
  url: string
  title: string | null
  source: 'port-scan' | 'recent'
}

const ZOOM_STEP = 0.1
const DEFAULT_TAB: BrowserTabState = { id: 'tab-1', title: 'New tab', url: '', lastOpened: 0 }
const MIN_VIEWPORT_SIZE = { width: 240, height: 160 }
const MAX_VIEWPORT_SIZE = { width: 4096, height: 4096 }
const BROWSER_STAGE_MARGIN_X = 20
const BROWSER_STAGE_MARGIN_BOTTOM = 20

export default function BrowserPanel({
  initialUrl = '',
  embedded = false,
  hostId = 'right:browser',
  onUrlChange,
  browserState,
  onBrowserStateChange
}: Props): JSX.Element {
  const workbench = normalizeWorkbench(browserState, initialUrl)
  const workbenchRef = useRef(workbench)
  const webviewRefs = useRef<Record<string, WebviewElement | null>>({})
  const webviewRef = useRef<WebviewElement | null>(null)
  const handledClientToolRequestIdsRef = useRef<Set<string>>(new Set())
  const browserStageRef = useRef<HTMLDivElement | null>(null)
  const pendingCacheReloadRef = useRef(false)
  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const [address, setAddress] = useState(activeBrowserTab(workbench).url || initialUrl)
  const [currentUrl, setCurrentUrl] = useState(activeBrowserTab(workbench).url || initialUrl)
  const [title, setTitle] = useState(activeBrowserTab(workbench).title === 'New tab' ? '' : activeBrowserTab(workbench).title)
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [artifactPath, setArtifactPath] = useState<string | null>(null)
  const [findMatches, setFindMatches] = useState(0)
  const [findActiveMatch, setFindActiveMatch] = useState(0)
  const [browserPanelCommandCount, setBrowserPanelCommandCount] = useState(0)
  const [lastBrowserPanelCommand, setLastBrowserPanelCommand] = useState('')
  const [lifecycleSyncCount, setLifecycleSyncCount] = useState(0)
  const [cacheReloadCount, setCacheReloadCount] = useState(0)
  const [clearDataCount, setClearDataCount] = useState(0)
  const [lastClearDataKind, setLastClearDataKind] = useState<BrowserClearDataKind | ''>('')
  const [logs, setLogs] = useState<BrowserLogEntry[]>([])
  const [domSnapshot, setDomSnapshot] = useState('')
  const [visibleTargets, setVisibleTargets] = useState<VisibleTarget[]>([])
  const [assetInventory, setAssetInventory] = useState<PageAssetInventory | null>(null)
  const [assetBundlePath, setAssetBundlePath] = useState<string | null>(null)
  const [localTargets, setLocalTargets] = useState<LocalBrowserTarget[]>([])
  const [localTargetsLoading, setLocalTargetsLoading] = useState(false)
  const [selectedTargetId, setSelectedTargetId] = useState('')
  const [actionText, setActionText] = useState('')
  const [targetReadResult, setTargetReadResult] = useState<BrowserTargetReadResult | null>(null)
  const [clipboardText, setClipboardText] = useState('')
  const [coordinateAction, setCoordinateAction] = useState({ x: 20, y: 20, scrollY: 360 })
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false)
  const [pageContextMenu, setPageContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [lastCommentPoint, setLastCommentPoint] = useState('')
  const [pendingComment, setPendingComment] = useState<BrowserPendingComment | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentIntent, setCommentIntent] = useState<BrowserCommentIntent>('comment')
  const [commentDragRegion, setCommentDragRegion] = useState<BrowserCommentRegion | null>(null)
  const [commentPreviewOriginalLocal, setCommentPreviewOriginalLocal] = useState(false)
  const commentDragStartRef = useRef<{ clientX: number; clientY: number; bounds: DOMRect } | null>(null)
  const suppressNextCommentClickRef = useRef(false)
  const [localTargetSort, setLocalTargetSort] = useState<'recent' | 'port'>('recent')
  const [localTargetView, setLocalTargetView] = useState<'online' | 'hidden'>('online')
  const [visibleGeometry, setVisibleGeometry] = useState<BrowserVisibleGeometry | null>(null)
  const activeTab = activeBrowserTab(workbench)
  const visible = workbench.visible
  const viewport = browserViewport(workbench)
  const urlOrigin = safeOrigin(currentUrl)
  const blocked = Boolean(urlOrigin && workbench.blockedOrigins.includes(originKey(urlOrigin)))
  const devicePreviewActive = workbench.deviceMode !== 'desktop'
  const commentModeUnavailable = !currentUrl || !visible || Boolean(error)
  const commentModeUnavailableReason = commentUnavailableReason(currentUrl, visible, error)
  const commentPreviewOriginal = Boolean(workbench.commentPreviewOriginal) || commentPreviewOriginalLocal
  const commentCoachmarkVisible = workbench.commentMode && !workbench.commentCoachmarkDismissed && pendingComment === null && !commentPreviewOriginal
  const pendingCommentScope = pendingComment?.region
    ? `Region ${pendingComment.region.xPercent}%, ${pendingComment.region.yPercent}% - ${pendingComment.region.widthPercent}% x ${pendingComment.region.heightPercent}%`
    : pendingComment
      ? `Point ${pendingComment.xPercent}%, ${pendingComment.yPercent}%`
      : ''
  const showStatusRow = isLoading || blocked || devicePreviewActive
  const browserUseCursorText = workbench.browserUseCursorState?.visible
    ? `${Math.round(workbench.browserUseCursorState.x)},${Math.round(workbench.browserUseCursorState.y)}`
    : ''
  const sortedLocalTargets = sortLocalTargets(localTargets, localTargetSort)
  const hiddenLocalTargetUrls = new Set(workbench.hiddenLocalTargets)
  const visibleLocalTargets = sortedLocalTargets.filter((target) => !hiddenLocalTargetUrls.has(target.url))
  const hiddenLocalTargets = sortedLocalTargets.filter((target) => hiddenLocalTargetUrls.has(target.url))
  const shownLocalTargets = localTargetView === 'hidden' ? hiddenLocalTargets : visibleLocalTargets
  const localServerRoutesByTarget = new Map(
    sortedLocalTargets.map((target) => [target.url, localServerRoutesForTarget(target, workbench)])
  )
  const visibleLocalServerRouteCount = [...localServerRoutesByTarget.values()].reduce((count, routes) => count + routes.length, 0)
  const hiddenLocalServerRouteCount = workbench.hiddenLocalServerRoutes.length
  const addressBadge = browserAddressBadge(currentUrl || address)
  const browserWebviewTabs = browserTabsWithWebviews(workbench)
  const browserTransferSourceHostId = workbench.webviewTransferSourceHostId
  const browserTransferTargetHostId = workbench.webviewTransferTargetHostId
  const browserWebviewHostId = browserTransferSourceHostId && browserTransferTargetHostId === hostId
    ? browserTransferSourceHostId
    : hostId
  const browserWebviewTransferState = browserWebviewHostId !== hostId ? 'transferred' : 'local'
  const browserPartition = browserWebviewPartitionForHost(browserWebviewHostId)
  const browserTabControllerId = `browser:${hostId}:tabs`
  const browserTabItems = workbench.tabs.map((tab) => ({
    id: tab.id,
    label: tab.title || shortUrl(tab.url) || 'New tab',
    icon: 'browser' as const,
    closable: true,
    closeLabel: `Close ${tab.title || shortUrl(tab.url) || 'browser'} tab`,
    ariaLabel: tab.title || shortUrl(tab.url) || 'New tab',
    tooltipLabel: tab.title || tab.url || 'New tab'
  }))
  useEffect(() => {
    workbenchRef.current = workbench
  }, [workbench])

  useEffect(() => {
    const focusBrowserFind = (): void => {
      patchWorkbench({ findVisible: true })
      window.requestAnimationFrame(() => {
        findInputRef.current?.focus({ preventScroll: true })
      })
    }
    window.addEventListener('orchestrator:focus-browser-find', focusBrowserFind)
    return () => window.removeEventListener('orchestrator:focus-browser-find', focusBrowserFind)
  }, [])

  useEffect(() => {
    if (localTargetView === 'hidden' && hiddenLocalTargets.length === 0) {
      setLocalTargetView('online')
    }
  }, [hiddenLocalTargets.length, localTargetView])

  useEffect(() => {
    const stage = browserStageRef.current
    if (!stage || !currentUrl || !visible || error) {
      setVisibleGeometry(null)
      return
    }
    const updateGeometry = (): void => {
      const rect = stage.getBoundingClientRect()
      setVisibleGeometry((current) => {
        const next = browserVisibleGeometryForStage(rect, viewport, devicePreviewActive)
        return browserVisibleGeometryEqual(current, next) ? current : next
      })
    }
    updateGeometry()
    const resizeObserver = new ResizeObserver(updateGeometry)
    resizeObserver.observe(stage)
    window.addEventListener('resize', updateGeometry)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateGeometry)
    }
  }, [currentUrl, devicePreviewActive, error, viewport.height, viewport.width, visible])

  useEffect(() => {
    const applyManagerBridge = (detail: BrowserManagerBridgeDetail): void => {
      if (!detail || (detail.hostId && detail.hostId !== hostId)) return
      const patch: Partial<BrowserWorkbenchState> = {}
      if (typeof detail.active === 'boolean') patch.browserUseActive = detail.active
      if ('turnId' in detail) patch.browserUseTurnId = detail.turnId ?? null
      if ('viewportSize' in detail) patch.browserUseViewportSize = normalizeBrowserUseSurfaceSize(detail.viewportSize)
      if ('captureSurfaceSize' in detail) patch.browserUseCaptureSurfaceSize = normalizeBrowserUseSurfaceSize(detail.captureSurfaceSize)
      if ('captureBounds' in detail) patch.browserUseCaptureBounds = normalizeBrowserUseSurfaceBounds(detail.captureBounds)
      if ('cursorState' in detail) patch.browserUseCursorState = normalizeBrowserUseCursorState(detail.cursorState)
      if ('localServerRoutes' in detail) patch.localServerRoutes = normalizeLocalServerRoutes(detail.localServerRoutes)
      if ('hiddenLocalServerRoutes' in detail) patch.hiddenLocalServerRoutes = normalizeHiddenLocalServerRoutes(detail.hiddenLocalServerRoutes)
      if (Object.keys(patch).length > 0) patchWorkbench(patch)
    }
    const handleManagerBridge = (event: Event): void => {
      applyManagerBridge((event as BrowserManagerBridgeEvent).detail)
    }
    const bridgeWindow = window as BrowserManagerBridgeWindow
    const previousBridge = bridgeWindow.__orchestratorSetBrowserManagerState
    bridgeWindow.__orchestratorSetBrowserManagerState = applyManagerBridge
    window.addEventListener('orchestrator:browser-manager-state', handleManagerBridge)
    document.addEventListener('orchestrator:browser-manager-state', handleManagerBridge)
    return () => {
      window.removeEventListener('orchestrator:browser-manager-state', handleManagerBridge)
      document.removeEventListener('orchestrator:browser-manager-state', handleManagerBridge)
      if (previousBridge) {
        bridgeWindow.__orchestratorSetBrowserManagerState = previousBridge
      } else {
        delete bridgeWindow.__orchestratorSetBrowserManagerState
      }
    }
  }, [hostId])

  const refreshLocalTargets = async (): Promise<void> => {
    setLocalTargetsLoading(true)
    try {
      const targets = await window.api.browser.discoverLocalTargets(workbenchRef.current.history.map((item) => item.url))
      setLocalTargets(targets)
    } finally {
      setLocalTargetsLoading(false)
    }
  }

  useEffect(() => {
    if (currentUrl) return
    let cancelled = false
    setLocalTargetsLoading(true)
    window.api.browser.discoverLocalTargets(workbench.history.map((item) => item.url))
      .then((targets) => {
        if (!cancelled) setLocalTargets(targets)
      })
      .finally(() => {
        if (!cancelled) setLocalTargetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentUrl])

  useEffect(() => {
    const nextTab = activeBrowserTab(workbench)
    const nextUrl = nextTab.url || initialUrl
    webviewRef.current = webviewRefs.current[nextTab.id] ?? null
    setAddress(nextUrl)
    setCurrentUrl(nextUrl)
    setTitle(nextTab.title === 'New tab' ? '' : nextTab.title)
    setError(null)
    setFindMatches(0)
    setFindActiveMatch(0)
    setScreenshot(null)
    setArtifactPath(null)
    setDomSnapshot('')
    setVisibleTargets([])
    setAssetInventory(null)
    setAssetBundlePath(null)
    setSelectedTargetId('')
  }, [activeTab.url, workbench.activeTabId, initialUrl])

  useEffect(() => {
    webviewRef.current?.setZoomFactor(workbench.zoomFactor)
  }, [workbench.zoomFactor])

  useEffect(() => {
    void window.api.browser.setSecurityPolicy({
      downloadApprovalMode: workbench.downloadApprovalMode,
      uploadApprovalMode: workbench.uploadApprovalMode,
      allowedDownloadOrigins: workbench.allowedDownloadOrigins,
      blockedDownloadOrigins: workbench.blockedDownloadOrigins,
      allowedUploadOrigins: workbench.allowedUploadOrigins,
      blockedUploadOrigins: workbench.blockedUploadOrigins
    })
  }, [
    workbench.downloadApprovalMode,
    workbench.uploadApprovalMode,
    workbench.allowedDownloadOrigins.join('\u0000'),
    workbench.blockedDownloadOrigins.join('\u0000'),
    workbench.allowedUploadOrigins.join('\u0000'),
    workbench.blockedUploadOrigins.join('\u0000')
  ])

  const syncActiveWebviewLifecycle = useCallback((source: 'active-tab' | 'visible' | 'focus' | 'visibility'): void => {
    const nextTab = activeBrowserTab(workbenchRef.current)
    const webview = webviewRefs.current[nextTab.id] ?? null
    webviewRef.current = webview
    if (source !== 'active-tab') {
      setLifecycleSyncCount((count) => count + 1)
    }
    if (!webview) return

    try {
      webview.setZoomFactor?.(workbenchRef.current.zoomFactor)
      if (workbenchRef.current.findQuery.trim()) {
        webview.findInPage?.(workbenchRef.current.findQuery)
      }
      const nextUrl = webview.getURL?.() ?? nextTab.url
      if (nextUrl && nextUrl !== 'about:blank') {
        setCurrentUrl(nextUrl)
        setAddress(nextUrl)
      }
      setTitle(webview.getTitle?.() || nextTab.title || '')
      setCanGoBack(Boolean(webview.canGoBack?.()))
      setCanGoForward(Boolean(webview.canGoForward?.()))
    } catch {
      // Hidden/offscreen Electron webviews can transiently reject lifecycle calls during attach.
    }
  }, [])

  useEffect(() => {
    syncActiveWebviewLifecycle('active-tab')
  }, [activeTab.id, browserWebviewTabs.length, syncActiveWebviewLifecycle])

  useEffect(() => {
    if (!visible || error) return
    syncActiveWebviewLifecycle('visible')
  }, [error, syncActiveWebviewLifecycle, visible])

  useEffect(() => {
    const handleFocus = (): void => syncActiveWebviewLifecycle('focus')
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') syncActiveWebviewLifecycle('visibility')
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [syncActiveWebviewLifecycle])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const updateNavigationState = (): void => {
      setCanGoBack(Boolean(webview.canGoBack?.()))
      setCanGoForward(Boolean(webview.canGoForward?.()))
      const nextUrl = webview.getURL?.() ?? ''
      if (nextUrl && nextUrl !== 'about:blank') {
        setCurrentUrl(nextUrl)
        setAddress(nextUrl)
        onUrlChange?.(nextUrl)
        const nextTitle = webview.getTitle?.() || nextUrl
        const now = Date.now()
        patchActiveTab({ url: nextUrl, title: nextTitle, lastOpened: now })
        recordHistory({ url: nextUrl, title: nextTitle, visitedAt: now })
      }
      setTitle(webview.getTitle?.() ?? '')
    }
    const startLoading = (): void => {
      setError(null)
      setIsLoading(true)
    }
    const stopLoading = (): void => {
      setIsLoading(false)
      if (pendingCacheReloadRef.current) {
        pendingCacheReloadRef.current = false
        setCacheReloadCount((count) => count + 1)
      }
      updateNavigationState()
      webview.setZoomFactor?.(workbench.zoomFactor)
      if (workbench.findQuery.trim()) webview.findInPage?.(workbench.findQuery)
    }
    const failLoad = (event: Event): void => {
      const detail = event as Event & { errorDescription?: string; validatedURL?: string }
      if (detail.validatedURL === 'about:blank') return
      setIsLoading(false)
      setError(detail.errorDescription ?? 'Page failed to load.')
      updateNavigationState()
    }
    const titleUpdated = (event: Event): void => {
      const detail = event as Event & { title?: string }
      const nextTitle = detail.title ?? webview.getTitle?.() ?? ''
      setTitle(nextTitle)
      patchActiveTab({ title: nextTitle || activeTab.title })
    }
    const foundInPage = (event: Event): void => {
      const detail = event as Event & { result?: { activeMatchOrdinal?: number; matches?: number } }
      setFindMatches(detail.result?.matches ?? 0)
      setFindActiveMatch(detail.result?.activeMatchOrdinal ?? 0)
    }
    const consoleMessage = (event: Event): void => {
      const detail = event as Event & { level?: number; message?: string; sourceId?: string }
      setLogs((entries) => [...entries, {
        level: consoleLevel(detail.level),
        message: detail.message ?? '',
        timestamp: new Date().toISOString(),
        url: detail.sourceId
      }].slice(-80))
    }

    webview.addEventListener('did-start-loading', startLoading)
    webview.addEventListener('did-stop-loading', stopLoading)
    webview.addEventListener('did-navigate', updateNavigationState)
    webview.addEventListener('did-navigate-in-page', updateNavigationState)
    webview.addEventListener('did-fail-load', failLoad)
    webview.addEventListener('page-title-updated', titleUpdated)
    webview.addEventListener('found-in-page', foundInPage)
    webview.addEventListener('console-message', consoleMessage)
    return () => {
      webview.removeEventListener('did-start-loading', startLoading)
      webview.removeEventListener('did-stop-loading', stopLoading)
      webview.removeEventListener('did-navigate', updateNavigationState)
      webview.removeEventListener('did-navigate-in-page', updateNavigationState)
      webview.removeEventListener('did-fail-load', failLoad)
      webview.removeEventListener('page-title-updated', titleUpdated)
      webview.removeEventListener('found-in-page', foundInPage)
      webview.removeEventListener('console-message', consoleMessage)
    }
  }, [activeTab.id, onUrlChange, workbench.findQuery, workbench.zoomFactor])

  const patchWorkbench = (patch: Partial<BrowserWorkbenchState>): void => {
    workbenchRef.current = { ...workbenchRef.current, ...patch }
    onBrowserStateChange?.(patch)
  }

  useEffect(() => {
    let cancelled = false
    window.api.settings.get()
      .then((settings) => {
        if (cancelled) return
        const policy = normalizeBrowserUsePolicy(settings.browserUsePolicy)
        const current = workbenchRef.current
        if (browserWorkbenchHasDefaultPolicy(current) && !browserWorkbenchPolicyEquals(current, policy)) {
          patchWorkbench(browserPolicyWorkbenchPatch(policy))
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [hostId])

  const hideLocalTarget = (url: string): void => {
    patchWorkbench({ hiddenLocalTargets: Array.from(new Set([...workbenchRef.current.hiddenLocalTargets, url])) })
  }

  const unhideLocalTarget = (url: string): void => {
    patchWorkbench({ hiddenLocalTargets: workbenchRef.current.hiddenLocalTargets.filter((targetUrl) => targetUrl !== url) })
  }

  const removeLocalServerRoute = (routeUrl: string): void => {
    const current = workbenchRef.current
    patchWorkbench({
      hiddenLocalServerRoutes: Array.from(new Set([...current.hiddenLocalServerRoutes, routeUrl])),
      localServerRoutes: current.localServerRoutes.filter((route) => route.url !== routeUrl)
    })
  }

  const patchActiveTab = (patch: Partial<BrowserTabState>): void => {
    const current = workbenchRef.current
    const tabs = current.tabs.map((tab) => tab.id === current.activeTabId ? { ...tab, ...patch } : tab)
    patchWorkbench({ tabs })
  }

  const recordHistory = (entry: BrowserHistoryEntry): void => {
    if (!entry.url || entry.url === 'about:blank') return
    const current = workbenchRef.current
    patchWorkbench({
      history: [
        entry,
        ...current.history.filter((item) => item.url !== entry.url)
      ].slice(0, 12)
    })
  }

  const navigate = (raw: string): void => {
    const nextUrl = normalizeUrl(raw)
    if (!nextUrl) return
    const nextOrigin = safeOrigin(nextUrl)
    if (nextOrigin && workbench.blockedOrigins.includes(originKey(nextOrigin))) {
      setError(`Blocked by browser policy: ${originKey(nextOrigin)}`)
      return
    }
    setError(null)
    setScreenshot(null)
    setArtifactPath(null)
    setAddress(nextUrl)
    setCurrentUrl(nextUrl)
    patchActiveTab({ url: nextUrl, title: nextUrl, lastOpened: Date.now() })
    onUrlChange?.(nextUrl)
  }

  const newTab = (): void => {
    const nextTab: BrowserTabState = {
      id: `tab-${workbench.nextTabIndex}`,
      title: 'New tab',
      url: '',
      lastOpened: Date.now()
    }
    patchWorkbench({
      tabs: [...workbench.tabs, nextTab],
      activeTabId: nextTab.id,
      nextTabIndex: workbench.nextTabIndex + 1
    })
  }

  const selectTab = (tabId: string): void => {
    patchWorkbench({
      activeTabId: tabId,
      tabs: workbench.tabs.map((tab) => tab.id === tabId ? { ...tab, lastOpened: Date.now() } : tab)
    })
  }

  const closeTab = (tabId: string): void => {
    const nextTabs = workbench.tabs.filter((tab) => tab.id !== tabId)
    const tabs = nextTabs.length > 0 ? nextTabs : [DEFAULT_TAB]
    const activeTabId = workbench.activeTabId === tabId ? tabs.at(-1)?.id ?? tabs[0].id : workbench.activeTabId
    delete webviewRefs.current[tabId]
    patchWorkbench({ tabs, activeTabId })
  }

  const moveTab = (tabId: string, direction: 'left' | 'right'): void => {
    const currentIndex = workbench.tabs.findIndex((tab) => tab.id === tabId)
    if (currentIndex === -1) return
    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= workbench.tabs.length) return
    const tabs = [...workbench.tabs]
    const [tab] = tabs.splice(currentIndex, 1)
    tabs.splice(targetIndex, 0, tab)
    patchWorkbench({ tabs })
  }

  const captureScreenshot = async (): Promise<void> => {
    const webview = webviewRef.current
    if (!webview || !currentUrl) return
    const image = await webview.capturePage()
    const dataUrl = image.toDataURL()
    setScreenshot(dataUrl)
    const saved = await window.api.browser.saveDataUrlArtifact(dataUrl, `browser-${Date.now()}.png`)
    setArtifactPath(saved.path)
    patchWorkbench({ inspectorOpen: true, inspectorMode: 'console' })
  }

  const searchInPage = (query: string): void => {
    setFindMatches(0)
    setFindActiveMatch(0)
    patchWorkbench({ findQuery: query })
    if (!query.trim()) {
      webviewRef.current?.stopFindInPage('clearSelection')
      return
    }
    webviewRef.current?.findInPage(query)
  }

  const stepFind = (direction: 'previous' | 'next'): void => {
    const query = workbench.findQuery.trim()
    if (!query) return
    webviewRef.current?.findInPage(query, { findNext: true, forward: direction === 'next' })
  }

  const closeFind = (): void => {
    setFindMatches(0)
    setFindActiveMatch(0)
    patchWorkbench({ findVisible: false, findQuery: '' })
    webviewRef.current?.stopFindInPage('clearSelection')
  }

  const changeZoom = (delta: number): void => {
    const nextZoom = Math.max(0.5, Math.min(2, Number((workbench.zoomFactor + delta).toFixed(2))))
    webviewRef.current?.setZoomFactor(nextZoom)
    patchWorkbench({ zoomFactor: nextZoom })
  }

  const reloadWithoutCache = (): void => {
    pendingCacheReloadRef.current = true
    webviewRef.current?.reloadIgnoringCache?.()
  }

  const clearBrowserData = async (kind: BrowserClearDataKind): Promise<void> => {
    await window.api.browser.clearData(kind, browserPartition)
    setLastClearDataKind(kind)
    setClearDataCount((count) => count + 1)
    setBrowserMenuOpen(false)
  }

  const setCommentPreviewOriginal = (previewOriginal: boolean): void => {
    setPendingComment(null)
    setCommentDraft('')
    setCommentPreviewOriginalLocal(previewOriginal)
    patchWorkbench({ commentPreviewOriginal: previewOriginal, commentCoachmarkDismissed: true })
  }

  const hardReloadCurrentPage = (): void => {
    const target = currentUrl || address
    if (!target) return
    if (webviewRef.current) {
      reloadWithoutCache()
      return
    }
    pendingCacheReloadRef.current = true
    setError(null)
    setIsLoading(true)
    navigate(target)
  }

  const stopOrReload = (): void => {
    if (isLoading) {
      webviewRef.current?.stop?.()
      setIsLoading(false)
      return
    }
    webviewRef.current?.reload()
  }

  const retryCurrentPage = (): void => {
    const target = currentUrl || address
    if (!target) return
    setError(null)
    if (webviewRef.current) {
      setIsLoading(true)
      webviewRef.current.reload()
      return
    }
    navigate(target)
  }

  useEffect(() => {
    const handleBrowserPanelCommand = (event: Event): void => {
      const command = (event as CustomEvent<{ command?: string }>).detail?.command
      if (!command) return
      setLastBrowserPanelCommand(command)
      setBrowserPanelCommandCount((count) => count + 1)
      if (command === 'open-browser-tab') {
        newTab()
        return
      }
      if (command === 'focus-browser-address-bar') {
        window.requestAnimationFrame(() => {
          addressInputRef.current?.focus({ preventScroll: true })
          addressInputRef.current?.select()
        })
        return
      }
      if (command === 'browser-reload-page') {
        if (currentUrl && visible) stopOrReload()
        return
      }
      if (command === 'browser-hard-reload-page') {
        if (visible) hardReloadCurrentPage()
        return
      }
      if (command === 'browser-navigate-back') {
        if (visible && canGoBack) webviewRef.current?.goBack()
        return
      }
      if (command === 'browser-navigate-forward' && visible && canGoForward) {
        webviewRef.current?.goForward()
      }
    }
    window.addEventListener('orchestrator:browser-panel-command', handleBrowserPanelCommand)
    return () => window.removeEventListener('orchestrator:browser-panel-command', handleBrowserPanelCommand)
  })

  const copyCurrentUrl = (): void => {
    if (!currentUrl) return
    void navigator.clipboard.writeText(currentUrl)
  }

  const addPageContextToChat = async (): Promise<void> => {
    if (!currentUrl) return
    let snapshot = domSnapshot
    if (!snapshot && webviewRef.current && visible && !error) {
      try {
        snapshot = await webviewRef.current.executeJavaScript<string>(DOM_SNAPSHOT_SCRIPT)
      } catch {
        snapshot = ''
      }
    }
    const visibleStructure = snapshot.trim().split('\n').filter(Boolean).slice(0, 10).join('\n')
    const lines = [
      'Review this browser page:',
      `URL: ${currentUrl}`,
      title ? `Title: ${title}` : '',
      visibleStructure ? `\nVisible page structure:\n${visibleStructure}` : ''
    ].filter(Boolean)
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: lines.join('\n') }
    }))
    setPageContextMenu(null)
    setBrowserMenuOpen(false)
  }

  const commentRegionFromDrag = (
    start: { clientX: number; clientY: number; bounds: DOMRect },
    clientX: number,
    clientY: number
  ): BrowserCommentRegion => {
    const bounds = start.bounds
    const width = Math.max(bounds.width, 1)
    const height = Math.max(bounds.height, 1)
    const leftPx = Math.max(bounds.left, Math.min(start.clientX, clientX))
    const rightPx = Math.min(bounds.right, Math.max(start.clientX, clientX))
    const topPx = Math.max(bounds.top, Math.min(start.clientY, clientY))
    const bottomPx = Math.min(bounds.bottom, Math.max(start.clientY, clientY))
    const leftPercent = ((leftPx - bounds.left) / width) * 100
    const topPercent = ((topPx - bounds.top) / height) * 100
    const widthPercent = ((rightPx - leftPx) / width) * 100
    const heightPercent = ((bottomPx - topPx) / height) * 100
    return {
      xPercent: Math.round(leftPercent),
      yPercent: Math.round(topPercent),
      widthPercent: Math.round(widthPercent),
      heightPercent: Math.round(heightPercent),
      leftPercent,
      topPercent
    }
  }

  const openCommentEditorAt = async (
    bounds: DOMRect,
    clientX: number,
    clientY: number,
    region?: BrowserCommentRegion
  ): Promise<void> => {
    if (!currentUrl) return
    const resolvedClientX = Number.isFinite(clientX) && clientX > 0 ? clientX : bounds.left + (bounds.width / 2)
    const resolvedClientY = Number.isFinite(clientY) && clientY > 0 ? clientY : bounds.top + (bounds.height / 2)
    const x = Math.max(0, Math.min(1, (resolvedClientX - bounds.left) / Math.max(bounds.width, 1)))
    const y = Math.max(0, Math.min(1, (resolvedClientY - bounds.top) / Math.max(bounds.height, 1)))
    const xPercent = Math.round(x * 100)
    const yPercent = Math.round(y * 100)
    let snapshot = domSnapshot
    if (!snapshot && webviewRef.current && visible && !error) {
      try {
        snapshot = await webviewRef.current.executeJavaScript<string>(DOM_SNAPSHOT_SCRIPT)
      } catch {
        snapshot = ''
      }
    }
    const visibleStructure = snapshot.trim().split('\n').filter(Boolean).slice(0, 6).join('\n')
    setPendingComment({
      xPercent,
      yPercent,
      leftPercent: x * 100,
      topPercent: y * 100,
      region,
      visibleStructure
    })
    setCommentDraft('')
    setCommentIntent('comment')
    patchWorkbench({ commentCoachmarkDismissed: true })
  }

  const openPointCommentEditor = async (event: ReactMouseEvent<HTMLElement>): Promise<void> => {
    const bounds = event.currentTarget.getBoundingClientRect()
    await openCommentEditorAt(bounds, event.clientX, event.clientY)
  }

  const openRegionCommentEditor = async (region: BrowserCommentRegion, bounds: DOMRect): Promise<void> => {
    const centerX = bounds.left + ((region.leftPercent + (region.widthPercent / 2)) / 100) * bounds.width
    const centerY = bounds.top + ((region.topPercent + (region.heightPercent / 2)) / 100) * bounds.height
    await openCommentEditorAt(bounds, centerX, centerY, region)
  }

  const commentPointerHitsControl = (target: EventTarget | null): boolean => {
    const element = target instanceof Element ? target : null
    return Boolean(element?.closest('[data-testid="browser-comment-mode-banner"], [data-testid="browser-comment-editor"], [data-testid="browser-comment-coachmark"]'))
  }

  const startCommentRegionDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || pendingComment !== null || commentPreviewOriginal || commentPointerHitsControl(event.target)) return
    commentDragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      bounds: event.currentTarget.getBoundingClientRect()
    }
    setCommentDragRegion(null)
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic smoke events and some webview overlays do not own a native pointer.
    }
  }

  const updateCommentRegionDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = commentDragStartRef.current
    if (start === null || pendingComment !== null || commentPreviewOriginal) return
    const distance = Math.max(Math.abs(event.clientX - start.clientX), Math.abs(event.clientY - start.clientY))
    if (distance < 12) {
      setCommentDragRegion(null)
      return
    }
    setCommentDragRegion(commentRegionFromDrag(start, event.clientX, event.clientY))
  }

  const finishCommentRegionDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = commentDragStartRef.current
    if (start === null) return
    commentDragStartRef.current = null
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture may not exist for synthetic drag checks.
    }
    const distance = Math.max(Math.abs(event.clientX - start.clientX), Math.abs(event.clientY - start.clientY))
    if (distance < 12 || pendingComment !== null || commentPreviewOriginal) {
      setCommentDragRegion(null)
      return
    }
    const region = commentRegionFromDrag(start, event.clientX, event.clientY)
    setCommentDragRegion(null)
    suppressNextCommentClickRef.current = true
    window.setTimeout(() => {
      suppressNextCommentClickRef.current = false
    }, 250)
    event.preventDefault()
    event.stopPropagation()
    void openRegionCommentEditor(region, start.bounds)
  }

  const cancelCommentRegionDrag = (): void => {
    commentDragStartRef.current = null
    setCommentDragRegion(null)
  }

  const submitPointComment = (): void => {
    if (!currentUrl || pendingComment === null) return
    const body = commentDraft.trim()
    const lines = [
      commentIntent === 'design-tweak' ? 'Design tweak for this browser page:' : 'Comment on this browser page:',
      `URL: ${currentUrl}`,
      title ? `Title: ${title}` : '',
      pendingComment.region
        ? `Region: ${pendingComment.region.xPercent}%, ${pendingComment.region.yPercent}% - ${pendingComment.region.widthPercent}% x ${pendingComment.region.heightPercent}%`
        : `Point: ${pendingComment.xPercent}%, ${pendingComment.yPercent}%`,
      body
        ? commentIntent === 'design-tweak'
          ? `Requested design change: ${body}`
          : `Comment: ${body}`
        : '',
      pendingComment.visibleStructure ? `\nVisible page structure:\n${pendingComment.visibleStructure}` : ''
    ].filter(Boolean)
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: lines.join('\n') }
    }))
    setLastCommentPoint(pendingComment.region
      ? `${pendingComment.region.xPercent},${pendingComment.region.yPercent},${pendingComment.region.widthPercent},${pendingComment.region.heightPercent}`
      : `${pendingComment.xPercent},${pendingComment.yPercent}`)
    setPendingComment(null)
    setCommentDraft('')
    setCommentIntent('comment')
    setCommentPreviewOriginalLocal(false)
    patchWorkbench({ commentMode: false, commentCoachmarkDismissed: true, commentPreviewOriginal: false })
  }

  const cancelPointComment = (): void => {
    setPendingComment(null)
    setCommentDraft('')
    setCommentIntent('comment')
    setCommentPreviewOriginalLocal(false)
    patchWorkbench({ commentMode: false, commentCoachmarkDismissed: true, commentPreviewOriginal: false })
  }

  const setViewportMode = (mode: BrowserWorkbenchState['deviceMode']): void => {
    const preset = viewportPreset(mode, workbench.viewportWidth, workbench.viewportHeight)
    patchWorkbench({
      deviceMode: mode,
      viewportWidth: preset.width,
      viewportHeight: preset.height
    })
  }

  const rotateViewport = (): void => {
    if (workbench.deviceMode === 'desktop') return
    patchWorkbench({
      viewportWidth: workbench.viewportHeight,
      viewportHeight: workbench.viewportWidth
    })
  }

  const runInspection = async (): Promise<void> => {
    const webview = webviewRef.current
    if (!webview || !currentUrl) return
    const [snapshot, targets, assets] = await Promise.all([
      webview.executeJavaScript<string>(DOM_SNAPSHOT_SCRIPT),
      webview.executeJavaScript<VisibleTarget[]>(VISIBLE_TARGETS_SCRIPT, true),
      webview.executeJavaScript<PageAssetInventory>(PAGE_ASSETS_SCRIPT)
    ])
    patchWorkbench({ inspectorOpen: true })
    setDomSnapshot(snapshot)
    setVisibleTargets(targets)
    setAssetInventory(assets)
    if (!selectedTargetId && targets[0]) setSelectedTargetId(targets[0].nodeId)
  }

  const browserClientToolSnapshot = async (webview: WebviewElement | null): Promise<Record<string, unknown>> => {
    const resolvedUrl = webview?.getURL?.() || currentUrl || activeBrowserTab(workbenchRef.current).url || ''
    const resolvedTitle = webview?.getTitle?.() || title || activeBrowserTab(workbenchRef.current).title || ''
    let visibleStructure = domSnapshot
    let targets = visibleTargets
    if (webview && resolvedUrl && resolvedUrl !== 'about:blank') {
      try {
        const [nextVisibleStructure, nextTargets] = await Promise.all([
          webview.executeJavaScript<string>(DOM_SNAPSHOT_SCRIPT),
          webview.executeJavaScript<VisibleTarget[]>(VISIBLE_TARGETS_SCRIPT, true)
        ])
        visibleStructure = nextVisibleStructure
        targets = Array.isArray(nextTargets) ? nextTargets : []
        setDomSnapshot(visibleStructure)
        setVisibleTargets(targets)
      } catch {
        visibleStructure = ''
        targets = []
      }
    }
    return {
      ok: true,
      url: resolvedUrl,
      title: resolvedTitle,
      visible: workbenchRef.current.visible,
      loading: isLoading,
      error,
      visibleStructure: visibleStructure.trim().slice(0, 6000),
      targets: targets.slice(0, 30).map((target, index) => ({
        index: index + 1,
        nodeId: target.nodeId,
        tagName: target.tagName,
        role: target.role,
        ariaName: target.ariaName,
        visibleText: target.visibleText,
        preview: target.preview,
        selector: target.selector.primary
      }))
    }
  }

  const answerBrowserClientTool = (
    call: BrowserClientToolCall,
    success: boolean,
    payload: Record<string, unknown>
  ): void => {
    void window.api.browser.answerClientToolCall({
      requestId: call.requestId,
      success,
      contentItems: [{
        type: 'inputText',
        text: JSON.stringify(payload)
      }]
    })
  }

  const runBrowserClientToolAction = async (
    webview: WebviewElement,
    action: 'click' | 'type',
    args: Record<string, unknown>
  ): Promise<BrowserClientToolActionResult> => {
    const scriptArgs = {
      action,
      nodeId: typeof args.nodeId === 'string' ? args.nodeId : null,
      selector: typeof args.selector === 'string' ? args.selector : null,
      text: typeof args.text === 'string' ? args.text : '',
      targetText: typeof args.targetText === 'string'
        ? args.targetText
        : typeof args.text === 'string' && action === 'click'
          ? args.text
          : null,
      index: typeof args.index === 'number' ? args.index : null
    }
    return webview.executeJavaScript<BrowserClientToolActionResult>(`
      (() => {
        const args = ${JSON.stringify(scriptArgs)};
        const visible = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const labelFor = (element) => {
          const aria = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || '';
          const text = (element.innerText || element.textContent || element.value || '').replace(/\\s+/g, ' ').trim();
          return [aria, text].filter(Boolean).join(' ').trim();
        };
        const readTarget = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const disabled = element.disabled === true || element.getAttribute('aria-disabled') === 'true';
          return {
            tagName: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            ariaName: element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || null,
            text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim() || null,
            value: 'value' in element ? String(element.value || '') : null,
            href: element instanceof HTMLAnchorElement ? element.href : null,
            checked: element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio') ? element.checked : null,
            enabled: !disabled,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            selector: element.dataset.orchestratorNodeId ? '[data-orchestrator-node-id="' + element.dataset.orchestratorNodeId + '"]' : null
          };
        };
        const targets = Array.isArray(window.__orchestratorBrowserTargets) ? window.__orchestratorBrowserTargets : [];
        const normalizedTargetText = String(args.targetText || '').trim().toLowerCase();
        let element = null;
        if (args.nodeId) element = document.querySelector('[data-orchestrator-node-id="' + String(args.nodeId).replace(/"/g, '\\"') + '"]');
        if (!element && args.selector) {
          try { element = document.querySelector(args.selector); } catch {}
        }
        if (!element && Number.isFinite(args.index) && args.index > 0) {
          const target = targets[Math.floor(args.index) - 1];
          if (target?.nodeId) element = document.querySelector('[data-orchestrator-node-id="' + target.nodeId + '"]');
        }
        if (!element && normalizedTargetText) {
          const candidates = [...document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [role="link"], [tabindex], [contenteditable="true"]')];
          element = candidates.find((candidate) => visible(candidate) && labelFor(candidate).toLowerCase().includes(normalizedTargetText)) || null;
        }
        const pageState = () => ({
          clicked: document.body?.dataset?.clicked || null,
          inputValue: document.body?.dataset?.inputValue || null
        });
        if (!(element instanceof HTMLElement) || !visible(element)) {
          return { ok: false, action: args.action, error: 'Target not found or not visible.', targetCount: targets.length };
        }
        element.focus();
        if (args.action === 'type') {
          if (!args.text) return { ok: false, action: args.action, error: 'browser_type requires text.', target: readTarget(element), targetCount: targets.length, pageState: pageState() };
          if ('value' in element) {
            element.value = String(element.value || '') + args.text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            document.execCommand('insertText', false, args.text);
          }
        } else {
          element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
        return { ok: true, action: args.action, target: readTarget(element), targetCount: targets.length, pageState: pageState() };
      })()
    `, true)
  }

  const handleBrowserClientToolCall = async (call: BrowserClientToolCall): Promise<void> => {
    const expectedSessionId = sessionIdFromBrowserHost(hostId)
    if (!expectedSessionId || call.sessionId !== expectedSessionId) return
    if (call.namespace !== 'orchestrator') return
    if (call.tool !== 'browser_open' && call.tool !== 'browser_read' && call.tool !== 'browser_click' && call.tool !== 'browser_type') return
    if (handledClientToolRequestIdsRef.current.has(call.requestId)) return
    handledClientToolRequestIdsRef.current.add(call.requestId)

    try {
      if (call.tool === 'browser_open') {
        const rawUrl = typeof call.arguments.url === 'string' ? call.arguments.url : ''
        const nextUrl = normalizeUrl(rawUrl)
        if (!nextUrl) {
          answerBrowserClientTool(call, false, { ok: false, error: 'browser_open requires a valid URL.' })
          return
        }
        navigate(nextUrl)
        const webview = await waitForActiveWebview(webviewRef, 4000)
        if (webview) await waitForWebviewSettled(webview, 6000)
        answerBrowserClientTool(call, true, {
          ...(await browserClientToolSnapshot(webview)),
          action: 'open'
        })
        return
      }

      const webview = await waitForActiveWebview(webviewRef, 1000)
      if ((call.tool === 'browser_click' || call.tool === 'browser_type') && webview) {
        await webview.executeJavaScript<VisibleTarget[]>(VISIBLE_TARGETS_SCRIPT, true)
        const actionResult = await runBrowserClientToolAction(webview, call.tool === 'browser_click' ? 'click' : 'type', call.arguments)
        if (actionResult.ok) {
          await waitForWebviewSettled(webview, 1200)
        }
        answerBrowserClientTool(call, actionResult.ok, {
          ...(await browserClientToolSnapshot(webview)),
          action: call.tool === 'browser_click' ? 'click' : 'type',
          targetAction: actionResult
        })
        return
      }
      if (call.tool === 'browser_click' || call.tool === 'browser_type') {
        answerBrowserClientTool(call, false, { ok: false, error: 'Browser page is not available for interaction.' })
        return
      }
      answerBrowserClientTool(call, true, {
        ...(await browserClientToolSnapshot(webview)),
        action: 'read'
      })
    } catch (toolError) {
      answerBrowserClientTool(call, false, {
        ok: false,
        error: toolError instanceof Error ? toolError.message : String(toolError)
      })
    }
  }

  useEffect(() => window.api.browser.onClientToolCall((call) => {
    void handleBrowserClientToolCall(call)
  }))

  const runTargetAction = async (action: BrowserTargetAction): Promise<void> => {
    if (!selectedTargetId || !webviewRef.current) return
    const result = await webviewRef.current.executeJavaScript<BrowserTargetReadResult | boolean>(
      `window.__orchestratorBrowserAction(${JSON.stringify({ action, nodeId: selectedTargetId, text: actionText, x: 0, y: coordinateAction.scrollY })})`,
      true
    )
    setTargetReadResult(action === 'read' && result && typeof result === 'object' ? result : null)
    await runInspection()
  }

  const runCoordinateAction = async (action: 'click' | 'scroll'): Promise<void> => {
    if (!webviewRef.current) return
    await webviewRef.current.executeJavaScript(
      `window.__orchestratorBrowserAction(${JSON.stringify({
        action,
        x: coordinateAction.x,
        y: coordinateAction.y,
        scrollY: coordinateAction.scrollY
      })})`,
      true
    )
    await runInspection()
  }

  const readClipboard = async (): Promise<void> => {
    const text = await webviewRef.current?.executeJavaScript<string>('navigator.clipboard.readText().catch(() => "")', true)
    setClipboardText(text ?? '')
  }

  const writeClipboard = async (): Promise<void> => {
    await webviewRef.current?.executeJavaScript(`navigator.clipboard.writeText(${JSON.stringify(clipboardText)}).catch(() => undefined)`, true)
  }

  const bundleAssets = async (): Promise<void> => {
    if (!assetInventory) return
    const bundle = await window.api.browser.bundleAssets({
      inventoryId: assetInventory.id,
      pageUrl: assetInventory.pageUrl,
      assets: assetInventory.assets
        .filter((asset) => asset.kind === 'image' || asset.kind === 'stylesheet' || asset.kind === 'font' || asset.kind === 'video')
        .map(({ id, kind, name, url }) => ({ id, kind, name, url }))
    })
    setAssetBundlePath(bundle.manifestPath)
  }

  const addOriginPolicy = (key: keyof Pick<BrowserWorkbenchState, 'allowedOrigins' | 'blockedOrigins' | 'allowedDownloadOrigins' | 'blockedDownloadOrigins' | 'allowedUploadOrigins' | 'blockedUploadOrigins'>): void => {
    if (!urlOrigin) return
    const origin = originKey(urlOrigin)
    const values = workbench[key]
    if (values.includes(origin)) return
    patchWorkbench({ [key]: [...values, origin] } as Partial<BrowserWorkbenchState>)
  }

  const clearOriginPolicy = (key: keyof Pick<BrowserWorkbenchState, 'allowedOrigins' | 'blockedOrigins' | 'allowedDownloadOrigins' | 'blockedDownloadOrigins' | 'allowedUploadOrigins' | 'blockedUploadOrigins'>): void => {
    patchWorkbench({ [key]: [] } as Partial<BrowserWorkbenchState>)
  }

  const openExternal = (): void => {
    if (!currentUrl) return
    void window.api.browser.openExternal(currentUrl)
  }

  const openPageContextMenu = (event: ReactMouseEvent): void => {
    if (!currentUrl || !visible || error) return
    event.preventDefault()
    setBrowserMenuOpen(false)
    setPageContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 152))
    })
  }

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      data-testid="browser-panel"
      data-browser-zoom={workbench.zoomFactor.toFixed(2)}
      data-browser-device-mode={workbench.deviceMode}
      data-browser-viewport-width={workbench.viewportWidth}
      data-browser-viewport-height={workbench.viewportHeight}
      data-browser-use-active={workbench.browserUseActive ? 'true' : 'false'}
      data-browser-use-turn-id={workbench.browserUseTurnId ?? ''}
      data-browser-use-viewport-width={workbench.browserUseViewportSize?.width ?? ''}
      data-browser-use-viewport-height={workbench.browserUseViewportSize?.height ?? ''}
      data-browser-use-capture-width={workbench.browserUseCaptureSurfaceSize?.width ?? ''}
      data-browser-use-capture-height={workbench.browserUseCaptureSurfaceSize?.height ?? ''}
      data-browser-use-capture-x={workbench.browserUseCaptureBounds?.x ?? ''}
      data-browser-use-capture-y={workbench.browserUseCaptureBounds?.y ?? ''}
      data-browser-use-capture-bounds-width={workbench.browserUseCaptureBounds?.width ?? ''}
      data-browser-use-capture-bounds-height={workbench.browserUseCaptureBounds?.height ?? ''}
      data-browser-use-capture-scale={workbench.browserUseCaptureBounds?.scale ?? ''}
      data-browser-use-cursor-visible={workbench.browserUseCursorState?.visible ? 'true' : 'false'}
      data-browser-use-cursor={browserUseCursorText}
      data-browser-local-route-count={visibleLocalServerRouteCount}
      data-browser-hidden-local-route-count={hiddenLocalServerRouteCount}
      data-browser-comment-mode={workbench.commentMode ? 'true' : 'false'}
      data-browser-comment-unavailable={commentModeUnavailable ? 'true' : 'false'}
      data-browser-comment-unavailable-reason={commentModeUnavailableReason}
      data-browser-comment-coachmark={commentCoachmarkVisible ? 'true' : 'false'}
      data-browser-comment-preview-original={commentPreviewOriginal ? 'true' : 'false'}
      data-browser-comment-editor-open={pendingComment !== null ? 'true' : 'false'}
      data-browser-comment-intent={pendingComment ? commentIntent : ''}
      data-browser-comment-pending-point={pendingComment ? `${pendingComment.xPercent},${pendingComment.yPercent}` : ''}
      data-browser-comment-pending-region={pendingComment?.region ? `${pendingComment.region.xPercent},${pendingComment.region.yPercent},${pendingComment.region.widthPercent},${pendingComment.region.heightPercent}` : ''}
      data-browser-last-comment={lastCommentPoint}
      data-browser-webview-host-id={hostId}
      data-browser-webview-source-host-id={browserWebviewHostId}
      data-browser-webview-partition={browserPartition}
      data-browser-webview-partition-scope="host"
      data-browser-webview-transfer-state={browserWebviewTransferState}
      data-browser-webview-transfer-source-host-id={browserTransferSourceHostId ?? ''}
      data-browser-webview-transfer-target-host-id={browserTransferTargetHostId ?? ''}
      data-browser-webview-transfer-id={workbench.webviewTransferId ?? ''}
      data-browser-tab-controller="app-shell"
      data-browser-tab-controller-id={browserTabControllerId}
      data-browser-webview-count={browserWebviewTabs.length}
      data-browser-active-webview-tab={currentUrl ? activeTab.id : ''}
      data-browser-cache-reloads={cacheReloadCount}
      data-browser-panel-command-count={browserPanelCommandCount}
      data-browser-panel-last-command={lastBrowserPanelCommand}
      data-browser-clear-data={clearDataCount}
      data-browser-clear-data-kind={lastClearDataKind}
      data-browser-find-matches={findMatches}
      data-browser-find-active-match={findActiveMatch}
      data-browser-lifecycle-syncs={lifecycleSyncCount}
      data-browser-tab-count={workbench.tabs.length}
      data-browser-visible={visible ? 'true' : 'false'}
      data-browser-loading={isLoading ? 'true' : 'false'}
      data-browser-error={error ?? ''}
      data-browser-current-url={currentUrl}
      data-browser-dom-targets={visibleTargets.length}
      data-browser-asset-count={assetInventory?.summary.totalCount ?? 0}
      data-browser-inline-svg-count={assetInventory?.summary.inlineSvgCount ?? 0}
      data-browser-log-count={logs.length}
      data-browser-artifact-path={artifactPath ?? ''}
      data-browser-asset-bundle-path={assetBundlePath ?? ''}
      style={{
        width: embedded ? '100%' : 560,
        height: embedded ? '100%' : undefined,
        background: 'var(--surface-bg)'
      }}
    >
      {workbench.tabs.length > 1 && (
        <PanelTabStrip
          tabs={browserTabItems}
          activeTabId={workbench.activeTabId}
          panelId={browserTabControllerId}
          className="browser-shell-tab-strip"
          stripTestId="browser-tab-strip"
          tabRowTestId="browser-tab-row"
          actionsTestId="browser-tab-actions"
          onActivate={selectTab}
          onClose={closeTab}
          onMove={moveTab}
          actions={<IconButton icon="plus" label="New browser tab" size="sm" onClick={newTab} dataTestId="browser-new-tab" />}
        />
      )}

      <PanelToolbar
        as="form"
        className="browser-toolbar"
        onSubmit={(event) => {
          event.preventDefault()
          navigate(address)
        }}
      >
        <ToolbarButton icon="arrowLeft" label="Back" size="sm" disabled={!canGoBack || !visible} onClick={() => webviewRef.current?.goBack()} />
        <ToolbarButton icon="arrowRight" label="Forward" size="sm" disabled={!canGoForward || !visible} onClick={() => webviewRef.current?.goForward()} />
        <ToolbarButton
          icon={isLoading ? 'close' : 'refresh'}
          label={isLoading ? 'Stop loading' : 'Reload'}
          size="sm"
          disabled={!currentUrl || !visible}
          onClick={stopOrReload}
        />
        {workbench.tabs.length <= 1 && (
          <IconButton icon="plus" label="New browser tab" size="sm" onClick={newTab} dataTestId="browser-new-tab" />
        )}
        <WorkbenchSearchField
          value={address}
          onChange={setAddress}
          placeholder="Search or enter URL"
          type="url"
          icon={null}
          inputRef={addressInputRef}
          ariaLabel="Browser address"
          spellCheck={false}
          dataTestId="browser-url-input"
          className="browser-address-field flex-1"
          leading={(
            <span
              className="browser-address-badge"
              data-testid="browser-address-badge"
              data-browser-address-kind={addressBadge.kind}
              aria-label={addressBadge.ariaLabel}
            >
              <Icon name={addressBadge.icon} size={12} />
              <span>{addressBadge.label}</span>
            </span>
          )}
        />
        <ToolbarButton icon="search" label="Find in page" size="sm" disabled={!currentUrl || !visible} active={workbench.findVisible} onClick={() => patchWorkbench({ findVisible: !workbench.findVisible })} />
        <ToolbarButton
          icon="wrench"
          label="Inspect browser"
          size="sm"
          active={workbench.inspectorOpen}
          disabled={!currentUrl || !visible}
          dataTestId="browser-run-inspection"
          onClick={() => void runInspection()}
        />
        <div className="relative">
          <IconButton
            icon="ellipsis"
            label="Browser actions"
            size="sm"
            active={browserMenuOpen}
            dataTestId="browser-actions-menu"
            onClick={() => setBrowserMenuOpen((open) => !open)}
          />
          {browserMenuOpen && (
            <MenuSurface
              onClose={() => setBrowserMenuOpen(false)}
              className="browser-actions-menu"
              style={{ position: 'absolute', right: 0, top: 32, width: 236, zIndex: 100 }}
            >
              <MenuSection className="browser-action-section" dataTestId="browser-page-actions">
                <MenuSectionLabel className="browser-action-label">Page</MenuSectionLabel>
                <MenuItem
                  icon="eraser"
                  label="Hard reload"
                  ariaLabel="Reload without cache"
                  disabled={!currentUrl || !visible}
                  onClick={reloadWithoutCache}
                />
                <MenuItem
                  icon="camera"
                  label="Screenshot"
                  ariaLabel="Capture screenshot"
                  dataTestId="browser-menu-capture-screenshot"
                  disabled={!currentUrl || isLoading || !visible}
                  onClick={() => {
                    setBrowserMenuOpen(false)
                    void captureScreenshot()
                  }}
                />
                <MenuItem
                  icon="chat"
                  label={workbench.commentMode ? 'Disable comment mode' : 'Comment mode'}
                  ariaLabel={workbench.commentMode ? 'Disable browser comment mode' : 'Enable browser comment mode'}
                  dataTestId="browser-comment-mode"
                  disabled={commentModeUnavailable}
                  onClick={() => {
                    setCommentPreviewOriginalLocal(false)
                    patchWorkbench({
                      commentMode: !workbench.commentMode,
                      commentPreviewOriginal: false
                    })
                    setBrowserMenuOpen(false)
                  }}
                />
                {commentModeUnavailable && (
                  <MenuMessage
                    className="browser-comment-unavailable-message"
                    compact
                    dataTestId="browser-comment-unavailable-message"
                    state="comment-unavailable"
                    tone={error ? 'danger' : 'muted'}
                  >
                    Comment mode unavailable. {commentModeUnavailableReason}
                  </MenuMessage>
                )}
                <MenuItem
                  icon="copy"
                  label="Copy URL"
                  ariaLabel="Copy browser URL"
                  disabled={!currentUrl}
                  onClick={() => {
                    void navigator.clipboard.writeText(currentUrl)
                    setBrowserMenuOpen(false)
                  }}
                />
                <MenuItem
                  icon="external"
                  label="Open in browser"
                  ariaLabel="Open external browser"
                  dataTestId="browser-menu-open-external"
                  disabled={!currentUrl}
                  onClick={() => {
                    setBrowserMenuOpen(false)
                    openExternal()
                  }}
                />
              </MenuSection>
              <MenuSection className="browser-action-section" dataTestId="browser-data-actions">
                <MenuSectionLabel className="browser-action-label">Data</MenuSectionLabel>
                <MenuItem
                  icon="eraser"
                  label="Clear cache"
                  ariaLabel="Clear browser cache"
                  disabled={!visible}
                  dataTestId="browser-clear-cache"
                  onClick={() => void clearBrowserData('cache')}
                />
                <MenuItem
                  icon="eraser"
                  label="Clear cookies"
                  ariaLabel="Clear browser cookies"
                  disabled={!visible}
                  dataTestId="browser-clear-cookies"
                  onClick={() => void clearBrowserData('cookies')}
                />
                <MenuItem
                  icon="eraser"
                  label="Clear site data"
                  ariaLabel="Clear browser site data"
                  disabled={!visible}
                  dataTestId="browser-clear-site-data"
                  onClick={() => void clearBrowserData('siteData')}
                />
                <MenuItem
                  icon="eraser"
                  label="Clear all data"
                  ariaLabel="Clear all browser data"
                  disabled={!visible}
                  dataTestId="browser-clear-data"
                  onClick={() => void clearBrowserData('all')}
                />
              </MenuSection>
              {workbench.history.length > 0 && (
                <MenuSection className="browser-action-section" dataTestId="browser-history-menu">
                  <MenuSectionLabel className="browser-action-label">History</MenuSectionLabel>
                  {workbench.history.slice(0, 5).map((item) => (
                    <MenuRow
                      key={`${item.url}-${item.visitedAt}`}
                      dataTestId="browser-history-item"
                      className="browser-history-row"
                      icon="clock"
                      onClick={() => {
                        setBrowserMenuOpen(false)
                        navigate(item.url)
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.title || shortUrl(item.url) || item.url}</span>
                      <span className="browser-history-url min-w-0 truncate">{shortUrl(item.url)}</span>
                    </MenuRow>
                  ))}
                </MenuSection>
              )}
              <MenuSection className="browser-action-section">
                <MenuSectionLabel className="browser-action-label">View</MenuSectionLabel>
                <MenuRow className="browser-action-row-static" dataTestId="browser-zoom-row" icon="zoomOut">
                  <span className="min-w-0 flex-1">Zoom</span>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Zoom out"
                    className="browser-action-mini"
                    disabled={!currentUrl || workbench.zoomFactor <= 0.5}
                    onClick={() => changeZoom(-ZOOM_STEP)}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Reset zoom"
                    data-testid="browser-zoom-reset"
                    className="browser-action-value"
                    disabled={!currentUrl}
                    onClick={() => {
                      webviewRef.current?.setZoomFactor(1)
                      patchWorkbench({ zoomFactor: 1 })
                    }}
                  >
                    {Math.round(workbench.zoomFactor * 100)}%
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Zoom in"
                    className="browser-action-mini"
                    disabled={!currentUrl || workbench.zoomFactor >= 2}
                    onClick={() => changeZoom(ZOOM_STEP)}
                  >
                    +
                  </button>
                </MenuRow>
                <MenuItem
                  icon={devicePreviewActive ? 'monitor' : 'smartphone'}
                  label={devicePreviewActive ? 'Reset viewport' : 'Mobile preview'}
                  ariaLabel={devicePreviewActive ? 'Reset viewport' : 'Mobile preview'}
                  disabled={!currentUrl}
                  onClick={() => setViewportMode(devicePreviewActive ? 'desktop' : 'mobile')}
                />
                <MenuItem
                  icon={visible ? 'monitor' : 'close'}
                  label={visible ? 'Hide surface' : 'Show surface'}
                  ariaLabel={visible ? 'Hide browser surface' : 'Show browser surface'}
                  onClick={() => patchWorkbench({ visible: !visible })}
                />
              </MenuSection>
            </MenuSurface>
          )}
        </div>
      </PanelToolbar>

      {workbench.findVisible && (
        <PanelToolbar className="browser-find-toolbar">
          <WorkbenchSearchField
            value={workbench.findQuery}
            onChange={searchInPage}
            placeholder="Find in page"
            clearLabel="Clear page search"
            inputRef={findInputRef}
            dataTestId="browser-find-input"
            className="browser-find-search flex-1"
            autoFocus
          />
          {workbench.findQuery.trim() && (
            <span className="min-w-8 text-right text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {findMatches > 0 ? `${findActiveMatch || 1}/${findMatches}` : '0'}
            </span>
          )}
          <ToolbarButton
            icon="arrowLeft"
            label="Previous result"
            size="sm"
            disabled={!workbench.findQuery.trim() || findMatches <= 1}
            onClick={() => stepFind('previous')}
          />
          <ToolbarButton
            icon="arrowRight"
            label="Next result"
            size="sm"
            disabled={!workbench.findQuery.trim() || findMatches <= 1}
            onClick={() => stepFind('next')}
          />
          <ToolbarButton icon="close" label="Close find" size="sm" onClick={closeFind} />
        </PanelToolbar>
      )}

      {showStatusRow && (
        <PanelToolbar className="browser-status-row" dataTestId="browser-status-row">
          <div className="flex min-w-0 items-center gap-2">
            {isLoading && <Badge tone="neutral">Loading</Badge>}
            {error && <Badge tone="danger">Failed</Badge>}
            {blocked && <Badge tone="warning">Blocked origin</Badge>}
            <span className="min-w-0 flex-1 truncate" style={{ color: error ? 'var(--state-danger)' : 'var(--text-tertiary)' }}>
              {error ?? title ?? currentUrl}
            </span>
          </div>
          {error && (
            <div className="browser-status-actions">
              <button type="button" data-testid="browser-error-retry" onClick={retryCurrentPage}>Retry</button>
              <button type="button" data-testid="browser-error-copy-url" onClick={copyCurrentUrl}>Copy URL</button>
            </div>
          )}
          {!error && devicePreviewActive && (
            <div className="flex items-center gap-1">
              <select
                data-testid="browser-viewport-mode"
                value={workbench.deviceMode}
                onChange={(event) => setViewportMode(event.target.value as BrowserWorkbenchState['deviceMode'])}
                className="rounded-md px-2 py-0.5 text-xs outline-none"
                style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                {(['Responsive', 'Phone', 'Tablet', 'Desktop'] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {VIEWPORT_PRESETS
                      .filter((preset) => preset.group === group)
                      .map((preset) => (
                        <option key={preset.mode} value={preset.mode}>{preset.label}</option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {workbench.deviceMode === 'custom' && (
                <>
                  <input
                    aria-label="Viewport width"
                    value={workbench.viewportWidth}
                    onChange={(event) => patchWorkbench({ viewportWidth: clampViewportSize(Number(event.target.value) || 1280, 'width') })}
                    className="w-14 rounded-md px-1 py-0.5 text-xs outline-none"
                    style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <input
                    aria-label="Viewport height"
                    value={workbench.viewportHeight}
                    onChange={(event) => patchWorkbench({ viewportHeight: clampViewportSize(Number(event.target.value) || 720, 'height') })}
                    className="w-14 rounded-md px-1 py-0.5 text-xs outline-none"
                    style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                </>
              )}
              <ToolbarButton
                icon="refresh"
                label="Rotate viewport"
                size="sm"
                onClick={rotateViewport}
              />
            </div>
          )}
        </PanelToolbar>
      )}

      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateRows: workbench.inspectorOpen ? 'minmax(0, 1fr) 184px' : 'minmax(0, 1fr)' }}
      >
        <div
          ref={browserStageRef}
          className="relative flex min-h-0 justify-center overflow-hidden"
          onContextMenu={openPageContextMenu}
          style={{ background: 'var(--canvas-bg)' }}
        >
          {currentUrl ? (
            visible ? (
              error ? (
                <BrowserLoadErrorPane
                  error={error}
                  url={currentUrl}
                  onCopyUrl={copyCurrentUrl}
                  onHardReload={hardReloadCurrentPage}
                  onOpenExternal={openExternal}
                  onRetry={retryCurrentPage}
                />
              ) : (
                <div
                  data-testid="browser-viewport-frame"
                  className="relative flex min-h-0 overflow-hidden"
                  style={{
                    width: devicePreviewActive && visibleGeometry ? visibleGeometry.visualBounds.width : viewport.width,
                    maxWidth: '100%',
                    height: devicePreviewActive && visibleGeometry ? visibleGeometry.visualBounds.height : viewport.height,
                    maxHeight: '100%',
                    borderLeft: workbench.deviceMode !== 'desktop' ? '1px solid var(--border-subtle)' : 'none',
                    borderRight: workbench.deviceMode !== 'desktop' ? '1px solid var(--border-subtle)' : 'none'
                  }}
                >
                  <BrowserWebviewManager
                    hostId={hostId}
                    webviewHostId={browserWebviewHostId}
                    transferSourceHostId={browserTransferSourceHostId}
                    transferTargetHostId={browserTransferTargetHostId}
                    transferId={workbench.webviewTransferId}
                    tabs={browserWebviewTabs}
                    activeTabId={workbench.activeTabId}
                    visible={visible}
                    error={error}
                    viewport={viewport}
                    visibleGeometry={visibleGeometry}
                    browserUseActive={workbench.browserUseActive}
                    browserUseTurnId={workbench.browserUseTurnId}
                    browserUseViewportSize={workbench.browserUseViewportSize}
                    browserUseCaptureSurfaceSize={workbench.browserUseCaptureSurfaceSize}
                    browserUseCaptureBounds={workbench.browserUseCaptureBounds}
                    browserUseCursorState={workbench.browserUseCursorState}
                    webviewRefs={webviewRefs}
                    workbenchRef={workbenchRef}
                    activeWebviewRef={webviewRef}
                    onContextMenu={openPageContextMenu}
                  />
                  {workbench.commentMode && (
                    <div
                      className="browser-comment-overlay"
                      data-testid="browser-comment-overlay"
                      data-browser-comment-preview-original={commentPreviewOriginal ? 'true' : 'false'}
                      role={pendingComment === null && !commentPreviewOriginal ? 'button' : undefined}
                      tabIndex={pendingComment === null && !commentPreviewOriginal ? 0 : undefined}
                      aria-label={pendingComment === null && !commentPreviewOriginal ? 'Place browser comment' : undefined}
                      onClickCapture={(event) => {
                        const previewButton = event.currentTarget.querySelector('[data-testid="browser-comment-preview-original"]')
                        const previewButtonBounds = previewButton instanceof HTMLElement ? previewButton.getBoundingClientRect() : null
                        const isInsidePreviewButton = previewButtonBounds !== null &&
                          event.clientX >= previewButtonBounds.left &&
                          event.clientX <= previewButtonBounds.right &&
                          event.clientY >= previewButtonBounds.top &&
                          event.clientY <= previewButtonBounds.bottom
                        if (!isInsidePreviewButton) return
                        event.preventDefault()
                        event.stopPropagation()
                        if (pendingComment === null) setCommentPreviewOriginal(!commentPreviewOriginal)
                      }}
                      onClick={(event) => {
                        if (suppressNextCommentClickRef.current) {
                          suppressNextCommentClickRef.current = false
                          event.preventDefault()
                          event.stopPropagation()
                          return
                        }
                        const target = event.target as Element | null
                        const closest = typeof target?.closest === 'function' ? target.closest.bind(target) : null
                        const previewButton = event.currentTarget.querySelector('[data-testid="browser-comment-preview-original"]')
                        const previewButtonBounds = previewButton instanceof HTMLElement ? previewButton.getBoundingClientRect() : null
                        const isInsidePreviewButton = previewButtonBounds !== null &&
                          event.clientX >= previewButtonBounds.left &&
                          event.clientX <= previewButtonBounds.right &&
                          event.clientY >= previewButtonBounds.top &&
                          event.clientY <= previewButtonBounds.bottom
                        if (closest?.('[data-testid="browser-comment-preview-original"]') || isInsidePreviewButton) {
                          event.preventDefault()
                          event.stopPropagation()
                          if (pendingComment === null) setCommentPreviewOriginal(!commentPreviewOriginal)
                          return
                        }
                        if (closest?.('[data-testid="browser-comment-mode-banner"]')) {
                          event.stopPropagation()
                          return
                        }
                        if (pendingComment === null && !commentPreviewOriginal) void openPointCommentEditor(event)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        if (pendingComment === null && !commentPreviewOriginal) void openPointCommentEditor(event as unknown as ReactMouseEvent<HTMLElement>)
                      }}
                      onPointerDown={startCommentRegionDrag}
                      onPointerMove={updateCommentRegionDrag}
                      onPointerUp={finishCommentRegionDrag}
                      onPointerCancel={cancelCommentRegionDrag}
                    >
                      <div
                        className="browser-comment-mode-banner"
                        data-testid="browser-comment-mode-banner"
                        data-browser-comment-banner-mode={commentPreviewOriginal ? 'original' : 'annotating'}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span data-testid="browser-comment-mode-title">
                          {commentPreviewOriginal ? `Original • ${shortUrl(currentUrl)}` : `Annotating • ${shortUrl(currentUrl)}`}
                        </span>
                        <button
                          type="button"
                          className="browser-comment-preview-button"
                          data-testid="browser-comment-preview-original"
                          disabled={pendingComment !== null}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (pendingComment !== null) return
                            setCommentPreviewOriginal(!commentPreviewOriginal)
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            event.stopPropagation()
                            if (pendingComment !== null) return
                            setCommentPreviewOriginal(!commentPreviewOriginal)
                          }}
                        >
                          {commentPreviewOriginal ? 'Back to annotations' : 'Preview original'}
                        </button>
                      </div>
                      {pendingComment === null && !commentPreviewOriginal && <span>Click to comment</span>}
                      {commentDragRegion !== null && (
                        <div
                          className="browser-comment-region-selection"
                          data-testid="browser-comment-region-selection"
                          aria-hidden="true"
                          style={{
                            left: `${commentDragRegion.leftPercent}%`,
                            top: `${commentDragRegion.topPercent}%`,
                            width: `${commentDragRegion.widthPercent}%`,
                            height: `${commentDragRegion.heightPercent}%`
                          }}
                        />
                      )}
                      {pendingComment?.region && (
                        <div
                          className="browser-comment-region-marker"
                          data-testid="browser-comment-region-marker"
                          aria-hidden="true"
                          style={{
                            left: `${pendingComment.region.leftPercent}%`,
                            top: `${pendingComment.region.topPercent}%`,
                            width: `${pendingComment.region.widthPercent}%`,
                            height: `${pendingComment.region.heightPercent}%`
                          }}
                        />
                      )}
                      {commentCoachmarkVisible && (
                        <div className="browser-comment-coachmark" data-testid="browser-comment-coachmark">
                          <div className="browser-comment-coachmark-title">Try comment mode</div>
                          <div className="browser-comment-coachmark-body">Click the page to leave visual context for the chat.</div>
                          <button
                            type="button"
                            data-testid="browser-comment-coachmark-dismiss"
                            onClick={(event) => {
                              event.stopPropagation()
                              patchWorkbench({ commentCoachmarkDismissed: true })
                            }}
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                      {pendingComment !== null && (
                        <form
                          className="browser-comment-editor"
                          data-testid="browser-comment-editor"
                          style={{ left: `${pendingComment.leftPercent}%`, top: `${pendingComment.topPercent}%` }}
                          onClick={(event) => event.stopPropagation()}
                          onSubmit={(event) => {
                            event.preventDefault()
                            submitPointComment()
                          }}
                        >
                          <div className="browser-comment-editor-pin" data-testid="browser-comment-editor-pin" aria-hidden="true" />
                          <div className="browser-comment-editor-header">
                            <span>{commentIntent === 'design-tweak' ? 'Design tweak' : 'Browser comment'}</span>
                            <span data-testid="browser-comment-editor-point">{pendingCommentScope}</span>
                          </div>
                          <div className="browser-comment-intent-control" data-testid="browser-comment-intent-control" role="group" aria-label="Browser annotation type">
                            <button
                              type="button"
                              data-testid="browser-comment-intent-comment"
                              data-browser-comment-intent-active={commentIntent === 'comment' ? 'true' : 'false'}
                              onClick={() => setCommentIntent('comment')}
                            >
                              Comment
                            </button>
                            <button
                              type="button"
                              data-testid="browser-comment-intent-design"
                              data-browser-comment-intent-active={commentIntent === 'design-tweak' ? 'true' : 'false'}
                              onClick={() => setCommentIntent('design-tweak')}
                            >
                              Tweak
                            </button>
                          </div>
                          <textarea
                            className="browser-comment-editor-input"
                            data-testid="browser-comment-editor-input"
                            aria-label="Browser comment"
                            placeholder={commentIntent === 'design-tweak'
                              ? 'Describe the design change'
                              : pendingComment.region
                                ? 'Add a note for this region'
                                : 'Add a note for this point'}
                            value={commentDraft}
                            onChange={(event) => setCommentDraft(event.currentTarget.value)}
                            autoFocus
                          />
                          <div className="browser-comment-editor-actions">
                            <Button variant="secondary" dataTestId="browser-comment-editor-cancel" onClick={cancelPointComment}>Cancel</Button>
                            <Button type="submit" dataTestId="browser-comment-editor-send">Send</Button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="browser-hidden-state" data-testid="browser-hidden-state">
                <div className="browser-hidden-webview-host" aria-hidden="true">
                  <BrowserWebviewManager
                    hostId={hostId}
                    webviewHostId={browserWebviewHostId}
                    transferSourceHostId={browserTransferSourceHostId}
                    transferTargetHostId={browserTransferTargetHostId}
                    transferId={workbench.webviewTransferId}
                    tabs={browserWebviewTabs}
                    activeTabId={workbench.activeTabId}
                    visible={false}
                    error={error}
                    viewport={viewport}
                    visibleGeometry={visibleGeometry}
                    browserUseActive={workbench.browserUseActive}
                    browserUseTurnId={workbench.browserUseTurnId}
                    browserUseViewportSize={workbench.browserUseViewportSize}
                    browserUseCaptureSurfaceSize={workbench.browserUseCaptureSurfaceSize}
                    browserUseCaptureBounds={workbench.browserUseCaptureBounds}
                    browserUseCursorState={workbench.browserUseCursorState}
                    webviewRefs={webviewRefs}
                    workbenchRef={workbenchRef}
                    activeWebviewRef={webviewRef}
                    onContextMenu={openPageContextMenu}
                  />
                </div>
                <Icon name="browser" size={26} />
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Hidden</div>
                <div className="max-w-56 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  The page is still loaded.
                </div>
                <Button
                  ariaLabel="Show browser surface"
                  dataTestId="browser-hidden-show"
                  onClick={() => patchWorkbench({ visible: true })}
                  variant="secondary"
                >
                  <Icon name="monitor" size={13} />
                  <span>Show browser</span>
                </Button>
              </div>
            )
          ) : (
            <div
              className="browser-empty-state"
              data-testid="browser-empty-state"
            >
              <Icon name="browser" size={26} />
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Open a local app
              </div>
              <div className="max-w-56 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Choose a running server or enter any URL.
              </div>
              <div className="browser-local-targets" data-testid="browser-local-targets">
                <div className="browser-local-targets-header">
                  <span>{localTargetsLoading ? 'Checking local servers' : 'Local servers'}</span>
                  <div className="browser-local-targets-actions">
                    {hiddenLocalTargets.length > 0 && (
                      <button
                        type="button"
                        aria-label={localTargetView === 'online'
                          ? `Show ${hiddenLocalTargets.length} hidden local ${hiddenLocalTargets.length === 1 ? 'server' : 'servers'}`
                          : 'Show online local servers'}
                        title={localTargetView === 'online'
                          ? `Hidden ${hiddenLocalTargets.length}`
                          : 'Online local servers'}
                        data-testid="browser-local-target-view"
                        data-local-target-view={localTargetView}
                        onClick={() => setLocalTargetView((view) => view === 'online' ? 'hidden' : 'online')}
                      >
                        <Icon name={localTargetView === 'online' ? 'archive' : 'browser'} size={12} />
                        {localTargetView === 'online' && (
                          <span className="browser-local-target-action-count">{hiddenLocalTargets.length}</span>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={localTargetSort === 'recent' ? 'Sort local servers by port' : 'Sort local servers by recent use'}
                      title={localTargetSort === 'recent' ? 'Recent first' : 'Port order'}
                      data-testid="browser-local-target-sort"
                      data-local-target-sort={localTargetSort}
                      onClick={() => setLocalTargetSort((sort) => sort === 'recent' ? 'port' : 'recent')}
                    >
                      <Icon name={localTargetSort === 'recent' ? 'clock' : 'terminal'} size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="Refresh local servers"
                      title="Refresh local servers"
                      onClick={() => void refreshLocalTargets()}
                    >
                      <Icon name="refresh" size={12} />
                    </button>
                  </div>
                </div>
                <div className="browser-local-targets-list" aria-live="polite">
                  {shownLocalTargets.length > 0 ? shownLocalTargets.map((target) => {
                    const targetRoutes = localServerRoutesByTarget.get(target.url) ?? []
                    return (
                      <div key={target.url} className="browser-local-target-group">
                        <div
                          className="browser-local-target-row"
                          data-testid={localTargetView === 'hidden' ? 'browser-local-target-hidden' : 'browser-local-target'}
                          data-local-target-url={target.url}
                          data-local-target-source={target.source}
                          data-local-target-status={localTargetView === 'hidden' ? 'hidden' : 'running'}
                          data-local-target-route-count={targetRoutes.length}
                        >
                          <button
                            className="browser-local-target-main"
                            type="button"
                            onClick={() => navigate(target.url)}
                          >
                            <Icon name="browser" size={13} />
                            <span className="min-w-0 flex-1 truncate">{target.title || shortUrl(target.url)}</span>
                            <span
                              className="browser-local-target-meta"
                              aria-label={`${target.source === 'recent' ? 'Recent' : 'Port'} local server ${shortUrl(target.url)}`}
                            >
                              <span className="browser-local-target-status-dot" aria-hidden="true" />
                              <span>{target.source === 'recent' ? 'Recent' : 'Port'}</span>
                            </span>
                          </button>
                          <button
                            className="browser-local-target-action"
                            type="button"
                            data-testid={localTargetView === 'hidden' ? 'browser-local-target-unhide' : 'browser-local-target-hide'}
                            aria-label={localTargetView === 'hidden' ? `Unhide ${shortUrl(target.url)}` : `Hide ${shortUrl(target.url)}`}
                            onClick={() => {
                              if (localTargetView === 'hidden') {
                                unhideLocalTarget(target.url)
                              } else {
                                hideLocalTarget(target.url)
                              }
                            }}
                          >
                            <Icon name={localTargetView === 'hidden' ? 'plus' : 'close'} size={11} />
                          </button>
                        </div>
                        {localTargetView === 'online' && targetRoutes.length > 0 && (
                          <div className="browser-local-target-routes" data-testid="browser-local-target-routes">
                            {targetRoutes.map((route) => (
                              <div
                                key={route.url}
                                className="browser-local-target-route"
                                data-testid="browser-local-server-route"
                                data-local-route-url={route.url}
                                data-local-route-server-url={target.url}
                                data-local-route-source={route.source ?? 'provider'}
                              >
                                <button
                                  type="button"
                                  className="browser-local-target-route-main"
                                  onClick={() => navigate(route.url)}
                                >
                                  <span>{routePathLabel(route.url)}</span>
                                </button>
                                <button
                                  type="button"
                                  className="browser-local-target-route-remove"
                                  data-testid="browser-local-server-route-remove"
                                  aria-label={`Remove route ${routePathLabel(route.url)}`}
                                  onClick={() => removeLocalServerRoute(route.url)}
                                >
                                  <Icon name="close" size={10} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  }) : (
                    <PanelMessage
                      centered
                      compact
                      className="browser-local-targets-empty"
                      dataTestId="browser-local-targets-empty"
                      state={localTargetsLoading ? 'loading' : localTargetView === 'hidden' ? 'hidden-empty' : 'empty'}
                    >
                      {localTargetsLoading ? 'Looking for servers...' : localTargetView === 'hidden' ? 'No hidden servers' : 'No local servers'}
                    </PanelMessage>
                  )}
                </div>
              </div>
            </div>
          )}
          {pageContextMenu && (
            <MenuSurface
              onClose={() => setPageContextMenu(null)}
              className="browser-page-context-menu"
              style={{
                position: 'fixed',
                left: pageContextMenu.x,
                top: pageContextMenu.y,
                width: 180,
                zIndex: 120
              }}
            >
              <MenuItem
                icon="arrowLeft"
                label="Back"
                disabled={!canGoBack}
                dataTestId="browser-context-back"
                onClick={() => {
                  webviewRef.current?.goBack()
                  setPageContextMenu(null)
                }}
              />
              <MenuItem
                icon="arrowRight"
                label="Forward"
                disabled={!canGoForward}
                dataTestId="browser-context-forward"
                onClick={() => {
                  webviewRef.current?.goForward()
                  setPageContextMenu(null)
                }}
              />
              <MenuItem
                icon="refresh"
                label="Reload"
                dataTestId="browser-context-reload"
                onClick={() => {
                  webviewRef.current?.reload()
                  setPageContextMenu(null)
                }}
              />
              <MenuItem
                icon="wrench"
                label="Inspect"
                dataTestId="browser-context-inspect"
                onClick={() => {
                  setPageContextMenu(null)
                  void runInspection()
                }}
              />
              <MenuItem
                icon="chat"
                label="Add page context"
                dataTestId="browser-context-add-page"
                onClick={() => void addPageContextToChat()}
              />
            </MenuSurface>
          )}
        </div>

        {workbench.inspectorOpen && (
          <div className="browser-inspector-drawer">
            <PanelToolbar className="browser-inspector-toolbar" dataTestId="browser-inspector-toolbar">
              {BROWSER_INSPECTOR_TABS.map(({ mode, label, icon }) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  data-testid={`browser-inspector-${mode}`}
                  className="browser-inspector-tab"
                  data-active={workbench.inspectorMode === mode ? 'true' : 'false'}
                  onClick={() => patchWorkbench({ inspectorMode: mode })}
                >
                  <Icon name={icon} size={13} />
                  <span>{label}</span>
                </button>
              ))}
              <div className="browser-inspector-actions">
                <ToolbarButton
                  icon="refresh"
                  label="Refresh browser inspector"
                  size="sm"
                  variant="toolbar"
                  dataTestId="browser-refresh-inspection"
                  disabled={!currentUrl || !visible}
                  onClick={runInspection}
                />
                <ToolbarButton
                  icon="close"
                  label="Hide browser inspector"
                  size="sm"
                  variant="toolbar"
                  dataTestId="browser-hide-inspection"
                  onClick={() => patchWorkbench({ inspectorOpen: false })}
                />
              </div>
            </PanelToolbar>
            <div className="browser-inspector-output" data-testid="browser-inspector-output">
              {workbench.inspectorMode === 'console' && (
                <ConsolePane
                  logs={logs}
                  artifactPath={artifactPath}
                  screenshot={screenshot}
                  onAddScreenshot={() => addArtifactToChat(artifactPath)}
                  onClear={() => setLogs([])}
                />
              )}
              {workbench.inspectorMode === 'dom' && <DomPane domSnapshot={domSnapshot} />}
              {workbench.inspectorMode === 'targets' && (
                <TargetsPane
                  targets={visibleTargets}
                  selectedTargetId={selectedTargetId}
                  actionText={actionText}
                  targetReadResult={targetReadResult}
                  coordinateAction={coordinateAction}
                  clipboardText={clipboardText}
                  onActionTextChange={setActionText}
                  onCoordinateChange={setCoordinateAction}
                  onReadClipboard={readClipboard}
                  onRunCoordinateAction={runCoordinateAction}
                  onRunTargetAction={runTargetAction}
                  onSelectTarget={(id) => {
                    setSelectedTargetId(id)
                    setTargetReadResult(null)
                  }}
                  onWriteClipboard={writeClipboard}
                  onClipboardChange={setClipboardText}
                />
              )}
              {workbench.inspectorMode === 'assets' && (
                <AssetsPane inventory={assetInventory} bundlePath={assetBundlePath} onBundle={bundleAssets} />
              )}
              {workbench.inspectorMode === 'security' && (
                <SecurityPane
                  workbench={workbench}
                  currentOrigin={urlOrigin ? originKey(urlOrigin) : ''}
                  onPatch={patchWorkbench}
                  onAddOriginPolicy={addOriginPolicy}
                  onClearOriginPolicy={clearOriginPolicy}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BrowserLoadErrorPane({
  error,
  url,
  onCopyUrl,
  onHardReload,
  onOpenExternal,
  onRetry
}: {
  error: string
  url: string
  onCopyUrl: () => void
  onHardReload: () => void
  onOpenExternal: () => void
  onRetry: () => void
}): JSX.Element {
  const host = urlHost(url)
  const suggestions = loadErrorSuggestions(error)

  return (
    <PanelNotice
      actions={(
        <>
          <Button className="browser-load-error-action" dataTestId="browser-load-error-retry" onClick={onRetry} variant="primary">Retry</Button>
          <Button className="browser-load-error-action" dataTestId="browser-load-error-hard-reload" onClick={onHardReload}>Hard reload</Button>
          <Button className="browser-load-error-action" dataTestId="browser-load-error-copy-url" onClick={onCopyUrl}>Copy URL</Button>
          <Button className="browser-load-error-action" dataTestId="browser-load-error-open-external" onClick={onOpenExternal}>Open in browser</Button>
        </>
      )}
      className="browser-load-error"
      code={error}
      dataTestId="browser-load-error"
      description={loadErrorSummary(error, host)}
      icon={<Icon name="browser" size={22} />}
      state="load-error"
      title="Page unavailable"
      tone="danger"
    >
      <div className="orchestrator-panel-notice-suggestions browser-load-error-suggestions">
        <span>Try</span>
        {suggestions.map((suggestion) => (
          <div key={suggestion}>{suggestion}</div>
        ))}
      </div>
    </PanelNotice>
  )
}

function ConsolePane({
  logs,
  artifactPath,
  screenshot,
  onAddScreenshot,
  onClear
}: {
  logs: BrowserLogEntry[]
  artifactPath: string | null
  screenshot: string | null
  onAddScreenshot: () => void
  onClear: () => void
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge tone="neutral">console {logs.length}</Badge>
        {artifactPath && <Badge tone="success">screenshot saved</Badge>}
        {artifactPath && (
          <button
            type="button"
            className="text-xs font-semibold"
            style={{ color: 'var(--accent)' }}
            onClick={onAddScreenshot}
          >
            Add screenshot
          </button>
        )}
        <button type="button" className="ml-auto text-xs" style={{ color: 'var(--text-secondary)' }} onClick={onClear}>Clear</button>
      </div>
      {artifactPath && <div className="truncate" style={{ color: 'var(--text-tertiary)' }}>{artifactPath}</div>}
      {screenshot && (
        <img
          data-testid="browser-screenshot-preview"
          src={screenshot}
          alt="Browser screenshot preview"
          className="max-h-20 rounded-md border object-contain"
          style={{ borderColor: 'var(--border-subtle)' }}
        />
      )}
      <div className="space-y-1">
        {logs.length === 0 ? (
          <PanelMessage compact dataTestId="browser-console-empty" state="empty">
            No console messages captured.
          </PanelMessage>
        ) : logs.slice(-8).map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 rounded-md px-2 py-1" style={{ background: 'var(--control-bg)' }}>
            <span style={{ color: logColor(entry.level) }}>{entry.level}</span>
            <span className="truncate" style={{ color: 'var(--text-primary)' }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DomPane({ domSnapshot }: { domSnapshot: string }): JSX.Element {
  const snapshotLines = domSnapshot ? domSnapshot.split('\n').length : 0
  return (
    <div className="browser-dom-pane" data-testid="browser-dom-pane">
      <div className="browser-dom-summary">
        <Badge tone="neutral">Snapshot</Badge>
        <span>{snapshotLines ? `${snapshotLines} lines` : 'No snapshot'}</span>
      </div>
      <pre className="browser-dom-snapshot">
        {domSnapshot || 'Run refresh to capture the page structure.'}
      </pre>
    </div>
  )
}

function TargetsPane({
  targets,
  selectedTargetId,
  actionText,
  targetReadResult,
  coordinateAction,
  clipboardText,
  onActionTextChange,
  onCoordinateChange,
  onReadClipboard,
  onRunCoordinateAction,
  onRunTargetAction,
  onSelectTarget,
  onWriteClipboard,
  onClipboardChange
}: {
  targets: VisibleTarget[]
  selectedTargetId: string
  actionText: string
  targetReadResult: BrowserTargetReadResult | null
  coordinateAction: { x: number; y: number; scrollY: number }
  clipboardText: string
  onActionTextChange: (value: string) => void
  onCoordinateChange: (value: { x: number; y: number; scrollY: number }) => void
  onReadClipboard: () => void
  onRunCoordinateAction: (action: 'click' | 'scroll') => void
  onRunTargetAction: (action: BrowserTargetAction) => void
  onSelectTarget: (id: string) => void
  onWriteClipboard: () => void
  onClipboardChange: (value: string) => void
}): JSX.Element {
  const [targetAction, setTargetAction] = useState<BrowserTargetAction>('click')
  const actionNeedsText = targetActionNeedsText(targetAction)
  const canRunAction = Boolean(selectedTargetId) && (!actionNeedsText || Boolean(actionText))

  return (
    <div className="browser-targets-pane">
      <InspectorSection title="Element" className="browser-target-section">
        <div className="browser-target-select-row">
          <select
            data-testid="browser-target-select"
            value={selectedTargetId}
            onChange={(event) => onSelectTarget(event.target.value)}
            className="w-full rounded-md px-2 py-1 text-xs outline-none"
            style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="">Targets ({targets.length})</option>
            {targets.map((target) => <option key={target.nodeId} value={target.nodeId}>{target.preview}</option>)}
          </select>
        </div>
        <div className="browser-target-action-controls">
          <select
            aria-label="Target action"
            data-testid="browser-target-action-select"
            value={targetAction}
            onChange={(event) => setTargetAction(event.target.value as BrowserTargetAction)}
            className="w-full rounded-md px-2 py-1 text-xs outline-none"
            style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="click">Click</option>
            <option value="type">Type</option>
            <option value="fill">Fill</option>
            <option value="read">State</option>
            <option value="double_click">Double click</option>
            <option value="key">Key</option>
            <option value="select">Select</option>
            <option value="check">Check</option>
            <option value="scroll">Scroll</option>
          </select>
          <input
            value={actionText}
            onChange={(event) => onActionTextChange(event.target.value)}
            placeholder="Text or key"
            className="w-full rounded-md px-2 py-1 text-xs outline-none"
            style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <IconButton
            icon="send"
            label="Run target action"
            size="sm"
            variant="toolbar"
            tooltip={false}
            className="browser-target-run-button"
            onClick={() => onRunTargetAction(targetAction)}
            disabled={!canRunAction}
            dataTestId="browser-target-run-action"
          />
        </div>
        {targetReadResult && (
          <div
            data-testid="browser-target-read-output"
            className="browser-target-read-output"
            style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>target</span>
            <span className="truncate" style={{ color: 'var(--text-primary)' }}>
              {targetReadResult.tagName}{targetReadResult.role ? ` · ${targetReadResult.role}` : ''}
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>state</span>
            <span className="truncate">{targetReadResult.visible ? 'visible' : 'hidden'} · {targetReadResult.enabled ? 'enabled' : 'disabled'}{targetReadResult.checked === null ? '' : ` · ${targetReadResult.checked ? 'checked' : 'unchecked'}`}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>value</span>
            <span className="truncate">{targetReadResult.value || targetReadResult.text || targetReadResult.ariaName || targetReadResult.href || 'empty'}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>selector</span>
            <span className="truncate">{targetReadResult.selector || 'none'}</span>
          </div>
        )}
      </InspectorSection>
      <div className="browser-target-side-stack">
        <InspectorDisclosure title="Pointer" className="browser-target-secondary-panel" dataTestId="browser-target-pointer-panel">
          <div className="grid grid-cols-3 gap-1">
            <SmallNumber label="X" value={coordinateAction.x} onChange={(x) => onCoordinateChange({ ...coordinateAction, x })} />
            <SmallNumber label="Y" value={coordinateAction.y} onChange={(y) => onCoordinateChange({ ...coordinateAction, y })} />
            <SmallNumber label="Scroll" value={coordinateAction.scrollY} onChange={(scrollY) => onCoordinateChange({ ...coordinateAction, scrollY })} />
          </div>
          <div className="browser-target-action-row">
            <ActionButton label="Click x/y" dataTestId="browser-target-coordinate-click" onClick={() => onRunCoordinateAction('click')} />
            <ActionButton label="Scroll x/y" dataTestId="browser-target-coordinate-scroll" onClick={() => onRunCoordinateAction('scroll')} />
          </div>
        </InspectorDisclosure>
        <InspectorDisclosure title="Clipboard" className="browser-target-secondary-panel" dataTestId="browser-target-clipboard-panel">
          <div className="flex gap-1">
            <input
              value={clipboardText}
              onChange={(event) => onClipboardChange(event.target.value)}
              placeholder="Clip text"
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
              style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <ActionButton label="Read" dataTestId="browser-target-clipboard-read" onClick={onReadClipboard} />
            <ActionButton label="Write" dataTestId="browser-target-clipboard-write" onClick={onWriteClipboard} />
          </div>
        </InspectorDisclosure>
      </div>
    </div>
  )
}

function targetActionNeedsText(action: BrowserTargetAction): boolean {
  return action === 'type' || action === 'fill' || action === 'key' || action === 'select'
}

function AssetsPane({ inventory, bundlePath, onBundle }: { inventory: PageAssetInventory | null; bundlePath: string | null; onBundle: () => void }): JSX.Element {
  const kindEntries = Object.entries(inventory?.summary.byKind ?? {})
  const visibleAssets = (inventory?.assets ?? []).slice(0, 7)
  const visibleInlineSvgs = (inventory?.inlineSvgs ?? []).slice(0, 4)
  return (
    <div className="browser-assets-pane" data-testid="browser-assets-pane">
      <InspectorRow className="browser-assets-header" dataTestId="browser-assets-header">
        <div className="min-w-0">
          <div className="orchestrator-inspector-section-title" data-inspector-section-title="true">Inventory</div>
          <div className="browser-assets-summary">
            <span>{inventory?.summary.totalCount ?? 0} files</span>
            <span>{inventory?.summary.inlineSvgCount ?? 0} inline svg</span>
          </div>
        </div>
        <Button
          dataTestId="browser-assets-bundle"
          className="browser-assets-bundle"
          disabled={!inventory}
          onClick={onBundle}
        >
          Bundle
        </Button>
      </InspectorRow>
      {bundlePath && (
        <InspectorRow className="browser-assets-bundle-path" dataTestId="browser-assets-bundle-path">
          <span>manifest</span>
          <span>{bundlePath}</span>
        </InspectorRow>
      )}
      {kindEntries.length > 0 && (
        <div className="browser-assets-kind-grid" data-testid="browser-assets-kind-grid">
          {kindEntries.map(([kind, count]) => (
            <InspectorRow key={kind} className="browser-assets-kind" variant="muted">
              <span>{kind}</span>
              <strong>{count}</strong>
            </InspectorRow>
          ))}
        </div>
      )}
      <div className="browser-assets-list" data-testid="browser-assets-list">
        {visibleAssets.length > 0 ? visibleAssets.map((asset) => (
          <InspectorRow key={asset.id} className="browser-assets-row" dataTestId="browser-assets-row">
            <Badge tone="neutral">{asset.kind}</Badge>
            <div className="min-w-0">
              <div className="browser-assets-name">{asset.name}</div>
              <div className="browser-assets-meta">
                <span>{assetOrigin(asset.url)}</span>
                <span>{asset.sources.length} source{asset.sources.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </InspectorRow>
        )) : (
          <PanelMessage centered className="browser-assets-empty" dataTestId="browser-assets-empty" framed state="empty">
            Inspect a loaded page to collect assets.
          </PanelMessage>
        )}
      </div>
      {visibleInlineSvgs.length > 0 && (
        <InspectorSection title="Inline SVGs" className="browser-assets-inline" dataTestId="browser-inline-svg-list">
          <div className="browser-assets-list">
            {visibleInlineSvgs.map((asset) => (
              <InspectorRow key={asset.id} className="browser-assets-row" dataTestId="browser-inline-svg-row">
                <Badge tone="neutral">svg</Badge>
                <div className="min-w-0">
                  <div className="browser-assets-name">{asset.name}</div>
                  <div className="browser-assets-meta">
                    <span>{formatBytes(asset.markup.length)}</span>
                    <span>inline markup</span>
                  </div>
                </div>
              </InspectorRow>
            ))}
          </div>
        </InspectorSection>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function assetOrigin(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'inline'
  }
}

function SecurityPane({
  workbench,
  currentOrigin,
  onPatch,
  onAddOriginPolicy,
  onClearOriginPolicy
}: {
  workbench: BrowserWorkbenchState
  currentOrigin: string
  onPatch: (patch: Partial<BrowserWorkbenchState>) => void
  onAddOriginPolicy: (key: 'allowedOrigins' | 'blockedOrigins' | 'allowedDownloadOrigins' | 'blockedDownloadOrigins' | 'allowedUploadOrigins' | 'blockedUploadOrigins') => void
  onClearOriginPolicy: (key: 'allowedOrigins' | 'blockedOrigins' | 'allowedDownloadOrigins' | 'blockedDownloadOrigins' | 'allowedUploadOrigins' | 'blockedUploadOrigins') => void
}): JSX.Element {
  return (
    <div className="browser-security-pane" data-testid="browser-security-pane">
      <InspectorSection title="Current origin" className="browser-security-card" dataTestId="browser-security-origin" variant="raised">
        <div className="browser-security-origin">{currentOrigin || 'none'}</div>
      </InspectorSection>
      <InspectorSection title="Defaults" className="browser-security-card" variant="raised">
        <PolicySelect
          label="Approval"
          value={workbench.approvalMode}
          onChange={(approvalMode) => onPatch({ approvalMode })}
        />
        <PolicySelect
          label="History"
          value={workbench.historyApprovalMode}
          onChange={(historyApprovalMode) => onPatch({ historyApprovalMode })}
        />
        <PolicySelect
          label="Downloads"
          value={workbench.downloadApprovalMode}
          onChange={(downloadApprovalMode) => onPatch({ downloadApprovalMode })}
        />
        <PolicySelect
          label="Uploads"
          value={workbench.uploadApprovalMode}
          onChange={(uploadApprovalMode) => onPatch({ uploadApprovalMode })}
        />
      </InspectorSection>
      <InspectorSection title="Origins" className="browser-security-card browser-security-policies" dataTestId="browser-security-policies" variant="raised">
        <PolicyRow label="Allowed" values={workbench.allowedOrigins} onAdd={() => onAddOriginPolicy('allowedOrigins')} onClear={() => onClearOriginPolicy('allowedOrigins')} />
        <PolicyRow label="Blocked" values={workbench.blockedOrigins} onAdd={() => onAddOriginPolicy('blockedOrigins')} onClear={() => onClearOriginPolicy('blockedOrigins')} />
        <PolicyRow label="Downloads" values={workbench.allowedDownloadOrigins} blockedValues={workbench.blockedDownloadOrigins} onAdd={() => onAddOriginPolicy('allowedDownloadOrigins')} onClear={() => onClearOriginPolicy('allowedDownloadOrigins')} />
        <PolicyRow label="Uploads" values={workbench.allowedUploadOrigins} blockedValues={workbench.blockedUploadOrigins} onAdd={() => onAddOriginPolicy('allowedUploadOrigins')} onClear={() => onClearOriginPolicy('allowedUploadOrigins')} />
      </InspectorSection>
    </div>
  )
}

function PolicySelect({ label, value, onChange }: { label: string; value: BrowserApprovalMode; onChange: (value: BrowserApprovalMode) => void }): JSX.Element {
  return (
    <label className="browser-policy-select">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as BrowserApprovalMode)}
        className="rounded-md px-2 py-1 text-xs outline-none"
        style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
      >
        <option value="alwaysAsk">Ask</option>
        <option value="alwaysAllow">Allow</option>
      </select>
    </label>
  )
}

function PolicyRow({
  label,
  values,
  blockedValues = [],
  onAdd,
  onClear
}: {
  label: string
  values: string[]
  blockedValues?: string[]
  onAdd: () => void
  onClear: () => void
}): JSX.Element {
  const summary = values.length > 0
    ? values.join(', ')
    : blockedValues.length > 0
      ? `blocked: ${blockedValues.join(', ')}`
      : 'none'
  return (
    <InspectorRow className="browser-policy-row" dataTestId="browser-security-policy-row" variant="muted">
      <div className="min-w-0">
        <div className="browser-policy-name">{label}</div>
        <div className="browser-policy-value">{summary}</div>
      </div>
      <div className="browser-policy-actions">
        <ActionButton label="Add" onClick={onAdd} />
        <ActionButton label="Clear" onClick={onClear} disabled={values.length === 0} />
      </div>
    </InspectorRow>
  )
}

function ActionButton({
  label,
  onClick,
  disabled = false,
  dataTestId
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  dataTestId?: string
}): JSX.Element {
  return (
    <Button
      disabled={disabled}
      dataTestId={dataTestId}
      className="browser-inspector-action-button"
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

function SmallNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <label className="space-y-0.5">
      <span className="block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="w-full rounded-md px-1 py-1 text-xs outline-none"
        style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
      />
    </label>
  )
}

function normalizeWorkbench(state: BrowserWorkbenchState | undefined, initialUrl: string): BrowserWorkbenchState {
  const tabs = state?.tabs?.length
    ? state.tabs
    : [{ ...DEFAULT_TAB, url: initialUrl, title: initialUrl ? shortUrl(initialUrl) : 'New tab' }]
  return {
    findVisible: state?.findVisible ?? false,
    findQuery: state?.findQuery ?? '',
    zoomFactor: state?.zoomFactor ?? 1,
    deviceMode: state?.deviceMode ?? 'desktop',
    viewportWidth: state?.viewportWidth ?? 1280,
    viewportHeight: state?.viewportHeight ?? 720,
    browserUseActive: state?.browserUseActive ?? false,
    browserUseTurnId: state?.browserUseTurnId ?? null,
    browserUseViewportSize: normalizeBrowserUseSurfaceSize(state?.browserUseViewportSize ?? null),
    browserUseCaptureSurfaceSize: normalizeBrowserUseSurfaceSize(state?.browserUseCaptureSurfaceSize ?? null),
    browserUseCaptureBounds: normalizeBrowserUseSurfaceBounds(state?.browserUseCaptureBounds ?? null),
    browserUseCursorState: normalizeBrowserUseCursorState(state?.browserUseCursorState ?? null),
    webviewTransferSourceHostId: normalizeBrowserTransferHostId(state?.webviewTransferSourceHostId ?? null),
    webviewTransferTargetHostId: normalizeBrowserTransferHostId(state?.webviewTransferTargetHostId ?? null),
    webviewTransferId: typeof state?.webviewTransferId === 'string' && state.webviewTransferId.trim() ? state.webviewTransferId : null,
    commentMode: state?.commentMode ?? false,
    commentCoachmarkDismissed: state?.commentCoachmarkDismissed ?? false,
    commentPreviewOriginal: state?.commentPreviewOriginal ?? false,
    visible: state?.visible ?? true,
    activeTabId: tabs.some((tab) => tab.id === state?.activeTabId) ? state!.activeTabId : tabs[0].id,
    tabs,
    history: state?.history ?? [],
    nextTabIndex: Math.max(state?.nextTabIndex ?? 2, tabs.length + 1),
    inspectorOpen: state?.inspectorOpen ?? false,
    inspectorMode: state?.inspectorMode ?? 'console',
    approvalMode: state?.approvalMode ?? 'alwaysAsk',
    historyApprovalMode: state?.historyApprovalMode ?? 'alwaysAsk',
    downloadApprovalMode: state?.downloadApprovalMode ?? 'alwaysAsk',
    uploadApprovalMode: state?.uploadApprovalMode ?? 'alwaysAsk',
    allowedOrigins: state?.allowedOrigins ?? ['localhost', '127.0.0.1'],
    blockedOrigins: state?.blockedOrigins ?? [],
    allowedDownloadOrigins: state?.allowedDownloadOrigins ?? [],
    blockedDownloadOrigins: state?.blockedDownloadOrigins ?? [],
    allowedUploadOrigins: state?.allowedUploadOrigins ?? [],
    blockedUploadOrigins: state?.blockedUploadOrigins ?? [],
    hiddenLocalTargets: state?.hiddenLocalTargets ?? [],
    localServerRoutes: normalizeLocalServerRoutes(state?.localServerRoutes ?? []),
    hiddenLocalServerRoutes: normalizeHiddenLocalServerRoutes(state?.hiddenLocalServerRoutes ?? [])
  }
}

function browserPolicyWorkbenchPatch(policy: BrowserUsePolicy): Partial<BrowserWorkbenchState> {
  return {
    approvalMode: policy.approvalMode,
    historyApprovalMode: policy.historyApprovalMode,
    downloadApprovalMode: policy.downloadApprovalMode,
    uploadApprovalMode: policy.uploadApprovalMode,
    allowedOrigins: policy.allowedOrigins,
    blockedOrigins: policy.blockedOrigins,
    allowedDownloadOrigins: policy.allowedDownloadOrigins,
    blockedDownloadOrigins: policy.blockedDownloadOrigins,
    allowedUploadOrigins: policy.allowedUploadOrigins,
    blockedUploadOrigins: policy.blockedUploadOrigins
  }
}

function browserWorkbenchHasDefaultPolicy(workbench: BrowserWorkbenchState): boolean {
  return browserWorkbenchPolicyEquals(workbench, DEFAULT_BROWSER_USE_POLICY)
}

function browserWorkbenchPolicyEquals(workbench: BrowserWorkbenchState, policy: BrowserUsePolicy): boolean {
  return workbench.approvalMode === policy.approvalMode &&
    workbench.historyApprovalMode === policy.historyApprovalMode &&
    workbench.downloadApprovalMode === policy.downloadApprovalMode &&
    workbench.uploadApprovalMode === policy.uploadApprovalMode &&
    stringArrayEqual(workbench.allowedOrigins, policy.allowedOrigins) &&
    stringArrayEqual(workbench.blockedOrigins, policy.blockedOrigins) &&
    stringArrayEqual(workbench.allowedDownloadOrigins, policy.allowedDownloadOrigins) &&
    stringArrayEqual(workbench.blockedDownloadOrigins, policy.blockedDownloadOrigins) &&
    stringArrayEqual(workbench.allowedUploadOrigins, policy.allowedUploadOrigins) &&
    stringArrayEqual(workbench.blockedUploadOrigins, policy.blockedUploadOrigins)
}

function stringArrayEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeBrowserTransferHostId(hostId: string | null | undefined): string | null {
  if (typeof hostId !== 'string') return null
  const trimmed = hostId.trim()
  return trimmed ? trimmed : null
}

function normalizeBrowserUseSurfaceSize(size: BrowserUseSurfaceSize | null | undefined): BrowserUseSurfaceSize | null {
  if (size == null) return null
  return {
    width: clampViewportSize(size.width, 'width'),
    height: clampViewportSize(size.height, 'height')
  }
}

function normalizeBrowserUseSurfaceBounds(bounds: BrowserUseSurfaceBounds | null | undefined): BrowserUseSurfaceBounds | null {
  if (bounds == null) return null
  const x = Number.isFinite(bounds.x) ? Math.max(0, Math.round(bounds.x)) : 0
  const y = Number.isFinite(bounds.y) ? Math.max(0, Math.round(bounds.y)) : 0
  const scale = Number(bounds.scale)
  return {
    x,
    y,
    width: clampViewportSize(bounds.width, 'width'),
    height: clampViewportSize(bounds.height, 'height'),
    ...(Number.isFinite(scale) && scale > 0 ? { scale: Math.round(scale * 1000) / 1000 } : {})
  }
}

function normalizeLocalServerRoutes(routes: BrowserLocalServerRoute[] | null | undefined): BrowserLocalServerRoute[] {
  if (!Array.isArray(routes)) return []
  const normalized = new Map<string, BrowserLocalServerRoute>()
  for (const route of routes) {
    if (!route || typeof route !== 'object') continue
    const url = normalizeLocalRouteUrl(route.url)
    const serverUrl = normalizeLocalRouteUrl(route.serverUrl)
    if (!url || !serverUrl) continue
    normalized.set(url, {
      serverUrl,
      url,
      title: typeof route.title === 'string' ? route.title : null,
      source: route.source === 'history' || route.source === 'manual' ? route.source : 'provider'
    })
  }
  return [...normalized.values()].sort((left, right) => left.serverUrl.localeCompare(right.serverUrl) || left.url.localeCompare(right.url))
}

function normalizeHiddenLocalServerRoutes(routes: string[] | null | undefined): string[] {
  if (!Array.isArray(routes)) return []
  return [...new Set(routes.map(normalizeLocalRouteUrl).filter((url): url is string => Boolean(url)))].sort()
}

function localServerRoutesForTarget(target: LocalBrowserTarget, workbench: BrowserWorkbenchState): BrowserLocalServerRoute[] {
  const hiddenRoutes = new Set(workbench.hiddenLocalServerRoutes)
  const routes = new Map<string, BrowserLocalServerRoute>()
  const addRoute = (route: BrowserLocalServerRoute): void => {
    if (hiddenRoutes.has(route.url) || route.url === target.url || !sameLocalOrigin(route.url, target.url)) return
    routes.set(route.url, route)
  }
  for (const route of workbench.localServerRoutes) addRoute(route)
  for (const historyEntry of workbench.history) {
    const routeUrl = normalizeLocalRouteUrl(historyEntry.url)
    if (!routeUrl) continue
    addRoute({
      serverUrl: target.url,
      url: routeUrl,
      title: historyEntry.title,
      source: 'history'
    })
  }
  return [...routes.values()].sort((left, right) => left.url.localeCompare(right.url)).slice(0, 4)
}

function normalizeLocalRouteUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname
    if (hostname === '0.0.0.0') parsed.hostname = '127.0.0.1'
    else if (!isLoopbackRouteHostname(hostname)) return null
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function isLoopbackRouteHostname(hostname: string): boolean {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
}

function sameLocalOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function routePathLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname || '/'}${parsed.search}` || '/'
  } catch {
    return shortUrl(url)
  }
}

function browserVisibleGeometryForStage(
  rect: DOMRect,
  viewport: { width: number | string; height: number | string },
  devicePreviewActive: boolean
): BrowserVisibleGeometry {
  const stageBounds = roundSurfaceBounds({
    x: rect.x,
    y: rect.y,
    width: Math.max(0, rect.width),
    height: Math.max(0, rect.height),
    scale: 1
  })
  const logicalWidth = typeof viewport.width === 'number' ? viewport.width : Math.max(1, Math.round(rect.width))
  const logicalHeight = typeof viewport.height === 'number' ? viewport.height : Math.max(1, Math.round(rect.height))
  const scale = devicePreviewActive
    ? Math.min(
        1,
        Math.max(0, rect.width - BROWSER_STAGE_MARGIN_X * 2) / logicalWidth,
        Math.max(0, rect.height - BROWSER_STAGE_MARGIN_BOTTOM) / logicalHeight
      )
    : 1
  const safeScale = Number.isFinite(scale) && scale > 0 ? Math.round(scale * 1000) / 1000 : 1
  const visualWidth = devicePreviewActive ? Math.round(logicalWidth * safeScale) : Math.round(rect.width)
  const visualHeight = devicePreviewActive ? Math.round(logicalHeight * safeScale) : Math.round(rect.height)
  const visualX = Math.round(rect.x + (devicePreviewActive ? Math.max(BROWSER_STAGE_MARGIN_X, (rect.width - visualWidth) / 2) : 0))
  const visualY = Math.round(rect.y)
  return {
    stageBounds,
    visualBounds: {
      x: visualX,
      y: visualY,
      width: Math.max(1, visualWidth),
      height: Math.max(1, visualHeight),
      scale: safeScale
    },
    webviewBounds: {
      x: visualX,
      y: visualY,
      width: Math.max(1, Math.round(logicalWidth)),
      height: Math.max(1, Math.round(logicalHeight)),
      scale: safeScale
    },
    scale: safeScale
  }
}

function roundSurfaceBounds(bounds: BrowserUseSurfaceBounds): BrowserUseSurfaceBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    ...(bounds.scale == null ? {} : { scale: Math.round(bounds.scale * 1000) / 1000 })
  }
}

function browserVisibleGeometryEqual(left: BrowserVisibleGeometry | null, right: BrowserVisibleGeometry | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.scale === right.scale &&
    browserSurfaceBoundsEqual(left.stageBounds, right.stageBounds) &&
    browserSurfaceBoundsEqual(left.visualBounds, right.visualBounds) &&
    browserSurfaceBoundsEqual(left.webviewBounds, right.webviewBounds)
}

function browserSurfaceBoundsEqual(left: BrowserUseSurfaceBounds, right: BrowserUseSurfaceBounds): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    (left.scale ?? 1) === (right.scale ?? 1)
}

function normalizeBrowserUseCursorState(state: BrowserUseCursorState | null | undefined): BrowserUseCursorState | null {
  if (state == null) return null
  const x = Number.isFinite(state.x) ? Math.max(0, Math.round(state.x)) : 0
  const y = Number.isFinite(state.y) ? Math.max(0, Math.round(state.y)) : 0
  return {
    ...(state.animateMovement == null ? {} : { animateMovement: state.animateMovement }),
    ...(state.moveSequence == null ? {} : { moveSequence: state.moveSequence }),
    visible: state.visible,
    x,
    y
  }
}

function addArtifactToChat(path: string | null): void {
  if (!path) return
  window.dispatchEvent(new CustomEvent('orchestrator:add-composer-attachment', {
    detail: {
      path,
      name: fileNameFromPath(path)
    }
  }))
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}

function sortLocalTargets(targets: LocalBrowserTarget[], sort: 'recent' | 'port'): LocalBrowserTarget[] {
  return [...targets].sort((left, right) => {
    if (sort === 'recent' && left.source !== right.source) {
      return left.source === 'recent' ? -1 : 1
    }
    const leftPort = portFromUrl(left.url)
    const rightPort = portFromUrl(right.url)
    if (leftPort !== rightPort) return leftPort - rightPort
    return left.url.localeCompare(right.url)
  })
}

function portFromUrl(url: string): number {
  try {
    const parsed = new URL(url)
    return Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

function activeBrowserTab(workbench: BrowserWorkbenchState): BrowserTabState {
  return workbench.tabs.find((tab) => tab.id === workbench.activeTabId) ?? workbench.tabs[0] ?? DEFAULT_TAB
}

function browserTabsWithWebviews(workbench: BrowserWorkbenchState): BrowserTabState[] {
  return workbench.tabs.filter((tab) => tab.url)
}

function browserViewport(workbench: BrowserWorkbenchState): { width: number | string; height: number | string } {
  if (workbench.deviceMode === 'desktop') return { width: '100%', height: '100%' }
  return {
    width: clampViewportSize(workbench.viewportWidth, 'width'),
    height: clampViewportSize(workbench.viewportHeight, 'height')
  }
}

function viewportPreset(
  mode: BrowserWorkbenchState['deviceMode'],
  currentWidth: number,
  currentHeight: number
): { width: number; height: number } {
  switch (mode) {
    case 'desktop':
      return { width: 1280, height: 720 }
    case 'mobile':
      return { width: 393, height: 852 }
    case 'iphoneSe':
      return { width: 375, height: 667 }
    case 'iphone15ProMax':
      return { width: 430, height: 932 }
    case 'pixel':
      return { width: 412, height: 915 }
    case 'galaxyS24Ultra':
      return { width: 384, height: 824 }
    case 'ipadMini':
      return { width: 768, height: 1024 }
    case 'ipad':
      return { width: 820, height: 1180 }
    case 'surfaceDuo':
      return { width: 540, height: 720 }
    case 'surfacePro7':
      return { width: 912, height: 1368 }
    case 'laptop':
      return { width: 1024, height: 768 }
    case 'laptopLarge':
      return { width: 1440, height: 900 }
    case 'desktop4k':
      return { width: 2560, height: 1440 }
    case 'custom':
      return {
        width: clampViewportSize(currentWidth, 'width'),
        height: clampViewportSize(currentHeight, 'height')
      }
  }
}

function clampViewportSize(value: number, axis: 'width' | 'height'): number {
  const min = axis === 'width' ? MIN_VIEWPORT_SIZE.width : MIN_VIEWPORT_SIZE.height
  const max = axis === 'width' ? MAX_VIEWPORT_SIZE.width : MAX_VIEWPORT_SIZE.height
  return Math.min(max, Math.max(min, Math.round(value)))
}

function sessionIdFromBrowserHost(hostId: string): string | null {
  const match = /^right:(.+):browser$/.exec(hostId)
  return match?.[1] ?? null
}

function waitForActiveWebview(
  webviewRef: MutableRefObject<WebviewElement | null>,
  timeoutMs: number
): Promise<WebviewElement | null> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const poll = (): void => {
      if (webviewRef.current) {
        resolve(webviewRef.current)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null)
        return
      }
      window.setTimeout(poll, 50)
    }
    poll()
  })
}

function waitForWebviewSettled(webview: WebviewElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      webview.removeEventListener('did-stop-loading', finish)
      webview.removeEventListener('did-fail-load', finish)
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, timeoutMs)
    webview.addEventListener('did-stop-loading', finish)
    webview.addEventListener('did-fail-load', finish)
  })
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || /^(about|data|file|mailto):/i.test(trimmed)) return trimmed
  if (looksLikeBrowserAddress(trimmed)) return `http://${trimmed}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

function browserAddressBadge(value: string): { kind: string; label: string; ariaLabel: string; icon: Parameters<typeof Icon>[0]['name'] } {
  const trimmed = value.trim()
  if (!trimmed) return { kind: 'empty', label: 'URL', ariaLabel: 'No page loaded', icon: 'browser' }
  if (trimmed.startsWith('https://')) return { kind: 'secure', label: 'Secure', ariaLabel: 'Secure HTTPS page', icon: 'checkCircle' }
  if (trimmed.startsWith('file:')) return { kind: 'file', label: 'File', ariaLabel: 'Local file page', icon: 'file' }
  if (trimmed.startsWith('data:')) return { kind: 'data', label: 'Data', ariaLabel: 'Data URL page', icon: 'file' }
  if (trimmed.startsWith('about:')) return { kind: 'page', label: 'Page', ariaLabel: 'Internal browser page', icon: 'browser' }
  try {
    const url = new URL(trimmed)
    const host = url.hostname
    const local = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1'
    if (local) return { kind: 'local', label: 'Local', ariaLabel: 'Local development page', icon: 'browser' }
    const protocol = url.protocol.replace(':', '').toUpperCase()
    return { kind: 'plain', label: protocol, ariaLabel: `${protocol} page`, icon: 'warning' }
  } catch {
    return { kind: 'search', label: 'Search', ariaLabel: 'Search query', icon: 'search' }
  }
}

function looksLikeBrowserAddress(value: string): boolean {
  if (/\s/.test(value)) return false
  const hostSegment = value.split(/[/?#]/, 1)[0] ?? value
  const hostWithoutPort = hostSegment
    .replace(/^\[/, '')
    .replace(/\](:\d+)?$/, '')
    .replace(/:\d+$/, '')
  return (
    hostSegment === 'localhost' ||
    hostSegment.startsWith('localhost:') ||
    hostSegment.startsWith('127.') ||
    hostSegment.startsWith('0.0.0.0') ||
    hostSegment.startsWith('[::1]') ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(hostSegment) ||
    /^[a-z0-9-]+:\d+$/i.test(hostSegment) ||
    hostWithoutPort.includes('.')
  )
}

function safeOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.origin
  } catch {
    return null
  }
}

function originKey(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '')
  } catch {
    return origin.replace(/^https?:\/\//, '').replace(/^www\./, '')
  }
}

function shortUrl(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname + parsed.pathname.replace(/\/$/, '')
  } catch {
    return url
  }
}

function urlHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function commentUnavailableReason(url: string, visible: boolean, error: string | null): string {
  if (!url) return 'Open a page before leaving visual comments.'
  if (!visible) return 'Show the browser surface before leaving visual comments.'
  if (error) return 'Resolve the page load error before leaving visual comments.'
  return ''
}

function loadErrorSummary(error: string, host: string): string {
  const normalized = error.toLowerCase()
  if (normalized.includes('refused')) return `${host} refused the connection.`
  if (normalized.includes('not found') || normalized.includes('dns')) return `${host} could not be resolved.`
  if (normalized.includes('timeout') || normalized.includes('timed out')) return `${host} took too long to respond.`
  if (normalized.includes('certificate') || normalized.includes('cert')) return `${host}'s certificate could not be verified.`
  if (normalized.includes('offline') || normalized.includes('internet')) return `${host} could not be reached from this network.`
  return `${host} could not be reached.`
}

function loadErrorSuggestions(error: string): string[] {
  const normalized = error.toLowerCase()
  if (normalized.includes('refused')) {
    return ['Start the local server', 'Check the port in the address bar', 'Retry when the process is ready']
  }
  if (normalized.includes('not found') || normalized.includes('dns')) {
    return ['Check the hostname', 'Use localhost for local apps', 'Verify DNS or VPN settings']
  }
  if (normalized.includes('certificate') || normalized.includes('cert')) {
    return ['Open externally to inspect certificate details', 'Use http for local dev servers', 'Check system trust settings']
  }
  return ['Check your connection', 'Retry without cache', 'Open externally if the site blocks embedded browsers']
}

function consoleLevel(level?: number): BrowserLogEntry['level'] {
  if (level === 3) return 'error'
  if (level === 2) return 'warn'
  if (level === 1) return 'info'
  return 'log'
}

function logColor(level: BrowserLogEntry['level']): string {
  if (level === 'error') return 'var(--state-danger)'
  if (level === 'warn') return 'var(--state-warning)'
  return 'var(--text-tertiary)'
}

const DOM_SNAPSHOT_SCRIPT = `
(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const labelFor = (element) => {
    const aria = element.getAttribute('aria-label');
    if (aria) return aria;
    const text = (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text.slice(0, 90);
    return element.getAttribute('placeholder') || element.getAttribute('title') || element.id || '';
  };
  const nodes = [...document.querySelectorAll('main, header, nav, section, article, h1, h2, h3, button, a, input, textarea, select, [role]')]
    .filter((element) => element instanceof HTMLElement && visible(element))
    .slice(0, 80)
    .map((element) => {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role');
      const label = labelFor(element);
      return '<' + tag + (role ? ' role="' + role + '"' : '') + (label ? '> ' + label : '>');
    });
  return nodes.join('\\n');
})()
`

const VISIBLE_TARGETS_SCRIPT = `
(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };
  const targetSelector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [tabindex], [contenteditable="true"]';
  window.__orchestratorBrowserTargets = [];
  const targets = [...document.querySelectorAll(targetSelector)]
    .filter((element) => element instanceof HTMLElement && visible(element))
    .slice(0, 80)
    .map((element, index) => {
      const nodeId = 'node-' + (index + 1);
      element.dataset.orchestratorNodeId = nodeId;
      const rect = element.getBoundingClientRect();
      const text = (element.innerText || element.textContent || element.value || '').replace(/\\s+/g, ' ').trim();
      const ariaName = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || null;
      const candidates = [];
      if (element.id) candidates.push('#' + cssEscape(element.id));
      if (element.getAttribute('data-testid')) candidates.push('[data-testid="' + element.getAttribute('data-testid') + '"]');
      if (ariaName) candidates.push(element.tagName.toLowerCase() + '[aria-label="' + ariaName.replace(/"/g, '\\"') + '"]');
      candidates.push('[data-orchestrator-node-id="' + nodeId + '"]');
      const preview = [element.tagName.toLowerCase(), element.getAttribute('role'), ariaName, text].filter(Boolean).join(' · ').slice(0, 120);
      return {
        nodeId,
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        ariaName,
        visibleText: text || null,
        preview,
        boundingBox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        selector: { primary: candidates[0] || null, candidates }
      };
    });
  window.__orchestratorBrowserTargets = targets;
  window.__orchestratorBrowserAction = async ({ action, nodeId, text, x, y, scrollY }) => {
    const element = nodeId ? document.querySelector('[data-orchestrator-node-id="' + nodeId + '"]') : document.elementFromPoint(x || 0, y || 0);
    if (action === 'scroll') {
      if (element && nodeId) element.scrollBy({ top: scrollY || y || 240, behavior: 'instant' });
      else window.scrollBy({ top: scrollY || 240, left: 0, behavior: 'instant' });
      return true;
    }
    if (!element) return false;
    if (action === 'double_click') {
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
      return true;
    }
    if (action === 'type') {
      element.focus();
      if ('value' in element) {
        element.value = String(element.value || '') + (text || '');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, text || '');
      }
      return true;
    }
    if (action === 'fill') {
      element.focus();
      if ('value' in element) {
        element.value = text || '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, text || '');
      }
      return true;
    }
    if (action === 'key') {
      const key = text || 'Enter';
      const eventInit = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, bubbles: true, cancelable: true };
      element.focus();
      element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      return true;
    }
    if (action === 'select') {
      if (element instanceof HTMLSelectElement) {
        const option = [...element.options].find((item) => item.value === text || item.textContent?.trim() === text);
        if (!option) return false;
        element.value = option.value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }
    if (action === 'check') {
      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        const normalized = String(text || 'true').trim().toLowerCase();
        element.checked = !['0', 'false', 'off', 'no', 'unchecked'].includes(normalized);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }
    if (action === 'read') {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const disabled = element.disabled === true || element.getAttribute('aria-disabled') === 'true';
      return {
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        ariaName: element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || null,
        text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim() || null,
        value: 'value' in element ? String(element.value || '') : null,
        href: element instanceof HTMLAnchorElement ? element.href : null,
        checked: element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio') ? element.checked : null,
        enabled: !disabled,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        selector: element.dataset.orchestratorNodeId ? '[data-orchestrator-node-id="' + element.dataset.orchestratorNodeId + '"]' : null
      };
    }
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  };
  return targets;
})()
`

const PAGE_ASSETS_SCRIPT = `
(() => {
  const byUrl = new Map();
  const inferKind = (url, initiatorType, element) => {
    const lower = String(url || '').toLowerCase();
    if (initiatorType === 'img' || element?.tagName === 'IMG' || /\\.(png|jpe?g|gif|webp|svg|bmp|ico)(\\?|#|$)/.test(lower)) return 'image';
    if (initiatorType === 'css' || element?.rel === 'stylesheet' || /\\.css(\\?|#|$)/.test(lower)) return 'stylesheet';
    if (initiatorType === 'script' || element?.tagName === 'SCRIPT' || /\\.m?js(\\?|#|$)/.test(lower)) return 'script';
    if (initiatorType === 'video' || element?.tagName === 'VIDEO' || /\\.(mp4|mov|webm|m4v)(\\?|#|$)/.test(lower)) return 'video';
    if (/\\.(woff2?|ttf|otf)(\\?|#|$)/.test(lower)) return 'font';
    return 'other';
  };
  const nameFor = (url, fallback) => {
    try {
      const parsed = new URL(url, location.href);
      return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname || fallback);
    } catch {
      return fallback;
    }
  };
  const add = (url, kind, source) => {
    if (!url) return;
    const absolute = new URL(url, location.href).href;
    const existing = byUrl.get(absolute);
    if (existing) {
      existing.sources.push(source);
      return;
    }
    const id = 'asset-' + (byUrl.size + 1);
    byUrl.set(absolute, { id, kind, name: nameFor(absolute, id), url: absolute, sources: [source] });
  };
  performance.getEntriesByType('resource').forEach((entry) => add(entry.name, inferKind(entry.name, entry.initiatorType), { kind: 'resource', property: entry.initiatorType }));
  document.querySelectorAll('img[src], source[src], video[src], script[src], link[href], [style*="url("]').forEach((element) => {
    const tag = element.tagName;
    const url = element.getAttribute('src') || element.getAttribute('href');
    if (url) add(url, inferKind(url, '', element), { kind: 'attribute', property: tag });
    const style = element.getAttribute('style') || '';
    const matches = [...style.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)];
    matches.forEach((match) => add(match[1], inferKind(match[1], '', element), { kind: 'computedStyle', property: 'style' }));
  });
  const inlineSvgs = [...document.querySelectorAll('svg')].slice(0, 40).map((svg, index) => ({
    id: 'inline-svg-' + (index + 1),
    name: svg.getAttribute('aria-label') || svg.id || 'Inline SVG ' + (index + 1),
    markup: svg.outerHTML.slice(0, 50000)
  }));
  const assets = [...byUrl.values()];
  const byKind = assets.reduce((acc, asset) => {
    acc[asset.kind] = (acc[asset.kind] || 0) + 1;
    return acc;
  }, {});
  return {
    id: 'inventory-' + Date.now(),
    pageUrl: location.href,
    assets,
    inlineSvgs,
    summary: {
      totalCount: assets.length,
      inlineSvgCount: inlineSvgs.length,
      byKind
    }
  };
})()
`
