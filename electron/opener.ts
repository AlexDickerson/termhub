import { spawn } from 'node:child_process'

export type OpenCmdRunner = (url: string) => void
export type ElectronOpenRunner = (url: string) => Promise<string>

export interface OpenerDeps {
  platform?: NodeJS.Platform
  openCmd?: OpenCmdRunner
  electronOpen?: ElectronOpenRunner
}

export function openExternalUrl(url: string, deps?: OpenerDeps): void {
  const platform = deps?.platform ?? process.platform
  const openCmd = deps?.openCmd ?? spawnOpen
  const electronOpen = deps?.electronOpen ?? defaultElectronOpen

  console.log('[termhub:links] opening', url)

  if (platform === 'darwin') {
    openCmd(url)
  } else {
    electronOpen(url)
  }
}

function spawnOpen(url: string): void {
  const proc = spawn('/usr/bin/open', [url], {
    detached: true,
    stdio: 'ignore',
  })
  proc.unref()
}

function defaultElectronOpen(url: string): Promise<string> {
  const { shell } = require('electron') as { shell: { openExternal: (url: string) => Promise<string> } }
  return shell.openExternal(url)
}
