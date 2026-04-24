import { useCallback, useEffect, useState } from 'react'
import type { SkillDef } from './types'

export function SkillList() {
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.termhub.listSkills()
      setSkills(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading && skills.length === 0) {
    return <p className="hint">Loading…</p>
  }
  if (error) {
    return <p className="hint error">{error}</p>
  }
  if (skills.length === 0) {
    return (
      <p className="hint">
        No skills found. Each skill lives in <code>~/.claude/skills/&lt;name&gt;/SKILL.md</code>.
      </p>
    )
  }

  return (
    <ul className="entry-list">
      {skills.map((s) => (
        <li
          key={s.path}
          className="entry-item"
          onClick={() => window.termhub.openSkill(s.path)}
          title={s.path}
        >
          <div className="entry-name">{s.name}</div>
          {s.description ? <div className="entry-description">{s.description}</div> : null}
        </li>
      ))}
    </ul>
  )
}
