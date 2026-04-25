import { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } from 'electron'
import * as pty from '@lydell/node-pty'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { startMcpServer, type McpHandle } from './mcp'
import { isAllowedExternalUrl } from './links'
import { watchSessionStatus, type WatcherHandle } from './status-watcher'
import type { Config, SessionStatus } from '../src/types'
import { appendToBuffer, stripAnsi } from './output-buffer'
import { detectRepoRoot } from './repo-root'
import {
  buildClaudeCommand,
  cleanEnv,
  isClaudeCommand,
  writeBracketedPasteAndSubmit,
} from './claude-command'
import { listAgents, listSkills, getAgentsDir, getSkillsDir } from './agents-skills'
import { getConfigPath, getMcpConfigPath, loadConfig } from './config'
import {
  loadPersistedSessions,
  writePersistedSessions,
  type PersistedSession,
} from './persistence'

// Re-export buildClaudeArgs so the existing main.test.ts import keeps
// working without churn while #7b is in flight. The canonical export now
// lives in ./claude-command and the test will be moved when status/session
// management lands there.
export { buildClaudeArgs } from './claude-command'

// Isolate dev builds so their sessions, config, and MCP port don't bleed into
// the production instance running alongside. Must be called before the first
// app.getPath('userData') use (which happens inside app.whenReady callbacks).
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('userData'), '..', 'termhub-dev'))
  console.log('[termhub] dev mode — userData:', app.getPath('userData'))
}

type Session = {
  id: string
  cwd: string
  command?: string
  name?: string
  repoRoot?: string
  repoLabel?: string
  model?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  // Primary PTY — runs claude (or whatever command the caller asked for).
  // This is what the MCP tools target.
  term: pty.IPty
  outputBuffer: string
  status: SessionStatus
  // Watcher for the Claude Code JSONL file that provides ground-truth status.
  // Null when no JSONL file has been located yet (session just started).
  jsonlWatcher: WatcherHandle | null
  // Secondary "shell" PTY — a plain interactive shell rooted at `cwd`,
  // docked at the bottom of the UI for the user's own manual work. Not
  // exposed via MCP, not persisted. Lifetime is bound to the session.
  shellTerm: pty.IPty
}

// Validate cols/rows from the renderer and forward to a PTY. Both the primary
// (claude) and the secondary (shell) PTYs receive resize requests on every UI
// resize / divider drag, so this gets called frequently. Non-finite values
// from the renderer (NaN, Infinity) are silently dropped; resize errors from
// an already-exited PTY are swallowed because they race against shutdown.
//
// Duck-typed on `resize` so unit tests can pass a plain object instead of a
// real PTY. Exported only for tests.
type PtyResizeTarget = { resize: (cols: number, rows: number) => void }
export function resizePty(target: PtyResizeTarget, cols: number, rows: number): void {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
  const c = Math.max(1, Math.floor(cols))
  const r = Math.max(1, Math.floor(rows))
  try {
    target.resize(c, r)
  } catch {
    // pty may have exited between resize requests
  }
}

// ---------------------------------------------------------------------------
// Status management
// ---------------------------------------------------------------------------

// Tracks which session ids have had at least one 'session:status' event sent
// to the renderer. Without this, sessions whose first observed status equals
// the initial 'working' default would never emit (the equality check below
// would suppress a no-op transition), and the renderer would default the
// dot to 'idle' (green) for active sessions stuck busy. Cleared in
// killAllSessions and on session removal.
const statusEmitted = new Set<string>()

// Pure decision: should this transition produce a 'session:status' IPC
// emission? Forces the very first emission per session id so the renderer
// has a seeded value, then suppresses no-op (equal) transitions.
//
// Exported only for tests.
export function shouldEmitStatus(
  emitted: ReadonlySet<string>,
  sessionId: string,
  current: SessionStatus,
  next: SessionStatus,
): boolean {
  return !emitted.has(sessionId) || current !== next
}

function setStatus(session: Session, next: SessionStatus) {
  if (!shouldEmitStatus(statusEmitted, session.id, session.status, next)) return
  session.status = next
  statusEmitted.add(session.id)
  mainWindow?.webContents.send('session:status', { id: session.id, status: next })
}

type FindSessionResult =
  | { found: true; session: Session }
  | { found: false; error: string }

