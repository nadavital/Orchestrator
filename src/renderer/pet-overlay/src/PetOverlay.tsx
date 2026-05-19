import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import PetAvatar, { type AnimState } from './PetAvatar'
import { PROVIDER_DEFS } from '../../../types'
import type { PetConfig, PetEntry, PetLayout } from './env'
import type { ChatMessage, SessionRunEventRecord } from '../../../types'
import {
  buildPetNotification,
  isPetNotificationExpired,
  statusVisualForNotification,
  type PetNotification,
  type PetNotificationStatus,
  type PetWaitingRequestAction,
} from '../../../types/petNotifications'

const STATUS_TO_ANIM: Record<PetNotificationStatus, AnimState> = {
  waiting: 'waiting',
  failed: 'failed',
  review: 'review',
  running: 'running',
  idle: 'idle',
}

const DISMISSED_STORAGE_KEY = 'orchestrator.pet.dismissedNotifications.v1'
const MAX_DISMISSED_KEYS = 300
const TRAY_SCROLL_EPSILON = 2
const DRAG_SAMPLE_WINDOW_MS = 100
const MAX_THROW_SPEED = 1600
const MIN_THROW_SPEED = 320
const MASCOT_MIN_WIDTH = 80
const MASCOT_MAX_WIDTH = 224
const CHEVRON_RIGHT = 'M8.5 4.5 13.5 10 8.5 15.5'
const CHEVRON_DOWN = 'M4.5 8.5 10 13.5 15.5 8.5'
const X_ICON = 'M5 5 15 15 M15 5 5 15'
const CLOCK_ICON = 'M10 5.25V10L13 11.75 M17.25 10A7.25 7.25 0 1 1 2.75 10A7.25 7.25 0 0 1 17.25 10Z'
const WARNING_ICON = 'M10 3.25 18 16.75H2L10 3.25Z M10 8V11 M10 14H10.01'
const CHECK_CIRCLE_ICON = 'M17.25 10A7.25 7.25 0 1 1 2.75 10A7.25 7.25 0 0 1 17.25 10Z M6.75 10.25 9 12.5 13.5 8'

interface SessionState {
  id: string
  name: string
  provider: string
  status: PetConfig['sessions'][number]['status']
  messages: ChatMessage[]
  events: SessionRunEventRecord[]
  hasUnread: boolean
  activitySeq: number
  lastActivityAt: number
}

function extractMessages(msgs: ChatMessage[], prev: SessionState): Partial<SessionState> {
  let hasUnread = prev.hasUnread
  let changed = false

  for (const m of msgs) {
    if (m.type === 'text' && m.role === 'assistant') {
      hasUnread = true
      changed = true
    }
    if (m.type === 'result') {
      changed = true
    }
  }
  return {
    messages: [...prev.messages, ...msgs].slice(-100),
    hasUnread,
    activitySeq: changed ? prev.activitySeq + 1 : prev.activitySeq,
    lastActivityAt: changed ? Date.now() : prev.lastActivityAt,
  }
}

function sessionFromConfig(s: PetConfig['sessions'][number], now = Date.now()): SessionState {
  return {
    id: s.id,
    name: s.name,
    provider: s.provider,
    status: s.status,
    messages: s.messages ?? [],
    events: [],
    hasUnread: false,
    activitySeq: 0,
    lastActivityAt: now,
  }
}

function loadDismissedKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

function storeDismissedKeys(keys: Set<string>): void {
  const entries = [...keys].slice(-MAX_DISMISSED_KEYS)
  window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(entries))
}

interface TrayScrollState {
  hasScrollableContent: boolean
  hasLatestNotificationsAbove: boolean
  hiddenOlderNotificationCount: number
}

interface ElementSize {
  width: number
  height: number
}

interface OverlayElementMetrics {
  isTrayVisible: boolean
  mascot: ElementSize
  tray: ElementSize | null
}

function roundedRectSize(el: HTMLElement | null): ElementSize | null {
  if (!el || window.getComputedStyle(el).display === 'none') return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
}

function measureNotificationTray(el: HTMLElement | null): ElementSize | null {
  if (!el || window.getComputedStyle(el).display === 'none') return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const header = el.querySelector<HTMLElement>('[data-avatar-overlay-size="notification-tray-header"]')
  const list = el.querySelector<HTMLElement>('[data-avatar-overlay-size="notification-tray-list"]')
  const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0
  const listHeight = list ? Math.ceil(list.scrollHeight) : Math.ceil(rect.height)
  return {
    width: Math.ceil(el.offsetWidth > 0 ? el.offsetWidth : rect.width),
    height: Math.max(0, headerHeight + listHeight),
  }
}

function metricsKey(metrics: OverlayElementMetrics): string {
  return [
    metrics.isTrayVisible ? '1' : '0',
    metrics.mascot.width,
    metrics.mascot.height,
    metrics.tray?.width ?? 0,
    metrics.tray?.height ?? 0,
  ].join(':')
}

function elementIsVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function pointInsideElement(point: { x: number; y: number }, el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return false
  return document.elementsFromPoint(point.x, point.y).some((hit) => hit === el || el.contains(hit))
}

function findInteractiveElementAt(
  point: { x: number; y: number },
  region: HTMLElement | null,
  selectors: string[]
): Element | null {
  if (!region) return null
  for (const selector of selectors) {
    const matches = Array.from(region.querySelectorAll(selector))
    for (const candidate of matches) {
      if (elementIsVisible(candidate) && pointInsideElement(point, candidate)) return candidate
    }
  }
  if (elementIsVisible(region) && region.matches(':hover')) {
    const hit = document.elementFromPoint(point.x, point.y)
    if (hit?.closest(selectors.join(','))) return hit
  }
  return null
}

