import { useEffect, useRef, useState } from 'react'
import PetAvatar, { type AnimState } from './PetAvatar'
import { detectAnimFrames } from './detectAnimFrames'
import { PROVIDER_DEFS } from '../../../types'
import type { PetConfig, PetEntry, PetLayout } from './env'
import type { ChatMessage } from '../../../types'

type PetStatus = 'waiting' | 'error' | 'review' | 'running' | 'idle'

const STATUS_PRIORITY: Record<PetStatus, number> = {
  waiting: 0, error: 1, review: 2, running: 3, idle: 4
}

const STATUS_TO_ANIM: Record<PetStatus, AnimState> = {
  waiting: 'waiting',
  error: 'failed',
  review: 'review',
  running: 'running',
  idle: 'idle',
}

const STATUS_LABEL: Record<PetStatus, string> = {
  waiting: 'Waiting for input',
  error: 'Error',
  review: 'Unread response',
  running: 'Running…',
  idle: '',
}

const STATUS_COLOR: Record<PetStatus, string> = {
  waiting: '#FBBF24',
  error: '#F87171',
  review: '#60A5FA',
  running: '#34D399',
  idle: '#9CA3AF',
}

interface SessionState {
  id: string
  name: string
  provider: string
  status: 'idle' | 'running' | 'error'
  hasUnread: boolean
  needsInput: boolean
  lastToolName: string | null
  lastToolInput: Record<string, unknown>
  lastAssistantText: string
  activitySeq: number
  lastActivityAt: number
}

function getStatus(s: SessionState): PetStatus {
  if (s.needsInput) return 'waiting'
  if (s.status === 'error') return 'error'
  if (s.hasUnread) return 'review'
  if (s.status === 'running') return 'running'
  return 'idle'
}

const NOTIFICATION_TTL_MS: Record<PetStatus, number> = {
  running: 180_000,
  error: 3_600_000,
  waiting: 86_400_000,
  review: 604_800_000,
  idle: 0,
}

function compactPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parts = value.trim().split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join('/')
}

function firstString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function classifyToolActivity(toolName: string, input: Record<string, unknown>): string {
  const normalizedName = toolName.toLowerCase().replace(/[_\s.-]+/g, '')
  const command = firstString(input, ['command', 'cmd', 'script', 'description'])
  if (command && /(bash|shell|terminal|command|exec|run)/i.test(toolName)) {
    return `$ ${command.slice(0, 48)}`
  }

  const filePath = compactPath(
    firstString(input, ['file_path', 'path', 'target_file', 'targetFile', 'absolutePath', 'relativePath']) ??
    (Array.isArray(input.files) ? input.files[0] : null)
  )
  if (filePath) {
    if (normalizedName.includes('read')) return `Reading ${filePath}`
    if (normalizedName.includes('write') || normalizedName.includes('edit') || normalizedName.includes('patch')) {
      return `Editing ${filePath}`
    }
    return filePath
  }

  const query = firstString(input, ['query', 'pattern', 'search', 'searchTerm'])
  if (query) return `Search: ${query.slice(0, 44)}`

  const url = firstString(input, ['url', 'uri'])
  if (url) return `Fetch: ${url.slice(0, 44)}`

  if (normalizedName.includes('todo')) return 'Updating task list'
  if (normalizedName.includes('agent') || normalizedName.includes('subtask')) {
    const description = firstString(input, ['description', 'prompt', 'task'])
    return description ? `Agent: ${description.slice(0, 44)}` : 'Running agent'
  }

  return toolName === 'unknown' || toolName === 'tool' ? 'Using tool' : `Using ${toolName}`
}

function formatActivity(s: SessionState, status: PetStatus): string | null {
  if (status === 'running' && s.lastToolName) {
    return classifyToolActivity(s.lastToolName, s.lastToolInput)
  }
  if ((status === 'review' || status === 'error') && s.lastAssistantText) {
    return s.lastAssistantText.replace(/\s+/g, ' ').trim().slice(0, 72)
  }
  return null
}

function extractMessages(msgs: ChatMessage[], prev: SessionState): Partial<SessionState> {
  let lastToolName = prev.lastToolName
  let lastToolInput = prev.lastToolInput
  let lastAssistantText = prev.lastAssistantText
  let hasUnread = prev.hasUnread
  let changed = false

  for (const m of msgs) {
    if (m.type === 'tool_use') {
      lastToolName = m.toolName
      lastToolInput = m.toolInput
      changed = true
    }
    if (m.type === 'text' && m.role === 'assistant') {
      lastAssistantText = m.content
      hasUnread = true
      changed = true
    }
    if (m.type === 'result') {
      lastAssistantText = m.content
      changed = true
    }
  }
  return {
    lastToolName,
    lastToolInput,
    lastAssistantText,
    hasUnread,
    activitySeq: changed ? prev.activitySeq + 1 : prev.activitySeq,
    lastActivityAt: changed ? Date.now() : prev.lastActivityAt,
  }
}

