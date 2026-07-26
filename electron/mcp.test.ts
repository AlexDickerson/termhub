// Tests for electron/mcp.ts — focuses on the sanitized error-response contract
// (CodeQL js/stack-trace-exposure: error details must not reach the caller).

import { describe, it, expect, afterEach } from 'vitest'
import { startMcpServer, type McpHooks, type SessionSummary } from './mcp'
import { MCP_ROUTES } from './mcp-routes'
import { MCP_TOKEN_HEADER } from './mcp-auth'

// Port 0 asks the OS for a free port; startMcpServer reports the real one back
// on the handle. Fixed ports used to collide when more than one copy of this
// suite ran at once (e.g. a stale worktree checkout) or when a dev instance of
// termhub was already listening.
const EPHEMERAL = 0

const TOKEN = 'test-token-0123456789abcdef'

const SESSION: SessionSummary = {
  id: 'sess-1',
  name: 'worker',
  cwd: '/tmp/repo',
  cli: 'claude',
  status: 'awaiting',
  model: 'claude-opus-5',
  permissionMode: 'plan',
}

function makeHooks(overrides: Partial<McpHooks> = {}): McpHooks {
  return {
    openClaudeSession: () => ({ id: 'test-id', cwd: '/tmp' }),
    sendInput: () => ({ ok: true }),
    readOutput: () => ({ text: 'output' }),
    listSessions: () => ({ sessions: [SESSION] }),
    getSessionStatus: () => ({ session: SESSION }),
    closeSession: () => ({ ok: true }),
    ...overrides,
  }
}

async function post(port: number, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [MCP_TOKEN_HEADER]: TOKEN },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return { status: res.status, json }
}

