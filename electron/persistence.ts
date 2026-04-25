// Persisted-session list (sessions.json) — the wire format that survives
// app restarts. Live PTY state lives in main.ts and is not persisted; only
// what's needed to re-spawn claude with --resume gets written here.

import * as path from 'node:path'
import * as fs from 'node:fs'
import { getSessionsPath } from './config'

export type PersistedSession = {
  id: string
  cwd: string
  command?: string
  name?: string
  model?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  cli?: 'claude' | 'codex'
}

// Type-guard parsing — we deliberately tolerate older / partial entries
// rather than throwing on schema drift. The caller treats the returned
// list as advisory startup state.
export function loadPersistedSessions(): PersistedSession[] {
  try {
    const raw = fs.readFileSync(getSessionsPath(), 'utf8')
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (s): s is PersistedSession =>
        s != null &&
        typeof s.id === 'string' &&
        typeof s.cwd === 'string' &&
        (s.command === undefined || typeof s.command === 'string') &&
        (s.name === undefined || typeof s.name === 'string') &&
        (s.model === undefined || typeof s.model === 'string') &&
        (s.permissionMode === undefined || typeof s.permissionMode === 'string') &&
        (s.dangerouslySkipPermissions === undefined ||
          typeof s.dangerouslySkipPermissions === 'boolean') &&
        (s.allowDangerouslySkipPermissions === undefined ||
          typeof s.allowDangerouslySkipPermissions === 'boolean') &&
        (s.cli === undefined || s.cli === 'claude' || s.cli === 'codex'),
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[termhub] failed to load persisted sessions:', err)
    }
    return []
  }
}

// Write the given list to sessions.json, swallowing failures (the caller
// can't recover; we'd rather keep the session running than crash on a
// transient write error).
export function writePersistedSessions(list: PersistedSession[]): void {
  try {
    const sessionsPath = getSessionsPath()
    fs.mkdirSync(path.dirname(sessionsPath), { recursive: true })
    fs.writeFileSync(sessionsPath, JSON.stringify(list, null, 2))
  } catch (err) {
    console.error('[termhub] failed to persist sessions:', err)
  }
}
