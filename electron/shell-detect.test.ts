import { describe, it, expect, afterEach } from 'vitest'
import { defaultShellId } from './shell-detect'
import type { ShellInfo } from './shell-detect'

const WIN_SHELLS: ShellInfo[] = [
  { id: 'pwsh', label: 'PowerShell 7+ (pwsh)', command: 'pwsh.exe', args: [] },
  { id: 'powershell', label: 'Windows PowerShell 5.1', command: 'powershell.exe', args: [] },
  { id: 'cmd', label: 'Command Prompt (cmd)', command: 'cmd.exe', args: [] },
  { id: 'wsl', label: 'WSL', command: 'wsl.exe', args: [] },
]

const UNIX_SHELLS: ShellInfo[] = [
  { id: 'zsh', label: 'zsh', command: 'zsh', args: [] },
  { id: 'bash', label: 'bash', command: 'bash', args: [] },
  { id: 'sh', label: 'sh', command: 'sh', args: [] },
]

describe('defaultShellId (Windows)', () => {
  it('prefers pwsh when all shells present', () => {
    expect(defaultShellId(WIN_SHELLS, 'win32')).toBe('pwsh')
  })

  it('falls back to powershell when pwsh absent', () => {
    const shells = WIN_SHELLS.filter((s) => s.id !== 'pwsh')
    expect(defaultShellId(shells, 'win32')).toBe('powershell')
  })

  it('falls back to cmd when pwsh and powershell absent', () => {
    const shells = WIN_SHELLS.filter(
      (s) => s.id !== 'pwsh' && s.id !== 'powershell',
    )
    expect(defaultShellId(shells, 'win32')).toBe('cmd')
  })

  it('falls back to wsl when only wsl present', () => {
    const shells = WIN_SHELLS.filter((s) => s.id === 'wsl')
    expect(defaultShellId(shells, 'win32')).toBe('wsl')
  })

  it('returns first shell when none of the preferred ids match', () => {
    const shells: ShellInfo[] = [
      { id: 'nushell', label: 'Nu', command: 'nu.exe', args: [] },
    ]
    expect(defaultShellId(shells, 'win32')).toBe('nushell')
  })
})

describe('defaultShellId (Unix)', () => {
  const originalShell = process.env.SHELL

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  it('prefers $SHELL when it matches a detected shell', () => {
    process.env.SHELL = '/bin/zsh'
    expect(defaultShellId(UNIX_SHELLS, 'linux')).toBe('zsh')
  })

  it('falls back to zsh when $SHELL is not in the list', () => {
    process.env.SHELL = '/usr/local/bin/fish'
    expect(defaultShellId(UNIX_SHELLS, 'linux')).toBe('zsh')
  })

  it('falls back to bash when zsh absent and $SHELL unset', () => {
    delete process.env.SHELL
    const shells = UNIX_SHELLS.filter((s) => s.id !== 'zsh')
    expect(defaultShellId(shells, 'linux')).toBe('bash')
  })

  it('falls back to sh when only sh present', () => {
    delete process.env.SHELL
    const shells = UNIX_SHELLS.filter((s) => s.id === 'sh')
    expect(defaultShellId(shells, 'linux')).toBe('sh')
  })
})
