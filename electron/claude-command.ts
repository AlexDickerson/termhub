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

// Wrap text in bracketed-paste markers + Enter. Claude's TUI (Ink) handles
// bracketed paste atomically, so arbitrarily long / shell-special content
// can be injected without cmd.exe seeing or trying to parse it.
export function bracketedPasteWithSubmit(text: string): string {
  return `\x1b[200~${text}\x1b[201~\r`
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
