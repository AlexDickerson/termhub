// Pure helpers for spawning gemini — flag construction. No electron, no PTY,
// no I/O — testable in isolation.
//
// Gemini CLI flag surface (relevant subset):
//   gemini [OPTIONS] [query..]
//   -m, --model <MODEL>          Model to use (e.g. "gemini-2.5-pro")
//   -y, --yolo                   Auto-accept all actions (bypass approvals)
//       --skip-trust             Trust the current workspace for this session
//   -i, --prompt-interactive     Execute prompt and continue in interactive mode
//   [query..]                    Initial prompt as positional arg (interactive by default)

// Default bypass applied to every spawned Gemini session when the caller
// doesn't opt out. --yolo auto-accepts all tool actions without prompting.
// Analogous to Claude's DEFAULT_PERMISSION_MODE = 'bypassPermissions' and
// Codex's DEFAULT_CODEX_BYPASS_APPROVALS.
export const DEFAULT_GEMINI_YOLO = true

// Builds the flag list for a `gemini` invocation.
//
// open_session field mapping:
//   model                  → -m <model>
//   yolo                   → --yolo (defaults to DEFAULT_GEMINI_YOLO)
//   skipTrust              → --skip-trust (defaults to true — suppresses
//                            workspace trust prompts)
//   prompt                 → positional <prompt> argument (must be last)
//
// Not mapped (no gemini equivalent):
//   agent, allowDangerouslySkipPermissions, permissionMode
export function buildGeminiArgs(opts: {
  model?: string
  yolo?: boolean      // default: DEFAULT_GEMINI_YOLO
  skipTrust?: boolean // default: true
  prompt?: string
}): string[] {
  const flags: string[] = []

  if (opts.model && opts.model.length > 0) {
    flags.push(`-m "${opts.model}"`)
  }

  // Default to true so sessions don't block on approval prompts.
  // Pass yolo: false to opt out.
  const yolo = opts.yolo ?? DEFAULT_GEMINI_YOLO
  if (yolo) {
    flags.push('--yolo')
  }

  // Default to trusting the workspace so Gemini doesn't prompt on startup.
  const skipTrust = opts.skipTrust ?? true
  if (skipTrust) {
    flags.push('--skip-trust')
  }

  // Prompt is the positional argument — must come last so it isn't
  // interpreted as a flag value by the shell.
  if (opts.prompt && opts.prompt.length > 0) {
    flags.push(`"${opts.prompt}"`)
  }

  return flags
}

// Concatenated form of buildGeminiArgs — what session-manager writes to the PTY.
export function buildGeminiCommand(opts: {
  model?: string
  yolo?: boolean
  skipTrust?: boolean
  prompt?: string
}): string {
  const flags = buildGeminiArgs(opts)
  return flags.length > 0 ? `gemini ${flags.join(' ')}` : 'gemini'
}
