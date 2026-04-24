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

const port = Number.parseInt(process.env.TERMHUB_PORT ?? '7787', 10)
const baseUrl = `http://127.0.0.1:${port}`

async function main() {
  const server = new McpServer({
    name: 'termhub',
    version: '0.1.0',
  })

  server.registerTool(
    'open_session',
    {
      title: 'Open a new termhub terminal running Claude',
      description:
        'Spawns a new terminal in termhub running `claude` (an interactive Claude Code session). ' +
        'Use this to delegate work to a sub-agent. Provide an absolute working directory and an ' +
        'optional initial prompt that the new claude will receive as its first user message.',
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
            'Name of an agent definition (filename in ~/.claude/agents/ without .md). When provided, ' +
              "the agent's system prompt is prepended to the first user message so the new session adopts that role.",
          ),
      },
    },
    async (args) => {
      try {
        const response = await fetch(`${baseUrl}/internal/open_session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: args.cwd, prompt: args.prompt, agent: args.agent }),
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
              text: `Opened session ${result.id.slice(0, 8)} in ${result.cwd}`,
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

  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  // Stderr is fine — claude reads stdout for MCP messages
  console.error('[termhub-bridge] fatal:', err)
  process.exit(1)
})
