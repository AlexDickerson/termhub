import { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } from 'electron'
import * as pty from '@lydell/node-pty'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { startMcpServer, type McpHandle } from './mcp'
import { isAllowedExternalUrl } from './links'

// Advisory status derived from the session's output stream. Mirrors the
// SessionStatus union exposed to the renderer in src/types.ts.
type SessionStatus = 'working' | 'awaiting' | 'idle' | 'failed'

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
  // ms timestamp of the last chunk that contained an "active spinner"
  // marker (e.g. "esc to interrupt"). Used to keep the working status
  // sticky for a short window after the marker last appeared so we don't
  // flap to idle between spinner ticks.
  lastSpinnerSeen: number
  statusReevalTimer: NodeJS.Timeout | null
  // Secondary "shell" PTY — a plain interactive shell rooted at `cwd`,
  // docked at the bottom of the UI for the user's own manual work. Not
  // exposed via MCP, not persisted. Lifetime is bound to the session.
  shellTerm: pty.IPty
}

const MAX_OUTPUT_BUFFER_BYTES = 256 * 1024

function appendToBuffer(buf: string, chunk: string): string {
  const combined = buf + chunk
  if (combined.length <= MAX_OUTPUT_BUFFER_BYTES) return combined
  return combined.slice(combined.length - MAX_OUTPUT_BUFFER_BYTES)
}

// Lossy but adequate ANSI/control-char stripper for read_output. Captures
// CSI/OSC/DCS sequences and stray control bytes; doesn't replay cursor
// movement, so heavy TUI output (e.g. claude's input box) won't reconstruct
// perfectly — but plain text and message bodies come through cleanly.
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b[=>()*+\-.\/]./g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------
// Pragmatic heuristics over the output stream — advisory UI decoration only,
// not load-bearing logic. Cheap to evaluate; correct ≥ 90% of the time.
//
//   working  — claude is generating / running tools. Detected by the
//              "esc to interrupt" hint that claude prints under the spinner
//              on every redraw tick. Sticky for ~1.5s after the last hit so
//              we don't flap between spinner ticks.
//   awaiting — claude has stopped and is asking something. Detected by a
//              permission-prompt phrase ("Do you want") or a numbered choice
//              with the focused-arrow marker ("❯ 1.") in the buffer tail.
//   idle     — none of the above. Empty input box / waiting for user.
//   failed   — set on non-zero PTY exit, never derived from output.
const SPINNER_RE = /esc to interrupt/i
const PERMISSION_RE = /Do you want/i
const NUMBERED_CHOICE_RE = /❯\s*\d+\.\s/
// How long to keep status='working' after the last spinner hit. Slightly
// longer than claude's spinner tick (~80ms) plus a buffer for sparse
// redraws. 1500ms is comfortably above worst-case observed spacing.
const SPINNER_HOLD_MS = 1500
// Tail size to scan for awaiting prompts. Big enough to capture a
// multi-line permission prompt (the question + a few numbered options),
// small enough to keep regex work cheap on every chunk.
const STATUS_TAIL_BYTES = 6000

function detectStatusFromBuffer(
  buffer: string,
  lastSpinnerSeen: number,
): SessionStatus {
  if (Date.now() - lastSpinnerSeen < SPINNER_HOLD_MS) return 'working'
  const tail =
    buffer.length > STATUS_TAIL_BYTES
      ? buffer.slice(buffer.length - STATUS_TAIL_BYTES)
      : buffer
  const stripped = stripAnsi(tail)
  if (PERMISSION_RE.test(stripped) || NUMBERED_CHOICE_RE.test(stripped)) {
    return 'awaiting'
  }
  return 'idle'
}

function setStatus(session: Session, next: SessionStatus) {
  if (session.status === next) return
  session.status = next
  mainWindow?.webContents.send('session:status', { id: session.id, status: next })
}

function recomputeStatus(session: Session) {
  // Once 'failed' is set (PTY exited non-zero) we lock the status — the
  // session is a corpse, no further detection is meaningful.
  if (session.status === 'failed') return
  const next = detectStatusFromBuffer(session.outputBuffer, session.lastSpinnerSeen)
  setStatus(session, next)
  if (session.statusReevalTimer) {
    clearTimeout(session.statusReevalTimer)
    session.statusReevalTimer = null
  }
  // While we believe claude is working, schedule a follow-up recompute so
  // we transition off 'working' even if no further data arrives (e.g. the
  // spinner is cleared by a final redraw and then output goes quiet).
  if (next === 'working') {
    session.statusReevalTimer = setTimeout(() => {
      session.statusReevalTimer = null
      recomputeStatus(session)
    }, SPINNER_HOLD_MS + 100)
  }
}

