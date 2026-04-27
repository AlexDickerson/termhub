// IPC handlers and poll loop for per-session token usage tracking.
// Reads Claude Code's JSONL transcript files and emits 'session:usage'
// events to the renderer whenever usage data changes.

import * as fs from 'node:fs'
import { ipcMain, BrowserWindow } from 'electron'
import {
  getSession,
  getAllSessions,
  onSessionCreatedHook,
  onSessionClosedHook,
} from './session-manager'
import {
  resolveJsonlPath,
  readJsonlIncremental,
  buildSummary,
  makeEmptyParseState,
  type UsageParseState,
} from './usage-fetch'
import type { SessionUsage } from '../src/types'

// Per-session incremental parse state, keyed by session id.
const parseStates = new Map<string, UsageParseState>()
// Cached mtime per session — skip reads when the file hasn't changed.
const lastMtimes = new Map<string, number>()
// Cached summaries keyed by session id.
const cachedSummaries = new Map<string, SessionUsage>()
// Sessions for which we've successfully found and read the JSONL file at
// least once. Used to distinguish "expected missing" from "unexpectedly gone".
const hadFile = new Set<string>()

// Per-session poll timer handles, keyed by session id.
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()

let mainWindow: BrowserWindow | null = null

export function setMainWindowForUsage(window: BrowserWindow | null): void {
  mainWindow = window
}

function emitUsageChanged(sessionId: string, usage: SessionUsage): void {
  mainWindow?.webContents.send('session:usage', { id: sessionId, usage })
}

async function fetchAndCacheUsage(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  if (!session) return

  const jsonlPath = resolveJsonlPath(session.cwd, session.id)

  // Mtime check — skip parse if nothing has changed since last poll.
  let mtime: number
  try {
    mtime = fs.statSync(jsonlPath).mtimeMs
  } catch {
    if (hadFile.has(sessionId)) {
      console.warn(
        `[termhub:usage] session ${sessionId.slice(0, 8)}: JSONL gone — expected at ${jsonlPath}`,
      )
    }
    return
  }

  if (lastMtimes.get(sessionId) === mtime) return

  const currentState = parseStates.get(sessionId) ?? makeEmptyParseState()

  let newState: UsageParseState | null
  try {
    newState = readJsonlIncremental(jsonlPath, currentState)
  } catch (err) {
    console.error(`[termhub:usage] session ${sessionId.slice(0, 8)}: parse error at ${jsonlPath}:`, err)
    return
  }

  if (!newState) return

  hadFile.add(sessionId)
  parseStates.set(sessionId, newState)
  lastMtimes.set(sessionId, mtime)

  const summary = buildSummary(newState, jsonlPath)

  // Only emit if the summary changed (shallow-compare by JSON).
  const prev = cachedSummaries.get(sessionId)
  if (prev && JSON.stringify(prev) === JSON.stringify(summary)) return

  const isFirstParse = !prev
  cachedSummaries.set(sessionId, summary)

  if (isFirstParse && summary.turns > 0) {
    console.info(
      `[termhub:usage] session ${sessionId.slice(0, 8)}: first parse —`,
      `turns=${summary.turns}`,
      `output=${summary.cumulative.outputTokens}`,
      `cache_hit=${(summary.cacheHitRate * 100).toFixed(0)}%`,
    )
  }

  emitUsageChanged(sessionId, summary)
}

/** Start the 5-second poll loop for a session. Idempotent. */
function startPollLoop(sessionId: string): void {
  if (pollTimers.has(sessionId)) return
  void fetchAndCacheUsage(sessionId)
  const timer = setInterval(() => {
    const session = getSession(sessionId)
    if (!session) {
      stopUsagePollLoop(sessionId)
      return
    }
    void fetchAndCacheUsage(sessionId)
  }, 5_000)
  pollTimers.set(sessionId, timer)
}

/** Stop the poll loop and clean up state for a session. */
export function stopUsagePollLoop(sessionId: string): void {
  const timer = pollTimers.get(sessionId)
  if (timer !== undefined) {
    clearInterval(timer)
    pollTimers.delete(sessionId)
  }
  parseStates.delete(sessionId)
  lastMtimes.delete(sessionId)
  cachedSummaries.delete(sessionId)
  hadFile.delete(sessionId)
}

export function registerUsageHandlers(): void {
  // Renderer requests current usage for a session (on-demand).
  ipcMain.handle('session:usage:get', async (_event, payload: { id: string }) => {
    const session = getSession(payload.id)
    if (!session) return null

    const cached = cachedSummaries.get(payload.id)
    if (cached) return cached

    // Not cached yet — do an immediate fetch for this IPC call.
    await fetchAndCacheUsage(payload.id)
    return cachedSummaries.get(payload.id) ?? null
  })

  // Start poll loops for sessions already open when handlers are registered.
  for (const session of getAllSessions()) {
    startPollLoop(session.id)
  }

  // Wire into session lifecycle.
  onSessionCreatedHook((sessionId) => {
    startPollLoop(sessionId)
  })

  onSessionClosedHook((sessionId) => {
    stopUsagePollLoop(sessionId)
  })
}
