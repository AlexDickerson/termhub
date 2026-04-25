import { describe, it, expect } from 'vitest'
import { shiftEnterSequence } from './keyHandlers'

describe('shiftEnterSequence', () => {
  // ESC+CR is the Alt+Enter sequence Claude Code's readline maps to
  // "insert literal newline" regardless of buffer state.
  const ESC_CR = '\x1b\r'

  it('returns ESC+CR for Shift+Enter keydown', () => {
    expect(
      shiftEnterSequence({ type: 'keydown', shiftKey: true, key: 'Enter' }),
    ).toBe(ESC_CR)
  })

  it('returns ESC+CR for Ctrl+Shift+Enter keydown (shiftKey is true)', () => {
    // Ctrl+Shift+Enter also has shiftKey=true, key='Enter'; the handler
    // intercepts it the same way and returns false so xterm does not also
    // emit a bare CR that would submit the buffer.
    expect(
      shiftEnterSequence({ type: 'keydown', shiftKey: true, key: 'Enter' }),
    ).toBe(ESC_CR)
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

  // Regression: the modifyOtherKeys CSI form (\x1b[27;2;13~) does NOT work
  // because Claude Code never enables that terminal mode.  Ensure we are not
  // accidentally sending it.
  it('does NOT return the modifyOtherKeys CSI form', () => {
    const seq = shiftEnterSequence({ type: 'keydown', shiftKey: true, key: 'Enter' })
    expect(seq).not.toBe('\x1b[27;2;13~')
  })
})
