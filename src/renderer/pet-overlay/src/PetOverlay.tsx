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
  review: '#60A5FA',
  running: '#34D399',
  idle: '#9CA3AF',
}

const DISMISSED_STORAGE_KEY = 'orchestrator.pet.dismissedNotifications.v1'
const MAX_DISMISSED_KEYS = 300
const VISIBLE_COUNT = 2

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
  const dragStartPos = useRef<{ clientX: number; clientY: number } | null>(null)
  const hasMoved = useRef(false)
  const dragSamples = useRef<Array<{ screenX: number; screenY: number; timeMs: number }>>([])
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
    const ro = new ResizeObserver(([entry]) => {
      window.petApi.pet.setTraySize({
        width: Math.ceil(entry.contentRect.width),
        height: Math.ceil(entry.contentRect.height),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
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
  let animState: AnimState
  if (dragAnimState !== null) animState = dragAnimState
  else if (isHovering) animState = 'jumping'
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

  // Drag handlers — 4px threshold before committing (matches Codex Ge=4)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartPos.current = { clientX: e.clientX, clientY: e.clientY }
    hasMoved.current = false
    dragSamples.current = [{ screenX: e.screenX, screenY: e.screenY, timeMs: Date.now() }]
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    if (!dragStartPos.current) return

    const now = Date.now()
    dragSamples.current = [
      ...dragSamples.current.filter((s) => now - s.timeMs < 100),
      { screenX: e.screenX, screenY: e.screenY, timeMs: now }
    ]

    if (!hasMoved.current) {
      const dx = e.clientX - dragStartPos.current.clientX
      const dy = e.clientY - dragStartPos.current.clientY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      // Threshold crossed — commit to drag
      hasMoved.current = true
      isDragging.current = true
      setDragAnimState('idle')
      window.petApi.pet.dragStart(dragStartPos.current.clientX, dragStartPos.current.clientY)
    }

    if (dragSamples.current.length >= 2) {
      const last = dragSamples.current.at(-1)!
      const second = dragSamples.current.at(-2)!
      const dx = last.screenX - second.screenX
      if (Math.abs(dx) > 2) {
        const dir: AnimState = dx < 0 ? 'running-left' : 'running-right'
        setDragAnimState((prev) => (prev === dir ? prev : dir))
      }
    }
    window.petApi.pet.dragMove()
  }

  const handlePointerUp = (e: React.PointerEvent): void => {
    if (!dragStartPos.current) return
    dragStartPos.current = null

    if (!hasMoved.current) {
      // Pure click — focus main window (matches Codex open-current-main-window)
      window.petApi.pet.focusMain()
      return
    }

    isDragging.current = false
    setDragAnimState(null)

    const samples = dragSamples.current
    const now = Date.now()
    const recent = samples.filter((s) => now - s.timeMs < 100)

    if (recent.length >= 2) {
      const first = recent[0]
      const last = recent.at(-1)!
      const dt = (last.timeMs - first.timeMs) / 1000
      if (dt > 0) {
        const rawVx = (last.screenX - first.screenX) / dt
        const rawVy = (last.screenY - first.screenY) / dt
        const speed = Math.hypot(rawVx, rawVy)
        if (speed > 320) {
          const cap = Math.min(speed, 1600)
          window.petApi.pet.dragRelease(rawVx * (cap / speed), rawVy * (cap / speed))
          const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
          window.petApi.pet.setPointerInteractive(!!el?.closest('[data-interactive]'))
          return
        }
      }
    }

    window.petApi.pet.dragEnd()
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    window.petApi.pet.setPointerInteractive(!!el?.closest('[data-interactive]'))
  }

  if (!selectedPet) {
    return <div style={{ width: '100vw', height: '100vh' }} />
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Notification tray — always rendered so ResizeObserver can track height */}
      <div
        ref={trayRef}
        data-interactive="true"
        style={{
          position: 'absolute',
          left: layout.trayLeft,
          top: layout.trayTop,
          width: 264,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          zIndex: 1,
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
              <TrayButton
                label="–"
                title="Collapse notifications"
                onClick={() => setTrayCollapsed(true)}
              />
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
        data-interactive="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={() => window.petApi.pet.close()}
        style={{
          position: 'absolute',
          left: layout.mascotLeft,
          top: layout.mascotTop,
          cursor: isDragging.current ? 'grabbing' : 'grab',
          zIndex: 2,
        }}
      >
        <PetAvatar
          animState={animState}
          spritesheetSrc={selectedPet.spritesheetDataUrl}
          frameOverrides={selectedPet.animFrames}
          onHoverEnter={() => setIsHovering(true)}
          onHoverLeave={() => setIsHovering(false)}
        />
        {trayCollapsed && notifications.length > 0 && (
          <button
            data-interactive="true"
            aria-label="Show notifications"
            title="Show notifications"
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation()
              setTrayCollapsed(false)
            }}
            style={{
              position: 'absolute',
              top: 2,
              right: 4,
              minWidth: 24,
              height: 22,
              padding: '0 7px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.22)',
              background: 'rgba(18,18,18,0.82)',
              color: '#fff',
              boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
              backdropFilter: 'blur(10px)',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: '20px',
              cursor: 'pointer',
            }}
          >
            {notifications.length}
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
        background: 'rgba(20, 20, 22, 0.9)',
        backdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.26)',
        borderRadius: 18,
        padding: '9px 10px 9px 11px',
        cursor: 'pointer',
        position: 'relative',
        color: 'white',
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
                color: 'rgba(255,255,255,0.92)',
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
                background: `${STATUS_COLOR[notification.status]}1c`,
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
                color: 'rgba(255,255,255,0.58)',
                marginTop: 4,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: expanded ? 10 : 2,
                WebkitBoxOrient: 'vertical',
                lineHeight: '14px',
                maxHeight: expanded ? 140 : 28,
                fontFamily: notification.body.startsWith('$') ? 'ui-monospace, SFMono-Regular, monospace' : 'inherit',
              }}
            >
              {notification.body}
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
            <ActionButton label={expanded ? 'Less' : 'More'} busy={false} onClick={onToggleExpanded} />
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
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.92)',
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
              border: '1px solid rgba(255,255,255,0.14)',
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

      {hovered && notification.canDismiss && (
        <button
          aria-label="Dismiss notification"
          title="Dismiss"
          onClick={(ev) => { ev.stopPropagation(); onDismiss() }}
          style={{
            position: 'absolute',
            top: 7,
            right: 7,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.52)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: '16px',
            padding: 0,
          }}
        >
          ×
        </button>
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
        borderRadius: 8,
        border: tone === 'primary' ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(255,255,255,0.12)',
        background: tone === 'primary' ? 'rgba(96,165,250,0.84)' : 'rgba(255,255,255,0.08)',
        color: 'rgba(255,255,255,0.9)',
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
