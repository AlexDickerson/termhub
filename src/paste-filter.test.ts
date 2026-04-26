import { describe, it, expect } from 'vitest'
import { truncateSecret, shouldShowPasteDialog } from './paste-filter'
import type { SecretFinding } from './types'

// ---------------------------------------------------------------------------
// truncateSecret
// ---------------------------------------------------------------------------

describe('truncateSecret', () => {
  it('truncates a typical API key to first 8 + ... + last 4', () => {
    expect(truncateSecret('sk-1234567890abcdef')).toBe('sk-12345...cdef')
  })

  it('truncates a long AWS-like secret key', () => {
    const key = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    const result = truncateSecret(key)
    expect(result).toBe('wJalrXUt...EKEY')
    expect(result.includes('...')).toBe(true)
  })

  it('truncates an Anthropic key', () => {
    const key = 'sk-ant-api03-longkeyvaluehere1234567890abcdef'
    const result = truncateSecret(key)
    expect(result.startsWith('sk-ant-a')).toBe(true)
    expect(result.endsWith('cdef')).toBe(true)
    expect(result.includes('...')).toBe(true)
  })

  it('handles a string exactly at the threshold (12 chars) with truncation', () => {
    // length 12 = PREFIX(8) + SUFFIX(4) — falls in the "too short" branch
    const s = '12345678abcd'
    expect(truncateSecret(s)).toBe('12345678...')
  })

  it('truncates strings longer than 12 chars', () => {
    const s = '1234567890abcdef'  // 16 chars
    const result = truncateSecret(s)
    expect(result).toBe('12345678...cdef')
  })

  it('always hides the middle of any secret', () => {
    const key = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const result = truncateSecret(key)
    expect(result.length).toBeLessThan(key.length)
    expect(result).toContain('...')
  })
})

// ---------------------------------------------------------------------------
// shouldShowPasteDialog
// ---------------------------------------------------------------------------

const finding: SecretFinding = {
  ruleId: '@secretlint/secretlint-rule-aws',
  message: 'found AWS Secret Access Key',
  matchedText: 'AKIAIOSFODNN7EXAMPLE',
}

describe('shouldShowPasteDialog', () => {
  it('returns false when filter is disabled, even with findings', () => {
    expect(shouldShowPasteDialog(false, [finding])).toBe(false)
  })

  it('returns false when filter is enabled but no findings', () => {
    expect(shouldShowPasteDialog(true, [])).toBe(false)
  })

  it('returns true when filter is enabled and findings are present', () => {
    expect(shouldShowPasteDialog(true, [finding])).toBe(true)
  })

  it('returns true for multiple findings', () => {
    const f2: SecretFinding = { ...finding, ruleId: '@secretlint/secretlint-rule-github' }
    expect(shouldShowPasteDialog(true, [finding, f2])).toBe(true)
  })

  it('returns false when filter is disabled and no findings', () => {
    expect(shouldShowPasteDialog(false, [])).toBe(false)
  })
})
