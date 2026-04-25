// IPC handlers for session lifecycle: create, input, resize, close,
// list, rename — for both the primary (claude) PTY and the docked shell.
// The handlers are thin wrappers over session-manager; this module
// owns the IPC channel names and payload shapes only.

import { ipcMain } from 'electron'
import {
  createSessionInternal,
  deleteSession,
  getAllSessions,
  getSession,
  persistSessions,
} from './session-manager'
import { resizePty } from './pty-resize'

export function registerSessionHandlers(): void {
  // Renderer-spawned sessions are plain shells rooted at the picked folder.
  // Claude sessions are launched via startup config, restored on resume, or
  // opened via the MCP `open_session` tool — never from the renderer.
  ipcMain.handle('session:create', (_event, opts: { cwd: string }) => {
    const result = createSessionInternal({ cwd: opts.cwd, source: 'ipc' })
    return { id: result.id, cwd: result.cwd }
  })

  ipcMain.on(
    'session:input',
    (_event, payload: { id: string; data: string }) => {
      getSession(payload.id)?.term.write(payload.data)
    },
  )

  ipcMain.on(
    'session:resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const s = getSession(payload.id)
      if (!s) return
      resizePty(s.term, payload.cols, payload.rows)
    },
  )

  ipcMain.on('session:close', (_event, payload: { id: string }) => {
    const s = getSession(payload.id)
    if (!s) return
    if (s.jsonlWatcher) {
      s.jsonlWatcher.stop()
      s.jsonlWatcher = null
    }
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
    deleteSession(payload.id)
    persistSessions()
  })

  ipcMain.on(
    'session:shell:input',
    (_event, payload: { id: string; data: string }) => {
      getSession(payload.id)?.shellTerm.write(payload.data)
    },
  )

  ipcMain.on(
    'session:shell:resize',
    (_event, payload: { id: string; cols: number; rows: number }) => {
      const s = getSession(payload.id)
      if (!s) return
      resizePty(s.shellTerm, payload.cols, payload.rows)
    },
  )

  ipcMain.handle('sessions:list', () =>
    getAllSessions().map((s) => ({
      id: s.id,
      cwd: s.cwd,
      command: s.command,
      name: s.name,
      repoRoot: s.repoRoot,
      repoLabel: s.repoLabel,
    })),
  )

  ipcMain.handle(
    'session:rename',
    (_event, payload: { id: string; name: string }) => {
      const s = getSession(payload.id)
      if (!s) throw new Error(`Session not found: ${payload.id}`)
      s.name = payload.name.trim() || undefined
      persistSessions()
    },
  )
}
