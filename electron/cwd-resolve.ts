// Resolves a configured session cwd to a directory that actually exists
// on this host. A config written on Windows (drive letters like 'E:/') is
// otherwise fatal on macOS / Linux: pty.spawn rejects an unreachable cwd
// and the session never starts. Falling back to homedir keeps the app
// usable and surfaces the substitution in the log.

import * as fs from 'node:fs'
import * as os from 'node:os'

export function resolveSessionCwd(
  cwd: string,
  fallback: string = os.homedir(),
  exists: (p: string) => boolean = (p) => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  },
): string {
  if (exists(cwd)) return cwd
  return fallback
}
