// sessions.json is the format CLAUDE.md calls out as needing a migration
// path. loadPersistedSessions deliberately tolerates partial/older entries
// rather than throwing, so the exact tolerance boundary is worth pinning:
// too strict and a format bump silently drops the user's whole session list.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let sessionsPath = ''

// config.ts reaches for electron's app.getPath('userData'), which doesn't
// exist outside the Electron runtime.
vi.mock('./config', () => ({
  getSessionsPath: () => sessionsPath,
}))

// Static import is fine: vi.mock is hoisted above it, and the factory only
// reads `sessionsPath` when getSessionsPath() is called, not at
// module-evaluation time.
import { loadPersistedSessions, writePersistedSessions } from './persistence'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'termhub-persist-'))
  sessionsPath = path.join(dir, 'sessions.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function write(contents: unknown): void {
  fs.writeFileSync(sessionsPath, typeof contents === 'string' ? contents : JSON.stringify(contents))
}

describe('loadPersistedSessions', () => {
  it('returns [] when the file does not exist — first run', () => {
    expect(loadPersistedSessions()).toEqual([])
  })

  it('returns [] on malformed JSON rather than throwing', () => {
    write('{ not json')
    expect(loadPersistedSessions()).toEqual([])
  })

  it('returns [] when the top level is not an array', () => {
    write({ sessions: [] })
    expect(loadPersistedSessions()).toEqual([])
  })

  it('accepts a minimal entry — only id and cwd are required', () => {
    write([{ id: 'a', cwd: '/tmp' }])
    expect(loadPersistedSessions()).toEqual([{ id: 'a', cwd: '/tmp' }])
  })

  it('round-trips a fully populated entry', () => {
    const full = {
      id: 'a',
      cwd: '/tmp',
      command: 'claude',
      name: 'worker',
      model: 'claude-opus-5',
      permissionMode: 'plan',
      dangerouslySkipPermissions: false,
      allowDangerouslySkipPermissions: true,
      cli: 'claude' as const,
    }
    writePersistedSessions([full])
    expect(loadPersistedSessions()).toEqual([full])
  })

  it('drops entries missing id or cwd but keeps the valid ones', () => {
    write([
      { id: 'good', cwd: '/tmp' },
      { cwd: '/no-id' },
      { id: 'no-cwd' },
      { id: 'also-good', cwd: '/tmp2' },
    ])
    expect(loadPersistedSessions().map((s) => s.id)).toEqual(['good', 'also-good'])
  })

  it('drops entries with wrong-typed optional fields rather than importing garbage', () => {
    write([
      { id: 'a', cwd: '/tmp', name: 42 },
      { id: 'b', cwd: '/tmp', dangerouslySkipPermissions: 'yes' },
      { id: 'c', cwd: '/tmp' },
    ])
    expect(loadPersistedSessions().map((s) => s.id)).toEqual(['c'])
  })

  it('rejects an unknown cli value — a future runtime must not spawn as claude', () => {
    write([
      { id: 'a', cwd: '/tmp', cli: 'someFutureCli' },
      { id: 'b', cwd: '/tmp', cli: 'gemini' },
    ])
    expect(loadPersistedSessions().map((s) => s.id)).toEqual(['b'])
  })

  it('survives null entries in the array', () => {
    write([null, { id: 'a', cwd: '/tmp' }, null])
    expect(loadPersistedSessions().map((s) => s.id)).toEqual(['a'])
  })
})

describe('writePersistedSessions', () => {
  it('creates the parent directory if it is missing', () => {
    sessionsPath = path.join(dir, 'nested', 'deeper', 'sessions.json')
    writePersistedSessions([{ id: 'a', cwd: '/tmp' }])
    expect(JSON.parse(fs.readFileSync(sessionsPath, 'utf8'))).toEqual([
      { id: 'a', cwd: '/tmp' },
    ])
  })

  it('overwrites rather than appending', () => {
    writePersistedSessions([{ id: 'a', cwd: '/tmp' }, { id: 'b', cwd: '/tmp' }])
    writePersistedSessions([{ id: 'c', cwd: '/tmp' }])
    expect(loadPersistedSessions().map((s) => s.id)).toEqual(['c'])
  })

  it('writes an empty array when the last session closes', () => {
    writePersistedSessions([{ id: 'a', cwd: '/tmp' }])
    writePersistedSessions([])
    expect(loadPersistedSessions()).toEqual([])
  })

  it('swallows write failures — a transient error must not kill a live session', () => {
    // Put a regular file where the code expects a directory, so mkdirSync
    // and writeFileSync both fail with ENOTDIR. Provoking a real error beats
    // mocking fs, which ESM won't allow anyway.
    const blocker = path.join(dir, 'blocker')
    fs.writeFileSync(blocker, 'not a directory')
    sessionsPath = path.join(blocker, 'sessions.json')

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => writePersistedSessions([{ id: 'a', cwd: '/tmp' }])).not.toThrow()
    expect(errors).toHaveBeenCalled()
  })

  it('reports a read failure as an empty list rather than throwing', () => {
    // Same trick on the read path: an unreadable location must degrade to
    // "no persisted sessions", not crash startup.
    const blocker = path.join(dir, 'blocker2')
    fs.writeFileSync(blocker, 'not a directory')
    sessionsPath = path.join(blocker, 'sessions.json')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(loadPersistedSessions()).toEqual([])
  })
})
