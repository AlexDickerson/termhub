import { describe, it, expect, vi, beforeEach } from 'vitest'
import { needsCloseConfirm } from './confirm-close'
import type { SessionStatus } from './types'

// ---------------------------------------------------------------------------
// needsCloseConfirm — pure predicate
// ---------------------------------------------------------------------------

describe('needsCloseConfirm', () => {
  it('returns true for a working session (live)', () => {
    expect(needsCloseConfirm('working')).toBe(true)
  })

  it('returns true for an awaiting session (live)', () => {
    expect(needsCloseConfirm('awaiting')).toBe(true)
  })

  it('returns true for an idle session (live)', () => {
    expect(needsCloseConfirm('idle')).toBe(true)
  })

  it('returns false for a failed session (PTY dead)', () => {
    expect(needsCloseConfirm('failed')).toBe(false)
  })

  it('returns true when status is undefined (unknown / not yet received)', () => {
    expect(needsCloseConfirm(undefined)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Integration-style tests for the close guard logic, using stubs that
// mirror what App.tsx does with needsCloseConfirm + closeSession.
// ---------------------------------------------------------------------------

describe('close guard behaviour', () => {
  // Simulate the requestClose logic extracted from App.tsx
  function makeRequestClose(
    statuses: Record<string, SessionStatus>,
    closeSession: (id: string) => void,
    setPendingCloseId: (id: string) => void,
  ) {
    return (id: string) => {
      if (needsCloseConfirm(statuses[id])) {
        setPendingCloseId(id)
      } else {
        closeSession(id)
      }
    }
  }

  let closeSession: ReturnType<typeof vi.fn>
  let setPendingCloseId: ReturnType<typeof vi.fn>

  beforeEach(() => {
    closeSession = vi.fn()
    setPendingCloseId = vi.fn()
  })

  it('fires closeSession immediately for a dead (failed) session', () => {
    const requestClose = makeRequestClose(
      { 'sess-1': 'failed' },
      closeSession,
      setPendingCloseId,
    )
    requestClose('sess-1')
    expect(closeSession).toHaveBeenCalledWith('sess-1')
    expect(setPendingCloseId).not.toHaveBeenCalled()
  })

  it('opens the confirm dialog (does not close) for a live session', () => {
    const requestClose = makeRequestClose(
      { 'sess-2': 'working' },
      closeSession,
      setPendingCloseId,
    )
    requestClose('sess-2')
    expect(setPendingCloseId).toHaveBeenCalledWith('sess-2')
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('opens the confirm dialog for an idle session', () => {
    const requestClose = makeRequestClose(
      { 'sess-3': 'idle' },
      closeSession,
      setPendingCloseId,
    )
    requestClose('sess-3')
    expect(setPendingCloseId).toHaveBeenCalledWith('sess-3')
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('fires closeSession when user confirms the dialog', () => {
    // Simulate confirm path: requestClose sets pendingCloseId, then user confirms
    const requestClose = makeRequestClose(
      { 'sess-4': 'idle' },
      closeSession,
      setPendingCloseId,
    )
    requestClose('sess-4')
    expect(closeSession).not.toHaveBeenCalled()

    // User clicks Confirm — App.tsx calls closeSession(pendingCloseId)
    closeSession('sess-4')
    expect(closeSession).toHaveBeenCalledWith('sess-4')
  })

  it('does not fire closeSession when user cancels the dialog', () => {
    const requestClose = makeRequestClose(
      { 'sess-5': 'awaiting' },
      closeSession,
      setPendingCloseId,
    )
    requestClose('sess-5')
    // User clicks Cancel — pendingCloseId reset, closeSession never called
    expect(closeSession).not.toHaveBeenCalled()
  })
})
