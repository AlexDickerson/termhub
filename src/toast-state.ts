// Toast state, kept as pure reducers so the queue behaviour is testable
// without mounting React.
//
// Before this, ~30 catch sites in the renderer logged to console and nothing
// else: a failed spawn, a failed PR merge, or a failed shell respawn simply
// did nothing visible. The one exception was a raw alert() in newSession,
// which blocks the whole window.

export type ToastKind = 'error' | 'info'

export type Toast = {
  id: number
  kind: ToastKind
  message: string
  // Optional second line — usually the underlying error text, kept separate
  // so the headline stays scannable.
  detail?: string
}

// Errors stack up when several sessions fail at once; past this we drop the
// oldest so the stack can't cover the app.
export const MAX_TOASTS = 4

export function addToast(
  current: readonly Toast[],
  toast: Toast,
): Toast[] {
  const next = [...current, toast]
  return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
}

export function dismissToast(current: readonly Toast[], id: number): Toast[] {
  return current.filter((t) => t.id !== id)
}

// Normalise whatever landed in a catch block into a displayable detail line.
// Errors keep their message; everything else is stringified, since a rejected
// IPC call can reject with a non-Error.
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// Auto-dismiss delay. Errors linger — the user may have been away when the
// session failed — while info messages clear quickly.
export function autoDismissMs(kind: ToastKind): number | null {
  return kind === 'error' ? null : 4000
}
