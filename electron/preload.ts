import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentDef,
  Config,
  SessionPr,
  SessionStatus,
  SessionUsage,
  SkillDef,
} from '../src/types'

type DataPayload = { id: string; data: string }
type ExitPayload = { id: string; exitCode: number }
type StatusPayload = { id: string; status: SessionStatus }
type PrPayload = { id: string; pr: SessionPr | null }
type UsagePayload = { id: string; usage: SessionUsage }
type AddedPayload = {
  id: string
  cwd: string
  autoActivate?: boolean
  command?: string
  name?: string
  repoRoot?: string
  repoLabel?: string
  cli?: 'claude' | 'codex' | 'gemini'
}

const api = {
  createSession: (cwd: string): Promise<{ id: string; cwd: string }> =>
    ipcRenderer.invoke('session:create', { cwd }),

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

  getConfig: (): Promise<Config> => ipcRenderer.invoke('config:get'),

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
      repoRoot?: string,
      repoLabel?: string,
      cli?: 'claude' | 'codex' | 'gemini',
    ) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: AddedPayload) =>
      cb(p.id, p.cwd, p.autoActivate ?? false, p.command, p.name, p.repoRoot, p.repoLabel, p.cli)
    ipcRenderer.on('session:added', handler)
    return () => {
      ipcRenderer.off('session:added', handler)
    }
  },

  listSessions: (): Promise<
    Array<{ id: string; cwd: string; command?: string; name?: string; repoRoot?: string; repoLabel?: string; cli?: 'claude' | 'codex' | 'gemini' }>
  > => ipcRenderer.invoke('sessions:list'),

  appReady: (): void => {
    ipcRenderer.send('app:ready')
  },

  listAgents: (): Promise<AgentDef[]> => ipcRenderer.invoke('agents:list'),

  openAgent: (path: string): Promise<void> =>
    ipcRenderer.invoke('agents:open', path),

  listSkills: (): Promise<SkillDef[]> => ipcRenderer.invoke('skills:list'),

  openSkill: (path: string): Promise<void> =>
    ipcRenderer.invoke('skills:open', path),

  renameSession: (id: string, name: string): Promise<void> =>
    ipcRenderer.invoke('session:rename', { id, name }),

  openInVSCode: (cwd: string): Promise<void> =>
    ipcRenderer.invoke('vscode:open', cwd),

  minimizeWindow: (): void => { ipcRenderer.send('window:minimize') },
  maximizeWindow: (): void => { ipcRenderer.send('window:maximize') },
  closeWindow: (): void => { ipcRenderer.send('window:close') },
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized)
    ipcRenderer.on('window:maximizeChange', handler)
    return () => { ipcRenderer.off('window:maximizeChange', handler) }
  },

  openExternal: (url: string): void => {
    ipcRenderer.send('open-external', url)
  },

  getSessionPr: (sessionId: string): Promise<SessionPr | null> =>
    ipcRenderer.invoke('session:pr:get', { id: sessionId }),

  mergeSessionPr: (sessionId: string, prNumber: number): Promise<void> =>
    ipcRenderer.invoke('session:pr:merge', { id: sessionId, prNumber }),

  onSessionPrChanged: (
    cb: (sessionId: string, pr: SessionPr | null) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: PrPayload) =>
      cb(p.id, p.pr)
    ipcRenderer.on('session:pr', handler)
    return () => {
      ipcRenderer.off('session:pr', handler)
    }
  },

  getSessionUsage: (sessionId: string): Promise<SessionUsage | null> =>
    ipcRenderer.invoke('session:usage:get', { id: sessionId }),

  onSessionUsageChanged: (
    cb: (sessionId: string, usage: SessionUsage) => void,
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, p: UsagePayload) =>
      cb(p.id, p.usage)
    ipcRenderer.on('session:usage', handler)
    return () => {
      ipcRenderer.off('session:usage', handler)
    }
  },
}

contextBridge.exposeInMainWorld('termhub', api)

export type TermhubApi = typeof api