function findSessionByIdOrPrefix(idOrPrefix: string): FindSessionResult {
  const direct = sessions.get(idOrPrefix)
  if (direct) return { found: true, session: direct }
  const matches = Array.from(sessions.values()).filter((s) =>
    s.id.startsWith(idOrPrefix),
  )
  if (matches.length === 1) return { found: true, session: matches[0] }
  if (matches.length === 0) {
    return { found: false, error: `No session found for "${idOrPrefix}"` }
  }
  return {
    found: false,
    error: `Ambiguous prefix "${idOrPrefix}" — matches ${matches.length} sessions`,
  }
}

const sessions = new Map<string, Session>()
let mainWindow: BrowserWindow | null = null
let mcpHandle: McpHandle | null = null
let mcpConfigPath = ''

// Thin wrapper around writePersistedSessions that snapshots the live
// `sessions` Map into the persistence wire format. Called whenever
// session state changes (create / close / rename / exit).
function persistSessions() {
  const list: PersistedSession[] = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    command: s.command,
    name: s.name,
    model: s.model,
    permissionMode: s.permissionMode,
    dangerouslySkipPermissions: s.dangerouslySkipPermissions,
    allowDangerouslySkipPermissions: s.allowDangerouslySkipPermissions,
  }))
  writePersistedSessions(list)
}

function getBridgePath(): string {
  // dist/main/main.js → ../mcp-bridge.js → dist/mcp-bridge.js
  return path.join(__dirname, '..', 'mcp-bridge.js')
}

function writeMcpConfigFile(port: number): string {
  const configPath = getMcpConfigPath()
  // Use stdio transport: claude spawns the bridge subprocess and pipes
  // JSON-RPC over stdin/stdout. No HTTP, no OAuth flow.
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
  return configPath
}

