import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrCreateProfile } from '@/lib/db/profiles'

/**
 * Supabase OAuth callback handler.
 * Exchanges the auth code for a session, then ensures a profile row exists.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Ensure profile exists (handles users created before DB trigger)
      await getOrCreateProfile()
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // If code exchange failed, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
