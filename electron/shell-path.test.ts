// Regression coverage for the packaged-app PATH bug: a Finder-launched app on
// macOS gets /usr/bin:/bin:/usr/sbin:/sbin, so `claude` installed at
// /opt/homebrew/bin was never found and every session died with
// "command not found: claude".

import { describe, it, expect, vi } from 'vitest'
import {
  extractPathFromShellOutput,
  mergePaths,
  resolveLoginShellPath,
  type ExecFn,
} from './shell-path'

const S = '__TERMHUB_PATH__'
const wrap = (p: string) => `${S}${p}${S}`

describe('extractPathFromShellOutput', () => {
  it('pulls the value from between the sentinels', () => {
    expect(extractPathFromShellOutput(wrap('/opt/homebrew/bin:/usr/bin'))).toBe(
      '/opt/homebrew/bin:/usr/bin',
    )
  })

  it('ignores shell startup noise around the sentinels', () => {
    // A chatty rc file prints banners, motd, or `set -x` traces.
    const out = `Welcome!\n+ some trace\n${wrap('/a:/b')}\nmore noise\n`
    expect(extractPathFromShellOutput(out)).toBe('/a:/b')
  })

  it('preserves paths containing spaces', () => {
    const p = '/Users/alex/Library/Application Support/bin:/usr/bin'
    expect(extractPathFromShellOutput(wrap(p))).toBe(p)
  })

  it('returns null when the sentinel is absent', () => {
    expect(extractPathFromShellOutput('command not found\n')).toBeNull()
  })

  it('returns null when only the opening sentinel is present', () => {
    expect(extractPathFromShellOutput(`${S}/a:/b`)).toBeNull()
  })

  it('returns null when the value is empty or whitespace', () => {
    expect(extractPathFromShellOutput(wrap(''))).toBeNull()
    expect(extractPathFromShellOutput(wrap('   '))).toBeNull()
  })
})

describe('mergePaths', () => {
  it('puts login entries first, then unseen current entries', () => {
    expect(mergePaths('/opt/homebrew/bin:/usr/bin', '/usr/bin:/sbin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/sbin',
    )
  })

  it('deduplicates', () => {
    expect(mergePaths('/a:/b:/a', '/b:/c')).toBe('/a:/b:/c')
  })

  it('drops empty segments from a trailing or doubled colon', () => {
    expect(mergePaths('/a::/b:', '/c')).toBe('/a:/b:/c')
  })

  it('handles an undefined current PATH', () => {
    expect(mergePaths('/a:/b', undefined)).toBe('/a:/b')
  })

  it('never loses an entry Electron had that the login shell lacks', () => {
    const merged = mergePaths('/opt/homebrew/bin', '/some/electron/only/bin')
    expect(merged.split(':')).toContain('/some/electron/only/bin')
  })

  it('recovers the real-world case: homebrew missing from the GUI PATH', () => {
    const guiPath = '/usr/bin:/bin:/usr/sbin:/sbin'
    expect(guiPath).not.toContain('/opt/homebrew/bin')

    const merged = mergePaths('/opt/homebrew/bin:/usr/local/bin:/usr/bin', guiPath)
    expect(merged.split(':')).toContain('/opt/homebrew/bin')
    // and the original entries survive
    for (const p of guiPath.split(':')) expect(merged.split(':')).toContain(p)
  })
})

describe('resolveLoginShellPath', () => {
  const exec = (out: string): ExecFn => () => out

  it('returns the parsed PATH from the login shell', () => {
    const got = resolveLoginShellPath({
      platform: 'darwin',
      shell: '/bin/zsh',
      exec: exec(wrap('/opt/homebrew/bin:/usr/bin')),
    })
    expect(got).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('is a no-op on Windows — GUI processes get PATH from the registry', () => {
    const spy = vi.fn()
    expect(
      resolveLoginShellPath({ platform: 'win32', shell: 'C:/cmd.exe', exec: spy }),
    ).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns null when $SHELL is unset', () => {
    // Stub the env rather than passing shell: undefined — that would fall
    // through to the real process.env.SHELL and exercise nothing.
    vi.stubEnv('SHELL', '')
    const spy = vi.fn()
    expect(resolveLoginShellPath({ platform: 'darwin', exec: spy })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('returns null rather than throwing when the shell fails or times out', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const got = resolveLoginShellPath({
      platform: 'darwin',
      shell: '/bin/zsh',
      exec: () => {
        throw new Error('ETIMEDOUT')
      },
    })
    expect(got).toBeNull()
  })

  it('uses an interactive login shell for zsh — PATH is often set in .zshrc', () => {
    let seen: string[] = []
    resolveLoginShellPath({
      platform: 'darwin',
      shell: '/bin/zsh',
      exec: (_f, args) => {
        seen = args
        return wrap('/a')
      },
    })
    expect(seen[0]).toBe('-ilc')
  })

  it('asks fish to join PATH explicitly — it stores PATH as a list', () => {
    let seen: string[] = []
    resolveLoginShellPath({
      platform: 'darwin',
      shell: '/opt/homebrew/bin/fish',
      exec: (_f, args) => {
        seen = args
        return wrap('/a')
      },
    })
    expect(seen).toContain('-l')
    expect(seen.join(' ')).toContain('string join :')
  })

  it('passes the shell binary through to exec', () => {
    let file = ''
    resolveLoginShellPath({
      platform: 'darwin',
      shell: '/bin/bash',
      exec: (f) => {
        file = f
        return wrap('/a')
      },
    })
    expect(file).toBe('/bin/bash')
  })
})
