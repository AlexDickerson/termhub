export type Session = {
  id: string
  cwd: string
  command?: string
  name?: string
  repoRoot?: string
  repoLabel?: string
  cli?: 'claude' | 'codex' | 'gemini'
}

export type ShellInfo = {
  id: string
  label: string
  command: string
  args: string[]
}

// Advisory, UI-only session status sourced from Claude Code's own JSONL file.
// 'working'  — Claude is actively generating / running tools (JSONL: 'busy')
// 'awaiting' — Claude has paused to ask the user something (JSONL: 'waiting')
// 'idle'     — at the empty input prompt, ready for the next message (JSONL: 'idle')
// 'failed'   — the underlying process died with a non-zero exit code (PTY exit)
export type SessionStatus = 'working' | 'awaiting' | 'idle' | 'failed'

export type AgentDef = {
  name: string
  path: string
  description?: string
}

export type SkillDef = {
  name: string
  path: string
  description?: string
}

export type StartupSession = {
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
}

// What the renderer can ask for when spawning a session. Mirrors the fields
// the MCP `open_session` tool accepts, so the new-session dialog and the
// orchestrator have the same reach. Omit `cli` for a plain shell.
export type NewSessionOptions = {
  cwd: string
  cli?: 'claude' | 'codex' | 'gemini'
  model?: string
  agent?: string
  permissionMode?: string
  prompt?: string
  name?: string
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
}

// Permission modes accepted by `claude --permission-mode`. Kept here so the
// dialog and any future validation share one list.
export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
] as const

// A git repo discovered under the anchored repos directory. `path` matches
// Session.repoRoot so the sidebar can merge live sessions into their project.
export type ProjectDef = {
  path: string
  label: string
}

export type Config = {
  mcpPort: number
  // Anchor directory scanned for projects to list in the sidebar. Unset means
  // the user hasn't chosen one yet and the sidebar shows only live sessions.
  reposDir?: string
  startupSessions: StartupSession[]
  bottomTerminal?: {
    shellId?: string
  }
}

export type SessionPr = {
  number: number
  title: string
  state: 'open' | 'merged' | 'closed'
  url: string
  ciState: 'pending' | 'success' | 'failure' | null
}

export type SessionUsage = {
  contextWindow: { used: number; max: number; percent: number }
  cumulative: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreateTokens: number
  }
  cacheHitRate: number
  webFetches: number
  webSearches: number
  turns: number
  model: string | null
  jsonlPath: string
}

export type TermhubApi = {
  createSession: (opts: NewSessionOptions) => Promise<{ id: string; cwd: string }>
  sendInput: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  close: (id: string) => void
  // Parallel channel for the per-session docked bottom shell terminal.
  // Distinct from the primary (claude) PTY; these target the user's
  // interactive shell rooted in the session's cwd.
  sendShellInput: (id: string, data: string) => void
  resizeShell: (id: string, cols: number, rows: number) => void
  listShells: () => Promise<{ shells: ShellInfo[]; activeShellId: string }>
  setBottomShell: (shellId: string) => Promise<void>
  onShellRespawn: (cb: (sessionId: string) => void) => () => void
  pickFolder: () => Promise<string | null>
  home: () => Promise<string>
  getConfig: () => Promise<Config>
  configPath: () => Promise<string>
  openConfigFile: () => Promise<void>
  listProjects: () => Promise<ProjectDef[]>
  getReposDir: () => Promise<string | null>
  // Opens the folder picker and persists the choice; returns the new anchor,
  // or null if the user cancelled.
  setReposDir: () => Promise<string | null>
  readClipboard: () => Promise<string>
  writeClipboard: (text: string) => void
  onData: (cb: (id: string, data: string) => void) => () => void
  onExit: (cb: (id: string, exitCode: number) => void) => () => void
  onStatusChanged: (
    cb: (id: string, status: SessionStatus) => void,
  ) => () => void
  // Main-initiated request to select a session (OS notification click).
  onFocusRequest: (cb: (id: string) => void) => () => void
  onShellData: (cb: (id: string, data: string) => void) => () => void
  onShellExit: (cb: (id: string, exitCode: number) => void) => () => void
  onSessionAdded: (
    cb: (
      id: string,
      cwd: string,
      autoActivate: boolean,
      command?: string,
      name?: string,
      repoRoot?: string,
      repoLabel?: string,
      cli?: 'claude' | 'codex' | 'gemini',
    ) => void,
  ) => () => void
  listSessions: () => Promise<
    Array<{ id: string; cwd: string; command?: string; name?: string; repoRoot?: string; repoLabel?: string; cli?: 'claude' | 'codex' | 'gemini' }>
  >
  appReady: () => void
  listAgents: () => Promise<AgentDef[]>
  openAgent: (path: string) => Promise<void>
  listSkills: () => Promise<SkillDef[]>
  openSkill: (path: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  openInVSCode: (cwd: string) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  openExternal: (url: string) => void
  getSessionPr: (sessionId: string) => Promise<SessionPr | null>
  mergeSessionPr: (sessionId: string, prNumber: number) => Promise<void>
  onSessionPrChanged: (
    cb: (sessionId: string, pr: SessionPr | null) => void,
  ) => () => void
  getSessionUsage: (sessionId: string) => Promise<SessionUsage | null>
  onSessionUsageChanged: (
    cb: (sessionId: string, usage: SessionUsage) => void,
  ) => () => void
}

declare global {
  interface Window {
    termhub: TermhubApi
  }
}