function useFloatingPetPointerInteractivity({
  regionRef,
  isPaused,
}: {
  regionRef: RefObject<HTMLElement | null>
  isPaused: () => boolean
}): void {
  useEffect(() => {
    const selectors = [
      '[data-interactive]',
      '[data-avatar-overlay-hit-region]',
      '[data-avatar-mascot="true"]',
      '[data-avatar-overlay-control]',
      '[data-testid="avatar-overlay-notification-badge"]',
      '[data-testid="avatar-overlay-resize-handle"]',
    ]
    let lastPoint: { x: number; y: number } | null = null
    let lastInteractive = false
    let frame: number | null = null

    const setInteractive = (interactive: boolean): void => {
      if (interactive === lastInteractive) return
      lastInteractive = interactive
      window.petApi.pet.setPointerInteractive(interactive)
    }

    const evaluate = (): void => {
      frame = null
      if (isPaused()) {
        setInteractive(false)
        return
      }
      if (!lastPoint) {
        setInteractive(false)
        return
      }
      setInteractive(Boolean(findInteractiveElementAt(lastPoint, regionRef.current, selectors)))
    }

    const schedule = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(evaluate)
    }

    const handleMouseMove = (event: MouseEvent): void => {
      lastPoint = { x: event.clientX, y: event.clientY }
      schedule()
    }
    const handleMouseLeave = (): void => {
      lastPoint = null
      setInteractive(false)
    }
    const observer = new MutationObserver(schedule)

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('mouseleave', handleMouseLeave)
    observer.observe(document.body, {
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'style'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    schedule()

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('mouseleave', handleMouseLeave)
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      window.petApi.pet.setPointerInteractive(false)
    }
  }, [isPaused, regionRef])
}

