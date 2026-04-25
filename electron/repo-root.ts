import * as path from 'node:path'
import * as fs from 'node:fs'

// Walk upward from cwd looking for a .git entry (file or directory).
// If found as a file (worktree), parse the `gitdir:` line to resolve the
// main checkout root (two dirname()s up from the worktree-specific gitdir).
// Returns { repoRoot, repoLabel } or null when no repo is found.
export function detectRepoRoot(
  cwd: string,
): { repoRoot: string; repoLabel: string } | null {
  let current = path.resolve(cwd)
  while (true) {
    const gitEntry = path.join(current, '.git')
    let stat: fs.Stats | null = null
    try {
      stat = fs.statSync(gitEntry)
    } catch {
      // not found at this level — keep walking
    }
    if (stat !== null) {
      if (stat.isDirectory()) {
        // Normal checkout: .git directory means this directory IS the repo root
        return { repoRoot: current, repoLabel: path.basename(current) }
      }
      if (stat.isFile()) {
        // Git worktree: .git file contains "gitdir: <path>"
        try {
          const contents = fs.readFileSync(gitEntry, 'utf8')
          const m = /^gitdir:\s*(.+)$/m.exec(contents)
          if (m) {
            // Typically: <main-checkout>/.git/worktrees/<name>
            // Two dirname()s up: strip /<name> then /worktrees → <main-checkout>/.git
            // One more dirname(): the main checkout root
            const worktreeGitDir = path.resolve(current, m[1].trim())
            const mainGit = path.dirname(path.dirname(worktreeGitDir))
            const mainCheckout = path.dirname(mainGit)
            return {
              repoRoot: mainCheckout,
              repoLabel: path.basename(mainCheckout),
            }
          }
        } catch {
          // unreadable .git file — treat as no-repo
        }
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      // Reached filesystem root — no repo found
      return null
    }
    current = parent
  }
}
