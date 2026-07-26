import { describe, it, expect } from 'vitest'
import { buildSidebarGroups } from './sidebar-groups'
import type { ProjectDef, Session } from './types'

const project = (label: string, path = `/repos/${label}`): ProjectDef => ({ path, label })

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id,
  cwd: '/repos/alpha',
  repoRoot: '/repos/alpha',
  repoLabel: 'alpha',
  ...over,
})

describe('buildSidebarGroups', () => {
  it('lists a discovered project even with no sessions — that is the point', () => {
    const groups = buildSidebarGroups([project('alpha')], [])

    expect(groups).toEqual([
      { key: '/repos/alpha', label: 'alpha', sessions: [], isProject: true },
    ])
  })

  it('merges a session into its project by repoRoot', () => {
    const s = session('s1')
    const groups = buildSidebarGroups([project('alpha')], [s])

    expect(groups).toHaveLength(1)
    expect(groups[0].sessions).toEqual([s])
    expect(groups[0].isProject).toBe(true)
  })

  it('groups a worktree session under its parent project', () => {
    // detectRepoRoot resolves a worktree back to the main checkout, so the
    // session carries the parent repoRoot even though its cwd is nested.
    const s = session('s1', {
      cwd: '/repos/alpha/.claude/worktrees/feature-x',
      repoRoot: '/repos/alpha',
    })
    const groups = buildSidebarGroups([project('alpha')], [s])

    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('/repos/alpha')
    expect(groups[0].sessions).toEqual([s])
  })

  it('creates an ad-hoc group for a session outside the anchor', () => {
    const outside = session('s1', {
      cwd: '/elsewhere/thing',
      repoRoot: '/elsewhere/thing',
      repoLabel: 'thing',
    })
    const groups = buildSidebarGroups([project('alpha')], [outside])

    expect(groups.map((g) => [g.label, g.isProject])).toEqual([
      ['alpha', true],
      ['thing', false],
    ])
  })

  it('falls back to the cwd basename when a stray session has no repo label', () => {
    const loose = session('s1', {
      cwd: '/tmp/scratch',
      repoRoot: undefined,
      repoLabel: undefined,
    })
    const groups = buildSidebarGroups([], [loose])

    expect(groups[0].label).toBe('scratch')
    expect(groups[0].key).toBe('/tmp/scratch')
  })

  it('sorts projects before ad-hoc groups, each alphabetically', () => {
    const groups = buildSidebarGroups(
      [project('zulu'), project('alpha')],
      [
        session('s1', { cwd: '/x/yankee', repoRoot: '/x/yankee', repoLabel: 'yankee' }),
        session('s2', { cwd: '/x/bravo', repoRoot: '/x/bravo', repoLabel: 'bravo' }),
      ],
    )

    expect(groups.map((g) => g.label)).toEqual(['alpha', 'zulu', 'bravo', 'yankee'])
  })

  it('ordering does not depend on session activity', () => {
    // A sidebar that reorders as sessions start and stop is hard to build
    // muscle memory against, so a busy project must not jump to the top.
    const projects = [project('alpha'), project('beta')]
    const idle = buildSidebarGroups(projects, []).map((g) => g.label)
    const busy = buildSidebarGroups(projects, [
      session('s1', { cwd: '/repos/beta', repoRoot: '/repos/beta', repoLabel: 'beta' }),
    ]).map((g) => g.label)

    expect(busy).toEqual(idle)
  })

  it('keeps multiple sessions in one project group, in order', () => {
    const a = session('s1')
    const b = session('s2')
    const groups = buildSidebarGroups([project('alpha')], [a, b])

    expect(groups[0].sessions.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('returns [] when there are no projects and no sessions', () => {
    expect(buildSidebarGroups([], [])).toEqual([])
  })

  it('still works with no anchor configured — sessions only', () => {
    const s = session('s1')
    const groups = buildSidebarGroups([], [s])

    expect(groups).toEqual([
      { key: '/repos/alpha', label: 'alpha', sessions: [s], isProject: false },
    ])
  })
})
