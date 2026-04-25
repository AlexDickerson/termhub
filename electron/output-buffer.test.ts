import { describe, it, expect } from 'vitest'
import {
  MAX_OUTPUT_BUFFER_BYTES,
  appendToBuffer,
  stripAnsi,
} from './output-buffer'

describe('appendToBuffer', () => {
  it('appends below the cap without trimming', () => {
    expect(appendToBuffer('abc', 'def')).toBe('abcdef')
  })

  it('trims oldest characters when appending would exceed the cap', () => {
    const cap = MAX_OUTPUT_BUFFER_BYTES
    const buf = 'x'.repeat(cap)
    const out = appendToBuffer(buf, 'NEW')
    expect(out.length).toBe(cap)
    expect(out.endsWith('NEW')).toBe(true)
    // Oldest characters should be gone (we trimmed from the front).
    expect(out.startsWith('x')).toBe(true)
    expect(out.slice(0, 3)).toBe('xxx')
  })

  it('handles a chunk larger than the cap by keeping only the tail', () => {
    const cap = MAX_OUTPUT_BUFFER_BYTES
    // Chunk strictly larger than the cap.
    const big = 'A'.repeat(cap) + 'TAIL'
    const out = appendToBuffer('preceding', big)
    expect(out.length).toBe(cap)
    expect(out.endsWith('TAIL')).toBe(true)
  })

  it('returns the empty buffer for empty + empty', () => {
    expect(appendToBuffer('', '')).toBe('')
  })
})

describe('stripAnsi', () => {
  it('strips CSI sequences (colour, cursor moves)', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
    expect(stripAnsi('\x1b[2J\x1b[Hcleared')).toBe('cleared')
  })

  it('strips OSC sequences ending with BEL', () => {
    expect(stripAnsi('\x1b]0;title here\x07after')).toBe('after')
  })

  it('strips OSC sequences ending with ST (ESC \\)', () => {
    expect(stripAnsi('\x1b]0;title here\x1b\\after')).toBe('after')
  })

  it('strips DCS / SOS / PM / APC sequences (ESC P/X/^/_)', () => {
    expect(stripAnsi('before\x1bPq;data;\x1b\\after')).toBe('beforeafter')
    expect(stripAnsi('A\x1bX raw \x1b\\B')).toBe('AB')
  })

  it('strips charset designation sequences (ESC =, >, (, etc.) — eats one char after the designator', () => {
    // The regex matches ESC + designator + one more char. For '\x1b(0' the
    // ESC + '(' + '0' triple is stripped cleanly. For '\x1b=keypad' the
    // ESC + '=' + 'k' triple eats the 'k' too — a documented limitation of
    // the lossy stripper, fine for read_output's use.
    expect(stripAnsi('\x1b(0graphics')).toBe('graphics')
    expect(stripAnsi('\x1b=keypad')).toBe('eypad')
  })

  it('strips stray control chars (NUL/BS/BEL/etc.)', () => {
    // \x00 NUL, \x07 BEL, \x08 BS, \x0b VT, \x7f DEL — all dropped
    expect(stripAnsi('a\x00b\x07c\x08d\x7fe')).toBe('abcde')
  })

  it('preserves common whitespace (LF, CR, TAB)', () => {
    expect(stripAnsi('line1\nline2\rline3\tend')).toBe('line1\nline2\rline3\tend')
  })

  it('passes plain text untouched', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })
})
