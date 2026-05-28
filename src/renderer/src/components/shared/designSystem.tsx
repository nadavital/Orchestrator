import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import Icon, { type IconName } from './Icon'
import { rowMotionStyle, useReducedMotionPreference } from '../../design/motion'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const toneColor: Record<Tone, string> = {
  neutral: 'var(--text-secondary)',
  accent: 'var(--accent)',
  success: 'var(--state-success)',
  warning: 'var(--state-warning)',
  danger: 'var(--state-danger)',
}

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const APP_SHELL_PANEL_ANIMATION_MS = 360
const RETAINED_EXIT_MS = 240

function appShellPanelEaseOut(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  return 1 - Math.pow(1 - clamped, 3)
}

const hoverSurfaceOpenEvent = 'orchestrator:hover-surface-open'
const tooltipHoverDelayMs = 700

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

function panelTabSafeId(value: string | number): string {
  return encodeURIComponent(String(value)).replace(/%/g, '-')
}

export function panelTabDomId(panelId: string, tabId: string | number): string {
  return `orchestrator-${panelTabSafeId(panelId)}-tab-${panelTabSafeId(tabId)}`
}

export function panelTabPanelDomId(panelId: string, tabId: string | number): string {
  return `orchestrator-${panelTabSafeId(panelId)}-tabpanel-${panelTabSafeId(tabId)}`
}

export function panelActiveTabActionsDomId(panelId: string): string {
  return `orchestrator-${panelTabSafeId(panelId)}-active-tab-actions`
}

export function exitFullscreenForPanelTab(panelId: string, tabId: string | number): boolean {
  const fullscreenElement = document.fullscreenElement
  if (!(fullscreenElement instanceof Element)) return false
  const tabPanel = document.querySelector<HTMLElement>(
    `[data-app-shell-tab-panel-controller="${cssEscape(panelId)}"][data-tab-id="${cssEscape(String(tabId))}"]`
  )
  if (!tabPanel?.contains(fullscreenElement)) return false
  document.exitFullscreen().catch(() => undefined)
  return true
}

function recordPanelTabMetric(
  name: 'panel.tab.opened' | 'panel.tab.closed' | 'panel.tab.viewed',
  panelId: string,
  tabId: string | number,
  tabCount: number
): void {
  void window.api.performance.record({
    name,
    surface: 'renderer',
    startedAt: Date.now(),
    durationMs: 0,
    metadata: {
      panelId,
      tabId: String(tabId),
      tabCount
    }
  }).catch(() => undefined)
}

function recordAppShellPanelMetric(
  name: 'panel.opened' | 'panel.closed',
  panelId: string,
  surface: string,
  activeTabId: string | number | null | undefined,
  routeKind: string | null | undefined
): void {
  void window.api.performance.record({
    name,
    surface: 'renderer',
    startedAt: Date.now(),
    durationMs: 0,
    metadata: {
      panelId,
      panelSurface: surface,
      activeTab: activeTabId == null ? 'none' : String(activeTabId),
      routeKind: routeKind ?? 'local_thread'
    }
  }).catch(() => undefined)
}

export function announceHoverSurfaceOpen(id: string): void {
  window.dispatchEvent(new CustomEvent(hoverSurfaceOpenEvent, { detail: { id } }))
}

export function useExclusiveHoverSurface(id: string, onClose: () => void): void {
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const nextId = (event as CustomEvent<{ id?: string }>).detail?.id
      if (nextId && nextId !== id) onCloseRef.current()
    }
    window.addEventListener(hoverSurfaceOpenEvent, onOpen)
    return () => window.removeEventListener(hoverSurfaceOpenEvent, onOpen)
  }, [id])
}

function useLayerFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const focusFirst = (): void => {
      const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((element) => element.offsetParent !== null || element === document.activeElement)
      const target = focusable[0] ?? ref.current
      target?.focus({ preventScroll: true })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
        .filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        ref.current?.focus({ preventScroll: true })
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    window.setTimeout(focusFirst, 0)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [onClose, ref])
}

function useRetainedExit(onClose: () => void): { exiting: boolean; close: () => void } {
  const [exiting, setExiting] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const reducedMotion = useReducedMotionPreference()

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
  }, [])

  const close = useCallback(() => {
    if (exiting) return
    if (reducedMotion) {
      onClose()
      return
    }
    setExiting(true)
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      onClose()
    }, RETAINED_EXIT_MS)
  }, [exiting, onClose, reducedMotion])

  return { exiting, close }
}

interface ButtonProps {
  children: ReactNode
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  type?: 'button' | 'submit'
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  ariaLabel?: string
  ariaPressed?: boolean
  dataTestId?: string
  dataReviewPath?: string
  dataSidebarKey?: string
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'secondary',
  disabled = false,
  className = '',
  style,
  title,
  ariaLabel,
  dataTestId,
}: ButtonProps): JSX.Element {
  const variantStyle = buttonVariantStyle(variant)
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      className={`motion-button inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-default disabled:opacity-50 ${className}`}
      style={{ ...variantStyle, ...style }}
    >
      {children}
    </button>
  )
}

function buttonVariantStyle(variant: ButtonProps['variant']): CSSProperties {
  if (variant === 'primary') {
    return {
      background: 'var(--accent)',
      border: '1px solid color-mix(in srgb, var(--accent) 82%, black)',
      color: '#fff',
      boxShadow: 'var(--shadow-soft)',
    }
  }
  if (variant === 'danger') {
    return {
      background: 'color-mix(in srgb, var(--state-danger) 12%, var(--surface-bg))',
      border: '1px solid color-mix(in srgb, var(--state-danger) 34%, var(--border-subtle))',
      color: 'var(--state-danger)',
    }
  }
  if (variant === 'ghost') {
    return {
      background: 'transparent',
      border: '1px solid transparent',
      color: 'var(--text-secondary)',
    }
  }
  return {
    background: 'var(--surface-bg)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-primary)',
  }
}

interface IconButtonProps {
  icon: IconName
  label: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  disabled?: boolean
  active?: boolean
  tone?: Tone
  size?: 'xs' | 'sm' | 'md'
  variant?: 'default' | 'toolbar'
  className?: string
  style?: CSSProperties
  tooltip?: boolean
  dataTestId?: string
  ariaExpanded?: boolean
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  tone = 'neutral',
  size = 'md',
  variant = 'default',
  className = '',
  style,
  tooltip = true,
  dataTestId,
  ariaExpanded,
}: IconButtonProps): JSX.Element {
  const buttonSize = size === 'xs' ? 18 : size === 'sm' ? 24 : 30
  const iconSize = size === 'xs' ? 11 : size === 'sm' ? 13 : 15
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={ariaExpanded}
      data-tooltip-label={label}
      data-icon={icon}
      data-native-title-free="true"
      data-testid={dataTestId}
      data-active={active ? 'true' : 'false'}
      data-icon-button-variant={variant}
      data-icon-button-size={size}
      className={`motion-icon-button grid shrink-0 place-items-center rounded-md disabled:cursor-default disabled:opacity-45 ${className}`}
      style={{
        width: buttonSize,
        height: buttonSize,
        color: active ? 'var(--text-primary)' : toneColor[tone],
        background: variant === 'toolbar' ? undefined : active ? 'var(--control-bg-active)' : 'transparent',
        border: variant === 'toolbar' ? undefined : active ? '1px solid var(--border-strong)' : '1px solid transparent',
        ...style,
      }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )

  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button
}

export function ToolbarButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  tone = 'neutral',
  dataTestId,
  size = 'md',
  variant = 'default',
}: {
  icon: IconName
  label: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  active?: boolean
  disabled?: boolean
  tone?: Tone
  dataTestId?: string
  size?: 'sm' | 'md'
  variant?: 'default' | 'toolbar'
}): JSX.Element {
  return (
    <IconButton
      icon={icon}
      label={label}
      onClick={onClick}
      active={active}
      disabled={disabled}
      tone={tone}
      dataTestId={dataTestId}
      size={size}
      variant={variant}
      className="toolbar-button"
      style={variant === 'toolbar'
        ? undefined
        : {
            background: active ? 'var(--control-bg-active)' : 'var(--control-bg)',
            borderColor: active ? 'var(--border-strong)' : 'var(--border-subtle)',
          }}
    />
  )
}

interface PanelToolbarProps {
  children: ReactNode
  className?: string
  dataTestId?: string
  ariaLabel?: string
  as?: 'div' | 'form'
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void
}

export function PanelToolbar({
  children,
  className = '',
  dataTestId,
  ariaLabel,
  as = 'div',
  onSubmit,
}: PanelToolbarProps): JSX.Element {
  const shared = {
    className: `panel-toolbar ${className}`.trim(),
    'data-testid': dataTestId,
    'data-panel-toolbar': 'true',
    'aria-label': ariaLabel,
  }

  if (as === 'form') {
    return (
      <form
        {...shared}
        onSubmit={onSubmit}
      >
        {children}
      </form>
    )
  }

  return (
    <div {...shared}>
      {children}
    </div>
  )
}

