import { useEffect, useRef } from 'react'
import type { SecretFinding } from './types'
import { truncateSecret } from './paste-filter'

type Props = {
  findings: SecretFinding[]
  onConfirm: () => void
  onCancel: () => void
}

export function PasteSecretDialog({ findings, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onCancel()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="confirm-close-overlay"
    >
      <div
        className="confirm-close-dialog paste-secret-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-secret-title"
      >
        <p id="paste-secret-title" className="confirm-close-msg">
          Possible secret detected in clipboard
        </p>
        <p className="confirm-close-sub">
          The following pattern{findings.length > 1 ? 's were' : ' was'} detected:
        </p>
        <ul className="paste-secret-findings">
          {findings.map((f, i) => (
            <li key={i} className="paste-secret-finding">
              <span className="paste-secret-rule">{f.ruleId.replace(/^@secretlint\/secretlint-rule-/, '')}</span>
              <code className="paste-secret-snippet">{truncateSecret(f.matchedText)}</code>
            </li>
          ))}
        </ul>
        <div className="confirm-close-actions">
          <button
            ref={cancelRef}
            className="confirm-close-btn"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="confirm-close-btn confirm-close-btn-destructive"
            onClick={onConfirm}
          >
            Paste anyway
          </button>
        </div>
      </div>
    </div>
  )
}
