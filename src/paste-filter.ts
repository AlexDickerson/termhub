import type { SecretFinding } from './types'

// Show first 8 + last 4 chars so the user can identify which secret triggered
// without exposing the full value. Always truncates regardless of length —
// even "short" secrets should not be shown in full in the dialog.
export function truncateSecret(text: string): string {
  const PREFIX = 8
  const SUFFIX = 4
  if (text.length <= PREFIX + SUFFIX) {
    // Too short to truncate meaningfully; mask middle chars instead.
    return text.slice(0, PREFIX) + '...'
  }
  return text.slice(0, PREFIX) + '...' + text.slice(-SUFFIX)
}

// True when the paste should be blocked pending user confirmation.
// Callers: check setting first, then call scanForSecrets, then call this.
export function shouldShowPasteDialog(
  secretFilterEnabled: boolean,
  findings: SecretFinding[],
): boolean {
  return secretFilterEnabled && findings.length > 0
}
