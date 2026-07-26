import { useCallback, useRef, useState } from 'react'
import {
  addToast,
  autoDismissMs,
  describeError,
  dismissToast,
  type Toast,
  type ToastKind,
} from './toast-state'

export type ToastApi = {
  toasts: Toast[]
  dismiss: (id: number) => void
  notify: (kind: ToastKind, message: string, detail?: string) => void
  // Convenience for catch blocks: `reportError('Failed to create session', err)`.
  reportError: (message: string, err: unknown) => void
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => dismissToast(prev, id))
  }, [])

  const notify = useCallback(
    (kind: ToastKind, message: string, detail?: string) => {
      const id = nextId.current++
      setToasts((prev) => addToast(prev, { id, kind, message, detail }))
      const ms = autoDismissMs(kind)
      if (ms !== null) {
        setTimeout(() => {
          setToasts((prev) => dismissToast(prev, id))
        }, ms)
      }
    },
    [],
  )

  const reportError = useCallback(
    (message: string, err: unknown) => {
      // Keep the console line too — it carries the stack, which the toast
      // deliberately doesn't.
      console.error(`[termhub] ${message}:`, err)
      notify('error', message, describeError(err))
    },
    [notify],
  )

  return { toasts, dismiss, notify, reportError }
}
