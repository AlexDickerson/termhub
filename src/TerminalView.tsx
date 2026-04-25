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

export function TerminalView({ session, isActive, termsRef, pendingDataRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Lazy-init: only create the xterm instance when the session first becomes
  // visible. xterm's renderer needs a non-zero-size container at open() time
  // and gets confused by StrictMode's double-invoke if init is synchronous —
  // so we defer init to a rAF, which lets the first (cancelled) effect run
  // bail out before doing any DOM work.
  useEffect(() => {
    if (!isActive) return

    const existing = termsRef.current.get(session.id)
    if (existing) {
      const raf = requestAnimationFrame(() => {
        try {
          existing.fit.fit()
          existing.term.focus()
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
          `[termhub] container has zero size for session ${session.id.slice(0, 8)}; skipping init`,
        )
        return
      }

      // Initial cols/rows estimated from container size so the renderer has
      // sane dimensions before FitAddon refines them.
      const cols = Math.max(20, Math.floor((rect.width - 12) / 8.5))
      const rows = Math.max(5, Math.floor((rect.height - 12) / 17))

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

      // Single handler — xterm only keeps the last registered handler, so
      // all key interception must live in one call to attachCustomKeyEventHandler.
      term.attachCustomKeyEventHandler((e) => {
        // Shift+Enter: send the kitty keyboard-protocol encoding (\x1b[13;2u).
        // xterm.js is in normal terminal mode (Claude Code does not enable
        // modifyOtherKeys or kitty protocol on this xterm instance), so without
        // interception xterm emits bare CR (0d) which Claude Code treats as
        // "submit".  The kitty form is what Claude Code maps to "insert newline"
        // in Kitty / WezTerm.
        if (e.type === 'keydown' && e.shiftKey && e.key === 'Enter') {
          e.preventDefault()
          window.termhub.sendInput(session.id, '\x1b[13;2u')
          return false
        }

        if (e.type === 'keydown' && e.ctrlKey && e.code === 'KeyC') {
          const hasSelection = term.hasSelection()
          if (e.shiftKey || hasSelection) {
            const text = term.getSelection()
            if (text) {
              window.termhub.writeClipboard(text)
              term.clearSelection()
            }
            return false
          }
        }

        // Ctrl+V: returning false stops xterm's _keyDown from converting
        // the keystroke into the SYN control char \x16 and calling
        // preventDefault on the keydown.  That preventDefault is what
        // suppresses the browser's native textarea paste pipeline; with it
        // gone, the textarea fires a real 'paste' ClipboardEvent and
        // xterm's own paste listener handles it (calling term.paste() with
        // bracketed-paste-mode framing).  No custom readClipboard call is
        // needed — adding one produces a double paste because xterm's
        // listener writes the same text again.
        if (e.type === 'keydown' && e.ctrlKey && e.code === 'KeyV') {
          return false
        }

        return true
      })

      // Wire data + resize handlers BEFORE fit() so the resize triggered
      // by the initial fit reaches the pty. Otherwise the pty stays at its
      // spawn-time 80x24 while xterm renders at the fitted size, causing
      // cursor-positioning corruption (broken tab completion, TUIs that
      // overwrite themselves instead of scrolling).
      term.onData((data) => {
        window.termhub.sendInput(session.id, data)
      })
      term.onResize(({ cols, rows }) => {
        window.termhub.resize(session.id, cols, rows)
      })

      // Snap-to-bottom fix: xterm's internal pixel rounding can leave the
      // scrollbar 1 line short of ybase when the user scrolls down after new
      // output has arrived while they were scrolled up.  When the viewport
      // moves downward and gets within 1 line of ybase, snap all the way to
      // the bottom so the final line is always reachable.
      // We only fire when scrolling downward (newYdisp > prevYdisp) to avoid
      // fighting the user when they intentionally scroll up from the bottom.
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
        console.warn('[termhub] fit.fit() failed:', err)
      }

      // Explicitly push current dims to the pty in case fit() didn't trigger
      // an onResize (no-op when proposed dims match the constructor cols/rows).
      window.termhub.resize(session.id, term.cols, term.rows)

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

  // ResizeObserver: re-fit when the container changes size due to layout
  // changes (sidebar toggle, right panel show/hide, session switch, etc.).
  // Without this, only window resize triggers FitAddon and the scrollbar
  // falls out of sync with actual content.
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
            `[termhub:terminal] session ${session.id.slice(0, 8)} resized ${prevCols}x${prevRows} -> ${newCols}x${newRows}`,
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

  // Dispose only on unmount (not on every isActive flip).
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