function createSessionInternal(opts: {
  id?: string
  cwd: string
  command?: string
  prompt?: string
  agent?: string
  model?: string
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  permissionMode?: string
  name?: string
  source: 'ipc' | 'mcp' | 'startup' | 'resume'
}): { id: string; cwd: string } {
  const id = opts.id ?? randomUUID()
  const shell = process.env.COMSPEC || 'cmd.exe'
  console.log(
    `[termhub] spawning ${shell} in ${opts.cwd} (id=${id.slice(0, 8)}, source=${opts.source})`,
  )
  let term: pty.IPty
  try {
    term = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: opts.cwd,
      env: cleanEnv(),
    })
  } catch (err) {
    console.error('[termhub] pty.spawn failed:', err)
    throw err
  }
  console.log(`[termhub] pty.spawn returned (pid=${term.pid})`)

  // Secondary shell PTY — same executable + cwd as the primary, but holds a
  // plain interactive prompt for the user's own work. We mirror the primary's
  // shell choice so the bottom pane matches what the user sees by default.
  let shellTerm: pty.IPty
  try {
    shellTerm = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 10,
      cwd: opts.cwd,
      env: cleanEnv(),
    })
  } catch (err) {
    console.error('[termhub] pty.spawn (shell) failed:', err)
    // Roll back the primary so we don't leak a dangling PTY.
    try {
      term.kill()
    } catch {
      // ignore
    }
    throw err
  }
  console.log(`[termhub] shell pty.spawn returned (pid=${shellTerm.pid})`)

  const repoInfo = detectRepoRoot(opts.cwd)
  const session: Session = {
    id,
    cwd: opts.cwd,
    command: opts.command,
    name: opts.name,
    repoRoot: repoInfo?.repoRoot,
    repoLabel: repoInfo?.repoLabel,
    model: opts.model,
    permissionMode: opts.permissionMode,
    dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
    allowDangerouslySkipPermissions: opts.allowDangerouslySkipPermissions,
    term,
    outputBuffer: '',
    // Start as 'working' — JSONL file may not exist yet (Claude Code creates
    // it after the session initialises). We assume busy until JSONL says otherwise.
    status: 'working',
    jsonlWatcher: null,
    shellTerm,
  }
  sessions.set(id, session)
  persistSessions()

  // Seed the renderer with the initial status so the sidebar dot doesn't
  // default to 'idle' (green) while the session is actually working. The
  // first-emit force in setStatus handles cases where the first JSONL
  // reading happens to equal the initial 'working' default.
  setStatus(session, session.status)

  // Watch the Claude Code JSONL file for ground-truth status updates. The
  // file is created by Claude Code shortly after startup; the watcher polls
  // and will begin emitting once the file appears.
  if (opts.command && isClaudeCommand(opts.command)) {
    session.jsonlWatcher = watchSessionStatus(id, (next) => {
      // 'failed' is only set on PTY exit — never override it from JSONL.
      if (session.status !== 'failed') {
        setStatus(session, next)
      }
    })
  }

  let firstData = true
  term.onData((data) => {
    if (firstData) {
      firstData = false
      console.log(`[termhub] first data from ${id.slice(0, 8)} (${data.length} bytes)`)
    }
    session.outputBuffer = appendToBuffer(session.outputBuffer, data)
    mainWindow?.webContents.send('session:data', { id, data })
  })

  term.onExit(({ exitCode }) => {
    console.log(`[termhub] session ${id.slice(0, 8)} exited (code=${exitCode})`)
    // Stop the JSONL watcher — no more status updates after exit.
    if (session.jsonlWatcher) {
      session.jsonlWatcher.stop()
      session.jsonlWatcher = null
    }
    // Emit the terminal status BEFORE the exit event so the renderer has
    // it set when it decides whether to keep the row visible.
    setStatus(session, exitCode === 0 ? 'idle' : 'failed')
    mainWindow?.webContents.send('session:exit', { id, exitCode })
    // The session is going away — tear down the shell PTY too so we don't
    // leak it.
    try {
      shellTerm.kill()
    } catch {
      // already dead
    }
    sessions.delete(id)
    statusEmitted.delete(id)
    persistSessions()
  })

  // Shell PTY data/exit live on a parallel IPC channel. We deliberately do
  // NOT mirror into outputBuffer (that's the MCP read_output surface for
  // the primary) and we do NOT destroy the session when the shell exits —
  // the user can close the primary to tear the whole session down.
  shellTerm.onData((data) => {
    mainWindow?.webContents.send('session:shell:data', { id, data })
  })

  shellTerm.onExit(({ exitCode }) => {
    console.log(
      `[termhub] session ${id.slice(0, 8)} shell exited (code=${exitCode})`,
    )
    mainWindow?.webContents.send('session:shell:exit', { id, exitCode })
  })

  if (opts.command && opts.command.trim().length > 0) {
    let finalCommand: string
    if (isClaudeCommand(opts.command)) {
      finalCommand = buildClaudeCommand({
        sessionId: id,
        mcpConfigPath,
        agent: opts.source !== 'resume' ? opts.agent : undefined,
        model: opts.model,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
        allowDangerouslySkipPermissions: opts.allowDangerouslySkipPermissions,
        permissionMode: opts.permissionMode,
        resume: opts.source === 'resume',
      })
    } else {
      finalCommand = opts.command
    }
    setTimeout(() => {
      if (sessions.has(id)) term.write(`${finalCommand}\r`)
    }, 150)
  }

  // Send the prompt to claude's TUI as a bracketed paste, after it's had
  // time to start. This avoids cmd.exe's quoting limits for prompts with
  // embedded quotes, backticks, $(), <>, etc.
  if (opts.source !== 'resume' && opts.prompt && opts.prompt.length > 0) {
    const text = opts.prompt
    setTimeout(() => {
      if (sessions.has(id)) {
        writeBracketedPasteAndSubmit(session.term, text)
      }
    }, 2500)
  }

  if (opts.source !== 'ipc') {
    const autoActivate = opts.source === 'startup' || opts.source === 'resume'
    mainWindow?.webContents.send('session:added', {
      id,
      cwd: opts.cwd,
      command: opts.command,
      name: opts.name,
      repoRoot: repoInfo?.repoRoot,
      repoLabel: repoInfo?.repoLabel,
      autoActivate,
    })
  }

  return { id, cwd: opts.cwd }
}

function createWindow() {
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
  })
}

function killAllSessions() {
  for (const s of sessions.values()) {
    try {
      s.term.kill()
    } catch {
      // already dead
    }
    try {
      s.shellTerm.kill()
    } catch {
      // already dead
    }
  }
  sessions.clear()
  statusEmitted.clear()
}

// Renderer signals readiness via 'app:ready' once it has subscribed to
// session:data / session:added / session:exit. We defer creating the
// startup + resume sessions until after that, otherwise early pty output
// would be sent before any listener exists.
let rendererReadyResolve: (() => void) | null = null
const rendererReady = new Promise<void>((resolve) => {
  rendererReadyResolve = resolve
})

