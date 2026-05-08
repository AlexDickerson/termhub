import { describe, it, expect } from 'vitest'
import { openExternalUrl } from './opener'

describe('openExternalUrl', () => {
  it('macOS routes through openCmd with the exact URL', () => {
    const openCmdUrls: string[] = []
    openExternalUrl('https://example.com', {
      platform: 'darwin',
      openCmd: (url) => { openCmdUrls.push(url) },
      electronOpen: () => Promise.resolve(''),
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
})
