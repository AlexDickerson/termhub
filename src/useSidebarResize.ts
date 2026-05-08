import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampDimension,
  readPersistedWidth,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_FRACTION,
} from './layout'

export type UseSidebarResizeResult = {
  // Current sidebar pixel width. Drive the element's width via inline style.
  width: number
  // onMouseDown handler for the drag handle divider.
  handleDividerMouseDown: (e: React.MouseEvent) => void
}

// Owns the resizable sidebar: persisted width and the divider drag handler.
// side='left'  → drag handle on the right edge; dragging right widens.
// side='right' → drag handle on the left edge;  dragging left widens.
// containerRef should point to the flex row that contains both sidebars and
// the main area — its width is used as the clamping reference.
export function useSidebarResize(
  side: 'left' | 'right',
  storageKey: string,
  defaultWidth: number,
  containerRef: React.RefObject<HTMLElement | null>,
): UseSidebarResizeResult {
  const [width, setWidth] = useState<number>(() =>
    readPersistedWidth(storageKey, defaultWidth),
  )
  const widthRef = useRef(width)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    widthRef.current = width
  }, [width])

  // Re-clamp on window resize so a saved width that's now too wide is corrected.
  useEffect(() => {
    const onResize = () => {
      const container = containerRef.current
      if (!container) return
      const { width: containerWidth } = container.getBoundingClientRect()
      setWidth((prev) =>
        clampDimension(prev, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, containerWidth),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [containerRef])

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      console.info(
        '[termhub:layout] sidebar drag start, side:',
        side,
        'width before:',
        widthRef.current,
      )

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        const raw =
          side === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX
        const clamped = clampDimension(
          raw,
          SIDEBAR_MIN_WIDTH,
          SIDEBAR_MAX_FRACTION,
          rect.width,
        )
        setWidth(clamped)
        widthRef.current = clamped
      }

      const onMouseUp = () => {
        isDraggingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        const finalWidth = widthRef.current
        console.info(
          '[termhub:layout] sidebar drag end, side:',
          side,
          'final width:',
          finalWidth,
        )
        try {
          localStorage.setItem(storageKey, String(finalWidth))
        } catch {
          // localStorage may be unavailable
        }
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [side, storageKey, containerRef],
  )

  return { width, handleDividerMouseDown }
}
