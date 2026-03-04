import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateProfile, updateProfile } from '@/lib/db'

/**
 * GET /api/profile — Get the current user's profile
 */
export async function GET() {
  try {
    const profile = await getOrCreateProfile()

    if (!profile) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/profile — Update the current user's profile
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, avatar_url, plan, organization, timezone } = body

    const profile = await updateProfile({
      ...(name !== undefined && { name: name?.trim() }),
      ...(avatar_url !== undefined && { avatar_url }),
      ...(plan !== undefined && { plan }),
      ...(organization !== undefined && { organization: organization?.trim() }),
      ...(timezone !== undefined && { timezone }),
    })

    if (!profile) {
      return NextResponse.json({ error: 'Not authenticated or update failed' }, { status: 401 })
    }

    return NextResponse.json({ profile })
  } catch (error) {
    console.error('Update profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