interface WorkbenchSearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  clearLabel?: string
  inputRef?: Ref<HTMLInputElement>
  id?: string
  dataTestId?: string
  clearDataTestId?: string
  className?: string
  inputClassName?: string
  autoFocus?: boolean
  type?: 'search' | 'url' | 'text'
  icon?: IconName | null
  leading?: ReactNode
  trailing?: ReactNode
  ariaLabel?: string
  spellCheck?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function WorkbenchSearchField({
  value,
  onChange,
  placeholder,
  clearLabel,
  inputRef,
  id,
  dataTestId,
  clearDataTestId,
  className = '',
  inputClassName = '',
  autoFocus = false,
  type = 'search',
  icon = 'search',
  leading,
  trailing,
  ariaLabel,
  spellCheck,
  onKeyDown,
}: WorkbenchSearchFieldProps): JSX.Element {
  const hasQuery = value.trim().length > 0
  const canClear = Boolean(clearLabel) && hasQuery

  return (
    <div
      className={`workbench-search-field ${className}`.trim()}
      data-has-query={hasQuery ? 'true' : 'false'}
      data-field-kind={type}
    >
      {leading}
      {icon && <Icon name={icon} size={13} />}
      <input
        ref={inputRef}
        id={id}
        data-testid={dataTestId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`workbench-search-input ${inputClassName}`.trim()}
        autoFocus={autoFocus}
        type={type === 'url' ? 'text' : type}
        aria-label={ariaLabel}
        spellCheck={spellCheck}
        onKeyDown={onKeyDown}
      />
      {trailing}
      {canClear && (
        <button
          type="button"
          aria-label={clearLabel}
          data-testid={clearDataTestId}
          className="workbench-search-clear"
          onClick={() => onChange('')}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  )
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const idRef = useRef(`tooltip-${Math.random().toString(36).slice(2)}`)
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const showTimeoutRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; placement: 'top' | 'bottom' } | null>(null)

  const clearShowTimeout = (): void => {
    if (showTimeoutRef.current === null) return
    window.clearTimeout(showTimeoutRef.current)
    showTimeoutRef.current = null
  }

  const showNow = (): void => {
    clearShowTimeout()
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.min(Math.max(rect.left + rect.width / 2, 8), window.innerWidth - 8)
    const placement = rect.top < 38 ? 'bottom' : 'top'
    const top = placement === 'bottom'
      ? Math.min(rect.bottom + 7, window.innerHeight - 28)
      : Math.max(rect.top - 7, 8)
    announceHoverSurfaceOpen(idRef.current)
    setPosition({ left, top, placement })
    setVisible(true)
  }

  const scheduleShow = (): void => {
    clearShowTimeout()
    showTimeoutRef.current = window.setTimeout(() => {
      showTimeoutRef.current = null
      showNow()
    }, tooltipHoverDelayMs)
  }

  const hide = (): void => {
    clearShowTimeout()
    setVisible(false)
    setPosition(null)
  }
  useExclusiveHoverSurface(idRef.current, hide)

  useEffect(() => () => clearShowTimeout(), [])

  useLayoutEffect(() => {
    if (!visible || !position) return
    const rect = tooltipRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextLeft = Math.min(
      Math.max(position.left, 8 + rect.width / 2),
      window.innerWidth - 8 - rect.width / 2
    )
    const nextTop = position.placement === 'bottom'
      ? Math.min(Math.max(position.top, 8), window.innerHeight - 8 - rect.height)
      : Math.min(Math.max(position.top, 8 + rect.height), window.innerHeight - 8)
    if (Math.abs(nextLeft - position.left) > 0.5 || Math.abs(nextTop - position.top) > 0.5) {
      setPosition({ ...position, left: nextLeft, top: nextTop })
    }
  }, [label, position, visible])

  useEffect(() => {
    if (!visible) return
    const hideForViewportChange = (): void => hide()
    const hideForGlobalDismiss = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && anchorRef.current?.contains(target)) return
      hide()
    }
    const hideForEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('pointerdown', hideForGlobalDismiss, true)
    document.addEventListener('keydown', hideForEscape, true)
    window.addEventListener('scroll', hideForViewportChange, true)
    window.addEventListener('resize', hideForViewportChange)
    window.addEventListener('blur', hideForViewportChange)
    return () => {
      document.removeEventListener('pointerdown', hideForGlobalDismiss, true)
      document.removeEventListener('keydown', hideForEscape, true)
      window.removeEventListener('scroll', hideForViewportChange, true)
      window.removeEventListener('resize', hideForViewportChange)
      window.removeEventListener('blur', hideForViewportChange)
    }
  }, [visible])

  return (
    <span
      ref={anchorRef}
      className="orchestrator-tooltip-anchor"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') scheduleShow()
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch') scheduleShow()
      }}
      onMouseEnter={scheduleShow}
      onMouseMove={scheduleShow}
      onMouseOver={showNow}
      onPointerLeave={hide}
      onMouseLeave={hide}
      onFocus={showNow}
      onBlur={hide}
      onMouseDownCapture={hide}
      onContextMenu={hide}
    >
      {children}
      {createPortal(
        <span
          ref={tooltipRef}
          className="orchestrator-tooltip"
          role="tooltip"
          data-visible={visible && position ? 'true' : 'false'}
          data-placement={position?.placement ?? 'top'}
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0
          }}
        >
          {label}
        </span>,
        document.body
      )}
    </span>
  )
}

