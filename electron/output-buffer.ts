// Rolling output buffer + ANSI stripper used by the MCP read_output surface.
// Sized so a busy agent session has plenty of recent context for the
// orchestrator without blowing memory.

export const MAX_OUTPUT_BUFFER_BYTES = 256 * 1024

// Append `chunk` to `buf` and trim from the front so the result never exceeds
// MAX_OUTPUT_BUFFER_BYTES. The buffer is character-counted (string length),
// not byte-counted — close enough for read_output's use.
export function appendToBuffer(buf: string, chunk: string): string {
  const combined = buf + chunk
  if (combined.length <= MAX_OUTPUT_BUFFER_BYTES) return combined
  return combined.slice(combined.length - MAX_OUTPUT_BUFFER_BYTES)
}

// Lossy but adequate ANSI/control-char stripper for read_output. Captures
// CSI/OSC/DCS sequences and stray control bytes; doesn't replay cursor
// movement, so heavy TUI output (e.g. claude's input box) won't reconstruct
// perfectly — but plain text and message bodies come through cleanly.
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b[=>()*+\-.\/]./g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}
