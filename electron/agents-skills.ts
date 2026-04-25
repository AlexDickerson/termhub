// Discovery for ~/.claude/agents/*.md and ~/.claude/skills/*/SKILL.md.
// Read-only filesystem walks; no electron deps so this is testable with
// fixture directories.

import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import type { AgentDef, SkillDef } from '../src/types'

export function getAgentsDir(): string {
  return path.join(os.homedir(), '.claude', 'agents')
}

export function getSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills')
}

// Parse the YAML frontmatter of an agent (or SKILL.md) file and pull the
// `description:` field. Returns undefined when there's no frontmatter, no
// description line, or the file is unreadable.
function parseAgentDescription(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
    if (!m) return undefined
    const desc = /^description:\s*(.+)$/im.exec(m[1])
    if (!desc) return undefined
    return desc[1].trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

export function listAgents(): AgentDef[] {
  const dir = getAgentsDir()
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.error('[termhub] failed to list agents:', err)
    return []
  }
  const out: AgentDef[] = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.md')) continue
    const filePath = path.join(dir, entry)
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    const name = entry.replace(/\.md$/i, '')
    const description = parseAgentDescription(filePath)
    out.push({ name, path: filePath, description })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function listSkills(): SkillDef[] {
  const dir = getSkillsDir()
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.error('[termhub] failed to list skills:', err)
    return []
  }
  const out: SkillDef[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
    let stat
    try {
      stat = fs.statSync(skillMdPath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    const description = parseAgentDescription(skillMdPath)
    out.push({ name: entry.name, path: skillMdPath, description })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
