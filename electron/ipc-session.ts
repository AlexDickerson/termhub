// IPC handlers for session lifecycle: create, input, resize, close,
// list, rename — for both the primary (claude) PTY and the docked shell.
// The handlers are thin wrappers over session-manager; this module
// owns the IPC channel names and payload shapes only.

import { ipcMain } from 'electron'
import {
  closeSession,
  createSessionInternal,
  getAllSessions,
  getSession,
  persistSessions,
} from './session-manager'
import { resizePty } from './pty-resize'
import { isClaudeModelName } from './codex-command'
import type { NewSessionOptions } from '../src/types'

export function registerSessionHandlers(): void {
  // The renderer can now spawn the same shapes the MCP open_session tool can:
  // a plain shell (omit `cli`) or a claude/codex/gemini session with a model,
  // agent, permission mode and initial prompt. Previously this only took a
  // cwd and always produced a bare shell, which left the human path strictly
  // less capable than the orchestrator path.
  //
  // source stays 'ipc' so session-manager skips the session:added broadcast —
  // the renderer adds the row itself from the returned id.
  ipcMain.handle('session:create', (_event, opts: NewSessionOptions) => {
    if (opts.cli && opts.cli !== 'claude' && opts.model && isClaudeModelName(opts.model)) {
      // Same guard the MCP path applies: a claude model name with a non-claude
      // runtime fails at spawn time with a much less obvious error.
      throw new Error(
        `Cannot use Claude model '${opts.model}' with ${opts.cli}. ` +
          `Pass a ${opts.cli}-compatible model or leave the model blank.`,
      )
    }
    const result = createSessionInternal({
      cwd: opts.cwd,
      command: opts.cli,
      cli: opts.cli,
      prompt: opts.prompt,
      agent: opts.agent,
      model: opts.model,
      permissionMode: opts.permissionMode,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      allowDangerouslySkipPermissions: opts.allowDangerouslySkipPermissions,
      name: opts.name,
      source: 'ipc',
    })
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
    closeSession(payload.id)
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
      cli: s.cli,
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
