import { describe, it, expect } from 'vitest'
import {
  bracketedPaste,
  cleanEnv,
  isClaudeCommand,
  writeBracketedPasteAndSubmit,
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

describe('bracketedPaste', () => {
  it('wraps text in bracketed-paste markers (no trailing CR)', () => {
    expect(bracketedPaste('hello')).toBe('\x1b[200~hello\x1b[201~')
  })

  it('passes shell-special characters through verbatim', () => {
    const text = '`backticks` $(subshell) "quotes" >redirect <files'
    expect(bracketedPaste(text)).toBe(`\x1b[200~${text}\x1b[201~`)
  })

  it('preserves embedded newlines (claude paste handles multi-line atomically)', () => {
    const text = 'line1\nline2\nline3'
    expect(bracketedPaste(text)).toBe(`\x1b[200~${text}\x1b[201~`)
  })

  it('handles the empty string', () => {
    expect(bracketedPaste('')).toBe('\x1b[200~\x1b[201~')
  })
})

describe('writeBracketedPasteAndSubmit', () => {
  // Inject a synchronous scheduler so we can verify both writes happen
  // and the order is paste-then-submit, without leaning on real timers.
  function makeTarget() {
    const writes: string[] = []
    return {
      target: { write: (s: string) => { writes.push(s) } },
      writes,
    }
  }
  const sync = (cb: () => void) => cb()

  it('writes the paste body first, then CR as a separate write', () => {
    const { target, writes } = makeTarget()
    writeBracketedPasteAndSubmit(target, 'hello', sync)
    expect(writes).toEqual(['\x1b[200~hello\x1b[201~', '\r'])
  })

  it('schedules the submit on a separate tick (paste lands before scheduler fires)', () => {
    const { target, writes } = makeTarget()
    let scheduled: (() => void) | null = null
    writeBracketedPasteAndSubmit(target, 'hi', (cb) => { scheduled = cb })
    // Only the paste body should be on the wire so far.
    expect(writes).toEqual(['\x1b[200~hi\x1b[201~'])
    // Now run the scheduled callback — submit lands.
    scheduled!()
    expect(writes).toEqual(['\x1b[200~hi\x1b[201~', '\r'])
  })

  it('swallows errors from the submit write (pty may have exited)', () => {
    let writeCount = 0
    const target = {
      write: () => {
        writeCount += 1
        if (writeCount === 2) throw new Error('pty exited')
      },
    }
    expect(() => writeBracketedPasteAndSubmit(target, 'x', sync)).not.toThrow()
    expect(writeCount).toBe(2)
  })

  it('passes shell-special chars through unchanged', () => {
    const { target, writes } = makeTarget()
    const text = '`tick` $(sub) "q" >r'
    writeBracketedPasteAndSubmit(target, text, sync)
    expect(writes[0]).toBe(`\x1b[200~${text}\x1b[201~`)
    expect(writes[1]).toBe('\r')
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
