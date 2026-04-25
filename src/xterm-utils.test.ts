import { describe, it, expect } from 'vitest'
import { estimateInitialDims, shouldSnapToBottom } from './xterm-utils'

describe('estimateInitialDims', () => {
  it('subtracts container padding and divides by approximate cell size', () => {
    // 800x400 container — (800-12)/8.5 = 92.7 → 92, (400-12)/17 = 22.8 → 22
    expect(estimateInitialDims({ width: 800, height: 400 }, 5)).toEqual({
      cols: 92,
      rows: 22,
    })
  })

  it('clamps cols to a minimum of 20', () => {
    // Tiny container — would yield 1 col without the floor.
    expect(estimateInitialDims({ width: 10, height: 200 }, 5).cols).toBe(20)
  })

  it('clamps rows to the provided minRows', () => {
    expect(estimateInitialDims({ width: 800, height: 10 }, 5).rows).toBe(5)
    expect(estimateInitialDims({ width: 800, height: 10 }, 3).rows).toBe(3)
  })

  it('floors fractional dimensions', () => {
    // (200-12)/8.5 = 22.117 → 22, not 23.
    expect(estimateInitialDims({ width: 200, height: 200 }, 5).cols).toBe(22)
  })

  it('honours minRows independently of width', () => {
    // Wide but short — width yields a high cols, height clamps to minRows.
    const { cols, rows } = estimateInitialDims({ width: 2000, height: 5 }, 7)
    expect(cols).toBeGreaterThan(20)
    expect(rows).toBe(7)
  })
})

describe('shouldSnapToBottom', () => {
  // Snap-to-bottom guards: only fire when scrolling DOWNWARD and we are
  // within the last line of ybase but haven't reached it.
  it('snaps when downward motion lands within 1 line of ybase', () => {
    // ybase=100, prev=98, new=99 → newYdisp >= 99, < 100, downward → snap
    expect(shouldSnapToBottom(98, 99, 100)).toBe(true)
  })

  it('does not snap when at ybase exactly (already at bottom)', () => {
    // newYdisp === ybase — we're already at the bottom; no snap needed.
    expect(shouldSnapToBottom(99, 100, 100)).toBe(false)
  })

  it('does not snap on upward motion', () => {
    // User scrolling up (newYdisp < prevYdisp) — leave them alone.
    expect(shouldSnapToBottom(99, 98, 100)).toBe(false)
  })

  it('does not snap if more than 1 line away from ybase', () => {
    // newYdisp=50, ybase=100 — far from bottom; don't snap.
    expect(shouldSnapToBottom(40, 50, 100)).toBe(false)
  })

  it('does not snap when stationary', () => {
    expect(shouldSnapToBottom(99, 99, 100)).toBe(false)
  })

  it('snaps for ybase=0 corner case (no scrollback)', () => {
    // ybase=0 means there's no scrollback yet. The guard newYdisp >= ybase-1
    // becomes newYdisp >= -1, which is always true; downward motion + < 0 is
    // impossible, so we never snap. Documenting the safe behavior.
    expect(shouldSnapToBottom(0, 0, 0)).toBe(false)
  })
})
