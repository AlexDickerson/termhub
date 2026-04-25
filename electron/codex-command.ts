// Pure helpers for spawning codex — flag construction. No electron, no PTY,
// no I/O — testable in isolation.
//
// Codex CLI flag surface (relevant subset):
//   codex [OPTIONS] [PROMPT]
//   -m, --model <MODEL>                     Model to use
//   -C, --cd <DIR>                          Working root (we rely on PTY cwd instead)
//   -a, --ask-for-approval <POLICY>         Approval policy: untrusted | on-failure | on-request | never
//   -s, --sandbox <MODE>                    Sandbox mode: read-only | workspace-write | danger-full-access
//   --dangerously-bypass-approvals-and-sandbox  Skip all confirmations and sandbox
//   [PROMPT]                                Initial prompt as positional arg (last)

// Returns true if the model name looks like a Claude model (e.g. "claude-opus-4-7").
// Used to detect misconfiguration when a caller passes a Claude model name with
// cli: 'codex' — those two are incompatible.
export function isClaudeModelName(model: string): boolean {
  return model.toLowerCase().startsWith('claude-')
}

// Builds the flag list for a `codex` invocation.
//
// open_session field mapping:
//   model                      → -m <model>
//   dangerouslyBypassApprovals → --dangerously-bypass-approvals-and-sandbox
//   prompt                     → positional <prompt> argument (must be last)
//
// Not mapped (no codex equivalent):
//   agent, allowDangerouslySkipPermissions, permissionMode
export function buildCodexArgs(opts: {
  model?: string
  dangerouslyBypassApprovals?: boolean
  prompt?: string
}): string[] {
  const flags: string[] = []

  if (opts.model && opts.model.length > 0) {
    flags.push(`-m "${opts.model}"`)
  }

  if (opts.dangerouslyBypassApprovals) {
    flags.push('--dangerously-bypass-approvals-and-sandbox')
  }

  // Prompt is the positional argument — must come last so the shell doesn't
  // interpret it as a flag value.
  if (opts.prompt && opts.prompt.length > 0) {
    flags.push(`"${opts.prompt}"`)
  }

  return flags
}

// Concatenated form of buildCodexArgs — what session-manager writes to the PTY.
export function buildCodexCommand(opts: {
  model?: string
  dangerouslyBypassApprovals?: boolean
  prompt?: string
}): string {
  const flags = buildCodexArgs(opts)
  return flags.length > 0 ? `codex ${flags.join(' ')}` : 'codex'
}
