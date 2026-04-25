import { describe, it, expect } from 'vitest'
import {
  clampHeight,
  readPersistedHeight,
  BOTTOM_MIN_HEIGHT,
  BOTTOM_MAX_FRACTION,
  BOTTOM_DEFAULT_HEIGHT,
  BOTTOM_HEIGHT_STORAGE_KEY,
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
