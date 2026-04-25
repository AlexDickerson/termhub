import { describe, it, expect } from 'vitest'
import { mapJsonlStatus, parseLatestStatus, encodeProjectPath } from './status-watcher'

describe('mapJsonlStatus', () => {
  it('maps idle to idle', () => {
    expect(mapJsonlStatus('idle')).toBe('idle')
  })

  it('maps busy to working', () => {
    expect(mapJsonlStatus('busy')).toBe('working')
  })

  it('maps waiting to awaiting', () => {
    expect(mapJsonlStatus('waiting')).toBe('awaiting')
  })

  it('falls back to working for unknown values', () => {
    expect(mapJsonlStatus('unknown')).toBe('working')
    expect(mapJsonlStatus('')).toBe('working')
    expect(mapJsonlStatus('IDLE')).toBe('working')
    expect(mapJsonlStatus('active')).toBe('working')
  })
})

describe('parseLatestStatus', () => {
  it('returns undefined for empty chunk', () => {
    expect(parseLatestStatus('')).toBeUndefined()
  })

  it('returns undefined when no status field present', () => {
    const chunk = JSON.stringify({ type: 'user', message: 'hello' }) + '\n'
    expect(parseLatestStatus(chunk)).toBeUndefined()
  })

  it('returns status from a single record', () => {
    const line = JSON.stringify({ type: 'system', status: 'idle' })
    expect(parseLatestStatus(line)).toBe('idle')
  })

  it('returns the last status when multiple records have status', () => {
    const chunk = [
      JSON.stringify({ type: 'system', status: 'busy' }),
      JSON.stringify({ type: 'system', status: 'idle' }),
    ].join('\n')
    expect(parseLatestStatus(chunk)).toBe('idle')
  })

  it('skips records without a status field', () => {
    const chunk = [
      JSON.stringify({ type: 'user', message: 'hi' }),
      JSON.stringify({ type: 'system', status: 'waiting' }),
      JSON.stringify({ type: 'assistant', message: 'response' }),
    ].join('\n')
    expect(parseLatestStatus(chunk)).toBe('waiting')
  })

  it('ignores malformed JSON lines', () => {
    const chunk = [
      'this is not json',
      JSON.stringify({ type: 'system', status: 'busy' }),
      '{ broken',
    ].join('\n')
    expect(parseLatestStatus(chunk)).toBe('busy')
  })

  it('ignores empty lines', () => {
    const chunk = '\n\n' + JSON.stringify({ status: 'idle' }) + '\n\n'
    expect(parseLatestStatus(chunk)).toBe('idle')
  })

  it('ignores records where status is not a string', () => {
    const chunk = JSON.stringify({ status: 42 }) + '\n' + JSON.stringify({ status: 'busy' })
    expect(parseLatestStatus(chunk)).toBe('busy')
  })
})

describe('encodeProjectPath', () => {
  it('encodes a Windows absolute path', () => {
    // e.g. "E:\Apps\termhub" → "E--Apps-termhub"
    expect(encodeProjectPath('E:\\Apps\\termhub')).toBe('E--Apps-termhub')
  })

  it('encodes a forward-slash path', () => {
    expect(encodeProjectPath('E:/Apps/termhub')).toBe('E--Apps-termhub')
  })

  it('handles a simple drive root', () => {
    // E:\ → each special char becomes a dash → 'E--', no trailing strip
    expect(encodeProjectPath('E:\\')).toBe('E--')
  })

  it('encodes worktree paths correctly', () => {
    const input = 'E:\\Apps\\termhub\\.claude\\worktrees\\jsonl-session-status'
    const result = encodeProjectPath(input)
    expect(result).toBe('E--Apps-termhub--claude-worktrees-jsonl-session-status')
  })
})