function bootstrapSessions(config: Config) {
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
      console.error(`[termhub] failed to resume session ${s.id.slice(0, 8)}:`, err)
    }
  }

  for (const entry of config.startupSessions) {
    if (occupiedCwds.has(entry.cwd)) {
      console.log(`[termhub] skipping startup entry ${entry.cwd} (resumed from persistence)`)
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
  mcpConfigPath = writeMcpConfigFile(config.mcpPort)

  try {
    mcpHandle = await startMcpServer({
      port: config.mcpPort,
      hooks: {
        openClaudeSession: ({
          cwd,
          prompt,
          agent,
          model,
          dangerouslySkipPermissions,
          allowDangerouslySkipPermissions,
          permissionMode,
          name,
        }) =>
          createSessionInternal({
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
          }),
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
          if (typeof maxChars === 'number' && maxChars > 0 && text.length > maxChars) {
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

  // Renderer-spawned sessions are plain shells rooted at the picked folder.
  // Claude sessions are launched via startup config, restored on resume, or
  // opened via the MCP `open_session` tool — never from the renderer.
  ipcMain.handle(
    'session:create',
    (_event, opts: { cwd: string }) =>
      createSessionInternal({ cwd: opts.cwd, source: 'ipc' }),
  )

  ipcMain.on('session:input', (_event, payload: { id: string; data: string }) => {
    sessions.get(payload.id)?.term.write(payload.data)
  })

  ipcMain.on(
    'session:resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const s = sessions.get(payload.id)
      if (!s) return
      resizePty(s.term, payload.cols, payload.rows)
    },
  )

  ipcMain.on('session:close', (_event, payload: { id: string }) => {
    const s = sessions.get(payload.id)
    if (!s) return
    if (s.jsonlWatcher) {
      s.jsonlWatcher.stop()
      s.jsonlWatcher = null
    }
    try {
      s.term.kill()
    } catch {
      // already dead
    }
    try {
      s.shellTerm.kill()
    } catch {
      // already dead
    }
    sessions.delete(payload.id)
    statusEmitted.delete(payload.id)
    persistSessions()
  })

  ipcMain.on(
    'session:shell:input',
    (_event, payload: { id: string; data: string }) => {
      sessions.get(payload.id)?.shellTerm.write(payload.data)
    },
  )

  ipcMain.on(
    'session:shell:resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const s = sessions.get(payload.id)
      if (!s) return
      resizePty(s.shellTerm, payload.cols, payload.rows)
    },
  )

  ipcMain.handle('sessions:list', () =>
    Array.from(sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      command: s.command,
      name: s.name,
      repoRoot: s.repoRoot,
      repoLabel: s.repoLabel,
    })),
  )

  ipcMain.handle('session:rename', (_event, payload: { id: string; name: string }) => {
    const s = sessions.get(payload.id)
    if (!s) throw new Error(`Session not found: ${payload.id}`)
    s.name = payload.name.trim() || undefined
    persistSessions()
  })

  ipcMain.handle('agents:list', () => listAgents())

  ipcMain.handle('agents:open', async (_event, filePath: string) => {
    // Only open files inside our agents dir, no traversal.
    const resolved = path.resolve(filePath)
    const agentsDir = path.resolve(getAgentsDir())
    if (!resolved.startsWith(agentsDir + path.sep) && resolved !== agentsDir) {
      throw new Error('Refusing to open path outside agents dir')
    }
    const err = await shell.openPath(resolved)
    if (err) throw new Error(err)
  })

  ipcMain.handle('skills:list', () => listSkills())

  ipcMain.handle('skills:open', async (_event, filePath: string) => {
    const resolved = path.resolve(filePath)
    const skillsDir = path.resolve(getSkillsDir())
    if (!resolved.startsWith(skillsDir + path.sep) && resolved !== skillsDir) {
      throw new Error('Refusing to open path outside skills dir')
    }
    const err = await shell.openPath(resolved)
    if (err) throw new Error(err)
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

  ipcMain.handle('config:get', () => config)

  ipcMain.handle('config:path', () => getConfigPath())

  ipcMain.handle('clipboard:read', () => clipboard.readText())

  ipcMain.on('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.on('open-external', (_event, url: string) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url)
    } else {
      try {
        console.warn('[termhub:links] rejected openExternal with disallowed scheme:', new URL(url).protocol)
      } catch {
        console.warn('[termhub:links] rejected openExternal with malformed URL:', url)
      }
    }
  })

  // Window controls — invoked from the custom title bar.
  ipcMain.on('window:minimize', () => { mainWindow?.minimize() })
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => { mainWindow?.close() })
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

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
