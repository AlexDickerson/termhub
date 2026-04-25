// Electron main entry. Bootstrap only: dev/prod userData isolation,
// window creation, MCP server stand-up (with the open_session
// serialization queue), session bootstrap on renderer ready, and IPC
// handler registration. Session lifecycle, IPC handler bodies, and
// pure helpers all live in their own modules.

import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { startMcpServer, type McpHandle } from './mcp'
import type { Config } from '../src/types'
import { stripAnsi } from './output-buffer'
import { writeBracketedPasteAndSubmit } from './claude-command'
import { getMcpConfigPath, loadConfig } from './config'
import { loadPersistedSessions } from './persistence'
import {
  createSessionInternal,
  findSessionByIdOrPrefix,
  killAllSessions,
  setMainWindow,
} from './session-manager'
import { registerSessionHandlers } from './ipc-session'
import { registerDiscoveryHandlers } from './ipc-discovery'
import {
  registerAppHandlers,
  setMainWindow as setAppHandlersMainWindow,
} from './ipc-app'
import {
  registerPrHandlers,
  setMainWindowForPr,
} from './ipc-pr'

// Isolate dev builds so their sessions, config, and MCP port don't bleed
// into the production instance running alongside. Must run before the
// first app.getPath('userData') use (which happens inside whenReady).
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), '..', 'termhub-dev'))
  console.log('[termhub] dev mode — userData:', app.getPath('userData'))
}

let mainWindow: BrowserWindow | null = null
let mcpHandle: McpHandle | null = null

function getBridgePath(): string {
  // dist/main/main.js → ../mcp-bridge.js → dist/mcp-bridge.js
  return path.join(__dirname, '..', 'mcp-bridge.js')
}

// Write the MCP config file that claude reads to discover the termhub
// MCP server. Uses stdio transport: claude spawns the bridge subprocess
// and pipes JSON-RPC over stdin/stdout. No HTTP, no OAuth flow.
function writeMcpConfigFile(port: number): void {
  const configPath = getMcpConfigPath()
  const body = {
    mcpServers: {
      termhub: {
        type: 'stdio',
        command: process.execPath,
        args: [getBridgePath()],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          TERMHUB_PORT: String(port),
        },
      },
    },
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(body, null, 2))
  console.log(`[termhub] wrote MCP config to ${configPath}`)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#161618',
    title: 'termhub',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  })

  // Push maximize/restore state to the renderer so the title bar button
  // can show the correct icon without polling.
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizeChange', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizeChange', false)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
    setAppHandlersMainWindow(null)
    setMainWindowForPr(null)
  })

  // Wire the new BrowserWindow into modules that broadcast events to it.
  setMainWindow(mainWindow)
  setAppHandlersMainWindow(mainWindow)
  setMainWindowForPr(mainWindow)
}

// Renderer signals readiness via 'app:ready' once it has subscribed to
// session:data / session:added / session:exit. We defer creating the
// startup + resume sessions until after that, otherwise early pty output
// would be sent before any listener exists.
let rendererReadyResolve: (() => void) | null = null
const rendererReady = new Promise<void>((resolve) => {
  rendererReadyResolve = resolve
})

