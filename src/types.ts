export type Session = {
  id: string
  cwd: string
  command?: string
  name?: string
  repoRoot?: string
  repoLabel?: string
}

// Advisory, UI-only status derived from the session's output stream.
// 'working'  — Claude is actively generating / running tools (spinner visible)
// 'awaiting' — Claude has stopped and is asking the user something
//              (permission prompt or numbered choice)
// 'idle'     — at the empty input prompt, ready for the next message
// 'failed'   — the underlying process died with a non-zero exit code
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

export type Config = {
  mcpPort: number
  startupSessions: Array<{
    cwd: string
    command?: string
    prompt?: string
    agent?: string
    model?: string
    dangerouslySkipPermissions?: boolean
    permissionMode?: string
    name?: string
  }>
}

export type TermhubApi = {
  createSession: (
    cwd: string,
    command?: string,
    prompt?: string,
  ) => Promise<{ id: string; cwd: string }>
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
    ) => void,
  ) => () => void
  listSessions: () => Promise<
    Array<{ id: string; cwd: string; command?: string; name?: string; repoRoot?: string; repoLabel?: string }>
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
}

declare global {
  interface Window {
    termhub: TermhubApi
  }
}
