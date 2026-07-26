import type { ProjectDef, Session } from './types'

// One row-group in the sidebar. A group is either a discovered project (which
// may have zero live sessions — that's the point) or an ad-hoc group for a
// session running somewhere outside the anchored repos directory.
export type SidebarGroup = {
  key: string
  label: string
  sessions: Session[]
  // Discovered under the anchor directory. Drives the "start a session here"
  // affordance on empty groups, and the ordering below.
  isProject: boolean
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

// Merge discovered projects with live sessions into the sidebar's row model.
//
// Sessions land in a project group when their repoRoot matches the project
// path. That's what makes worktree sessions behave: detectRepoRoot resolves a
// worktree back to the main checkout, so a session running in
// <repo>/.claude/worktrees/foo groups under <repo> rather than spawning a
// group of its own.
//
// Projects sort first (alphabetically), then non-project groups. Ordering is
// deliberately independent of session activity — a sidebar that reorders
// itself as sessions start and stop is hard to build muscle memory against.
export function buildSidebarGroups(
  projects: readonly ProjectDef[],
  sessions: readonly Session[],
): SidebarGroup[] {
  const byKey = new Map<string, SidebarGroup>()

  for (const p of projects) {
    byKey.set(p.path, { key: p.path, label: p.label, sessions: [], isProject: true })
  }

  for (const s of sessions) {
    const key = s.repoRoot ?? s.cwd
    const existing = byKey.get(key)
    if (existing) {
      existing.sessions.push(s)
      continue
    }
    byKey.set(key, {
      key,
      label: s.repoLabel ?? basename(s.cwd),
      sessions: [s],
      isProject: false,
    })
  }

  const groups = [...byKey.values()]
  groups.sort((a, b) => {
    if (a.isProject !== b.isProject) return a.isProject ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  return groups
}
