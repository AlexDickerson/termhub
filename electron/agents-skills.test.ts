// Feeds the right-panel agent/skill lists and the new-session dialog's agent
// picker. The frontmatter parser is the fiddly part — descriptions come from
// files the user hand-writes, so malformed input has to degrade to "no
// description" rather than dropping the entry.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let home = ''

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => home }
})

// Static import is fine: vi.mock is hoisted above it, and the factory only
// reads `home` when homedir() is actually called (inside a test), not at
// module-evaluation time.
import { listAgents, listSkills, getAgentsDir, getSkillsDir } from './agents-skills'

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'termhub-agents-'))
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

function writeAgent(name: string, contents: string): void {
  const dir = getAgentsDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), contents)
}

function writeSkill(name: string, contents: string): void {
  const dir = path.join(getSkillsDir(), name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), contents)
}

describe('listAgents', () => {
  it('returns [] when ~/.claude/agents does not exist', () => {
    expect(listAgents()).toEqual([])
  })

  it('lists .md files, stripping the extension for the name', () => {
    writeAgent('orchestrator.md', '# hi')
    expect(listAgents()).toEqual([
      { name: 'orchestrator', path: path.join(getAgentsDir(), 'orchestrator.md'), description: undefined },
    ])
  })

  it('extracts description from YAML frontmatter', () => {
    writeAgent('a.md', '---\nname: a\ndescription: Does a thing\n---\n\nbody')
    expect(listAgents()[0].description).toBe('Does a thing')
  })

  it('strips surrounding quotes from the description', () => {
    writeAgent('a.md', '---\ndescription: "Quoted desc"\n---\n')
    expect(listAgents()[0].description).toBe('Quoted desc')
    writeAgent('b.md', "---\ndescription: 'Single quoted'\n---\n")
    expect(listAgents().find((a) => a.name === 'b')?.description).toBe('Single quoted')
  })

  it('handles CRLF frontmatter', () => {
    writeAgent('a.md', '---\r\ndescription: Windows file\r\n---\r\nbody')
    expect(listAgents()[0].description).toBe('Windows file')
  })

  it('keeps the entry with no description when frontmatter is absent', () => {
    writeAgent('a.md', 'just a heading, no frontmatter')
    expect(listAgents()).toHaveLength(1)
    expect(listAgents()[0].description).toBeUndefined()
  })

  it('ignores non-markdown files', () => {
    writeAgent('a.md', 'x')
    writeAgent('notes.txt', 'x')
    writeAgent('config.json', '{}')
    expect(listAgents().map((a) => a.name)).toEqual(['a'])
  })

  it('accepts uppercase .MD', () => {
    writeAgent('Legacy.MD', 'x')
    expect(listAgents().map((a) => a.name)).toEqual(['Legacy'])
  })

  it('ignores directories that happen to end in .md', () => {
    fs.mkdirSync(path.join(getAgentsDir(), 'weird.md'), { recursive: true })
    expect(listAgents()).toEqual([])
  })

  it('sorts by name', () => {
    writeAgent('zeta.md', 'x')
    writeAgent('alpha.md', 'x')
    writeAgent('mid.md', 'x')
    expect(listAgents().map((a) => a.name)).toEqual(['alpha', 'mid', 'zeta'])
  })
})

describe('listSkills', () => {
  it('returns [] when ~/.claude/skills does not exist', () => {
    expect(listSkills()).toEqual([])
  })

  it('lists directories containing SKILL.md, named for the directory', () => {
    writeSkill('deploy', '---\ndescription: Ships it\n---\n')
    expect(listSkills()).toEqual([
      {
        name: 'deploy',
        path: path.join(getSkillsDir(), 'deploy', 'SKILL.md'),
        description: 'Ships it',
      },
    ])
  })

  it('skips directories without a SKILL.md', () => {
    writeSkill('real', 'x')
    fs.mkdirSync(path.join(getSkillsDir(), 'empty'), { recursive: true })
    expect(listSkills().map((s) => s.name)).toEqual(['real'])
  })

  it('skips loose files at the skills root', () => {
    writeSkill('real', 'x')
    fs.writeFileSync(path.join(getSkillsDir(), 'stray.md'), 'x')
    expect(listSkills().map((s) => s.name)).toEqual(['real'])
  })

  it('sorts by name', () => {
    writeSkill('zulu', 'x')
    writeSkill('alpha', 'x')
    expect(listSkills().map((s) => s.name)).toEqual(['alpha', 'zulu'])
  })
})
