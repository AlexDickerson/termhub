// Validate cols/rows from the renderer and forward to a PTY. Both the
// primary (claude) and the secondary (shell) PTYs receive resize requests
// on every UI resize / divider drag, so this gets called frequently.
// Non-finite values (NaN, Infinity) are silently dropped; resize errors
// from an already-exited PTY are swallowed because they race against
// shutdown.
//
// Duck-typed on `resize` so unit tests can pass a plain object instead
// of a real PTY.
type PtyResizeTarget = { resize: (cols: number, rows: number) => void }

export function resizePty(
  target: PtyResizeTarget,
  cols: number,
  rows: number,
): void {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
  const c = Math.max(1, Math.floor(cols))
  const r = Math.max(1, Math.floor(rows))
  try {
    target.resize(c, r)
  } catch {
    // pty may have exited between resize requests
  }
}
