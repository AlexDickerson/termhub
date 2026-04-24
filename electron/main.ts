import { app, BrowserWindow, ipcMain, dialog, clipboard, shell } from 'electron'
import * as pty from '@lydell/node-pty'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { startMcpServer, type McpHandle } from './mcp'

type Session = {
  id: string
  cwd: string
  command?: string
  term: pty.IPty
}

type StartupSession = { cwd: string; command?: string; prompt?: string }

type Config = {
  mcpPort: number
  startupSessions: StartupSession[]
}

type PersistedSession = {
  id: string
  cwd: string
  command?: string
}

const DEFAULT_CONFIG: Config = {
  mcpPort: 7787,
  startupSessions: [{ cwd: 'E:/', command: 'claude' }],
}

const sessions = new Map<string, Session>()
let mainWindow: BrowserWindow | null = null
let mcpHandle: McpHandle | null = null
let mcpConfigPath = ''

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function getMcpConfigPath(): string {
  return path.join(app.getPath('userData'), 'mcp-config.json')
}

function getSessionsPath(): string {
  return path.join(app.getPath('userData'), 'sessions.json')
}

function loadPersistedSessions(): PersistedSession[] {
  try {
    const raw = fs.readFileSync(getSessionsPath(), 'utf8')
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (s): s is PersistedSession =>
        s != null &&
        typeof s.id === 'string' &&
        typeof s.cwd === 'string' &&
        (s.command === undefined || typeof s.command === 'string'),
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[termhub] failed to load persisted sessions:', err)
    }
    return []
  }
}

function getAgentsDir(): string {
  return path.join(os.homedir(), '.claude', 'agents')
}

type AgentDef = { name: string; path: string; description?: string }

function listAgents(): AgentDef[] {
  const dir = getAgentsDir()
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.error('[termhub] failed to list agents:', err)
    return []
  }
  const out: AgentDef[] = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.md')) continue
    const filePath = path.join(dir, entry)
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    const name = entry.replace(/\.md$/i, '')
    const description = parseAgentDescription(filePath)
    out.push({ name, path: filePath, description })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function parseAgentDescription(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
    if (!m) return undefined
    const desc = /^description:\s*(.+)$/im.exec(m[1])
    if (!desc) return undefined
    return desc[1].trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

function loadAgentBody(name: string): string | null {
  const filePath = path.join(getAgentsDir(), `${name}.md`)
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(content)
    return (m ? m[1] : content).trim()
  } catch (err) {
    console.error(`[termhub] failed to load agent "${name}":`, err)
    return null
  }
}

function persistSessions() {
  const list: PersistedSession[] = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    command: s.command,
  }))
  try {
    fs.mkdirSync(path.dirname(getSessionsPath()), { recursive: true })
    fs.writeFileSync(getSessionsPath(), JSON.stringify(list, null, 2))
  } catch (err) {
    console.error('[termhub] failed to persist sessions:', err)
  }
}

function loadConfig(): Config {
  const configPath = getConfigPath()
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Config>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true })
        fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
        console.log(`[termhub] wrote default config to ${configPath}`)
      } catch (writeErr) {
        console.error('[termhub] failed to write default config:', writeErr)
      }
      return DEFAULT_CONFIG
    }
    console.error('[termhub] failed to read config:', err)
    return DEFAULT_CONFIG
  }
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

