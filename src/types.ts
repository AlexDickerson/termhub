export type Session = {
  id: string
  cwd: string
  command?: string
  name?: string
}

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
  onShellData: (cb: (id: string, data: string) => void) => () => void
  onShellExit: (cb: (id: string, exitCode: number) => void) => () => void
  onSessionAdded: (
    cb: (
      id: string,
      cwd: string,
      autoActivate: boolean,
      command?: string,
      name?: string,
    ) => void,
  ) => () => void
  listSessions: () => Promise<
    Array<{ id: string; cwd: string; command?: string; name?: string }>
  >
  appReady: () => void
  listAgents: () => Promise<AgentDef[]>
  openAgent: (path: string) => Promise<void>
  listSkills: () => Promise<SkillDef[]>
  openSkill: (path: string) => Promise<void>
}

declare global {
  interface Window {
    termhub: TermhubApi
  }
}
