import { useEffect, useRef, type MutableRefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Session } from './types'
import { estimateInitialDims, shouldSnapToBottom } from './xterm-utils'

// Stored in App.tsx's terms maps. The hook reads/writes these on the maps
// passed in via props so the parent owns lifecycle across active-session
// switches.
export type TerminalEntry = {
  term: Terminal
  fit: FitAddon
  linksAddon?: WebLinksAddon
}

// Per-variant wiring: which IPC methods to call, what minimum row count to
// estimate at init, whether to intercept Shift+Enter for the kitty
// keyboard-protocol newline, and whether to refocus + jump to bottom when
// re-activating an existing entry.
export type XtermBehavior = {
  // Forwards keyboard input from xterm to the appropriate PTY.
  sendInput: (id: string, data: string) => void
  // Forwards xterm size changes (initial fit + ResizeObserver) to the PTY.
  resize: (id: string, cols: number, rows: number) => void
  // Lower bound for the rows estimate before FitAddon refines it. Primary
  // pane uses 5; the docked shell uses 3 because it can be dragged smaller.
  minRows: number
  // Primary pane only: claude maps Shift+Enter (kitty form \x1b[13;2u) to
  // "insert newline" while bare CR is "submit", so xterm's default CR
  // emission has to be intercepted.
  interceptShiftEnter: boolean
  // Primary pane re-focuses + jumps to bottom on activation; the shell
  // pane keeps the user's scroll position so they can read prior output
  // without it scrolling away.
  focusOnReactivate: boolean
  // Suffix used in [termhub:terminal] log lines. 'terminal' for primary,
  // 'bottom-terminal' for the docked shell.
  logTag: string
  // Optional async gate called with paste text before it reaches the PTY.
  // Return true to allow paste, false to drop. When absent, xterm's native
  // paste listener handles Ctrl+V with no interception.
  scanBeforePaste?: (text: string) => Promise<boolean>
}

const FONT_FAMILY =
  '"Cascadia Mono", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace'

const TERMINAL_THEME = {
  background: '#161618',
  foreground: '#e0dcf2',
  cursor: '#c8c4e0',
  selectionBackground: '#2d2550',
} as const

type Props = {
  session: Session
  isActive: boolean
  termsRef: MutableRefObject<Map<string, TerminalEntry>>
  pendingDataRef: MutableRefObject<Map<string, string[]>>
  behavior: XtermBehavior
}

