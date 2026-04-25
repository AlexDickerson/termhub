import { describe, it, expect } from 'vitest'
import {
  bracketedPasteWithSubmit,
  cleanEnv,
  isClaudeCommand,
} from './claude-command'

describe('isClaudeCommand', () => {
  it('matches "claude" alone', () => {
    expect(isClaudeCommand('claude')).toBe(true)
  })

  it('matches "claude" followed by args', () => {
    expect(isClaudeCommand('claude --resume foo')).toBe(true)
    expect(isClaudeCommand('claude  --model x')).toBe(true)
  })

  it('tolerates leading/trailing whitespace', () => {
    expect(isClaudeCommand('   claude  ')).toBe(true)
  })

  it('does not match when claude is a substring', () => {
    expect(isClaudeCommand('myclaude')).toBe(false)
    expect(isClaudeCommand('echo claude')).toBe(false)
  })

  it('does not match other commands', () => {
    expect(isClaudeCommand('bash')).toBe(false)
    expect(isClaudeCommand('claude-cli')).toBe(false)
    expect(isClaudeCommand('')).toBe(false)
  })
})

describe('bracketedPasteWithSubmit', () => {
  it('wraps text in bracketed-paste markers and appends CR', () => {
    expect(bracketedPasteWithSubmit('hello')).toBe('\x1b[200~hello\x1b[201~\r')
  })

  it('passes shell-special characters through verbatim', () => {
    const text = '`backticks` $(subshell) "quotes" >redirect <files'
    expect(bracketedPasteWithSubmit(text)).toBe(
      `\x1b[200~${text}\x1b[201~\r`,
    )
  })

  it('preserves embedded newlines (claude paste handles multi-line atomically)', () => {
    const text = 'line1\nline2\nline3'
    expect(bracketedPasteWithSubmit(text)).toBe(
      `\x1b[200~${text}\x1b[201~\r`,
    )
  })

  it('handles the empty string', () => {
    expect(bracketedPasteWithSubmit('')).toBe('\x1b[200~\x1b[201~\r')
  })
})

describe('cleanEnv', () => {
  // Snapshot original process.env once; each test sets a fresh env from it.
  const original = { ...process.env }

  it('strips CLAUDE_*-prefixed vars', () => {
    process.env = { ...original, CLAUDE_AGENT: 'foo', CLAUDE_CODE_X: 'bar', PATH: '/usr/bin' }
    const out = cleanEnv()
    expect(out.CLAUDE_AGENT).toBeUndefined()
    expect(out.CLAUDE_CODE_X).toBeUndefined()
    expect(out.PATH).toBe('/usr/bin')
    process.env = { ...original }
  })

  it('strips CLAUDECODE-prefixed vars', () => {
    process.env = { ...original, CLAUDECODE_FOO: 'x', CLAUDECODE: 'y' }
    const out = cleanEnv()
    expect(out.CLAUDECODE_FOO).toBeUndefined()
    expect(out.CLAUDECODE).toBeUndefined()
    process.env = { ...original }
  })

  it('strips OPERON_*-prefixed vars (the sandbox preflight trigger)', () => {
    process.env = { ...original, OPERON_SANDBOXED_NETWORK: '1', OPERON_X: 'y' }
    const out = cleanEnv()
    expect(out.OPERON_SANDBOXED_NETWORK).toBeUndefined()
    expect(out.OPERON_X).toBeUndefined()
    process.env = { ...original }
  })

  it('strips DEFAULT_LLM_MODEL exact-match var', () => {
    process.env = { ...original, DEFAULT_LLM_MODEL: 'claude-x' }
    const out = cleanEnv()
    expect(out.DEFAULT_LLM_MODEL).toBeUndefined()
    process.env = { ...original }
  })

  it('preserves non-matching env vars', () => {
    process.env = { ...original, USER: 'alex', NODE_ENV: 'development', PATH: '/' }
    const out = cleanEnv()
    expect(out.USER).toBe('alex')
    expect(out.NODE_ENV).toBe('development')
    expect(out.PATH).toBe('/')
    process.env = { ...original }
  })

  it('does not strip vars that merely contain CLAUDE substring', () => {
    process.env = { ...original, MYCLAUDE: 'keep' }
    const out = cleanEnv()
    expect(out.MYCLAUDE).toBe('keep')
    process.env = { ...original }
  })
})
