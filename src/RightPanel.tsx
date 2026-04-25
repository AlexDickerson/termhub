import { CollapsibleSection } from './CollapsibleSection'
import { AgentList } from './AgentList'
import { SkillList } from './SkillList'
import { McpList } from './McpList'
import type { Session } from './types'

type Props = {
  activeSession: Session | null
}

export function RightPanel({ activeSession }: Props) {
  return (
    <aside className="right-panel">
      <div className="right-panel-header">
        <span className="brand">menus</span>
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