describe('mcp HTTP server — error sanitization', () => {
  let port: number
  let close: () => Promise<void>

  // Each test stands up its own server via start(); these hold the most
  // recent one so afterEach can tear it down.
  async function start(hooks: McpHooks) {
    const handle = await startMcpServer({ port: EPHEMERAL, token: TOKEN, hooks })
    port = handle.port
    close = handle.close
    return handle
  }

  afterEach(async () => {
    await close?.()
  })

  // ── open_session ──────────────────────────────────────────────────────────

  it('open_session: hook throws — response contains no stack trace', async () => {
    const err = new Error('internal failure: file not found at /secrets/key.pem')
    err.stack = `Error: internal failure: file not found at /secrets/key.pem\n    at /home/user/app/electron/main.ts:123:7\n    at process.nextTick`

    await start(makeHooks({
      openClaudeSession: () => { throw err },
    }))

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
    await start(makeHooks())

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.OPEN_SESSION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [MCP_TOKEN_HEADER]: TOKEN },
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
    await start(makeHooks())

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.SEND_INPUT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [MCP_TOKEN_HEADER]: TOKEN },
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
    await start(makeHooks())

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.READ_OUTPUT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [MCP_TOKEN_HEADER]: TOKEN },
      body: 'not-json',
    })
    const json = await res.json()

    expect(res.status).toBe(400)
    const body = JSON.stringify(json)
    expect(body).not.toContain('at /')
    expect(body).not.toContain('SyntaxError')
    expect((json as { error: string }).error).toBe('invalid_json')
  })

  // ── list_sessions / session_status / close_session ───────────────────────

  it('list_sessions returns every session, including ones the caller did not spawn', async () => {
    const others: SessionSummary[] = [
      SESSION,
      { id: 'sess-2', cwd: '/tmp/other', status: 'idle', cli: 'codex' },
    ]
    await start(makeHooks({ listSessions: () => ({ sessions: others }) }))

    const { status, json } = await post(port, MCP_ROUTES.LIST_SESSIONS, {})

    expect(status).toBe(200)
    expect((json as { sessions: SessionSummary[] }).sessions).toEqual(others)
  })

  it('list_sessions returns an empty list rather than erroring when nothing is open', async () => {
    await start(makeHooks({ listSessions: () => ({ sessions: [] }) }))

    const { status, json } = await post(port, MCP_ROUTES.LIST_SESSIONS, {})

    expect(status).toBe(200)
    expect((json as { sessions: SessionSummary[] }).sessions).toEqual([])
  })

  it('session_status surfaces the advisory status for one session', async () => {
    await start(makeHooks())

    const { status, json } = await post(port, MCP_ROUTES.SESSION_STATUS, {
      sessionId: 'sess-1',
    })

    expect(status).toBe(200)
    expect((json as { session: SessionSummary }).session.status).toBe('awaiting')
  })

  it('session_status 400s on an unknown session', async () => {
    await start(makeHooks({ getSessionStatus: () => ({ error: 'No session found for "nope"' }) }))

    const { status, json } = await post(port, MCP_ROUTES.SESSION_STATUS, {
      sessionId: 'nope',
    })

    expect(status).toBe(400)
    expect((json as { error: string }).error).toContain('No session found')
  })

  it('session_status rejects a missing sessionId', async () => {
    await start(makeHooks())

    const { status } = await post(port, MCP_ROUTES.SESSION_STATUS, {})
    expect(status).toBe(400)
  })

  it('close_session reports ok and passes the id through', async () => {
    const closed: string[] = []
    await start(
      makeHooks({
        closeSession: ({ sessionId }) => {
          closed.push(sessionId)
          return { ok: true }
        },
      }),
    )

    const { status } = await post(port, MCP_ROUTES.CLOSE_SESSION, { sessionId: 'sess-1' })

    expect(status).toBe(200)
    expect(closed).toEqual(['sess-1'])
  })

  it('close_session 400s when the session does not resolve', async () => {
    await start(
      makeHooks({ closeSession: () => ({ ok: false, error: 'No session found for "gone"' }) }),
    )

    const { status, json } = await post(port, MCP_ROUTES.CLOSE_SESSION, {
      sessionId: 'gone',
    })

    expect(status).toBe(400)
    expect((json as { error: string }).error).toContain('No session found')
  })

  it('the new routes are authenticated too', async () => {
    await start(makeHooks())

    for (const route of [
      MCP_ROUTES.LIST_SESSIONS,
      MCP_ROUTES.SESSION_STATUS,
      MCP_ROUTES.CLOSE_SESSION,
    ]) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-1' }),
      })
      expect(res.status, `${route} must require auth`).toBe(401)
    }
  })

  // ── auth ─────────────────────────────────────────────────────────────────

  it('rejects a request with no token', async () => {
    let opened = false
    await start(makeHooks({ openClaudeSession: () => { opened = true; return { id: 'x', cwd: '/tmp' } } }))

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.OPEN_SESSION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/tmp' }),
    })

    expect(res.status).toBe(401)
    expect((await res.json() as { error: string }).error).toBe('unauthorized')
    // The hook must not have run — a 401 that still spawned a session would
    // defeat the point of the check.
    expect(opened).toBe(false)
  })

  it('rejects a request with the wrong token', async () => {
    await start(makeHooks())

    const res = await fetch(`http://127.0.0.1:${port}${MCP_ROUTES.OPEN_SESSION}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [MCP_TOKEN_HEADER]: 'not-the-token' },
      body: JSON.stringify({ cwd: '/tmp' }),
    })

    expect(res.status).toBe(401)
  })

  it('authenticates send_input and read_output too, not just open_session', async () => {
    await start(makeHooks())

    for (const route of [MCP_ROUTES.SEND_INPUT, MCP_ROUTES.READ_OUTPUT]) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'a', text: 'b' }),
      })
      expect(res.status, `${route} must require auth`).toBe(401)
    }
  })

  // ── regression: happy paths still work ───────────────────────────────────

  it('open_session: valid request returns session id', async () => {
    await start(makeHooks())

    const { status, json } = await post(port, MCP_ROUTES.OPEN_SESSION, { cwd: '/tmp' })
    expect(status).toBe(200)
    expect((json as { id: string }).id).toBe('test-id')
  })
})
