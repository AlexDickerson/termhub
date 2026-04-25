import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { Session, SessionStatus } from './types'
import type { TerminalEntry } from './useXterm'

type SessionRefs = {
  termsRef: MutableRefObject<Map<string, TerminalEntry>>
  pendingDataRef: MutableRefObject<Map<string, string[]>>
  shellTermsRef: MutableRefObject<Map<string, TerminalEntry>>
  shellPendingDataRef: MutableRefObject<Map<string, string[]>>
}

export type UseSessionsResult = {
  sessions: Session[]
  statuses: Record<string, SessionStatus>
  activeId: string | null
  setActiveId: (id: string | null | ((prev: string | null) => string | null)) => void
  closeSession: (id: string) => void
  renameSession: (id: string, name: string) => Promise<void>
  newSession: () => Promise<void>
}

// Owns the renderer-side session state and the IPC subscription wiring
// that keeps it in sync with main. Terminal refs are owned by the
// caller (so TerminalView / BottomTerminal can also receive them) and
// passed in here for the dispose-on-remove path.
//
// On mount: subscribes to onData / onShellData / onExit / onStatusChanged
// / onShellExit / onSessionAdded, then catches up via listSessions and
// signals appReady so main can begin creating bootstrap sessions.
export function useSessions(refs: SessionRefs): UseSessionsResult {
  const { termsRef, pendingDataRef, shellTermsRef, shellPendingDataRef } = refs

  const [sessions, setSessions] = useState<Session[]>([])
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({})
  const [activeId, setActiveId] = useState<string | null>(null)

  const removeSession = useCallback(
    (id: string) => {
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
    },
    [termsRef, shellTermsRef, shellPendingDataRef],
  )

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
    // Shell PTY exiting independently (user typed `exit`) doesn't tear
    // the session down — only the primary exit does. We still drop the
    // xterm instance so a future re-init could replace it, but v1
    // doesn't respawn.
    const offShellExit = window.termhub.onShellExit((id) => {
      const entry = shellTermsRef.current.get(id)
      if (entry) {
        entry.term.dispose()
        shellTermsRef.current.delete(id)
      }
      shellPendingDataRef.current.delete(id)
    })
    const offAdded = window.termhub.onSessionAdded(
      (id, cwd, autoActivate, command, name, repoRoot, repoLabel, cli) => {
        setSessions((prev) =>
          prev.some((s) => s.id === id)
            ? prev
            : [...prev, { id, cwd, command, name, repoRoot, repoLabel, cli }],
        )
        if (autoActivate) {
          setActiveId((curr) => curr ?? id)
        }
      },
    )

    // Catch up with any sessions main already created (resumed/startup)
    // before our listeners were attached, then signal that we're ready
    // so main can create the rest.
    void window.termhub.listSessions().then((existing) => {
      if (existing.length > 0) {
        setSessions((prev) => {
          const seen = new Set(prev.map((s) => s.id))
          return [
            ...prev,
            ...existing
              .filter((s) => !seen.has(s.id))
              .map((s) => ({
                id: s.id,
                cwd: s.cwd,
                command: s.command,
                name: s.name,
                repoRoot: s.repoRoot,
                repoLabel: s.repoLabel,
                cli: s.cli,
              })),
          ]
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
        prev.map((s) =>
          s.id === id ? { ...s, name: name.trim() || undefined } : s,
        ),
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
      alert(
        `Failed to create session:\n${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [])

  return {
    sessions,
    statuses,
    activeId,
    setActiveId,
    closeSession,
    renameSession,
    newSession,
  }
}
