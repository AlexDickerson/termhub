import { useEffect, useRef } from 'react'
import type { Session } from './types'

type Props = {
  session: Session
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmCloseModal({ session, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Default focus on Cancel so Enter doesn't accidentally close
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // Dismiss (cancel) on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  // Cancel when clicking the backdrop (not the dialog itself)
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onCancel()
  }

  const label = session.name ?? session.cwd

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="confirm-close-overlay"
    >
      <div className="confirm-close-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-close-title">
        <p id="confirm-close-title" className="confirm-close-msg">
          Close session <strong>{label}</strong>?
        </p>
        <p className="confirm-close-sub">
          Any unsaved work in the session will be lost.
        </p>
        <div className="confirm-close-actions">
          <button
            className="confirm-close-btn confirm-close-btn-destructive"
            onClick={onConfirm}
          >
            Close
          </button>
          <button
            ref={cancelRef}
            className="confirm-close-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
