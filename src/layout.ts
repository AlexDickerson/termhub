// Pure helpers for the resizable terminal split layout.

export const BOTTOM_MIN_HEIGHT = 60
export const BOTTOM_MAX_FRACTION = 0.7
export const BOTTOM_DEFAULT_HEIGHT = 220
export const BOTTOM_HEIGHT_STORAGE_KEY = 'termhub:bottomTerminalHeight'

export const SIDEBAR_MIN_WIDTH = 160
export const SIDEBAR_MAX_FRACTION = 0.4
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 240
export const RIGHT_PANEL_DEFAULT_WIDTH = 240
export const SIDEBAR_COLLAPSED_WIDTH = 28
export const LEFT_SIDEBAR_STORAGE_KEY = 'termhub:leftSidebarWidth'
export const RIGHT_PANEL_STORAGE_KEY = 'termhub:rightPanelWidth'
export const LEFT_SIDEBAR_COLLAPSED_KEY = 'termhub:leftSidebarCollapsed'
export const RIGHT_PANEL_COLLAPSED_KEY = 'termhub:rightPanelCollapsed'

// Clamp a dimension (height or width) to [min, available * maxFraction].
// max is never less than min so minimum always wins in degenerate situations.
export function clampDimension(
  raw: number,
  min: number,
  maxFraction: number,
  available: number,
): number {
  const max = Math.max(min, Math.floor(available * maxFraction))
  return Math.min(Math.max(Math.round(raw), min), max)
}

// Backwards-compat aliases — useSplitLayout and tests import clampHeight.
export const clampHeight = clampDimension
export const clampWidth = clampDimension

// Clamp a bottom-pane height against the space actually available, with the
// split's own min/max bound in.
//
// This has to run on load and on window resize, not just while dragging.
// .main-bottom is `flex: 0 0 auto`, so it cannot shrink: a height persisted in
// a tall window squeezes .main-top toward zero in a shorter one, and past the
// container it spills and gets clipped by `.main { overflow: hidden }` — which
// looks like the claude terminal being cut off by the shell selector.
export function clampBottomHeight(raw: number, available: number): number {
  return clampDimension(raw, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)
}

/**
 * Read the persisted bottom-terminal height from localStorage.
 * Falls back to `defaultHeight` when the stored value is absent or
 * not a finite positive number.
 */
export function readPersistedHeight(defaultHeight: number): number {
  try {
    const raw = localStorage.getItem(BOTTOM_HEIGHT_STORAGE_KEY)
    if (raw === null) return defaultHeight
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultHeight
  } catch {
    return defaultHeight
  }
}

/**
 * Read a persisted sidebar width from localStorage.
 * Falls back to `defaultWidth` when absent or invalid.
 */
export function readPersistedWidth(key: string, defaultWidth: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return defaultWidth
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultWidth
  } catch {
    return defaultWidth
  }
}

/** Read a persisted sidebar collapsed state from localStorage. Defaults to false. */
export function readPersistedCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}
