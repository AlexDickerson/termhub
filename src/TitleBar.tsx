import { useEffect, useState } from 'react'

type Props = {
  onOpenUsage: () => void
}

export function TitleBar({ onOpenUsage }: Props) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.termhub.isMaximized().then(setMaximized)
    const off = window.termhub.onMaximizeChange(setMaximized)
    return off
  }, [])

  return (
    <div className="title-bar">
      <span className="title-bar-brand">TermHub</span>
      <div className="title-bar-spacer" />
      <div className="title-bar-right">
        {/* Usage button */}
        <button className="title-bar-icon-btn" onClick={onOpenUsage} title="Claude Usage">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="9" width="3" height="6" rx="1" />
            <rect x="6" y="5" width="3" height="10" rx="1" />
            <rect x="11" y="1" width="3" height="14" rx="1" />
          </svg>
        </button>
        {/* Window controls */}
        <div className="title-bar-controls">
          <button
            className="wc-btn wc-minimize"
            onClick={() => window.termhub.minimizeWindow()}
            title="Minimize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="0" y="4.5" width="10" height="1" />
            </svg>
          </button>
          <button
            className="wc-btn wc-maximize"
            onClick={() => window.termhub.maximizeWindow()}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? (
              /* Restore icon: two overlapping squares */
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="2.5" y="0.5" width="7" height="7" />
                <rect x="0.5" y="2.5" width="7" height="7" />
              </svg>
            ) : (
              /* Maximize icon: single square */
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="0.5" width="9" height="9" />
              </svg>
            )}
          </button>
          <button
            className="wc-btn wc-close"
            onClick={() => window.termhub.closeWindow()}
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