export function MotionView({
  viewKey,
  children,
  animate = true,
  className = '',
  style,
}: {
  viewKey: string
  children: ReactNode
  animate?: boolean
  className?: string
  style?: CSSProperties
}): JSX.Element {
  return (
    <div
      data-motion-view={viewKey}
      className={`motion-view ${animate ? 'motion-view-animated' : ''} min-h-0 min-w-0 flex-1 ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}

interface AppShellPanelAnimationState {
  isMounted: boolean
  animatedSize: number
  opacity: number
  progress: number
  state: 'opening' | 'open' | 'closing' | 'closed'
}

function useAppShellPanelAnimation(open: boolean, size: number): AppShellPanelAnimationState {
  const reducedMotion = useReducedMotionPreference()
  const [progress, setProgress] = useState(() => (open ? 1 : 0))
  const progressRef = useRef(open ? 1 : 0)

  useEffect(() => {
    const target = open ? 1 : 0
    if (reducedMotion) {
      progressRef.current = target
      setProgress(target)
      return
    }

    const startProgress = progressRef.current
    if (Math.abs(startProgress - target) < 0.001) {
      progressRef.current = target
      setProgress(target)
      return
    }

    const startTime = window.performance.now()
    let frame = 0
    const tick = (now: number): void => {
      const elapsed = now - startTime
      const rawProgress = Math.min(1, elapsed / APP_SHELL_PANEL_ANIMATION_MS)
      const easedProgress = appShellPanelEaseOut(rawProgress)
      const nextProgress = startProgress + (target - startProgress) * easedProgress
      progressRef.current = nextProgress
      setProgress(nextProgress)
      if (rawProgress < 1) {
        frame = window.requestAnimationFrame(tick)
        return
      }
      progressRef.current = target
      setProgress(target)
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [open, reducedMotion])

  const clampedProgress = Math.max(0, Math.min(1, progress))
  const state = open
    ? clampedProgress >= 0.999 ? 'open' : 'opening'
    : clampedProgress <= 0.001 ? 'closed' : 'closing'

  return {
    isMounted: open || clampedProgress > 0.001,
    animatedSize: Math.max(0, size * clampedProgress),
    opacity: clampedProgress,
    progress: clampedProgress,
    state
  }
}

export function MotionPanel({
  open,
  side,
  size,
  children,
  className = '',
  style,
  ...attrs
}: {
  open: boolean
  side: 'right' | 'bottom'
  size: number
  children: ReactNode
  className?: string
  style?: CSSProperties
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>): JSX.Element {
  const animation = useAppShellPanelAnimation(open, size)
  const dimensionStyle: CSSProperties = side === 'right'
    ? { width: animation.animatedSize, minWidth: animation.animatedSize, maxWidth: animation.animatedSize }
    : { height: animation.animatedSize, minHeight: animation.animatedSize, maxHeight: animation.animatedSize }

  return (
    <div
      {...attrs}
      data-open={open ? 'true' : 'false'}
      data-motion-panel={side}
      data-app-shell-panel-animation="shared"
      data-app-shell-panel-animation-state={animation.state}
      data-app-shell-panel-animation-progress={animation.progress.toFixed(3)}
      data-app-shell-panel-animated-size={Math.round(animation.animatedSize)}
      data-app-shell-panel-target-size={Math.round(size)}
      data-app-shell-panel-mounted={animation.isMounted ? 'true' : 'false'}
      aria-hidden={!open}
      className={`motion-panel motion-panel-${side} shrink-0 overflow-hidden ${className}`}
      style={{
        ...dimensionStyle,
        opacity: animation.opacity,
        pointerEvents: open ? 'auto' : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function AppShellPanel({
  open,
  side,
  size,
  panel,
  surface,
  focusArea,
  telemetryActiveTab,
  telemetryRouteKind = 'local_thread',
  children,
  className = '',
  style,
  ...attrs
}: {
  open: boolean
  side: 'right' | 'bottom'
  size: number
  panel: 'right' | 'bottom'
  surface: string
  focusArea: string
  telemetryActiveTab?: string | number | null
  telemetryRouteKind?: string | null
  children: ReactNode
  className?: string
  style?: CSSProperties
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>): JSX.Element {
  const previousOpenRef = useRef(open)
  const shellBorder: CSSProperties = side === 'right'
    ? { borderLeft: '1px solid var(--border-subtle)' }
    : { borderTop: '1px solid var(--border-subtle)' }

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open
    if (wasOpen === open) return
    recordAppShellPanelMetric(open ? 'panel.opened' : 'panel.closed', panel, surface, telemetryActiveTab, telemetryRouteKind)
  }, [open, panel, surface, telemetryActiveTab, telemetryRouteKind])

  return (
    <MotionPanel
      {...attrs}
      open={open}
      side={side}
      size={size}
      className={`app-shell-panel app-shell-panel-${panel} ${className}`.trim()}
      style={{ ...shellBorder, ...style }}
      data-app-shell-panel={panel}
      data-app-shell-panel-surface={surface}
      data-app-shell-panel-material="solid"
      data-app-shell-focus-area={focusArea}
    >
      {children}
    </MotionPanel>
  )
}

export type AppShellSidePanelLayoutMode = 'docked' | 'overlay' | 'full'

export interface AppShellSidePanelLayout {
  containerSize: number
  storedSize: number
  size: number
  widthRatio?: number
  maxSize: number
  mode: AppShellSidePanelLayoutMode
  isOverlay: boolean
  className: string
  style: CSSProperties
}

export function useAppShellSidePanelLayout({
  containerTestId,
  defaultSize,
  size,
  widthRatio,
  legacyDefaultSize,
  legacyDefaultSizeRatio,
  fullWidth,
  minSize,
  minPrimaryContentSize,
  minOverlaySize,
  overlayInset = 16
}: {
  containerTestId: string
  defaultSize: number
  size?: number
  widthRatio?: number
  legacyDefaultSize?: number
  legacyDefaultSizeRatio?: number
  fullWidth?: boolean
  minSize: number
  minPrimaryContentSize: number
  minOverlaySize: number
  overlayInset?: number
}): AppShellSidePanelLayout {
  const [containerSize, setContainerSize] = useState(() => (typeof window === 'undefined' ? defaultSize : window.innerWidth))
  const isLegacyDefaultSize =
    legacyDefaultSize !== undefined &&
    legacyDefaultSizeRatio !== undefined &&
    size === legacyDefaultSize &&
    typeof widthRatio === 'number' &&
    Math.abs(widthRatio - legacyDefaultSizeRatio) <= 0.0001
  const effectiveRatio = typeof widthRatio === 'number' && !isLegacyDefaultSize ? widthRatio : undefined
  const storedSize = effectiveRatio !== undefined
    ? Math.round(containerSize * effectiveRatio)
    : isLegacyDefaultSize
      ? defaultSize
      : size ?? defaultSize
  const isOverlay = !fullWidth && containerSize < minPrimaryContentSize + minSize
  const maxSize = Math.max(minSize, containerSize - minPrimaryContentSize)
  const resolvedSize = fullWidth
    ? Math.max(minSize, containerSize)
    : isOverlay
      ? Math.min(
          Math.max(minOverlaySize, storedSize),
          Math.max(minOverlaySize, containerSize - overlayInset)
        )
      : Math.max(minSize, Math.min(maxSize, storedSize))
  const mode: AppShellSidePanelLayoutMode = fullWidth ? 'full' : isOverlay ? 'overlay' : 'docked'

  useEffect(() => {
    const updateSize = (): void => {
      const container = document.querySelector(`[data-testid="${cssEscape(containerTestId)}"]`)
      if (container instanceof HTMLElement) setContainerSize(container.getBoundingClientRect().width)
    }
    updateSize()
    const container = document.querySelector(`[data-testid="${cssEscape(containerTestId)}"]`)
    const observer = container instanceof HTMLElement ? new ResizeObserver(updateSize) : null
    if (container instanceof HTMLElement) observer?.observe(container)
    window.addEventListener('resize', updateSize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [containerTestId])

  return {
    containerSize,
    storedSize,
    size: resolvedSize,
    widthRatio: effectiveRatio,
    maxSize,
    mode,
    isOverlay,
    className: fullWidth ? 'workbench-panel-expanded' : isOverlay ? 'workbench-panel-overlay' : '',
    style: fullWidth ? { width: '100%', minWidth: '100%', maxWidth: '100%' } : {}
  }
}

export interface AppShellBottomPanelLayout {
  containerSize: number
  storedSize: number
  size: number
  maxSize: number
  mode: 'docked' | 'compressed'
  className: string
  style: CSSProperties
}

export function useAppShellBottomPanelLayout({
  containerTestId,
  defaultSize,
  size,
  minSize,
  minPrimaryContentSize,
  maxSize
}: {
  containerTestId: string
  defaultSize: number
  size?: number
  minSize: number
  minPrimaryContentSize: number
  maxSize: number
}): AppShellBottomPanelLayout {
  const [containerSize, setContainerSize] = useState(() => (typeof window === 'undefined' ? defaultSize : window.innerHeight))
  const storedSize = size ?? defaultSize
  const availableSize = Math.max(minSize, containerSize - minPrimaryContentSize)
  const resolvedMaxSize = Math.max(minSize, Math.min(maxSize, availableSize))
  const resolvedSize = Math.max(minSize, Math.min(resolvedMaxSize, storedSize))
  const mode = resolvedMaxSize < storedSize ? 'compressed' : 'docked'

  useEffect(() => {
    const updateSize = (): void => {
      const container = document.querySelector(`[data-testid="${cssEscape(containerTestId)}"]`)
      if (container instanceof HTMLElement) setContainerSize(container.getBoundingClientRect().height)
    }
    updateSize()
    const container = document.querySelector(`[data-testid="${cssEscape(containerTestId)}"]`)
    const observer = container instanceof HTMLElement ? new ResizeObserver(updateSize) : null
    if (container instanceof HTMLElement) observer?.observe(container)
    window.addEventListener('resize', updateSize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [containerTestId])

  return {
    containerSize,
    storedSize,
    size: resolvedSize,
    maxSize: resolvedMaxSize,
    mode,
    className: '',
    style: {}
  }
}

export function PanelResizeHandle({
  orientation,
  edge,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
  label,
  active = false,
  className = '',
  valueNow,
  valueMin,
  valueMax,
  dataTestId,
}: {
  orientation: 'vertical' | 'horizontal'
  edge?: 'left' | 'right' | 'top' | 'bottom'
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  label: string
  active?: boolean
  className?: string
  valueNow?: number
  valueMin?: number
  valueMax?: number
  dataTestId?: string
}): JSX.Element {
  const resolvedEdge = edge ?? (orientation === 'horizontal' ? 'top' : 'left')
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={typeof valueNow === 'number' ? Math.round(valueNow) : undefined}
      aria-valuemin={typeof valueMin === 'number' ? Math.round(valueMin) : undefined}
      aria-valuemax={typeof valueMax === 'number' ? Math.round(valueMax) : undefined}
      tabIndex={0}
      data-native-title-free="true"
      data-app-shell-resize-handle="true"
      data-app-shell-resize-edge={resolvedEdge}
      data-active={active ? 'true' : 'false'}
      data-orientation={orientation}
      data-testid={dataTestId}
      className={`panel-resize-handle ${className}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  )
}

export type AppShellResizeEdge = 'left' | 'right' | 'top' | 'bottom'

interface AppShellResizePointer {
  x: number
  y: number
}

interface AppShellResizeUpdate {
  edge: AppShellResizeEdge
  size: number
  rawSize: number
  startSize: number
  delta: number
  minSize: number
  maxSize: number
  pointer: AppShellResizePointer
  startPointer: AppShellResizePointer
}

export interface AppShellResizeController {
  isResizing: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  valueNow: number
  valueMin: number
  valueMax: number
}

function appShellPointerScale(): number {
  const visualViewportScale = typeof window !== 'undefined' ? window.visualViewport?.scale : undefined
  return typeof visualViewportScale === 'number' && Number.isFinite(visualViewportScale) && visualViewportScale > 0
    ? visualViewportScale
    : 1
}

function appShellPointerFromEvent(event: PointerEvent | ReactPointerEvent<HTMLDivElement>): AppShellResizePointer {
  const scale = appShellPointerScale()
  return {
    x: event.clientX / scale,
    y: event.clientY / scale
  }
}

function appShellResizeDelta(edge: AppShellResizeEdge, start: AppShellResizePointer, pointer: AppShellResizePointer): number {
  if (edge === 'left') return start.x - pointer.x
  if (edge === 'right') return pointer.x - start.x
  if (edge === 'top') return start.y - pointer.y
  return pointer.y - start.y
}

function appShellResizeKeyboardDelta(edge: AppShellResizeEdge, key: string, step: number): number | null {
  if (edge === 'left') {
    if (key === 'ArrowLeft') return step
    if (key === 'ArrowRight') return -step
    return null
  }
  if (edge === 'right') {
    if (key === 'ArrowRight') return step
    if (key === 'ArrowLeft') return -step
    return null
  }
  if (edge === 'top') {
    if (key === 'ArrowUp') return step
    if (key === 'ArrowDown') return -step
    return null
  }
  if (key === 'ArrowDown') return step
  if (key === 'ArrowUp') return -step
  return null
}

export function useAppShellResizeController({
  edge,
  size,
  defaultSize,
  minSize,
  maxSize,
  onSizeChange,
  onBelowMin,
  onReset,
}: {
  edge: AppShellResizeEdge
  size: number
  defaultSize: number
  minSize: number
  maxSize: number | (() => number)
  onSizeChange: (nextSize: number, update: AppShellResizeUpdate) => void
  onBelowMin?: (update: AppShellResizeUpdate) => void
  onReset?: () => void
}): AppShellResizeController {
  const [isResizing, setIsResizing] = useState(false)
  const startRef = useRef<{ pointer: AppShellResizePointer; size: number } | null>(null)

  const resolveMaxSize = useCallback((): number => {
    const resolved = typeof maxSize === 'function' ? maxSize() : maxSize
    return Math.max(minSize, resolved)
  }, [maxSize, minSize])

  const applySize = useCallback((rawSize: number, startSize: number, pointer: AppShellResizePointer): void => {
    const resolvedMaxSize = resolveMaxSize()
    const nextSize = Math.max(minSize, Math.min(resolvedMaxSize, rawSize))
    const update: AppShellResizeUpdate = {
      edge,
      size: nextSize,
      rawSize,
      startSize,
      delta: rawSize - startSize,
      minSize,
      maxSize: resolvedMaxSize,
      pointer,
      startPointer: pointer
    }
    if (rawSize < minSize && onBelowMin) {
      onBelowMin(update)
      return
    }
    onSizeChange(nextSize, update)
  }, [edge, minSize, onBelowMin, onSizeChange, resolveMaxSize])

  const finishResize = useCallback((): void => {
    startRef.current = null
    setIsResizing(false)
  }, [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Synthetic smoke-test pointer events do not always create a capturable pointer.
    }
    startRef.current = { pointer: appShellPointerFromEvent(event), size }
    setIsResizing(true)

    const onMove = (moveEvent: PointerEvent): void => {
      const start = startRef.current
      if (!start) return
      moveEvent.preventDefault()
      const pointer = appShellPointerFromEvent(moveEvent)
      const delta = appShellResizeDelta(edge, start.pointer, pointer)
      const rawSize = start.size + delta
      const resolvedMaxSize = resolveMaxSize()
      const nextSize = Math.max(minSize, Math.min(resolvedMaxSize, rawSize))
      const update: AppShellResizeUpdate = {
        edge,
        size: nextSize,
        rawSize,
        startSize: start.size,
        delta,
        minSize,
        maxSize: resolvedMaxSize,
        pointer,
        startPointer: start.pointer
      }
      if (rawSize < minSize && onBelowMin) {
        onBelowMin(update)
        return
      }
      onSizeChange(nextSize, update)
    }

    const onUp = (upEvent: PointerEvent): void => {
      upEvent.preventDefault()
      finishResize()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
  }, [edge, finishResize, minSize, onBelowMin, onSizeChange, resolveMaxSize, size])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Home') {
      event.preventDefault()
      applySize(minSize, size, { x: 0, y: 0 })
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      applySize(resolveMaxSize(), size, { x: 0, y: 0 })
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const resolvedMaxSize = resolveMaxSize()
      const nextSize = Math.max(minSize, Math.min(resolvedMaxSize, defaultSize))
      applySize(nextSize, size, { x: 0, y: 0 })
      return
    }
    const delta = appShellResizeKeyboardDelta(edge, event.key, event.shiftKey ? 64 : 16)
    if (delta === null) return
    event.preventDefault()
    const resolvedMaxSize = resolveMaxSize()
    const nextSize = Math.max(minSize, Math.min(resolvedMaxSize, size + delta))
    applySize(nextSize, size, { x: 0, y: 0 })
  }, [applySize, defaultSize, edge, minSize, resolveMaxSize, size])

  const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    startRef.current = null
    setIsResizing(false)
    if (onReset) {
      onReset()
      return
    }
    const resolvedMaxSize = resolveMaxSize()
    const nextSize = Math.max(minSize, Math.min(resolvedMaxSize, defaultSize))
    onSizeChange(nextSize, {
      edge,
      size: nextSize,
      rawSize: defaultSize,
      startSize: size,
      delta: nextSize - size,
      minSize,
      maxSize: resolvedMaxSize,
      pointer: { x: 0, y: 0 },
      startPointer: { x: 0, y: 0 }
    })
  }, [defaultSize, edge, minSize, onReset, onSizeChange, resolveMaxSize, size])

  return {
    isResizing,
    onPointerDown,
    onKeyDown,
    onDoubleClick,
    valueNow: size,
    valueMin: minSize,
    valueMax: resolveMaxSize()
  }
}

