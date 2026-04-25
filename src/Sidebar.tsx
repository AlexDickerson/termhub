import type { Session } from './types'

type Props = {
  groups: Map<string, Session[]>
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export function Sidebar({ groups, activeId, onNew, onSelect, onClose }: Props) {
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
              {list.map((s, idx) => (
                <li
                  key={s.id}
                  className={`item ${s.id === activeId ? 'active' : ''}`}
                  onClick={() => onSelect(s.id)}
                >
                  <span className="item-label">
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
              ))}
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
