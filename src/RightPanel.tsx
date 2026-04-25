import { CollapsibleSection } from './CollapsibleSection'
import { AgentList } from './AgentList'
import { SkillList } from './SkillList'
import { McpList } from './McpList'
import type { Session } from './types'

type Props = {
  activeSession: Session | null
  onOpenUsage: () => void
}

export function RightPanel({ activeSession, onOpenUsage }: Props) {
  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <span className="brand">menus</span>
        <button
          onClick={onOpenUsage}
          title="Claude Usage"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted, #888)',
            padding: '2px 4px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* Bar-chart icon */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="9" width="3" height="6" rx="1" />
            <rect x="6" y="5" width="3" height="10" rx="1" />
            <rect x="11" y="1" width="3" height="14" rx="1" />
          </svg>
        </button>
      </div>
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
      </div>
    </aside>
  )
}
