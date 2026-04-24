// Electron-side HTTP endpoint that the stdio MCP bridge talks to.
// This is intentionally NOT an MCP server — claude never connects here
// directly. The bridge subprocess (electron/mcp-bridge.ts) is the actual
// MCP server, and it forwards tool calls here.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

export type OpenSessionResult = { id: string; cwd: string }

export type McpHooks = {
  openClaudeSession: (req: { cwd: string; prompt?: string }) => OpenSessionResult
}

export type McpHandle = {
  port: number
  url: string
  close: () => Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function respondJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
  })
  res.end(payload)
}

export async function startMcpServer(opts: {
  port: number
  hooks: McpHooks
}): Promise<McpHandle> {
  const httpServer = createServer(async (req, res) => {
    console.log(`[termhub:mcp] ${req.method} ${req.url}`)

    if (
      req.url === '/internal/open_session' &&
      req.method === 'POST'
    ) {
      const body = await readBody(req).catch(() => '')
      let parsed: { cwd?: unknown; prompt?: unknown }
      try {
        parsed = body ? JSON.parse(body) : {}
      } catch (err) {
        respondJson(res, 400, { error: 'invalid_json', detail: String(err) })
        return
      }
      if (typeof parsed.cwd !== 'string') {
        respondJson(res, 400, { error: 'cwd must be a string' })
        return
      }
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : undefined
      try {
        const result = opts.hooks.openClaudeSession({ cwd: parsed.cwd, prompt })
        respondJson(res, 200, result)
      } catch (err) {
        respondJson(res, 500, {
          error: 'open_session_failed',
          detail: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    res.writeHead(404)
    res.end()
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port, '127.0.0.1', () => resolve())
  })

  const url = `http://127.0.0.1:${opts.port}`
  console.log(`[termhub:mcp] internal HTTP API listening on ${url}/internal/open_session`)

  return {
    port: opts.port,
    url,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}
