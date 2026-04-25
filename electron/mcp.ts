// Electron-side HTTP endpoint that the stdio MCP bridge talks to.
// This is intentionally NOT an MCP server — claude never connects here
// directly. The bridge subprocess (electron/mcp-bridge.ts) is the actual
// MCP server, and it forwards tool calls here.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { MCP_ROUTES } from './mcp-routes'

export type OpenSessionResult = { id: string; cwd: string }

export type McpHooks = {
  // Async because the implementation in main.ts serializes spawns and
  // awaits prompt delivery before resolving — keeps simultaneous
  // open_session calls from contending and racing the prompt-paste.
  openClaudeSession: (req: {
    cwd: string
    prompt?: string
    agent?: string
    model?: string
    dangerouslySkipPermissions?: boolean
    allowDangerouslySkipPermissions?: boolean
    permissionMode?: string
    name?: string
    cli?: 'claude' | 'codex'
  }) => Promise<OpenSessionResult> | OpenSessionResult
  sendInput: (req: { sessionId: string; text: string }) => {
    ok: boolean
    error?: string
  }
  readOutput: (req: { sessionId: string; maxChars?: number; raw?: boolean }) => {
    text?: string
    error?: string
  }
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

    if (req.url === MCP_ROUTES.OPEN_SESSION && req.method === 'POST') {
      const body = await readBody(req).catch(() => '')
      let parsed: {
        cwd?: unknown
        prompt?: unknown
        agent?: unknown
        model?: unknown
        dangerouslySkipPermissions?: unknown
        allowDangerouslySkipPermissions?: unknown
        permissionMode?: unknown
        name?: unknown
        cli?: unknown
      }
      try {
        parsed = body ? JSON.parse(body) : {}
      } catch (err) {
        console.warn('[termhub:mcp] open_session: invalid JSON in request body', err)
        respondJson(res, 400, { error: 'invalid_json' })
        return
      }
      if (typeof parsed.cwd !== 'string') {
        respondJson(res, 400, { error: 'cwd must be a string' })
        return
      }
      const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : undefined
      const agent = typeof parsed.agent === 'string' ? parsed.agent : undefined
      const model = typeof parsed.model === 'string' ? parsed.model : undefined
      const dangerouslySkipPermissions =
        typeof parsed.dangerouslySkipPermissions === 'boolean'
          ? parsed.dangerouslySkipPermissions
          : undefined
      const allowDangerouslySkipPermissions =
        typeof parsed.allowDangerouslySkipPermissions === 'boolean'
          ? parsed.allowDangerouslySkipPermissions
          : undefined
      const permissionMode =
        typeof parsed.permissionMode === 'string' ? parsed.permissionMode : undefined
      const name = typeof parsed.name === 'string' ? parsed.name : undefined
      const cli =
        parsed.cli === 'claude' || parsed.cli === 'codex' ? parsed.cli : undefined
      try {
        const result = await opts.hooks.openClaudeSession({
          cwd: parsed.cwd,
          prompt,
          agent,
          model,
          dangerouslySkipPermissions,
          allowDangerouslySkipPermissions,
          permissionMode,
          name,
          cli,
        })
        respondJson(res, 200, result)
      } catch (err) {
        console.error('[termhub:mcp] open_session: hook threw unexpectedly', err)
        respondJson(res, 500, { error: 'open_session_failed' })
      }
      return
    }

    if (req.url === MCP_ROUTES.SEND_INPUT && req.method === 'POST') {
      const body = await readBody(req).catch(() => '')
      let parsed: { sessionId?: unknown; text?: unknown }
      try {
        parsed = body ? JSON.parse(body) : {}
      } catch (err) {
        console.warn('[termhub:mcp] send_input: invalid JSON in request body', err)
        respondJson(res, 400, { error: 'invalid_json' })
        return
      }
      if (typeof parsed.sessionId !== 'string' || typeof parsed.text !== 'string') {
        respondJson(res, 400, { error: 'sessionId and text must be strings' })
        return
      }
      const result = opts.hooks.sendInput({
        sessionId: parsed.sessionId,
        text: parsed.text,
      })
      respondJson(res, result.ok ? 200 : 400, result)
      return
    }

    if (req.url === MCP_ROUTES.READ_OUTPUT && req.method === 'POST') {
      const body = await readBody(req).catch(() => '')
      let parsed: { sessionId?: unknown; maxChars?: unknown; raw?: unknown }
      try {
        parsed = body ? JSON.parse(body) : {}
      } catch (err) {
        console.warn('[termhub:mcp] read_output: invalid JSON in request body', err)
        respondJson(res, 400, { error: 'invalid_json' })
        return
      }
      if (typeof parsed.sessionId !== 'string') {
        respondJson(res, 400, { error: 'sessionId must be a string' })
        return
      }
      const result = opts.hooks.readOutput({
        sessionId: parsed.sessionId,
        maxChars:
          typeof parsed.maxChars === 'number' ? parsed.maxChars : undefined,
        raw: typeof parsed.raw === 'boolean' ? parsed.raw : undefined,
      })
      respondJson(res, result.error ? 400 : 200, result)
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
  console.log(`[termhub:mcp] internal HTTP API listening on ${url}${MCP_ROUTES.OPEN_SESSION}`)

  return {
    port: opts.port,
    url,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}
