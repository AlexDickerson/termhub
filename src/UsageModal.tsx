import { useEffect, useRef } from 'react'

type Props = {
  onClose: () => void
}

export function UsageModal({ onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Close when clicking the backdrop (not the modal content)
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '860px',
          height: '640px',
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          background: '#221e32',
          borderRadius: '8px',
          border: '1px solid #302848',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid #302848',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text, #ccc)', letterSpacing: '0.04em' }}>
            Claude Usage
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #888)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '16px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* webview — uses a named partition so cookies persist across restarts */}
        <webview
          src="https://claude.ai/settings/usage"
          partition="persist:claude-usage"
          style={{ flex: 1, width: '100%' }}
        />
      </div>
    </div>
  )
}
