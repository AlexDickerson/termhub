import { describe, it, expect } from 'vitest'
import {
  isClaudeModelName,
  buildCodexArgs,
  buildCodexCommand,
  DEFAULT_CODEX_BYPASS_APPROVALS,
} from './codex-command'

describe('isClaudeModelName', () => {
  it('returns true for claude- prefixed models', () => {
    expect(isClaudeModelName('claude-opus-4-7')).toBe(true)
    expect(isClaudeModelName('claude-sonnet-4-6')).toBe(true)
    expect(isClaudeModelName('claude-haiku-4-5')).toBe(true)
    expect(isClaudeModelName('claude-3-5-sonnet-20241022')).toBe(true)
  })

  it('returns false for codex / openai model names', () => {
    expect(isClaudeModelName('o3')).toBe(false)
    expect(isClaudeModelName('gpt-4o')).toBe(false)
    expect(isClaudeModelName('o4-mini')).toBe(false)
    expect(isClaudeModelName('o1-preview')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isClaudeModelName('')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isClaudeModelName('Claude-opus-4-7')).toBe(true)
    expect(isClaudeModelName('CLAUDE-sonnet-4-6')).toBe(true)
  })

  it('does not match when "claude-" appears mid-string', () => {
    expect(isClaudeModelName('notclaude-something')).toBe(false)
    expect(isClaudeModelName('my-claude-model')).toBe(false)
  })
})

describe('buildCodexArgs', () => {
  it('DEFAULT_CODEX_BYPASS_APPROVALS is true', () => {
    expect(DEFAULT_CODEX_BYPASS_APPROVALS).toBe(true)
  })

  it('includes --dangerously-bypass-approvals-and-sandbox by default (no opts)', () => {
    // Default prevents directory-trust and command-approval prompts from blocking
    // MCP-spawned autonomous sessions.
    const flags = buildCodexArgs({})
    expect(flags).toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('includes --dangerously-bypass-approvals-and-sandbox when explicitly true', () => {
    const flags = buildCodexArgs({ dangerouslyBypassApprovals: true })
    expect(flags).toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('omits bypass flag when explicitly false (caller opts out)', () => {
    const flags = buildCodexArgs({ dangerouslyBypassApprovals: false })
    expect(flags).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('includes -m flag when model is provided', () => {
    const flags = buildCodexArgs({ model: 'o3' })
    expect(flags.some((f) => f.includes('-m') && f.includes('o3'))).toBe(true)
  })

  it('quotes the model name', () => {
    const flags = buildCodexArgs({ model: 'o3' })
    expect(flags.some((f) => f === '-m "o3"')).toBe(true)
  })

  it('omits -m when model is empty', () => {
    const flags = buildCodexArgs({ model: '' })
    expect(flags.join(' ')).not.toContain('-m')
  })

  it('includes prompt as last quoted positional arg', () => {
    const flags = buildCodexArgs({ prompt: 'Do the task' })
    expect(flags[flags.length - 1]).toBe('"Do the task"')
  })

  it('puts prompt after all other flags', () => {
    const flags = buildCodexArgs({
      model: 'o3',
      dangerouslyBypassApprovals: true,
      prompt: 'Hello',
    })
    const promptIdx = flags.findIndex((f) => f.includes('Hello'))
    const modelIdx = flags.findIndex((f) => f.includes('-m'))
    const bypassIdx = flags.findIndex((f) =>
      f.includes('--dangerously-bypass-approvals-and-sandbox'),
    )
    expect(promptIdx).toBe(flags.length - 1)
    expect(modelIdx).toBeLessThan(promptIdx)
    expect(bypassIdx).toBeLessThan(promptIdx)
  })

  it('omits prompt when empty string', () => {
    const flags = buildCodexArgs({ dangerouslyBypassApprovals: false, prompt: '' })
    expect(flags).toEqual([])
  })

  it('omits prompt when undefined', () => {
    const flags = buildCodexArgs({ dangerouslyBypassApprovals: false })
    expect(flags).toEqual([])
  })

  it('builds the full flag set in the right order', () => {
    const flags = buildCodexArgs({
      model: 'o3',
      dangerouslyBypassApprovals: true,
      prompt: 'Test prompt',
    })
    const str = flags.join(' ')
    expect(str).toContain('-m "o3"')
    expect(str).toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(str).toContain('"Test prompt"')
    // Prompt is last
    expect(str.lastIndexOf('"Test prompt"')).toBeGreaterThan(
      str.indexOf('--dangerously-bypass-approvals-and-sandbox'),
    )
  })
})

describe('buildCodexCommand', () => {
  it('includes bypass flag by default (no opts)', () => {
    // Default prevents directory-trust prompts from blocking autonomous sessions.
    expect(buildCodexCommand({})).toBe(
      'codex --dangerously-bypass-approvals-and-sandbox',
    )
  })

  it('returns just "codex" when bypass explicitly disabled and no other opts', () => {
    expect(buildCodexCommand({ dangerouslyBypassApprovals: false })).toBe('codex')
  })

  it('prefixes with "codex " when flags are present', () => {
    const cmd = buildCodexCommand({ model: 'o3' })
    expect(cmd).toMatch(/^codex /)
    expect(cmd).toContain('-m "o3"')
  })

  it('full invocation with model + bypass + prompt', () => {
    const cmd = buildCodexCommand({
      model: 'o3',
      dangerouslyBypassApprovals: true,
      prompt: 'Do work',
    })
    expect(cmd).toBe(
      'codex -m "o3" --dangerously-bypass-approvals-and-sandbox "Do work"',
    )
  })

  it('prompt-only invocation with bypass explicitly disabled', () => {
    const cmd = buildCodexCommand({
      dangerouslyBypassApprovals: false,
      prompt: 'Hello codex',
    })
    expect(cmd).toBe('codex "Hello codex"')
  })
})
