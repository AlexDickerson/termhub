// Route constants for the internal HTTP endpoint that bridges the stdio MCP
// server (electron/mcp-bridge.ts) to the Electron main process (electron/mcp.ts).
//
// Both sides import from here so adding or renaming an endpoint is a single-file
// change. The mcp.test.ts harness imports these too.
export const MCP_ROUTES = {
  OPEN_SESSION: '/internal/open_session',
  SEND_INPUT: '/internal/send_input',
  READ_OUTPUT: '/internal/read_output',
  LIST_SESSIONS: '/internal/list_sessions',
  SESSION_STATUS: '/internal/session_status',
  CLOSE_SESSION: '/internal/close_session',
} as const

export type McpRoute = (typeof MCP_ROUTES)[keyof typeof MCP_ROUTES]