export function TabButton({
  children,
  active,
  tabId,
  panelId,
  onClick,
  onClose,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  closeLabel,
  ariaLabel,
  tooltipLabel,
  draggable = false,
  dragging = false,
  dragOver = false,
  dropPosition = null,
  preview = false,
  pinned = false,
  shimmering = false,
}: {
  children: ReactNode
  active: boolean
  tabId?: string
  panelId?: string
  onClick: () => void
  onClose?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void
  closeLabel?: string
  ariaLabel?: string
  tooltipLabel?: string
  draggable?: boolean
  dragging?: boolean
  dragOver?: boolean
  dropPosition?: 'before' | 'after' | null
  preview?: boolean
  pinned?: boolean
  shimmering?: boolean
}): JSX.Element {
  const tab = (
    <div
      id={tabId && panelId ? panelTabDomId(panelId, tabId) : undefined}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-label={ariaLabel}
      aria-selected={active}
      aria-controls={tabId && panelId ? panelTabPanelDomId(panelId, tabId) : undefined}
      data-native-title-free="true"
      data-app-shell-tab-controller={panelId}
      data-tab-id={tabId}
      data-active={active ? 'true' : 'false'}
      data-draggable={draggable ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-drag-over={dragOver ? 'true' : 'false'}
      data-drop-position={dropPosition ?? ''}
      data-preview={preview ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : 'false'}
      data-shimmering={shimmering ? 'true' : 'false'}
      data-closable={onClose ? 'true' : 'false'}
      className="motion-tab-button"
      draggable={draggable}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onAuxClick={(event) => {
        if (event.button !== 1 || !onClose) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick()
      }}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onClose && (
        <button
          type="button"
          aria-label={closeLabel}
          tabIndex={active ? 0 : -1}
          data-native-title-free="true"
          className="motion-tab-close"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  )

  return tooltipLabel ? <Tooltip label={tooltipLabel}>{tab}</Tooltip> : tab
}

export interface PanelTabItem<T extends string | number> {
  id: T
  label: string
  icon?: IconName
  count?: number
  closable?: boolean
  preview?: boolean
  pinned?: boolean
  shimmering?: boolean
  closeLabel?: string
  ariaLabel?: string
  tooltipLabel?: string
}

export function PanelTabStrip<T extends string | number>({
  tabs,
  activeTabId,
  panelId,
  onActivate,
  onClose,
  onContextMenu,
  onMove,
  actions,
  className = '',
  stripTestId,
  tabRowTestId,
  actionsTestId,
  activeActionsHostTestId,
}: {
  tabs: PanelTabItem<T>[]
  activeTabId: T | null
  panelId?: string
  onActivate: (tabId: T) => void
  onClose?: (tabId: T) => void
  onContextMenu?: (event: React.MouseEvent, tabId: T) => void
  onMove?: (tabId: T, direction: 'left' | 'right') => void
  actions?: ReactNode
  className?: string
  stripTestId?: string
  tabRowTestId?: string
  actionsTestId?: string
  activeActionsHostTestId?: string
}): JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const draggingTabIdRef = useRef<T | null>(null)
  const previousActiveTabIdRef = useRef<T | null>(activeTabId)
  const previousTelemetryTabIdsRef = useRef<Set<string> | null>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  const [actionsWidth, setActionsWidth] = useState(0)
  const [draggingTabId, setDraggingTabId] = useState<T | null>(null)
  const [dragOverTab, setDragOverTab] = useState<{ tabId: T; position: 'before' | 'after' } | null>(null)

  const updateEdges = (): void => {
    const row = rowRef.current
    if (!row) return
    const maxScroll = row.scrollWidth - row.clientWidth
    setEdges({
      start: row.scrollLeft > 1,
      end: maxScroll - row.scrollLeft > 1,
    })
  }

  const scrollActiveTabIntoView = useCallback((): void => {
    const row = rowRef.current
    if (!row) return
    const activeTab = panelId && activeTabId !== null
      ? row.querySelector<HTMLElement>(`[data-app-shell-tab-controller="${cssEscape(panelId)}"][data-tab-id="${cssEscape(String(activeTabId))}"]`)
      : row.querySelector<HTMLElement>('[data-active="true"]')
    if (!activeTab) return
    const rowRect = row.getBoundingClientRect()
    const activeRect = activeTab.getBoundingClientRect()
    const visibleLeft = rowRect.left
    const visibleRight = rowRect.right
    if (activeRect.left < visibleLeft) {
      row.scrollLeft -= visibleLeft - activeRect.left
    } else if (activeRect.right > visibleRight) {
      row.scrollLeft += activeRect.right - visibleRight
    }
  }, [activeTabId, panelId])

  useLayoutEffect(() => {
    updateEdges()
    scrollActiveTabIntoView()
    const activeChanged = previousActiveTabIdRef.current !== activeTabId
    previousActiveTabIdRef.current = activeTabId
    if (panelId && activeTabId !== null && activeChanged) {
      window.requestAnimationFrame(() => {
        const panel = document.querySelector<HTMLElement>(
          `[role="tabpanel"][data-app-shell-tab-panel-controller="${cssEscape(panelId)}"][data-tab-id="${cssEscape(String(activeTabId))}"]`
        )
        if (panel && !panel.contains(document.activeElement)) {
          panel.focus({ preventScroll: true })
        }
      })
    }
    window.requestAnimationFrame(updateEdges)
  }, [activeTabId, panelId, scrollActiveTabIntoView, tabs.length])

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const updateActiveTabVisibility = (): void => {
      scrollActiveTabIntoView()
      updateEdges()
    }
    const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(updateActiveTabVisibility))
    resizeObserver.observe(row)
    row.addEventListener('scroll', updateEdges, { passive: true })
    window.addEventListener('resize', updateEdges)
    return () => {
      resizeObserver.disconnect()
      row.removeEventListener('scroll', updateEdges)
      window.removeEventListener('resize', updateEdges)
    }
  }, [scrollActiveTabIntoView])

  useLayoutEffect(() => {
    const actionSlot = actionsRef.current
    if (!actionSlot) {
      setActionsWidth(0)
      return
    }
    const updateActionWidth = (): void => {
      setActionsWidth(Math.ceil(actionSlot.getBoundingClientRect().width))
      window.requestAnimationFrame(updateEdges)
    }
    updateActionWidth()
    const resizeObserver = new ResizeObserver(updateActionWidth)
    resizeObserver.observe(actionSlot)
    return () => resizeObserver.disconnect()
  }, [actions])

  useEffect(() => {
    if (!panelId || activeTabId === null) return
    recordPanelTabMetric('panel.tab.viewed', panelId, activeTabId, tabs.length)
  }, [activeTabId, panelId, tabs.length])

  useEffect(() => {
    if (!panelId) return
    const currentIds = new Set(tabs.map((tab) => String(tab.id)))
    const previousIds = previousTelemetryTabIdsRef.current
    previousTelemetryTabIdsRef.current = currentIds
    if (!previousIds) return
    for (const tab of tabs) {
      if (!previousIds.has(String(tab.id))) {
        recordPanelTabMetric('panel.tab.opened', panelId, tab.id, tabs.length)
      }
    }
    previousIds.forEach((tabId) => {
      if (!currentIds.has(tabId)) {
        recordPanelTabMetric('panel.tab.closed', panelId, tabId, tabs.length)
      }
    })
  }, [panelId, tabs])

  const reorderDraggedTab = (targetTabId: T): void => {
    const sourceTabId = draggingTabIdRef.current
    if (!onMove || sourceTabId === null || sourceTabId === targetTabId) return
    const sourceIndex = tabs.findIndex((tab) => tab.id === sourceTabId)
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return
    const direction = sourceIndex < targetIndex ? 'right' : 'left'
    for (let step = 0; step < Math.abs(targetIndex - sourceIndex); step += 1) {
      onMove(sourceTabId, direction)
    }
  }

  const clearDragDropMarkers = (): void => {
    rowRef.current?.querySelectorAll<HTMLElement>('[role="tab"]').forEach((element) => {
      element.dataset.dragOver = 'false'
      element.dataset.dropPosition = ''
    })
  }

  const dropPositionForTab = (event: React.DragEvent<HTMLDivElement>, targetTabId: T): 'before' | 'after' => {
    const sourceTabId = draggingTabIdRef.current
    const targetRect = event.currentTarget.getBoundingClientRect()
    if (event.clientX >= targetRect.left && event.clientX <= targetRect.right) {
      return event.clientX < targetRect.left + targetRect.width / 2 ? 'before' : 'after'
    }
    const sourceIndex = sourceTabId === null ? -1 : tabs.findIndex((tab) => tab.id === sourceTabId)
    const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId)
    return sourceIndex >= 0 && targetIndex >= 0 && sourceIndex < targetIndex ? 'after' : 'before'
  }

  const focusTabAt = (index: number): void => {
    const row = rowRef.current
    if (!row || tabs.length === 0) return
    const tabElements = Array.from(row.querySelectorAll<HTMLElement>('[role="tab"]'))
    const targetIndex = Math.max(0, Math.min(tabElements.length - 1, index))
    tabElements[targetIndex]?.focus({ preventScroll: true })
    const targetTab = tabs[targetIndex]
    if (targetTab) onActivate(targetTab.id)
  }

  const handleTabRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const row = rowRef.current
    if (!row) return
    const tabElements = Array.from(row.querySelectorAll<HTMLElement>('[role="tab"]'))
    const focusedIndex = tabElements.findIndex((element) => element === document.activeElement || element.contains(document.activeElement))
    const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId))
    const currentIndex = focusedIndex === -1 ? activeIndex : focusedIndex
    event.preventDefault()
    if (event.key === 'Home') {
      focusTabAt(0)
      return
    }
    if (event.key === 'End') {
      focusTabAt(tabs.length - 1)
      return
    }
    const delta = event.key === 'ArrowLeft' ? -1 : 1
    focusTabAt((currentIndex + delta + tabs.length) % tabs.length)
  }

  const handleTabRowWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    const row = rowRef.current
    if (!row) return
    const delta = event.deltaX || event.deltaY
    if (delta === 0 || row.scrollWidth <= row.clientWidth) return
    const before = row.scrollLeft
    row.scrollLeft += delta
    if (row.scrollLeft !== before) event.preventDefault()
    updateEdges()
  }

  return (
    <div
      className={`panel-tab-strip ${className}`}
      style={{ '--panel-tab-actions-width': `${actionsWidth}px` } as CSSProperties}
      data-testid={stripTestId}
      data-panel-toolbar="true"
      data-overflow-start={edges.start ? 'true' : 'false'}
      data-overflow-end={edges.end ? 'true' : 'false'}
      data-panel-tab-actions-width={actionsWidth}
    >
      <div className="panel-tab-scroll-frame">
        <div
          ref={rowRef}
          className="panel-tab-row"
          role="tablist"
          data-testid={tabRowTestId}
          data-app-shell-tab-controller
          onKeyDown={handleTabRowKeyDown}
          onWheel={handleTabRowWheel}
        >
          {tabs.map((tab) => {
            const closeTab = onClose && tab.closable !== false ? () => {
              if (panelId) exitFullscreenForPanelTab(panelId, tab.id)
              onClose(tab.id)
            } : undefined
            return (
            <TabButton
              key={tab.id}
              active={activeTabId === tab.id}
              tabId={String(tab.id)}
              panelId={panelId}
              onClick={() => onActivate(tab.id)}
              onClose={closeTab}
              onContextMenu={(event) => onContextMenu?.(event, tab.id)}
              draggable={Boolean(onMove && tabs.length > 1)}
              dragging={draggingTabId === tab.id}
              dragOver={dragOverTab?.tabId === tab.id && draggingTabId !== tab.id}
              dropPosition={dragOverTab?.tabId === tab.id && draggingTabId !== tab.id ? dragOverTab.position : null}
              preview={tab.preview}
              pinned={tab.pinned}
              shimmering={tab.shimmering}
              onDragStart={(event) => {
                if (!onMove || tabs.length < 2) {
                  event.preventDefault()
                  return
                }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-orchestrator-panel-tab', String(tab.id))
                draggingTabIdRef.current = tab.id
                clearDragDropMarkers()
                setDraggingTabId(tab.id)
                setDragOverTab(null)
              }}
              onDragOver={(event) => {
                if (!onMove || draggingTabIdRef.current === null) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const position = dropPositionForTab(event, tab.id)
                clearDragDropMarkers()
                event.currentTarget.dataset.dragOver = 'true'
                event.currentTarget.dataset.dropPosition = position
                setDragOverTab({ tabId: tab.id, position })
              }}
              onDrop={(event) => {
                if (!onMove) return
                event.preventDefault()
                reorderDraggedTab(tab.id)
                draggingTabIdRef.current = null
                clearDragDropMarkers()
                setDraggingTabId(null)
                setDragOverTab(null)
              }}
              onDragEnd={() => {
                draggingTabIdRef.current = null
                clearDragDropMarkers()
                setDraggingTabId(null)
                setDragOverTab(null)
              }}
              closeLabel={tab.closeLabel ?? `Close ${tab.label}`}
              ariaLabel={tab.ariaLabel ?? tab.label}
              tooltipLabel={tab.tooltipLabel ?? tab.label}
            >
              <span className="panel-tab-content" data-tab-id={tab.id}>
                {tab.icon && <Icon name={tab.icon} size={13} />}
                <span className="panel-tab-label">{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="panel-tab-count">{tab.count}</span>
                )}
              </span>
            </TabButton>
            )
          })}
        </div>
      </div>
      {actions && (
        <div ref={actionsRef} className="panel-tab-actions" data-testid={actionsTestId}>
          {panelId && (
            <div
              id={panelActiveTabActionsDomId(panelId)}
              className="panel-active-tab-actions"
              data-testid={activeActionsHostTestId}
              data-panel-active-tab-actions="true"
              data-panel-id={panelId}
              data-active-tab={activeTabId ?? ''}
            />
          )}
          {actions}
        </div>
      )}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = '',
}: {
  value: T
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>
  onChange: (value: T) => void
  className?: string
}): JSX.Element {
  return (
    <div className={`segmented-control ${className}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          data-active={option.value === value ? 'true' : 'false'}
          className="segmented-control-button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="panel-header">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{subtitle}</div>}
      </div>
      {actions && <div className="panel-header-actions">{actions}</div>}
    </div>
  )
}

export function SettingsIntro({
  description,
}: {
  description: ReactNode
}): JSX.Element {
  return (
    <div className="settings-intro">
      <div className="settings-intro-description">{description}</div>
    </div>
  )
}

export function SettingsContentLayout({
  title,
  subtitle,
  action,
  children,
  className = '',
  contentClassName = '',
  dataTestId,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  dataTestId?: string
}): JSX.Element {
  return (
    <div
      className={`settings-content-layout ${className}`.trim()}
      data-settings-content-layout="codex"
      data-testid={dataTestId}
    >
      {(title || subtitle || action) && (
        <div className="settings-content-layout-header">
          <div className="settings-content-layout-title-stack">
            {title && <div className="settings-content-layout-title">{title}</div>}
            {subtitle && <div className="settings-content-layout-subtitle">{subtitle}</div>}
          </div>
          {action && <div className="settings-content-layout-action">{action}</div>}
        </div>
      )}
      <div className={`settings-content-layout-body ${contentClassName}`.trim()}>
        {children}
      </div>
    </div>
  )
}

export function SettingsPageSection({
  children,
  className = '',
  dataTestId,
}: {
  children: ReactNode
  className?: string
  dataTestId?: string
}): JSX.Element {
  return (
    <div className={`settings-page-section ${className}`.trim()} data-testid={dataTestId}>
      {children}
    </div>
  )
}

export function SettingGroup({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="settings-group">
      <div className="settings-group-label">
        <div className="settings-group-title">{title}</div>
        {description && <div className="settings-group-description">{description}</div>}
      </div>
      <div className="settings-group-body">{children}</div>
    </section>
  )
}

export function SettingsContentGroup({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`settings-content-group ${className}`.trim()}>
      {children}
    </section>
  )
}

export function SettingsGroupContent({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={`settings-group-content ${className}`.trim()}>
      {children}
    </div>
  )
}

export function SettingsPanel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section className={`settings-panel ${className}`}>
      {children}
    </section>
  )
}

export function SettingsSurface({
  children,
  className = '',
  dataTestId,
  variant = 'default',
}: {
  children: ReactNode
  className?: string
  dataTestId?: string
  variant?: 'default' | 'secondary'
}): JSX.Element {
  return (
    <div className={`settings-surface ${className}`.trim()} data-testid={dataTestId} data-variant={variant}>
      {children}
    </div>
  )
}

export function CompactSetting({
  title,
  children,
}: {
  title: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="compact-setting">
      <div className="compact-setting-title">{title}</div>
      <div className="compact-setting-body">{children}</div>
    </div>
  )
}

export function SettingsRow({
  label,
  description,
  control,
  className = '',
  variant = 'surface',
}: {
  label: ReactNode
  description?: ReactNode
  control: ReactNode
  className?: string
  variant?: 'surface' | 'nested'
}): JSX.Element {
  return (
    <div className={`settings-row ${className}`.trim()} data-variant={variant}>
      <div className="settings-row-copy">
        <div className="settings-row-label">{label}</div>
        {description && <div className="settings-row-description">{description}</div>}
      </div>
      <div className="settings-row-control">{control}</div>
    </div>
  )
}

export function SettingChoiceCard({
  label,
  description,
  active,
  onClick,
  leading,
  disabled = false,
  dataTestId,
}: {
  label: ReactNode
  description?: ReactNode
  active: boolean
  onClick: () => void
  leading?: ReactNode
  disabled?: boolean
  dataTestId?: string
}): JSX.Element {
  return (
    <button
      type="button"
      data-active={active ? 'true' : 'false'}
      data-testid={dataTestId}
      aria-pressed={active}
      disabled={disabled}
      className="setting-choice-card"
      onClick={onClick}
    >
      {leading && <span className="setting-choice-card-leading">{leading}</span>}
      <span className="setting-choice-card-copy">
        <span className="setting-choice-card-label">{label}</span>
        {description && <span className="setting-choice-card-description">{description}</span>}
      </span>
    </button>
  )
}

export function StatusPill({
  label,
  color,
}: {
  label: ReactNode
  color: string
}): JSX.Element {
  return (
    <span className="status-pill" style={{ color, borderColor: color }}>
      {label}
    </span>
  )
}

export function DiagnosticPill({
  status,
  color,
}: {
  status: string
  color: string
}): JSX.Element {
  const normalized = status.toLowerCase()
  const isGood = ['found', 'ok', 'available', 'configured', 'passed', 'connected'].includes(normalized)
  const isBad = ['missing', 'error', 'empty', 'failed'].includes(normalized)
  const isWarning = ['warning', 'disconnected'].includes(normalized)
  const pillColor = isGood ? color : isBad ? 'var(--state-danger)' : isWarning ? 'var(--state-warning)' : 'var(--text-tertiary)'
  const labels: Record<string, string> = {
    found: 'OK',
    ok: 'OK',
    available: 'OK',
    configured: 'OK',
    passed: 'OK',
    connected: 'Live',
    starting: 'Starting',
    disconnected: 'Offline',
    stopped: 'Stopped',
    missing: 'Missing',
    warning: 'Warn',
    error: 'Error',
    empty: 'Empty',
    failed: 'Failed',
    skipped: 'Skip',
    unavailable: 'N/A',
    unknown: 'Unknown',
    'not-run': 'Off',
  }
  return (
    <StatusPill color={pillColor} label={labels[normalized] ?? status.replace('-', ' ')} />
  )
}

export function InspectorCard({
  children,
  active = false,
  className = '',
  style,
}: {
  children: ReactNode
  active?: boolean
  className?: string
  style?: CSSProperties
}): JSX.Element {
  return (
    <div
      data-active={active ? 'true' : 'false'}
      className={`inspector-card motion-row ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}

export function InspectorSection({
  children,
  title,
  className = '',
  dataTestId,
  variant = 'default',
}: {
  children: ReactNode
  title?: ReactNode
  className?: string
  dataTestId?: string
  variant?: 'default' | 'raised'
}): JSX.Element {
  return (
    <section
      data-testid={dataTestId}
      data-inspector-section="true"
      data-inspector-section-variant={variant}
      className={`orchestrator-inspector-section ${className}`.trim()}
    >
      {title && (
        <div className="orchestrator-inspector-section-title" data-inspector-section-title="true">
          {title}
        </div>
      )}
      {children}
    </section>
  )
}

export function InspectorDisclosure({
  children,
  title,
  className = '',
  dataTestId,
  defaultOpen = false,
}: {
  children: ReactNode
  title: ReactNode
  className?: string
  dataTestId?: string
  defaultOpen?: boolean
}): JSX.Element {
  return (
    <details
      className={`orchestrator-inspector-section orchestrator-inspector-disclosure ${className}`.trim()}
      data-inspector-section="true"
      data-inspector-section-variant="default"
      data-testid={dataTestId}
      open={defaultOpen}
    >
      <summary className="orchestrator-inspector-disclosure-summary">
        {title}
      </summary>
      {children}
    </details>
  )
}

export function InspectorRow({
  children,
  className = '',
  dataTestId,
  variant = 'default',
}: {
  children: ReactNode
  className?: string
  dataTestId?: string
  variant?: 'default' | 'muted'
}): JSX.Element {
  return (
    <div
      data-testid={dataTestId}
      data-inspector-row="true"
      data-inspector-row-variant={variant}
      className={`orchestrator-inspector-row ${className}`.trim()}
    >
      {children}
    </div>
  )
}

export function MetricPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: Tone
}): JSX.Element {
  return (
    <span
      className="metric-pill"
      style={{
        color: toneColor[tone],
        background: `color-mix(in srgb, ${toneColor[tone]} 10%, var(--surface-bg))`,
        borderColor: `color-mix(in srgb, ${toneColor[tone]} 25%, var(--border-subtle))`,
      }}
    >
      {children}
    </span>
  )
}

