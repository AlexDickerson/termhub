// detectRepoRoot decides the repoLabel shown on every sidebar row, and the
// worktree branch is the one that matters most here: orchestrator subagents
// run inside .claude/worktrees/<branch>/, and those sessions should still be
// labelled with the main checkout, not the worktree directory.

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { detectRepoRoot } from './repo-root'

const temps: string[] = []

function tempDir(): string {
  // realpathSync because macOS hands out /var/... which is a symlink to
  // /private/var — detectRepoRoot resolves paths, so the expectations must too.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'termhub-repo-')))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true })
})

describe('detectRepoRoot', () => {
  it('finds a repo when cwd is the root itself', () => {
    const root = tempDir()
    fs.mkdirSync(path.join(root, '.git'))

    expect(detectRepoRoot(root)).toEqual({
      repoRoot: root,
      repoLabel: path.basename(root),
    })
  })

  it('walks upward from a nested directory', () => {
    const root = tempDir()
    fs.mkdirSync(path.join(root, '.git'))
    const nested = path.join(root, 'src', 'deep', 'deeper')
    fs.mkdirSync(nested, { recursive: true })

    expect(detectRepoRoot(nested)).toEqual({
      repoRoot: root,
      repoLabel: path.basename(root),
    })
  })

  it('returns null when no .git exists anywhere up the tree', () => {
    const plain = tempDir()
    expect(detectRepoRoot(plain)).toBeNull()
  })

  it('resolves a worktree back to the main checkout', () => {
    // Mirrors the real layout: <main>/.git/worktrees/<name> is the gitdir,
    // and <main>/.claude/worktrees/<name>/.git is a file pointing at it.
    const main = tempDir()
    const gitdir = path.join(main, '.git', 'worktrees', 'feature-x')
    fs.mkdirSync(gitdir, { recursive: true })

    const worktree = path.join(main, '.claude', 'worktrees', 'feature-x')
    fs.mkdirSync(worktree, { recursive: true })
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitdir}\n`)

    expect(detectRepoRoot(worktree)).toEqual({
      repoRoot: main,
      repoLabel: path.basename(main),
    })
  })

  it('accepts a relative gitdir in the .git file', () => {
    const main = tempDir()
    const gitdir = path.join(main, '.git', 'worktrees', 'rel')
    fs.mkdirSync(gitdir, { recursive: true })

    const worktree = path.join(main, 'wt')
    fs.mkdirSync(worktree)
    // git writes relative gitdir paths in some configurations
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../.git/worktrees/rel\n')

    expect(detectRepoRoot(worktree)).toEqual({
      repoRoot: main,
      repoLabel: path.basename(main),
    })
  })

  it('keeps walking when the .git file has no gitdir line', () => {
    const root = tempDir()
    fs.mkdirSync(path.join(root, '.git'))
    const inner = path.join(root, 'inner')
    fs.mkdirSync(inner)
    fs.writeFileSync(path.join(inner, '.git'), 'this is not a gitdir pointer\n')

    // Falls through to the ancestor's real .git directory rather than
    // returning null.
    expect(detectRepoRoot(inner)).toEqual({
      repoRoot: root,
      repoLabel: path.basename(root),
    })
  })

  it('tolerates trailing whitespace around the gitdir path', () => {
    const main = tempDir()
    const gitdir = path.join(main, '.git', 'worktrees', 'ws')
    fs.mkdirSync(gitdir, { recursive: true })
    const worktree = path.join(main, 'wt')
    fs.mkdirSync(worktree)
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir:   ${gitdir}   \n`)

    expect(detectRepoRoot(worktree)?.repoRoot).toBe(main)
  })

  it('prefers the nearest .git when repos are nested', () => {
    const outer = tempDir()
    fs.mkdirSync(path.join(outer, '.git'))
    const inner = path.join(outer, 'vendor', 'lib')
    fs.mkdirSync(inner, { recursive: true })
    fs.mkdirSync(path.join(inner, '.git'))

    expect(detectRepoRoot(inner)?.repoRoot).toBe(inner)
  })
})
