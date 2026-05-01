import { useEffect, useRef, useState } from 'react'
import type { ShellInfo } from './types'

type Props = {
  shells: ShellInfo[]
  activeShellId: string | null
  onSelect: (shellId: string) => void
}

type MenuPos = { top: number; right: number }

export function ShellPicker({ shells, activeShellId, onSelect }: Props) {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const open = menuPos !== null
  const activeShell = shells.find((s) => s.id === activeShellId)

  const handleToggle = () => {
    if (open) {
      setMenuPos(null)
      return
    }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      // Open above the button, right-aligned to the button's right edge.
      setMenuPos({
        top: rect.top - 4,
        right: window.innerWidth - rect.right,
      })
    }
  }

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !btnRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setMenuPos(null)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuPos(null)
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
    <>
      <button
        ref={btnRef}
        className="shell-picker-btn"
        onClick={handleToggle}
        title="Change shell"
      >
        {activeShell?.label ?? activeShellId ?? 'Shell'}
        <span className="shell-picker-chevron">▾</span>
      </button>
      {open && menuPos && (
        <div
          ref={menuRef}
          className="shell-picker-menu"
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            transform: 'translateY(-100%)',
          }}
        >
          {shells.map((shell) => (
            <button
              key={shell.id}
              className="context-menu-item shell-picker-option"
              onClick={() => {
                onSelect(shell.id)
                setMenuPos(null)
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
    </>
  )
}
