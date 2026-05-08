import { describe, it, expect, vi } from 'vitest'

// session-manager imports electron + @lydell/node-pty + node:crypto at the
// top level. None of those are loadable in Vitest's node env without
// stubs, but we only need the pure shouldEmitStatus helper. Provide
// minimal mocks so the module can be imported without running anything.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { isPackaged: true, getPath: () => '/tmp' },
}))
vi.mock('@lydell/node-pty', () => ({ spawn: () => ({}) }))

import { defaultPrimaryShell, shouldEmitStatus } from './session-manager'

// Regression: pre-fix, sessions starting at 'working' that first reported
// 'busy' (which maps to 'working') would never emit a 'session:status'
// event, leaving the sidebar dot stuck at the renderer's 'idle' default.
// shouldEmitStatus forces the first emission so the renderer is seeded.
describe('shouldEmitStatus', () => {
  it('emits the very first call regardless of equality', () => {
    const emitted = new Set<string>()
    expect(shouldEmitStatus(emitted, 'a', 'working', 'working')).toBe(true)
  })

  it('suppresses repeated equal calls after the first', () => {
    const emitted = new Set<string>(['a'])
    expect(shouldEmitStatus(emitted, 'a', 'working', 'working')).toBe(false)
  })

  it('emits when the status changes after a previous emission', () => {
    const emitted = new Set<string>(['a'])
    expect(shouldEmitStatus(emitted, 'a', 'working', 'idle')).toBe(true)
    expect(shouldEmitStatus(emitted, 'a', 'idle', 'awaiting')).toBe(true)
    expect(shouldEmitStatus(emitted, 'a', 'awaiting', 'failed')).toBe(true)
  })

  it('treats each session id independently', () => {
    // Session "a" already seeded; session "b" hasn't been emitted yet.
    const emitted = new Set<string>(['a'])
    expect(shouldEmitStatus(emitted, 'a', 'working', 'working')).toBe(false)
    expect(shouldEmitStatus(emitted, 'b', 'working', 'working')).toBe(true)
  })
})

describe('defaultPrimaryShell', () => {
  it('uses COMSPEC on Windows when set', () => {
    expect(
      defaultPrimaryShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }),
    ).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('falls back to cmd.exe on Windows when COMSPEC is unset', () => {
    expect(defaultPrimaryShell('win32', {})).toBe('cmd.exe')
  })

  it('uses SHELL on macOS when set', () => {
    expect(defaultPrimaryShell('darwin', { SHELL: '/bin/zsh' })).toBe('/bin/zsh')
  })

  it('uses SHELL on Linux when set', () => {
    expect(defaultPrimaryShell('linux', { SHELL: '/usr/bin/bash' })).toBe(
      '/usr/bin/bash',
    )
  })

  it('falls back to /bin/sh on Unix when SHELL is unset', () => {
    expect(defaultPrimaryShell('darwin', {})).toBe('/bin/sh')
    expect(defaultPrimaryShell('linux', {})).toBe('/bin/sh')
  })

  it('does not pick COMSPEC on non-Windows platforms', () => {
    // Guards against a regression where Unix paths fall through to a
    // Windows-only env var.
    expect(
      defaultPrimaryShell('darwin', { COMSPEC: 'cmd.exe', SHELL: '/bin/zsh' }),
    ).toBe('/bin/zsh')
  })
})
