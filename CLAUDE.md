# termhub

termhub is a cross-platform (Windows + macOS) desktop app for managing many concurrent terminal sessions — primarily Claude Code sessions doing parallel coding work. It exposes those sessions to a parent Claude via an MCP server, so an orchestrator agent can spawn, monitor, and steer sub-sessions as tools.

See `README.md` for install/run instructions. This file is the orientation doc for working *on* termhub.

## Stack

- **Electron 39** desktop app (bundles Node 22), packaged via electron-builder — NSIS + portable for Windows x64, DMG + ZIP for macOS arm64.
- **React 19** + **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`) renderer in `src/`.
- **Vite 6** for the renderer; **esbuild** for the main + bridge bundles.
- **@lydell/node-pty** for PTY handling (Windows-friendly fork — do NOT swap for upstream `node-pty`).
- **@modelcontextprotocol/sdk** + **zod 4** for the MCP server.
- **TypeScript 5.6**, two tsconfigs: `tsconfig.json` (renderer) and `tsconfig.electron.json` (main + bridge). Both exclude `.claude`.
- **Vitest 3** for tests (see "Testing"). No linter or formatter is wired up — don't add one without being asked.

`@types/node` is pinned to **^22** deliberately: Electron 39 bundles Node 22.22.1, so typing against a newer major would describe APIs the runtime doesn't have. Dependabot will keep proposing 25; it should keep being declined until Electron's bundled Node moves.

## Layout

```
electron/
  main.ts            Bootstrap only: userData isolation, window creation, MCP
                     stand-up + open_session queue, session bootstrap, IPC
                     registration. Session logic lives in the modules below.
  session-manager.ts The live PTY map and session lifecycle. createSession /
                     closeSession / find / persist / status emission.
  persistence.ts     sessions.json read/write (the resume format).
  config.ts          userData path getters + config.json load/save.
  status-watcher.ts  Watches Claude Code's ~/.claude/sessions/<pid>.json for
                     ground-truth session status.
  attention.ts       Notification + dock badge / taskbar flash decisions.
  output-buffer.ts   Rolling 256 KB buffer + stripAnsi.
  mcp.ts             Internal authenticated HTTP endpoint. NOT itself an MCP server.
  mcp-bridge.ts      Standalone Node subprocess — the actual stdio MCP server
                     claude connects to. Forwards to mcp.ts.
  mcp-routes.ts      Route constants shared by the bridge and the HTTP server.
  mcp-auth.ts        Shared-secret generation / constant-time compare.
  preload.ts         Defines the window.termhub API surface.
  ipc-session.ts     Session lifecycle IPC.
  ipc-app.ts         Window controls, folder picker, clipboard, config open.
  ipc-discovery.ts   Agent / skill discovery IPC.
  ipc-pr.ts          Per-session PR tracking IPC.
  ipc-usage.ts       Token usage IPC.
  ipc-shell-picker.ts Bottom-shell selection IPC.
  claude-command.ts / codex-command.ts / gemini-command.ts
                     Per-runtime argv construction.
  agents-skills.ts, pr-fetch.ts, usage-fetch.ts, repo-root.ts,
  shell-detect.ts, cwd-resolve.ts, links.ts, opener.ts, pty-resize.ts
src/
  App.tsx            Root component. Owns sessions/active state and modals.
  useSessions.ts     Renderer session state + IPC subscriptions.
  useXterm.ts        xterm instance lifecycle.
  useToasts.ts / toast-state.ts / Toasts.tsx   User-visible error surface.
  NewSessionModal.tsx  Session creation dialog (cli, model, agent, mode, prompt).
  Sidebar.tsx, TerminalView.tsx, BottomTerminal.tsx, RightPanel.tsx,
  TitleBar.tsx, UsageModal.tsx, ConfirmCloseModal.tsx, ShellPicker.tsx,
  AgentList.tsx, McpList.tsx, SkillList.tsx, SessionPrPanel.tsx,
  SessionUsagePanel.tsx, CollapsibleSection.tsx
  types.ts           **The IPC contract** — TermhubApi, Session, Config,
                     NewSessionOptions, AgentDef, SkillDef. Must stay in sync
                     across preload.ts, main.ts, and consumers.
  useSplitLayout.ts, useSidebarResize.ts, layout.ts, confirm-close.ts,
  pr-utils.ts, xterm-utils.ts, main.tsx
