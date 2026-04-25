import { useState, type ReactNode } from 'react'

type Props = {
  title: string
  defaultOpen?: boolean
  action?: ReactNode
  children: ReactNode
}

export function CollapsibleSection({ title, defaultOpen = true, action, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`section ${open ? 'open' : 'closed'}`}>
      <div className="section-header">
        <button
          className="section-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="section-chevron">{open ? '▾' : '▸'}</span>
          <span className="section-title">{title}</span>
        </button>
        {action ? <div className="section-action">{action}</div> : null}
      </div>
      {open ? <div className="section-body">{children}</div> : null}
    </div>
  )
}