function notificationKey(s: SessionState, status: PetStatus): string {
  return `${s.id}:${status}:${s.activitySeq}`
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
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set())
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
        initial[s.id] = {
          id: s.id,
          name: s.name,
          provider: s.provider,
          status: s.status,
          hasUnread: false,
          needsInput: false,
          lastToolName: null,
          lastToolInput: {},
          lastAssistantText: '',
          activitySeq: 0,
          lastActivityAt: Date.now(),
        }
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
            [event.session.id]: {
              id: event.session.id,
              name: event.session.name,
              provider: event.session.provider,
              status: event.session.status,
              hasUnread: false,
              needsInput: false,
              lastToolName: null,
              lastToolInput: {},
              lastAssistantText: '',
              activitySeq: 0,
              lastActivityAt: now,
            }
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
              needsInput: event.status === 'running' ? false : s.needsInput,
              lastToolName: event.status !== 'running' ? null : s.lastToolName,
              activitySeq: event.status !== s.status ? s.activitySeq + 1 : s.activitySeq,
              lastActivityAt: event.status !== s.status ? now : s.lastActivityAt,
            }
          }
        }
        if (event.type === 'messages') {
          return { ...prev, [event.id]: { ...s, ...extractMessages(event.messages, s) } }
        }
        if (event.type === 'renamed') {
          return { ...prev, [event.id]: { ...s, name: event.name } }
        }
        if (event.type === 'needsInput') {
          return { ...prev, [event.id]: { ...s, needsInput: true, activitySeq: s.activitySeq + 1, lastActivityAt: now } }
        }
        return prev
      })
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

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
  const sessionList = Object.values(sessions)
  const active = sessionList
    .map((s) => ({ session: s, status: getStatus(s) }))
    .filter(({ status }) => status !== 'idle')
    .filter(({ session, status }) => {
      const ttl = NOTIFICATION_TTL_MS[status]
      if (ttl > 0 && nowMs - session.lastActivityAt > ttl) return false
      return !dismissedKeys.has(notificationKey(session, status))
    })
    .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status])

  const topStatus = active[0]?.status ?? 'idle'
  let animState: AnimState
  if (dragAnimState !== null) animState = dragAnimState
  else if (isHovering) animState = 'jumping'
  else animState = STATUS_TO_ANIM[topStatus]

  const selectedPet: PetEntry | undefined =
    config?.pets.find((p) => p.id === config.selectedPetId) ?? config?.pets[0]

  // Cap at 2 visible cards (matches Codex fe=2), report count to main
  const visible = active.slice(0, 2)
  const moreCount = active.length - 2
  useEffect(() => {
    window.petApi.pet.setTrayCount(visible.length)
  }, [visible.length])

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
        }}
      >
        {visible.length > 0 && (
          <>
            {moreCount > 0 && (
              <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>
                +{moreCount} more
              </div>
            )}
            {visible.map(({ session, status }) => (
              <NotificationCard
                key={session.id}
                session={session}
                status={status}
                onClick={() => {
                  window.petApi.pet.focusMain(session.id)
                  setSessions((prev) => ({
                    ...prev,
                    [session.id]: { ...prev[session.id], hasUnread: false }
                  }))
                }}
                onDismiss={() => {
                  const key = notificationKey(session, status)
                  setDismissedKeys((prev) => new Set(prev).add(key))
                  setSessions((prev) => ({
                    ...prev,
                    [session.id]: { ...prev[session.id], hasUnread: false }
                  }))
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
        }}
      >
        <PetAvatar
          animState={animState}
          spritesheetSrc={selectedPet.spritesheetDataUrl}
          frameOverrides={selectedPet.animFrames}
          onHoverEnter={() => setIsHovering(true)}
          onHoverLeave={() => setIsHovering(false)}
        />
      </div>
    </div>
  )
}

function NotificationCard({
  session,
  status,
  onClick,
  onDismiss,
}: {
  session: SessionState
  status: PetStatus
  onClick: () => void
  onDismiss: () => void
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const providerColor = PROVIDER_DEFS[session.provider]?.color ?? '#9CA3AF'
  const activityText = formatActivity(session, status)

  return (
    <div
      data-interactive="true"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'rgba(18, 18, 18, 0.88)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10,
        padding: '7px 10px 7px 12px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: providerColor,
          flexShrink: 0,
          marginTop: 3,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.88)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {session.name}
        </div>
        <div style={{ fontSize: 10, color: STATUS_COLOR[status], marginTop: 1 }}>
          {STATUS_LABEL[status]}
        </div>
        {activityText && (
          <div
            style={{
              fontSize: 10,
              color: 'rgba(255,255,255,0.45)',
              marginTop: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: activityText.startsWith('$') ? 'monospace' : 'inherit',
            }}
          >
            {activityText}
          </div>
        )}
      </div>
      {/* Dismiss button — visible on hover for review/error states */}
      {hovered && (status === 'review' || status === 'error') && (
        <button
          onClick={(ev) => { ev.stopPropagation(); onDismiss() }}
          style={{
            position: 'absolute',
            top: 5,
            right: 6,
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            padding: '2px 3px',
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
