import { useEffect, useRef, type MutableRefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Session } from './types'
import type { TerminalEntry } from './App'

type Props = {
  session: Session
  isActive: boolean
  termsRef: MutableRefObject<Map<string, TerminalEntry>>
  pendingDataRef: MutableRefObject<Map<string, string[]>>
}

// Docked shell terminal rendered under the primary TerminalView. Parallels
// TerminalView almost line-for-line but wires input/resize to the shell PTY
// channel (sendShellInput / resizeShell) instead of the primary one.
export function BottomTerminal({
  session,
  isActive,
  termsRef,
  pendingDataRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActive) return

    const existing = termsRef.current.get(session.id)
    if (existing) {
      const raf = requestAnimationFrame(() => {
        try {
          existing.fit.fit()
        } catch {
          // ignore
        }
      })
      return () => cancelAnimationFrame(raf)
    }

    const container = containerRef.current
    if (!container) return

    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      if (termsRef.current.has(session.id)) return

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        console.warn(
          `[termhub] bottom container has zero size for session ${session.id.slice(0, 8)}; skipping init`,
        )
        return
      }

      const cols = Math.max(20, Math.floor((rect.width - 12) / 8.5))
      const rows = Math.max(3, Math.floor((rect.height - 12) / 17))

      const term = new Terminal({
        cols,
        rows,
        cursorBlink: true,
        fontFamily:
          '"Cascadia Mono", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
        fontSize: 13,
        theme: {
          background: '#161618',
          foreground: '#e0dcf2',
          cursor: '#c8c4e0',
          selectionBackground: '#2d2550',
        },
        scrollback: 5000,
        allowProposedApi: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)

      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown' || !e.ctrlKey) return true
        const isC = e.code === 'KeyC'
        const isV = e.code === 'KeyV'
        if (!isC && !isV) return true

        if (isC) {
          const hasSelection = term.hasSelection()
          if (e.shiftKey || hasSelection) {
            const text = term.getSelection()
            if (text) {
              window.termhub.writeClipboard(text)
              term.clearSelection()
            }
            return false
          }
          return true
        }

        void window.termhub.readClipboard().then((text) => {
          if (text) term.paste(text)
        })
        return false
      })

      term.onData((data) => {
        window.termhub.sendShellInput(session.id, data)
      })
      term.onResize(({ cols, rows }) => {
        window.termhub.resizeShell(session.id, cols, rows)
      })

      term.open(container)
      try {
        fit.fit()
      } catch (err) {
        console.warn('[termhub] bottom fit.fit() failed:', err)
      }

      window.termhub.resizeShell(session.id, term.cols, term.rows)

      termsRef.current.set(session.id, { term, fit })

      const queue = pendingDataRef.current.get(session.id)
      if (queue && queue.length > 0) {
        for (const data of queue) term.write(data)
        pendingDataRef.current.delete(session.id)
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [isActive, session.id, termsRef, pendingDataRef])

  useEffect(() => {
    return () => {
      const entry = termsRef.current.get(session.id)
      if (entry) {
        entry.term.dispose()
        termsRef.current.delete(session.id)
      }
      pendingDataRef.current.delete(session.id)
    }
  }, [session.id, termsRef, pendingDataRef])

  return (
    <div
      className="terminal-pane"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <div ref={containerRef} className="terminal-container" />
    </div>
  )
}
