import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import Icon, { type IconName } from './Icon'
import { rowMotionStyle } from '../../design/motion'

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

const hoverSurfaceOpenEvent = 'orchestrator:hover-surface-open'
const tooltipHoverDelayMs = 140

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
  dataTestId?: string
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
  size?: 'sm' | 'md'
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
  className = '',
  style,
  tooltip = true,
  dataTestId,
  ariaExpanded,
}: IconButtonProps): JSX.Element {
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
      className={`motion-icon-button grid shrink-0 place-items-center rounded-md disabled:cursor-default disabled:opacity-45 ${className}`}
      style={{
        width: size === 'sm' ? 24 : 30,
        height: size === 'sm' ? 24 : 30,
        color: active ? 'var(--text-primary)' : toneColor[tone],
        background: active ? 'var(--control-bg-active)' : 'transparent',
        border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
        ...style,
      }}
    >
      <Icon name={icon} size={size === 'sm' ? 13 : 15} />
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
}: {
  icon: IconName
  label: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  active?: boolean
  disabled?: boolean
  tone?: Tone
  dataTestId?: string
  size?: 'sm' | 'md'
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
      className="toolbar-button"
      style={{
        background: active ? 'var(--control-bg-active)' : 'var(--control-bg)',
        borderColor: active ? 'var(--border-strong)' : 'var(--border-subtle)',
      }}
    />
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
    const hideForViewportChange = (): void => setVisible(false)
    window.addEventListener('scroll', hideForViewportChange, true)
    window.addEventListener('resize', hideForViewportChange)
    window.addEventListener('blur', hideForViewportChange)
    return () => {
      window.removeEventListener('scroll', hideForViewportChange, true)
      window.removeEventListener('resize', hideForViewportChange)
      window.removeEventListener('blur', hideForViewportChange)
    }
  }, [visible])

  return (
    <span
      ref={anchorRef}
      className="orchestrator-tooltip-anchor"
      onMouseEnter={scheduleShow}
      onMouseOver={scheduleShow}
      onMouseLeave={hide}
      onFocus={showNow}
      onBlur={hide}
      onMouseDownCapture={hide}
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

export function MotionPanel({
  open,
  side,
  size,
  children,
  className = '',
  style,
}: {
  open: boolean
  side: 'right' | 'bottom'
  size: number
  children: ReactNode
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const dimensionStyle: CSSProperties = side === 'right'
    ? { width: open ? size : 0, minWidth: open ? size : 0, maxWidth: open ? size : 0 }
    : { height: open ? size : 0, minHeight: open ? size : 0, maxHeight: open ? size : 0 }

  return (
    <div
      data-open={open ? 'true' : 'false'}
      data-motion-panel={side}
      aria-hidden={!open}
      className={`motion-panel motion-panel-${side} shrink-0 overflow-hidden ${className}`}
      style={{
        ...dimensionStyle,
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'auto' : 'none',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function PanelResizeHandle({
  orientation,
  onPointerDown,
  label,
  active = false,
  className = '',
}: {
  orientation: 'vertical' | 'horizontal'
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  label: string
  active?: boolean
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      data-native-title-free="true"
      data-active={active ? 'true' : 'false'}
      data-orientation={orientation}
      className={`panel-resize-handle ${className}`}
      onPointerDown={onPointerDown}
    />
  )
}

export function TabButton({
  children,
  active,
  onClick,
  onClose,
  onContextMenu,
  closeLabel,
  ariaLabel,
  tooltipLabel,
}: {
  children: ReactNode
  active: boolean
  onClick: () => void
  onClose?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  closeLabel?: string
  ariaLabel?: string
  tooltipLabel?: string
}): JSX.Element {
  const tab = (
    <div
      role="tab"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-selected={active}
      data-native-title-free="true"
      data-active={active ? 'true' : 'false'}
      className="motion-tab-button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onClick()
      }}
    >
      <span className="min-w-0 truncate">{children}</span>
      {active && onClose && (
        <button
          type="button"
          aria-label={closeLabel}
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

export function SettingChoiceCard({
  label,
  description,
  active,
  onClick,
  leading,
  disabled = false,
}: {
  label: ReactNode
  description?: ReactNode
  active: boolean
  onClick: () => void
  leading?: ReactNode
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      data-active={active ? 'true' : 'false'}
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
}

export function Badge({
  children,
  tone = 'neutral',
  interactive = false,
  className = '',
  style,
}: BadgeProps): JSX.Element {
  return (
    <span
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
  dataTestId,
}: SurfaceRowProps): JSX.Element {
  const shared = {
    'data-active': active ? 'true' : 'false',
    'data-testid': dataTestId,
    'data-tooltip-label': title,
    'data-native-title-free': title ? 'true' : undefined,
    className: `surface-row motion-row ${className}`,
    style: { ...rowMotionStyle(index), ...style },
    onContextMenu,
    onMouseEnter,
    onDoubleClick: (event: React.MouseEvent) => { void onDoubleClick?.(event) },
    'aria-label': ariaLabel ?? title,
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
  useLayerFocus(surfaceRef, onClose)

  return (
    <div
      className={`motion-overlay-backdrop fixed inset-0 z-50 flex items-center justify-center ${className}`}
      style={{ background: 'rgba(16, 24, 40, 0.18)', backdropFilter: 'blur(4px)', ...backdropStyle }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
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
  useLayerFocus(sheetRef, onClose)

  return (
    <div
      className="motion-sheet-backdrop fixed inset-0 z-50 flex justify-end"
      onClick={(event) => event.target === event.currentTarget && onClose()}
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
          <IconButton icon="close" label="Close" onClick={onClose} />
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
}>(function PopoverSurface({
  children,
  className = '',
  style,
}, ref): JSX.Element {
  return (
    <div
      ref={ref}
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
        onClose()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        window.setTimeout(() => {
          restoreFocus()
          onClose()
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
  }, [onClose])

  return (
    <PopoverSurface ref={ref} className={className} style={style}>
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
}: {
  children: ReactNode
  onClose: () => void
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

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
        onClose()
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
          onClose()
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
  }, [onClose])

  return (
    <PopoverSurface ref={ref} className={className} style={style}>
      <div role="menu" className="flex min-w-0 flex-col gap-1 p-1">
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
}: {
  icon?: IconName
  label: ReactNode
  onClick: () => void | Promise<void>
  tone?: Tone
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => { void onClick() }}
      className="motion-menu-item flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs disabled:cursor-default disabled:opacity-45"
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

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onCancel,
  onConfirm,
}: {
  title: ReactNode
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel?: ReactNode
  tone?: 'danger' | 'accent'
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}): JSX.Element {
  return (
    <MotionOverlay onClose={onCancel} surfaceClassName="w-[min(420px,calc(100vw-32px))] rounded-xl p-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</div>
          {description && <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</div>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
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
    <MotionOverlay onClose={onCancel} surfaceClassName="w-[min(420px,calc(100vw-32px))] rounded-xl p-4">
      <form
        className="flex min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</div>
          {description && <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</div>}
        </div>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--control-bg)',
            color: 'var(--text-primary)',
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="primary" type="submit" disabled={!value.trim()}>{confirmLabel}</Button>
        </div>
      </form>
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
