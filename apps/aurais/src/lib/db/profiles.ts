import { createClient } from '@/lib/supabase/server'
import type { Profile, UpdateProfileInput } from './types'

/**
 * Get the current user's profile. Returns null if not found.
 */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error || !data) return null
  return data as Profile
}

/**
 * Ensure a profile exists for the current user.
 * Called after OAuth/email signup to handle the case where the DB trigger
 * hasn't fired yet or the user signed up before the trigger was created.
 */
export async function getOrCreateProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Try to get existing profile
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (existing) return existing as Profile

  // Create profile if missing (idempotent via ON CONFLICT in trigger,
  // but this covers the case where trigger doesn't exist yet)
  const { data: created, error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? null,
      email: user.email ?? null,
      plan: user.user_metadata?.plan ?? 'core',
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create profile:', error.message)
    return null
  }

  return created as Profile
}

/**
 * Update the current user's profile.
 */
export async function updateProfile(input: UpdateProfileInput): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('profiles')
    .update(input)
    .eq('id', user.id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update profile:', error.message)
    return null
  }

  return data as Profile
}
