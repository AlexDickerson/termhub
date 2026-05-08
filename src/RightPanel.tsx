import type { CSSProperties } from 'react'
import { CollapsibleSection } from './CollapsibleSection'
import { AgentList } from './AgentList'
import { SkillList } from './SkillList'
import { McpList } from './McpList'
import { SessionPrPanel } from './SessionPrPanel'
import { SessionUsagePanel } from './SessionUsagePanel'
import type { Session } from './types'

type Props = {
  activeSession: Session | null
  style?: CSSProperties
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function RightPanel({ activeSession, style, isCollapsed, onToggleCollapse }: Props) {
  if (isCollapsed) {
    return (
      <aside className="right-panel right-panel--collapsed" style={style}>
        <button
          className="panel-toggle-btn"
          onClick={onToggleCollapse}
          title="Expand panel"
          aria-label="Expand panel"
        >
          ‹
        </button>
      </aside>
    )
  }

  return (
    <aside className="right-panel" style={style}>
      <button
        className="panel-toggle-btn panel-toggle-btn--collapse"
        onClick={onToggleCollapse}
        title="Collapse panel"
        aria-label="Collapse panel"
      >
        ›
      </button>
      <div className="right-panel-body">
        <CollapsibleSection title="Agents">
          <AgentList />
        </CollapsibleSection>
        <CollapsibleSection title="Skills">
          <SkillList />
        </CollapsibleSection>
        <CollapsibleSection title="MCP">
          <McpList session={activeSession} />
        </CollapsibleSection>
        <CollapsibleSection title="Pull Request">
          <SessionPrPanel session={activeSession} />
        </CollapsibleSection>
        <CollapsibleSection title="Token Usage">
          <SessionUsagePanel session={activeSession} />
        </CollapsibleSection>
      </div>
    </aside>
  )
}
