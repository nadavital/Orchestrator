import { useEffect, useRef } from 'react'

export type AnimState =
  | 'idle'
  | 'running'
  | 'running-left'
  | 'running-right'
  | 'waving'
  | 'waiting'
  | 'jumping'
  | 'review'
  | 'failed'

const DISPLAY_W_REM = 7.04
const SHEET_COLS = 8  // k
const SHEET_ROWS = 9  // A

const IDLE_MULTIPLIER = 6  // j — idle frames run 6× slower

const ANIM_ROW: Record<AnimState, number> = {
  idle: 0,
  'running-right': 1,
  'running-left': 2,
  waving: 3,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8,
}

// Base per-frame durations (ms) — M values matching Codex standard frame counts:
// idle=6, running-right/left=8, waving=4, jumping=5, failed=8, waiting=6, running=6, review=6
const BASE_TIMING: Record<AnimState, number[]> = {
  idle:            [280, 110, 110, 140, 140, 320],
  'running-right': [120, 120, 120, 120, 120, 120, 120, 220],
  'running-left':  [120, 120, 120, 120, 120, 120, 120, 220],
  waving:          [140, 140, 140, 280],
  jumping:         [140, 140, 140, 140, 280],
  failed:          [140, 140, 140, 140, 140, 140, 140, 240],
  waiting:         [150, 150, 150, 150, 150, 260],
  running:         [120, 120, 120, 120, 120, 220],
  review:          [150, 150, 150, 150, 150, 280],
}

type Frame = { durationMs: number; col: number; row: number }
// loopStartIndex=null means play once and stop (used for reducedMotion single-frame)
type FrameSeq = { frames: Frame[]; loopStartIndex: number | null }

// Mirrors Codex's I(state, reducedMotion) resolver.
// reducedMotion → single static frame, no timer
// For idle:     frames = N (slow idle), loopStartIndex = 0
// For non-idle: frames = [M×3, N], loopStartIndex = M.length×3 — plays 3× then loops slow idle
function buildSequence(state: AnimState, reducedMotion = false): FrameSeq {
  if (reducedMotion) {
    return { frames: [{ durationMs: 0, col: 0, row: ANIM_ROW[state] }], loopStartIndex: null }
  }

  const idleRow = ANIM_ROW['idle']
  const N: Frame[] = BASE_TIMING.idle.map((d, i) => ({
    durationMs: d * IDLE_MULTIPLIER,
    col: i,
    row: idleRow,
  }))

  if (state === 'idle') {
    return { frames: N, loopStartIndex: 0 }
  }

  const stateRow = ANIM_ROW[state]
  const M: Frame[] = BASE_TIMING[state].map((d, i) => ({ durationMs: d, col: i, row: stateRow }))
  const tripled: Frame[] = [...M, ...M, ...M]

  return {
    frames: [...tripled, ...N],
    loopStartIndex: tripled.length,
  }
}

// CSS percentage background-position (matches Codex exactly)
function bgPos(col: number, row: number): string {
  const x = (col / (SHEET_COLS - 1)) * 100
  const y = (row / (SHEET_ROWS - 1)) * 100
  return `${x}% ${y}%`
}

interface Props {
  animState: AnimState
  spritesheetSrc: string
  isAnimationEnabled?: boolean
  displayWidthPx?: number | null
}

export default function PetAvatar({
  animState,
  spritesheetSrc,
  isAnimationEnabled = true,
  displayWidthPx = null,
}: Props): JSX.Element {
  const divRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const el = divRef.current
    if (!el) return
    const sequence = buildSequence(animState, prefersReducedMotion || !isAnimationEnabled)
    const { frames, loopStartIndex } = sequence
    if (frames.length === 0) return

    let frameIndex = 0
    let timeout: ReturnType<typeof window.setTimeout> | null = null
    el.style.backgroundPosition = bgPos(frames[frameIndex].col, frames[frameIndex].row)

    if (frames.length === 1 && loopStartIndex === null) return

    const scheduleNext = (): void => {
      timeout = window.setTimeout(() => {
        const nextIndex = frameIndex + 1
        if (nextIndex >= frames.length) {
          if (loopStartIndex == null) {
            timeout = null
            return
          }
          frameIndex = loopStartIndex
        } else {
          frameIndex = nextIndex
        }
        const frame = frames[frameIndex]
        el.style.backgroundPosition = bgPos(frame.col, frame.row)
        scheduleNext()
      }, frames[frameIndex].durationMs)
    }

    scheduleNext()

    return () => {
      if (timeout !== null) {
        window.clearTimeout(timeout)
      }
    }
  }, [animState, isAnimationEnabled, prefersReducedMotion])

  const initialRow = ANIM_ROW[animState]

  return (
    <div
      ref={divRef}
      data-interactive="true"
      data-avatar-state={animState}
      style={{
        width: displayWidthPx === null ? `${DISPLAY_W_REM}rem` : `${displayWidthPx}px`,
        aspectRatio: '192 / 208',
        backgroundImage: `url(${spritesheetSrc})`,
        backgroundSize: `${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%`,
        backgroundPosition: bgPos(0, initialRow),
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        cursor: 'grab',
        flexShrink: 0,
      }}
    />
  )
}

function usePrefersReducedMotion(): boolean {
  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  return prefersReducedMotion.current
}
