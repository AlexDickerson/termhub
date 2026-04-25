// Pure helper for the Shift+Enter custom key handler wired into xterm.
// Extracted here so the logic can be unit-tested without a DOM / xterm instance.

/**
 * Given a keydown-like event descriptor, returns the byte sequence that
 * should be written to the PTY, or null if the event should be handled by
 * xterm's default pipeline.
 *
 * ESC+CR (\x1b\r) is the Alt+Enter sequence that Claude Code's readline-style
 * input parser maps to "insert literal newline" regardless of buffer content.
 *
 * The original bug was NOT the sequence — it was that the handler returned
 * `true`, which let xterm ALSO emit its own bytes for the keystroke (a bare
 * CR / Enter), so the PTY received \x1b\r\r.  With an empty buffer that extra
 * CR was a no-op submit; with text it submitted the buffer.  Returning `false`
 * suppresses xterm's default handling so only our \x1b\r reaches the PTY.
 */
export function shiftEnterSequence(ev: {
  type: string
  shiftKey: boolean
  key: string
}): string | null {
  if (ev.type === 'keydown' && ev.shiftKey && ev.key === 'Enter') {
    return '\x1b\r'
  }
  return null
}
