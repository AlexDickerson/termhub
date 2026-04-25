// Pure helpers for fetching and parsing GitHub PR data via the `gh` CLI.
// No Electron or IPC dependencies — importable in tests without mocking.

import { execFile } from 'node:child_process'
import type { SessionPr } from '../src/types'

// Raw shape returned by `gh pr list --json ...`
type GhStatusCheckRollup = {
  state: string  // e.g. 'SUCCESS', 'FAILURE', 'PENDING', 'ERROR'
}

type GhPrEntry = {
  number: unknown
  title: unknown
  state: unknown
  url: unknown
  statusCheckRollup: unknown
}

/** Build the in-memory cache key for a given working directory + branch. */
export function buildCacheKey(cwd: string, branch: string): string {
  return `${cwd}::${branch}`
}

/**
 * Map a GitHub PR state string (from `gh`) to our `SessionPr['state']`.
 * gh returns 'OPEN', 'MERGED', 'CLOSED'.
 */
export function parseGhPrState(raw: string): SessionPr['state'] {
  const upper = raw.toUpperCase()
  if (upper === 'OPEN') return 'open'
  if (upper === 'MERGED') return 'merged'
  return 'closed'
}

/**
 * Map the statusCheckRollup array (from `gh --json statusCheckRollup`) to
 * our coarser `ciState`.
 *
 * gh's rollup entries each have a `state` property. We look at all entries:
 *   - any 'FAILURE' or 'ERROR'      → 'failure'
 *   - any 'PENDING' or 'IN_PROGRESS'→ 'pending'
 *   - all 'SUCCESS'                 → 'success'
 *   - empty array                   → null (no CI configured)
 */
export function parseGhCiState(
  rollup: unknown,
): SessionPr['ciState'] {
  if (!Array.isArray(rollup) || rollup.length === 0) return null
  let anyPending = false
  for (const entry of rollup as GhStatusCheckRollup[]) {
    if (typeof entry.state !== 'string') continue
    const s = entry.state.toUpperCase()
    if (s === 'FAILURE' || s === 'ERROR' || s === 'TIMED_OUT') return 'failure'
    if (s === 'PENDING' || s === 'IN_PROGRESS' || s === 'QUEUED' || s === 'WAITING') {
      anyPending = true
    }
  }
  return anyPending ? 'pending' : 'success'
}

/**
 * Parse the raw JSON array from `gh pr list --json number,title,state,url,statusCheckRollup`
 * into `SessionPr[]`. Returns an empty array on any parse failure.
 */
export function parseGhPrListOutput(raw: string): SessionPr[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const results: SessionPr[] = []
  for (const entry of parsed as GhPrEntry[]) {
    if (
      typeof entry.number !== 'number' ||
      typeof entry.title !== 'string' ||
      typeof entry.state !== 'string' ||
      typeof entry.url !== 'string'
    ) {
      continue
    }
    results.push({
      number: entry.number,
      title: entry.title,
      state: parseGhPrState(entry.state),
      url: entry.url,
      ciState: parseGhCiState(entry.statusCheckRollup),
    })
  }
  return results
}

/**
 * Predicate: should the Merge button be enabled?
 * Only allow merging when CI is confirmed green.
 */
export function isMergeEnabled(pr: SessionPr): boolean {
  return pr.state === 'open' && pr.ciState === 'success'
}

/**
 * Resolve the current git branch for the given working directory.
 * Rejects if git is unavailable or cwd is not a git repo.
 */
export function getGitBranch(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { shell: false },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`git rev-parse failed: ${stderr.trim() || err.message}`))
          return
        }
        const branch = stdout.trim()
        if (!branch || branch === 'HEAD') {
          reject(new Error(`detached HEAD or no branch in ${cwd}`))
          return
        }
        resolve(branch)
      },
    )
  })
}

/**
 * Run `gh pr list` for the given branch from the given cwd.
 * Rejects if gh is unavailable.
 */
export function fetchGhPrList(cwd: string, branch: string): Promise<SessionPr[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      [
        'pr', 'list',
        '--head', branch,
        '--json', 'number,title,state,url,statusCheckRollup',
        '--limit', '5',
      ],
      { cwd, shell: false },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`gh pr list failed: ${stderr.trim() || err.message}`))
          return
        }
        resolve(parseGhPrListOutput(stdout))
      },
    )
  })
}

/**
 * Spawn `gh pr merge <number> --squash --delete-branch` in the given cwd.
 * Resolves on success, rejects on failure.
 */
export function runGhPrMerge(cwd: string, prNumber: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['pr', 'merge', String(prNumber), '--squash', '--delete-branch'],
      { cwd, shell: false },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`gh pr merge failed: ${stderr.trim() || err.message}`))
          return
        }
        resolve()
      },
    )
  })
}
