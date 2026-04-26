// IPC handlers for app-level utilities: VS Code launch, native folder
// picker, clipboard read/write, external URL opens (allowlisted),
// window controls, config getters. Anything that's not session-
// or discovery-related ends up here.
//
// The mainWindow ref needed by dialog and window controls is injected
// at startup via setMainWindow so this module doesn't import main.ts.

import { ipcMain, dialog, clipboard, shell, BrowserWindow } from 'electron'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import type { Config } from '../src/types'
import { isAllowedExternalUrl } from './links'
import { getConfigPath, writeConfig } from './config'
import { scanForSecrets } from './secret-scanner'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function registerAppHandlers(opts: { config: Config }): void {
  ipcMain.handle('vscode:open', (_event, cwd: string) => {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('code', [cwd], {
        shell: true,
        detached: true,
        stdio: 'ignore',
      })
      proc.unref()
      proc.on('error', (err) => {
        console.error('[termhub] failed to open VS Code:', err)
        reject(err)
      })
      // Resolve immediately — we don't wait for the editor to close
      resolve()
    })
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder for the new session',
      defaultPath: os.homedir(),
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('app:home', () => os.homedir())
  ipcMain.handle('config:get', () => opts.config)
  ipcMain.handle('config:path', () => getConfigPath())

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.on('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('secrets:scan', async (_event, text: string) => {
    try {
      return await scanForSecrets(text)
    } catch (err) {
      console.error('[termhub:paste-filter] scan error:', err)
      return []
    }
  })

  ipcMain.handle('config:setPasteFilter', (_event, enabled: boolean) => {
    opts.config.paste = { secretFilterEnabled: enabled }
    writeConfig(opts.config)
    console.info(`[termhub:paste-filter] secretFilterEnabled set to ${enabled}`)
  })

  ipcMain.on('open-external', (_event, url: string) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url)
    } else {
      try {
        console.warn(
          '[termhub:links] rejected openExternal with disallowed scheme:',
          new URL(url).protocol,
        )
      } catch {
        console.warn(
          '[termhub:links] rejected openExternal with malformed URL:',
          url,
        )
      }
    }
  })

  // Window controls — invoked from the custom title bar.
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })
  ipcMain.handle(
    'window:isMaximized',
    () => mainWindow?.isMaximized() ?? false,
  )
}
