import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject, WheelEvent as ReactWheelEvent } from 'react'

interface TranscriptScrollMetrics {
  top: number
  height: number
  listOffsetTop: number
}

interface UseTranscriptScrollControllerOptions {
  transcriptListRef: RefObject<HTMLElement>
  followBottomThreshold: number
  userScrollLockoutMs: number
}

interface TranscriptScrollController {
  scrollContainerRef: RefObject<HTMLDivElement>
  bottomRef: RefObject<HTMLDivElement>
  shouldFollowBottomRef: RefObject<boolean>
  userScrollLockoutUntilRef: RefObject<number>
  scrollMetrics: TranscriptScrollMetrics
  showJumpToLatest: boolean
  clearUserScrollLockout: () => void
  handleTouchStart: () => void
  handleWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  scheduleScrollMetricsUpdate: () => void
  scrollToBottom: (force?: boolean) => void
  setFollowingBottom: (isFollowing: boolean) => void
  stopFollowingBottom: (lockout?: boolean) => void
  updateScrollMetrics: () => void
}

export function useTranscriptScrollController({
  transcriptListRef,
  followBottomThreshold,
  userScrollLockoutMs
}: UseTranscriptScrollControllerOptions): TranscriptScrollController {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldFollowBottomRef = useRef(true)
  const userScrollLockoutUntilRef = useRef(0)
  const pendingScrollFrameRef = useRef<number | null>(null)
  const pendingMetricsFrameRef = useRef<number | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [scrollMetrics, setScrollMetrics] = useState<TranscriptScrollMetrics>({ top: 0, height: 0, listOffsetTop: 0 })

  const updateScrollMetrics = useCallback(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const primaryContent = scroller.closest<HTMLElement>('[data-testid="session-primary-content"]')
    primaryContent?.style.setProperty(
      '--transcript-scrollbar-width',
      `${Math.max(0, scroller.offsetWidth - scroller.clientWidth)}px`
    )
    const nextMetrics = {
      top: scroller.scrollTop,
      height: scroller.clientHeight,
      listOffsetTop: transcriptListRef.current?.offsetTop ?? 0
    }
    setScrollMetrics((current) => (
      Math.abs(current.top - nextMetrics.top) < 1 &&
      Math.abs(current.height - nextMetrics.height) < 1 &&
      Math.abs(current.listOffsetTop - nextMetrics.listOffsetTop) < 1
        ? current
        : nextMetrics
    ))
  }, [transcriptListRef])

  const scheduleScrollMetricsUpdate = useCallback(() => {
    if (pendingMetricsFrameRef.current !== null) return
    pendingMetricsFrameRef.current = window.requestAnimationFrame(() => {
      pendingMetricsFrameRef.current = null
      updateScrollMetrics()
    })
  }, [updateScrollMetrics])

  const setFollowingBottom = useCallback((isFollowing: boolean) => {
    const shouldShowJumpButton = !isFollowing
    shouldFollowBottomRef.current = isFollowing
    setShowJumpToLatest((current) => current === shouldShowJumpButton ? current : shouldShowJumpButton)
  }, [])

  const clearUserScrollLockout = useCallback(() => {
    userScrollLockoutUntilRef.current = 0
  }, [])

  const stopFollowingBottom = useCallback((lockout = false) => {
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current)
      pendingScrollFrameRef.current = null
    }
    if (lockout) userScrollLockoutUntilRef.current = performance.now() + userScrollLockoutMs
    setFollowingBottom(false)
  }, [setFollowingBottom, userScrollLockoutMs])

  const scrollToBottom = useCallback((force = false) => {
    if (force) {
      clearUserScrollLockout()
      const scroller = scrollContainerRef.current
      if (scroller) scroller.scrollTop = scroller.scrollHeight
      setFollowingBottom(true)
      updateScrollMetrics()
      return
    }
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current)
    }
    pendingScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null
      if (!force && !shouldFollowBottomRef.current) return
      if (!force && performance.now() < userScrollLockoutUntilRef.current) return
      const scroller = scrollContainerRef.current
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight
        updateScrollMetrics()
      } else {
        bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      }
    })
  }, [clearUserScrollLockout, setFollowingBottom, updateScrollMetrics])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY !== 0 || event.deltaX !== 0) stopFollowingBottom(true)
  }, [stopFollowingBottom])

  const handleTouchStart = useCallback(() => {
    stopFollowingBottom(true)
  }, [stopFollowingBottom])

  useEffect(() => () => {
    if (pendingScrollFrameRef.current !== null) window.cancelAnimationFrame(pendingScrollFrameRef.current)
    if (pendingMetricsFrameRef.current !== null) window.cancelAnimationFrame(pendingMetricsFrameRef.current)
  }, [])

  return {
    scrollContainerRef,
    bottomRef,
    shouldFollowBottomRef,
    userScrollLockoutUntilRef,
    scrollMetrics,
    showJumpToLatest,
    clearUserScrollLockout,
    handleTouchStart,
    handleWheel,
    scheduleScrollMetricsUpdate,
    scrollToBottom,
    setFollowingBottom,
    stopFollowingBottom,
    updateScrollMetrics
  }
}
