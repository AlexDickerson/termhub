import { describe, it, expect, vi } from 'vitest'
import * as os from 'node:os'

// config.ts touches electron's `app` module at import time; stub it so the
// module loads under Vitest.
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp' },
}))

import { DEFAULT_CONFIG } from './config'

// Regression: pre-fix the default orchestrator startup session pointed at
// 'E:/', which only exists on a Windows host. On macOS / Linux the
// auto-spawned orchestrator failed before the user could touch it.
describe('DEFAULT_CONFIG.startupSessions', () => {
  it('roots the orchestrator at the user home dir, not a Windows drive', () => {
    const orchestrator = DEFAULT_CONFIG.startupSessions?.[0]
    expect(orchestrator?.cwd).toBe(os.homedir())
    // Belt-and-braces: never reintroduce a hardcoded drive letter.
    expect(orchestrator?.cwd).not.toMatch(/^[A-Za-z]:[\\/]/)
  })
})