// Returns a ref to attach to the container <div>. Owns the entire xterm
// lifecycle for one (session, variant) pair: lazy init on first activation,
// re-fit + (optionally) refocus on re-activation, ResizeObserver-driven
// re-fit on container size changes, dispose on unmount.
//
// Replaces the duplicated init/dispose/resize bodies that previously lived
// in TerminalView.tsx and BottomTerminal.tsx.
export function useXterm({
  session,
  isActive,
  termsRef,
  pendingDataRef,
  behavior,
}: Props) {
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
          if (behavior.focusOnReactivate) {
            // Scroll to bottom after fit so the scrollbar extent is current
            // before we jump — otherwise xterm may not be able to reach the
            // last line.
            existing.term.scrollToBottom()
            existing.term.focus()
          }
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
          `[termhub:${behavior.logTag}] container has zero size for session ${session.id.slice(0, 8)}; skipping init`,
        )
        return
      }

      const { cols, rows } = estimateInitialDims(rect, behavior.minRows)

      const term = new Terminal({
        cols,
        rows,
        cursorBlink: true,
        fontFamily: FONT_FAMILY,
        fontSize: 13,
        theme: { ...TERMINAL_THEME },
        scrollback: 5000,
        allowProposedApi: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)

      const linksAddon = new WebLinksAddon((_event, uri) => {
        window.termhub.openExternal(uri)
      })
      term.loadAddon(linksAddon)

      // Single handler — xterm only keeps the last registered handler, so
      // all key interception must live in one call.
      term.attachCustomKeyEventHandler((e) => {
        // Shift+Enter (primary only): send the kitty keyboard-protocol
        // encoding (\x1b[13;2u). xterm.js is in normal terminal mode (Claude
        // Code does not enable modifyOtherKeys or kitty protocol on this
        // xterm instance), so without interception xterm emits bare CR (0d)
        // which Claude Code treats as "submit". The kitty form is what
        // Claude Code maps to "insert newline" in Kitty / WezTerm.
        if (
          behavior.interceptShiftEnter &&
          e.type === 'keydown' &&
          e.shiftKey &&
          e.key === 'Enter'
        ) {
          e.preventDefault()
          behavior.sendInput(session.id, '\x1b[13;2u')
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
        behavior.sendInput(session.id, data)
      })
      term.onResize(({ cols: c, rows: r }) => {
        behavior.resize(session.id, c, r)
      })

      let prevYdisp = 0
      term.onScroll((newYdisp) => {
        const ybase = term.buffer.active.baseY
        if (shouldSnapToBottom(prevYdisp, newYdisp, ybase)) {
          term.scrollToBottom()
        }
        prevYdisp = newYdisp
      })

      term.open(container)
      try {
        fit.fit()
      } catch (err) {
        console.warn(`[termhub:${behavior.logTag}] fit.fit() failed:`, err)
      }

      // Explicitly push current dims to the pty in case fit() didn't trigger
      // an onResize (no-op when proposed dims match the constructor cols/rows).
      behavior.resize(session.id, term.cols, term.rows)

      termsRef.current.set(session.id, { term, fit, linksAddon })

      const queue = pendingDataRef.current.get(session.id)
      if (queue && queue.length > 0) {
        for (const data of queue) term.write(data)
        pendingDataRef.current.delete(session.id)
      }
      if (behavior.focusOnReactivate) {
        // Land at the bottom of any buffered content on first mount so the
        // user sees the latest output rather than the top of a filled
        // scrollback.
        term.scrollToBottom()
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [isActive, session.id, termsRef, pendingDataRef, behavior])

  // ResizeObserver: re-fit when the container changes size due to layout
  // changes (sidebar toggle, right panel show/hide, session switch, divider
  // drag). Without this, only window resize triggers FitAddon and the
  // scrollbar falls out of sync with actual content.
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
            `[termhub:${behavior.logTag}] session ${session.id.slice(0, 8)} resized ${prevCols}x${prevRows} -> ${newCols}x${newRows}`,
          )
        }
      })
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [session.id, termsRef, behavior])

  // Paste intercept: capture paste events before xterm's textarea listener so
  // we can run an async secret scan and call term.paste() ourselves only when
  // it's safe to do so. Only wired when behavior.scanBeforePaste is provided;
  // for terminals without it (BottomTerminal) this effect is a no-op.
  useEffect(() => {
    if (!behavior.scanBeforePaste) return
    const container = containerRef.current
    if (!container) return

    const handler = async (e: Event) => {
      const clipEvent = e as ClipboardEvent
      // Only intercept paste events that target within our container (xterm's
      // textarea is a child). Capture phase fires before xterm's bubble handler.
      const entry = termsRef.current.get(session.id)
      if (!entry) return

      clipEvent.preventDefault()
      // stopPropagation in capture phase prevents the event from reaching
      // xterm's textarea paste listener, which would fire term.paste() again.
      clipEvent.stopPropagation()

      const text = clipEvent.clipboardData?.getData('text/plain') ?? ''
      if (!text) return

      const proceed = await behavior.scanBeforePaste!(text)
      if (proceed) {
        entry.term.paste(text)
      }
    }

    // capture:true fires before xterm's bubble listener on the textarea child.
    container.addEventListener('paste', handler, { capture: true })
    return () => container.removeEventListener('paste', handler, { capture: true })
  }, [session.id, termsRef, behavior])

  // Dispose only on unmount (not on every isActive flip).
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

  return containerRef
}
