import { describe, it, expect } from 'vitest'
import {
  clampBottomHeight,
  clampHeight,
  clampDimension,
  readPersistedHeight,
  readPersistedWidth,
  BOTTOM_MIN_HEIGHT,
  BOTTOM_MAX_FRACTION,
  BOTTOM_DEFAULT_HEIGHT,
  BOTTOM_HEIGHT_STORAGE_KEY,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_FRACTION,
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_STORAGE_KEY,
  RIGHT_PANEL_STORAGE_KEY,
  RIGHT_PANEL_DEFAULT_WIDTH,
} from './layout'

describe('clampHeight', () => {
  const available = 800

  it('returns the raw value when within bounds', () => {
    expect(clampHeight(300, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)).toBe(300)
  })

  it('clamps to minimum when raw is too small', () => {
    expect(clampHeight(10, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)).toBe(BOTTOM_MIN_HEIGHT)
  })

  it('clamps to maximum fraction when raw exceeds it', () => {
    // 70% of 800 = 560
    expect(clampHeight(700, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)).toBe(560)
  })

  it('allows exactly the minimum', () => {
    expect(clampHeight(BOTTOM_MIN_HEIGHT, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)).toBe(
      BOTTOM_MIN_HEIGHT,
    )
  })

  it('allows exactly the maximum', () => {
    const max = Math.floor(available * BOTTOM_MAX_FRACTION)
    expect(clampHeight(max, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)).toBe(max)
  })

  it('rounds fractional pixel values', () => {
    expect(clampHeight(300.7, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, available)).toBe(301)
  })

  it('handles zero available height gracefully (max becomes 0 → clamped to min)', () => {
    // When available is 0 the max is also 0 which is less than min,
    // so the result should equal the minimum (Math.max wins).
    expect(clampHeight(100, BOTTOM_MIN_HEIGHT, BOTTOM_MAX_FRACTION, 0)).toBe(BOTTOM_MIN_HEIGHT)
  })
})

// Regression: the persisted height was applied unclamped on load, so a height
// saved in a tall window squeezed .main-top toward zero in a shorter one.
// .main-bottom is `flex: 0 0 auto` and cannot shrink, so past the container it
// spilled and got clipped — the claude terminal appeared cut off by the shell
// selector. Measured in a 600px container: persisted 500 left the top pane at
// 96px, and persisted 900 left it at 0 with 304px spilling past .main.
describe('clampBottomHeight', () => {
  it('leaves a height that already fits alone', () => {
    expect(clampBottomHeight(220, 600)).toBe(220)
  })

  it('caps an oversized persisted height at the max fraction', () => {
    // 70% of 600 — leaves 180px for the claude pane instead of 96px.
    expect(clampBottomHeight(500, 600)).toBe(420)
  })

  it('caps a height larger than the container, which would otherwise spill', () => {
    expect(clampBottomHeight(900, 600)).toBe(420)
    expect(clampBottomHeight(900, 600)).toBeLessThan(600)
  })

  it('raises a too-small height to the minimum', () => {
    expect(clampBottomHeight(5, 600)).toBe(BOTTOM_MIN_HEIGHT)
  })

  it('never returns more than the container height', () => {
    for (const available of [100, 300, 600, 1200, 2000]) {
      expect(clampBottomHeight(99999, available)).toBeLessThanOrEqual(available)
    }
  })

  it('always leaves room for the claude pane', () => {
    for (const available of [300, 600, 1200]) {
      expect(available - clampBottomHeight(99999, available)).toBeGreaterThan(0)
    }
  })

  it('falls back to the minimum in a degenerate zero-height container', () => {
    expect(clampBottomHeight(400, 0)).toBe(BOTTOM_MIN_HEIGHT)
  })
})

