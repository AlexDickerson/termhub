// termhub MCP stdio bridge
//
// Claude Code spawns this script as a stdio MCP server. The script implements
// the MCP protocol over stdin/stdout (no HTTP, no auth) and delegates each
// `open_session` tool call to the running Electron main process via a small
// local HTTP endpoint. The Electron app, not this bridge, actually owns the
// pty sessions.
//
// The TERMHUB_PORT env var (set when the bridge is spawned) tells us where
// the Electron app is listening.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { MCP_ROUTES } from './mcp-routes'
import { MCP_TOKEN_HEADER } from './mcp-auth'
import type { SessionSummary } from './mcp'

const port = Number.parseInt(process.env.TERMHUB_PORT ?? '7787', 10)
const baseUrl = `http://127.0.0.1:${port}`

// Set by termhub when it writes mcp-config.json (see writeMcpConfigFile in
// electron/main.ts). Without it every /internal/* call comes back 401 — that
// is the intended failure mode for anything that isn't the bridge termhub
// itself configured.
const token = process.env.TERMHUB_TOKEN ?? ''

const jsonHeaders = {
  'Content-Type': 'application/json',
  [MCP_TOKEN_HEADER]: token,
}

// One line per session. Kept terse on purpose: an orchestrator polling a dozen
// workers pays for every token, and the id + status + name are what it acts on.
export function formatSession(s: SessionSummary): string {
  const bits = [`${s.id}  [${s.status}]`]
  if (s.name) bits.push(s.name)
  bits.push(s.cwd)
  const meta = [s.cli, s.model, s.permissionMode].filter(Boolean)
  if (meta.length > 0) bits.push(`(${meta.join(', ')})`)
  return bits.join('  ')
}

