import { createElement, useEffect, useRef, useState } from 'react'
import { Badge, ToolbarButton } from '../shared/designSystem'
import Icon from '../shared/Icon'

interface Props {
  initialUrl?: string
  embedded?: boolean
  onUrlChange?: (url: string) => void
}

type WebviewElement = HTMLElement & {
  loadURL: (url: string) => Promise<void> | void
  reload: () => void
  reloadIgnoringCache: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  findInPage: (text: string) => number
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
  setZoomFactor: (factor: number) => void
  capturePage: () => Promise<{ toDataURL: () => string }>
}

const QUICK_URLS = ['http://localhost:5173', 'http://127.0.0.1:8787']
const ZOOM_STEP = 0.1

export default function BrowserPanel({ initialUrl = '', embedded = false, onUrlChange }: Props): JSX.Element {
  const webviewRef = useRef<WebviewElement | null>(null)
  const [address, setAddress] = useState(initialUrl)
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [findVisible, setFindVisible] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [zoomFactor, setZoomFactor] = useState(1)
  const [deviceMode, setDeviceMode] = useState<'desktop' | 'mobile'>('desktop')
  const [cacheReloadCount, setCacheReloadCount] = useState(0)

  useEffect(() => {
    setAddress(initialUrl)
    setCurrentUrl(initialUrl)
  }, [initialUrl])

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
      }
      setTitle(webview.getTitle?.() ?? '')
    }
    const startLoading = (): void => {
      setError(null)
      setIsLoading(true)
    }
    const stopLoading = (): void => {
      setIsLoading(false)
      updateNavigationState()
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
      setTitle(detail.title ?? webview.getTitle?.() ?? '')
    }

    webview.addEventListener('did-start-loading', startLoading)
    webview.addEventListener('did-stop-loading', stopLoading)
    webview.addEventListener('did-navigate', updateNavigationState)
    webview.addEventListener('did-navigate-in-page', updateNavigationState)
    webview.addEventListener('did-fail-load', failLoad)
    webview.addEventListener('page-title-updated', titleUpdated)
    return () => {
      webview.removeEventListener('did-start-loading', startLoading)
      webview.removeEventListener('did-stop-loading', stopLoading)
      webview.removeEventListener('did-navigate', updateNavigationState)
      webview.removeEventListener('did-navigate-in-page', updateNavigationState)
      webview.removeEventListener('did-fail-load', failLoad)
      webview.removeEventListener('page-title-updated', titleUpdated)
    }
  }, [currentUrl, onUrlChange])

  const navigate = (raw: string): void => {
    const nextUrl = normalizeUrl(raw)
    if (!nextUrl) return
    setError(null)
    setScreenshot(null)
    setAddress(nextUrl)
    setCurrentUrl(nextUrl)
    onUrlChange?.(nextUrl)
  }

  const captureScreenshot = async (): Promise<void> => {
    const webview = webviewRef.current
    if (!webview || !currentUrl) return
    const image = await webview.capturePage()
    setScreenshot(image.toDataURL())
  }

  const searchInPage = (query: string): void => {
    setFindQuery(query)
    if (!query.trim()) {
      webviewRef.current?.stopFindInPage('clearSelection')
      return
    }
    webviewRef.current?.findInPage(query)
  }

  const closeFind = (): void => {
    setFindVisible(false)
    setFindQuery('')
    webviewRef.current?.stopFindInPage('clearSelection')
  }

  const changeZoom = (delta: number): void => {
    const nextZoom = Math.max(0.5, Math.min(2, Number((zoomFactor + delta).toFixed(2))))
    setZoomFactor(nextZoom)
    webviewRef.current?.setZoomFactor(nextZoom)
  }

  const resetZoom = (): void => {
    setZoomFactor(1)
    webviewRef.current?.setZoomFactor(1)
  }

  const reloadWithoutCache = (): void => {
    setCacheReloadCount((count) => count + 1)
    webviewRef.current?.reloadIgnoringCache?.()
  }

  const openExternal = (): void => {
    if (!currentUrl) return
    void window.api.browser.openExternal(currentUrl)
  }

  const webview = currentUrl
    ? createElement('webview', {
        ref: (node: WebviewElement | null) => {
          webviewRef.current = node
        },
        src: currentUrl,
        partition: 'persist:orchestrator-side-browser',
        allowpopups: 'true',
        'data-testid': 'browser-webview',
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
      data-browser-zoom={zoomFactor.toFixed(2)}
      data-browser-device-mode={deviceMode}
      data-browser-cache-reloads={cacheReloadCount}
      style={{
        width: embedded ? '100%' : 440,
        height: embedded ? '100%' : undefined,
        background: 'var(--surface-bg)'
      }}
    >
      <form
        className="flex shrink-0 items-center gap-1.5 px-2 py-2"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
        onSubmit={(event) => {
          event.preventDefault()
          navigate(address)
        }}
      >
        <ToolbarButton icon="arrowLeft" label="Back" disabled={!canGoBack} onClick={() => webviewRef.current?.goBack()} />
        <ToolbarButton icon="arrowRight" label="Forward" disabled={!canGoForward} onClick={() => webviewRef.current?.goForward()} />
        <ToolbarButton icon="refresh" label="Reload" disabled={!currentUrl} onClick={() => webviewRef.current?.reload()} />
        <ToolbarButton icon="eraser" label="Reload without cache" disabled={!currentUrl} onClick={reloadWithoutCache} />
        <div
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1"
          style={{ background: 'var(--control-bg)', border: '1px solid var(--border-subtle)' }}
        >
          <Icon name="browser" size={13} />
          <input
            data-testid="browser-url-input"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Enter URL"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
        <ToolbarButton icon="search" label="Find in page" disabled={!currentUrl} active={findVisible} onClick={() => setFindVisible((value) => !value)} />
        <ToolbarButton icon="zoomOut" label="Zoom out" disabled={!currentUrl || zoomFactor <= 0.5} onClick={() => changeZoom(-ZOOM_STEP)} />
        <button
          type="button"
          data-testid="browser-zoom-reset"
          disabled={!currentUrl}
          className="rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-45"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', background: 'var(--control-bg)' }}
          onClick={resetZoom}
        >
          {Math.round(zoomFactor * 100)}%
        </button>
        <ToolbarButton icon="zoomIn" label="Zoom in" disabled={!currentUrl || zoomFactor >= 2} onClick={() => changeZoom(ZOOM_STEP)} />
        <ToolbarButton
          icon={deviceMode === 'desktop' ? 'monitor' : 'smartphone'}
          label={deviceMode === 'desktop' ? 'Mobile preview' : 'Desktop preview'}
          disabled={!currentUrl}
          active={deviceMode === 'mobile'}
          onClick={() => setDeviceMode((mode) => mode === 'desktop' ? 'mobile' : 'desktop')}
        />
        <ToolbarButton icon="camera" label="Capture screenshot" disabled={!currentUrl || isLoading} onClick={captureScreenshot} />
        <ToolbarButton icon="external" label="Open in external browser" disabled={!currentUrl} onClick={openExternal} />
      </form>
      {findVisible && (
        <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="search" size={13} />
          <input
            data-testid="browser-find-input"
            value={findQuery}
            onChange={(event) => searchInPage(event.target.value)}
            placeholder="Find in page"
            autoFocus
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-xs outline-none"
            style={{ color: 'var(--text-primary)', background: 'var(--control-bg)', border: '1px solid var(--border-subtle)' }}
          />
          <ToolbarButton icon="close" label="Close find" onClick={closeFind} />
        </div>
      )}
      {(title || isLoading || error) && (
        <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {isLoading && <Badge tone="neutral">Loading</Badge>}
          {error && <Badge tone="danger">Failed</Badge>}
          <span className="min-w-0 flex-1 truncate" style={{ color: error ? 'var(--danger)' : 'var(--text-tertiary)' }}>
            {error ?? title}
          </span>
        </div>
      )}
      {screenshot && (
        <div className="shrink-0 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <img
            data-testid="browser-screenshot-preview"
            src={screenshot}
            alt="Browser screenshot preview"
            className="max-h-24 rounded-md border object-contain"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        </div>
      )}
      {currentUrl ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
          <div
            className="flex min-h-0 flex-1 overflow-hidden"
            style={{
              maxWidth: deviceMode === 'mobile' ? 390 : '100%',
              borderLeft: deviceMode === 'mobile' ? '1px solid var(--border-subtle)' : 'none',
              borderRight: deviceMode === 'mobile' ? '1px solid var(--border-subtle)' : 'none'
            }}
          >
            {webview}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Icon name="browser" size={26} />
          <div className="space-y-1">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Start browsing
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Enter a URL to open a page
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {QUICK_URLS.map((url) => (
              <button
                key={url}
                type="button"
                className="rounded-md px-2 py-1 text-xs"
                style={{
                  background: 'var(--control-bg)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
                onClick={() => navigate(url)}
              >
                {url.replace(/^https?:\/\//, '')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed
  if (trimmed.includes('localhost') || trimmed.includes('127.0.0.1') || trimmed.includes('.')) return `http://${trimmed}`
  return `https://${trimmed}`
}
