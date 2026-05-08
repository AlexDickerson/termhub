import { describe, it, expect } from 'vitest'
import { openExternalUrl, parseLSHandlerBundleId } from './opener'

describe('openExternalUrl', () => {
  it('macOS routes through openCmd with the exact URL', () => {
    const openCmdUrls: string[] = []
    openExternalUrl('https://example.com', {
      platform: 'darwin',
      openCmd: (url) => { openCmdUrls.push(url) },
      electronOpen: () => Promise.resolve(''),
      defaultsBundleIdLookup: () => null,
    })
    expect(openCmdUrls).toEqual(['https://example.com'])
  })

  it('Windows routes through electronOpen with the exact URL', () => {
    const electronUrls: string[] = []
    openExternalUrl('https://example.com', {
      platform: 'win32',
      openCmd: () => {},
      electronOpen: (url) => { electronUrls.push(url); return Promise.resolve('') },
    })
    expect(electronUrls).toEqual(['https://example.com'])
  })

  it('Linux routes through electronOpen with the exact URL', () => {
    const electronUrls: string[] = []
    openExternalUrl('https://example.com', {
      platform: 'linux',
      openCmd: () => {},
      electronOpen: (url) => { electronUrls.push(url); return Promise.resolve('') },
    })
    expect(electronUrls).toEqual(['https://example.com'])
  })

  it('macOS does not call electronOpen', () => {
    let electronCalled = false
    openExternalUrl('https://example.com', {
      platform: 'darwin',
      openCmd: () => {},
      electronOpen: () => { electronCalled = true; return Promise.resolve('') },
      defaultsBundleIdLookup: () => null,
    })
    expect(electronCalled).toBe(false)
  })

  it('Windows does not call openCmd', () => {
    let openCmdCalled = false
    openExternalUrl('https://example.com', {
      platform: 'win32',
      openCmd: () => { openCmdCalled = true },
      electronOpen: () => Promise.resolve(''),
    })
    expect(openCmdCalled).toBe(false)
  })

  it('Linux does not call openCmd', () => {
    let openCmdCalled = false
    openExternalUrl('https://example.com', {
      platform: 'linux',
      openCmd: () => { openCmdCalled = true },
      electronOpen: () => Promise.resolve(''),
    })
    expect(openCmdCalled).toBe(false)
  })

  it('macOS passes bundle ID to openCmd when lookup succeeds', () => {
    const calls: Array<[string, string | null]> = []
    openExternalUrl('https://example.com', {
      platform: 'darwin',
      openCmd: (url, bundleId) => { calls.push([url, bundleId]) },
      electronOpen: () => Promise.resolve(''),
      defaultsBundleIdLookup: () => 'org.mozilla.firefox',
    })
    expect(calls).toEqual([['https://example.com', 'org.mozilla.firefox']])
  })

  it('macOS passes null bundle ID to openCmd when lookup returns null', () => {
    const calls: Array<[string, string | null]> = []
    openExternalUrl('https://example.com', {
      platform: 'darwin',
      openCmd: (url, bundleId) => { calls.push([url, bundleId]) },
      electronOpen: () => Promise.resolve(''),
      defaultsBundleIdLookup: () => null,
    })
    expect(calls).toEqual([['https://example.com', null]])
  })

  it('macOS looks up https scheme for https URLs', () => {
    const schemes: string[] = []
    openExternalUrl('https://example.com', {
      platform: 'darwin',
      openCmd: () => {},
      electronOpen: () => Promise.resolve(''),
      defaultsBundleIdLookup: (scheme) => { schemes.push(scheme); return null },
    })
    expect(schemes).toEqual(['https'])
  })

  it('macOS looks up http scheme for http URLs', () => {
    const schemes: string[] = []
    openExternalUrl('http://example.com', {
      platform: 'darwin',
      openCmd: () => {},
      electronOpen: () => Promise.resolve(''),
      defaultsBundleIdLookup: (scheme) => { schemes.push(scheme); return null },
    })
    expect(schemes).toEqual(['http'])
  })

  it('macOS skips bundle ID lookup for non-http schemes', () => {
    let lookupCalled = false
    openExternalUrl('file:///some/path', {
      platform: 'darwin',
      openCmd: () => {},
      electronOpen: () => Promise.resolve(''),
      defaultsBundleIdLookup: () => { lookupCalled = true; return null },
    })
    expect(lookupCalled).toBe(false)
  })
})

describe('parseLSHandlerBundleId', () => {
  const sampleOutput = `(
    {
        LSHandlerContentTag = "public.html";
        LSHandlerContentTagClass = "public.filename-extension";
        LSHandlerRoleAll = "org.mozilla.firefox";
        LSHandlerURLScheme = "";
    },
    {
        LSHandlerRoleAll = "org.mozilla.firefox";
        LSHandlerURLScheme = "http";
    },
    {
        LSHandlerRoleAll = "org.mozilla.firefox";
        LSHandlerURLScheme = "https";
    },
)`

  it('extracts bundle ID for https scheme', () => {
    expect(parseLSHandlerBundleId(sampleOutput, 'https')).toBe('org.mozilla.firefox')
  })

  it('extracts bundle ID for http scheme', () => {
    expect(parseLSHandlerBundleId(sampleOutput, 'http')).toBe('org.mozilla.firefox')
  })

  it('returns null when scheme not present', () => {
    expect(parseLSHandlerBundleId(sampleOutput, 'ftp')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseLSHandlerBundleId('', 'https')).toBeNull()
  })

  it('returns null when LSHandlerRoleAll is missing for the matching block', () => {
    const output = `(
    {
        LSHandlerURLScheme = "https";
    },
)`
    expect(parseLSHandlerBundleId(output, 'https')).toBeNull()
  })

  it('picks the entry whose LSHandlerURLScheme matches exactly', () => {
    const output = `(
    {
        LSHandlerRoleAll = "com.apple.safari";
        LSHandlerURLScheme = "http";
    },
    {
        LSHandlerRoleAll = "org.mozilla.firefox";
        LSHandlerURLScheme = "https";
    },
)`
    expect(parseLSHandlerBundleId(output, 'https')).toBe('org.mozilla.firefox')
    expect(parseLSHandlerBundleId(output, 'http')).toBe('com.apple.safari')
  })
})