export function SwitchControl({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-checked={checked ? 'true' : 'false'}
      className="switch-control"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-control-thumb" />
    </button>
  )
}

interface BadgeProps {
  children: ReactNode
  tone?: Tone
  interactive?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}

export function Badge({
  children,
  tone = 'neutral',
  interactive = false,
  className = '',
  style,
  title,
}: BadgeProps): JSX.Element {
  return (
    <span
      title={title}
      className={`inline-flex min-w-0 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${interactive ? 'motion-badge-button' : ''} ${className}`}
      style={{
        color: toneColor[tone],
        background: `color-mix(in srgb, ${toneColor[tone]} 10%, var(--surface-bg))`,
        borderColor: `color-mix(in srgb, ${toneColor[tone]} 26%, var(--border-subtle))`,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

export function StatusBadge({
  label,
  tone = 'neutral',
  pulse = false,
}: {
  label: string
  tone?: Tone
  pulse?: boolean
}): JSX.Element {
  return (
    <Badge tone={tone}>
      <span
        className={`rounded-full ${pulse ? 'motion-status-pulse' : ''}`}
        style={{ width: 5, height: 5, background: toneColor[tone] }}
      />
      <span className="truncate">{label}</span>
    </Badge>
  )
}

export function AttachmentPill({
  label,
  title,
  meta,
  onRemove,
  tone = 'neutral',
  className = '',
}: {
  label: ReactNode
  title?: string
  meta?: ReactNode
  onRemove?: () => void
  tone?: Tone
  className?: string
}): JSX.Element {
  return (
    <span
      title={title}
      className={`attachment-pill motion-row inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${className}`}
      style={{
        color: toneColor[tone],
        background: 'var(--surface-bg)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <Icon name="file" size={12} />
      <span className="min-w-0 truncate">{label}</span>
      {meta && <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{meta}</span>}
      {onRemove && (
        <IconButton
          icon="close"
          label={`Remove ${typeof label === 'string' ? label : 'attachment'}`}
          onClick={onRemove}
          size="sm"
          tooltip={false}
          className="h-4 w-4"
          style={{ width: 16, height: 16, color: 'var(--text-tertiary)' }}
        />
      )}
    </span>
  )
}

export function MarkdownSurface({
  children,
  user = false,
  className = '',
}: {
  children: ReactNode
  user?: boolean
  className?: string
}): JSX.Element {
  return (
    <div data-user={user ? 'true' : 'false'} className={`markdown-surface ${className}`}>
      {children}
    </div>
  )
}

export function ThinkingDots({
  label = 'Thinking',
}: {
  label?: string
}): JSX.Element {
  return (
    <div className="thinking-dots" aria-label={label}>
      {[0, 1, 2].map((index) => (
        <span key={index} className="thinking-dot" style={{ animationDelay: `${index * 0.2}s` }} />
      ))}
    </div>
  )
}

interface SurfaceRowProps {
  children: ReactNode
  active?: boolean
  disabled?: boolean
  index?: number
  as?: 'button' | 'div'
  onClick?: () => void | Promise<void>
  onDoubleClick?: (event: React.MouseEvent) => void | Promise<void>
  onContextMenu?: (event: React.MouseEvent) => void
  onMouseEnter?: (event: React.MouseEvent) => void
  className?: string
  style?: CSSProperties
  title?: string
  ariaLabel?: string
  dataTestId?: string
  dataReviewPath?: string
  dataSidebarKey?: string
  [key: `data-${string}`]: string | number | boolean | undefined
}

export function SurfaceRow({
  children,
  active = false,
  disabled = false,
  index = 0,
  as = 'div',
  onClick,
  onDoubleClick,
  onContextMenu,
  onMouseEnter,
  className = '',
  style,
  title,
  ariaLabel,
  ariaPressed,
  dataTestId,
  dataReviewPath,
  dataSidebarKey,
  ...dataAttributes
}: SurfaceRowProps): JSX.Element {
  const shared = {
    ...dataAttributes,
    'data-active': active ? 'true' : 'false',
    'data-testid': dataTestId,
    'data-review-path': dataReviewPath,
    'data-sidebar-key': dataSidebarKey,
    'data-tooltip-label': title,
    'data-native-title-free': title ? 'true' : undefined,
    className: `surface-row motion-row ${className}`,
    style: { ...rowMotionStyle(index), ...style },
    onContextMenu,
    onMouseEnter,
    onDoubleClick: (event: React.MouseEvent) => { void onDoubleClick?.(event) },
    'aria-label': ariaLabel ?? title,
    'aria-pressed': ariaPressed,
  }

  if (as === 'button') {
    const row = (
      <button
        type="button"
        {...shared}
        disabled={disabled}
        onClick={() => { void onClick?.() }}
      >
        {children}
      </button>
    )
    return title ? <Tooltip label={title}>{row}</Tooltip> : row
  }

  const row = (
    <div
      {...shared}
      onClick={() => { void onClick?.() }}
    >
      {children}
    </div>
  )
  return title ? <Tooltip label={title}>{row}</Tooltip> : row
}

export function SidebarListRow({
  icon,
  leading,
  label,
  detail,
  trailing,
  active = false,
  disabled = false,
  as = 'button',
  size = 'nav',
  onClick,
  onDoubleClick,
  onContextMenu,
  dataTestId,
  dataSidebarKey,
  ariaLabel,
  className = '',
}: {
  icon?: IconName
  leading?: ReactNode
  label: ReactNode
  detail?: ReactNode
  trailing?: ReactNode
  active?: boolean
  disabled?: boolean
  as?: 'button' | 'div'
  size?: 'nav' | 'thread' | 'section' | 'compact'
  onClick: () => void | Promise<void>
  onDoubleClick?: (event: React.MouseEvent) => void | Promise<void>
  onContextMenu?: (event: React.MouseEvent) => void
  dataTestId?: string
  dataSidebarKey?: string
  ariaLabel?: string
  className?: string
}): JSX.Element {
  return (
    <SurfaceRow
      as={as}
      active={active}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      dataTestId={dataTestId}
      dataSidebarKey={dataSidebarKey}
      ariaLabel={ariaLabel}
      className={`sidebar-list-row sidebar-list-row-${size} ${className}`.trim()}
    >
      <span className="sidebar-list-row-content">
        {leading}
        {icon && <Icon name={icon} size={14} />}
        <span className="sidebar-list-row-label">{label}</span>
      </span>
      {detail && <span className="sidebar-list-row-detail">{detail}</span>}
      {trailing && <span className="sidebar-list-row-trailing">{trailing}</span>}
    </SurfaceRow>
  )
}

interface DisclosureSectionProps {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  meta?: ReactNode
  className?: string
  bodyClassName?: string
}

export function DisclosureSection({
  title,
  children,
  defaultOpen = false,
  meta,
  className = '',
  bodyClassName = '',
}: DisclosureSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <button
        type="button"
        className="motion-disclosure-trigger flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs"
        style={{ color: 'var(--text-secondary)' }}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="motion-chevron shrink-0" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <Icon name="chevronDown" size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {meta && <span className="shrink-0">{meta}</span>}
      </button>
      {open && (
        <div className={`motion-disclosure-content ${bodyClassName}`}>
          {children}
        </div>
      )}
    </div>
  )
}

export function MotionOverlay({
  children,
  onClose,
  className = '',
  surfaceClassName = '',
  surfaceStyle,
  backdropStyle,
}: {
  children: ReactNode
  onClose: () => void
  className?: string
  surfaceClassName?: string
  surfaceStyle?: CSSProperties
  backdropStyle?: CSSProperties
}): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { exiting, close } = useRetainedExit(onClose)
  useLayerFocus(surfaceRef, close)

  return (
    <div
      className={`motion-overlay-backdrop fixed inset-0 z-50 flex items-center justify-center ${className}`}
      data-motion-exit={exiting ? 'true' : 'false'}
      aria-hidden={exiting ? 'true' : undefined}
      style={{ background: 'rgba(16, 24, 40, 0.18)', backdropFilter: 'blur(4px)', ...backdropStyle }}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`motion-overlay-surface ${surfaceClassName}`}
        style={surfaceStyle}
      >
        {children}
      </div>
    </div>
  )
}

export function Sheet({
  title,
  children,
  footer,
  onClose,
  width = 520,
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}): JSX.Element {
  const sheetRef = useRef<HTMLElement>(null)
  const { exiting, close } = useRetainedExit(onClose)
  useLayerFocus(sheetRef, close)

  return (
    <div
      className="motion-sheet-backdrop fixed inset-0 z-50 flex justify-end"
      data-motion-exit={exiting ? 'true' : 'false'}
      aria-hidden={exiting ? 'true' : undefined}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="motion-sheet flex h-full min-h-0 flex-col"
        style={{ width }}
      >
        <header className="motion-sheet-header">
          <div className="min-w-0 flex-1">{title}</div>
          <IconButton icon="close" label="Close" onClick={close} />
        </header>
        <div className="motion-sheet-body">{children}</div>
        {footer && <footer className="motion-sheet-footer">{footer}</footer>}
      </section>
    </div>
  )
}

export const PopoverSurface = forwardRef<HTMLDivElement, {
  children: ReactNode
  className?: string
  style?: CSSProperties
} & HTMLAttributes<HTMLDivElement>>(function PopoverSurface({
  children,
  className = '',
  style,
  ...divProps
}, ref): JSX.Element {
  return (
    <div
      ref={ref}
      {...divProps}
      className={`motion-popover-surface ${className}`}
      style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-bg)',
        boxShadow: 'var(--shadow-menu)',
        color: 'var(--text-primary)',
        ...style,
      }}
    >
      {children}
    </div>
  )
})

