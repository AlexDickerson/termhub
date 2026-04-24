export type Session = {
  id: string
  cwd: string
}

export type Config = {
  mcpPort: number
  startupSessions: Array<{ cwd: string; command?: string; prompt?: string }>
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
  pickFolder: () => Promise<string | null>
  home: () => Promise<string>
  getConfig: () => Promise<Config>
  configPath: () => Promise<string>
  readClipboard: () => Promise<string>
  writeClipboard: (text: string) => void
  onData: (cb: (id: string, data: string) => void) => () => void
  onExit: (cb: (id: string, exitCode: number) => void) => () => void
  onSessionAdded: (
    cb: (id: string, cwd: string, autoActivate: boolean) => void,
  ) => () => void
  listSessions: () => Promise<Array<{ id: string; cwd: string }>>
  appReady: () => void
}

declare global {
  interface Window {
    termhub: TermhubApi
  }
}
