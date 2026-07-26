import { describe, it, expect } from 'vitest'
import {
  addToast,
  dismissToast,
  describeError,
  autoDismissMs,
  MAX_TOASTS,
  type Toast,
} from './toast-state'

const t = (id: number, message = `m${id}`): Toast => ({ id, kind: 'error', message })

describe('addToast', () => {
  it('appends to the end', () => {
    expect(addToast([t(1)], t(2)).map((x) => x.id)).toEqual([1, 2])
  })

  it('does not mutate the input', () => {
    const initial = [t(1)]
    addToast(initial, t(2))
    expect(initial).toHaveLength(1)
  })

  it('drops the oldest past MAX_TOASTS so the stack cannot cover the app', () => {
    let list: Toast[] = []
    for (let i = 1; i <= MAX_TOASTS + 3; i++) list = addToast(list, t(i))

    expect(list).toHaveLength(MAX_TOASTS)
    // The three oldest were evicted; the newest is still last.
    expect(list[0].id).toBe(4)
    expect(list[list.length - 1].id).toBe(MAX_TOASTS + 3)
  })
})

describe('dismissToast', () => {
  it('removes only the matching id', () => {
    expect(dismissToast([t(1), t(2), t(3)], 2).map((x) => x.id)).toEqual([1, 3])
  })

  it('is a no-op for an unknown id', () => {
    expect(dismissToast([t(1)], 99).map((x) => x.id)).toEqual([1])
  })

  it('handles dismissing the same id twice', () => {
    const once = dismissToast([t(1), t(2)], 1)
    expect(dismissToast(once, 1).map((x) => x.id)).toEqual([2])
  })
})

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  it('passes a string through', () => {
    expect(describeError('plain failure')).toBe('plain failure')
  })

  it('serialises a plain object — IPC can reject with a non-Error', () => {
    expect(describeError({ code: 'ENOENT' })).toBe('{"code":"ENOENT"}')
  })

  it('falls back to String() on a value JSON cannot handle', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(describeError(circular)).toBe('[object Object]')
  })

  it('handles null and undefined without throwing', () => {
    expect(describeError(null)).toBe('null')
    expect(describeError(undefined)).toBe(undefined as unknown as string)
  })
})

describe('autoDismissMs', () => {
  it('never auto-dismisses errors — the user may have been away', () => {
    expect(autoDismissMs('error')).toBeNull()
  })

  it('auto-dismisses info toasts', () => {
    expect(autoDismissMs('info')).toBeGreaterThan(0)
  })
})
