import { contextBridge, ipcRenderer } from 'electron'

type DataPayload = { id: string; data: string }
type ExitPayload = { id: string; exitCode: number }
type SessionStatus = 'working' | 'awaiting' | 'idle' | 'failed'
type StatusPayload = { id: string; status: SessionStatus }
type AddedPayload = {
  id: string
  cwd: string
  autoActivate?: boolean
  command?: string
  name?: string
}
type AgentDef = { name: string; path: string; description?: string }

const api = {
  createSession: (
    cwd: string,
    command?: string,
    prompt?: string,
  ): Promise<{ id: string; cwd: string }> =>
    ipcRenderer.invoke('session:create', { cwd, command, prompt }),

  sendInput: (id: string, data: string): void => {
    ipcRenderer.send('session:input', { id, data })
  },

  resize: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('session:resize', { id, cols, rows })
  },

  close: (id: string): void => {
    ipcRenderer.send('session:close', { id })
  },

  sendShellInput: (id: string, data: string): void => {
    ipcRenderer.send('session:shell:input', { id, data })
  },

  resizeShell: (id: string, cols: number, rows: number): void => {
    ipcRenderer.send('session:shell:resize', { id, cols, rows })
  },

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),

  home: (): Promise<string> => ipcRenderer.invoke('app:home'),

  getConfig: (): Promise<{ startupSessions: Array<{ cwd: string }> }> =>
    ipcRenderer.invoke('config:get'),

  configPath: (): Promise<string> => ipcRenderer.invoke('config:path'),

  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

  writeClipboard: (text: string): void => {
    ipcRenderer.send('clipboard:write', text)
  },

  onData: (cb: (id: string, data: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: DataPayload) => cb(p.id, p.data)
    ipcRenderer.on('session:data', handler)
    return () => {
      ipcRenderer.off('session:data', handler)
    }
  },

  onExit: (cb: (id: string, exitCode: number) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: ExitPayload) =>
      cb(p.id, p.exitCode)
    ipcRenderer.on('session:exit', handler)
    return () => {
      ipcRenderer.off('session:exit', handler)
    }
  },

  onStatusChanged: (
    cb: (id: string, status: SessionStatus) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: StatusPayload) =>
      cb(p.id, p.status)
    ipcRenderer.on('session:status', handler)
    return () => {
      ipcRenderer.off('session:status', handler)
    }
  },

  onShellData: (cb: (id: string, data: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: DataPayload) =>
      cb(p.id, p.data)
    ipcRenderer.on('session:shell:data', handler)
    return () => {
      ipcRenderer.off('session:shell:data', handler)
    }
  },

  onShellExit: (cb: (id: string, exitCode: number) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: ExitPayload) =>
      cb(p.id, p.exitCode)
    ipcRenderer.on('session:shell:exit', handler)
    return () => {
      ipcRenderer.off('session:shell:exit', handler)
    }
  },

  onSessionAdded: (
    cb: (
      id: string,
      cwd: string,
      autoActivate: boolean,
      command?: string,
      name?: string,
    ) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: AddedPayload) =>
      cb(p.id, p.cwd, p.autoActivate ?? false, p.command, p.name)
    ipcRenderer.on('session:added', handler)
    return () => {
      ipcRenderer.off('session:added', handler)
    }
  },

  listSessions: (): Promise<
    Array<{ id: string; cwd: string; command?: string; name?: string }>
  > => ipcRenderer.invoke('sessions:list'),

  appReady: (): void => {
    ipcRenderer.send('app:ready')
  },

  listAgents: (): Promise<AgentDef[]> => ipcRenderer.invoke('agents:list'),

  openAgent: (path: string): Promise<void> =>
    ipcRenderer.invoke('agents:open', path),

  listSkills: (): Promise<AgentDef[]> => ipcRenderer.invoke('skills:list'),

  openSkill: (path: string): Promise<void> =>
    ipcRenderer.invoke('skills:open', path),

  renameSession: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke('session:rename', { id, name }),
}

contextBridge.exposeInMainWorld('termhub', api)

export type TermhubApi = typeof api
