// The rule that matters here is "stop descending at a repo root". Orchestrator
// subagents create real checkouts under <repo>/.claude/worktrees/<branch>/, each
// with its own .git — a naive recursive scan finds 18 of them in one real
// ~/Repos and lists every one as a separate project.

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { discoverProjects } from './project-discovery'

const temps: string[] = []

function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'termhub-proj-')))
  temps.push(dir)
  return dir
}

// Creates <root>/<rel> and marks it a repo with a .git directory.
function makeRepo(root: string, rel: string): string {
  const dir = path.join(root, rel)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  return dir
}

function makeDir(root: string, rel: string): string {
  const dir = path.join(root, rel)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true })
})

describe('discoverProjects', () => {
  it('finds immediate child repos', () => {
    const anchor = tempDir()
    makeRepo(anchor, 'alpha')
    makeRepo(anchor, 'beta')

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual(['alpha', 'beta'])
  })

  it('returns absolute paths that match Session.repoRoot', () => {
    const anchor = tempDir()
    const repo = makeRepo(anchor, 'alpha')

    expect(discoverProjects(anchor)[0].path).toBe(repo)
  })

  it('finds repos nested one level under a grouping folder', () => {
    const anchor = tempDir()
    makeRepo(anchor, 'work/service-a')
    makeRepo(anchor, 'personal/toy')

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual(['service-a', 'toy'])
  })

  it('does NOT descend into a repo — worktrees are not separate projects', () => {
    const anchor = tempDir()
    const repo = makeRepo(anchor, 'termhub')
    // Mirrors the real layout an orchestrator subagent leaves behind.
    fs.mkdirSync(path.join(repo, '.claude', 'worktrees', 'feature-x', '.git'), {
      recursive: true,
    })
    fs.mkdirSync(path.join(repo, '.claude', 'worktrees', 'feature-y', '.git'), {
      recursive: true,
    })

    const found = discoverProjects(anchor)
    expect(found.map((p) => p.label)).toEqual(['termhub'])
  })

  it('does not treat a vendored checkout inside a repo as a project', () => {
    const anchor = tempDir()
    const repo = makeRepo(anchor, 'app')
    fs.mkdirSync(path.join(repo, 'vendor', 'lib', '.git'), { recursive: true })

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual(['app'])
  })

  it('skips node_modules and dot-directories', () => {
    const anchor = tempDir()
    makeRepo(anchor, 'real')
    fs.mkdirSync(path.join(anchor, 'node_modules', 'pkg', '.git'), { recursive: true })
    fs.mkdirSync(path.join(anchor, '.cache', 'thing', '.git'), { recursive: true })

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual(['real'])
  })

  it('recognises a .git file (worktree pointer) as a repo root', () => {
    const anchor = tempDir()
    const dir = makeDir(anchor, 'linked')
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n')

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual(['linked'])
  })

  it('ignores plain directories that are not repos', () => {
    const anchor = tempDir()
    makeRepo(anchor, 'repo')
    makeDir(anchor, 'just-notes')

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual(['repo'])
  })

  it('respects maxDepth', () => {
    const anchor = tempDir()
    makeRepo(anchor, 'a/b/deep')

    expect(discoverProjects(anchor, 2)).toEqual([])
    expect(discoverProjects(anchor, 3).map((p) => p.label)).toEqual(['deep'])
  })

  it('sorts by label', () => {
    const anchor = tempDir()
    makeRepo(anchor, 'zulu')
    makeRepo(anchor, 'alpha')
    makeRepo(anchor, 'mike')

    expect(discoverProjects(anchor).map((p) => p.label)).toEqual([
      'alpha',
      'mike',
      'zulu',
    ])
  })

  it('returns [] for a missing anchor rather than throwing', () => {
    expect(discoverProjects(path.join(tempDir(), 'does-not-exist'))).toEqual([])
  })

  it('returns [] for an empty anchor', () => {
    expect(discoverProjects(tempDir())).toEqual([])
  })
})
