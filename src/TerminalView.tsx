import { useEffect, useRef, type MutableRefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Session } from './types'
import type { TerminalEntry } from './App'
import { shiftEnterSequence } from './keyHandlers'

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
          background: '#1e1e1e',
          foreground: '#e6e6e6',
          cursor: '#d4d4d4',
          selectionBackground: '#264f78',
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

        // Prevent the browser from also firing a native 'paste' ClipboardEvent
        // on the xterm textarea. Without this, xterm's own paste listener
        // (registered on the textarea) fires after our term.paste() call,
        // writing the clipboard text a second time.
        e.preventDefault()
        void window.termhub.readClipboard().then((text) => {
          if (text) term.paste(text)
        })
        return false
      })

      // Shift+Enter: send the modifyOtherKeys CSI sequence (\x1b[27;2;13~)
      // which Claude Code's input parser recognises as "insert newline"
      // regardless of whether there is already text in the input buffer.
      // The previous \x1b\r (ESC+CR / Meta+Enter) only worked when the
      // buffer was empty because Claude Code's readline-style parser treats
      // ESC+CR differently depending on buffered input state.
      term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
        const seq = shiftEnterSequence(ev)
        if (seq !== null) {
          window.termhub.sendInput(session.id, seq)
          return false  // suppress xterm default handling
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
