import type { SessionStatus } from './types'

// Returns true when the session requires a confirmation dialog before closing.
// Dead sessions (PTY exited with non-zero code, status 'failed') can be
// dismissed immediately — there is nothing left to lose.
export function needsCloseConfirm(status: SessionStatus | undefined): boolean {
  return status !== 'failed'
}
