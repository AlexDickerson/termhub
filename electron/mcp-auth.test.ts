import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { generateToken, tokensMatch, getOrCreateToken } from './mcp-auth'

const tempDirs: string[] = []

function tempTokenPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'termhub-token-'))
  tempDirs.push(dir)
  return path.join(dir, 'mcp-token')
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('generateToken', () => {
  it('returns 64 hex chars (32 bytes)', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken))
    expect(tokens.size).toBe(50)
  })
})

describe('tokensMatch', () => {
  it('accepts an exact match', () => {
    const t = generateToken()
    expect(tokensMatch(t, t)).toBe(true)
  })

  it('rejects a different token of the same length', () => {
    expect(tokensMatch('a'.repeat(64), 'b'.repeat(64))).toBe(false)
  })

  it('rejects undefined, empty, and length-mismatched input without throwing', () => {
    const t = generateToken()
    expect(tokensMatch(t, undefined)).toBe(false)
    expect(tokensMatch(t, '')).toBe(false)
    // timingSafeEqual throws on length mismatch; the guard must catch this.
    expect(tokensMatch(t, t.slice(0, 10))).toBe(false)
    expect(tokensMatch(t, t + 'extra')).toBe(false)
  })

  it('rejects a prefix of the real token', () => {
    const t = generateToken()
    expect(tokensMatch(t, t.slice(0, -1))).toBe(false)
  })
})

describe('getOrCreateToken', () => {
  it('creates a token file on first call', () => {
    const p = tempTokenPath()
    const token = getOrCreateToken(p)

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(p, 'utf8')).toBe(token)
  })

  it('is stable across calls — a restart must not invalidate a live bridge', () => {
    const p = tempTokenPath()
    expect(getOrCreateToken(p)).toBe(getOrCreateToken(p))
  })

  it('writes the file 0600', () => {
    const p = tempTokenPath()
    getOrCreateToken(p)
    // Windows does not model POSIX permission bits; skip the assertion there.
    if (process.platform !== 'win32') {
      expect(fs.statSync(p).mode & 0o777).toBe(0o600)
    }
  })

  it('replaces a truncated token rather than trusting it', () => {
    const p = tempTokenPath()
    fs.writeFileSync(p, 'tooshort')

    const token = getOrCreateToken(p)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(p, 'utf8')).toBe(token)
  })

  it('tolerates surrounding whitespace in an existing file', () => {
    const p = tempTokenPath()
    const existing = generateToken()
    fs.writeFileSync(p, `  ${existing}\n`)

    expect(getOrCreateToken(p)).toBe(existing)
  })

  it('creates the parent directory if missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'termhub-token-'))
    tempDirs.push(dir)
    const p = path.join(dir, 'nested', 'deeper', 'mcp-token')

    const token = getOrCreateToken(p)
    expect(fs.readFileSync(p, 'utf8')).toBe(token)
  })
})
