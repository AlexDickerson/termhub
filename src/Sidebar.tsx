import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session, SessionStatus } from './types'

type ContextMenu = {
  sessionId: string
  x: number
  y: number
}

type Props = {
  groups: Map<string, Session[]>
  activeId: string | null
  statuses: Record<string, SessionStatus>
  onNew: () => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => Promise<void>
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
  onRename,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
    return () => {
      window.removeEventListener('click', close)
    }
  }, [contextMenu])

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingId])

  const startRename = useCallback((session: Session) => {
    setContextMenu(null)
    setEditingId(session.id)
    setEditValue(session.name ?? '')
  }, [])

  const commitRename = useCallback(async (id: string) => {
    await onRename(id, editValue)
    setEditingId(null)
    setEditValue('')
  }, [editValue, onRename])

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditValue('')
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, session: Session) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ sessionId: session.id, x: e.clientX, y: e.clientY })
  }, [])

  // Find the session object from context menu id
  const contextSession = contextMenu
    ? [...groups.values()].flat().find((s) => s.id === contextMenu.sessionId) ?? null
    : null


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
                  onContextMenu={(e) => handleContextMenu(e, s)}
                >
                  {editingId === s.id ? (
                    <input
                      ref={inputRef}
                      className="item-rename-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void commitRename(s.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelRename()
                        }
                      }}
                      onBlur={() => { void commitRename(s.id) }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={`${basename(s.cwd)} #${idx + 1}`}
                    />
                  ) : (
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
                  )}
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

      {contextMenu && contextSession && (
        <div
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => startRename(contextSession)}
          >
            Rename
          </button>
        </div>
      )}
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
