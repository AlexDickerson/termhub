import { describe, it, expect, vi, afterEach } from 'vitest'

// buildClaudeArgs is a pure helper exported from main.ts. We import it
// directly; Electron and node-pty are not available in the test runner so
// we mock the modules that main.ts imports at the top level.
// vi.mock factories are hoisted, so all values must be defined inline.
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    setPath: () => {},
    isPackaged: true,
    // Return a promise that never resolves so the whenReady callbacks
    // never fire and we avoid unhandled errors from incomplete mocks.
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
  },
  BrowserWindow: class {
    on() {}
    once() {}
    loadURL() {}
    loadFile() {}
    webContents = { send: () => {}, openDevTools: () => {} }
    isMaximized() { return false }
    minimize() {}
    maximize() {}
    unmaximize() {}
    close() {}
    static getAllWindows() { return [] }
  },
  ipcMain: { handle: () => {}, on: () => {}, once: () => {} },
  dialog: {},
  clipboard: { readText: () => '', writeText: () => {} },
  shell: { openPath: async () => '' },
  Menu: { setApplicationMenu: () => {} },
}))
vi.mock('@lydell/node-pty', () => ({ spawn: () => ({}) }))
vi.mock('node:child_process', () => ({ spawn: () => ({}) }))

import { buildClaudeArgs } from './main'

const BASE = {
  sessionId: 'test-session-id',
  mcpConfigPath: '/path/to/mcp.json',
}

describe('buildClaudeArgs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('neither flag — no skip-permissions flags emitted', () => {
    const flags = buildClaudeArgs({ ...BASE })
    expect(flags.join(' ')).not.toContain('--dangerously-skip-permissions')
    expect(flags.join(' ')).not.toContain('--allow-dangerously-skip-permissions')
  })

  it('only dangerouslySkipPermissions — emits --dangerously-skip-permissions', () => {
    const flags = buildClaudeArgs({ ...BASE, dangerouslySkipPermissions: true })
    expect(flags).toContain('--dangerously-skip-permissions')
    expect(flags.join(' ')).not.toContain('--allow-dangerously-skip-permissions')
  })

  it('only allowDangerouslySkipPermissions — emits --allow-dangerously-skip-permissions', () => {
    const flags = buildClaudeArgs({ ...BASE, allowDangerouslySkipPermissions: true })
    expect(flags).toContain('--allow-dangerously-skip-permissions')
    expect(flags.join(' ')).not.toContain(' --dangerously-skip-permissions')
  })

  it('both flags — dangerouslySkipPermissions wins, allow flag omitted, warning logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const flags = buildClaudeArgs({
      ...BASE,
      dangerouslySkipPermissions: true,
      allowDangerouslySkipPermissions: true,
    })
    expect(flags).toContain('--dangerously-skip-permissions')
    expect(flags.join(' ')).not.toContain('--allow-dangerously-skip-permissions')
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('dangerouslySkipPermissions takes precedence')
  })

  it('includes --session-id for a non-resume call', () => {
    const flags = buildClaudeArgs({ ...BASE })
    expect(flags.some((f) => f.includes('--session-id'))).toBe(true)
    expect(flags.join(' ')).not.toContain('--resume')
  })

  it('includes --resume for a resume call', () => {
    const flags = buildClaudeArgs({ ...BASE, resume: true })
    expect(flags.some((f) => f.includes('--resume'))).toBe(true)
    expect(flags.join(' ')).not.toContain('--session-id')
  })

  it('includes --permission-mode with provided value', () => {
    const flags = buildClaudeArgs({ ...BASE, permissionMode: 'plan' })
    expect(flags.some((f) => f.includes('--permission-mode') && f.includes('plan'))).toBe(true)
  })

  it('defaults --permission-mode to bypassPermissions when omitted', () => {
    const flags = buildClaudeArgs({ ...BASE })
    expect(flags.some((f) => f.includes('--permission-mode') && f.includes('bypassPermissions'))).toBe(true)
  })

  it('includes --mcp-config with the provided path', () => {
    const flags = buildClaudeArgs({ ...BASE })
    expect(flags.some((f) => f.includes('--mcp-config') && f.includes('/path/to/mcp.json'))).toBe(true)
  })
})
