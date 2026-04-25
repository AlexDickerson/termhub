import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Advisory status type mirroring src/types.ts SessionStatus.
export type SessionStatus = 'working' | 'awaiting' | 'idle' | 'failed'

// Map Claude Code's session `status` field values to termhub's SessionStatus.
// Values from Claude Code:
//   idle    → session at the input prompt, ready for user
//   busy    → Claude is generating / running tools
//   waiting → Claude has paused to ask the user something (permission prompt etc.)
// Unknown/missing values fall back to 'working' (optimistic — assume busy
// rather than showing a misleading idle state).
export function mapJsonlStatus(raw: string): SessionStatus {
  switch (raw) {
    case 'idle': return 'idle'
    case 'busy': return 'working'
    case 'waiting': return 'awaiting'
    default: return 'working'
  }
}

// Parse the `status` field from a Claude Code session file.
// The file is a single JSON object written/overwritten in-place by Claude Code
// at ~/.claude/sessions/<pid>.json. Returns undefined if the content is
// unparseable or has no status field.
export function parseSessionStatus(content: string): string | undefined {
  try {
    const rec = JSON.parse(content) as Record<string, unknown>
    if (typeof rec.status === 'string' && rec.status.length > 0) return rec.status
  } catch {
    // malformed JSON — ignore
  }
  return undefined
}

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')

// Find the ~/.claude/sessions/<pid>.json file whose `sessionId` field matches
// the given session ID. Returns the full path or null if not found.
//
// termhub passes --session-id <id> to every claude invocation, so the session
// file written by Claude Code will always have sessionId === termhub's own id.
// This makes the lookup exact and race-free.
export function findSessionFileBySessionId(sessionId: string): string | null {
  let files: string[]
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'))
  } catch {
    return null
  }

  for (const file of files) {
    const filePath = path.join(SESSIONS_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const rec = JSON.parse(content) as Record<string, unknown>
      if (rec.sessionId === sessionId) return filePath
    } catch {
      // unparseable or gone — skip
    }
  }
  return null
}

export type WatcherHandle = {
  stop: () => void
}

// Watch the status of a Claude Code session by looking up its runtime file at
// ~/.claude/sessions/<pid>.json. The file is discovered by matching its
// `sessionId` field against the termhub session id, which termhub passes as
// --session-id to every claude invocation — making this lookup exact and
// race-free with no cwd scanning or time-window heuristics.
//
// The file is a single JSON object rewritten in-place on every status change,
// so each poll reads the whole file.
//
// Before the file appears (Claude Code creates it shortly after startup),
// status stays at 'working' — we optimistically assume busy until the file
// says otherwise.
export function watchSessionStatus(
  sessionId: string,
  onStatus: (status: SessionStatus) => void,
): WatcherHandle {
  let stopped = false
  let watchedPath: string | null = null
  let lastEmitted: SessionStatus | undefined

  function poll() {
    if (stopped) return

    // Discover the session file if not yet found.
    if (!watchedPath) {
      const filePath = findSessionFileBySessionId(sessionId)
      if (filePath) {
        watchedPath = filePath
        console.log('[termhub:status] found session file (id=%s) at %s', sessionId.slice(0, 8), filePath)
      }
    }

    if (!watchedPath) return

    // Read the current status from the file (whole file — single JSON object).
    try {
      const content = fs.readFileSync(watchedPath, 'utf8')
      const raw = parseSessionStatus(content)
      if (raw === undefined) return
      const next = mapJsonlStatus(raw)
      if (next !== lastEmitted) {
        lastEmitted = next
        onStatus(next)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[termhub:status] failed to read session file', watchedPath, err)
      }
      // File gone — reset so we re-discover on the next tick.
      watchedPath = null
    }
  }

  // Poll every 500 ms. setInterval + readFileSync is straightforward and avoids
  // the unreliable fs.watch kernel events on Windows NTFS paths.
  const timer = setInterval(poll, 500)
  poll() // immediate first read

  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }
}
