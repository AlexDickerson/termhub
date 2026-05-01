import { useEffect, useRef, useState } from 'react'
import type { ShellInfo } from './types'

type Props = {
  shells: ShellInfo[]
  activeShellId: string | null
  onSelect: (shellId: string) => void
}

export function ShellPicker({ shells, activeShellId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const activeShell = shells.find((s) => s.id === activeShellId)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (shells.length === 0) return null

  return (
    <div className="shell-picker" ref={wrapperRef}>
      <button
        className="shell-picker-btn"
        onClick={() => setOpen((v) => !v)}
        title="Change shell"
      >
        {activeShell?.label ?? activeShellId ?? 'Shell'}
        <span className="shell-picker-chevron">▾</span>
      </button>
      {open && (
        <div className="shell-picker-menu">
          {shells.map((shell) => (
            <button
              key={shell.id}
              className="context-menu-item shell-picker-option"
              onClick={() => {
                onSelect(shell.id)
                setOpen(false)
              }}
            >
              <span className="shell-picker-check">
                {shell.id === activeShellId ? '✓' : ''}
              </span>
              {shell.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
