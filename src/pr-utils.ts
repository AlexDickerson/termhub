// Pure utility functions for PR data, usable in both renderer and tests.
// No Electron or IPC dependencies.

import type { SessionPr } from './types'

/**
 * Predicate: should the Merge button be enabled for this PR?
 * Squash-merge only; CI must be green and PR must be open.
 */
export function isMergeEnabled(pr: SessionPr): boolean {
  return pr.state === 'open' && pr.ciState === 'success'
}
