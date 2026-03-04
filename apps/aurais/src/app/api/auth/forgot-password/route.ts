import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, { maxRequests: 3, windowMs: 60_000 })
  if (limited) return limited

  try {
    const body = await request.json()
    const { email } = body

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.NEXT_PUBLIC_URL}/auth/callback?next=/reset-password`,
    })

    if (error) {
      console.error('Password reset error:', error)
    }

    // Always return success to prevent email enumeration attacks
    return NextResponse.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
