// Pure helpers for the resizable terminal split layout.

export const BOTTOM_MIN_HEIGHT = 60
export const BOTTOM_MAX_FRACTION = 0.7
export const BOTTOM_DEFAULT_HEIGHT = 220
export const BOTTOM_HEIGHT_STORAGE_KEY = 'termhub:bottomTerminalHeight'

/**
 * Clamp a raw bottom-terminal height to valid bounds.
 *
 * @param raw           Unclamped height in pixels (e.g. from a drag computation).
 * @param min           Minimum allowed height in pixels.
 * @param maxFraction   Maximum fraction of the available container height.
 * @param available     Total available content-area height in pixels.
 * @returns             Clamped height in pixels.
 */
export function clampHeight(
  raw: number,
  min: number,
  maxFraction: number,
  available: number,
): number {
  // Ensure max is never less than min so the minimum always wins in
  // degenerate situations (e.g. a zero-height container).
  const max = Math.max(min, Math.floor(available * maxFraction))
  return Math.min(Math.max(Math.round(raw), min), max)
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