describe('readPersistedHeight', () => {
  // Simulate localStorage using a plain object since jsdom may or may not be
  // available in vitest's default node environment.  We patch globalThis.localStorage.
  const makeFakeStorage = (initial: Record<string, string> = {}) => {
    const store = { ...initial }
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    } as Storage
  }

  it('returns defaultHeight when nothing is stored', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: makeFakeStorage(), configurable: true })
    expect(readPersistedHeight(BOTTOM_DEFAULT_HEIGHT)).toBe(BOTTOM_DEFAULT_HEIGHT)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('returns the stored numeric value', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [BOTTOM_HEIGHT_STORAGE_KEY]: '350' }),
      configurable: true,
    })
    expect(readPersistedHeight(BOTTOM_DEFAULT_HEIGHT)).toBe(350)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('falls back to default when the stored value is NaN', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [BOTTOM_HEIGHT_STORAGE_KEY]: 'banana' }),
      configurable: true,
    })
    expect(readPersistedHeight(BOTTOM_DEFAULT_HEIGHT)).toBe(BOTTOM_DEFAULT_HEIGHT)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('falls back to default when the stored value is zero', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [BOTTOM_HEIGHT_STORAGE_KEY]: '0' }),
      configurable: true,
    })
    expect(readPersistedHeight(BOTTOM_DEFAULT_HEIGHT)).toBe(BOTTOM_DEFAULT_HEIGHT)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('falls back to default when localStorage throws', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => { throw new Error('quota') } } as unknown as Storage,
      configurable: true,
    })
    expect(readPersistedHeight(BOTTOM_DEFAULT_HEIGHT)).toBe(BOTTOM_DEFAULT_HEIGHT)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })
})

describe('clampDimension (sidebar widths)', () => {
  const available = 1200

  it('clamps to SIDEBAR_MIN_WIDTH when raw is too small', () => {
    expect(clampDimension(50, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available)).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps to 40% of available when raw exceeds it', () => {
    // 40% of 1200 = 480
    expect(clampDimension(600, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available)).toBe(480)
  })

  it('allows a value within bounds', () => {
    expect(clampDimension(300, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available)).toBe(300)
  })

  it('allows exactly the minimum', () => {
    expect(clampDimension(SIDEBAR_MIN_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available)).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('allows exactly the maximum', () => {
    const max = Math.floor(available * SIDEBAR_MAX_FRACTION)
    expect(clampDimension(max, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available)).toBe(max)
  })

  it('clampHeight alias still works', () => {
    expect(clampHeight(300, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available)).toBe(
      clampDimension(300, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_FRACTION, available),
    )
  })
})

describe('readPersistedWidth', () => {
  const makeFakeStorage = (initial: Record<string, string> = {}) => {
    const store = { ...initial }
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    } as Storage
  }

  it('returns defaultWidth when nothing is stored', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', { value: makeFakeStorage(), configurable: true })
    expect(readPersistedWidth(LEFT_SIDEBAR_STORAGE_KEY, LEFT_SIDEBAR_DEFAULT_WIDTH)).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('returns the stored numeric value for left sidebar key', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [LEFT_SIDEBAR_STORAGE_KEY]: '320' }),
      configurable: true,
    })
    expect(readPersistedWidth(LEFT_SIDEBAR_STORAGE_KEY, LEFT_SIDEBAR_DEFAULT_WIDTH)).toBe(320)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('returns the stored numeric value for right panel key', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [RIGHT_PANEL_STORAGE_KEY]: '200' }),
      configurable: true,
    })
    expect(readPersistedWidth(RIGHT_PANEL_STORAGE_KEY, RIGHT_PANEL_DEFAULT_WIDTH)).toBe(200)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('falls back to default for NaN stored value', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [LEFT_SIDEBAR_STORAGE_KEY]: 'notanumber' }),
      configurable: true,
    })
    expect(readPersistedWidth(LEFT_SIDEBAR_STORAGE_KEY, LEFT_SIDEBAR_DEFAULT_WIDTH)).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('falls back to default for zero stored value', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeFakeStorage({ [LEFT_SIDEBAR_STORAGE_KEY]: '0' }),
      configurable: true,
    })
    expect(readPersistedWidth(LEFT_SIDEBAR_STORAGE_KEY, LEFT_SIDEBAR_DEFAULT_WIDTH)).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })

  it('falls back to default when localStorage throws', () => {
    const orig = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => { throw new Error('quota') } } as unknown as Storage,
      configurable: true,
    })
    expect(readPersistedWidth(LEFT_SIDEBAR_STORAGE_KEY, LEFT_SIDEBAR_DEFAULT_WIDTH)).toBe(LEFT_SIDEBAR_DEFAULT_WIDTH)
    Object.defineProperty(globalThis, 'localStorage', { value: orig, configurable: true })
  })
})
