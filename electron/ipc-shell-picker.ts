// IPC handlers for the bottom-terminal shell picker.
// Exposes detected shells, handles shell selection, persists the choice,
// and respawns all active bottom-terminal PTYs with the new shell.

import { ipcMain } from 'electron'
import { detectShells, defaultShellId } from './shell-detect'
import {
  setBottomShell,
  respawnAllShells,
} from './session-manager'
import { loadConfig, saveConfig } from './config'

function resolveActiveShellId(): string {
  const shells = detectShells()
  const config = loadConfig()
  const saved = config.bottomTerminal?.shellId
  if (saved && shells.find((s) => s.id === saved)) return saved
  return defaultShellId(shells)
}

// Called at app startup to wire the configured shell into session-manager
// before any sessions are created. Also eagerly populates the detection cache.
export function initBottomShell(): void {
  console.log('[termhub:shells] detecting available shells...')
  const shells = detectShells()
  const shellId = resolveActiveShellId()
  const shell = shells.find((s) => s.id === shellId) ?? shells[0]
  if (shell) {
    setBottomShell({ command: shell.command, args: shell.args })
    console.log(`[termhub:shells] initial shell: ${shellId} (${shell.command})`)
  }
}

export function registerShellPickerHandlers(): void {
  ipcMain.handle('bottom-terminal:list-shells', () => {
    const shells = detectShells()
    const activeShellId = resolveActiveShellId()
    return { shells, activeShellId }
  })

  ipcMain.handle('bottom-terminal:set-shell', (_event, shellId: string) => {
    const shells = detectShells()
    const shell = shells.find((s) => s.id === shellId)
    if (!shell) throw new Error(`Unknown shell id: ${shellId}`)

    const config = loadConfig()
    saveConfig({
      ...config,
      bottomTerminal: { ...config.bottomTerminal, shellId },
    })

    setBottomShell({ command: shell.command, args: shell.args })
    respawnAllShells({ command: shell.command, args: shell.args })

    console.log(
      `[termhub:shells] shell changed to ${shellId} (${shell.command})`,
    )
  })
}
