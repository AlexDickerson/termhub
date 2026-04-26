import { CollapsibleSection } from './CollapsibleSection'
import { AgentList } from './AgentList'
import { SkillList } from './SkillList'
import { McpList } from './McpList'
import { SessionPrPanel } from './SessionPrPanel'
import type { Session } from './types'

type Props = {
  activeSession: Session | null
  secretFilterEnabled: boolean
  onSecretFilterToggle: (enabled: boolean) => void
}

export function RightPanel({ activeSession, secretFilterEnabled, onSecretFilterToggle }: Props) {
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
        <CollapsibleSection title="Settings" defaultOpen={false}>
          <label className="settings-toggle-row">
            <input
              type="checkbox"
              checked={secretFilterEnabled}
              onChange={(e) => onSecretFilterToggle(e.target.checked)}
            />
            <span>Scan clipboard for secrets before paste</span>
          </label>
        </CollapsibleSection>
      </div>
    </aside>
  )
}
