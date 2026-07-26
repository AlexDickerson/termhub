import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Session, SessionStatus } from './types'
import type { SidebarGroup } from './sidebar-groups'

type ContextMenu = {
  sessionId: string
  x: number
  y: number
}

type Props = {
  groups: SidebarGroup[]
  activeId: string | null
  statuses: Record<string, SessionStatus>
  onNew: () => void
  // Start a session in a specific project — opens the new-session dialog with
  // the folder pre-filled.
  onNewInProject: (cwd: string) => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => Promise<void>
  // Null when the user hasn't anchored a repos directory yet.
  reposDir: string | null
  onChooseReposDir: () => void
  style?: CSSProperties
  isCollapsed?: boolean
  onToggleCollapse?: () => void
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
  onNewInProject,
  onSelect,
  onClose,
  onRename,
  reposDir,
  onChooseReposDir,
  style,
  isCollapsed,
  onToggleCollapse,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Find the session object from context menu id
  const contextSession = contextMenu
    ? groups.flatMap((g) => g.sessions).find((s) => s.id === contextMenu.sessionId) ??
      null
    : null

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
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

  const handleOpenInVSCode = useCallback(async () => {
    if (!contextSession) return
    const { cwd } = contextSession
    setContextMenu(null)
    try {
      await window.termhub.openInVSCode(cwd)
    } catch (err) {
      console.error('[termhub] openInVSCode failed:', err)
    }
  }, [contextSession])


  if (isCollapsed) {
    return (
      <aside className="sidebar sidebar--collapsed" style={style}>
        <button
          className="sidebar-toggle-btn"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          ›
        </button>
      </aside>
    )
  }

  return (
    <aside className="sidebar" style={style}>
      <button
        className="sidebar-toggle-btn sidebar-toggle-btn--collapse"
        onClick={onToggleCollapse}
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
      >
        ‹
      </button>
      <div className="groups">
        {groups.length === 0 && (
          <div className="sidebar-empty">
            {reposDir ? (
              <p>No projects found in {shortenPath(reposDir)}.</p>
            ) : (
              <p>Anchor termhub to the folder that holds your projects.</p>
            )}
            <button className="new-btn" onClick={onChooseReposDir}>
              Choose projects folder…
            </button>
          </div>
        )}
        {groups.map((group) => {
          const { key: groupKey, label, sessions: list } = group
          const titleAttr = groupKey
          return (
          <div className="group" key={groupKey}>
            <div className="group-title" title={titleAttr}>
              <span className="group-title-label">{label}</span>
              {group.isProject && (
                <button
                  className="group-add-btn"
                  title={`New session in ${label}`}
                  aria-label={`New session in ${label}`}
                  onClick={() => onNewInProject(groupKey)}
                >
                  +
                </button>
              )}
            </div>
            {group.isProject && list.length === 0 && (
              <ul className="group-list">
                <li
                  className="item item--dormant"
                  onClick={() => onNewInProject(groupKey)}
                  title={`Start a session in ${label}`}
                >
                  <span className="item-label item-label--dormant">
                    No sessions — click to start one
                  </span>
                </li>
              </ul>
            )}
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
          )
        })}
      </div>

      <div className="sidebar-footer">
        <button className="new-btn sidebar-new-btn" onClick={onNew}>
          + New Session
        </button>
        {reposDir && (
          <button
            className="sidebar-anchor-btn"
            onClick={onChooseReposDir}
            title={`Projects folder: ${reposDir}`}
          >
            {shortenPath(reposDir)}
          </button>
        )}
      </div>

      {contextMenu && contextSession && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => void handleOpenInVSCode()}
          >
            Open in VS Code
          </button>
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
