// Config + path resolution. The path getters depend on Electron's
// userData directory (which dev-vs-packaged isolation is set up against in
// main.ts), so this module imports `app`. Default config + load/write live
// here so the file format isn't smeared across main.ts.

import { app } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs'
import type { Config } from '../src/types'

export const DEFAULT_CONFIG: Config = {
  // Dev builds get port 7788 so they don't conflict with the production
  // instance on 7787 when both are running at the same time.
  mcpPort: app.isPackaged ? 7787 : 7788,
  // bypassPermissions skips per-tool approval prompts AND avoids the
  // sandbox preflight that "auto" mode triggers — without an override the
  // orchestrator session refuses to start when ~/.claude/settings.json
  // sets permissions.defaultMode to "auto" but no sandbox runtime is
  // available on the host.
  startupSessions: [
    {
      cwd: 'E:/',
      command: 'claude',
      agent: 'orchestrator',
      permissionMode: 'bypassPermissions',
      name: 'orchestrator',
    },
  ],
  paste: {
    secretFilterEnabled: true,
  },
}

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function getMcpConfigPath(): string {
  return path.join(app.getPath('userData'), 'mcp-config.json')
}

export function getSessionsPath(): string {
  return path.join(app.getPath('userData'), 'sessions.json')
}

export function writeConfig(config: Config): void {
  const configPath = getConfigPath()
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('[termhub] failed to write config:', err)
  }
}

// Reads ~/AppData/.../termhub/config.json; on first run, writes
// DEFAULT_CONFIG so the user has something to edit. Errors fall back to
// the in-memory DEFAULT_CONFIG without surfacing.
export function loadConfig(): Config {
  const configPath = getConfigPath()
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Config>
    const merged = { ...DEFAULT_CONFIG, ...parsed }
    // Deep-merge nested objects so missing sub-keys fall back to defaults.
    merged.paste = { ...DEFAULT_CONFIG.paste, ...(parsed.paste ?? {}) }
    return merged
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true })
        fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2))
        console.log(`[termhub] wrote default config to ${configPath}`)
      } catch (writeErr) {
        console.error('[termhub] failed to write default config:', writeErr)
      }
      return DEFAULT_CONFIG
    }
    console.error('[termhub] failed to read config:', err)
    return DEFAULT_CONFIG
  }
}
