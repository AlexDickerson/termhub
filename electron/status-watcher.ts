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

// Encode a filesystem path the same way Claude Code does when building the
// ~/.claude/projects/<encoded-cwd>/ directory name. Each backslash, forward
// slash, colon, or dot is replaced with a dash.
export function encodeProjectPath(cwdArg: string): string {
  return cwdArg.replace(/[\\/:\.]/g, '-')
}

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')

// Find the session ID of the most recently active Claude Code session in the
// given cwd. Claude Code writes one JSONL file per session under
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl, appending records as the
// session progresses. The most recently modified file is the active session.
// Returns the session ID (UUID string) or null if the directory is absent or empty.
export function findActiveSessionId(cwd: string): string | null {
  const dir = path.join(PROJECTS_DIR, encodeProjectPath(cwd))
  let files: string[]
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  if (files.length === 0) return null

  let best: { stem: string; mtime: number } | null = null
  for (const file of files) {
    try {
      const stat = fs.statSync(path.join(dir, file))
      if (!best || stat.mtimeMs > best.mtime) {
        best = { stem: path.basename(file, '.jsonl'), mtime: stat.mtimeMs }
      }
    } catch {
      // file gone between readdir and stat — skip
    }
  }
  return best?.stem ?? null
}

// Find the ~/.claude/sessions/<pid>.json file whose `sessionId` field matches
// the given session ID. Returns the full path or null if not found.
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

// Watch the status of a Claude Code session by:
//   1. Finding the active session ID via ~/.claude/projects/<encoded-cwd>/*.jsonl
//      (the most recently modified file is the active session; its filename is
//      the session ID).
//   2. Finding the corresponding ~/.claude/sessions/<pid>.json by sessionId match.
//   3. Polling that file every 500 ms and emitting mapped status on change.
//
// Before the session file appears (Claude Code creates it shortly after startup),
// status stays at 'working' — we optimistically assume busy until the file says
// otherwise.
//
// If the file disappears (session ended / pid reused), the watcher re-discovers
// the active session on the next tick.
export function watchSessionStatus(
  cwd: string,
  onStatus: (status: SessionStatus) => void,
): WatcherHandle {
  let stopped = false
  let watchedPath: string | null = null
  let watchedSessionId: string | null = null
  let lastEmitted: SessionStatus | undefined

  function poll() {
    if (stopped) return

    // Discover (or re-discover) the session file if not yet found.
    if (!watchedPath) {
      const sessionId = findActiveSessionId(cwd)
      if (sessionId && sessionId !== watchedSessionId) {
        const filePath = findSessionFileBySessionId(sessionId)
        if (filePath) {
          watchedPath = filePath
          watchedSessionId = sessionId
          console.log(
            '[termhub:status] found session file (id=%s) at %s',
            sessionId.slice(0, 8),
            filePath,
          )
        }
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
