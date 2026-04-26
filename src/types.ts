export type Session = {
  id: string
  cwd: string
  command?: string
  name?: string
  repoRoot?: string
  repoLabel?: string
  cli?: 'claude' | 'codex' | 'gemini'
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

export type Config = {
  mcpPort: number
  startupSessions: StartupSession[]
  paste: {
    secretFilterEnabled: boolean
  }
}

export type SecretFinding = {
  ruleId: string
  message: string
  matchedText: string
}

export type SessionPr = {
  number: number
  title: string
  state: 'open' | 'merged' | 'closed'
  url: string
  ciState: 'pending' | 'success' | 'failure' | null
}

export type TermhubApi = {
  scanClipboardForSecrets: (text: string) => Promise<SecretFinding[]>
  setPasteSecretFilter: (enabled: boolean) => Promise<void>
  createSession: (cwd: string) => Promise<{ id: string; cwd: string }>
  sendInput: (id: string, data: string) => void
  resize: (id: string, cols: number, rows: number) => void
  close: (id: string) => void
  // Parallel channel for the per-session docked bottom shell terminal.
  // Distinct from the primary (claude) PTY; these target the user's
  // interactive shell rooted in the session's cwd.
  sendShellInput: (id: string, data: string) => void
  resizeShell: (id: string, cols: number, rows: number) => void
  pickFolder: () => Promise<string | null>
  home: () => Promise<string>
  getConfig: () => Promise<Config>
  configPath: () => Promise<string>
  readClipboard: () => Promise<string>
  writeClipboard: (text: string) => void
  onData: (cb: (id: string, data: string) => void) => () => void
  onExit: (cb: (id: string, exitCode: number) => void) => () => void
  onStatusChanged: (
    cb: (id: string, status: SessionStatus) => void,
  ) => () => void
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
}

declare global {
  interface Window {
    termhub: TermhubApi
  }
}
