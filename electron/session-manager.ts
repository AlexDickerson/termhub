// Session lifecycle owner. Holds the live PTY map, the renderer-status
// emission tracker, and the createSession / killAll / find / persist
// operations. The mainWindow ref is injected at startup via setMainWindow
// so this module can broadcast session events back to the renderer
// without depending on main.ts.

import { BrowserWindow } from 'electron'
import * as pty from '@lydell/node-pty'
import { randomUUID } from 'node:crypto'
import { watchSessionStatus, type WatcherHandle } from './status-watcher'
import type { SessionStatus } from '../src/types'
import { appendToBuffer } from './output-buffer'
import { detectRepoRoot } from './repo-root'
import {
  buildClaudeCommand,
  cleanEnv,
  isClaudeCommand,
  writeBracketedPasteAndSubmit,
} from './claude-command'
import { buildCodexCommand } from './codex-command'
import { buildGeminiCommand } from './gemini-command'
import { writePersistedSessions, type PersistedSession } from './persistence'
import { getMcpConfigPath } from './config'

export type Session = {
  id: string
  cwd: string
  command?: string
  name?: string
  repoRoot?: string
  repoLabel?: string
  cli?: 'claude' | 'codex' | 'gemini'
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

export type FindSessionResult =
  | { found: true; session: Session }
  | { found: false; error: string }

const sessions = new Map<string, Session>()

// Configured bottom-shell. Updated at startup from saved config and on picker change.
// null means use OS default (process.env.COMSPEC on Windows, process.env.SHELL on Unix).
let configuredBottomShell: { command: string; args: string[] } | null = null

export function setBottomShell(shell: { command: string; args: string[] }): void {
  configuredBottomShell = shell
}

function getBottomShell(): { command: string; args: string[] } {
  if (configuredBottomShell) return configuredBottomShell
  return { command: process.env.COMSPEC ?? 'cmd.exe', args: [] }
}

// Session ids whose current shell PTY was killed for a respawn. When the
// killed PTY's onExit fires we skip the IPC event so the renderer's
// onShellExit handler doesn't dispose the xterm that was just created for
// the new shell.
const pendingRespawnExits = new Set<string>()

// Tracks which session ids have had at least one 'session:status' event
// sent to the renderer. Without this, sessions whose first observed
// status equals the initial 'working' default would never emit (the
// equality check in setStatus would suppress the no-op transition), and
// the renderer would default the dot to 'idle' (green) for active
// sessions stuck busy. Cleared in killAllSessions and on session removal.
const statusEmitted = new Set<string>()

let mainWindow: BrowserWindow | null = null

// Wire main.ts's BrowserWindow into this module after createWindow runs.
// Pass null on tear-down so we don't keep a stale ref.
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

// Lifecycle callbacks registered by other modules (e.g. ipc-pr) to react
// to session creation and closure without creating circular imports.
const sessionCreatedCallbacks: Array<(id: string) => void> = []
const sessionClosedCallbacks: Array<(id: string) => void> = []

export function onSessionCreatedHook(cb: (id: string) => void): void {
  sessionCreatedCallbacks.push(cb)
}

export function onSessionClosedHook(cb: (id: string) => void): void {
  sessionClosedCallbacks.push(cb)
}

// Pure decision: should this transition produce a 'session:status' IPC
// emission? Forces the very first emission per session id so the
// renderer has a seeded value, then suppresses no-op (equal) transitions.
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

function setStatus(session: Session, next: SessionStatus): void {
  if (!shouldEmitStatus(statusEmitted, session.id, session.status, next)) return
  session.status = next
  statusEmitted.add(session.id)
  mainWindow?.webContents.send('session:status', {
    id: session.id,
    status: next,
  })
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values())
}

export function findSessionByIdOrPrefix(idOrPrefix: string): FindSessionResult {
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

// Snapshot the live sessions Map into the persistence wire format and
// hand off to writePersistedSessions. Called whenever session state
// changes (create / close / rename / exit).
export function persistSessions(): void {
  const list: PersistedSession[] = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    command: s.command,
    name: s.name,
    model: s.model,
    permissionMode: s.permissionMode,
    dangerouslySkipPermissions: s.dangerouslySkipPermissions,
    allowDangerouslySkipPermissions: s.allowDangerouslySkipPermissions,
    cli: s.cli,
  }))
  writePersistedSessions(list)
}

// Drop a session from the map. Called by the close IPC handler;
// term.onExit handles its own cleanup so this isn't called from there.
export function deleteSession(id: string): void {
  sessions.delete(id)
  statusEmitted.delete(id)
  for (const cb of sessionClosedCallbacks) cb(id)
}

