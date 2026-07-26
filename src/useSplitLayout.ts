import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  clampBottomHeight,
  clampHeight,
  readPersistedHeight,
  BOTTOM_MIN_HEIGHT,
  BOTTOM_MAX_FRACTION,
  BOTTOM_DEFAULT_HEIGHT,
  BOTTOM_HEIGHT_STORAGE_KEY,
} from './layout'

export type UseSplitLayoutResult = {
  // Current bottom-pane pixel height. Drives flexBasis on the .main-bottom div.
  bottomHeight: number
  // Ref to attach to the container element holding .main-top + divider +
  // .main-bottom. We need its bounding rect during drag to compute the
  // max allowed height and clamp.
  mainContainerRef: React.MutableRefObject<HTMLElement | null>
  // onMouseDown handler for the divider — installs window-level move/up
  // listeners that drag the height and persist on release.
  handleDividerMouseDown: (e: React.MouseEvent) => void
}

// Owns the resizable terminal split: persisted bottom-pane height,
// the container ref, and the divider drag handlers. The drag is run
// off-state via a ref so mousemove doesn't trigger re-renders; the
// committed height is persisted to localStorage on mouseup.
export function useSplitLayout(): UseSplitLayoutResult {
  const [bottomHeight, setBottomHeight] = useState<number>(() =>
    readPersistedHeight(BOTTOM_DEFAULT_HEIGHT),
  )
  // Ref so the mousemove handler always reads the latest height without
  // needing to be re-registered on every height change.
  const bottomHeightRef = useRef(bottomHeight)
  // The container that holds .main-top + divider + .main-bottom.
  const mainContainerRef = useRef<HTMLElement | null>(null)
  // isDragging is a ref (not state) to avoid re-renders during drag.
  const isDraggingRef = useRef(false)

  // Keep ref in sync with state so the mousemove closure always sees the
  // latest value without needing to be re-registered.
  useEffect(() => {
    bottomHeightRef.current = bottomHeight
  }, [bottomHeight])

  // Re-clamp against the space actually available — on mount and on every
  // window resize.
  //
  // readPersistedHeight deliberately does no clamping; it can't, because it has
  // no idea how tall the container will be. Without this, a height persisted in
  // a tall (or maximised) window squeezes .main-top toward zero in a shorter
  // one — .main-bottom is `flex: 0 0 auto` and cannot shrink — and past the
  // container it spills and is clipped by `.main { overflow: hidden }`. The
  // visible symptom is the claude terminal being cut off by the shell selector.
  //
  // Layout effect, not a plain effect, so the correction lands before paint
  // rather than flashing a broken split for a frame.
  const clampToContainer = useCallback(() => {
    const container = mainContainerRef.current
    if (!container) return
    const available = container.getBoundingClientRect().height
    if (available <= 0) return
    setBottomHeight((prev) => {
      const next = clampBottomHeight(prev, available)
      if (next === prev) return prev
      console.info(
        `[termhub:layout] clamped bottom pane ${prev} -> ${next} for ${Math.round(available)}px of space`,
      )
      bottomHeightRef.current = next
      return next
    })
  }, [])

  useLayoutEffect(() => {
    clampToContainer()
  }, [clampToContainer])

  useEffect(() => {
    // Skip while dragging: the drag handler already clamps against a live
    // measurement, and re-entering here would fight it.
    const onResize = () => {
      if (isDraggingRef.current) return
      clampToContainer()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampToContainer])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    console.info(
      '[termhub:layout] drag start, height before:',
      bottomHeightRef.current,
    )

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return
      const container = mainContainerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      // Height = distance from mouse Y to the bottom of the container.
      const raw = rect.bottom - ev.clientY
      const clamped = clampHeight(
        raw,
        BOTTOM_MIN_HEIGHT,
        BOTTOM_MAX_FRACTION,
        rect.height,
      )
      setBottomHeight(clamped)
      bottomHeightRef.current = clamped
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      const finalHeight = bottomHeightRef.current
      console.info('[termhub:layout] drag end, final height:', finalHeight)
      // Persist the chosen height.
      try {
        localStorage.setItem(BOTTOM_HEIGHT_STORAGE_KEY, String(finalHeight))
      } catch {
        // localStorage may be unavailable in some environments
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  return { bottomHeight, mainContainerRef, handleDividerMouseDown }
}