function usePrefersReducedMotion(forceReducedMotion: boolean): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    forceReducedMotion || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  )

  useEffect(() => {
    if (forceReducedMotion) {
      setPrefersReducedMotion(true)
      return
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (): void => setPrefersReducedMotion(media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [forceReducedMotion])

  return prefersReducedMotion
}

function transitionFor(prefersReducedMotion: boolean, transition: string): string {
  return prefersReducedMotion ? 'none' : transition
}

function measureTrayScrollState(el: HTMLElement | null): TrayScrollState {
  if (!el) {
    return {
      hasScrollableContent: false,
      hasLatestNotificationsAbove: false,
      hiddenOlderNotificationCount: 0,
    }
  }
  const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-avatar-overlay-measure="notification-tray-row"]'))
  const viewportBottom = el.scrollTop + el.clientHeight
  return {
    hasScrollableContent: el.scrollHeight > el.clientHeight + TRAY_SCROLL_EPSILON,
    hasLatestNotificationsAbove: el.scrollTop > TRAY_SCROLL_EPSILON,
    hiddenOlderNotificationCount: rows.filter((row) => row.offsetTop + row.offsetHeight > viewportBottom + TRAY_SCROLL_EPSILON).length,
  }
}

// Minimum pointer movement before we commit to a drag (matches Codex Ge=4)
const DRAG_THRESHOLD = 4

interface DragState {
  pointerId: number
  startedOnMascot: boolean
  hasMoved: boolean
  screenX: number
  screenY: number
  samples: Array<{ screenX: number; screenY: number; timeMs: number }>
}

interface ResizeState {
  pointerId: number
  startScreenX: number
  startWidthPx: number
}

function clampMascotWidth(width: number): number {
  return Math.round(Math.min(MASCOT_MAX_WIDTH, Math.max(MASCOT_MIN_WIDTH, width)))
}

function computeThrowVelocity(samples: Array<{ screenX: number; screenY: number; timeMs: number }>): {
  vx: number
  vy: number
} | null {
  const last = samples.at(-1)
  if (!last) return null
  const first = samples.find((sample) => last.timeMs - sample.timeMs > 16)
  if (!first) return null
  const dt = (last.timeMs - first.timeMs) / 1000
  if (dt <= 0) return null

  const rawVx = (last.screenX - first.screenX) / dt
  const rawVy = (last.screenY - first.screenY) / dt
  const speed = Math.hypot(rawVx, rawVy)
  if (speed < MIN_THROW_SPEED) return null
  if (speed <= MAX_THROW_SPEED) return { vx: rawVx, vy: rawVy }

  const scale = MAX_THROW_SPEED / speed
  return { vx: rawVx * scale, vy: rawVy * scale }
}

export default function PetOverlay(): JSX.Element | null {
  const [config, setConfig] = useState<PetConfig | null>(null)
  const [sessions, setSessions] = useState<Record<string, SessionState>>({})
  const [isHovering, setIsHovering] = useState(false)
  const [layout, setLayout] = useState<PetLayout>({
    mascotLeft: 176,
    mascotTop: 8,
    trayLeft: 8,
    trayTop: 120,
    placement: 'bottom-end',
  })
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => loadDismissedKeys())
  const [isNotificationTrayOpen, setIsNotificationTrayOpen] = useState(true)
  const [badgePressed, setBadgePressed] = useState(false)
  const [badgeHovering, setBadgeHovering] = useState(false)
  const [trayScrollState, setTrayScrollState] = useState<TrayScrollState>(() => ({
    hasScrollableContent: false,
    hasLatestNotificationsAbove: false,
    hiddenOlderNotificationCount: 0,
  }))
  const [nowMs, setNowMs] = useState(() => Date.now())
  const isDragging = useRef(false)
  const [isDraggingVisual, setIsDraggingVisual] = useState(false)
  const dragState = useRef<DragState | null>(null)
  const dragAnimStateRef = useRef<AnimState | null>(null)
  const [dragAnimState, setDragAnimState] = useState<AnimState | null>(null)
  const [mascotWidthPx, setMascotWidthPx] = useState<number | null>(null)
  const [isResizingVisual, setIsResizingVisual] = useState(false)
  const [isResizeHandleHovering, setIsResizeHandleHovering] = useState(false)
  const [isResizeHandleFocused, setIsResizeHandleFocused] = useState(false)
  const [forceReducedMotion, setForceReducedMotion] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const trayListRef = useRef<HTMLDivElement>(null)
  const mascotRef = useRef<HTMLDivElement>(null)
  const resizeState = useRef<ResizeState | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const pendingResizeWidthRef = useRef<number | null>(null)
  const metricsFrameRef = useRef<number | null>(null)
  const lastMetricsKeyRef = useRef<string | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion(forceReducedMotion)

  // Load initial config + sessions.
  useEffect(() => {
    window.petApi.pet.getConfig().then((cfg) => {
      setConfig(cfg)
      setForceReducedMotion(cfg.forceReducedMotion)
      document.documentElement.dataset.reducedMotion = cfg.forceReducedMotion ? 'true' : 'false'
      setLayout(cfg.initialLayout)
      setMascotWidthPx(cfg.mascotWidthPx)
      const initial: Record<string, SessionState> = {}
      for (const s of cfg.sessions) {
        initial[s.id] = sessionFromConfig(s)
      }
      setSessions(initial)
    }).catch((err) => {
      console.error('[pet] getConfig failed:', err)
    })
  }, [])

  // Listen for layout updates from main
  useEffect(() => {
    return window.petApi.pet.onLayout((l) => setLayout(l))
  }, [])

  // Listen for config changes (pet switch from settings)
  useEffect(() => {
    return window.petApi.pet.onConfigUpdated((update) => {
      if (update.selectedPetId !== undefined) {
        setConfig((prev) => prev ? { ...prev, selectedPetId: update.selectedPetId! } : prev)
      }
      if (update.mascotWidthPx !== undefined) {
        setMascotWidthPx(clampMascotWidth(update.mascotWidthPx))
      }
    })
  }, [])

  // Session events
  useEffect(() => {
    return window.petApi.onSessionEvent((event) => {
      setSessions((prev) => {
        const now = Date.now()
        if (event.type === 'created') {
          return {
            ...prev,
            [event.session.id]: sessionFromConfig(event.session, now)
          }
        }
        const s = prev[event.id]
        if (!s) return prev
        if (event.type === 'status') {
          return {
            ...prev,
            [event.id]: {
              ...s,
              status: event.status,
              activitySeq: event.status !== s.status ? s.activitySeq + 1 : s.activitySeq,
              lastActivityAt: event.status !== s.status ? now : s.lastActivityAt,
            }
          }
        }
        if (event.type === 'messages') {
          return { ...prev, [event.id]: { ...s, ...extractMessages(event.messages, s) } }
        }
        if (event.type === 'events') {
          const eventTime = event.events.at(-1)?.timestamp ?? now
          return {
            ...prev,
            [event.id]: {
              ...s,
              events: [...s.events, ...event.events].slice(-100),
              activitySeq: s.activitySeq + event.events.length,
              lastActivityAt: eventTime,
            }
          }
        }
        if (event.type === 'renamed') {
          return { ...prev, [event.id]: { ...s, name: event.name } }
        }
        if (event.type === 'needsInput') {
          return {
            ...prev,
            [event.id]: {
              ...s,
              status: 'waiting_for_user',
              activitySeq: s.activitySeq + 1,
              lastActivityAt: now
            }
          }
        }
        return prev
      })
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onPointerUp = (e: PointerEvent): void => {
      finishDrag(e.pointerId, { screenX: e.screenX, screenY: e.screenY, timeMs: e.timeStamp }, true)
      finishResize(e.pointerId, e.screenX)
    }
    const onPointerCancel = (e: PointerEvent): void => {
      finishDrag(e.pointerId, null, false)
      finishResize(e.pointerId)
    }
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    storeDismissedKeys(dismissedKeys)
  }, [dismissedKeys])

  // Compute aggregate state
  const notifications = Object.values(sessions)
    .map((session) => buildPetNotification(session))
    .filter((notification): notification is PetNotification => Boolean(notification))
    .filter((notification) => !isPetNotificationExpired(notification, nowMs))
    .filter((notification) => !dismissedKeys.has(notification.dismissKey))
    .sort((a, b) => a.notificationPriority - b.notificationPriority || b.updatedAtMs - a.updatedAtMs)

  const topStatus = notifications[0]?.status ?? 'idle'
  const topVisual = statusVisualForNotification(notifications[0] ?? null)
  let animState: AnimState
  if (dragAnimState !== null) animState = dragAnimState
  else if (isHovering) animState = 'jumping'
  else animState = STATUS_TO_ANIM[topStatus]

  const selectedPet: PetEntry | undefined =
    config?.pets.find((p) => p.id === config.selectedPetId) ?? config?.pets[0]

  const hasTray = notifications.length > 0
  const badgeScale = prefersReducedMotion ? 1 : badgePressed ? 0.94 : badgeHovering ? 1.06 : 1

  const reportElementMetrics = useCallback((): void => {
    const mascot = roundedRectSize(mascotRef.current)
    if (!mascot) return
    const metrics: OverlayElementMetrics = {
      isTrayVisible: hasTray && isNotificationTrayOpen,
      mascot,
      tray: hasTray && isNotificationTrayOpen ? measureNotificationTray(trayRef.current) : null,
    }
    const key = metricsKey(metrics)
    if (key === lastMetricsKeyRef.current) return
    lastMetricsKeyRef.current = key
    window.petApi.pet.setElementMetrics(metrics)
  }, [hasTray, isNotificationTrayOpen])

  const scheduleElementMetricsReport = useCallback((): void => {
    if (metricsFrameRef.current !== null) return
    metricsFrameRef.current = window.requestAnimationFrame(() => {
      metricsFrameRef.current = null
      reportElementMetrics()
    })
  }, [reportElementMetrics])
  const isPointerInteractivityPaused = useCallback((): boolean => (
    isDragging.current || resizeState.current !== null
  ), [])

  useLayoutEffect(() => {
    scheduleElementMetricsReport()
    const observed = [
      mascotRef.current,
      trayRef.current,
      trayListRef.current,
      ...Array.from(trayRef.current?.querySelectorAll<HTMLElement>('[data-avatar-overlay-measure="notification-tray-row"]') ?? []),
    ].filter((el): el is HTMLElement => Boolean(el))
    const ro = new ResizeObserver(scheduleElementMetricsReport)
    observed.forEach((el) => ro.observe(el))
    window.addEventListener('resize', scheduleElementMetricsReport)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', scheduleElementMetricsReport)
    }
  }, [notifications.length, selectedPet?.id, mascotWidthPx, isNotificationTrayOpen, scheduleElementMetricsReport])

  useEffect(() => {
    return () => {
      if (metricsFrameRef.current !== null) {
        window.cancelAnimationFrame(metricsFrameRef.current)
      }
    }
  }, [])

  useFloatingPetPointerInteractivity({
    regionRef: rootRef,
    isPaused: isPointerInteractivityPaused,
  })

  useEffect(() => {
    setTrayScrollState(measureTrayScrollState(trayListRef.current))
  }, [notifications.length, isNotificationTrayOpen])

  useEffect(() => {
    window.petApi.pet.setTrayCount(hasTray && isNotificationTrayOpen ? notifications.length : 0)
  }, [hasTray, isNotificationTrayOpen, notifications.length])

  const finishDrag = (
    pointerId: number,
    releaseSample: { screenX: number; screenY: number; timeMs: number } | null,
    shouldOpenMainWindow: boolean
  ): void => {
    const state = dragState.current
    if (!state || state.pointerId !== pointerId) return

    dragState.current = null
    isDragging.current = false
    setIsDraggingVisual(false)
    dragAnimStateRef.current = null
    setDragAnimState(null)

    if (shouldOpenMainWindow && state.startedOnMascot && !state.hasMoved) {
      window.petApi.pet.focusMain()
    }

    window.petApi.pet.dragEnd()

    if (releaseSample && state.hasMoved) {
      const samples = [...state.samples, releaseSample]
      const recent = samples.filter((sample) => releaseSample.timeMs - sample.timeMs <= DRAG_SAMPLE_WINDOW_MS)
      const velocity = computeThrowVelocity(recent)
      if (velocity) {
        window.petApi.pet.dragRelease(velocity.vx, velocity.vy)
        return
      }
    }
  }

  const finishResize = (pointerId: number, screenX?: number, target?: Element | null): void => {
    const state = resizeState.current
    if (!state || state.pointerId !== pointerId) return
    const width = screenX === undefined
      ? (mascotWidthPx ?? state.startWidthPx)
      : clampMascotWidth(state.startWidthPx + screenX - state.startScreenX)
    resizeState.current = null
    pendingResizeWidthRef.current = null
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    setIsResizingVisual(false)
    setMascotWidthPx(width)
    window.petApi.pet.setMascotWidth(width)
    if (target instanceof HTMLElement && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId)
    }
  }

  const sendResizePreview = (width: number): void => {
    pendingResizeWidthRef.current = width
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const nextWidth = pendingResizeWidthRef.current
      if (nextWidth !== null) {
        window.petApi.pet.setMascotResizePreview(nextWidth)
      }
    })
  }

  // Drag handlers: 4px threshold before committing (matches Codex Ge=4).
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest('.no-drag')) return

    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragState.current = {
      pointerId: e.pointerId,
      startedOnMascot: !!target?.closest('[data-avatar-mascot="true"]'),
      hasMoved: false,
      screenX: e.screenX,
      screenY: e.screenY,
      samples: [{ screenX: e.screenX, screenY: e.screenY, timeMs: e.timeStamp }],
    }
    isDragging.current = true
    setIsDraggingVisual(true)
    dragAnimStateRef.current = null
    setDragAnimState(null)
    window.petApi.pet.dragStart(e.clientX, e.clientY)
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    const state = dragState.current
    if (!state || state.pointerId !== e.pointerId) return

    const sample = { screenX: e.screenX, screenY: e.screenY, timeMs: e.timeStamp }
    state.samples = [...state.samples, sample].filter((s) => sample.timeMs - s.timeMs <= DRAG_SAMPLE_WINDOW_MS)

    const dx = sample.screenX - state.screenX
    const dy = sample.screenY - state.screenY
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return

    state.hasMoved = true
    state.screenX = sample.screenX
    state.screenY = sample.screenY
    const nextAnimState = dx >= DRAG_THRESHOLD
      ? 'running-right'
      : dx <= -DRAG_THRESHOLD
        ? 'running-left'
        : dragAnimStateRef.current
    if (nextAnimState !== dragAnimStateRef.current) {
      dragAnimStateRef.current = nextAnimState
      setDragAnimState(nextAnimState)
    }
    window.petApi.pet.dragMove(e.screenX, e.screenY)
  }

  const handlePointerUp = (e: React.PointerEvent): void => {
    finishDrag(e.pointerId, { screenX: e.screenX, screenY: e.screenY, timeMs: e.timeStamp }, true)
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    window.petApi.pet.setPointerInteractive(!!el?.closest('[data-interactive]'))
  }

  const handleResizePointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const width = mascotRef.current?.getBoundingClientRect().width ?? mascotWidthPx ?? 112
    resizeState.current = {
      pointerId: e.pointerId,
      startScreenX: e.screenX,
      startWidthPx: clampMascotWidth(width),
    }
    setIsResizingVisual(true)
    sendResizePreview(clampMascotWidth(width))
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const state = resizeState.current
    if (!state || state.pointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    const width = clampMascotWidth(state.startWidthPx + e.screenX - state.startScreenX)
    setMascotWidthPx(width)
    sendResizePreview(width)
  }

  const handleResizePointerUp = (e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    finishResize(e.pointerId, e.screenX, e.currentTarget)
  }

  if (!selectedPet) {
    return <div style={{ width: '100vw', height: '100vh' }} />
  }

  return (
    <div
      ref={rootRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(e) => finishDrag(e.pointerId, null, false)}
      onLostPointerCapture={(e) => finishDrag(e.pointerId, null, false)}
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        cursor: isDraggingVisual ? 'grabbing' : 'default',
      }}
    >
      {/* Notification tray — always rendered so ResizeObserver can track height */}
      <div
        ref={trayRef}
        data-interactive="true"
        data-avatar-overlay-hit-region="true"
        data-avatar-overlay-size="notification-tray"
        className="no-drag"
        style={{
          position: 'absolute',
          left: layout.trayLeft,
          top: layout.trayTop,
          width: 276,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          zIndex: 3,
          pointerEvents: isNotificationTrayOpen ? 'auto' : 'none',
        }}
      >
        {notifications.length > 0 && isNotificationTrayOpen && (
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 18,
            }}
          >
            <div
              data-avatar-overlay-size="notification-tray-header"
              style={{ height: 0, overflow: 'hidden' }}
            />
            <div
              ref={trayListRef}
              data-avatar-overlay-size="notification-tray-list"
              role="list"
              aria-label="Activity notifications"
              onScroll={(ev) => setTrayScrollState(measureTrayScrollState(ev.currentTarget))}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 226,
                overflowY: trayScrollState.hasScrollableContent ? 'auto' : 'hidden',
                scrollbarWidth: 'none',
                padding: '4px 6px 0',
              }}
            >
              {notifications.map((notification) => (
                <NotificationCard
                  key={notification.key}
                  notification={notification}
                  prefersReducedMotion={prefersReducedMotion}
                  onClick={() => {
                    window.petApi.pet.focusMain(notification.localConversationId)
                    setSessions((prev) => ({
                      ...prev,
                      ...(prev[notification.localConversationId]
                        ? { [notification.localConversationId]: { ...prev[notification.localConversationId], hasUnread: false } }
                        : {})
                    }))
                  }}
                  onDismiss={() => {
                    setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                    setSessions((prev) => ({
                      ...prev,
                      ...(prev[notification.localConversationId]
                        ? { [notification.localConversationId]: { ...prev[notification.localConversationId], hasUnread: false } }
                        : {})
                    }))
                  }}
                  onAction={async (action) => {
                    if (action.kind === 'permission-response') {
                      if (action.response === 'allow') {
                        await window.petApi.sessions.allowOnceAndResume(notification.localConversationId, action.toolNames)
                      } else {
                        await window.petApi.sessions.denyPermission(notification.localConversationId)
                      }
                      setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                      return
                    }
                    if (action.kind === 'question-option') {
                      await window.petApi.sessions.answerUserInput(notification.localConversationId, action.value)
                      setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                      return
                    }
                    if (action.kind === 'open') {
                      window.petApi.pet.focusMain(notification.localConversationId)
                    }
                  }}
                  onReply={async (text) => {
                    await window.petApi.sessions.answerUserInput(notification.localConversationId, text)
                    setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                  }}
                />
              ))}
            </div>
            {trayScrollState.hasLatestNotificationsAbove && (
              <TrayButton
                label="Latest"
                title="Show latest activity"
                placement="top"
                onClick={() => trayListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              />
            )}
            {trayScrollState.hiddenOlderNotificationCount > 0 && (
              <TrayButton
                label={`+${trayScrollState.hiddenOlderNotificationCount}`}
                title={`Show ${trayScrollState.hiddenOlderNotificationCount} older activity item${trayScrollState.hiddenOlderNotificationCount === 1 ? '' : 's'}`}
                placement="bottom"
                onClick={() => {
                  const el = trayListRef.current
                  if (!el) return
                  el.scrollTo({ top: el.scrollTop + el.clientHeight, behavior: 'smooth' })
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Mascot */}
      <div
        ref={mascotRef}
        data-avatar-mascot="true"
        data-interactive="true"
        onContextMenu={() => window.petApi.pet.close()}
        onPointerEnter={() => setIsHovering(true)}
        onPointerLeave={() => setIsHovering(false)}
        style={{
          position: 'absolute',
          left: layout.mascotLeft,
          top: layout.mascotTop,
          cursor: isDraggingVisual ? 'grabbing' : 'grab',
          zIndex: 2,
          transform: isDraggingVisual ? 'scale(0.95)' : 'scale(1)',
          transformOrigin: 'center',
          transition: isDraggingVisual ? transitionFor(prefersReducedMotion, 'transform 160ms ease-out') : 'none',
        }}
      >
        <PetAvatar
          animState={animState}
          spritesheetSrc={selectedPet.spritesheetDataUrl}
          displayWidthPx={mascotWidthPx}
        />
        <button
          type="button"
          data-interactive="true"
          data-testid="avatar-overlay-resize-handle"
          className="no-drag"
          aria-label="Resize pet"
          title="Resize pet"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={(e) => finishResize(e.pointerId, undefined, e.currentTarget)}
          onLostPointerCapture={(e) => finishResize(e.pointerId, undefined, e.currentTarget)}
          onPointerEnter={() => setIsResizeHandleHovering(true)}
          onPointerLeave={() => setIsResizeHandleHovering(false)}
          onFocus={() => setIsResizeHandleFocused(true)}
          onBlur={() => setIsResizeHandleFocused(false)}
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: 24,
            height: 24,
            borderRadius: 8,
            border: 0,
            padding: 0,
            background: 'transparent',
            color: 'var(--color-token-text-secondary, rgba(255,255,255,0.72))',
            cursor: 'nwse-resize',
            touchAction: 'none',
            zIndex: 4,
          }}
        >
          <span
            data-testid="avatar-overlay-resize-grip"
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              width: 10,
              height: 10,
              borderRight: '2px solid currentColor',
              borderBottom: '2px solid currentColor',
              opacity: isResizeHandleHovering || isResizingVisual || isResizeHandleFocused ? 0.85 : 0,
              transition: transitionFor(prefersReducedMotion, 'opacity 120ms ease-out'),
            }}
          />
        </button>
        {notifications.length > 0 && (
          <button
            type="button"
            data-interactive="true"
            data-testid="avatar-overlay-notification-badge"
            className="no-drag"
            aria-label={isNotificationTrayOpen ? 'Collapse activity' : `Open activity tray, ${notifications.length} item${notifications.length === 1 ? '' : 's'}`}
            title={isNotificationTrayOpen ? 'Collapse activity' : 'Open activity tray'}
            onPointerDown={(ev) => {
              ev.stopPropagation()
              setBadgePressed(true)
            }}
            onPointerUp={() => setBadgePressed(false)}
            onPointerCancel={() => setBadgePressed(false)}
            onPointerEnter={() => setBadgeHovering(true)}
            onPointerLeave={() => {
              setBadgeHovering(false)
              setBadgePressed(false)
            }}
            onMouseDown={() => setBadgePressed(true)}
            onMouseUp={() => setBadgePressed(false)}
            onBlur={() => {
              setBadgeHovering(false)
              setBadgePressed(false)
            }}
            onClick={(ev) => {
              ev.stopPropagation()
              setIsNotificationTrayOpen((open) => !open)
            }}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 28,
              minHeight: 28,
              width: isNotificationTrayOpen ? 28 : undefined,
              height: 28,
              padding: isNotificationTrayOpen ? 0 : '4px 8px',
              borderRadius: 999,
              border: '1px solid var(--color-token-border-default, rgba(255,255,255,0.18))',
              background: isNotificationTrayOpen ? 'var(--color-token-bg-primary, rgba(18,18,18,0.82))' : topVisual.badgeBackgroundColor,
              color: isNotificationTrayOpen ? 'var(--color-token-text-secondary, rgba(255,255,255,0.72))' : topVisual.badgeForegroundColor,
              boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1,
              cursor: 'pointer',
              transform: `scale(${badgeScale})`,
              transformOrigin: 'center',
              transition: transitionFor(prefersReducedMotion, 'transform 160ms cubic-bezier(0.19, 1, 0.22, 1), background-color 160ms ease-out, color 160ms ease-out'),
            }}
          >
            {isNotificationTrayOpen ? (
              <ChevronIcon path={CHEVRON_DOWN} />
            ) : (
              notifications.length
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function TrayButton({
  label,
  title,
  placement,
  onClick,
}: {
  label: string
  title: string
  placement: 'top' | 'bottom'
  onClick: () => void
}): JSX.Element {
  return (
    <button
      data-interactive="true"
      title={title}
      aria-label={title}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
      style={{
        position: 'absolute',
        left: '50%',
        top: placement === 'top' ? 4 : undefined,
        bottom: placement === 'bottom' ? 4 : undefined,
        transform: 'translateX(-50%)',
        zIndex: 10,
        minWidth: placement === 'top' ? 48 : 36,
        height: 20,
        padding: '0 8px',
        borderRadius: 999,
        border: '1px solid var(--color-token-border-default, rgba(255,255,255,0.16))',
        background: 'var(--color-token-main-surface-primary, rgba(24,24,24,0.86))',
        color: 'var(--color-token-text-secondary, rgba(255,255,255,0.70))',
        boxShadow: '0 5px 10px -7px rgba(0,0,0,0.22)',
        fontSize: 10,
        lineHeight: '18px',
        fontWeight: 560,
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
      }}
    >
      {label}
    </button>
  )
}

function NotificationCard({
  notification,
  prefersReducedMotion,
  onClick,
  onDismiss,
  onAction,
  onReply,
}: {
  notification: PetNotification
  prefersReducedMotion: boolean
  onClick: () => void
  onDismiss: () => void
  onAction: (action: PetWaitingRequestAction) => Promise<void>
  onReply: (text: string) => Promise<void>
}): JSX.Element {
  const [rowActive, setRowActive] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const displayBody = notification.body.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim()
  const visual = statusVisualForNotification(notification)
  const actions = (notification.waitingRequest?.actions ?? []).filter((action) => action.kind !== 'reply')
  const canReply = Boolean(notification.replyTarget)
  const bodyText = displayBody || visual.fallbackBodyMessage
  const hasWaitingRequest = Boolean(notification.waitingRequest)
  const expandable = bodyText.length > 92 || hasWaitingRequest

  useEffect(() => {
    window.petApi.pet.setKeyboardInteractive(replyOpen)
    return () => {
      if (replyOpen) window.petApi.pet.setKeyboardInteractive(false)
    }
  }, [replyOpen])

  const submitReply = async (): Promise<void> => {
    const text = replyText.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await onReply(text)
      setReplyText('')
      setReplyOpen(false)
      window.petApi.pet.setKeyboardInteractive(false)
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: PetWaitingRequestAction): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (action.kind === 'reply') {
        setReplyOpen((value) => !value)
      } else {
        await onAction(action)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-interactive="true"
      data-avatar-overlay-measure="notification-tray-row"
      data-avatar-overlay-row-active={rowActive ? 'true' : 'false'}
      data-avatar-overlay-notification-status={notification.status}
      role="listitem"
      style={{
        position: 'relative',
        width: '100%',
        scrollMarginTop: 8,
        textAlign: 'left',
      }}
      onPointerEnter={() => setRowActive(true)}
      onPointerLeave={() => setRowActive(false)}
      onFocusCapture={() => setRowActive(true)}
      onBlurCapture={(ev) => {
        const next = ev.relatedTarget
        if (!(next instanceof Node) || !ev.currentTarget.contains(next)) setRowActive(false)
      }}
    >
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          overflow: 'hidden',
          borderRadius: 18,
          border: '1px solid var(--color-token-border-default, rgba(255,255,255,0.18))',
          background: 'var(--color-token-main-surface-primary, rgba(31,31,31,0.94))',
          boxShadow: rowActive
            ? 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.18)'
            : 'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.18)',
          color: 'var(--color-token-text-primary, rgba(255,255,255,0.92))',
          backdropFilter: 'blur(18px)',
          transition: transitionFor(prefersReducedMotion, 'border-color 200ms ease, box-shadow 200ms ease, background-color 200ms ease'),
        }}
      >
        <div
          role={notification.action ? 'button' : undefined}
          tabIndex={notification.action ? 0 : undefined}
          aria-label={`${notification.title}. ${visual.labelMessage}. ${bodyText}`}
          onClick={(ev) => {
            ev.stopPropagation()
            onClick()
          }}
          onKeyDown={(ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return
            ev.preventDefault()
            onClick()
          }}
          style={{
            display: 'block',
            width: '100%',
            minWidth: 0,
            background: 'transparent',
            color: 'inherit',
            padding: '6px 12px',
            textAlign: 'left',
            cursor: notification.action ? 'pointer' : 'default',
            font: 'inherit',
          }}
        >
          <span
            style={{
              display: 'flex',
              minWidth: 0,
              alignItems: 'center',
              paddingRight: 28,
              paddingLeft: notification.canDismiss ? 28 : 0,
            }}
          >
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
                fontWeight: 650,
                lineHeight: '17px',
              }}
            >
              {notification.title}
            </span>
          </span>
          <div
            data-avatar-overlay-measure-body="true"
            style={{
              color: 'var(--color-token-text-primary, rgba(255,255,255,0.86))',
              fontSize: 11,
              lineHeight: '16px',
              marginTop: 2,
              overflow: 'hidden',
              maxHeight: expanded ? 512 : hasWaitingRequest ? 84 : 32,
              whiteSpace: expanded ? 'pre-wrap' : undefined,
              display: expanded ? 'block' : '-webkit-box',
              WebkitLineClamp: expanded ? undefined : hasWaitingRequest ? 5 : 2,
              WebkitBoxOrient: 'vertical',
              fontFamily: bodyText.startsWith('$') ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
              transition: transitionFor(prefersReducedMotion, 'max-height 180ms ease-out'),
            }}
          >
            {bodyText}
            {actions.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 8,
                }}
              >
                {actions.map((action) => (
                  <ActionButton
                    key={`${action.kind}:${action.label}`}
                    label={action.label}
                    busy={busy}
                    onClick={() => runAction(action)}
                    tone={action.primary ? 'primary' : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <span
          role="img"
          aria-label={visual.labelMessage}
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 0,
            display: 'flex',
            width: 24,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: expandable && rowActive ? 0 : 1,
            transition: transitionFor(prefersReducedMotion, 'opacity 150ms ease-out'),
          }}
        >
          <StatusIcon visual={visual} />
        </span>

        {expandable && (
          <div
            data-avatar-overlay-control="expand"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              zIndex: 10,
              opacity: rowActive ? 1 : 0,
              pointerEvents: rowActive ? 'auto' : 'none',
              transform: rowActive ? 'translateX(0)' : 'translateX(6px)',
              transition: transitionFor(prefersReducedMotion, 'opacity 150ms ease-out, transform 150ms ease-out'),
            }}
          >
            <IconButton
              title={expanded ? 'Collapse' : 'Expand'}
              ariaLabel={`${expanded ? 'Collapse' : 'Expand'} ${notification.title}`}
              onClick={() => setExpanded((value) => !value)}
            >
              <span style={{ transform: `rotate(${expanded ? 90 : 0}deg)`, transition: transitionFor(prefersReducedMotion, 'transform 120ms ease-out') }}>
                <ChevronIcon path={CHEVRON_RIGHT} />
              </span>
            </IconButton>
          </div>
        )}

        {canReply && !replyOpen && (
          <div
            data-avatar-overlay-control="reply"
            className="no-drag"
            style={{
              position: 'absolute',
              right: 8,
              bottom: 4,
              zIndex: 10,
              opacity: rowActive ? 1 : 0,
              pointerEvents: rowActive ? 'auto' : 'none',
              transform: rowActive ? 'translateX(0)' : 'translateX(6px)',
              transition: transitionFor(prefersReducedMotion, 'opacity 150ms ease-out, transform 150ms ease-out'),
            }}
          >
            <ActionButton
              label="Reply"
              busy={busy}
              onClick={() => {
                setReplyText('')
                setReplyOpen(true)
                setRowActive(true)
              }}
            />
          </div>
        )}

        {replyOpen && (
          <form
            className="no-drag"
            onClick={(ev) => ev.stopPropagation()}
            onPointerDown={(ev) => ev.stopPropagation()}
            onSubmit={(ev) => {
              ev.preventDefault()
              void submitReply()
            }}
            style={{
              margin: '0 12px 8px',
              borderTop: '1px solid var(--color-token-border-default, rgba(255,255,255,0.18))',
              paddingTop: 8,
            }}
          >
            <div style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 6 }}>
              <input
                data-avatar-overlay-reply-input="true"
                value={replyText}
                disabled={busy}
                onChange={(ev) => setReplyText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Escape' && !busy) {
                    ev.stopPropagation()
                    setReplyOpen(false)
                  }
                }}
                autoFocus
                placeholder="Reply"
                style={{
                  minWidth: 0,
                  flex: 1,
                  height: 24,
                  borderRadius: 6,
                  border: '1px solid var(--color-token-border-default, rgba(255,255,255,0.18))',
                  background: 'var(--color-token-main-surface-primary, rgba(31,31,31,0.94))',
                  color: 'var(--color-token-text-primary, rgba(255,255,255,0.92))',
                  padding: '0 8px',
                  fontSize: 11,
                  outline: 'none',
                }}
              />
              <ActionButton
                label="Reply"
                busy={busy || !replyText.trim()}
                onClick={() => void submitReply()}
                tone="primary"
              />
            </div>
          </form>
        )}

        {notification.canDismiss && (
          <div
            data-avatar-overlay-control="dismiss"
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              zIndex: 20,
              opacity: rowActive ? 1 : 0,
              pointerEvents: rowActive ? 'auto' : 'none',
              transform: rowActive ? 'translateX(0)' : 'translateX(-6px)',
              transition: transitionFor(prefersReducedMotion, 'opacity 150ms ease-out, transform 150ms ease-out'),
            }}
          >
            <IconButton title="Dismiss" ariaLabel={`Dismiss ${notification.title}`} onClick={onDismiss}>
              <ChevronIcon path={X_ICON} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusIcon({ visual }: { visual: ReturnType<typeof statusVisualForNotification> }): JSX.Element {
  const color = visual.badgeBackgroundColor
  const iconPath = visual.iconType === 'clock'
    ? CLOCK_ICON
    : visual.iconType === 'warning'
      ? WARNING_ICON
      : visual.iconType === 'check-circle'
        ? CHECK_CIRCLE_ICON
        : null
  return (
    <div
      aria-label={visual.labelMessage}
      title={visual.labelMessage}
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color,
        background: 'rgba(255,255,255,0.08)',
        flexShrink: 0,
        marginTop: 1,
      }}
    >
      {visual.iconType === 'spinner' ? (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: color,
            display: 'block',
          }}
        />
      ) : iconPath ? (
        <ChevronIcon path={iconPath} size={16} />
      ) : (
        null
      )}
    </div>
  )
}

