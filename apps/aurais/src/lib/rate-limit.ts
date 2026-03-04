import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Cleanup stale entries every 60 seconds
let lastCleanup = Date.now()
function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < 60_000) return
  lastCleanup = now
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}

/**
 * Simple in-memory rate limiter for API routes.
 * Returns null if under limit, or a 429 Response if exceeded.
 *
 * For production at scale, replace with Upstash Redis (@upstash/ratelimit).
 */
export function rateLimit(
  request: NextRequest,
  { maxRequests = 5, windowMs = 60_000 }: { maxRequests?: number; windowMs?: number } = {}
): NextResponse | null {
  cleanup()

  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown'
  const key = `${ip}:${request.nextUrl.pathname}`
  const now = Date.now()

  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }

  entry.count++
  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      }
    )
  }

  return null
}
