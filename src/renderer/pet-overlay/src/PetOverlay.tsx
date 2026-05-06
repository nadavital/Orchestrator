import { useEffect, useRef, useState } from 'react'
import PetAvatar, { type AnimState } from './PetAvatar'
import { detectAnimFrames } from './detectAnimFrames'
import { PROVIDER_DEFS } from '../../../types'
import type { PetConfig, PetEntry, PetLayout } from './env'
import type { ChatMessage, SessionRunEventRecord } from '../../../types'
import {
  buildPetNotification,
  isPetNotificationExpired,
  type PetNotification,
  type PetNotificationStatus,
} from '../../../types/petNotifications'

const STATUS_TO_ANIM: Record<PetNotificationStatus, AnimState> = {
  waiting: 'waiting',
  failed: 'failed',
  review: 'review',
  running: 'running',
  idle: 'idle',
}

const STATUS_COLOR: Record<PetNotificationStatus, string> = {
  waiting: '#FBBF24',
  failed: '#F87171',
  review: '#22C55E',
  running: '#34D399',
  idle: '#9CA3AF',
}

const BADGE_COLOR: Record<PetNotificationStatus, { background: string; foreground: string }> = {
  waiting: { background: '#FBBF24', foreground: '#111827' },
  failed: { background: '#F87171', foreground: '#111827' },
  review: { background: '#22C55E', foreground: '#111827' },
  running: { background: '#3B82F6', foreground: '#FFFFFF' },
  idle: { background: 'rgba(18,18,18,0.82)', foreground: '#FFFFFF' },
}

const DISMISSED_STORAGE_KEY = 'orchestrator.pet.dismissedNotifications.v1'
const MAX_DISMISSED_KEYS = 300
const VISIBLE_COUNT = 2
const DRAG_SAMPLE_WINDOW_MS = 100
const MAX_THROW_SPEED = 1600
const MIN_THROW_SPEED = 320
const CHEVRON_RIGHT = 'M8.5 4.5 13.5 10 8.5 15.5'
const CHEVRON_DOWN = 'M4.5 8.5 10 13.5 15.5 8.5'

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

