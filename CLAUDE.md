# termhub

termhub is a Windows desktop app for managing many concurrent terminal sessions — primarily Claude Code sessions doing parallel coding work. It exposes those sessions to a parent Claude via an MCP server, so an orchestrator agent can spawn, monitor, and steer sub-sessions as tools.

There is no README at the repo root; this file is the orientation doc.

## Stack

- **Electron 33** desktop app, packaged via electron-builder (NSIS + portable, Windows x64).
- **React 18** + **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`) renderer in `src/`.
- **Vite 5** for the renderer; **esbuild** for the main + bridge bundles.
- **@lydell/node-pty** for PTY handling (Windows-friendly fork — do NOT swap for upstream `node-pty`).
- **@modelcontextprotocol/sdk** + **zod 4** for the MCP server.
- **TypeScript 5.6**, two tsconfigs: `tsconfig.json` (renderer) and `tsconfig.electron.json` (main + bridge).
- **Testing uses Vitest** (see "Testing" below). No linter or formatter is wired up — don't add one without being asked.

## Layout

```
electron/
  main.ts          Electron main. Owns the PTY map, IPC, persistence, and starts the MCP HTTP server.
  mcp.ts           Internal HTTP endpoint the bridge forwards tool calls to. NOT itself an MCP server.
  mcp-bridge.ts    Standalone Node subprocess — the actual stdio MCP server claude connects to. Forwards to mcp.ts.
  preload.ts       Defines the window.termhub API surface (renderer ↔ main IPC bridge).
src/
  App.tsx          Root component. Owns sessions/active state.
  Sidebar.tsx      Session list.
  TerminalView.tsx xterm.js host for the active session.
  RightPanel.tsx   Inspector sidebar (agents, MCPs, skills).
  AgentList.tsx, McpList.tsx, SkillList.tsx, CollapsibleSection.tsx
  types.ts         **The IPC contract** — TermhubApi, Session, Config, AgentDef, SkillDef.
                   Must stay in sync across preload.ts, main.ts, and consumers.
  main.tsx         React entry.