function IconButton({
  title,
  ariaLabel,
  children,
  onClick,
}: {
  title: string
  ariaLabel: string
  children: ReactNode
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
      style={{
        width: 24,
        height: 24,
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        borderRadius: 7,
        border: '1px solid var(--color-token-border-default, rgba(255,255,255,0.14))',
        background: 'var(--color-token-main-surface-primary, rgba(31,31,31,0.92))',
        color: 'var(--color-token-text-secondary, rgba(255,255,255,0.70))',
        boxShadow: '0 5px 10px -7px rgba(0,0,0,0.22)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function ActionButton({
  label,
  busy,
  tone,
  onClick,
}: {
  label: string
  busy: boolean
  tone?: 'primary'
  onClick: () => void
}): JSX.Element {
  return (
    <button
      disabled={busy}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
      style={{
        height: 22,
        padding: '0 8px',
        borderRadius: 6,
        border: tone === 'primary' ? '1px solid rgba(28,28,24,0.18)' : '1px solid rgba(28,28,24,0.14)',
        background: tone === 'primary' ? 'rgba(59,130,246,0.86)' : 'rgba(255,255,255,0.72)',
        color: tone === 'primary' ? '#fff' : 'rgba(31,31,27,0.82)',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
        fontSize: 10.5,
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  )
}

function ChevronIcon({ path, size = 16 }: { path: string; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
