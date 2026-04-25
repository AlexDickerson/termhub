import { describe, it, expect } from 'vitest'
import {
  buildGeminiArgs,
  buildGeminiCommand,
  DEFAULT_GEMINI_YOLO,
} from './gemini-command'

describe('buildGeminiArgs', () => {
  it('DEFAULT_GEMINI_YOLO is true', () => {
    expect(DEFAULT_GEMINI_YOLO).toBe(true)
  })

  it('includes --yolo and --skip-trust by default (no opts)', () => {
    const flags = buildGeminiArgs({})
    expect(flags).toContain('--yolo')
    expect(flags).toContain('--skip-trust')
  })

  it('includes --yolo when explicitly true', () => {
    expect(buildGeminiArgs({ yolo: true })).toContain('--yolo')
  })

  it('omits --yolo when explicitly false', () => {
    expect(buildGeminiArgs({ yolo: false })).not.toContain('--yolo')
  })

  it('includes --skip-trust by default', () => {
    expect(buildGeminiArgs({})).toContain('--skip-trust')
  })

  it('includes --skip-trust when explicitly true', () => {
    expect(buildGeminiArgs({ skipTrust: true })).toContain('--skip-trust')
  })

  it('omits --skip-trust when explicitly false', () => {
    expect(buildGeminiArgs({ skipTrust: false })).not.toContain('--skip-trust')
  })

  it('includes -m flag with quoted model name', () => {
    const flags = buildGeminiArgs({ model: 'gemini-2.5-pro' })
    expect(flags.some((f) => f === '-m "gemini-2.5-pro"')).toBe(true)
  })

  it('omits -m when model is empty', () => {
    const flags = buildGeminiArgs({ model: '' })
    expect(flags.join(' ')).not.toContain('-m')
  })

  it('omits -m when model is undefined', () => {
    const flags = buildGeminiArgs({})
    expect(flags.join(' ')).not.toContain('-m')
  })

  it('includes prompt as last quoted positional arg', () => {
    const flags = buildGeminiArgs({ prompt: 'Do the task' })
    expect(flags[flags.length - 1]).toBe('"Do the task"')
  })

  it('puts prompt after all flags', () => {
    const flags = buildGeminiArgs({ model: 'gemini-2.5-pro', yolo: true, prompt: 'Hello' })
    const promptIdx = flags.findIndex((f) => f.includes('Hello'))
    expect(promptIdx).toBe(flags.length - 1)
    expect(flags.findIndex((f) => f.includes('-m'))).toBeLessThan(promptIdx)
    expect(flags.indexOf('--yolo')).toBeLessThan(promptIdx)
    expect(flags.indexOf('--skip-trust')).toBeLessThan(promptIdx)
  })

  it('omits prompt when empty string', () => {
    const flags = buildGeminiArgs({ yolo: false, skipTrust: false, prompt: '' })
    expect(flags).toEqual([])
  })

  it('omits prompt when undefined', () => {
    const flags = buildGeminiArgs({ yolo: false, skipTrust: false })
    expect(flags).toEqual([])
  })

  it('builds the full flag set in the right order', () => {
    const str = buildGeminiArgs({
      model: 'gemini-2.5-pro',
      yolo: true,
      skipTrust: true,
      prompt: 'Do work',
    }).join(' ')
    expect(str).toContain('-m "gemini-2.5-pro"')
    expect(str).toContain('--yolo')
    expect(str).toContain('--skip-trust')
    expect(str).toContain('"Do work"')
    expect(str.lastIndexOf('"Do work"')).toBeGreaterThan(str.indexOf('--skip-trust'))
  })
})

describe('buildGeminiCommand', () => {
  it('includes --yolo and --skip-trust by default', () => {
    expect(buildGeminiCommand({})).toBe('gemini --yolo --skip-trust')
  })

  it('returns just "gemini" when all flags disabled and no prompt', () => {
    expect(buildGeminiCommand({ yolo: false, skipTrust: false })).toBe('gemini')
  })

  it('prefixes with "gemini " when flags are present', () => {
    const cmd = buildGeminiCommand({ model: 'gemini-2.5-pro' })
    expect(cmd).toMatch(/^gemini /)
    expect(cmd).toContain('-m "gemini-2.5-pro"')
  })

  it('full invocation with model + yolo + skip-trust + prompt', () => {
    const cmd = buildGeminiCommand({
      model: 'gemini-2.5-pro',
      yolo: true,
      skipTrust: true,
      prompt: 'Do work',
    })
    expect(cmd).toBe('gemini -m "gemini-2.5-pro" --yolo --skip-trust "Do work"')
  })

  it('prompt-only invocation with flags disabled', () => {
    const cmd = buildGeminiCommand({ yolo: false, skipTrust: false, prompt: 'Hello' })
    expect(cmd).toBe('gemini "Hello"')
  })
})
