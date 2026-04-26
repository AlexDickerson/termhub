import { describe, it, expect } from 'vitest'
import { scanForSecrets } from './secret-scanner'

// AWS access key: AKIA prefix + 16 uppercase alphanumeric chars
// Matches pattern: /\b(AKIA|...)[A-Z0-9]{16}\b/
// Note: AKIAIOSFODNN7EXAMPLE is in secretlint's built-in ignore list (AWS docs example),
// so we use a different value.
const FAKE_AWS_ACCESS_KEY = 'AKIAZZZZZZZZZZZZZZZZ'

// AWS secret key: must appear as AWS_SECRET_ACCESS_KEY=<40 base64 chars>
// The well-known example key wJalrXUtnFEMI/... is in secretlint's ignore list,
// so we use a different 40-char value.
const FAKE_AWS_SECRET_LINE =
  'AWS_SECRET_ACCESS_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

// GitHub classic PAT: ghp_ + exactly 36 alphanumeric+underscore chars
// Matches: /(?<!\p{L})(?<type>ghp|...)_[A-Za-z0-9_]{36}(?![A-Za-z0-9_])/gu
const FAKE_GITHUB_PAT = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

// OpenAI key: legacy format sk-<20 alphanum>T3BlbkFJ<20 alphanum>
// Assembled from parts so the literal string doesn't trigger GitHub push protection
// on this test file; secretlint still detects it at runtime.
const FAKE_OPENAI_KEY =
  'sk-aaaaaaaaaaaaaaaaaaab' + 'T3BlbkFJ' + 'aaaaaaaaaaaaaaaaaaab'

// Anthropic key: sk-ant-api0<digit>-<90..128 base64url chars>AA
// Matches: /(?<!\p{L})sk-ant-api0\d-[A-Za-z0-9_-]{90,128}AA(?![A-Za-z0-9_-])/gu
const FAKE_ANTHROPIC_KEY =
  'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-AAAAAA'

// A plain UUID — no rule should match this
const UUID = '550e8400-e29b-41d4-a716-446655440000'

// Claude session ids are UUID-formatted — same test, different label
const CLAUDE_SESSION_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

// A normal shell command — should not match
const SAFE_COMMAND = 'git commit -m "fix: update readme"'

describe('scanForSecrets', () => {
  it('detects a fake AWS access key', async () => {
    const findings = await scanForSecrets(`AWS_ACCESS_KEY_ID=${FAKE_AWS_ACCESS_KEY}`)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.ruleId.includes('aws'))).toBe(true)
  })

  it('detects a fake AWS secret access key', async () => {
    const findings = await scanForSecrets(FAKE_AWS_SECRET_LINE)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.ruleId.includes('aws'))).toBe(true)
  })

  it('detects a fake GitHub PAT', async () => {
    const findings = await scanForSecrets(FAKE_GITHUB_PAT)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.ruleId.includes('github'))).toBe(true)
  })

  it('detects a fake OpenAI key', async () => {
    const findings = await scanForSecrets(FAKE_OPENAI_KEY)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.ruleId.includes('openai'))).toBe(true)
  })

  it('detects a fake Anthropic key', async () => {
    const findings = await scanForSecrets(FAKE_ANTHROPIC_KEY)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.some((f) => f.ruleId.includes('anthropic'))).toBe(true)
  })

  it('returns no finding for a plain UUID', async () => {
    const findings = await scanForSecrets(UUID)
    expect(findings).toHaveLength(0)
  })

  it('returns no false positive for a Claude session-id shaped string', async () => {
    const findings = await scanForSecrets(CLAUDE_SESSION_ID)
    expect(findings).toHaveLength(0)
  })

  it('returns no finding for a safe shell command', async () => {
    const findings = await scanForSecrets(SAFE_COMMAND)
    expect(findings).toHaveLength(0)
  })

  it('returns multiple findings for text with multiple secrets', async () => {
    const text = [FAKE_AWS_SECRET_LINE, FAKE_GITHUB_PAT].join('\n')
    const findings = await scanForSecrets(text)
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it('includes matchedText in each finding', async () => {
    const findings = await scanForSecrets(FAKE_GITHUB_PAT)
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(typeof f.matchedText).toBe('string')
      expect(f.matchedText.length).toBeGreaterThan(0)
    }
  })
})
