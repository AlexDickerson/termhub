// Recovers the user's real PATH on macOS / Linux.
//
// A GUI-launched app does not inherit the shell environment. On macOS,
// `launchctl getenv PATH` is normally unset, so an app started from Finder
// gets only /usr/bin:/bin:/usr/sbin:/sbin — no /opt/homebrew/bin, no
// /usr/local/bin, no ~/.local/bin, no nvm shims. cleanEnv() then copies that
// minimal PATH into every PTY, so `claude` (installed via Homebrew, npm -g, or
// a version manager) is simply not found, and the session dies with
// "command not found: claude".
//
// This never reproduces under `npm run dev`, because Electron launched from a
// terminal inherits that terminal's PATH. It only bites the packaged app.
//
// The fix is to ask the user's login shell what PATH it would set up, which is
// what `fix-path` / `shell-env` do on npm. Done here directly to avoid adding a
// dependency for ~40 lines.

import { execFileSync } from 'node:child_process'

// Wrapping the value lets us find it in output that may also contain shell
// startup noise (motd, prompt escapes, `set -x` traces from a chatty rc file).
const SENTINEL = '__TERMHUB_PATH__'

// Exported for tests.
export function extractPathFromShellOutput(stdout: string): string | null {
  const first = stdout.indexOf(SENTINEL)
  if (first === -1) return null
  const start = first + SENTINEL.length
  const end = stdout.indexOf(SENTINEL, start)
  if (end === -1) return null
  const value = stdout.slice(start, end).trim()
  return value.length > 0 ? value : null
}

// Union of the login PATH and whatever we already had, login entries first.
// A union rather than a replacement: the login shell's PATH is what the user
// expects `claude` to resolve against, but we must not drop anything Electron
// itself put there.
export function mergePaths(
  loginPath: string,
  currentPath: string | undefined,
): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of [...loginPath.split(':'), ...(currentPath ?? '').split(':')]) {
    if (part.length === 0 || seen.has(part)) continue
    seen.add(part)
    out.push(part)
  }
  return out.join(':')
}

// fish stores PATH as a list, so "$PATH" interpolates space-separated rather
// than colon-separated. Ask it to join explicitly instead of trying to parse
// the difference afterwards — macOS paths contain spaces, so splitting output
// on whitespace is not safe.
function commandFor(shell: string): { args: string[] } {
  const name = shell.replace(/\\/g, '/').split('/').pop() ?? ''
  if (name === 'fish') {
    return { args: ['-l', '-c', `printf '%s%s%s' '${SENTINEL}' (string join : $PATH) '${SENTINEL}'`] }
  }
  // -i matters: on zsh, PATH is commonly set in .zshrc (interactive) rather
  // than .zprofile, so a non-interactive login shell misses it.
  return { args: ['-ilc', `printf '%s%s%s' '${SENTINEL}' "$PATH" '${SENTINEL}'`] }
}

export type ExecFn = (file: string, args: string[]) => string

const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    // A chatty or prompting rc file must not hang startup.
    timeout: 5000,
    // Startup noise goes to stderr; the sentinel scan handles stdout.
    stdio: ['ignore', 'pipe', 'ignore'],
  })

// Returns the login shell's PATH, or null when it can't be determined (or
// isn't needed). Windows resolves PATH from the registry for GUI processes,
// so there is nothing to recover there.
export function resolveLoginShellPath(opts?: {
  platform?: NodeJS.Platform
  shell?: string
  exec?: ExecFn
}): string | null {
  const platform = opts?.platform ?? process.platform
  if (platform === 'win32') return null

  const shell = opts?.shell ?? process.env.SHELL
  if (!shell) return null

  const exec = opts?.exec ?? defaultExec
  try {
    const stdout = exec(shell, commandFor(shell).args)
    return extractPathFromShellOutput(stdout)
  } catch (err) {
    console.warn(
      `[termhub:path] could not read PATH from login shell ${shell}; ` +
        'CLI lookups will use the inherited PATH',
      err,
    )
    return null
  }
}

// Merge the login shell's PATH into process.env.PATH. Must run before any PTY
// is spawned, since cleanEnv() snapshots process.env per session.
export function applyLoginShellPath(): void {
  const loginPath = resolveLoginShellPath()
  if (!loginPath) return

  const merged = mergePaths(loginPath, process.env.PATH)
  if (merged === process.env.PATH) {
    console.log('[termhub:path] PATH already matches the login shell')
    return
  }
  process.env.PATH = merged
  console.log(
    `[termhub:path] merged login shell PATH (${merged.split(':').length} entries)`,
  )
}
