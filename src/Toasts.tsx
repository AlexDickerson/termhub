import type { Toast } from './toast-state'

type Props = {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function Toasts({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <div className="toast-body">
            <span className="toast-message">{t.message}</span>
            {t.detail && <span className="toast-detail">{t.detail}</span>}
          </div>
          <button
            className="toast-dismiss"
            onClick={() => onDismiss(t.id)}
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
