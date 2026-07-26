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
import { openExternalUrl } from './opener'
import { getConfigPath, saveConfig } from './config'
import { discoverProjects } from './project-discovery'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function registerAppHandlers(opts: { config: Config }): void {
  // The anchored repos directory. Held on the live config object so a change
  // takes effect without a restart; persisted so it survives one.
  ipcMain.handle('projects:getReposDir', () => opts.config.reposDir ?? null)

  ipcMain.handle('projects:list', () => {
    if (!opts.config.reposDir) return []
    return discoverProjects(opts.config.reposDir)
  })

  ipcMain.handle('projects:setReposDir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the folder that holds your projects',
      defaultPath: opts.config.reposDir ?? os.homedir(),
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    opts.config.reposDir = picked
    saveConfig(opts.config)
    console.log(`[termhub:projects] repos directory set to ${picked}`)
    return picked
  })

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

  // Open config.json in the OS default editor. termhub has no settings UI —
  // mcpPort and startupSessions are edited by hand — and the path lives deep
  // inside userData, so without this the file is effectively unreachable.
  ipcMain.handle('config:open', async () => {
    const configPath = getConfigPath()
    const error = await shell.openPath(configPath)
    if (error) {
      console.error(`[termhub] failed to open config at ${configPath}: ${error}`)
      throw new Error(`Could not open ${configPath}: ${error}`)
    }
    console.log(`[termhub] opened config ${configPath} in the default editor`)
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.on('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.on('open-external', (_event, url: string) => {
    if (isAllowedExternalUrl(url)) {
      openExternalUrl(url)
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
