import { createElement } from 'react'
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { BrowserTabState, BrowserUseCursorState, BrowserUseSurfaceBounds, BrowserUseSurfaceSize, BrowserWorkbenchState } from '../../store/sessions'
import { browserWebviewPartitionForHost } from '../../types'

export interface BrowserVisibleGeometry {
  stageBounds: BrowserUseSurfaceBounds
  visualBounds: BrowserUseSurfaceBounds
  webviewBounds: BrowserUseSurfaceBounds
  scale: number
}

export type WebviewElement = HTMLElement & {
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
  capturePage: () => Promise<{ toDataURL: () => string; getSize?: () => { width: number; height: number } }>
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
}

interface BrowserWebviewManagerProps {
  hostId: string
  webviewHostId?: string | null
  transferSourceHostId?: string | null
  transferTargetHostId?: string | null
  transferId?: string | null
  tabs: BrowserTabState[]
  activeTabId: string
  visible: boolean
  error: string | null
  viewport: { width: number | string; height: number | string }
  visibleGeometry: BrowserVisibleGeometry | null
  browserUseActive: boolean
  browserUseTurnId: string | null
  browserUseViewportSize: BrowserUseSurfaceSize | null
  browserUseCaptureSurfaceSize: BrowserUseSurfaceSize | null
  browserUseCaptureBounds: BrowserUseSurfaceBounds | null
  browserUseCursorState: BrowserUseCursorState | null
  webviewRefs: MutableRefObject<Record<string, WebviewElement | null>>
  workbenchRef: MutableRefObject<BrowserWorkbenchState>
  activeWebviewRef: MutableRefObject<WebviewElement | null>
  onContextMenu: (event: ReactMouseEvent) => void
}