export function DismissablePopoverSurface({
  children,
  onClose,
  className = '',
  style,
  role,
}: {
  children: ReactNode
  onClose: () => void
  className?: string
  style?: CSSProperties
  role?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { exiting, close } = useRetainedExit(onClose)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const restoreFocus = (): void => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        restoreFocus()
        close()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        window.setTimeout(() => {
          restoreFocus()
          close()
        }, 0)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('mousedown', onMouseDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('mousedown', onMouseDown, { capture: true })
      restoreFocus()
    }
  }, [close])

  return (
    <PopoverSurface
      ref={ref}
      className={className}
      style={style}
      data-motion-exit={exiting ? 'true' : 'false'}
      aria-hidden={exiting ? 'true' : undefined}
    >
      <div role={role} className="min-w-0">
        {children}
      </div>
    </PopoverSurface>
  )
}

export function MenuSurface({
  children,
  onClose,
  className = '',
  style,
  ...surfaceProps
}: {
  children: ReactNode
  onClose: () => void
  className?: string
  style?: CSSProperties
} & HTMLAttributes<HTMLDivElement>): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { exiting, close } = useRetainedExit(onClose)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const restoreFocus = (): void => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
    const menuItems = (): HTMLButtonElement[] => (
      Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    )
    const focusMenuItem = (delta: 1 | -1): void => {
      const items = menuItems()
      if (items.length === 0) return
      const currentIndex = items.findIndex((item) => item === document.activeElement)
      const nextIndex = currentIndex === -1
        ? (delta === 1 ? 0 : items.length - 1)
        : (currentIndex + delta + items.length) % items.length
      const next = items[nextIndex]
      next?.focus()
    }
    const focusBoundaryItem = (boundary: 'first' | 'last'): void => {
      const items = menuItems()
      const next = boundary === 'first' ? items[0] : items[items.length - 1]
      next?.focus()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        restoreFocus()
        close()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusMenuItem(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusMenuItem(-1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusBoundaryItem('first')
      } else if (event.key === 'End') {
        event.preventDefault()
        focusBoundaryItem('last')
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        window.setTimeout(() => {
          restoreFocus()
          close()
        }, 0)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('mousedown', onMouseDown, { capture: true })
    window.setTimeout(() => focusBoundaryItem('first'), 0)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('mousedown', onMouseDown, { capture: true })
      restoreFocus()
    }
  }, [close])

  return (
    <PopoverSurface
      ref={ref}
      {...surfaceProps}
      data-motion-exit={exiting ? 'true' : 'false'}
      aria-hidden={exiting ? 'true' : undefined}
      className={`orchestrator-menu-surface ${className}`.trim()}
      style={{
        borderRadius: 12,
        border: '0.5px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--surface-bg) 90%, transparent)',
        boxShadow: 'var(--shadow-menu)',
        backdropFilter: 'blur(12px)',
        minWidth: 178,
        maxWidth: 'min(420px, calc(100vw - 16px))',
        maxHeight: 'min(320px, calc(100vh - 16px))',
        ...style,
      }}
    >
      <div role="menu" className="orchestrator-menu-content">
        {children}
      </div>
    </PopoverSurface>
  )
}

