// Detects which interactive shells are available on this machine.
// Cached after first call — where.exe / which calls are not free.

import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

export type ShellInfo = {
  id: string
  label: string
  command: string
  args: string[]
}

let cachedShells: ShellInfo[] | null = null

function probeWindows(command: string): boolean {
  try {
    execFileSync('where.exe', [command], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function probeUnix(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function detectWindowsShells(): ShellInfo[] {
  const candidates: ShellInfo[] = [
    { id: 'pwsh', label: 'PowerShell 7+ (pwsh)', command: 'pwsh.exe', args: [] },
    {
      id: 'powershell',
      label: 'Windows PowerShell 5.1',
      command: 'powershell.exe',
      args: [],
    },
    { id: 'cmd', label: 'Command Prompt (cmd)', command: 'cmd.exe', args: [] },
    { id: 'wsl', label: 'WSL', command: 'wsl.exe', args: [] },
  ]
  return candidates.filter((s) => probeWindows(s.command))
}

function detectUnixShells(): ShellInfo[] {
  const envShell = process.env.SHELL
  const seen = new Set<string>()
  const result: ShellInfo[] = []

  if (envShell) {
    const basename = path.basename(envShell)
    if (probeUnix(envShell) && !seen.has(basename)) {
      seen.add(basename)
      result.push({ id: basename, label: basename, command: envShell, args: [] })
    }
  }

  for (const cmd of ['zsh', 'bash', 'sh']) {
    if (seen.has(cmd)) continue
    if (probeUnix(cmd)) {
      seen.add(cmd)
      result.push({ id: cmd, label: cmd, command: cmd, args: [] })
    }
  }

  return result
}

// Returns shells available on this machine. Result is cached after first call.
export function detectShells(): ShellInfo[] {
  if (cachedShells !== null) return cachedShells

  try {
    const shells =
      process.platform === 'win32' ? detectWindowsShells() : detectUnixShells()
    if (shells.length > 0) {
      cachedShells = shells
      console.log(
        `[termhub:shells] detected: ${shells.map((s) => s.id).join(', ')}`,
      )
      return shells
    }
  } catch (err) {
    console.warn('[termhub:shells] detection error:', err)
  }

  const fallback: ShellInfo = {
    id: 'default',
    label:
      process.platform === 'win32'
        ? 'Command Prompt (cmd)'
        : (process.env.SHELL ?? 'sh'),
    command:
      process.platform === 'win32'
        ? (process.env.COMSPEC ?? 'cmd.exe')
        : (process.env.SHELL ?? 'sh'),
    args: [],
  }
  cachedShells = [fallback]
  console.warn(
    `[termhub:shells] no shells detected; falling back to ${fallback.command}`,
  )
  return cachedShells
}

// Returns the id to use when no user preference has been saved.
// Accepts an optional platform override so the function can be tested without
// mutating process.platform.
export function defaultShellId(
  shells: ShellInfo[],
  platform: string = process.platform,
): string {
  if (platform === 'win32') {
    for (const id of ['pwsh', 'powershell', 'cmd', 'wsl', 'default']) {
      if (shells.find((s) => s.id === id)) return id
    }
  } else {
    const envShell = process.env.SHELL
    if (envShell) {
      const basename = path.basename(envShell)
      const match = shells.find((s) => s.id === basename)
      if (match) return match.id
    }
    for (const id of ['zsh', 'bash', 'sh', 'default']) {
      if (shells.find((s) => s.id === id)) return id
    }
  }
  return shells[0]?.id ?? 'cmd'
}