```

## Architecture (three processes)

1. **Main** (`electron/main.ts`) — owns PTYs, persists sessions, exposes IPC to renderer, runs the authenticated HTTP MCP endpoint on the configured port.
2. **Renderer** (`src/`) — React UI, talks to main via `window.termhub.*` (preload-injected).
3. **MCP bridge** (`electron/mcp-bridge.ts`) — separate Node subprocess spawned by claude as a stdio MCP server. Forwards tool calls over HTTP to main's `/internal/*` endpoints, authenticating with the token main writes into its env.

When adding or modifying an MCP tool you will typically edit **all three**: the bridge (declare/route the tool), `electron/mcp.ts` (HTTP handler + types), and `electron/main.ts` (the implementation that touches PTY/session state). Add the route constant to `electron/mcp-routes.ts`.

### MCP tools

| Tool | Purpose |
| --- | --- |
| `open_session` | Spawn a claude / codex / gemini session |
| `send_input` | Write to a session's PTY |
| `read_output` | Read the rolling output buffer |
| `list_sessions` | Enumerate all sessions with status |
| `get_session_status` | One session's advisory status |
| `close_session` | Terminate a session |

`get_session_status` reflects Claude Code's own JSONL status and is only meaningful for `cli: 'claude'` sessions — codex and gemini report `working` until exit.

## Commands

- `npm run dev` — concurrently runs Vite (port 5173) and Electron with HMR. **The dev loop.**
- `npm test` — Vitest. Run this before declaring any change done.
- `npm run typecheck` — both tsconfigs. Run this before declaring any change done.
- `npm run build` — builds main, bridge, and renderer into `dist/`.
- `npm run dist:win` / `npm run dist:mac` — packages installers.
- `npm start` — full build + run packaged.

## Testing

Tests are colocated as `*.test.ts` next to the source file and run with `npm test`. **26 test files, 361 tests** at time of writing; CI gates every PR on them.

**Work must include tests** at a reasonable level of coverage:

- **New features** ship with tests covering non-trivial logic — state reducers, heuristics, IPC payload shaping, parsers, pure utilities. Skip pixel-testing React UIs unless the component has meaningful behavior beyond rendering.
- **Bug fixes** ship with a regression test that fails without the fix and passes with it.
- **Refactors** preserve the existing test surface — update tests to match the new shape rather than deleting them.

Do NOT add other test tools (Jest, Mocha, @testing-library, Playwright) without being asked.

Three constraints worth knowing before you write a test:

- **`vite.config.mts` excludes `**/.claude/**`.** Orchestrator subagents leave full source copies under `.claude/worktrees/<branch>/`; without the exclude, vitest runs every worktree's copy of the suite alongside the real one. Don't remove it.
- **ESM can't spy on module exports** (`vi.spyOn(fs, 'writeFileSync')` throws "Module namespace is not configurable"). Provoke real errors instead — e.g. `persistence.test.ts` puts a regular file where a directory is expected to force `ENOTDIR`. Where a module must be replaced, use `vi.mock` with a factory; `tsconfig.electron.json` is `module: CommonJS`, so **top-level `await import()` won't compile** — use a static import and let `vi.mock` hoist above it.
- **Anything binding a port must bind `0`** and read the assigned port back off the socket. Fixed ports collide with a running dev instance and with parallel test files.

## Logging

Logging added is part of the feature — it **ships into `main` and stays there**. It should answer "what is this code doing right now?" for an operator without a debugger attached. **Throwaway `console.log` added to chase a current bug is *not* this kind of logging — strip those before opening the PR.**

- **Use levels.** `console.error` for failures, `console.warn` for recoverable surprises, `console.info` / `console.log` for state changes worth knowing, `console.debug` for finer traces.
- **Log at boundaries, not in loops.** IPC handler entry, PTY spawn / exit, MCP request, session lifecycle events. Not per-render or per-keystroke.
- **Lines must be self-contained.** Include the session id, operation, relevant state.
- **Errors include cause.** `console.error('paste failed', err)` — pass the actual `Error`, not just a string.
- **Never log**: clipboard contents, full PTY output buffers, full input prompts, the MCP token, anything that could leak credentials.

**Format**: no logger framework. Use `console.*` with a component prefix like `[termhub:mcp]` (see `electron/mcp.ts`). Don't introduce a logger library.

User-facing failures in the renderer go through `reportError` from `useToasts` — it logs the stack to console *and* shows the user a toast. A bare `console.error` in the renderer means the user sees nothing.

## Hot / sensitive areas

- **@lydell/node-pty native binding.** Listed in electron-builder's `asarUnpack`. Repackaging or version bumps need installer testing.
- **The TermhubApi contract in `src/types.ts`.** Drift between preload, main, and renderer manifests as silent IPC failures. Update all three together.
- **`stripAnsi` in `electron/output-buffer.ts`.** Lossy by design — heavy TUI redraws (claude's input box) don't reconstruct perfectly. Don't try to make it perfect; just don't regress on plain text.
- **MCP wire shape.** Bridge and HTTP server must agree on schemas and routes. zod schemas are the source of truth.
- **Session persistence** in `persistence.ts`. Format changes need a migration path or a reset; the loader tolerates partial entries on purpose.
- **The paste path** (`useXterm.ts`, `claude-command.ts`). Has a long history of double-paste / dropped-input regressions. Change carefully and test by hand.
- **The MCP token.** `mcp-config.json` and `userData/mcp-token` are `0600` because they carry it. Don't widen those, don't log it.

## Branch discipline

**Do not create a new branch or worktree until your current PR has been confirmed merged.** Pushing your branch and opening a PR doesn't end your responsibility for it — it's yours until it lands on `main`. Follow-ups on the same change (CI failures, review feedback, extra commits) go to the **same branch** as new commits. Only after the PR is merged should you start a new branch / worktree.

If the user redirects you to different work before the PR merges, **ask** — they may want fresh commits on the same branch rather than a new one.

## Releases

Tagging `v<version>` triggers the `release` job in `.github/workflows/build.yml`, which publishes the Windows and macOS artifacts to a GitHub Release. **The tag must match `package.json`'s version** — the job fails loudly otherwise, because artifact filenames are derived from it. Bump `package.json` first, merge, then tag.

Builds are unsigned and un-notarized; the generated release notes carry the Gatekeeper / SmartScreen workarounds.

## Working norms

- Never commit unless explicitly asked.
- Tests are required — see "Testing". Don't add other test tools, linters, or formatters unless asked.
- When in doubt about how to wire something across processes, read `src/types.ts` first. It is the contract.
- Run `npm run typecheck` and `npm test` before reporting work complete.
