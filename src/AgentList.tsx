import { useCallback, useEffect, useState } from 'react'
import type { AgentDef } from './types'

export function AgentList() {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.termhub.listAgents()
      setAgents(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading && agents.length === 0) {
    return <p className="hint">Loading…</p>
  }
  if (error) {
    return <p className="hint error">{error}</p>
  }
  if (agents.length === 0) {
    return (
      <p className="hint">
        No agents found. Drop <code>.md</code> files into <code>~/.claude/agents/</code>.
      </p>
    )
  }

  return (
    <ul className="agent-list">
      {agents.map((a) => (
        <li
          key={a.path}
          className="agent-item"
          onClick={() => window.termhub.openAgent(a.path)}
          title={a.path}
        >
          <div className="agent-name">{a.name}</div>
          {a.description ? <div className="agent-description">{a.description}</div> : null}
        </li>
      ))}
    </ul>
  )
}
