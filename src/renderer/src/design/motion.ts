import { useEffect, useState, type CSSProperties } from 'react'

export const motionPresets = {
  spring: {
    badge: { damping: 20, mass: 0.7, stiffness: 420 },
    tray: { damping: 26, mass: 0.8, stiffness: 360 },
  },
  tween: {
    edge: { durationMs: 140, ease: 'ease-out' },
    row: { durationMs: 180, ease: 'ease-out' },
    controlReveal: { durationMs: 280, ease: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  },
  scale: {
    badgeHover: 1.06,
    edgeHover: 1.03,
    tapStrong: 0.94,
    tapSoft: 0.96,
  },
  row: {
    enterY: 4,
    staggerMs: 35,
    maxStaggerRows: 3,
  },
  reveal: {
    controlOffsetPx: 6,
  },
} as const

export type MotionSize = 'none' | 'subtle' | 'standard'

export function useReducedMotionPreference(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (): void => setPrefersReducedMotion(media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return prefersReducedMotion
}

export function rowMotionStyle(index = 0): CSSProperties {
  return {
    animationDelay: `${Math.min(index, motionPresets.row.maxStaggerRows) * motionPresets.row.staggerMs}ms`,
  }
}

export function motionTransformStyle(
  transform: string,
  prefersReducedMotion: boolean
): CSSProperties {
  return prefersReducedMotion ? {} : { transform }
}
