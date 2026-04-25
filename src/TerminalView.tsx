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

      // Single handler — xterm only keeps the last registered handler, so
      // all key interception must live in one call to attachCustomKeyEventHandler.
      //
      // Shift+Enter is intentionally NOT intercepted here.  Claude Code enables
      // modifyOtherKeys mode (or the kitty keyboard protocol) in xterm.js by
      // writing the appropriate escape sequence to the PTY as part of its
      // startup.  In that mode xterm natively encodes Shift+Enter as the CSI
      // sequence Claude Code expects (e.g. \x1b[27;2;13~) and emits it via
      // onData, where it travels through sendInput to the PTY.
      //
      // Intercepting the key here and returning false suppresses that encoding
      // and substitutes a custom byte sequence that Claude Code does not
      // recognise, causing it to submit instead of inserting a newline.
      // Track whether the very next onData call is from a Shift+Enter leak.
      // Should never fire because return false suppresses xterm's encoding —
      // but log loudly if it does so we can catch regressions.
      let expectingShiftEnterLeak = false

      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.shiftKey && e.key === 'Enter') {
          // Kitty keyboard-protocol encoding for Shift+Enter.  This is the
          // byte sequence that Claude Code receives (and inserts as a newline)
          // when running inside Kitty / WezTerm, which both send this format.
          // We must intercept here because xterm.js is in normal terminal mode
          // (Claude Code has not enabled modifyOtherKeys or kitty protocol on
          // this xterm instance), so xterm would otherwise emit bare CR (0d)
          // which Claude Code interprets as "submit".
          const seq = '\x1b[13;2u'
          e.preventDefault()  // belt-and-suspenders: block browser default too
          window.termhub.sendInput(session.id, seq)
          expectingShiftEnterLeak = true
          console.log('[termhub key] Shift+Enter — sent 1b 5b 31 33 3b 32 75, return false')
          return false  // suppress xterm's 0d
        }

        // Ctrl+C / Ctrl+V: clipboard copy and paste.
        if (e.type === 'keydown' && e.ctrlKey) {
          const isC = e.code === 'KeyC'
          const isV = e.code === 'KeyV'

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

          if (isV) {
            // Prevent the browser from also firing a native 'paste' ClipboardEvent
            // on the xterm textarea. Without this, xterm's own paste listener
            // (registered on the textarea) fires after our term.paste() call,
            // writing the clipboard text a second time.
            e.preventDefault()
            void window.termhub.readClipboard().then((text) => {
              if (text) term.paste(text)
            })
            return false
          }
        }

        return true
      })

      // Wire data + resize handlers BEFORE fit() so the resize triggered
      // by the initial fit reaches the pty. Otherwise the pty stays at its
      // spawn-time 80x24 while xterm renders at the fitted size, causing
      // cursor-positioning corruption (broken tab completion, TUIs that
      // overwrite themselves instead of scrolling).
      term.onData((data) => {
        if (expectingShiftEnterLeak) {
          expectingShiftEnterLeak = false
          const hex = Array.from(data).map(c => c.codePointAt(0)!.toString(16).padStart(2, '0')).join(' ')
          console.warn(`[termhub data] LEAK — onData fired after Shift+Enter intercept: hex ${hex}`)
        }
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
