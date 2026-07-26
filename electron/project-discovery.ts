// Finds the projects under the user's anchored "repos" directory so the
// sidebar can list everything they work on, not just what happens to have a
// live session.
//
// The walk stops descending as soon as it finds a repo. That single rule is
// what keeps git worktrees out: orchestrator subagents create real checkouts
// under <repo>/.claude/worktrees/<branch>/, each with its own .git, and a
// naive recursive scan lists all of them as separate projects (18 of them in
// one real ~/Repos). A worktree belongs to its parent repo, not beside it.

import * as path from 'node:path'
import * as fs from 'node:fs'

export type ProjectDef = {
  // Absolute path to the repo root. Matches Session.repoRoot, which is how
  // the sidebar merges live sessions into their project group.
  path: string
  label: string
}

// Anchor's immediate children are depth 1. The default allows one level of
// grouping (~/Repos/work/foo) without turning into a full-tree crawl.
export const DEFAULT_MAX_DEPTH = 2

// Never descend into these. node_modules is the expensive one; dot-directories
// cover .claude/worktrees along with every other tool's scratch space.
function isSkippable(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.')
}

function isRepo(dir: string): boolean {
  try {
    // .git is a directory in a normal checkout and a file in a worktree.
    // Either marks a repo root.
    fs.statSync(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

export function discoverProjects(
  anchorDir: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): ProjectDef[] {
  const found: ProjectDef[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      // Unreadable directory (permissions, unmounted volume) — skip it rather
      // than failing the whole scan.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[termhub:projects] could not read ${dir}:`, err)
      }
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isSkippable(entry.name)) continue
      const child = path.join(dir, entry.name)
      if (isRepo(child)) {
        found.push({ path: child, label: entry.name })
        // Do NOT descend — nested checkouts under a repo are its worktrees
        // or vendored copies, not sibling projects.
        continue
      }
      walk(child, depth + 1)
    }
  }

  walk(anchorDir, 1)
  found.sort((a, b) => a.label.localeCompare(b.label))
  console.log(
    `[termhub:projects] discovered ${found.length} project(s) under ${anchorDir}`,
  )
  return found
}
