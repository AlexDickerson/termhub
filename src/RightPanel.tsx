import { CollapsibleSection } from './CollapsibleSection'
import { AgentList } from './AgentList'
import { SkillList } from './SkillList'
import { McpList } from './McpList'
import { SessionPrPanel } from './SessionPrPanel'
import type { Session } from './types'

type Props = {
  activeSession: Session | null
}

export function RightPanel({ activeSession }: Props) {
  return (
    <aside className="right-panel">
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
      </div>
    </aside>
  )
}
