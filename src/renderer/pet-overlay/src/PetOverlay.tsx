import { useEffect, useRef, useState } from 'react'
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
const CHEVRON_DOWN = 'M4.5 8.5 10 13.5 15.5 8.5'
const X_ICON = 'M5 5 15 15 M15 5 5 15'

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
  const trayRef = useRef<HTMLDivElement>(null)
  const trayListRef = useRef<HTMLDivElement>(null)
  const mascotRef = useRef<HTMLDivElement>(null)
  const resizeState = useRef<ResizeState | null>(null)

  // Load initial config + sessions.
  useEffect(() => {
    window.petApi.pet.getConfig().then((cfg) => {
      setConfig(cfg)
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
    }
    const onPointerCancel = (e: PointerEvent): void => {
      finishDrag(e.pointerId, null, false)
    }
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])

  useEffect(() => {
    storeDismissedKeys(dismissedKeys)
  }, [dismissedKeys])

  // Mouse passthrough
  useEffect(() => {
    let lastInteractive = false
    const onMove = (e: MouseEvent): void => {
      if (isDragging.current) return
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const isInteractive = !!el?.closest('[data-interactive]')
      if (isInteractive !== lastInteractive) {
        lastInteractive = isInteractive
        window.petApi.pet.setPointerInteractive(isInteractive)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Report actual element sizes to main so it can place the floating window.
  useEffect(() => {
    const el = trayRef.current
    if (!el) return
    let frame: number | null = null
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.ceil(entry.contentRect.width)
      const height = Math.ceil(entry.contentRect.height)
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        window.petApi.pet.setTraySize({ width, height })
      })
    })
    ro.observe(el)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = mascotRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      window.petApi.pet.setMascotSize({
        width: Math.ceil(entry.contentRect.width),
        height: Math.ceil(entry.contentRect.height),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    setMascotWidthPx(width)
    window.petApi.pet.setMascotWidth(width)
    if (target instanceof HTMLElement && target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId)
    }
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
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const state = resizeState.current
    if (!state || state.pointerId !== e.pointerId) return
    e.preventDefault()
    e.stopPropagation()
    setMascotWidthPx(clampMascotWidth(state.startWidthPx + e.screenX - state.startScreenX))
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
        cursor: isDraggingVisual ? 'grabbing' : 'grab',
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
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            {(trayScrollState.hiddenOlderNotificationCount > 0 || trayScrollState.hasLatestNotificationsAbove) && (
              <div
                data-avatar-overlay-size="notification-tray-header"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 6,
                  minHeight: 18,
                  alignItems: 'center',
                }}
              >
                {trayScrollState.hiddenOlderNotificationCount > 0 && (
                  <TrayButton
                    label={`+${trayScrollState.hiddenOlderNotificationCount}`}
                    title="Show older notifications"
                    onClick={() => {
                      const el = trayListRef.current
                      if (!el) return
                      el.scrollTo({ top: el.scrollTop + el.clientHeight, behavior: 'smooth' })
                    }}
                  />
                )}
                {trayScrollState.hasLatestNotificationsAbove && (
                  <TrayButton
                    label="Latest"
                    title="Show latest notifications"
                    onClick={() => trayListRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                  />
                )}
              </div>
            )}
            <div
              ref={trayListRef}
              data-avatar-overlay-size="notification-tray-list"
              onScroll={(ev) => setTrayScrollState(measureTrayScrollState(ev.currentTarget))}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                maxHeight: 226,
                overflowY: trayScrollState.hasScrollableContent ? 'auto' : 'hidden',
                scrollbarWidth: 'none',
              }}
            >
              {notifications.map((notification) => (
                <NotificationCard
                  key={notification.key}
                  notification={notification}
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
          transition: isDraggingVisual ? 'transform 160ms ease-out' : 'none',
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
          className="no-drag"
          aria-label="Resize pet"
          title="Resize pet"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={(e) => finishResize(e.pointerId, undefined, e.currentTarget)}
          onLostPointerCapture={(e) => finishResize(e.pointerId, undefined, e.currentTarget)}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 48,
            height: 48,
            border: 0,
            padding: 0,
            background: 'transparent',
            color: 'rgba(255,255,255,0.86)',
            cursor: 'nwse-resize',
            touchAction: 'none',
            zIndex: 4,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              width: 10,
              height: 10,
              borderRight: '2px solid currentColor',
              borderBottom: '2px solid currentColor',
              opacity: 0.72,
            }}
          />
        </button>
        {notifications.length > 0 && (
          <button
            data-interactive="true"
            className="no-drag"
            aria-label={isNotificationTrayOpen ? 'Collapse notifications' : `Show ${notifications.length} notifications`}
            title={isNotificationTrayOpen ? 'Collapse notifications' : 'Show notifications'}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation()
              setIsNotificationTrayOpen((open) => !open)
            }}
            style={{
              position: 'absolute',
              top: 2,
              right: 4,
              minWidth: isNotificationTrayOpen ? 28 : 26,
              width: isNotificationTrayOpen ? 28 : undefined,
              height: 28,
              padding: isNotificationTrayOpen ? 0 : '0 8px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.22)',
              background: isNotificationTrayOpen ? 'rgba(18,18,18,0.82)' : topVisual.badgeBackgroundColor,
              color: isNotificationTrayOpen ? 'rgba(255,255,255,0.72)' : topVisual.badgeForegroundColor,
              boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
              backdropFilter: 'blur(10px)',
              fontSize: isNotificationTrayOpen ? 15 : 11,
              fontWeight: 700,
              lineHeight: '26px',
              cursor: 'pointer',
              transform: 'translate(6px, -4px)',
              display: 'grid',
              placeItems: 'center',
              transition: 'transform 160ms ease-out, background-color 160ms ease-out, color 160ms ease-out',
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
  onClick,
}: {
  label: string
  title: string
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
        minWidth: 22,
        height: 18,
        padding: '0 7px',
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(18,18,18,0.72)',
        color: 'rgba(255,255,255,0.64)',
        fontSize: 10,
        lineHeight: '16px',
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
  onClick,
  onDismiss,
  onAction,
  onReply,
}: {
  notification: PetNotification
  onClick: () => void
  onDismiss: () => void
  onAction: (action: PetWaitingRequestAction) => Promise<void>
  onReply: (text: string) => Promise<void>
}): JSX.Element {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const providerColor = PROVIDER_DEFS[notification.provider]?.color ?? '#9CA3AF'
  const providerName = PROVIDER_DEFS[notification.provider]?.name ?? notification.provider
  const displayBody = notification.body.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim()
  const visual = statusVisualForNotification(notification)
  const actions = notification.waitingRequest?.actions ?? []
  const canReply = Boolean(notification.replyTarget)

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
      onClick={onClick}
      style={{
        background: 'var(--color-token-bg-secondary, rgba(31,31,31,0.94))',
        border: '1px solid var(--color-token-border-default, rgba(255,255,255,0.12))',
        boxShadow: '0 12px 24px rgba(0,0,0,0.26)',
        borderRadius: 8,
        padding: '9px 10px',
        cursor: 'pointer',
        position: 'relative',
        color: 'var(--color-token-text-primary, rgba(255,255,255,0.92))',
        backdropFilter: 'blur(12px)',
      }}
    >
      <button
        type="button"
        title="Dismiss"
        aria-label="Dismiss notification"
        onClick={(ev) => {
          ev.stopPropagation()
          onDismiss()
        }}
        disabled={!notification.canDismiss}
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          width: 20,
          height: 20,
          padding: 0,
          border: 0,
          borderRadius: 5,
          background: 'transparent',
          color: 'var(--color-token-text-secondary, rgba(255,255,255,0.48))',
          cursor: notification.canDismiss ? 'pointer' : 'default',
          opacity: notification.canDismiss ? 1 : 0,
        }}
      >
        <ChevronIcon path={X_ICON} />
      </button>

      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', paddingRight: 20 }}>
        <StatusIcon visual={visual} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 650,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {notification.title}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 2,
              minWidth: 0,
              color: 'var(--color-token-text-secondary, rgba(255,255,255,0.58))',
              fontSize: 10,
              fontWeight: 560,
            }}
          >
            <span>{visual.labelMessage}</span>
            <span aria-hidden="true">·</span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: providerColor,
                  flexShrink: 0,
                }}
              />
              {providerName}
            </span>
          </div>
          <div
            style={{
              color: 'var(--color-token-text-secondary, rgba(255,255,255,0.66))',
              fontSize: 10.5,
              lineHeight: '14px',
              marginTop: 5,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              fontFamily: displayBody.startsWith('$') ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
            }}
          >
            {displayBody || visual.fallbackBodyMessage}
          </div>
        </div>
      </div>

      {(actions.length > 0 || canReply) && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginTop: 8,
          }}
        >
          {actions.map((action) => (
            <ActionButton
              key={`${action.kind}:${action.label}`}
              label={action.kind === 'reply' && replyOpen ? 'Hide' : action.label}
              busy={busy}
              onClick={() => runAction(action)}
              tone={action.primary ? 'primary' : undefined}
            />
          ))}
          {canReply && !actions.some((action) => action.kind === 'reply') && (
            <ActionButton label={replyOpen ? 'Hide' : 'Reply'} busy={busy} onClick={() => setReplyOpen((v) => !v)} />
          )}
        </div>
      )}

      {replyOpen && (
        <form
          onClick={(ev) => ev.stopPropagation()}
          onSubmit={(ev) => {
            ev.preventDefault()
            void submitReply()
          }}
          style={{ display: 'flex', gap: 6, marginTop: 8 }}
        >
          <input
            value={replyText}
            disabled={busy}
            onChange={(ev) => setReplyText(ev.target.value)}
            autoFocus
            placeholder="Reply…"
            style={{
              minWidth: 0,
              flex: 1,
              height: 26,
              borderRadius: 9,
              border: '1px solid rgba(28,28,24,0.2)',
              background: 'rgba(255,255,255,0.72)',
              color: '#1f1f1b',
              padding: '0 8px',
              fontSize: 11,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy || !replyText.trim()}
            title="Send reply"
            aria-label="Send reply"
            style={{
              width: 28,
              height: 26,
              borderRadius: 9,
              border: '1px solid rgba(28,28,24,0.18)',
              background: providerColor,
              color: '#fff',
              cursor: busy || !replyText.trim() ? 'default' : 'pointer',
              opacity: busy || !replyText.trim() ? 0.55 : 1,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ↵
          </button>
        </form>
      )}
    </div>
  )
}

function StatusIcon({ visual }: { visual: ReturnType<typeof statusVisualForNotification> }): JSX.Element {
  const color = visual.badgeBackgroundColor
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
      ) : (
        <span style={{ fontSize: 12, fontWeight: 760, lineHeight: 1 }}>
          {visual.iconType === 'warning' ? '!' : visual.iconType === 'danger' ? 'x' : visual.iconType === 'success' ? '✓' : 'i'}
        </span>
      )}
    </div>
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

function ChevronIcon({ path }: { path: string }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
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
