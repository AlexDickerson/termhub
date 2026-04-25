import type { Session, SessionStatus } from './types'

type Props = {
  groups: Map<string, Session[]>
  activeId: string | null
  statuses: Record<string, SessionStatus>
  onNew: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'Working',
  awaiting: 'Awaiting input',
  idle: 'Idle',
  failed: 'Failed',
}

export function Sidebar({
  groups,
  activeId,
  statuses,
  onNew,
  onSelect,
  onClose,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">termhub</span>
        <button className="new-btn" onClick={onNew} title="New session">
          + New
        </button>
      </div>
      <div className="groups">
        {[...groups.entries()].map(([cwd, list]) => (
          <div className="group" key={cwd}>
            <div className="group-title" title={cwd}>
              {shortenPath(cwd)}
            </div>
            <ul className="group-list">
              {list.map((s, idx) => {
                const status = statuses[s.id] ?? 'idle'
                return (
                <li
                  key={s.id}
                  className={`item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => onSelect(s.id)}
                >
                  <span className="item-label">
                    <span
                      className={`status-dot status-${status}`}
                      title={STATUS_LABEL[status]}
                      aria-label={STATUS_LABEL[status]}
                    />
                    {s.name ? (
                      s.name
                    ) : (
                      <>
                        {basename(s.cwd)}{' '}
                        <span className="item-num">#{idx + 1}</span>
                      </>
                    )}
                  </span>
                  <button
                    className="close-btn"
                    title="Close session"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose(s.id)
                    }}
                  >
                    ×
                  </button>
                </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  )
}

function shortenPath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return normalized
  return '…/' + parts.slice(-2).join('/')
}

function basename(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}