// Walk upward from cwd looking for a .git entry (file or directory).
// If found as a file (worktree), parse the `gitdir:` line to resolve the
// main checkout root (two dirname()s up from the worktree-specific gitdir).
// Returns { repoRoot, repoLabel } or null when no repo is found.
function detectRepoRoot(cwd: string): { repoRoot: string; repoLabel: string } | null {
  let current = path.resolve(cwd)
  while (true) {
    const gitEntry = path.join(current, '.git')
    let stat: fs.Stats | null = null
    try {
      stat = fs.statSync(gitEntry)
    } catch {
      // not found at this level — keep walking
    }
    if (stat !== null) {
      if (stat.isDirectory()) {
        // Normal checkout: .git directory means this directory IS the repo root
        return { repoRoot: current, repoLabel: path.basename(current) }
      }
      if (stat.isFile()) {
        // Git worktree: .git file contains "gitdir: <path>"
        try {
          const contents = fs.readFileSync(gitEntry, 'utf8')
          const m = /^gitdir:\s*(.+)$/m.exec(contents)
          if (m) {
            // Typically: <main-checkout>/.git/worktrees/<name>
            // Two dirname()s up: strip /<name> then /worktrees → <main-checkout>/.git
            // One more dirname(): the main checkout root
            const worktreeGitDir = path.resolve(current, m[1].trim())
            const mainGit = path.dirname(path.dirname(worktreeGitDir))
            const mainCheckout = path.dirname(mainGit)
            return { repoRoot: mainCheckout, repoLabel: path.basename(mainCheckout) }
          }
        } catch {
          // unreadable .git file — treat as no-repo
        }
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      // Reached filesystem root — no repo found
      return null
    }
    current = parent
  }
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

type StartupSession = {
  cwd: string
  command?: string
  prompt?: string
  agent?: string
  model?: string
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  permissionMode?: string
  name?: string
}

type Config = {
  mcpPort: number
  startupSessions: StartupSession[]
}

type PersistedSession = {
  id: string
  cwd: string
  command?: string
  name?: string
  model?: string
  permissionMode?: string
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
}

const DEFAULT_CONFIG: Config = {
  mcpPort: 7787,
  // bypassPermissions skips per-tool approval prompts AND avoids the
  // sandbox preflight that "auto" mode triggers — without an override the
  // orchestrator session refuses to start when ~/.claude/settings.json
  // sets permissions.defaultMode to "auto" but no sandbox runtime is
  // available on the host.
  startupSessions: [
    {
      cwd: 'E:/',
      command: 'claude',
      agent: 'orchestrator',
      permissionMode: 'bypassPermissions',
      name: 'orchestrator',
    },
  ],
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
        (s.command === undefined || typeof s.command === 'string') &&
        (s.name === undefined || typeof s.name === 'string') &&
        (s.model === undefined || typeof s.model === 'string') &&
        (s.permissionMode === undefined || typeof s.permissionMode === 'string') &&
        (s.dangerouslySkipPermissions === undefined ||
          typeof s.dangerouslySkipPermissions === 'boolean') &&
        (s.allowDangerouslySkipPermissions === undefined ||
          typeof s.allowDangerouslySkipPermissions === 'boolean'),
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

function getSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills')
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

type SkillDef = { name: string; path: string; description?: string }

function listSkills(): SkillDef[] {
  const dir = getSkillsDir()
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    console.error('[termhub] failed to list skills:', err)
    return []
  }
  const out: SkillDef[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(dir, entry.name, 'SKILL.md')
    let stat
    try {
      stat = fs.statSync(skillMdPath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    const description = parseAgentDescription(skillMdPath)
    out.push({ name: entry.name, path: skillMdPath, description })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

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

function isClaudeCommand(cmd: string): boolean {
  return /^claude(\s|$)/.test(cmd.trim())
}

// Default permission mode applied to every spawned claude when the caller
// (config.json, MCP open_session, etc.) doesn't specify one. bypassPermissions
// avoids the sandbox preflight that fires when claude's own
// permissions.defaultMode is "auto" or when OPERON_SANDBOXED_NETWORK leaks
// into the env. Override per-session via the permissionMode field if you
// want stricter behavior.
const DEFAULT_PERMISSION_MODE = 'bypassPermissions'

// Pure helper — builds the flag list for a `claude` invocation. Exported for
// unit testing; contains no side effects.
export function buildClaudeArgs(opts: {
  sessionId: string
  mcpConfigPath: string
  agent?: string
  model?: string
  resume?: boolean
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  permissionMode?: string
}): string[] {
  const permissionMode =
    opts.permissionMode && opts.permissionMode.length > 0
      ? opts.permissionMode
      : DEFAULT_PERMISSION_MODE

  const flags: string[] = [`--mcp-config "${opts.mcpConfigPath}"`]

  if (opts.resume) {
    flags.push(`--resume "${opts.sessionId}"`)
    if (opts.model && opts.model.length > 0) {
      flags.push(`--model "${opts.model}"`)
    }
  } else {
    flags.push(`--session-id "${opts.sessionId}"`)
    if (opts.agent && opts.agent.length > 0) {
      flags.push(`--agent "${opts.agent}"`)
    }
    if (opts.model && opts.model.length > 0) {
      flags.push(`--model "${opts.model}"`)
    }
  }

  if (opts.dangerouslySkipPermissions) {
    if (opts.allowDangerouslySkipPermissions) {
      console.warn(
        '[termhub:session] both dangerouslySkipPermissions and allowDangerouslySkipPermissions set' +
          ' — dangerouslySkipPermissions takes precedence; ignoring allowDangerouslySkipPermissions',
      )
    }
    flags.push('--dangerously-skip-permissions')
  } else if (opts.allowDangerouslySkipPermissions) {
    flags.push('--allow-dangerously-skip-permissions')
  }

  flags.push(`--permission-mode "${permissionMode}"`)
  return flags
}

function buildClaudeCommand(opts: {
  sessionId: string
  agent?: string
  model?: string
  resume?: boolean
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  permissionMode?: string
}): string {
  const flags = buildClaudeArgs({ ...opts, mcpConfigPath })
  return `claude ${flags.join(' ')}`
}

// Wrap text in bracketed-paste markers + Enter. Claude's TUI (Ink) handles
// bracketed paste atomically, so arbitrarily long / shell-special content
// can be injected without cmd.exe seeing or trying to parse it.
function bracketedPasteWithSubmit(text: string): string {
  return `\x1b[200~${text}\x1b[201~\r`
}

// CLAUDE_* / CLAUDECODE / OPERON_* vars from a parent claude session leak
// into spawned child claudes and confuse them. In particular,
// OPERON_SANDBOXED_NETWORK=1 (set by claude desktop's sandbox runtime)
// makes the spawned claude assert that a sandbox is required even when
// settings.json has sandbox.failIfUnavailable: false. Strip these so the
// child boots from a clean baseline.
const PARENT_CLAUDE_ENV_PREFIXES = ['CLAUDE_', 'CLAUDECODE', 'OPERON_']
const PARENT_CLAUDE_ENV_EXACT = new Set(['DEFAULT_LLM_MODEL'])

function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue
    if (PARENT_CLAUDE_ENV_EXACT.has(k)) continue
    if (PARENT_CLAUDE_ENV_PREFIXES.some((p) => k.startsWith(p))) continue
    out[k] = v
  }
  return out
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
    status: 'idle',
    lastSpinnerSeen: 0,
    statusReevalTimer: null,
    shellTerm,
  }
  sessions.set(id, session)
  persistSessions()

  let firstData = true
  term.onData((data) => {
    if (firstData) {
      firstData = false
      console.log(`[termhub] first data from ${id.slice(0, 8)} (${data.length} bytes)`)
    }
    session.outputBuffer = appendToBuffer(session.outputBuffer, data)
    // Cheap test on the raw chunk — the spinner phrase is plain ASCII and
    // isn't broken up by ANSI codes mid-substring, so we don't need to
    // strip first.
    if (SPINNER_RE.test(data)) session.lastSpinnerSeen = Date.now()
    recomputeStatus(session)
    mainWindow?.webContents.send('session:data', { id, data })
  })

  term.onExit(({ exitCode }) => {
    console.log(`[termhub] session ${id.slice(0, 8)} exited (code=${exitCode})`)
    if (session.statusReevalTimer) {
      clearTimeout(session.statusReevalTimer)
      session.statusReevalTimer = null
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
        session.term.write(bracketedPasteWithSubmit(text))
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
            result.session.term.write(bracketedPasteWithSubmit(text))
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
    try {
      s.shellTerm.kill()
    } catch {
      // already dead
    }
    sessions.delete(payload.id)
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
      if (!Number.isFinite(payload.cols) || !Number.isFinite(payload.rows)) return
      const cols = Math.max(1, Math.floor(payload.cols))
      const rows = Math.max(1, Math.floor(payload.rows))
      try {
        s.shellTerm.resize(cols, rows)
      } catch {
        // pty may have exited between resize requests
      }
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
