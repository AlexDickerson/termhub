// Shared secret guarding the internal HTTP endpoint (electron/mcp.ts).
//
// The endpoint binds 127.0.0.1, which keeps it off the network but does NOT
// keep it away from other processes on this machine — any local program could
// POST /internal/open_session and spawn a claude session with
// dangerouslySkipPermissions in a directory of its choosing. The bridge is
// spawned by claude with the token in its env (see writeMcpConfigFile in
// main.ts), so it can present the header; nothing else on the box can.
//
// The token is persisted rather than regenerated per run: claude may already
// have a bridge subprocess alive from before a termhub restart, and rotating
// on every launch would 401 it until the user restarted their session too.

import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

export const MCP_TOKEN_HEADER = 'x-termhub-token'

const TOKEN_BYTES = 32
// A hex-encoded 32-byte token; anything shorter is treated as corrupt and
// replaced rather than trusted.
const MIN_TOKEN_LENGTH = TOKEN_BYTES * 2

export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex')
}

// Constant-time compare that tolerates length mismatch. timingSafeEqual throws
// when the buffers differ in length, which would itself leak length via the
// exception path, so the length check is folded into the result instead.
export function tokensMatch(expected: string, provided: string | undefined): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Read the token from `tokenPath`, creating it on first run. Written 0600 so
// other users on a shared machine can't read it. A truncated or unreadable
// file is replaced rather than reused.
export function getOrCreateToken(tokenPath: string): string {
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim()
    if (existing.length >= MIN_TOKEN_LENGTH) return existing
    console.warn(
      `[termhub:mcp] token at ${tokenPath} is too short (${existing.length} chars) — regenerating`,
    )
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn(`[termhub:mcp] could not read token at ${tokenPath} — regenerating:`, err)
    }
  }

  const token = generateToken()
  try {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
    fs.writeFileSync(tokenPath, token, { mode: 0o600 })
    console.log(`[termhub:mcp] wrote new internal API token to ${tokenPath}`)
  } catch (err) {
    // Non-fatal: the in-memory token still guards this run, it just won't
    // survive a restart (the bridge re-reads mcp-config.json each spawn).
    console.error(`[termhub:mcp] failed to persist token to ${tokenPath}:`, err)
  }
  return token
}
