import { useMemo, type MutableRefObject } from 'react'
import type { Session } from './types'
import { useXterm, type TerminalEntry, type XtermBehavior } from './useXterm'

type Props = {
  session: Session
  isActive: boolean
  termsRef: MutableRefObject<Map<string, TerminalEntry>>
  pendingDataRef: MutableRefObject<Map<string, string[]>>
}

// Docked shell terminal under the primary TerminalView. Wires xterm to the
// shell IPC channel and preserves user scroll position across activations.
// All lifecycle work lives in useXterm.
export function BottomTerminal({ session, isActive, termsRef, pendingDataRef }: Props) {
  const behavior = useMemo<XtermBehavior>(
    () => ({
      sendInput: (id, data) => window.termhub.sendShellInput(id, data),
      resize: (id, cols, rows) => window.termhub.resizeShell(id, cols, rows),
      minRows: 3,
      interceptShiftEnter: false,
      focusOnReactivate: false,
      logTag: 'bottom-terminal',
    }),
    [],
  )

  const containerRef = useXterm({
    session,
    isActive,
    termsRef,
    pendingDataRef,
    behavior,
  })

  return (
    <div
      className="terminal-pane"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <div ref={containerRef} className="terminal-container" />
    </div>
  )
}
