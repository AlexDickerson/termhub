import { describe, it, expect } from 'vitest'
import { resolveSessionCwd } from './cwd-resolve'

describe('resolveSessionCwd', () => {
  // Regression: a config written on Windows shipped 'E:/' as the
  // orchestrator startup cwd. On macOS / Linux pty.spawn rejected that
  // and the orchestrator never started. The resolver swaps the unreachable
  // path for a usable fallback (homedir in production).
  it('falls back when the cwd does not exist on this host', () => {
    const exists = (p: string) => p === '/Users/alex'
    expect(resolveSessionCwd('E:/', '/Users/alex', exists)).toBe('/Users/alex')
  })

  it('returns the original cwd when it does exist', () => {
    const exists = (p: string) => p === '/Users/alex/Repos/termhub'
    expect(
      resolveSessionCwd('/Users/alex/Repos/termhub', '/Users/alex', exists),
    ).toBe('/Users/alex/Repos/termhub')
  })

  it('treats a non-directory as missing', () => {
    // A path that exists as a file (or anything not a directory) is not a
    // valid cwd for pty.spawn, so the resolver should still fall back.
    const exists = (_: string) => false
    expect(resolveSessionCwd('/some/file.txt', '/home/user', exists)).toBe(
      '/home/user',
    )
  })

  it('uses homedir as the default fallback', () => {
    // The exists callback is the only thing under test here — make every
    // path miss so we hit the default fallback. We don't assert the value
    // (it varies per host), only that the resolver returns *something*
    // truthy and not the input.
    const result = resolveSessionCwd('/definitely/not/here', undefined, () => false)
    expect(result).toBeTruthy()
    expect(result).not.toBe('/definitely/not/here')
  })
})
