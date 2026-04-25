import { useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { TerminalView } from './TerminalView'
import { BottomTerminal } from './BottomTerminal'
import { RightPanel } from './RightPanel'
import { UsageModal } from './UsageModal'
import type { Session } from './types'
import type { TerminalEntry } from './useXterm'
import { useSessions } from './useSessions'
import { useSplitLayout } from './useSplitLayout'

export default function App() {
  // Primary (claude) PTY xterm instances, keyed by session id. Owned here
  // because both useSessions (for dispose-on-remove) and TerminalView /
  // BottomTerminal (for lifecycle) need to share them.
  const termsRef = useRef(new Map<string, TerminalEntry>())
  const pendingDataRef = useRef(new Map<string, string[]>())
  // Parallel state for the docked bottom shell terminals.
  const shellTermsRef = useRef(new Map<string, TerminalEntry>())
  const shellPendingDataRef = useRef(new Map<string, string[]>())

  const {
    sessions,
    statuses,
    activeId,
    setActiveId,
    closeSession,
    renameSession,
    newSession,
  } = useSessions({
    termsRef,
    pendingDataRef,
    shellTermsRef,
    shellPendingDataRef,
  })

  const { bottomHeight, mainContainerRef, handleDividerMouseDown } =
    useSplitLayout()

  const [showUsage, setShowUsage] = useState(false)

  // Refit both terminals for the active session when the window resizes.
  useEffect(() => {
    const onResize = () => {
      if (!activeId) return
      const entry = termsRef.current.get(activeId)
      if (entry) {
        try {
          entry.fit.fit()
        } catch {
          // container may not be mounted yet
        }
      }
      const shellEntry = shellTermsRef.current.get(activeId)
      if (shellEntry) {
        try {
          shellEntry.fit.fit()
        } catch {
          // container may not be mounted yet
        }
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeId])

  // Refit both when active session changes (their containers just became
  // visible).
  useEffect(() => {
    if (!activeId) return
    const id = activeId
    const raf = requestAnimationFrame(() => {
      const entry = termsRef.current.get(id)
      if (entry) {
        try {
          entry.fit.fit()
          entry.term.focus()
        } catch {
          // ignore — container not ready
        }
      }
      const shellEntry = shellTermsRef.current.get(id)
      if (shellEntry) {
        try {
          shellEntry.fit.fit()
        } catch {
          // ignore
        }
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [activeId])

  const grouped = useMemo(() => groupSessions(sessions), [sessions])
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  return (
    <div className="app">
      <TitleBar onOpenUsage={() => setShowUsage(true)} />
      <div className="app-body">
        <Sidebar
          groups={grouped}
          activeId={activeId}
          statuses={statuses}
          onNew={newSession}
          onSelect={setActiveId}
          onClose={closeSession}
          onRename={renameSession}
        />
        <main className="main" ref={mainContainerRef}>
          {sessions.length === 0 ? (
            <div className="empty">
              <p>No sessions yet.</p>
              <button onClick={newSession}>+ New Session</button>
            </div>
          ) : (
            <>
              <div className="main-top">
                {sessions.map((s) => (
                  <TerminalView
                    key={s.id}
                    session={s}
                    isActive={s.id === activeId}
                    termsRef={termsRef}
                    pendingDataRef={pendingDataRef}
                  />
                ))}
              </div>
              <div className="main-divider" onMouseDown={handleDividerMouseDown} />
              <div className="main-bottom" style={{ flexBasis: bottomHeight }}>
                {sessions.map((s) => (
                  <BottomTerminal
                    key={s.id}
                    session={s}
                    isActive={s.id === activeId}
                    termsRef={shellTermsRef}
                    pendingDataRef={shellPendingDataRef}
                  />
                ))}
              </div>
            </>
          )}
        </main>
        <RightPanel activeSession={activeSession} />
      </div>
      {showUsage && <UsageModal onClose={() => setShowUsage(false)} />}
    </div>
  )
}

// Group sessions by repo root when available, falling back to cwd. The
// map key is the group key (repoRoot or cwd); Sidebar reads the label
// from the first session in the group via session.repoLabel or derives
// it from the cwd.
function groupSessions(sessions: Session[]): Map<string, Session[]> {
  const m = new Map<string, Session[]>()
  for (const s of sessions) {
    const key = s.repoRoot ?? s.cwd
    const list = m.get(key) ?? []
    list.push(s)
    m.set(key, list)
  }
  return m
}
