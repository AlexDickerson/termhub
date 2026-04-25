// Tests for electron/mcp.ts — focuses on the sanitized error-response contract
// (CodeQL js/stack-trace-exposure: error details must not reach the caller).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { startMcpServer, type McpHooks } from './mcp'
import { MCP_ROUTES } from './mcp-routes'

const BASE_PORT = 19_876

function makeHooks(overrides: Partial<McpHooks> = {}): McpHooks {
  return {
    openClaudeSession: () => ({ id: 'test-id', cwd: '/tmp' }),
    sendInput: () => ({ ok: true }),
    readOutput: () => ({ text: 'output' }),
    ...overrides,
  }
}

async function post(port: number, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, json }
}

describe('mcp HTTP server — error sanitization', () => {
  let port = BASE_PORT
  let close: () => Promise<void>

  beforeEach(async () => {
    port += 1
  })

  afterEach(async () => {
    await close?.()
  })

  // ── open_session ──────────────────────────────────────────────────────────

  it('open_session: hook throws — response contains no stack trace', async () => {
    const err = new Error('internal failure: file not found at /secrets/key.pem')
    err.stack = `Error: internal failure: file not found at /secrets/key.pem\n    at /home/user/app/electron/main.ts:123:7\n    at process.nextTick`

    const handle = await startMcpServer({
      port,
      hooks: makeHooks({
        openClaudeSession: () => { throw err },
      }),
    })
    close = handle.close

    const { status, json } = await post(port, MCP_ROUTES.OPEN_SESSION, { cwd: '/tmp' })

    expect(status).toBe(500)
    const body = JSON.stringify(json)
    // Must not expose stack frames
    expect(body).not.toContain('at /')
    expect(body).not.toContain('.ts:')
    expect(body).not.toContain('main.ts')
    // Must not expose the raw error message (which contains a file path here)
    expect(body).not.toContain('/secrets/key.pem')
    // Must include a generic error key
    expect((json as { error: string }).error).toBe('open_session_failed')
  })

  it('open_session: malformed JSON body — response contains no stack trace', async () => {
    const handle = await startMcpServer({ port, hooks: makeHooks() })
    close = handle.close

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.OPEN_SESSION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json !!!',
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    const body = JSON.stringify(json)
    expect(body).not.toContain('at /')
    expect(body).not.toContain('SyntaxError')
    expect((json as { error: string }).error).toBe('invalid_json')
  })

  // ── send_input ────────────────────────────────────────────────────────────

  it('send_input: malformed JSON body — response contains no stack trace', async () => {
    const handle = await startMcpServer({ port, hooks: makeHooks() })
    close = handle.close

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.SEND_INPUT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '<<bad>>',
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    const body = JSON.stringify(json)
    expect(body).not.toContain('at /')
    expect(body).not.toContain('SyntaxError')
    expect((json as { error: string }).error).toBe('invalid_json')
  })

  // ── read_output ───────────────────────────────────────────────────────────

  it('read_output: malformed JSON body — response contains no stack trace', async () => {
    const handle = await startMcpServer({ port, hooks: makeHooks() })
    close = handle.close

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.READ_OUTPUT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    const body = JSON.stringify(json)
    expect(body).not.toContain('at /')
    expect(body).not.toContain('SyntaxError')
    expect((json as { error: string }).error).toBe('invalid_json')
  })

  // ── regression: happy paths still work ───────────────────────────────────

  it('open_session: valid request returns session id', async () => {
    const handle = await startMcpServer({ port, hooks: makeHooks() })
    close = handle.close

    const { status, json } = await post(port, MCP_ROUTES.OPEN_SESSION, { cwd: '/tmp' })
    expect(status).toBe(200)
    expect((json as { id: string }).id).toBe('test-id')
  })
})
