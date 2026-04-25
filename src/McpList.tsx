import type { Session } from './types'

type Props = {
  session: Session | null
}

export function McpList({ session }: Props) {
  if (!session) {
    return <p className="hint">No active session.</p>
  }

  const isClaudeSession = session.command?.trim().startsWith('claude') ?? false
  if (!isClaudeSession) {
    return <p className="hint">Active session isn't running claude.</p>
  }

  return (
    <ul className="mcp-list">
      <li className="mcp-item">
        <span className="mcp-name">termhub</span>
        <span className="mcp-status mcp-status-active">configured</span>
      </li>
    </ul>
  )
}
