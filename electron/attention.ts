// Attention signalling: OS notification + dock/taskbar badge when a session
// starts needing the user.
//
// The point of termhub is running many sessions at once, which means the user
// is usually looking at one of them — or at something else entirely. Without
// this, "which worker is blocked on a permission prompt?" is only answerable
// by watching the sidebar dots, so a session can sit parked for as long as it
// takes the user to glance back.
//
// The decision logic here is pure and unit-tested; the electron calls live in
// applyAttention / notifyAttention at the bottom.

import { app, BrowserWindow, Notification } from 'electron'
import type { SessionStatus } from '../src/types'

// 'awaiting' — claude has paused to ask something; nothing progresses until
//              the user answers.
// 'failed'   — the process died; the work is stopped.
// 'working' and 'idle' both mean "no human needed right now". idle looks
// like it might warrant a ping, but a session that finishes and returns to
// the prompt is the normal end state for every worker — notifying on it
// would fire constantly and train the user to ignore the notifications.
export function needsAttention(status: SessionStatus): boolean {
  return status === 'awaiting' || status === 'failed'
}

export function countNeedingAttention(statuses: Iterable<SessionStatus>): number {
  let n = 0
  for (const s of statuses) if (needsAttention(s)) n++
  return n
}

// Fire only on the transition INTO a needing-attention state, and only when
// the window isn't focused. If the user is already looking at termhub, the
// sidebar dot is the signal — an OS notification on top of it is noise.
export function shouldNotify(opts: {
  previous: SessionStatus
  next: SessionStatus
  windowFocused: boolean
}): boolean {
  if (!needsAttention(opts.next)) return false
  if (needsAttention(opts.previous)) return false
  return !opts.windowFocused
}

export function notificationText(opts: {
  name?: string
  cwd: string
  status: SessionStatus
}): { title: string; body: string } {
  const label = opts.name?.trim() || opts.cwd
  return opts.status === 'failed'
    ? { title: 'termhub — session failed', body: `${label} exited unexpectedly.` }
    : { title: 'termhub — waiting on you', body: `${label} is asking for input.` }
}

// ── electron side ─────────────────────────────────────────────────────────

// Reflect the count of sessions needing attention on the dock (macOS/Linux)
// and flash the taskbar button (Windows, which has no badge without shipping
// an overlay image). Safe to call on every status change.
export function applyAttentionBadge(count: number, window: BrowserWindow | null): void {
  try {
    if (process.platform === 'win32') {
      // flashFrame(true) is sticky until the window is focused, so re-calling
      // it while already flashing is a no-op rather than a re-flash.
      window?.flashFrame(count > 0)
    } else if (typeof app.setBadgeCount === 'function') {
      app.setBadgeCount(count)
    }
  } catch (err) {
    console.warn('[termhub:attention] failed to update badge', err)
  }
}

// Post an OS notification. Clicking it raises termhub and asks the renderer
// to select the session, so the notification is actionable rather than
// merely informative.
export function notifyAttention(opts: {
  sessionId: string
  name?: string
  cwd: string
  status: SessionStatus
  window: BrowserWindow | null
}): void {
  if (!Notification.isSupported()) return

  const { title, body } = notificationText(opts)
  try {
    const notification = new Notification({ title, body, silent: false })
    notification.on('click', () => {
      const w = opts.window
      if (!w || w.isDestroyed()) return
      if (w.isMinimized()) w.restore()
      w.focus()
      w.webContents.send('session:focusRequest', { id: opts.sessionId })
    })
    notification.show()
    console.log(
      `[termhub:attention] notified for session ${opts.sessionId.slice(0, 8)} (status=${opts.status})`,
    )
  } catch (err) {
    console.error('[termhub:attention] failed to post notification', err)
  }
}