function injectClaudeFlags(
  rawCommand: string,
  sessionId: string,
  opts: { resume?: boolean } = {},
): string {
  const trimmed = rawCommand.trim()
  // Match `claude` as the leading word (with or without trailing args)
  const m = /^claude(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (!m) return rawCommand
  const args = m[1]
  if (opts.resume) {
    // On resume, drop user-provided args (a positional prompt would be sent
    // again, double-posting the user's first message).
    return `claude --mcp-config "${mcpConfigPath}" --resume "${sessionId}"`
  }
  const flags = `--mcp-config "${mcpConfigPath}" --session-id "${sessionId}"`
  return args ? `claude ${flags} ${args}` : `claude ${flags}`
}

function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function createSessionInternal(opts: {
  id?: string
  cwd: string
  command?: string
  prompt?: string
  agent?: string
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

  let firstData = true
  term.onData((data) => {
    if (firstData) {
      firstData = false
      console.log(`[termhub] first data from ${id.slice(0, 8)} (${data.length} bytes)`)
    }
    mainWindow?.webContents.send('session:data', { id, data })
  })

  term.onExit(({ exitCode }) => {
    console.log(`[termhub] session ${id.slice(0, 8)} exited (code=${exitCode})`)
    mainWindow?.webContents.send('session:exit', { id, exitCode })
    sessions.delete(id)
    persistSessions()
  })

  sessions.set(id, { id, cwd: opts.cwd, command: opts.command, term })
  persistSessions()

  if (opts.command && opts.command.trim().length > 0) {
    const finalCommand = injectClaudeFlags(opts.command, id, {
      resume: opts.source === 'resume',
    })
    setTimeout(() => {
      if (sessions.has(id)) term.write(`${finalCommand}\r`)
    }, 150)
  }

  // Build the first user message: agent body (if any) + user prompt.
  let firstMessage = opts.source !== 'resume' ? opts.prompt ?? '' : ''
  if (opts.source !== 'resume' && opts.agent) {
    const body = loadAgentBody(opts.agent)
    if (body) {
      firstMessage = firstMessage
        ? `${body}\n\nUser request: ${firstMessage}`
        : body
    } else {
      console.warn(`[termhub] agent "${opts.agent}" not found in ${getAgentsDir()}`)
    }
  }
  if (firstMessage.length > 0) {
    const sanitized = firstMessage.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim()
    setTimeout(() => {
      if (sessions.has(id)) term.write(`${sanitized}\r`)
    }, 2500)
  }

  if (opts.source !== 'ipc') {
    const autoActivate = opts.source === 'startup' || opts.source === 'resume'
    mainWindow?.webContents.send('session:added', {
      id,
      cwd: opts.cwd,
      command: opts.command,
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
    backgroundColor: '#1e1e1e',
    title: 'termhub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
  }
  sessions.clear()
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
        source: 'startup',
      })
      occupiedCwds.add(entry.cwd)
    } catch (err) {
      console.error('[termhub] startup session failed for', entry.cwd, err)
    }
  }
}

app.whenReady().then(async () => {
  const config = loadConfig()
  mcpConfigPath = writeMcpConfigFile(config.mcpPort)

  try {
    mcpHandle = await startMcpServer({
      port: config.mcpPort,
      hooks: {
        openClaudeSession: ({ cwd, prompt, agent }) =>
          createSessionInternal({
            cwd,
            command: 'claude',
            prompt,
            agent,
            source: 'mcp',
          }),
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

  ipcMain.handle(
    'session:create',
    (_event, opts: { cwd: string; command?: string; prompt?: string }) =>
      createSessionInternal({
        cwd: opts.cwd,
        command: opts.command,
        prompt: opts.prompt,
        source: 'ipc',
      }),
  )

  ipcMain.on('session:input', (_event, payload: { id: string; data: string }) => {
    sessions.get(payload.id)?.term.write(payload.data)
  })

  ipcMain.on(
    'session:resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const s = sessions.get(payload.id)
      if (!s) return
      if (!Number.isFinite(payload.cols) || !Number.isFinite(payload.rows)) return
      const cols = Math.max(1, Math.floor(payload.cols))
      const rows = Math.max(1, Math.floor(payload.rows))
      try {
        s.term.resize(cols, rows)
      } catch {
        // pty may have exited between resize requests
      }
    },
  )

  ipcMain.on('session:close', (_event, payload: { id: string }) => {
    const s = sessions.get(payload.id)
    if (!s) return
    try {
      s.term.kill()
    } catch {
      // already dead
    }
    sessions.delete(payload.id)
    persistSessions()
  })

  ipcMain.handle('sessions:list', () =>
    Array.from(sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      command: s.command,
    })),
  )

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