function bootstrapSessions(config: Config): void {
  const persisted = loadPersistedSessions()
  const occupiedCwds = new Set<string>()

  for (const s of persisted) {
    try {
      createSessionInternal({
        id: s.id,
        cwd: s.cwd,
        command: s.command,
        name: s.name,
        model: s.model,
        permissionMode: s.permissionMode,
        dangerouslySkipPermissions: s.dangerouslySkipPermissions,
        allowDangerouslySkipPermissions: s.allowDangerouslySkipPermissions,
        source: 'resume',
      })
      occupiedCwds.add(s.cwd)
    } catch (err) {
      console.error(
        `[termhub] failed to resume session ${s.id.slice(0, 8)}:`,
        err,
      )
    }
  }

  for (const entry of config.startupSessions) {
    if (occupiedCwds.has(entry.cwd)) {
      console.log(
        `[termhub] skipping startup entry ${entry.cwd} (resumed from persistence)`,
      )
      continue
    }
    try {
      createSessionInternal({
        cwd: entry.cwd,
        command: entry.command,
        prompt: entry.prompt,
        agent: entry.agent,
        model: entry.model,
        dangerouslySkipPermissions: entry.dangerouslySkipPermissions,
        allowDangerouslySkipPermissions: entry.allowDangerouslySkipPermissions,
        permissionMode: entry.permissionMode,
        name: entry.name,
        source: 'startup',
      })
      occupiedCwds.add(entry.cwd)
    } catch (err) {
      console.error('[termhub] startup session failed for', entry.cwd, err)
    }
  }
}

app.whenReady().then(async () => {
  // Remove the native File/Edit/… menu bar entirely.
  Menu.setApplicationMenu(null)

  const config = loadConfig()
  writeMcpConfigFile(config.mcpPort)

  // Serialize MCP open_session calls. The orchestrator can fan out N
  // parallel open_session requests; we chain each through this queue
  // so session N+1 only begins spawning after session N has finished
  // delivering its initial prompt (paste + CR written, or settled via
  // fallback / exit). Without serialization, simultaneous spawns
  // contend for CPU/IO, claude takes longer to reach 'idle', and
  // prompts pasted before the submit handler is wired land in the
  // input box without firing submit. The HTTP layer in mcp.ts is
  // unchanged — serialization happens entirely inside this hook.
  let openSessionQueue: Promise<unknown> = Promise.resolve()

  try {
    mcpHandle = await startMcpServer({
      port: config.mcpPort,
      hooks: {
        openClaudeSession: async ({
          cwd,
          prompt,
          agent,
          model,
          dangerouslySkipPermissions,
          allowDangerouslySkipPermissions,
          permissionMode,
          name,
        }) => {
          const myTurn = openSessionQueue.catch(() => {})
          let release!: (value: unknown) => void
          openSessionQueue = new Promise((resolve) => {
            release = resolve
          })
          await myTurn
          try {
            const result = createSessionInternal({
              cwd,
              command: 'claude',
              prompt,
              agent,
              model,
              dangerouslySkipPermissions,
              allowDangerouslySkipPermissions,
              permissionMode,
              name,
              source: 'mcp',
            })
            await result.promptSettled
            return { id: result.id, cwd: result.cwd }
          } finally {
            release(undefined)
          }
        },
        sendInput: ({ sessionId, text }) => {
          const result = findSessionByIdOrPrefix(sessionId)
          if (!result.found) return { ok: false, error: result.error }
          try {
            writeBracketedPasteAndSubmit(result.session.term, text)
            return { ok: true }
          } catch (err) {
            return {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        },
        readOutput: ({ sessionId, maxChars, raw }) => {
          const result = findSessionByIdOrPrefix(sessionId)
          if (!result.found) return { error: result.error }
          let text = result.session.outputBuffer
          if (!raw) text = stripAnsi(text)
          if (
            typeof maxChars === 'number' &&
            maxChars > 0 &&
            text.length > maxChars
          ) {
            text = text.slice(text.length - maxChars)
          }
          return { text }
        },
      },
    })
  } catch (err) {
    console.error('[termhub] failed to start MCP server:', err)
  }

  ipcMain.once('app:ready', () => {
    rendererReadyResolve?.()
  })

  createWindow()

  // Bootstrap once the renderer is listening
  rendererReady.then(() => bootstrapSessions(config))

  registerSessionHandlers()
  registerDiscoveryHandlers()
  registerAppHandlers({ config })
  registerPrHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllSessions()
  if (mcpHandle) {
    mcpHandle.close().catch(() => {})
    mcpHandle = null
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  killAllSessions()
})
