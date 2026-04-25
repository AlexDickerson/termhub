import { useMemo, type MutableRefObject } from 'react'
import type { Session } from './types'
import { useXterm, type TerminalEntry, type XtermBehavior } from './useXterm'

type Props = {
  session: Session
  isActive: boolean
  termsRef: MutableRefObject<Map<string, TerminalEntry>>
  pendingDataRef: MutableRefObject<Map<string, string[]>>
}

// Primary terminal pane — hosts the claude (or other --command) PTY. Wires
// xterm to the primary IPC channel, intercepts Shift+Enter, refocuses on
// activation. All lifecycle work lives in useXterm.
export function TerminalView({ session, isActive, termsRef, pendingDataRef }: Props) {
  const behavior = useMemo<XtermBehavior>(
    () => ({
      sendInput: (id, data) => window.termhub.sendInput(id, data),
      resize: (id, cols, rows) => window.termhub.resize(id, cols, rows),
      minRows: 5,
      interceptShiftEnter: true,
      focusOnReactivate: true,
      logTag: 'terminal',
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
