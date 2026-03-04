import { describe, it, expect, vi, afterEach } from 'vitest'
import { timeAgo, shortDate } from '@/lib/time'

describe('timeAgo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Never" for null', () => {
    expect(timeAgo(null)).toBe('Never')
  })

  it('returns "Just now" for recent timestamps', () => {
    const now = new Date()
    expect(timeAgo(now)).toBe('Just now')
  })

  it('returns minutes ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:05:00Z'))
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('5 mins ago')
    expect(timeAgo('2026-01-15T12:04:00Z')).toBe('1 min ago')
  })

  it('returns hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T15:00:00Z'))
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('3 hours ago')
    expect(timeAgo('2026-01-15T14:00:00Z')).toBe('1 hour ago')
  })

  it('returns days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-20T12:00:00Z'))
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('5 days ago')
    expect(timeAgo('2026-01-19T12:00:00Z')).toBe('1 day ago')
  })

  it('returns months ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'))
    expect(timeAgo('2026-01-15T12:00:00Z')).toBe('3 months ago')
  })

  it('accepts Date objects', () => {
    const date = new Date(Date.now() - 120_000) // 2 minutes ago
    expect(timeAgo(date)).toBe('2 mins ago')
  })
})

describe('shortDate', () => {
  it('returns dash for null', () => {
    expect(shortDate(null)).toBe('—')
  })

  it('formats date strings correctly', () => {
    const result = shortDate('2026-01-15T12:00:00Z')
    expect(result).toContain('Jan')
    expect(result).toContain('15')
    expect(result).toContain('2026')
  })

  it('accepts Date objects', () => {
    const result = shortDate(new Date('2026-06-01'))
    expect(result).toContain('2026')
  })
})
