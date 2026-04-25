// Pure helpers for spawning claude — flag construction, env scrubbing,
// bracketed-paste framing. No electron, no PTY, no I/O — testable in isolation.

// Default permission mode applied to every spawned claude when the caller
// (config.json, MCP open_session, etc.) doesn't specify one. bypassPermissions
// avoids the sandbox preflight that fires when claude's own
// permissions.defaultMode is "auto" or when OPERON_SANDBOXED_NETWORK leaks
// into the env. Override per-session via the permissionMode field if you
// want stricter behavior.
export const DEFAULT_PERMISSION_MODE = 'bypassPermissions'

export function isClaudeCommand(cmd: string): boolean {
  return /^claude(\s|$)/.test(cmd.trim())
}

// Pure helper — builds the flag list for a `claude` invocation. No side
// effects (besides a console.warn when both skip-permissions flags are set).
export function buildClaudeArgs(opts: {
  sessionId: string
  mcpConfigPath: string
  agent?: string
  model?: string
  resume?: boolean
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  permissionMode?: string
}): string[] {
  const permissionMode =
    opts.permissionMode && opts.permissionMode.length > 0
      ? opts.permissionMode
      : DEFAULT_PERMISSION_MODE

  const flags: string[] = [`--mcp-config "${opts.mcpConfigPath}"`]

  if (opts.resume) {
    flags.push(`--resume "${opts.sessionId}"`)
    if (opts.model && opts.model.length > 0) {
      flags.push(`--model "${opts.model}"`)
    }
  } else {
    flags.push(`--session-id "${opts.sessionId}"`)
    if (opts.agent && opts.agent.length > 0) {
      flags.push(`--agent "${opts.agent}"`)
    }
    if (opts.model && opts.model.length > 0) {
      flags.push(`--model "${opts.model}"`)
    }
  }

  if (opts.dangerouslySkipPermissions) {
    if (opts.allowDangerouslySkipPermissions) {
      console.warn(
        '[termhub:session] both dangerouslySkipPermissions and allowDangerouslySkipPermissions set' +
          ' — dangerouslySkipPermissions takes precedence; ignoring allowDangerouslySkipPermissions',
      )
    }
    flags.push('--dangerously-skip-permissions')
  } else if (opts.allowDangerouslySkipPermissions) {
    flags.push('--allow-dangerously-skip-permissions')
  }

  flags.push(`--permission-mode "${permissionMode}"`)
  return flags
}

// Concatenated form of buildClaudeArgs — what main.ts writes to the PTY.
// Takes mcpConfigPath as a parameter so the helper stays pure (the path is
// resolved at app-ready time and held in main.ts state).
export function buildClaudeCommand(opts: {
  sessionId: string
  mcpConfigPath: string
  agent?: string
  model?: string
  resume?: boolean
  dangerouslySkipPermissions?: boolean
  allowDangerouslySkipPermissions?: boolean
  permissionMode?: string
}): string {
  const flags = buildClaudeArgs(opts)
  return `claude ${flags.join(' ')}`
}

// Wrap text in bracketed-paste markers (no trailing CR). Claude's TUI
// (Ink) handles bracketed paste atomically, so arbitrarily long /
// shell-special content can be injected without cmd.exe seeing or
// trying to parse it.
export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`
}

type PtyWriteTarget = { write: (data: string) => void }

// Send `text` as a bracketed paste, then send Enter on a later tick so
// Ink reliably commits the paste before processing the submit keystroke.
//
// Without the gap, Ink can fold the trailing CR into the same read as
// the paste-mode-exit marker (\x1b[201~) and consume it instead of
// treating it as a separate Enter keypress — symptom: the prompt
// appears in claude's input box but is never submitted, intermittently.
//
// `schedule` is injectable for tests — production callers should let it
// default to setTimeout(cb, 250). 250ms is comfortably more than Ink's
// reconciler frame budget (~16ms) AND survives OS-level pty write
// batching that can collapse adjacent writes into a single read at the
// child end. 50ms was enough in isolation but lost the race when 10
// sessions hit the timer simultaneously and the kernel batched their
// writes; 250ms is the empirically-comfortable margin without being
// noticeable as lag.
export function writeBracketedPasteAndSubmit(
  target: PtyWriteTarget,
  text: string,
  schedule: (cb: () => void) => void = (cb) => {
    setTimeout(cb, 250)
  },
): void {
  target.write(bracketedPaste(text))
  schedule(() => {
    try {
      target.write('\r')
    } catch {
      // pty may have exited between paste and submit — swallow
    }
  })
}

// CLAUDE_* / CLAUDECODE / OPERON_* vars from a parent claude session leak
// into spawned child claudes and confuse them. In particular,
// OPERON_SANDBOXED_NETWORK=1 (set by claude desktop's sandbox runtime)
// makes the spawned claude assert that a sandbox is required even when
// settings.json has sandbox.failIfUnavailable: false. Strip these so the
// child boots from a clean baseline.
const PARENT_CLAUDE_ENV_PREFIXES = ['CLAUDE_', 'CLAUDECODE', 'OPERON_']
const PARENT_CLAUDE_ENV_EXACT = new Set(['DEFAULT_LLM_MODEL'])

export function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue
    if (PARENT_CLAUDE_ENV_EXACT.has(k)) continue
    if (PARENT_CLAUDE_ENV_PREFIXES.some((p) => k.startsWith(p))) continue
    out[k] = v
  }
  return out
}
