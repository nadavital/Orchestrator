import { createElement, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { BrowserApprovalMode, BrowserDeviceMode, BrowserHistoryEntry, BrowserTabState, BrowserWorkbenchState } from '../../store/sessions'
import { Badge, Button, IconButton, MenuSurface, ToolbarButton, WorkbenchSearchField } from '../shared/designSystem'
import Icon from '../shared/Icon'

interface Props {
  initialUrl?: string
  embedded?: boolean
  onUrlChange?: (url: string) => void
  browserState?: BrowserWorkbenchState
  onBrowserStateChange?: (patch: Partial<BrowserWorkbenchState>) => void
}

type WebviewElement = HTMLElement & {
  loadURL: (url: string) => Promise<void> | void
  reload: () => void
  reloadIgnoringCache: () => void
  stop?: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
  setZoomFactor: (factor: number) => void
  getZoomFactor?: () => number
  capturePage: () => Promise<{ toDataURL: () => string }>
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
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

type BrowserTargetAction = 'click' | 'double_click' | 'type' | 'fill' | 'key' | 'select' | 'check' | 'read' | 'scroll'
type BrowserClearDataKind = 'all' | 'cache' | 'cookies' | 'siteData'
type BrowserInspectorMode = BrowserWorkbenchState['inspectorMode']

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

export default function BrowserPanel({
  initialUrl = '',
  embedded = false,
  onUrlChange,
  browserState,
  onBrowserStateChange
}: Props): JSX.Element {
  const workbench = normalizeWorkbench(browserState, initialUrl)
  const workbenchRef = useRef(workbench)
  const webviewRef = useRef<WebviewElement | null>(null)
  const pendingCacheReloadRef = useRef(false)
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
  const [localTargetSort, setLocalTargetSort] = useState<'recent' | 'port'>('recent')
  const [localTargetView, setLocalTargetView] = useState<'online' | 'hidden'>('online')
  const activeTab = activeBrowserTab(workbench)
  const visible = workbench.visible
  const viewport = browserViewport(workbench)
  const urlOrigin = safeOrigin(currentUrl)
  const blocked = Boolean(urlOrigin && workbench.blockedOrigins.includes(originKey(urlOrigin)))
  const devicePreviewActive = workbench.deviceMode !== 'desktop'
  const showStatusRow = isLoading || blocked || devicePreviewActive
  const sortedLocalTargets = sortLocalTargets(localTargets, localTargetSort)
  const hiddenLocalTargetUrls = new Set(workbench.hiddenLocalTargets)
  const visibleLocalTargets = sortedLocalTargets.filter((target) => !hiddenLocalTargetUrls.has(target.url))
  const hiddenLocalTargets = sortedLocalTargets.filter((target) => hiddenLocalTargetUrls.has(target.url))
  const shownLocalTargets = localTargetView === 'hidden' ? hiddenLocalTargets : visibleLocalTargets
  const addressBadge = browserAddressBadge(currentUrl || address)
  useEffect(() => {
    workbenchRef.current = workbench
  }, [workbench])

  useEffect(() => {
    if (localTargetView === 'hidden' && hiddenLocalTargets.length === 0) {
      setLocalTargetView('online')
    }
  }, [hiddenLocalTargets.length, localTargetView])

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
  }, [workbench.activeTabId, initialUrl])

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

  const hideLocalTarget = (url: string): void => {
    patchWorkbench({ hiddenLocalTargets: Array.from(new Set([...workbenchRef.current.hiddenLocalTargets, url])) })
  }

  const unhideLocalTarget = (url: string): void => {
    patchWorkbench({ hiddenLocalTargets: workbenchRef.current.hiddenLocalTargets.filter((targetUrl) => targetUrl !== url) })
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
    patchWorkbench({ tabs, activeTabId })
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
    await window.api.browser.clearData(kind)
    setLastClearDataKind(kind)
    setClearDataCount((count) => count + 1)
    setBrowserMenuOpen(false)
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

  const webview = currentUrl && visible
    ? createElement('webview', {
        ref: (node: WebviewElement | null) => {
          webviewRef.current = node
        },
        src: currentUrl,
        partition: 'persist:orchestrator-side-browser',
        'data-testid': 'browser-webview',
        onContextMenu: openPageContextMenu,
        style: {
          flex: 1,
          minHeight: 0,
          width: '100%',
          background: 'white'
        }
      })
    : null

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
      data-testid="browser-panel"
      data-browser-zoom={workbench.zoomFactor.toFixed(2)}
      data-browser-device-mode={workbench.deviceMode}
      data-browser-viewport-width={workbench.viewportWidth}
      data-browser-viewport-height={workbench.viewportHeight}
      data-browser-cache-reloads={cacheReloadCount}
      data-browser-clear-data={clearDataCount}
      data-browser-clear-data-kind={lastClearDataKind}
      data-browser-find-matches={findMatches}
      data-browser-find-active-match={findActiveMatch}
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
        <div className="browser-tab-strip" data-testid="browser-tab-strip">
          {workbench.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid="browser-tab"
              data-active={tab.id === workbench.activeTabId ? 'true' : 'false'}
              className="browser-tab"
              style={{
                background: tab.id === workbench.activeTabId ? 'var(--surface-bg)' : 'transparent',
                borderColor: tab.id === workbench.activeTabId ? 'var(--border-subtle)' : 'transparent',
                color: 'var(--text-primary)'
              }}
              onClick={() => selectTab(tab.id)}
            >
              <Icon name="browser" size={12} />
              <span className="min-w-0 flex-1 truncate">{tab.title || shortUrl(tab.url) || 'New tab'}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${tab.title || shortUrl(tab.url) || 'browser'} tab`}
                data-testid="browser-tab-close"
                className="browser-tab-close"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <Icon name="close" size={10} />
              </span>
            </button>
          ))}
        </div>
      )}

      <form
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
        <IconButton icon="plus" label="New browser tab" size="sm" onClick={newTab} dataTestId="browser-new-tab" />
        <div className="browser-address-field">
          <span
            className="browser-address-badge"
            data-testid="browser-address-badge"
            data-browser-address-kind={addressBadge.kind}
            aria-label={addressBadge.ariaLabel}
          >
            <Icon name={addressBadge.icon} size={12} />
            <span>{addressBadge.label}</span>
          </span>
          <input
            data-testid="browser-url-input"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Search or enter URL"
            className="browser-address-input"
          />
        </div>
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
              <div className="browser-action-section" data-testid="browser-page-actions">
                <div className="browser-action-label">Page</div>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Reload without cache"
                  className="browser-action-row"
                  disabled={!currentUrl || !visible}
                  onClick={reloadWithoutCache}
                >
                  <Icon name="eraser" size={14} />
                  <span>Hard reload</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Capture screenshot"
                  data-testid="browser-menu-capture-screenshot"
                  className="browser-action-row"
                  disabled={!currentUrl || isLoading || !visible}
                  onClick={() => {
                    setBrowserMenuOpen(false)
                    void captureScreenshot()
                  }}
                >
                  <Icon name="camera" size={14} />
                  <span>Screenshot</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Copy browser URL"
                  className="browser-action-row"
                  disabled={!currentUrl}
                  onClick={() => {
                    void navigator.clipboard.writeText(currentUrl)
                    setBrowserMenuOpen(false)
                  }}
                >
                  <Icon name="copy" size={14} />
                  <span>Copy URL</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Open external browser"
                  data-testid="browser-menu-open-external"
                  className="browser-action-row"
                  disabled={!currentUrl}
                  onClick={() => {
                    setBrowserMenuOpen(false)
                    openExternal()
                  }}
                >
                  <Icon name="external" size={14} />
                  <span>Open in browser</span>
                </button>
              </div>
              <div className="browser-action-section" data-testid="browser-data-actions">
                <div className="browser-action-label">Data</div>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Clear browser cache"
                  className="browser-action-row"
                  disabled={!visible}
                  data-testid="browser-clear-cache"
                  onClick={() => void clearBrowserData('cache')}
                >
                  <Icon name="eraser" size={14} />
                  <span>Clear cache</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Clear browser cookies"
                  className="browser-action-row"
                  disabled={!visible}
                  data-testid="browser-clear-cookies"
                  onClick={() => void clearBrowserData('cookies')}
                >
                  <Icon name="eraser" size={14} />
                  <span>Clear cookies</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Clear browser site data"
                  className="browser-action-row"
                  disabled={!visible}
                  data-testid="browser-clear-site-data"
                  onClick={() => void clearBrowserData('siteData')}
                >
                  <Icon name="eraser" size={14} />
                  <span>Clear site data</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Clear all browser data"
                  className="browser-action-row"
                  disabled={!visible}
                  data-testid="browser-clear-data"
                  onClick={() => void clearBrowserData('all')}
                >
                  <Icon name="eraser" size={14} />
                  <span>Clear all data</span>
                </button>
              </div>
              {workbench.history.length > 0 && (
                <div className="browser-action-section" data-testid="browser-history-menu">
                  <div className="browser-action-label">History</div>
                  {workbench.history.slice(0, 5).map((item) => (
                    <button
                      key={`${item.url}-${item.visitedAt}`}
                      type="button"
                      role="menuitem"
                      data-testid="browser-history-item"
                      className="browser-action-row browser-history-row"
                      onClick={() => {
                        setBrowserMenuOpen(false)
                        navigate(item.url)
                      }}
                    >
                      <Icon name="clock" size={13} />
                      <span className="min-w-0 flex-1 truncate">{item.title || shortUrl(item.url) || item.url}</span>
                      <span className="browser-history-url min-w-0 truncate">{shortUrl(item.url)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="browser-action-section">
                <div className="browser-action-label">View</div>
                <div className="browser-action-row browser-action-row-static">
                  <Icon name="zoomOut" size={13} />
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
                </div>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={devicePreviewActive ? 'Reset viewport' : 'Mobile preview'}
                  className="browser-action-row"
                  disabled={!currentUrl}
                  onClick={() => setViewportMode(devicePreviewActive ? 'desktop' : 'mobile')}
                >
                  <Icon name={devicePreviewActive ? 'monitor' : 'smartphone'} size={13} />
                  <span>{devicePreviewActive ? 'Reset viewport' : 'Mobile preview'}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={visible ? 'Hide browser surface' : 'Show browser surface'}
                  className="browser-action-row"
                  onClick={() => patchWorkbench({ visible: !visible })}
                >
                  <Icon name={visible ? 'monitor' : 'close'} size={13} />
                  <span>{visible ? 'Hide surface' : 'Show surface'}</span>
                </button>
              </div>
            </MenuSurface>
          )}
        </div>
      </form>

      {workbench.findVisible && (
        <div className="browser-find-toolbar">
          <WorkbenchSearchField
            value={workbench.findQuery}
            onChange={searchInPage}
            placeholder="Find in page"
            clearLabel="Clear page search"
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
        </div>
      )}

      {showStatusRow && (
        <div className="browser-status-row" data-testid="browser-status-row">
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
                    onChange={(event) => patchWorkbench({ viewportWidth: Number(event.target.value) || 1280 })}
                    className="w-14 rounded-md px-1 py-0.5 text-xs outline-none"
                    style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                  />
                  <input
                    aria-label="Viewport height"
                    value={workbench.viewportHeight}
                    onChange={(event) => patchWorkbench({ viewportHeight: Number(event.target.value) || 720 })}
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
        </div>
      )}

      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateRows: workbench.inspectorOpen ? 'minmax(0, 1fr) 184px' : 'minmax(0, 1fr)' }}
      >
        <div
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
                  className="flex min-h-0 overflow-hidden"
                  style={{
                    width: viewport.width,
                    maxWidth: '100%',
                    height: viewport.height,
                    maxHeight: '100%',
                    borderLeft: workbench.deviceMode !== 'desktop' ? '1px solid var(--border-subtle)' : 'none',
                    borderRight: workbench.deviceMode !== 'desktop' ? '1px solid var(--border-subtle)' : 'none'
                  }}
                >
                  {webview}
                </div>
              )
            ) : (
              <div className="browser-hidden-state" data-testid="browser-hidden-state">
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
                        data-testid="browser-local-target-view"
                        data-local-target-view={localTargetView}
                        onClick={() => setLocalTargetView((view) => view === 'online' ? 'hidden' : 'online')}
                      >
                        {localTargetView === 'online' ? `Hidden ${hiddenLocalTargets.length}` : 'Online'}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="browser-local-target-sort"
                      data-local-target-sort={localTargetSort}
                      onClick={() => setLocalTargetSort((sort) => sort === 'recent' ? 'port' : 'recent')}
                    >
                      {localTargetSort === 'recent' ? 'Recent' : 'Port'}
                    </button>
                    <button type="button" onClick={() => void refreshLocalTargets()}>Refresh</button>
                  </div>
                </div>
                <div className="browser-local-targets-list" aria-live="polite">
                  {shownLocalTargets.length > 0 ? shownLocalTargets.map((target) => (
                    <div
                      key={target.url}
                      className="browser-local-target-row"
                      data-testid={localTargetView === 'hidden' ? 'browser-local-target-hidden' : 'browser-local-target'}
                      data-local-target-url={target.url}
                      data-local-target-source={target.source}
                      data-local-target-status={localTargetView === 'hidden' ? 'hidden' : 'running'}
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
                          <span>{shortUrl(target.url)}</span>
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
                  )) : (
                    <div className="browser-local-targets-empty" data-testid="browser-local-targets-empty">
                      {localTargetsLoading ? 'Looking for servers...' : localTargetView === 'hidden' ? 'No hidden servers' : 'No local servers'}
                    </div>
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
              <button
                type="button"
                role="menuitem"
                className="browser-action-row"
                disabled={!canGoBack}
                data-testid="browser-context-back"
                onClick={() => {
                  webviewRef.current?.goBack()
                  setPageContextMenu(null)
                }}
              >
                <Icon name="arrowLeft" size={14} />
                <span>Back</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="browser-action-row"
                disabled={!canGoForward}
                data-testid="browser-context-forward"
                onClick={() => {
                  webviewRef.current?.goForward()
                  setPageContextMenu(null)
                }}
              >
                <Icon name="arrowRight" size={14} />
                <span>Forward</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="browser-action-row"
                data-testid="browser-context-reload"
                onClick={() => {
                  webviewRef.current?.reload()
                  setPageContextMenu(null)
                }}
              >
                <Icon name="refresh" size={14} />
                <span>Reload</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="browser-action-row"
                data-testid="browser-context-inspect"
                onClick={() => {
                  setPageContextMenu(null)
                  void runInspection()
                }}
              >
                <Icon name="wrench" size={14} />
                <span>Inspect</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="browser-action-row"
                data-testid="browser-context-add-page"
                onClick={() => void addPageContextToChat()}
              >
                <Icon name="chat" size={14} />
                <span>Add page context</span>
              </button>
            </MenuSurface>
          )}
        </div>

        {workbench.inspectorOpen && (
          <div className="browser-inspector-drawer">
            <div className="browser-inspector-toolbar" data-testid="browser-inspector-toolbar">
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
                  dataTestId="browser-refresh-inspection"
                  disabled={!currentUrl || !visible}
                  onClick={runInspection}
                />
                <ToolbarButton
                  icon="close"
                  label="Hide browser inspector"
                  size="sm"
                  dataTestId="browser-hide-inspection"
                  onClick={() => patchWorkbench({ inspectorOpen: false })}
                />
              </div>
            </div>
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
    <div className="browser-load-error" data-testid="browser-load-error">
      <div className="browser-load-error-icon">
        <Icon name="browser" size={22} />
      </div>
      <div className="browser-load-error-copy">
        <div className="browser-load-error-title">Page unavailable</div>
        <div className="browser-load-error-summary">
          {loadErrorSummary(error, host)}
        </div>
        <div className="browser-load-error-code">{error}</div>
      </div>
      <div className="browser-load-error-actions">
        <button type="button" data-testid="browser-load-error-retry" onClick={onRetry}>Retry</button>
        <button type="button" data-testid="browser-load-error-hard-reload" onClick={onHardReload}>Hard reload</button>
        <button type="button" data-testid="browser-load-error-copy-url" onClick={onCopyUrl}>Copy URL</button>
        <button type="button" data-testid="browser-load-error-open-external" onClick={onOpenExternal}>Open in browser</button>
      </div>
      <div className="browser-load-error-suggestions">
        <span>Try</span>
        {suggestions.map((suggestion) => (
          <div key={suggestion}>{suggestion}</div>
        ))}
      </div>
    </div>
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
          <div style={{ color: 'var(--text-tertiary)' }}>No console messages captured.</div>
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
      <div className="browser-target-section">
        <div className="browser-target-section-title">Element</div>
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
          <button
            type="button"
            aria-label="Run target action"
            data-testid="browser-target-run-action"
            className="browser-target-run-button"
            onClick={() => onRunTargetAction(targetAction)}
            disabled={!canRunAction}
          >
            <Icon name="send" size={13} />
            <span className="sr-only">Run</span>
          </button>
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
      </div>
      <div className="browser-target-side-stack">
        <details className="browser-target-secondary-panel" data-testid="browser-target-pointer-panel">
          <summary>Pointer</summary>
          <div className="grid grid-cols-3 gap-1">
            <SmallNumber label="X" value={coordinateAction.x} onChange={(x) => onCoordinateChange({ ...coordinateAction, x })} />
            <SmallNumber label="Y" value={coordinateAction.y} onChange={(y) => onCoordinateChange({ ...coordinateAction, y })} />
            <SmallNumber label="Scroll" value={coordinateAction.scrollY} onChange={(scrollY) => onCoordinateChange({ ...coordinateAction, scrollY })} />
          </div>
          <div className="browser-target-action-row">
            <ActionButton label="Click x/y" onClick={() => onRunCoordinateAction('click')} />
            <ActionButton label="Scroll x/y" onClick={() => onRunCoordinateAction('scroll')} />
          </div>
        </details>
        <details className="browser-target-secondary-panel" data-testid="browser-target-clipboard-panel">
          <summary>Clipboard</summary>
          <div className="flex gap-1">
            <input
              value={clipboardText}
              onChange={(event) => onClipboardChange(event.target.value)}
              placeholder="Clip text"
              className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
              style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            />
            <ActionButton label="Read" onClick={onReadClipboard} />
            <ActionButton label="Write" onClick={onWriteClipboard} />
          </div>
        </details>
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
      <div className="browser-assets-header">
        <div className="min-w-0">
          <div className="browser-target-section-title">Inventory</div>
          <div className="browser-assets-summary">
            <span>{inventory?.summary.totalCount ?? 0} files</span>
            <span>{inventory?.summary.inlineSvgCount ?? 0} inline svg</span>
          </div>
        </div>
        <button
          type="button"
          data-testid="browser-assets-bundle"
          className="browser-assets-bundle"
          disabled={!inventory}
          onClick={onBundle}
        >
          Bundle
        </button>
      </div>
      {bundlePath && (
        <div className="browser-assets-bundle-path" data-testid="browser-assets-bundle-path">
          <span>manifest</span>
          <span>{bundlePath}</span>
        </div>
      )}
      {kindEntries.length > 0 && (
        <div className="browser-assets-kind-grid" data-testid="browser-assets-kind-grid">
          {kindEntries.map(([kind, count]) => (
            <div key={kind} className="browser-assets-kind">
              <span>{kind}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="browser-assets-list" data-testid="browser-assets-list">
        {visibleAssets.length > 0 ? visibleAssets.map((asset) => (
          <div key={asset.id} className="browser-assets-row" data-testid="browser-assets-row">
            <Badge tone="neutral">{asset.kind}</Badge>
            <div className="min-w-0">
              <div className="browser-assets-name">{asset.name}</div>
              <div className="browser-assets-meta">
                <span>{assetOrigin(asset.url)}</span>
                <span>{asset.sources.length} source{asset.sources.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
        )) : (
          <div className="browser-assets-empty" data-testid="browser-assets-empty">
            Inspect a loaded page to collect assets.
          </div>
        )}
      </div>
      {visibleInlineSvgs.length > 0 && (
        <div className="browser-assets-inline" data-testid="browser-inline-svg-list">
          <div className="browser-target-section-title">Inline SVGs</div>
          <div className="browser-assets-list">
            {visibleInlineSvgs.map((asset) => (
              <div key={asset.id} className="browser-assets-row" data-testid="browser-inline-svg-row">
                <Badge tone="neutral">svg</Badge>
                <div className="min-w-0">
                  <div className="browser-assets-name">{asset.name}</div>
                  <div className="browser-assets-meta">
                    <span>{formatBytes(asset.markup.length)}</span>
                    <span>inline markup</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
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
      <div className="browser-security-card" data-testid="browser-security-origin">
        <div className="browser-target-section-title">Current origin</div>
        <div className="browser-security-origin">{currentOrigin || 'none'}</div>
      </div>
      <div className="browser-security-card">
        <div className="browser-target-section-title">Defaults</div>
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
      </div>
      <div className="browser-security-card browser-security-policies" data-testid="browser-security-policies">
        <div className="browser-target-section-title">Origins</div>
        <PolicyRow label="Allowed" values={workbench.allowedOrigins} onAdd={() => onAddOriginPolicy('allowedOrigins')} onClear={() => onClearOriginPolicy('allowedOrigins')} />
        <PolicyRow label="Blocked" values={workbench.blockedOrigins} onAdd={() => onAddOriginPolicy('blockedOrigins')} onClear={() => onClearOriginPolicy('blockedOrigins')} />
        <PolicyRow label="Downloads" values={workbench.allowedDownloadOrigins} blockedValues={workbench.blockedDownloadOrigins} onAdd={() => onAddOriginPolicy('allowedDownloadOrigins')} onClear={() => onClearOriginPolicy('allowedDownloadOrigins')} />
        <PolicyRow label="Uploads" values={workbench.allowedUploadOrigins} blockedValues={workbench.blockedUploadOrigins} onAdd={() => onAddOriginPolicy('allowedUploadOrigins')} onClear={() => onClearOriginPolicy('allowedUploadOrigins')} />
      </div>
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
    <div className="browser-policy-row" data-testid="browser-security-policy-row">
      <div className="min-w-0">
        <div className="browser-policy-name">{label}</div>
        <div className="browser-policy-value">{summary}</div>
      </div>
      <div className="browser-policy-actions">
        <ActionButton label="Add" onClick={onAdd} />
        <ActionButton label="Clear" onClick={onClear} disabled={values.length === 0} />
      </div>
    </div>
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
    <button
      type="button"
      disabled={disabled}
      data-testid={dataTestId}
      className="rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-45"
      style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
      onClick={onClick}
    >
      {label}
    </button>
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
    hiddenLocalTargets: state?.hiddenLocalTargets ?? []
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

function browserViewport(workbench: BrowserWorkbenchState): { width: number | string; height: number | string } {
  if (workbench.deviceMode === 'desktop') return { width: '100%', height: '100%' }
  return {
    width: Math.max(280, workbench.viewportWidth),
    height: Math.max(420, workbench.viewportHeight)
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
      return { width: 384, height: 854 }
    case 'ipadMini':
      return { width: 744, height: 1133 }
    case 'ipad':
      return { width: 820, height: 1180 }
    case 'surfaceDuo':
      return { width: 540, height: 720 }
    case 'surfacePro7':
      return { width: 912, height: 1368 }
    case 'laptop':
      return { width: 1366, height: 768 }
    case 'laptopLarge':
      return { width: 1440, height: 900 }
    case 'desktop4k':
      return { width: 3840, height: 2160 }
    case 'custom':
      return { width: currentWidth, height: currentHeight }
  }
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
