import { describe, it, expect } from 'vitest'
import { isMergeEnabled } from './pr-utils'
import type { SessionPr } from './types'

// The JSON parsing and cache-key helpers live in electron/pr-fetch.ts which
// can be imported directly because it has no Electron dependencies.
import {
  buildCacheKey,
  parseGhPrListOutput,
  parseGhPrState,
  parseGhCiState,
} from '../electron/pr-fetch'

// ---------------------------------------------------------------------------
// buildCacheKey
// ---------------------------------------------------------------------------

describe('buildCacheKey', () => {
  it('combines cwd and branch with :: separator', () => {
    expect(buildCacheKey('/home/user/repo', 'feat/foo')).toBe(
      '/home/user/repo::feat/foo',
    )
  })

  it('is distinct for different cwds with same branch', () => {
    const a = buildCacheKey('/repo-a', 'main')
    const b = buildCacheKey('/repo-b', 'main')
    expect(a).not.toBe(b)
  })

  it('is distinct for same cwd with different branches', () => {
    const a = buildCacheKey('/repo', 'main')
    const b = buildCacheKey('/repo', 'feat/foo')
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// parseGhPrState
// ---------------------------------------------------------------------------

describe('parseGhPrState', () => {
  it('maps OPEN → open', () => {
    expect(parseGhPrState('OPEN')).toBe('open')
  })

  it('maps MERGED → merged', () => {
    expect(parseGhPrState('MERGED')).toBe('merged')
  })

  it('maps CLOSED → closed', () => {
    expect(parseGhPrState('CLOSED')).toBe('closed')
  })

  it('is case-insensitive', () => {
    expect(parseGhPrState('open')).toBe('open')
    expect(parseGhPrState('Merged')).toBe('merged')
  })

  it('falls back to closed for unknown values', () => {
    expect(parseGhPrState('UNKNOWN')).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// parseGhCiState
// ---------------------------------------------------------------------------

describe('parseGhCiState', () => {
  it('returns null for empty array', () => {
    expect(parseGhCiState([])).toBe(null)
  })

  it('returns null for non-array', () => {
    expect(parseGhCiState(null)).toBe(null)
    expect(parseGhCiState(undefined)).toBe(null)
    expect(parseGhCiState('SUCCESS')).toBe(null)
  })

  it('returns success when all checks pass', () => {
    expect(parseGhCiState([{ state: 'SUCCESS' }, { state: 'SUCCESS' }])).toBe('success')
  })

  it('returns failure when any check fails', () => {
    expect(parseGhCiState([{ state: 'SUCCESS' }, { state: 'FAILURE' }])).toBe('failure')
    expect(parseGhCiState([{ state: 'ERROR' }])).toBe('failure')
    expect(parseGhCiState([{ state: 'TIMED_OUT' }])).toBe('failure')
  })

  it('failure takes precedence over pending', () => {
    expect(parseGhCiState([{ state: 'PENDING' }, { state: 'FAILURE' }])).toBe('failure')
  })

  it('returns pending when some checks are pending and none failed', () => {
    expect(parseGhCiState([{ state: 'SUCCESS' }, { state: 'PENDING' }])).toBe('pending')
    expect(parseGhCiState([{ state: 'IN_PROGRESS' }])).toBe('pending')
    expect(parseGhCiState([{ state: 'QUEUED' }])).toBe('pending')
    expect(parseGhCiState([{ state: 'WAITING' }])).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// parseGhPrListOutput
// ---------------------------------------------------------------------------

describe('parseGhPrListOutput', () => {
  it('parses a well-formed gh response', () => {
    const raw = JSON.stringify([
      {
        number: 42,
        title: 'feat: add something cool',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/42',
        statusCheckRollup: [{ state: 'SUCCESS' }],
      },
    ])
    const result = parseGhPrListOutput(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual<SessionPr>({
      number: 42,
      title: 'feat: add something cool',
      state: 'open',
      url: 'https://github.com/owner/repo/pull/42',
      ciState: 'success',
    })
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseGhPrListOutput('not json')).toEqual([])
    expect(parseGhPrListOutput('')).toEqual([])
  })

  it('returns empty array when top-level is not an array', () => {
    expect(parseGhPrListOutput('null')).toEqual([])
    expect(parseGhPrListOutput('{}')).toEqual([])
  })

  it('skips entries missing required fields', () => {
    const raw = JSON.stringify([
      { number: 'not-a-number', title: 'x', state: 'OPEN', url: 'u' },
      { number: 1, title: 42, state: 'OPEN', url: 'u' },
      { number: 2, title: 'ok', state: 'OPEN', url: 'https://github.com/x/y/pull/2', statusCheckRollup: [] },
    ])
    const result = parseGhPrListOutput(raw)
    expect(result).toHaveLength(1)
    expect(result[0].number).toBe(2)
  })

  it('handles absent statusCheckRollup (returns ciState null)', () => {
    const raw = JSON.stringify([
      {
        number: 7,
        title: 'chore: stuff',
        state: 'MERGED',
        url: 'https://github.com/x/y/pull/7',
      },
    ])
    const result = parseGhPrListOutput(raw)
    expect(result[0].ciState).toBe(null)
  })

  it('handles multiple PRs and returns all valid ones', () => {
    const raw = JSON.stringify([
      {
        number: 1,
        title: 'first',
        state: 'OPEN',
        url: 'https://github.com/x/y/pull/1',
        statusCheckRollup: [{ state: 'PENDING' }],
      },
      {
        number: 2,
        title: 'second',
        state: 'CLOSED',
        url: 'https://github.com/x/y/pull/2',
        statusCheckRollup: [],
      },
    ])
    const result = parseGhPrListOutput(raw)
    expect(result).toHaveLength(2)
    expect(result[0].ciState).toBe('pending')
    expect(result[1].ciState).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// isMergeEnabled
// ---------------------------------------------------------------------------

describe('isMergeEnabled', () => {
  const base: SessionPr = {
    number: 1,
    title: 'test',
    state: 'open',
    url: 'https://github.com/x/y/pull/1',
    ciState: 'success',
  }

  it('returns true when state=open and ciState=success', () => {
    expect(isMergeEnabled(base)).toBe(true)
  })

  it('returns false when CI is pending', () => {
    expect(isMergeEnabled({ ...base, ciState: 'pending' })).toBe(false)
  })

  it('returns false when CI is failing', () => {
    expect(isMergeEnabled({ ...base, ciState: 'failure' })).toBe(false)
  })

  it('returns false when CI is null (no CI configured)', () => {
    expect(isMergeEnabled({ ...base, ciState: null })).toBe(false)
  })

  it('returns false when PR is merged', () => {
    expect(isMergeEnabled({ ...base, state: 'merged', ciState: 'success' })).toBe(false)
  })

  it('returns false when PR is closed', () => {
    expect(isMergeEnabled({ ...base, state: 'closed', ciState: 'success' })).toBe(false)
  })
})