async function main() {
  const server = new McpServer({
    name: 'termhub',
    version: '0.1.0',
  })

  server.registerTool(
    'open_session',
    {
      title: 'Open a new termhub terminal session',
      description:
        'Spawns a new terminal in termhub running `claude` (Claude Code) or `codex` (OpenAI Codex CLI). ' +
        'Use `cli: "codex"` to spawn a Codex session; omit or set `cli: "claude"` (default) for Claude Code. ' +
        'Provide an absolute working directory and an optional initial prompt. ' +
        'For Claude Code: the prompt is delivered as the first user message once the TUI boots. ' +
        'For Codex: the prompt is passed as a CLI argument at launch. ' +
        'To start in plan mode but allow flipping to bypass later (without restarting), use ' +
        'permissionMode: "plan" together with allowDangerouslySkipPermissions: true (Claude only).',
      inputSchema: {
        cwd: z
          .string()
          .describe('Absolute working directory for the new session (e.g. "E:/projects/foo")'),
        prompt: z
          .string()
          .optional()
          .describe('Initial prompt to feed to the new Claude session as its first user message'),
        agent: z
          .string()
          .optional()
          .describe(
            'Name of an agent definition (filename in ~/.claude/agents/ without .md). ' +
              'Passed to claude as --agent so the new session adopts that role.',
          ),
        model: z
          .string()
          .optional()
          .describe(
            'Model to use for the new session, e.g. "claude-opus-4-7" or "claude-sonnet-4-6". ' +
              'Passed to claude as --model. Omit to use the user\'s default.',
          ),
        dangerouslySkipPermissions: z
          .boolean()
          .optional()
          .describe(
            'When true, passes --dangerously-skip-permissions to claude, bypassing all per-tool ' +
              'approval prompts. Use only for autonomous workers where you trust the prompt and ' +
              'agent definition; the worker can take any action without confirmation.',
          ),
        allowDangerouslySkipPermissions: z
          .boolean()
          .optional()
          .describe(
            'When true, passes --allow-dangerously-skip-permissions to claude. This adds ' +
              'bypassPermissions to the shift+tab cycle without activating it immediately, so ' +
              'the user or operator can flip into bypass mode mid-session without restarting. ' +
              'Useful when starting in plan mode but wanting the option to escalate later. ' +
              'Independent of dangerouslySkipPermissions; if both are true, ' +
              'dangerouslySkipPermissions takes precedence.',
          ),
        permissionMode: z
          .enum([
            'acceptEdits',
            'auto',
            'bypassPermissions',
            'default',
            'dontAsk',
            'plan',
          ])
          .optional()
          .describe(
            'Permission mode for the new session — passed to claude as --permission-mode. ' +
              "Use 'bypassPermissions' for autonomous workers, 'plan' for read-only planning, " +
              "or 'default' to prompt on every action. 'auto' requires a sandbox runtime.",
          ),
        name: z
          .string()
          .optional()
          .describe(
            'Display name for the session, shown in the termhub sidebar. ' +
              'Falls back to the cwd basename when omitted.',
          ),
        cli: z
          .enum(['claude', 'codex', 'gemini'])
          .optional()
          .describe(
            'CLI runtime to use. "claude" (default) spawns Claude Code; ' +
              '"codex" spawns the OpenAI Codex CLI; ' +
              '"gemini" spawns the Gemini CLI. ' +
              'When using "codex" or "gemini", pass a compatible model — ' +
              'passing a Claude model name with a non-claude cli is a configuration error. ' +
              'The agent, permissionMode, and allowDangerouslySkipPermissions fields ' +
              'are Claude-specific and are ignored for codex and gemini.',
          ),
      },
    },
    async (args) => {
      try {
        const response = await fetch(`${baseUrl}${MCP_ROUTES.OPEN_SESSION}`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            cwd: args.cwd,
            prompt: args.prompt,
            agent: args.agent,
            model: args.model,
            dangerouslySkipPermissions: args.dangerouslySkipPermissions,
            allowDangerouslySkipPermissions: args.allowDangerouslySkipPermissions,
            permissionMode: args.permissionMode,
            name: args.name,
            cli: args.cli,
          }),
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          return {
            content: [
              {
                type: 'text',
                text: `Failed to open session: HTTP ${response.status} ${text}`,
              },
            ],
            isError: true,
          }
        }
        const result = (await response.json()) as { id: string; cwd: string }
        return {
          content: [
            {
              type: 'text',
              text: `Opened session ${result.id} in ${result.cwd}`,
            },
          ],
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [
            { type: 'text', text: `Failed to reach termhub at ${baseUrl}: ${msg}` },
          ],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'send_input',
    {
      title: 'Send input to a running termhub session',
      description:
        'Writes text to the pty of an existing session, as if the user typed it. ' +
        "Trailing Enter is added automatically. Newlines in `text` are flattened to " +
        'spaces — for multi-line content, send multiple calls or paste-style input.',
      inputSchema: {
        sessionId: z
          .string()
          .describe('Full session id (or unambiguous prefix) returned by open_session'),
        text: z.string().describe('Text to send to the session'),
      },
    },
    async (args) => {
      try {
        const response = await fetch(`${baseUrl}${MCP_ROUTES.SEND_INPUT}`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ sessionId: args.sessionId, text: args.text }),
        })
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
        }
        if (!response.ok || !json.ok) {
          return {
            content: [
              { type: 'text', text: `Failed: ${json.error ?? `HTTP ${response.status}`}` },
            ],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: `Sent to ${args.sessionId}.` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Failed to reach termhub: ${msg}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'read_output',
    {
      title: 'Read recent output from a termhub session',
      description:
        'Returns the most recent output buffered for a session (rolling, last ~256KB). ' +
        'ANSI escape sequences are stripped by default for readability; pass raw: true to ' +
        'get the original byte stream.',
      inputSchema: {
        sessionId: z
          .string()
          .describe('Full session id (or unambiguous prefix) returned by open_session'),
        maxChars: z
          .number()
          .optional()
          .describe('Cap on returned characters (returns the most recent)'),
        raw: z
          .boolean()
          .optional()
          .describe('If true, return raw output including ANSI escape codes'),
      },
    },
    async (args) => {
      try {
        const response = await fetch(`${baseUrl}${MCP_ROUTES.READ_OUTPUT}`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            sessionId: args.sessionId,
            maxChars: args.maxChars,
            raw: args.raw,
          }),
        })
        const json = (await response.json().catch(() => ({}))) as {
          text?: string
          error?: string
        }
        if (json.error) {
          return {
            content: [{ type: 'text', text: `Failed: ${json.error}` }],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text', text: json.text ?? '(no output)' }],
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Failed to reach termhub: ${msg}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'list_sessions',
    {
      title: 'List all termhub sessions',
      description:
        'Returns every session termhub currently has open — including ones this ' +
        'orchestrator did not spawn, and ones resumed from a previous run. Each entry ' +
        'carries id, name, cwd, cli, model, permissionMode and current status. ' +
        'Use this to recover session ids after a restart, or to survey what is running ' +
        'before deciding what to steer.',
      inputSchema: {},
    },
    async () => {
      try {
        const response = await fetch(`${baseUrl}${MCP_ROUTES.LIST_SESSIONS}`, {
          method: 'POST',
          headers: jsonHeaders,
        })
        const json = (await response.json().catch(() => ({}))) as {
          sessions?: SessionSummary[]
          error?: string
        }
        if (!response.ok || json.error) {
          return {
            content: [
              { type: 'text', text: `Failed: ${json.error ?? `HTTP ${response.status}`}` },
            ],
            isError: true,
          }
        }
        const sessions = json.sessions ?? []
        if (sessions.length === 0) {
          return { content: [{ type: 'text', text: 'No sessions open.' }] }
        }
        return {
          content: [
            {
              type: 'text',
              text: sessions.map(formatSession).join('\n'),
            },
          ],
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Failed to reach termhub: ${msg}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'get_session_status',
    {
      title: 'Get the current status of a termhub session',
      description:
        'Returns the advisory status of one session without pulling its output. ' +
        "Values: 'working' (generating or running tools), 'awaiting' (paused for a " +
        "permission prompt or question — needs you), 'idle' (at the input prompt, " +
        "ready for the next message), 'failed' (process died non-zero). " +
        'Prefer this over polling read_output and guessing from the text. ' +
        'Status is sourced from Claude Code\'s own session file, so it is only ' +
        "meaningful for cli: 'claude' sessions.",
      inputSchema: {
        sessionId: z
          .string()
          .describe('Full session id (or unambiguous prefix) returned by open_session'),
      },
    },
    async (args) => {
      try {
        const response = await fetch(`${baseUrl}${MCP_ROUTES.SESSION_STATUS}`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ sessionId: args.sessionId }),
        })
        const json = (await response.json().catch(() => ({}))) as {
          session?: SessionSummary
          error?: string
        }
        if (!response.ok || json.error || !json.session) {
          return {
            content: [
              { type: 'text', text: `Failed: ${json.error ?? `HTTP ${response.status}`}` },
            ],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: formatSession(json.session) }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Failed to reach termhub: ${msg}` }],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    'close_session',
    {
      title: 'Close a termhub session',
      description:
        'Terminates a session and removes it from the sidebar. Kills the underlying ' +
        'CLI process and the session\'s docked shell. This is not reversible — the ' +
        'session is gone, though claude can be resumed later in the same directory. ' +
        'Use it to reap finished workers so the sidebar reflects live work.',
      inputSchema: {
        sessionId: z
          .string()
          .describe('Full session id (or unambiguous prefix) returned by open_session'),
      },
    },
    async (args) => {
      try {
        const response = await fetch(`${baseUrl}${MCP_ROUTES.CLOSE_SESSION}`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ sessionId: args.sessionId }),
        })
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
        }
        if (!response.ok || !json.ok) {
          return {
            content: [
              { type: 'text', text: `Failed: ${json.error ?? `HTTP ${response.status}`}` },
            ],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: `Closed session ${args.sessionId}.` }] }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Failed to reach termhub: ${msg}` }],
          isError: true,
        }
      }
    },
  )

  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  // Stderr is fine — claude reads stdout for MCP messages
  console.error('[termhub-bridge] fatal:', err)
  process.exit(1)
})