export default function BrowserWebviewManager({
  hostId,
  webviewHostId,
  transferSourceHostId,
  transferTargetHostId,
  transferId,
  tabs,
  activeTabId,
  visible,
  error,
  viewport,
  visibleGeometry,
  browserUseActive,
  browserUseTurnId,
  browserUseViewportSize,
  browserUseCaptureSurfaceSize,
  browserUseCaptureBounds,
  browserUseCursorState,
  webviewRefs,
  workbenchRef,
  activeWebviewRef,
  onContextMenu
}: BrowserWebviewManagerProps): JSX.Element | null {
  if (tabs.length === 0) return null
  const effectiveWebviewHostId = webviewHostId || hostId
  const transferActive = Boolean(transferSourceHostId && transferTargetHostId && transferSourceHostId !== transferTargetHostId)
  const partition = browserWebviewPartitionForHost(effectiveWebviewHostId)
  const browserUsePaintHost = browserUseActive || browserUseViewportSize !== null || browserUseCaptureSurfaceSize !== null || browserUseCaptureBounds !== null
  const captureBounds = browserUseCaptureBounds
    ?? (browserUseCaptureSurfaceSize ? { x: 0, y: 0, width: browserUseCaptureSurfaceSize.width, height: browserUseCaptureSurfaceSize.height, scale: 1 } : null)
  const hiddenSurfaceSize = captureBounds ?? browserUseCaptureSurfaceSize ?? browserUseViewportSize ?? { width: 1, height: 1 }
  const activeCursorVisible = browserUseCursorState?.visible === true && visible && !error
  const visibleScale = visibleGeometry?.scale ?? 1
  const cursorBounds = captureBounds
    ?? browserUseCaptureSurfaceSize
    ?? browserUseViewportSize
    ?? {
      width: typeof viewport.width === 'number' ? viewport.width : 1280,
      height: typeof viewport.height === 'number' ? viewport.height : 720
    }
  return (
    <div
      className="browser-webview-manager"
      data-testid="browser-webview-manager"
      data-browser-manager-host-id={hostId}
      data-browser-manager-webview-host-id={effectiveWebviewHostId}
      data-browser-manager-dom-host="body"
      data-browser-manager-partition={partition}
      data-browser-manager-partition-scope="host"
      data-browser-manager-transfer-state={transferActive ? 'transferred' : 'local'}
      data-browser-manager-transfer-source-host-id={transferSourceHostId ?? ''}
      data-browser-manager-transfer-target-host-id={transferTargetHostId ?? ''}
      data-browser-manager-transfer-id={transferId ?? ''}
      data-browser-manager-active-tab={activeTabId}
      data-browser-manager-visible={visible && !error ? 'true' : 'false'}
      data-browser-manager-browser-use-active={browserUseActive ? 'true' : 'false'}
      data-browser-manager-browser-use-turn-id={browserUseTurnId ?? ''}
      data-browser-manager-paint-host={browserUsePaintHost ? 'true' : 'false'}
      data-browser-manager-viewport-width={browserUseViewportSize?.width ?? ''}
      data-browser-manager-viewport-height={browserUseViewportSize?.height ?? ''}
      data-browser-manager-capture-width={browserUseCaptureSurfaceSize?.width ?? ''}
      data-browser-manager-capture-height={browserUseCaptureSurfaceSize?.height ?? ''}
      data-browser-manager-capture-x={captureBounds?.x ?? ''}
      data-browser-manager-capture-y={captureBounds?.y ?? ''}
      data-browser-manager-capture-bounds-width={captureBounds?.width ?? ''}
      data-browser-manager-capture-bounds-height={captureBounds?.height ?? ''}
      data-browser-manager-capture-scale={captureBounds?.scale ?? ''}
      data-browser-manager-visual-width={viewport.width}
      data-browser-manager-visual-height={viewport.height}
      data-browser-manager-visible-stage-width={visibleGeometry?.stageBounds.width ?? ''}
      data-browser-manager-visible-stage-height={visibleGeometry?.stageBounds.height ?? ''}
      data-browser-manager-visible-x={visibleGeometry?.visualBounds.x ?? ''}
      data-browser-manager-visible-y={visibleGeometry?.visualBounds.y ?? ''}
      data-browser-manager-visible-width={visibleGeometry?.visualBounds.width ?? ''}
      data-browser-manager-visible-height={visibleGeometry?.visualBounds.height ?? ''}
      data-browser-manager-visible-scale={visibleGeometry?.scale ?? ''}
      data-browser-manager-webview-x={visibleGeometry?.webviewBounds.x ?? ''}
      data-browser-manager-webview-y={visibleGeometry?.webviewBounds.y ?? ''}
      data-browser-manager-webview-width={visibleGeometry?.webviewBounds.width ?? ''}
      data-browser-manager-webview-height={visibleGeometry?.webviewBounds.height ?? ''}
      data-browser-manager-cursor-visible={activeCursorVisible ? 'true' : 'false'}
    >
      {typeof document !== 'undefined' && createPortal(
        tabs.map((tab) => {
          const active = tab.id === activeTabId && visible && !error
          const containerStyle = active && visibleGeometry
            ? {
                position: 'fixed' as const,
                left: visibleGeometry.visualBounds.x,
                top: visibleGeometry.visualBounds.y,
                width: visibleGeometry.visualBounds.width,
                height: visibleGeometry.visualBounds.height,
                zIndex: 1,
                overflow: 'hidden',
                pointerEvents: 'auto' as const,
                visibility: 'visible' as const,
                opacity: 1
              }
            : {
                position: 'fixed' as const,
                left: 0,
                top: 0,
                width: browserUsePaintHost ? hiddenSurfaceSize.width : 1,
                height: browserUsePaintHost ? hiddenSurfaceSize.height : 1,
                zIndex: 2147483647,
                overflow: 'hidden',
                pointerEvents: 'none' as const,
                contain: 'layout paint size style',
                opacity: browserUsePaintHost ? 0.001 : 0,
                visibility: browserUsePaintHost ? 'visible' as const : 'hidden' as const,
                transform: browserUsePaintHost ? 'translate3d(0, 0, 0)' : undefined,
                willChange: browserUsePaintHost ? 'transform' : undefined
              }
          return createElement('div', {
            key: tab.id,
            className: active ? 'browser-webview-body-host browser-webview-body-host-active' : 'browser-webview-body-host browser-webview-body-host-hidden',
            'data-browser-webview-dom-host': 'body',
            'data-browser-webview-host-id': hostId,
            'data-browser-webview-source-host-id': effectiveWebviewHostId,
            'data-browser-webview-transfer-state': transferActive ? 'transferred' : 'local',
            'data-browser-webview-transfer-source-host-id': transferSourceHostId ?? '',
            'data-browser-webview-transfer-target-host-id': transferTargetHostId ?? '',
            'data-browser-webview-transfer-id': transferId ?? '',
            'data-browser-webview-tab-id': tab.id,
            'data-browser-webview-active': active ? 'true' : 'false',
            style: containerStyle
          }, createElement('webview', {
            ref: (node: WebviewElement | null) => {
              webviewRefs.current[tab.id] = node
              if (tab.id === workbenchRef.current.activeTabId) {
                activeWebviewRef.current = node
              }
            },
            src: tab.url,
            partition,
            'data-testid': active ? 'browser-webview' : 'browser-webview-hidden',
            'data-browser-webview-host-id': hostId,
            'data-browser-webview-source-host-id': effectiveWebviewHostId,
            'data-browser-webview-dom-host': 'body',
            'data-browser-webview-partition': partition,
            'data-browser-webview-partition-scope': 'host',
            'data-browser-webview-transfer-state': transferActive ? 'transferred' : 'local',
            'data-browser-webview-transfer-source-host-id': transferSourceHostId ?? '',
            'data-browser-webview-transfer-target-host-id': transferTargetHostId ?? '',
            'data-browser-webview-transfer-id': transferId ?? '',
            'data-browser-webview-tab-id': tab.id,
            'data-browser-webview-active': active ? 'true' : 'false',
            'data-browser-webview-lifecycle': active ? 'active' : 'mounted-hidden',
            'data-browser-webview-containment': active ? 'body-fixed' : 'layout paint size style',
            'data-browser-webview-paint-host': !active && browserUsePaintHost ? 'true' : 'false',
            'data-browser-webview-capture-x': !active && captureBounds ? captureBounds.x : '',
            'data-browser-webview-capture-y': !active && captureBounds ? captureBounds.y : '',
            'data-browser-webview-capture-scale': !active && captureBounds?.scale ? captureBounds.scale : '',
            'data-browser-webview-visual-width': active ? viewport.width : hiddenSurfaceSize.width,
            'data-browser-webview-visual-height': active ? viewport.height : hiddenSurfaceSize.height,
            'data-browser-webview-visible-width': active ? visibleGeometry?.visualBounds.width ?? '' : '',
            'data-browser-webview-visible-height': active ? visibleGeometry?.visualBounds.height ?? '' : '',
            'data-browser-webview-visible-scale': active ? visibleGeometry?.scale ?? '' : '',
            'data-browser-webview-logical-width': active ? visibleGeometry?.webviewBounds.width ?? '' : '',
            'data-browser-webview-logical-height': active ? visibleGeometry?.webviewBounds.height ?? '' : '',
            onContextMenu: active ? onContextMenu : undefined,
            className: active ? 'browser-webview-surface browser-webview-surface-active' : 'browser-webview-surface browser-webview-surface-hidden',
            style: active
              ? (visibleGeometry
                  ? {
                      width: visibleGeometry.webviewBounds.width,
                      height: visibleGeometry.webviewBounds.height,
                      transform: visibleScale === 1 ? undefined : `scale(${visibleScale})`,
                      transformOrigin: 'top left',
                      willChange: visibleScale === 1 ? undefined : 'transform'
                    }
                  : {
                      width: 1,
                      height: 1,
                      opacity: 0,
                      visibility: 'hidden'
                    })
              : {
                  width: browserUsePaintHost ? hiddenSurfaceSize.width : 1,
                  height: browserUsePaintHost ? hiddenSurfaceSize.height : 1
                }
          }))
        }),
        document.body
      )}
      {activeCursorVisible && (
        <div
          aria-hidden="true"
          className="browser-use-cursor"
          data-testid="browser-use-cursor"
          data-browser-use-cursor-x={Math.round(browserUseCursorState.x)}
          data-browser-use-cursor-y={Math.round(browserUseCursorState.y)}
          data-browser-use-cursor-animated={browserUseCursorState.animateMovement ? 'true' : 'false'}
          data-browser-use-cursor-sequence={browserUseCursorState.moveSequence ?? ''}
          style={{
            left: Math.min(Math.max(browserUseCursorState.x, 0), cursorBounds.width),
            top: Math.min(Math.max(browserUseCursorState.y, 0), cursorBounds.height)
          }}
        />
      )}
    </div>
  )
}
