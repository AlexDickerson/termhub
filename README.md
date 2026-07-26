# termhub

A desktop app for running many terminal sessions side by side — built for driving a fleet of [Claude Code](https://claude.com/claude-code) sessions doing parallel work.

Every session is also exposed to a parent Claude over MCP, so an orchestrator agent can spawn workers, watch their status, steer them, and reap them as ordinary tool calls.

> Personal project, developed in the open. Windows x64 and macOS (Apple silicon).

## What it does

- **Many sessions, one window.** A sidebar of live sessions grouped by repo, each with its own terminal and a docked shell underneath for your own manual work.
- **Status at a glance.** Sessions are marked *working*, *awaiting you*, *idle*, or *failed*, read from Claude Code's own session file rather than guessed from terminal output.
- **Tells you when it needs you.** A session that blocks on a permission prompt raises an OS notification and a dock badge / taskbar flash. Clicking through takes you straight to that session.
- **Orchestration over MCP.** A parent Claude can `open_session`, `send_input`, `read_output`, `list_sessions`, `get_session_status`, and `close_session`.
- **Multiple runtimes.** Claude Code, the OpenAI Codex CLI, the Gemini CLI, or a plain shell.
- **PR and token tracking.** Per-session branch/PR state with CI status, plus context-window and cumulative token usage read from session transcripts.

## Install

Grab the latest build from [Releases](../../releases).

| Platform | File |
| --- | --- |
| Windows | `TermHub-<version>-x64-setup.exe`, or `-portable.exe` for no-install |
| macOS (Apple silicon) | `TermHub-<version>-arm64.dmg` |

### macOS: first launch

Builds are **not signed with an Apple Developer ID and not notarized**, so Gatekeeper refuses the first launch. After dragging TermHub to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/TermHub.app
```

### Windows

The installer is unsigned, so SmartScreen warns on first run — choose **More info** → **Run anyway**.

## Build from source

Requires Node 22 (matching the Node that Electron 39 bundles).

```bash
npm install
npm run dev
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite on :5173 + Electron with HMR — the dev loop |
| `npm test` | Vitest |
| `npm run typecheck` | Both tsconfigs (renderer + electron) |
| `npm run build` | Bundles main, bridge, and renderer into `dist/` |
| `npm run dist:win` / `npm run dist:mac` | Packages installers into `release/` |

## Configuration

Settings live in `config.json` under Electron's userData directory. The gear icon in the title bar opens it in your default editor; there's no settings UI yet.

| Path | |
| --- | --- |
| Windows | `%APPDATA%\termhub\config.json` |
| macOS | `~/Library/Application Support/termhub/config.json` |

```jsonc
{
  // Port for the internal MCP endpoint. Dev builds use 7788 so they can run
  // alongside a packaged instance on 7787.
  "mcpPort": 7787,

  // Sessions spawned at startup.
  "startupSessions": [
    {
      "cwd": "/Users/you",
      "command": "claude",
      "agent": "orchestrator",
      "permissionMode": "bypassPermissions",
      "name": "orchestrator"
    }
  ]
}
```

Dev builds keep their own userData directory (`termhub-dev`), so running `npm run dev` won't disturb an installed copy's sessions or config.

Alongside `config.json`, termhub writes:

- `sessions.json` — session metadata for resume-on-restart
- `mcp-config.json` — the MCP server definition for claude to load (`0600`)
- `mcp-token` — shared secret for the internal endpoint (`0600`)

## Connecting the MCP server

termhub writes an MCP server definition to `mcp-config.json` in its userData directory on every launch. Point claude at it:

```bash
claude --mcp-config "$HOME/Library/Application Support/termhub/mcp-config.json"
```

The internal HTTP endpoint binds `127.0.0.1` **and** requires a shared secret, which termhub places in the bridge's environment. Other local processes can't spawn sessions through it.

## Architecture

Three processes:

- **Main** — owns the PTYs, persists sessions, serves the authenticated internal HTTP endpoint.
- **Renderer** — React + xterm.js, talks to main through a preload-injected `window.termhub`.
- **MCP bridge** — a standalone Node subprocess that claude spawns as a stdio MCP server; forwards tool calls to main over HTTP.

`src/types.ts` is the contract between all three. See [CLAUDE.md](CLAUDE.md) for the full developer orientation.

## License

MIT — see [LICENSE](LICENSE).