export function MenuItem({
  icon,
  label,
  onClick,
  tone = 'neutral',
  disabled = false,
  ariaLabel,
  dataTestId,
}: {
  icon?: IconName
  label: ReactNode
  onClick: () => void | Promise<void>
  tone?: Tone
  disabled?: boolean
  ariaLabel?: string
  dataTestId?: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      onClick={() => { void onClick() }}
      className="motion-menu-item orchestrator-menu-item flex w-full items-center gap-2 text-left disabled:cursor-default disabled:opacity-45"
      style={{
        color: toneColor[tone],
        background: 'transparent',
        border: 'none',
      }}
    >
      {icon && <Icon name={icon} size={13} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function MenuRow({
  children,
  icon,
  onClick,
  disabled = false,
  ariaLabel,
  className = '',
  dataTestId,
}: {
  children: ReactNode
  icon?: IconName
  onClick?: () => void | Promise<void>
  disabled?: boolean
  ariaLabel?: string
  className?: string
  dataTestId?: string
}): JSX.Element {
  const sharedClassName = `orchestrator-menu-row ${className}`.trim()
  const content = (
    <>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        aria-label={ariaLabel}
        data-testid={dataTestId}
        data-menu-row="true"
        onClick={() => { void onClick() }}
        className={sharedClassName}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      data-testid={dataTestId}
      data-menu-row="true"
      data-menu-row-static="true"
      className={sharedClassName}
    >
      {content}
    </div>
  )
}

export function MenuSection({
  children,
  className = '',
  dataTestId,
  ...props
}: {
  children: ReactNode
  className?: string
  dataTestId?: string
} & HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      {...props}
      data-testid={dataTestId}
      data-menu-section="true"
      className={`orchestrator-menu-section ${className}`.trim()}
    >
      {children}
    </div>
  )
}

export function MenuSectionLabel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div
      data-menu-section-label="true"
      className={`orchestrator-menu-section-label ${className}`.trim()}
    >
      {children}
    </div>
  )
}

