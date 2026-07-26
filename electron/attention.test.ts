import { describe, it, expect } from 'vitest'
import {
  needsAttention,
  countNeedingAttention,
  shouldNotify,
  notificationText,
} from './attention'
import type { SessionStatus } from '../src/types'

const ALL: SessionStatus[] = ['working', 'awaiting', 'idle', 'failed']

describe('needsAttention', () => {
  it('flags awaiting and failed', () => {
    expect(needsAttention('awaiting')).toBe(true)
    expect(needsAttention('failed')).toBe(true)
  })

  it('does not flag working or idle', () => {
    // idle is the normal end state for every worker — notifying on it would
    // fire constantly and train the user to ignore notifications.
    expect(needsAttention('working')).toBe(false)
    expect(needsAttention('idle')).toBe(false)
  })
})

describe('countNeedingAttention', () => {
  it('counts only the flagged statuses', () => {
    expect(countNeedingAttention(['awaiting', 'working', 'failed', 'idle'])).toBe(2)
  })

  it('is 0 for an empty fleet', () => {
    expect(countNeedingAttention([])).toBe(0)
  })

  it('is 0 when everything is healthy', () => {
    expect(countNeedingAttention(['working', 'idle', 'working'])).toBe(0)
  })

  it('counts duplicates independently', () => {
    expect(countNeedingAttention(['awaiting', 'awaiting', 'awaiting'])).toBe(3)
  })
})

describe('shouldNotify', () => {
  it('fires when an unfocused session becomes awaiting', () => {
    expect(shouldNotify({ previous: 'working', next: 'awaiting', windowFocused: false })).toBe(true)
  })

  it('fires when an unfocused session fails', () => {
    expect(shouldNotify({ previous: 'working', next: 'failed', windowFocused: false })).toBe(true)
  })

  it('stays quiet when the window is focused — the sidebar dot is the signal', () => {
    expect(shouldNotify({ previous: 'working', next: 'awaiting', windowFocused: true })).toBe(false)
  })

  it('does not re-fire between two attention states', () => {
    // awaiting -> failed is still "needs you"; the user was already told.
    expect(shouldNotify({ previous: 'awaiting', next: 'failed', windowFocused: false })).toBe(false)
  })

  it('never fires on a transition into a healthy state', () => {
    for (const previous of ALL) {
      for (const next of ['working', 'idle'] as const) {
        expect(
          shouldNotify({ previous, next, windowFocused: false }),
          `${previous} -> ${next}`,
        ).toBe(false)
      }
    }
  })

  it('fires again after recovering and blocking a second time', () => {
    expect(shouldNotify({ previous: 'awaiting', next: 'working', windowFocused: false })).toBe(false)
    expect(shouldNotify({ previous: 'working', next: 'awaiting', windowFocused: false })).toBe(true)
  })
})

describe('notificationText', () => {
  it('uses the session name when set', () => {
    const { body } = notificationText({ name: 'worker-3', cwd: '/repo', status: 'awaiting' })
    expect(body).toContain('worker-3')
    expect(body).not.toContain('/repo')
  })

  it('falls back to cwd when the name is missing or blank', () => {
    expect(notificationText({ cwd: '/repo/a', status: 'awaiting' }).body).toContain('/repo/a')
    expect(
      notificationText({ name: '   ', cwd: '/repo/b', status: 'awaiting' }).body,
    ).toContain('/repo/b')
  })

  it('distinguishes failed from awaiting', () => {
    const awaiting = notificationText({ cwd: '/r', status: 'awaiting' })
    const failed = notificationText({ cwd: '/r', status: 'failed' })
    expect(awaiting.title).not.toBe(failed.title)
    expect(failed.body).toContain('exited')
    expect(awaiting.body).toContain('input')
  })
})
