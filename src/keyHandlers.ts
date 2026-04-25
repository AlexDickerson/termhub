// Pure helper for the Shift+Enter custom key handler wired into xterm.
// Extracted here so the logic can be unit-tested without a DOM / xterm instance.

/**
 * Given a keydown-like event descriptor, returns the byte sequence that
 * should be written to the PTY, or null if the event should be handled by
 * xterm's default pipeline.
 *
 * The modifyOtherKeys CSI form (\x1b[27;2;13~) is the sequence Claude Code's
 * input parser accepts as "insert newline mid-input" for Shift+Enter.
 * The older \x1b\r (ESC+CR) form only worked when the input buffer was empty.
 */
export function shiftEnterSequence(ev: {
  type: string
  shiftKey: boolean
  key: string
}): string | null {
  if (ev.type === 'keydown' && ev.shiftKey && ev.key === 'Enter') {
    return '\x1b[27;2;13~'
  }
  return null
}
