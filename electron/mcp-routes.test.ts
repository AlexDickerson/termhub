import { describe, it, expect } from 'vitest'
import { MCP_ROUTES } from './mcp-routes'

// These constants are the wire contract between the stdio bridge and the
// internal HTTP server. Pinning the values guards against accidental renames
// that would silently break the bridge until the next end-to-end test.
describe('MCP_ROUTES', () => {
  it('uses the expected /internal/ paths', () => {
    expect(MCP_ROUTES.OPEN_SESSION).toBe('/internal/open_session')
    expect(MCP_ROUTES.SEND_INPUT).toBe('/internal/send_input')
    expect(MCP_ROUTES.READ_OUTPUT).toBe('/internal/read_output')
  })

  it('routes are unique', () => {
    const values = Object.values(MCP_ROUTES)
    expect(new Set(values).size).toBe(values.length)
  })
})