type MenuMessageTone = 'muted' | 'danger'

export function MenuMessage({
  children,
  tone = 'muted',
  centered = false,
  compact = false,
  className = '',
  dataTestId,
  state,
}: {
  children: ReactNode
  tone?: MenuMessageTone
  centered?: boolean
  compact?: boolean
  className?: string
  dataTestId?: string
  state?: string
}): JSX.Element {
  return (
    <div
      data-testid={dataTestId}
      data-menu-message="true"
      data-menu-message-tone={tone}
      data-menu-message-centered={centered ? 'true' : 'false'}
      data-menu-message-compact={compact ? 'true' : 'false'}
      data-menu-message-state={state}
      className={`orchestrator-menu-message ${className}`.trim()}
    >
      {children}
    </div>
  )
}

type PanelMessageTone = 'muted' | 'danger' | 'warning'

export function PanelMessage({
  children,
  tone = 'muted',
  centered = false,
  compact = false,
  framed = false,
  className = '',
  dataTestId,
  state,
}: {
  children: ReactNode
  tone?: PanelMessageTone
  centered?: boolean
  compact?: boolean
  framed?: boolean
  className?: string
  dataTestId?: string
  state?: string
}): JSX.Element {
  return (
    <div
      data-testid={dataTestId}
      data-panel-message="true"
      data-panel-message-tone={tone}
      data-panel-message-centered={centered ? 'true' : 'false'}
      data-panel-message-compact={compact ? 'true' : 'false'}
      data-panel-message-framed={framed ? 'true' : 'false'}
      data-panel-message-state={state}
      className={`orchestrator-panel-message ${className}`.trim()}
    >
      {children}
    </div>
  )
}

export function PanelNotice({
  icon,
  title,
  description,
  code,
  actions,
  actionsAttrs,
  children,
  tone = 'muted',
  className = '',
  dataTestId,
  rootAttrs,
  state,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  code?: ReactNode
  actions?: ReactNode
  actionsAttrs?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>
  children?: ReactNode
  tone?: PanelMessageTone
  className?: string
  dataTestId?: string
  rootAttrs?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>
  state?: string
}): JSX.Element {
  return (
    <div
      {...rootAttrs}
      data-testid={dataTestId}
      data-panel-notice="true"
      data-panel-notice-tone={tone}
      data-panel-notice-state={state}
      className={`orchestrator-panel-notice ${className}`.trim()}
    >
      {icon && <div className="orchestrator-panel-notice-icon">{icon}</div>}
      <div className="orchestrator-panel-notice-copy">
        <div className="orchestrator-panel-notice-title">{title}</div>
        {description && (
          <div className="orchestrator-panel-notice-description">
            {description}
          </div>
        )}
        {code && <div className="orchestrator-panel-notice-code">{code}</div>}
      </div>
      {actions && <div {...actionsAttrs} className="orchestrator-panel-notice-actions">{actions}</div>}
      {children}
    </div>
  )
}

export function DialogContent({
  children,
  as = 'div',
  className = '',
  dataTestId,
  onSubmit,
}: {
  children: ReactNode
  as?: 'div' | 'form'
  className?: string
  dataTestId?: string
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
}): JSX.Element {
  const classes = `orchestrator-dialog-content ${className}`.trim()
  if (as === 'form') {
    return (
      <form
        className={classes}
        data-dialog-content="true"
        data-testid={dataTestId}
        onSubmit={onSubmit}
      >
        {children}
      </form>
    )
  }
  return (
    <div
      className={classes}
      data-dialog-content="true"
      data-testid={dataTestId}
    >
      {children}
    </div>
  )
}

export function DialogHeader({
  title,
  description,
  className = '',
}: {
  title: ReactNode
  description?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={`orchestrator-dialog-copy ${className}`.trim()} data-dialog-header="true">
      <div className="orchestrator-dialog-title">{title}</div>
      {description && <div className="orchestrator-dialog-description">{description}</div>}
    </div>
  )
}

export function DialogFooter({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={`orchestrator-dialog-actions ${className}`.trim()} data-dialog-footer="true">
      {children}
    </div>
  )
}

export function DialogField({
  children,
  label,
  className = '',
}: {
  children: ReactNode
  label: ReactNode
  className?: string
}): JSX.Element {
  return (
    <label className={`automation-dialog-field ${className}`.trim()} data-dialog-field="true">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  dataTestId,
  tone = 'danger',
  onCancel,
  onConfirm,
}: {
  title: ReactNode
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  dataTestId?: string
  tone?: 'danger' | 'accent'
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}): JSX.Element {
  return (
    <MotionOverlay onClose={onCancel} surfaceClassName="orchestrator-dialog-surface">
      <DialogContent dataTestId={dataTestId}>
        <DialogHeader title={title} description={description} />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </MotionOverlay>
  )
}

export function TextInputDialog({
  title,
  description,
  initialValue,
  confirmLabel,
  cancelLabel = 'Cancel',
  placeholder,
  onCancel,
  onConfirm,
}: {
  title: ReactNode
  description?: ReactNode
  initialValue: string
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  placeholder?: string
  onCancel: () => void
  onConfirm: (value: string) => void | Promise<void>
}): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const submit = (): void => {
    const next = value.trim()
    if (!next) return
    void onConfirm(next)
  }

  return (
    <MotionOverlay onClose={onCancel} surfaceClassName="orchestrator-dialog-surface">
      <DialogContent
        as="form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <DialogHeader title={title} description={description} />
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="orchestrator-dialog-input"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="primary" type="submit" disabled={!value.trim()}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </MotionOverlay>
  )
}

export function ScrollEdgeButton({
  children,
  onClick,
  className = '',
  ariaLabel,
  dataTestId,
}: {
  children: ReactNode
  onClick: () => void
  className?: string
  ariaLabel: string
  dataTestId?: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      data-testid={dataTestId}
      onClick={onClick}
      className={`motion-edge-button flex h-5 min-w-9 items-center justify-center gap-0.5 rounded-full border px-2 text-[10px] font-semibold leading-none ${className}`}
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'var(--surface-bg)',
        color: 'var(--text-secondary)',
        boxShadow: '0 5px 10px -7px rgba(0,0,0,0.22)',
        backdropFilter: 'blur(10px)',
      }}
    >
      {children}
    </button>
  )
}
