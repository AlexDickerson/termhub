import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { Sidebar } from './Sidebar'
import { TerminalView } from './TerminalView'
import type { Session } from './types'

export type TerminalEntry = { term: Terminal; fit: FitAddon }

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const termsRef = useRef(new Map<string, TerminalEntry>())
  const pendingDataRef = useRef(new Map<string, string[]>())

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
    const offExit = window.termhub.onExit((id) => {
      removeSession(id)
    })
    const offAdded = window.termhub.onSessionAdded((id, cwd, autoActivate) => {
      setSessions((prev) =>
        prev.some((s) => s.id === id) ? prev : [...prev, { id, cwd }],
      )
      if (autoActivate) {
        setActiveId((curr) => curr ?? id)
      }
    })

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
      offExit()
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
    setSessions((prev) => prev.filter((s) => s.id !== id))
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

  // Refit the active terminal when window resizes
  useEffect(() => {
    const onResize = () => {
      if (!activeId) return
      const entry = termsRef.current.get(activeId)
      if (!entry) return
      try {
        entry.fit.fit()
      } catch {
        // container may not be mounted yet
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeId])

  // Refit when active session changes (its container just became visible)
  useEffect(() => {
    if (!activeId) return
    const id = activeId
    const raf = requestAnimationFrame(() => {
      const entry = termsRef.current.get(id)
      if (!entry) return
      try {
        entry.fit.fit()
        entry.term.focus()
      } catch {
        // ignore — container not ready
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [activeId])

  const grouped = useMemo(() => groupByCwd(sessions), [sessions])

  return (
    <div className="app">
      <Sidebar
        groups={grouped}
        activeId={activeId}
        onNew={newSession}
        onSelect={setActiveId}
        onClose={closeSession}
      />
      <main className="main">
        {sessions.length === 0 ? (
          <div className="empty">
            <p>No sessions yet.</p>
            <button onClick={newSession}>+ New Session</button>
          </div>
        ) : (
          sessions.map((s) => (
            <TerminalView
              key={s.id}
              session={s}
              isActive={s.id === activeId}
              termsRef={termsRef}
              pendingDataRef={pendingDataRef}
            />
          ))
        )}
      </main>
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
