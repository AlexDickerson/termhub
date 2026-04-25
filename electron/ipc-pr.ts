// IPC handlers and poll loop for per-session PR tracking.
// Fetches PR data via the `gh` CLI and emits 'session:pr' events to the
// renderer whenever the PR state changes.

import { ipcMain, BrowserWindow } from 'electron'
import {
  getSession,
  getAllSessions,
  onSessionCreatedHook,
  onSessionClosedHook,
} from './session-manager'
import {
  buildCacheKey,
  fetchGhPrList,
  getGitBranch,
  runGhPrMerge,
} from './pr-fetch'
import type { SessionPr } from '../src/types'

// In-memory PR cache keyed by `${cwd}::${branch}`.
const prCache = new Map<string, SessionPr | null>()

// Per-session poll timer handles. Keyed by session id.
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()

let mainWindow: BrowserWindow | null = null

export function setMainWindowForPr(window: BrowserWindow | null): void {
  mainWindow = window
}

function emitPrChanged(sessionId: string, pr: SessionPr | null): void {
  mainWindow?.webContents.send('session:pr', { id: sessionId, pr })
}

/**
 * Fetch the PR for the active session, update the cache, and emit an event
 * if the value changed.
 */
async function fetchAndCachePr(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) return

  let branch: string
  try {
    branch = await getGitBranch(session.cwd)
  } catch (err) {
    console.warn(`[termhub:pr] session ${sessionId.slice(0, 8)}: cannot determine branch:`, err instanceof Error ? err.message : String(err))
    return
  }

  const cacheKey = buildCacheKey(session.cwd, branch)
  console.info(`[termhub:pr] fetching PR for session ${sessionId.slice(0, 8)} (branch=${branch})`)

  let prs: SessionPr[]
  try {
    prs = await fetchGhPrList(session.cwd, branch)
  } catch (err) {
    console.warn(`[termhub:pr] session ${sessionId.slice(0, 8)}: gh pr list failed:`, err instanceof Error ? err.message : String(err))
    return
  }

  const pr = prs.length > 0 ? prs[0] : null
  const previous = prCache.get(cacheKey)

  // Only emit and log if the value changed (shallow compare by JSON).
  const changed =
    previous === undefined ||
    JSON.stringify(previous) !== JSON.stringify(pr)

  if (changed) {
    prCache.set(cacheKey, pr)
    console.info(
      `[termhub:pr] session ${sessionId.slice(0, 8)}: PR state changed →`,
      pr ? `#${pr.number} ${pr.state} ci=${pr.ciState}` : 'no PR',
    )
    emitPrChanged(sessionId, pr)
  }
}

/** Start the 30-second poll loop for a session. Idempotent. */
function startPollLoop(sessionId: string): void {
  if (pollTimers.has(sessionId)) return
  // Kick off an immediate fetch, then schedule a recurring poll.
  void fetchAndCachePr(sessionId)
  const timer = setInterval(() => {
    const session = getSession(sessionId)
    if (!session) {
      stopPollLoop(sessionId)
      return
    }
    void fetchAndCachePr(sessionId)
  }, 30_000)
  pollTimers.set(sessionId, timer)
}

/** Stop the poll loop for a session (called when session closes). */
export function stopPollLoop(sessionId: string): void {
  const timer = pollTimers.get(sessionId)
  if (timer !== undefined) {
    clearInterval(timer)
    pollTimers.delete(sessionId)
  }
}

export function registerPrHandlers(): void {
  // Renderer requests the current PR for a session (on-demand refresh).
  ipcMain.handle('session:pr:get', async (_event, payload: { id: string }) => {
    const session = getSession(payload.id)
    if (!session) return null

    // Try to return from cache first; if not cached, fetch now.
    let branch: string
    try {
      branch = await getGitBranch(session.cwd)
    } catch {
      return null
    }

    const cacheKey = buildCacheKey(session.cwd, branch)
    if (prCache.has(cacheKey)) {
      return prCache.get(cacheKey) ?? null
    }

    // Not in cache — fetch synchronously for this IPC call.
    await fetchAndCachePr(payload.id)
    return prCache.get(cacheKey) ?? null
  })

  // Renderer triggers a squash merge.
  ipcMain.handle(
    'session:pr:merge',
    async (_event, payload: { id: string; prNumber: number }) => {
      const session = getSession(payload.id)
      if (!session) throw new Error(`Session not found: ${payload.id}`)

      console.info(
        `[termhub:pr] merge initiated — session ${payload.id.slice(0, 8)} PR #${payload.prNumber}`,
      )
      try {
        await runGhPrMerge(session.cwd, payload.prNumber)
        console.info(
          `[termhub:pr] merge success — session ${payload.id.slice(0, 8)} PR #${payload.prNumber}`,
        )
      } catch (err) {
        console.error(
          `[termhub:pr] merge failed — session ${payload.id.slice(0, 8)} PR #${payload.prNumber}:`,
          err,
        )
        throw err
      }

      // Refresh PR state after merge (it will now show as merged/closed).
      await fetchAndCachePr(payload.id)
    },
  )

  // Start poll loops for all sessions that are currently open when handlers
  // are first registered (covers resumed sessions).
  for (const session of getAllSessions()) {
    startPollLoop(session.id)
  }

  // Wire into session lifecycle so poll loops start/stop automatically.
  onSessionCreatedHook((sessionId) => {
    startPollLoop(sessionId)
  })

  onSessionClosedHook((sessionId) => {
    // Stop the poll timer; this is the primary goal. Cache entries for this
    // session's branch are stale but small — they'll be overwritten on the
    // next fetch if the cwd gets reused. We can't prune by cwd here because
    // the session is already removed from the sessions map by the time this
    // callback fires.
    stopPollLoop(sessionId)
  })
}
