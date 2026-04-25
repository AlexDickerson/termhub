import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Advisory status type mirroring src/types.ts SessionStatus.
export type SessionStatus = 'working' | 'awaiting' | 'idle' | 'failed'

// Map Claude Code's JSONL `status` field values to termhub's SessionStatus.
// Values from Claude Code:
//   idle    → session at the input prompt, ready for user
//   busy    → Claude is generating / running tools
//   waiting → Claude has paused to ask the user something
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

// Pull the latest `status` value from a JSONL chunk (may contain multiple
// lines). Returns undefined if no `status` field is found in any record.
export function parseLatestStatus(chunk: string): string | undefined {
  const lines = chunk.split('\n')
  let latest: string | undefined
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof rec.status === 'string' && rec.status.length > 0) {
        latest = rec.status
      }
    } catch {
      // Malformed JSON line — skip
    }
  }
  return latest
}

// Encode a filesystem path the same way Claude Code does when building the
// ~/.claude/projects/<encoded-cwd>/ directory name. Each character that is
// a path separator (\, /), colon (:), or dot (.) is replaced with a dash.
// Consecutive dashes are NOT collapsed — "E:\Apps" → "E--Apps" because the
// colon and backslash each independently become a dash.
export function encodeProjectPath(cwdArg: string): string {
  return cwdArg.replace(/[\\/:\.]/g, '-')
}

// Locate the JSONL file for a session by searching
// ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl.
// Returns the path if the file exists, or null if it can't be found.
export function resolveJsonlPath(cwd: string, sessionId: string): string | null {
  const encoded = encodeProjectPath(cwd)
  const candidate = path.join(
    os.homedir(),
    '.claude',
    'projects',
    encoded,
    `${sessionId}.jsonl`,
  )
  try {
    fs.accessSync(candidate, fs.constants.R_OK)
    return candidate
  } catch {
    return null
  }
}

export type WatcherHandle = {
  stop: () => void
}

// Watch a Claude Code JSONL file for status changes. Polls via
// fs.watchFile (more reliable than fs.watch on Windows). On each file
// change, reads new bytes from the last known offset, parses any `status`
// records, maps the value, and calls onStatus if it changed.
//
// The file may not exist yet when this is called (Claude Code creates it
// shortly after the session starts). The watcher will begin emitting once
// the file appears.
//
// If the file shrinks (truncated / session reset), the offset is reset to 0
// so the whole file is re-read.
//
// Returns a handle with a stop() method to tear down the watcher.
export function watchJsonlStatus(
  jsonlPath: string,
  onStatus: (status: SessionStatus) => void,
): WatcherHandle {
  let offset = 0
  let lastEmitted: SessionStatus | undefined

  function readNewChunk() {
    let stat: fs.Stats
    try {
      stat = fs.statSync(jsonlPath)
    } catch (err) {
      // File gone or not yet created — ignore until next poll tick
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[termhub:status] unexpected stat error on', jsonlPath, err)
      }
      return
    }

    // File truncated / session resumed — reset offset to read from the top
    if (stat.size < offset) {
      console.log('[termhub:status] JSONL file truncated, resetting offset:', path.basename(jsonlPath))
      offset = 0
    }

    if (stat.size === offset) {
      return // nothing new
    }

    let fd: number
    try {
      fd = fs.openSync(jsonlPath, 'r')
    } catch (err) {
      console.error('[termhub:status] failed to open JSONL file', jsonlPath, err)
      return
    }

    try {
      const newBytes = stat.size - offset
      const buf = Buffer.alloc(newBytes)
      const bytesRead = fs.readSync(fd, buf, 0, newBytes, offset)
      offset += bytesRead
      const chunk = buf.slice(0, bytesRead).toString('utf8')
      const raw = parseLatestStatus(chunk)
      if (raw === undefined) return
      const next = mapJsonlStatus(raw)
      if (next !== lastEmitted) {
        lastEmitted = next
        onStatus(next)
      }
    } catch (err) {
      console.error('[termhub:status] failed to read JSONL file', jsonlPath, err)
    } finally {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    }
  }

  // Poll every 500 ms. fs.watchFile is available everywhere and avoids the
  // unreliable fs.watch kernel events on Windows networked / NTFS paths.
  fs.watchFile(jsonlPath, { interval: 500, persistent: false }, readNewChunk)

  // Also do an immediate read in case the file already has content.
  readNewChunk()

  return {
    stop() {
      fs.unwatchFile(jsonlPath)
    },
  }
}

// Start watching the JSONL file for a session, discovering the path from
// the session's cwd and id. The path search is repeated on each poll tick
// until the file is found, so callers don't need to wait for it to appear.
//
// When the file doesn't exist yet, status stays at 'working' (the session
// just started — we optimistically assume Claude is busy until JSONL says
// otherwise).
export function watchSessionStatus(
  cwd: string,
  sessionId: string,
  onStatus: (status: SessionStatus) => void,
): WatcherHandle {
  const encoded = encodeProjectPath(cwd)
  const jsonlPath = path.join(
    os.homedir(),
    '.claude',
    'projects',
    encoded,
    `${sessionId}.jsonl`,
  )

  console.log('[termhub:status] watching JSONL for session', sessionId.slice(0, 8), 'at', jsonlPath)

  return watchJsonlStatus(jsonlPath, onStatus)
}
