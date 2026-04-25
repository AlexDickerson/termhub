import { describe, it, expect } from 'vitest'
import { mapJsonlStatus, parseSessionStatus, encodeProjectPath } from './status-watcher'

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

describe('parseSessionStatus', () => {
  it('returns undefined for empty string', () => {
    expect(parseSessionStatus('')).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseSessionStatus('{ broken')).toBeUndefined()
    expect(parseSessionStatus('not json at all')).toBeUndefined()
  })

  it('returns undefined when no status field present', () => {
    const content = JSON.stringify({ pid: 12345, cwd: 'D:\\', startedAt: 1234 })
    expect(parseSessionStatus(content)).toBeUndefined()
  })

  it('returns undefined when status is not a string', () => {
    expect(parseSessionStatus(JSON.stringify({ status: 42 }))).toBeUndefined()
    expect(parseSessionStatus(JSON.stringify({ status: null }))).toBeUndefined()
    expect(parseSessionStatus(JSON.stringify({ status: true }))).toBeUndefined()
  })

  it('returns undefined when status is an empty string', () => {
    expect(parseSessionStatus(JSON.stringify({ status: '' }))).toBeUndefined()
  })

  it('returns status from a real-world session record', () => {
    const content = JSON.stringify({
      pid: 28236,
      sessionId: '70ebba48-4fe8-4bc4-92e1-c975ab5ed2e6',
      cwd: 'D:\\',
      startedAt: 1777131167148,
      status: 'waiting',
      updatedAt: 1777131286192,
      waitingFor: 'approve Bash',
    })
    expect(parseSessionStatus(content)).toBe('waiting')
  })

  it('returns idle status', () => {
    expect(parseSessionStatus(JSON.stringify({ status: 'idle' }))).toBe('idle')
  })

  it('returns busy status', () => {
    expect(parseSessionStatus(JSON.stringify({ status: 'busy' }))).toBe('busy')
  })
})

describe('encodeProjectPath', () => {
  it('encodes a Windows absolute path', () => {
    // Each \, :, / becomes a dash: "E:\Apps\termhub" → "E--Apps-termhub"
    expect(encodeProjectPath('E:\\Apps\\termhub')).toBe('E--Apps-termhub')
  })

  it('encodes forward-slash paths the same way', () => {
    expect(encodeProjectPath('E:/Apps/termhub')).toBe('E--Apps-termhub')
  })

  it('handles a drive root', () => {
    expect(encodeProjectPath('D:\\')).toBe('D--')
  })

  it('matches the real directory name for the D:\\ cwd', () => {
    // The projects directory for D:\ is ~/.claude/projects/D--/
    expect(encodeProjectPath('D:\\')).toBe('D--')
  })

  it('encodes worktree paths correctly', () => {
    const input = 'E:\\Apps\\termhub\\.claude\\worktrees\\jsonl-session-status'
    expect(encodeProjectPath(input)).toBe('E--Apps-termhub--claude-worktrees-jsonl-session-status')
  })
})