index.html         Vite entry.
vite.config.mts    Vite config.
```

## Architecture (three processes)

1. **Main** (`electron/main.ts`) — owns PTYs, persists sessions, exposes IPC to renderer, runs the HTTP MCP endpoint on the configured port.
2. **Renderer** (`src/`) — React UI, talks to main via `window.termhub.*` (preload-injected).
3. **MCP bridge** (`electron/mcp-bridge.ts`) — separate Node subprocess spawned by claude as a stdio MCP server. Forwards tool calls over HTTP to main's `/internal/*` endpoints.

When adding or modifying an MCP tool you will typically edit **all three**: the bridge (declare/route the tool), `electron/mcp.ts` (HTTP handler + types), and `electron/main.ts` (the actual implementation that touches PTY/session state).

## Commands

- `npm run dev` — concurrently runs Vite (port 5173) and Electron with HMR. **The dev loop.**
- `npm run typecheck` — runs both tsconfigs (`tsc --noEmit && tsc --noEmit -p tsconfig.electron.json`). Run this before declaring any change done.
- `npm run build` — builds main, bridge, and renderer into `dist/`.
- `npm run dist:win` — packages NSIS + portable Windows installers.
- `npm start` — full build + run packaged.

## Testing

Termhub uses **Vitest** for unit tests. Tests are colocated next to the source file as `*.test.ts` or `*.test.tsx`, and run with `npm test` (which executes `vitest run`).

**Work must include tests** at a reasonable level of coverage:

- **New features** ship with tests covering non-trivial logic — state reducers, heuristics, IPC payload shaping, parsers, pure utilities. Skip pixel-testing React UIs unless the component has meaningful behavior beyond rendering.
- **Bug fixes** ship with a regression test that fails without the fix and passes with it.
- **Refactors** preserve the existing test surface — update tests to match the new shape rather than deleting them.

**Mid-adoption caveat**: termhub is in the middle of adopting Vitest. Depending on which branch you're on, Vitest may not yet be installed. Check `package.json` first. If absent, bootstrap it as part of your work:

```bash
npm i -D vitest
# add "test": "vitest run" to scripts
```

Keep the bootstrap minimal — a proper harness/config PR can follow. Do NOT add other test tools (Jest, Mocha, @testing-library, Playwright) without being asked.

## Logging

Logging added is part of the feature — it **ships into `main` and stays there**. It should answer "what is this code doing right now?" for an operator (future you, six months from now) without a debugger attached. **Throwaway `console.log` added to chase a current bug is *not* this kind of logging — strip those before opening the PR.**

What good logging looks like:

- **Use levels.** `console.error` for failures, `console.warn` for recoverable surprises, `console.info` / `console.log` for state changes worth knowing, `console.debug` for finer traces. Don't ship everything at the same level.
- **Log at boundaries, not in loops.** IPC handler entry, PTY spawn / exit, MCP request, session lifecycle events. Not inside per-render or per-keystroke paths.
- **Lines must be self-contained.** Include the session id, operation, relevant state. A reader shouldn't have to grep surrounding context to make sense of a single line.
- **Errors include cause.** `console.error('paste failed', err)` — pass the actual `Error`, not just a string. The stack matters.
- **No throwaway noise.** "Here", "got x", "starting", "done" without context don't pass the bar. If you wouldn't want to read this six months from now, don't ship it.
- **Never log**: clipboard contents, full PTY output buffers, full input prompts, anything that could leak credentials.

**Format**: termhub has no logger framework. Use `console.*` with a component prefix like `[termhub:mcp]` (see `electron/mcp.ts` for the established pattern). Pick a prefix that identifies your component (e.g. `[termhub:session]`, `[termhub:status]`). Don't introduce a logger library.

## Conventions

- 2-space indent, single quotes, **no semicolons** (match existing source).
- Imports: relative for local, bare for npm.
- Filenames: PascalCase for React components, lowercase for non-component TS.
- React: function components + hooks only.
- Output buffer in main is capped at 256 KB rolling — don't change without thinking through the `read_output` contract.

## Hot / sensitive areas

- **@lydell/node-pty native binding.** Listed in electron-builder's `asarUnpack`. Repackaging or version bumps need installer testing.
- **The TermhubApi contract in `src/types.ts`.** Drift between preload, main, and renderer manifests as silent IPC failures. Update all three together.
- **`stripAnsi` in `electron/main.ts`.** Lossy by design — heavy TUI redraws (claude's input box) don't reconstruct perfectly. Don't try to make it perfect; just don't regress on plain text.
- **MCP wire shape.** Bridge and HTTP server in `mcp.ts` must agree on schemas. zod schemas are the source of truth.
- **Session persistence** lives in `main.ts`. Format changes need a migration path or a reset.

## Likely tasks

- MCP tool additions or refinements (open_session, read_output, send_input, …) — touches bridge + mcp.ts + main.ts.
- UI work in `src/` (sidebar, terminal view, inspector panels).
- Session lifecycle features (persistence, restoration, naming, model picker).
- Packaging / installer tweaks.

## Branch discipline

**Do not create a new branch or worktree until your current PR has been confirmed merged.** Pushing your branch and opening a PR doesn't end your responsibility for that branch — it's yours until it lands on `main`. Anything that follows up on the same change (CI failures, review feedback, extra commits the user asks for) goes to the **same branch** as new commits. Only after the PR is merged (visible on `main`, branch deleted) should you start a new branch / worktree.

If the user redirects you to different work before the PR merges, **ask** — they may want fresh commits on the same branch rather than a new one.

## Working norms

- Never commit unless explicitly asked.
- Tests are required — see "Testing". Don't add other test tools, linters, or formatters unless asked.
- When in doubt about how to wire something across processes, read `src/types.ts` first. It is the contract.
- Run `npm run typecheck` before reporting work complete.