export function createSessionInternal(opts: {
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
  cli?: 'claude' | 'codex' | 'gemini'
  source: 'ipc' | 'mcp' | 'startup' | 'resume'
}): { id: string; cwd: string; promptSettled: Promise<void> } {
  const id = opts.id ?? randomUUID()
  const cli = opts.cli ?? 'claude'
  // Primary PTY always uses the OS default shell — it runs claude/codex/gemini.
  const primaryShell = process.env.COMSPEC || 'cmd.exe'
  const { command: shellCmd, args: shellArgs } = getBottomShell()
  console.log(
    `[termhub:session] spawning ${primaryShell} in ${opts.cwd} (id=${id.slice(0, 8)}, cli=${cli}, source=${opts.source})`,
  )
  let term: pty.IPty
  try {
    term = pty.spawn(primaryShell, [], {
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

  // Secondary shell PTY — user's configured shell rooted at cwd, for manual
  // work in the bottom pane. Separate from the primary so shell choice doesn't
  // affect claude/codex/gemini execution.
  let shellTerm: pty.IPty
  try {
    shellTerm = pty.spawn(shellCmd, shellArgs, {
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
    cli,
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

  // Notify lifecycle listeners (e.g. ipc-pr poll loop) that a session was created.
  for (const cb of sessionCreatedCallbacks) cb(id)

  // Seed the renderer with the initial status so the sidebar dot doesn't
  // default to 'idle' (green) while the session is actually working. The
  // first-emit force in setStatus handles cases where the first JSONL
  // reading happens to equal the initial 'working' default.
  setStatus(session, session.status)

  // Initial-prompt delivery. We need claude's TUI to be fully booted AND
  // sitting at the input prompt before we paste — otherwise the paste
  // arrives while claude is mid-load (status 'busy') and Ink's submit
  // handler hasn't been wired yet. Bracketed-paste mode does work pre-
  // submit-wiring, so the text lands in the input box, but the trailing
  // CR doesn't fire submit.
  //
  // Strategy: gate the paste on the JSONL watcher reporting status 'idle'
  // — that's the unambiguous "Ink is rendered, input prompt is showing,
  // submit handler is wired" signal. The MCP open_session caller awaits
  // `promptSettled` to serialize spawns (see openSessionQueue in main.ts).
  //
  // promptSettled resolves once delivery is complete (paste + CR
  // written), or once we know it's never going to happen (fallback fired,
  // session exited, no prompt provided).
  // Codex and Gemini receive their prompt as a positional CLI arg embedded in
  // the command string — only Claude uses bracketed-paste delivery.
  const wantsPrompt =
    opts.source !== 'resume' &&
    opts.prompt !== undefined &&
    opts.prompt.length > 0 &&
    cli === 'claude'
  let promptSent = false
  let resolvePromptSettled: () => void = () => {}
  const promptSettled: Promise<void> = wantsPrompt
    ? new Promise<void>((resolve) => {
        resolvePromptSettled = resolve
      })
    : Promise.resolve()

  const sendPromptOnce = async () => {
    if (promptSent) return
    if (!sessions.has(id) || !opts.prompt || opts.prompt.length === 0) {
      resolvePromptSettled()
      return
    }
    promptSent = true
    try {
      await writeBracketedPasteAndSubmit(session.term, opts.prompt)
    } finally {
      resolvePromptSettled()
    }
  }

  if (wantsPrompt) {
    setTimeout(() => {
      if (!promptSent) {
        console.warn(
          `[termhub:session] ${id.slice(0, 8)} JSONL idle-readiness fallback fired (15s) — sending prompt anyway`,
        )
        void sendPromptOnce()
      }
    }, 15000)
  }

  // Watch the Claude Code JSONL file for ground-truth status updates. The
  // file is created by Claude Code shortly after startup; the watcher polls
  // and will begin emitting once the file appears.
  // Codex and Gemini don't produce a Claude Code JSONL file — skip the watcher.
  if (cli === 'claude' && opts.command && isClaudeCommand(opts.command)) {
    session.jsonlWatcher = watchSessionStatus(id, (next) => {
      // Send the initial prompt the first time claude reports 'idle'
      // (parked at the input prompt, submit handler wired). 'busy' and
      // 'awaiting' would race with submit-handler setup.
      if (!promptSent && wantsPrompt && next === 'idle') {
        // Tiny grace for Ink's first paint after the status write,
        // defensive against OS-level pty write batching.
        setTimeout(() => { void sendPromptOnce() }, 250)
      }
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
    // Unblock any caller awaiting promptSettled — the session is gone, so
    // the prompt is never going to be delivered.
    resolvePromptSettled()
    // Emit the terminal status BEFORE the exit event so the renderer has
    // it set when it decides whether to keep the row visible.
    setStatus(session, exitCode === 0 ? 'idle' : 'failed')
    mainWindow?.webContents.send('session:exit', { id, exitCode })
    // The session is going away — tear down the current shell PTY (which
    // may have been respawned since creation) so we don't leak it.
    try {
      session.shellTerm.kill()
    } catch {
      // already dead
    }
    sessions.delete(id)
    statusEmitted.delete(id)
    for (const cb of sessionClosedCallbacks) cb(id)
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
    // Skip if this exit was triggered by respawnSessionShell — the renderer
    // already received 'session:shell:respawn' and the new xterm must not be
    // disposed by the stale exit event from the killed old shell.
    if (pendingRespawnExits.delete(id)) return
    console.log(
      `[termhub] session ${id.slice(0, 8)} shell exited (code=${exitCode})`,
    )
    mainWindow?.webContents.send('session:shell:exit', { id, exitCode })
  })

  if (opts.command && opts.command.trim().length > 0) {
    let finalCommand: string
    if (cli === 'codex') {
      finalCommand = buildCodexCommand({
        model: opts.model,
        dangerouslyBypassApprovals: opts.dangerouslySkipPermissions,
        // Prompt is embedded in the command for codex (positional arg).
        prompt: opts.source !== 'resume' ? opts.prompt : undefined,
      })
      console.info(
        `[termhub:session] ${id.slice(0, 8)} codex spawn — cwd=${opts.cwd}` +
          (opts.model ? ` model=${opts.model}` : '') +
          ` cmd="${finalCommand}"`,
      )
    } else if (cli === 'gemini') {
      finalCommand = buildGeminiCommand({
        model: opts.model,
        yolo: opts.dangerouslySkipPermissions,
        // Prompt is embedded in the command as a positional arg.
        prompt: opts.source !== 'resume' ? opts.prompt : undefined,
      })
      console.info(
        `[termhub:session] ${id.slice(0, 8)} gemini spawn — cwd=${opts.cwd}` +
          (opts.model ? ` model=${opts.model}` : '') +
          ` cmd="${finalCommand}"`,
      )
    } else if (isClaudeCommand(opts.command)) {
      finalCommand = buildClaudeCommand({
        sessionId: id,
        mcpConfigPath: getMcpConfigPath(),
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

  if (opts.source !== 'ipc') {
    const autoActivate = opts.source === 'startup' || opts.source === 'resume'
    mainWindow?.webContents.send('session:added', {
      id,
      cwd: opts.cwd,
      command: opts.command,
      name: opts.name,
      repoRoot: repoInfo?.repoRoot,
      repoLabel: repoInfo?.repoLabel,
      cli,
      autoActivate,
    })
  }

  return { id, cwd: opts.cwd, promptSettled }
}

// Kills the current bottom-shell PTY for a session and spawns a new one
// with the given shell. Sends 'session:shell:respawn' to the renderer
// BEFORE spawning so the renderer can reset its xterm instance while
// there is no active PTY to race against.
export function respawnSessionShell(
  id: string,
  shell: { command: string; args: string[] },
): void {
  const session = sessions.get(id)
  if (!session) return

  // Mark this exit as a respawn kill so the old PTY's onExit handler
  // skips the IPC event — the new xterm must not be torn down by it.
  pendingRespawnExits.add(id)

  // Signal the renderer to reset its xterm before new data arrives.
  mainWindow?.webContents.send('session:shell:respawn', { id })

  try {
    session.shellTerm.kill()
  } catch {
    // already dead
  }

  let newShellTerm: pty.IPty
  try {
    newShellTerm = pty.spawn(shell.command, shell.args, {
      name: 'xterm-color',
      cols: 80,
      rows: 10,
      cwd: session.cwd,
      env: cleanEnv(),
    })
  } catch (err) {
    console.error(
      `[termhub:shells] session ${id.slice(0, 8)} shell respawn failed:`,
      err,
    )
    pendingRespawnExits.delete(id)
    throw err
  }

  console.log(
    `[termhub:shells] session ${id.slice(0, 8)} shell respawned as ${shell.command} (pid=${newShellTerm.pid})`,
  )
  session.shellTerm = newShellTerm

  newShellTerm.onData((data) => {
    mainWindow?.webContents.send('session:shell:data', { id, data })
  })

  newShellTerm.onExit(({ exitCode }) => {
    if (pendingRespawnExits.delete(id)) return
    console.log(
      `[termhub] session ${id.slice(0, 8)} shell exited (code=${exitCode})`,
    )
    mainWindow?.webContents.send('session:shell:exit', { id, exitCode })
  })
}

export function respawnAllShells(shell: { command: string; args: string[] }): void {
  for (const session of sessions.values()) {
    try {
      respawnSessionShell(session.id, shell)
    } catch (err) {
      console.error(
        `[termhub:shells] failed to respawn shell for session ${session.id.slice(0, 8)}:`,
        err,
      )
    }
  }
}

export function killAllSessions(): void {
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
