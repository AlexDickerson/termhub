// URL allowlist for openExternal — only http/https schemes are permitted.
// file:, javascript:, and other schemes are rejected to prevent local-file
// access or script execution via crafted terminal output.
export function isAllowedExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
