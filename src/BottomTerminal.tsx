import { useEffect, useRef, type MutableRefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
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

      const linksAddon = new WebLinksAddon((_event, uri) => {
        window.termhub.openExternal(uri)
      })
      term.loadAddon(linksAddon)

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

        // Ctrl+V: return false so xterm doesn't convert the keystroke into
        // the SYN control char \x16 (and call preventDefault, which would
        // suppress the textarea's native paste pipeline).  xterm's own
        // built-in 'paste' listener on the textarea then handles writing
        // the clipboard contents to the PTY with bracketed-paste-mode
        // framing.  Calling readClipboard().then(term.paste()) here in
        // addition produces a double paste.
        return false
      })

      term.onData((data) => {
        window.termhub.sendShellInput(session.id, data)
      })
      term.onResize(({ cols, rows }) => {
        window.termhub.resizeShell(session.id, cols, rows)
      })

      // Snap-to-bottom fix: mirrors TerminalView — see the comment there.
      let prevYdisp = 0
      term.onScroll((newYdisp) => {
        const ybase = term.buffer.active.baseY
        if (newYdisp > prevYdisp && newYdisp >= ybase - 1 && newYdisp < ybase) {
          term.scrollToBottom()
        }
        prevYdisp = newYdisp
      })

      term.open(container)
      try {
        fit.fit()
      } catch (err) {
        console.warn('[termhub] bottom fit.fit() failed:', err)
      }

      window.termhub.resizeShell(session.id, term.cols, term.rows)

      termsRef.current.set(session.id, { term, fit, linksAddon })

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

  // ResizeObserver: re-fit when the container changes size due to layout
  // changes (sidebar toggle, right panel show/hide, session switch, etc.).
  // rAF throttling avoids per-pixel calls during animated resizes.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        const entry = termsRef.current.get(session.id)
        if (!entry) return
        const prevCols = entry.term.cols
        const prevRows = entry.term.rows
        try {
          entry.fit.fit()
        } catch {
          // ignore — container may be zero-size during hide transition
        }
        const newCols = entry.term.cols
        const newRows = entry.term.rows
        if (newCols !== prevCols || newRows !== prevRows) {
          console.info(
            `[termhub:terminal] bottom session ${session.id.slice(0, 8)} resized ${prevCols}x${prevRows} -> ${newCols}x${newRows}`,
          )
        }
      })
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [session.id, termsRef])

  useEffect(() => {
    return () => {
      const entry = termsRef.current.get(session.id)
      if (entry) {
        entry.linksAddon?.dispose()
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
