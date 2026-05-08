import { spawn, spawnSync } from 'node:child_process'

export type OpenCmdRunner = (url: string, bundleId: string | null) => void
export type ElectronOpenRunner = (url: string) => Promise<string>
export type DefaultsBundleIdLookup = (scheme: 'https' | 'http') => string | null

export interface OpenerDeps {
  platform?: NodeJS.Platform
  openCmd?: OpenCmdRunner
  electronOpen?: ElectronOpenRunner
  defaultsBundleIdLookup?: DefaultsBundleIdLookup
}

export function openExternalUrl(url: string, deps?: OpenerDeps): void {
  const platform = deps?.platform ?? process.platform
  const openCmd = deps?.openCmd ?? spawnOpen
  const electronOpen = deps?.electronOpen ?? defaultElectronOpen
  const bundleIdLookup = deps?.defaultsBundleIdLookup ?? readDarwinDefaultBrowserBundleId

  console.log('[termhub:links] opening', url)

  if (platform === 'darwin') {
    const scheme = darwinUrlScheme(url)
    const bundleId = scheme ? bundleIdLookup(scheme) : null
    if (bundleId) {
      console.info('[termhub:links] using default browser bundle', bundleId)
    }
    openCmd(url, bundleId)
  } else {
    electronOpen(url)
  }
}

// Exported for unit testing the parsing logic without spawning a subprocess.
export function parseLSHandlerBundleId(output: string, scheme: string): string | null {
  const blockRe = /\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(output)) !== null) {
    const block = match[1]
    const schemeMatch = block.match(/LSHandlerURLScheme\s*=\s*"([^"]*)"/)
    if (!schemeMatch || schemeMatch[1] !== scheme) continue
    const bundleMatch = block.match(/LSHandlerRoleAll\s*=\s*"([^"]*)"/)
    if (bundleMatch?.[1]) return bundleMatch[1]
  }
  return null
}

function darwinUrlScheme(url: string): 'https' | 'http' | null {
  try {
    const scheme = new URL(url).protocol.replace(':', '')
    if (scheme === 'https' || scheme === 'http') return scheme
    return null
  } catch {
    return null
  }
}

function readDarwinDefaultBrowserBundleId(scheme: 'https' | 'http'): string | null {
  try {
    const result = spawnSync(
      '/usr/bin/defaults',
      ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'],
      { encoding: 'utf8', timeout: 2000 },
    )
    if (result.status !== 0 || !result.stdout) return null
    return parseLSHandlerBundleId(result.stdout, scheme)
  } catch {
    return null
  }
}

function spawnOpen(url: string, bundleId: string | null): void {
  const args = bundleId ? ['-b', bundleId, url] : [url]
  const proc = spawn('/usr/bin/open', args, {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
}

function defaultElectronOpen(url: string): Promise<string> {
  const { shell } = require('electron') as { shell: { openExternal: (url: string) => Promise<string> } }
  return shell.openExternal(url)
}
