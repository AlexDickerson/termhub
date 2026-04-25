import { describe, it, expect } from 'vitest'
import { resizePty } from './pty-resize'

describe('resizePty', () => {
  function makeTarget() {
    const calls: Array<[number, number]> = []
    return {
      resize: (cols: number, rows: number) => {
        calls.push([cols, rows])
      },
      calls,
    }
  }

  it('forwards cleanly-typed cols/rows untouched', () => {
    const t = makeTarget()
    resizePty(t, 80, 24)
    expect(t.calls).toEqual([[80, 24]])
  })

  it('floors fractional values', () => {
    const t = makeTarget()
    resizePty(t, 80.7, 24.4)
    expect(t.calls).toEqual([[80, 24]])
  })

  it('clamps zero/negative to 1', () => {
    const t = makeTarget()
    resizePty(t, 0, -5)
    expect(t.calls).toEqual([[1, 1]])
  })

  it('drops NaN', () => {
    const t = makeTarget()
    resizePty(t, NaN, 24)
    expect(t.calls).toEqual([])
  })

  it('drops Infinity', () => {
    const t = makeTarget()
    resizePty(t, 80, Infinity)
    expect(t.calls).toEqual([])
  })

  it('swallows errors thrown by the target (PTY may have exited)', () => {
    const t = {
      resize: () => {
        throw new Error('pty exited')
      },
    }
    expect(() => resizePty(t, 80, 24)).not.toThrow()
  })
})
