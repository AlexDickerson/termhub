import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { Sidebar } from './Sidebar'
import { TerminalView } from './TerminalView'
import { BottomTerminal } from './BottomTerminal'
import { RightPanel } from './RightPanel'
import type { Session, SessionStatus } from './types'

export type TerminalEntry = { term: Terminal; fit: FitAddon }

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  // Primary (claude) PTY xterm instances, keyed by session id.
  const termsRef = useRef(new Map<string, TerminalEntry>())
  const pendingDataRef = useRef(new Map<string, string[]>())
  // Parallel state for the docked bottom shell terminals. Same map shape,
  // keyed by the same session id, but wired to the shell PTY channel.
  const shellTermsRef = useRef(new Map<string, TerminalEntry>())
  const shellPendingDataRef = useRef(new Map<string, string[]>())

  useEffect(() => {
    const offData = window.termhub.onData((id, data) => {
      const entry = termsRef.current.get(id)
      if (entry) {
        entry.term.write(data)
      } else {
        const queue = pendingDataRef.current.get(id) ?? []
        queue.push(data)
        pendingDataRef.current.set(id, queue)
      }
    })
    const offShellData = window.termhub.onShellData((id, data) => {
      const entry = shellTermsRef.current.get(id)
      if (entry) {
        entry.term.write(data)
      } else {
        const queue = shellPendingDataRef.current.get(id) ?? []
        queue.push(data)
        shellPendingDataRef.current.set(id, queue)
      }
    })
    const offExit = window.termhub.onExit((id, exitCode) => {
      // Keep failed sessions visible so the red status dot is observable.
      // They can still be dismissed via the × button. Clean exits remove
      // the row immediately as before.
      if (exitCode === 0) {
        removeSession(id)
      }
    })
    const offStatus = window.termhub.onStatusChanged((id, status) => {
      setStatuses((prev) =>
        prev[id] === status ? prev : { ...prev, [id]: status },
      )
    })
    // Shell PTY exiting independently (user typed `exit`) doesn't tear the
    // session down — only the primary exit does. We still drop the xterm
    // instance so a future re-init could replace it, but v1 doesn't respawn.
    const offShellExit = window.termhub.onShellExit((id) => {
      const entry = shellTermsRef.current.get(id)
      if (entry) {
        entry.term.dispose()
        shellTermsRef.current.delete(id)
      }
      shellPendingDataRef.current.delete(id)
    })
    const offAdded = window.termhub.onSessionAdded(
      (id, cwd, autoActivate, command, name) => {
        setSessions((prev) =>
          prev.some((s) => s.id === id)
            ? prev
            : [...prev, { id, cwd, command, name }],
        )
        if (autoActivate) {
          setActiveId((curr) => curr ?? id)
        }
      },
    )

    // Catch up with any sessions main already created (resumed/startup) before
    // our listeners were attached, then signal that we're ready so main can
    // create the rest.
    void window.termhub.listSessions().then((existing) => {
      if (existing.length > 0) {
        setSessions((prev) => {
          const seen = new Set(prev.map((s) => s.id))
          return [...prev, ...existing.filter((s) => !seen.has(s.id))]
        })
        setActiveId((curr) => curr ?? existing[0].id)
      }
      window.termhub.appReady()
    })

    return () => {
      offData()
      offShellData()
      offExit()
      offStatus()
      offShellExit()
      offAdded()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const removeSession = useCallback((id: string) => {
    const entry = termsRef.current.get(id)
    if (entry) {
      entry.term.dispose()
      termsRef.current.delete(id)
    }
    const shellEntry = shellTermsRef.current.get(id)
    if (shellEntry) {
      shellEntry.term.dispose()
      shellTermsRef.current.delete(id)
    }
    shellPendingDataRef.current.delete(id)
    setSessions((prev) => prev.filter((s) => s.id !== id))
    setStatuses((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setActiveId((curr) => {
      if (curr !== id) return curr
      // Pick the next remaining session, if any
      const remaining = Array.from(termsRef.current.keys())
      return remaining[0] ?? null
    })
  }, [])

  const closeSession = useCallback(
    (id: string) => {
      window.termhub.close(id)
      removeSession(id)
    },
    [removeSession],
  )

  const renameSession = useCallback(async (id: string, name: string) => {
    try {
      await window.termhub.renameSession(id, name)
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name: name.trim() || undefined } : s)),
      )
    } catch (err) {
      console.error('[termhub] renameSession failed:', err)
    }
  }, [])

  const newSession = useCallback(async () => {
    try {
      const cwd = await window.termhub.pickFolder()
      if (!cwd) return
      const s = await window.termhub.createSession(cwd)
      setSessions((prev) => [...prev, s])
      setActiveId(s.id)
    } catch (err) {
      console.error('[termhub] newSession failed:', err)
      alert(`Failed to create session:\n${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

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

  // Refit both when active session changes (their containers just became visible)
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

  const grouped = useMemo(() => groupByCwd(sessions), [sessions])
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId],
  )

  return (
    <div className="app">
      <Sidebar
        groups={grouped}
        activeId={activeId}
        statuses={statuses}
        onNew={newSession}
        onSelect={setActiveId}
        onClose={closeSession}
        onRename={renameSession}
      />
      <main className="main">
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
            <div className="main-divider" />
            <div className="main-bottom">
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
  )
}

function groupByCwd(sessions: Session[]): Map<string, Session[]> {
  const m = new Map<string, Session[]>()
  for (const s of sessions) {
    const list = m.get(s.cwd) ?? []
    list.push(s)
    m.set(s.cwd, list)
  }
  return m
}
