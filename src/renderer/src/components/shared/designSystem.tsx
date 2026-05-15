import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

interface ButtonProps {
  children: ReactNode
  onClick?: () => void | Promise<void>
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
}: IconButtonProps): JSX.Element {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
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
}: {
  icon: IconName
  label: string
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  active?: boolean
  disabled?: boolean
  tone?: Tone
}): JSX.Element {
  return (
    <IconButton
      icon={icon}
      label={label}
      onClick={onClick}
      active={active}
      disabled={disabled}
      tone={tone}
      className="toolbar-button"
      style={{
        background: active ? 'var(--control-bg-active)' : 'var(--control-bg)',
        borderColor: active ? 'var(--border-strong)' : 'var(--border-subtle)',
      }}
    />
  )
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <span className="orchestrator-tooltip-anchor">
      {children}
      <span className="orchestrator-tooltip" role="tooltip" style={{ bottom: 'calc(100% + 6px)', left: '50%', transform: 'translate(-50%, 3px)' }}>
        {label}
      </span>
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
      title={label}
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
  closeLabel,
}: {
  children: ReactNode
  active: boolean
  onClick: () => void
  onClose?: () => void
  closeLabel?: string
}): JSX.Element {
  return (
    <button
      type="button"
      data-active={active ? 'true' : 'false'}
      className="motion-tab-button"
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{children}</span>
      {active && onClose && (
        <span
          role="button"
          aria-label={closeLabel}
          title={closeLabel}
          className="motion-tab-close"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <Icon name="close" size={11} />
        </span>
      )}
    </button>
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

interface SurfaceRowProps {
  children: ReactNode
  active?: boolean
  disabled?: boolean
  index?: number
  as?: 'button' | 'div'
  onClick?: () => void | Promise<void>
  onContextMenu?: (event: React.MouseEvent) => void
  onMouseEnter?: (event: React.MouseEvent) => void
  className?: string
  style?: CSSProperties
  title?: string
  ariaLabel?: string
}

export function SurfaceRow({
  children,
  active = false,
  disabled = false,
  index = 0,
  as = 'div',
  onClick,
  onContextMenu,
  onMouseEnter,
  className = '',
  style,
  title,
  ariaLabel,
}: SurfaceRowProps): JSX.Element {
  const shared = {
    'data-active': active ? 'true' : 'false',
    className: `surface-row motion-row ${className}`,
    style: { ...rowMotionStyle(index), ...style },
    onContextMenu,
    onMouseEnter,
    title,
    'aria-label': ariaLabel,
  }

  if (as === 'button') {
    return (
      <button
        type="button"
        {...shared}
        disabled={disabled}
        onClick={() => { void onClick?.() }}
      >
        {children}
      </button>
    )
  }

  return (
    <div
      {...shared}
      onClick={() => { void onClick?.() }}
    >
      {children}
    </div>
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
}: {
  children: ReactNode
  onClose: () => void
  className?: string
  surfaceClassName?: string
  surfaceStyle?: CSSProperties
}): JSX.Element {
  return (
    <div
      className={`motion-overlay-backdrop fixed inset-0 z-50 flex items-center justify-center ${className}`}
      style={{ background: 'rgba(16, 24, 40, 0.28)', backdropFilter: 'blur(16px)' }}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={`motion-overlay-surface ${surfaceClassName}`} style={surfaceStyle}>
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="motion-sheet-backdrop fixed inset-0 z-50 flex justify-end"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="motion-sheet flex h-full min-h-0 flex-col" style={{ width }}>
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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        window.setTimeout(onClose, 0)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('mousedown', onMouseDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('mousedown', onMouseDown, { capture: true })
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
    const focusMenuItem = (delta: 1 | -1): void => {
      const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
      if (items.length === 0) return
      const currentIndex = Math.max(0, items.findIndex((item) => item === document.activeElement))
      const next = items[(currentIndex + delta + items.length) % items.length]
      next?.focus()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusMenuItem(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusMenuItem(-1)
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        window.setTimeout(onClose, 0)
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('mousedown', onMouseDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('mousedown', onMouseDown, { capture: true })
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

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
}: {
  children: ReactNode
  onClick: () => void
  className?: string
  ariaLabel: string
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
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
