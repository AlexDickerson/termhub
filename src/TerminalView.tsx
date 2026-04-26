import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { SecretFinding, Session } from './types'
import { useXterm, type TerminalEntry, type XtermBehavior } from './useXterm'
import { PasteSecretDialog } from './PasteSecretDialog'

type Props = {
  session: Session
  isActive: boolean
  termsRef: MutableRefObject<Map<string, TerminalEntry>>
  pendingDataRef: MutableRefObject<Map<string, string[]>>
  secretFilterEnabled: boolean
}

// Primary terminal pane — hosts the claude (or other --command) PTY. Wires
// xterm to the primary IPC channel, intercepts Shift+Enter, refocuses on
// activation. All lifecycle work lives in useXterm.
export function TerminalView({
  session,
  isActive,
  termsRef,
  pendingDataRef,
  secretFilterEnabled,
}: Props) {
  const [pasteDialog, setPasteDialog] = useState<{ findings: SecretFinding[] } | null>(null)
  const pasteResolveRef = useRef<((ok: boolean) => void) | null>(null)

  // Ref keeps the closure in behavior.scanBeforePaste current without
  // requiring behavior to be re-created (which would trigger useXterm effects).
  const secretFilterEnabledRef = useRef(secretFilterEnabled)
  useEffect(() => {
    secretFilterEnabledRef.current = secretFilterEnabled
  }, [secretFilterEnabled])

  const behavior = useMemo<XtermBehavior>(
    () => ({
      sendInput: (id, data) => window.termhub.sendInput(id, data),
      resize: (id, cols, rows) => window.termhub.resize(id, cols, rows),
      minRows: 5,
      interceptShiftEnter: true,
      focusOnReactivate: true,
      logTag: 'terminal',
      scanBeforePaste: async (text: string): Promise<boolean> => {
        if (!secretFilterEnabledRef.current) return true
        const findings = await window.termhub.scanClipboardForSecrets(text)
        if (findings.length === 0) return true
        return new Promise<boolean>((resolve) => {
          pasteResolveRef.current = resolve
          // setPasteDialog is a stable React setter — safe to call from a
          // closure with empty deps because the setter identity never changes.
          setPasteDialog({ findings })
        })
      },
    }),
    // Stable closure: reads from refs, calls stable setters. Never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const containerRef = useXterm({
    session,
    isActive,
    termsRef,
    pendingDataRef,
    behavior,
  })

  const handlePasteConfirm = useCallback(() => {
    pasteResolveRef.current?.(true)
    pasteResolveRef.current = null
    setPasteDialog(null)
  }, [])

  const handlePasteCancel = useCallback(() => {
    pasteResolveRef.current?.(false)
    pasteResolveRef.current = null
    setPasteDialog(null)
  }, [])

  return (
    <>
      <div
        className="terminal-pane"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        <div ref={containerRef} className="terminal-container" />
      </div>
      {pasteDialog !== null && isActive && (
        <PasteSecretDialog
          findings={pasteDialog.findings}
          onConfirm={handlePasteConfirm}
          onCancel={handlePasteCancel}
        />
      )}
    </>
  )
}