function statusIcon(status: PetNotificationStatus): string {
  if (status === 'running') return '●'
  if (status === 'waiting') return '!'
  if (status === 'failed') return '×'
  if (status === 'review') return '✓'
  return ''
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
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set())
  const [trayCollapsed, setTrayCollapsed] = useState(false)
  const [page, setPage] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const isDragging = useRef(false)
  const [isDraggingVisual, setIsDraggingVisual] = useState(false)
  const dragState = useRef<DragState | null>(null)
  const dragAnimStateRef = useRef<AnimState | null>(null)
  const [dragAnimState, setDragAnimState] = useState<AnimState | null>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const mascotRef = useRef<HTMLDivElement>(null)

  // Load initial config + sessions, then always run canvas detection for all pets
  useEffect(() => {
    window.petApi.pet.getConfig().then(async (cfg) => {
      setConfig(cfg)
      setLayout(cfg.initialLayout)
      const initial: Record<string, SessionState> = {}
      for (const s of cfg.sessions) {
        initial[s.id] = sessionFromConfig(s)
      }
      setSessions(initial)

      // Always detect frame counts via canvas — overrides any stale values from pet.json
      const detections = await Promise.all(
        cfg.pets.map(async (pet) => ({
          id: pet.id,
          animFrames: await detectAnimFrames(pet.spritesheetDataUrl),
        }))
      )

      setConfig((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          pets: prev.pets.map((pet) => {
            const d = detections.find((x) => x.id === pet.id)
            return d ? { ...pet, animFrames: d.animFrames } : pet
          }),
        }
      })
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
    .sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp)

  const topStatus = notifications[0]?.status ?? 'idle'
  const topBadgeColor = BADGE_COLOR[topStatus]
  let animState: AnimState
  if (dragAnimState !== null) animState = dragAnimState
  else if (isHovering && !isDragging.current) animState = 'jumping'
  else animState = STATUS_TO_ANIM[topStatus]

  const selectedPet: PetEntry | undefined =
    config?.pets.find((p) => p.id === config.selectedPetId) ?? config?.pets[0]

  const maxPage = Math.max(0, Math.ceil(notifications.length / VISIBLE_COUNT) - 1)
  const safePage = Math.min(page, maxPage)
  const pageStart = safePage * VISIBLE_COUNT
  const visible = trayCollapsed ? [] : notifications.slice(pageStart, pageStart + VISIBLE_COUNT)
  const hasOlder = safePage < maxPage
  const hasLatest = safePage > 0
  const hasTray = notifications.length > 0

  useEffect(() => {
    if (page > maxPage) setPage(maxPage)
  }, [maxPage, page])

  useEffect(() => {
    window.petApi.pet.setTrayCount(hasTray && !trayCollapsed ? visible.length : 0)
  }, [hasTray, trayCollapsed, visible.length])

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
      if (recent.length >= 2) {
        const first = recent[0]
        const last = recent.at(-1)!
        const dt = (last.timeMs - first.timeMs) / 1000
        if (dt > 0) {
          const rawVx = (last.screenX - first.screenX) / dt
          const rawVy = (last.screenY - first.screenY) / dt
          const speed = Math.hypot(rawVx, rawVy)
          if (speed > MIN_THROW_SPEED) {
            const cap = Math.min(speed, MAX_THROW_SPEED)
            window.petApi.pet.dragRelease(rawVx * (cap / speed), rawVy * (cap / speed))
            return
          }
        }
      }
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
          pointerEvents: trayCollapsed ? 'none' : 'auto',
        }}
      >
        {notifications.length > 0 && !trayCollapsed && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 6,
                minHeight: 18,
                alignItems: 'center',
              }}
            >
              {hasOlder && (
                <TrayButton
                  label={`+${notifications.length - pageStart - VISIBLE_COUNT}`}
                  title="Show older notifications"
                  onClick={() => setPage((current) => Math.min(maxPage, current + 1))}
                />
              )}
              {hasLatest && (
                <TrayButton
                  label="Latest"
                  title="Show latest notifications"
                  onClick={() => setPage(0)}
                />
              )}
            </div>
            {!trayCollapsed && visible.map((notification) => (
              <NotificationCard
                key={notification.key}
                notification={notification}
                expanded={expandedKeys.has(notification.key)}
                onToggleExpanded={() => {
                  setExpandedKeys((prev) => {
                    const next = new Set(prev)
                    if (next.has(notification.key)) next.delete(notification.key)
                    else next.add(notification.key)
                    return next
                  })
                }}
                onClick={() => {
                  window.petApi.pet.focusMain(notification.sessionId)
                  setSessions((prev) => ({
                    ...prev,
                    ...(prev[notification.sessionId]
                      ? { [notification.sessionId]: { ...prev[notification.sessionId], hasUnread: false } }
                      : {})
                  }))
                }}
                onDismiss={() => {
                  setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                  setSessions((prev) => ({
                    ...prev,
                    ...(prev[notification.sessionId]
                      ? { [notification.sessionId]: { ...prev[notification.sessionId], hasUnread: false } }
                      : {})
                  }))
                }}
                onReply={async (text) => {
                  await window.petApi.sessions.answerUserInput(notification.sessionId, text)
                }}
                onAllow={async () => {
                  if (!notification.permissionAction) return
                  await window.petApi.sessions.grantAndResume(notification.sessionId, notification.permissionAction.toolNames)
                  setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                }}
                onDeny={async () => {
                  await window.petApi.sessions.denyPermission(notification.sessionId)
                  setDismissedKeys((prev) => new Set(prev).add(notification.dismissKey))
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Mascot */}
      <div
        ref={mascotRef}
        data-avatar-mascot="true"
        data-interactive="true"
        onContextMenu={() => window.petApi.pet.close()}
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
          frameOverrides={selectedPet.animFrames}
          onHoverEnter={() => setIsHovering(true)}
          onHoverLeave={() => setIsHovering(false)}
        />
        {notifications.length > 0 && (
          <button
            data-interactive="true"
            className="no-drag"
            aria-label={trayCollapsed ? `Show ${notifications.length} notifications` : 'Collapse notifications'}
            title={trayCollapsed ? 'Show notifications' : 'Collapse notifications'}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation()
              setTrayCollapsed((open) => !open)
            }}
            style={{
              position: 'absolute',
              top: 2,
              right: 4,
              minWidth: trayCollapsed ? 26 : 28,
              width: trayCollapsed ? undefined : 28,
              height: 28,
              padding: trayCollapsed ? '0 8px' : 0,
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.22)',
              background: trayCollapsed ? topBadgeColor.background : 'rgba(18,18,18,0.82)',
              color: trayCollapsed ? topBadgeColor.foreground : 'rgba(255,255,255,0.72)',
              boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
              backdropFilter: 'blur(10px)',
              fontSize: trayCollapsed ? 11 : 15,
              fontWeight: 700,
              lineHeight: '26px',
              cursor: 'pointer',
              transform: 'translate(6px, -4px)',
              display: 'grid',
              placeItems: 'center',
              transition: 'transform 160ms ease-out, background-color 160ms ease-out, color 160ms ease-out',
            }}
          >
            {trayCollapsed ? (
              notifications.length
            ) : (
              <ChevronIcon path={CHEVRON_DOWN} />
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
  expanded,
  onToggleExpanded,
  onClick,
  onDismiss,
  onReply,
  onAllow,
  onDeny,
}: {
  notification: PetNotification
  expanded: boolean
  onToggleExpanded: () => void
  onClick: () => void
  onDismiss: () => void
  onReply: (text: string) => Promise<void>
  onAllow: () => Promise<void>
  onDeny: () => Promise<void>
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [busy, setBusy] = useState(false)
  const providerColor = PROVIDER_DEFS[notification.provider]?.color ?? '#9CA3AF'
  const longBody = notification.body.length > 90
  const displayBody = notification.body.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim()

  const submitReply = async (): Promise<void> => {
    const text = replyText.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await onReply(text)
      setReplyText('')
      setReplyOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-interactive="true"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'linear-gradient(180deg, rgba(252,252,249,0.96), rgba(232,231,222,0.96))',
        backgroundImage: 'linear-gradient(180deg, rgba(252,252,249,0.96), rgba(232,231,222,0.96)), linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px), linear-gradient(180deg, rgba(0,0,0,0.035) 1px, transparent 1px)',
        backgroundSize: 'auto, 4px 4px, 4px 4px',
        border: '1px solid rgba(28,28,24,0.22)',
        boxShadow: hovered
          ? '0 14px 24px rgba(0,0,0,0.22)'
          : '0 12px 22px rgba(0,0,0,0.18)',
        borderRadius: 8,
        padding: '8px 9px 8px 10px',
        cursor: 'pointer',
        position: 'relative',
        color: '#1f1f1b',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'transform 140ms ease-out, box-shadow 140ms ease-out, border-color 140ms ease-out',
      }}
    >
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: providerColor,
            flexShrink: 0,
            marginTop: 4,
            boxShadow: `0 0 0 3px ${providerColor}22`,
          }}
        />
        <div style={{ flex: 1, minWidth: 0, paddingRight: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 650,
                color: '#1f1f1b',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {notification.title}
            </div>
            <div
              aria-label={notification.label}
              title={notification.label}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                color: STATUS_COLOR[notification.status],
                background: `${STATUS_COLOR[notification.status]}24`,
                fontSize: notification.status === 'running' ? 8 : 11,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {statusIcon(notification.status)}
            </div>
          </div>
          <div style={{ fontSize: 10, color: STATUS_COLOR[notification.status], marginTop: 1, fontWeight: 560 }}>
            {notification.label}
          </div>
          {notification.body && (
            <div
              style={{
                fontSize: 10.5,
                color: 'rgba(31,31,27,0.66)',
                marginTop: 4,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: expanded ? 16 : 2,
                WebkitBoxOrient: 'vertical',
                lineHeight: '14px',
                maxHeight: expanded ? 224 : 28,
                fontFamily: displayBody.startsWith('$') ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
                transition: 'max-height 180ms ease-out',
              }}
            >
              {displayBody}
            </div>
          )}
        </div>
      </div>

      {(notification.permissionAction || notification.canReply || longBody) && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginTop: 8,
          }}
        >
          {notification.permissionAction && (
            <>
              <ActionButton label="Allow" busy={busy} onClick={() => runAction(onAllow)} tone="primary" />
              <ActionButton label="Deny" busy={busy} onClick={() => runAction(onDeny)} />
            </>
          )}
          {notification.canReply && (
            <ActionButton label={replyOpen ? 'Hide' : 'Reply'} busy={busy} onClick={() => setReplyOpen((v) => !v)} />
          )}
          {longBody && (
            <IconActionButton
              title={expanded ? 'Collapse' : 'Expand'}
              busy={false}
              onClick={onToggleExpanded}
              rotate={expanded ? 90 : 0}
            />
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

function IconActionButton({
  title,
  busy,
  rotate,
  onClick,
}: {
  title: string
  busy: boolean
  rotate: number
  onClick: () => void
}): JSX.Element {
  return (
    <button
      disabled={busy}
      title={title}
      aria-label={title}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
      style={{
        width: 22,
        height: 22,
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        borderRadius: 6,
        border: '1px solid rgba(28,28,24,0.14)',
        background: 'rgba(255,255,255,0.72)',
        color: 'rgba(31,31,27,0.74)',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span style={{ transform: `rotate(${rotate}deg)`, transition: 'transform 120ms ease-out' }}>
        <ChevronIcon path={CHEVRON_RIGHT} />
      </span>
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
