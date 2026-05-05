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

const DISPLAY_W = 96
const DISPLAY_H = 104
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
function buildSequence(state: AnimState, overrides?: Partial<Record<string, number>>, reducedMotion = false): FrameSeq {
  if (reducedMotion) {
    return { frames: [{ durationMs: 0, col: 0, row: ANIM_ROW[state] }], loopStartIndex: null }
  }
  function getTimings(s: AnimState): number[] {
    const timing = BASE_TIMING[s]
    const count = overrides?.[s]
    if (count === undefined || count >= timing.length) return timing
    if (count <= 0) return [timing[timing.length - 1]]
    return [...timing.slice(0, count - 1), timing[timing.length - 1]]
  }

  const idleRow = ANIM_ROW['idle']
  const N: Frame[] = getTimings('idle').map((d, i) => ({
    durationMs: d * IDLE_MULTIPLIER,
    col: i,
    row: idleRow,
  }))

  if (state === 'idle') {
    return { frames: N, loopStartIndex: 0 }
  }

  const stateRow = ANIM_ROW[state]
  const M: Frame[] = getTimings(state).map((d, i) => ({ durationMs: d, col: i, row: stateRow }))
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
  frameOverrides?: Partial<Record<string, number>>
  onHoverEnter?: () => void
  onHoverLeave?: () => void
}

export default function PetAvatar({
  animState,
  spritesheetSrc,
  frameOverrides,
  onHoverEnter,
  onHoverLeave,
}: Props): JSX.Element {
  const divRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seqRef = useRef<FrameSeq>({ frames: [], loopStartIndex: 0 })
  const idxRef = useRef(0)
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    seqRef.current = buildSequence(animState, frameOverrides, reducedMotion.current)
    idxRef.current = 0

    const { frames, loopStartIndex } = seqRef.current
    if (frames.length === 0) return

    if (divRef.current) {
      divRef.current.style.backgroundPosition = bgPos(frames[0].col, frames[0].row)
    }

    // Single static frame — no timer needed
    if (frames.length === 1 && loopStartIndex === null) return

    const tick = (): void => {
      idxRef.current++
      if (idxRef.current >= seqRef.current.frames.length) {
        if (seqRef.current.loopStartIndex === null) return
        idxRef.current = seqRef.current.loopStartIndex
      }
      const f = seqRef.current.frames[idxRef.current]
      if (divRef.current) {
        divRef.current.style.backgroundPosition = bgPos(f.col, f.row)
      }
      timerRef.current = setTimeout(tick, f.durationMs)
    }

    timerRef.current = setTimeout(tick, frames[0].durationMs)

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [animState, frameOverrides])

  const initialRow = ANIM_ROW[animState]

  return (
    <div
      ref={divRef}
      data-interactive="true"
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      style={{
        width: DISPLAY_W,
        height: DISPLAY_H,
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
