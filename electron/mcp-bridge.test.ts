// The bridge is what an orchestrator actually reads, so the shape of what it
// prints is a contract of its own. formatSession is the only pure piece;
// the tool handlers are thin fetch wrappers covered by mcp.test.ts.

import { describe, it, expect } from 'vitest'
import { formatSession } from './mcp-bridge'
import type { SessionSummary } from './mcp'

const base: SessionSummary = {
  id: 'abc123',
  cwd: '/repo',
  status: 'idle',
}

describe('formatSession', () => {
  it('leads with id and status — the two fields a caller acts on', () => {
    expect(formatSession(base)).toMatch(/^abc123\s+\[idle]/)
  })

  it('includes the name when set', () => {
    expect(formatSession({ ...base, name: 'worker-1' })).toContain('worker-1')
  })

  it('omits the metadata parens entirely when cli/model/mode are all absent', () => {
    expect(formatSession(base)).not.toContain('(')
  })

  it('collects cli, model and permissionMode into one parenthesised group', () => {
    const line = formatSession({
      ...base,
      cli: 'claude',
      model: 'claude-opus-5',
      permissionMode: 'plan',
    })
    expect(line).toContain('(claude, claude-opus-5, plan)')
  })

  it('skips absent metadata fields rather than emitting blanks', () => {
    const line = formatSession({ ...base, cli: 'codex' })
    expect(line).toContain('(codex)')
    expect(line).not.toContain(', ,')
  })

  it('renders each status verbatim so callers can match on it', () => {
    for (const status of ['working', 'awaiting', 'idle', 'failed'] as const) {
      expect(formatSession({ ...base, status })).toContain(`[${status}]`)
    }
  })

  it('always includes the cwd', () => {
    expect(formatSession(base)).toContain('/repo')
  })
})
