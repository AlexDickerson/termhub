import { describe, it, expect } from 'vitest'
import { shiftEnterSequence } from './keyHandlers'

describe('shiftEnterSequence', () => {
  const MODIFIER_KEYS_CSI = '\x1b[27;2;13~'

  it('returns the modifyOtherKeys CSI sequence for Shift+Enter keydown', () => {
    expect(
      shiftEnterSequence({ type: 'keydown', shiftKey: true, key: 'Enter' }),
    ).toBe(MODIFIER_KEYS_CSI)
  })

  it('returns null for a plain Enter (no Shift) keydown', () => {
    expect(
      shiftEnterSequence({ type: 'keydown', shiftKey: false, key: 'Enter' }),
    ).toBeNull()
  })

  it('returns null for Shift+Enter on keyup (not keydown)', () => {
    expect(
      shiftEnterSequence({ type: 'keyup', shiftKey: true, key: 'Enter' }),
    ).toBeNull()
  })

  it('returns null for Shift+Enter on keypress event type', () => {
    expect(
      shiftEnterSequence({ type: 'keypress', shiftKey: true, key: 'Enter' }),
    ).toBeNull()
  })

  it('returns null for Shift held with a non-Enter key', () => {
    expect(
      shiftEnterSequence({ type: 'keydown', shiftKey: true, key: 'a' }),
    ).toBeNull()
  })

  it('returns null for an unrelated key with no modifiers', () => {
    expect(
      shiftEnterSequence({ type: 'keydown', shiftKey: false, key: 'Tab' }),
    ).toBeNull()
  })

  // Regression: the old sequence was \x1b\r (ESC+CR).  Verify the new
  // sequence is different so the bug cannot silently regress.
  it('does NOT return the old ESC+CR sequence', () => {
    const seq = shiftEnterSequence({ type: 'keydown', shiftKey: true, key: 'Enter' })
    expect(seq).not.toBe('\x1b\r')
  })
})
