import { describe, it, expect } from 'vitest'
import { isAllowedExternalUrl } from './links'

describe('isAllowedExternalUrl', () => {
  it('allows https URLs', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true)
  })

  it('allows http URLs', () => {
    expect(isAllowedExternalUrl('http://localhost:3000')).toBe(true)
  })

  it('rejects file: URLs', () => {
    expect(isAllowedExternalUrl('file:///c:/windows/system32')).toBe(false)
  })

  it('rejects javascript: URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isAllowedExternalUrl('')).toBe(false)
  })

  it('rejects ftp: URLs', () => {
    expect(isAllowedExternalUrl('ftp://files.example.com')).toBe(false)
  })
})
