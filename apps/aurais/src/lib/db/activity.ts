import { createClient } from '@/lib/supabase/server'
import type { ActivityLogEntry } from './types'

/**
 * List recent activity for the current user, ordered newest first.
 */
export async function listActivity(limit = 50): Promise<ActivityLogEntry[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Failed to list activity:', error.message)
    return []
  }

  return (data ?? []) as ActivityLogEntry[]
}

/**
 * Get activity stats for the current user (last 24h).
 */
export async function getActivityStats(): Promise<{
  total: number
  byAction: Record<string, number>
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { total: 0, byAction: {} }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('activity_log')
    .select('action')
    .eq('user_id', user.id)
    .gte('created_at', since)

  if (error || !data) return { total: 0, byAction: {} }

  const byAction: Record<string, number> = {}
  for (const row of data) {
    byAction[row.action] = (byAction[row.action] ?? 0) + 1
  }

  return { total: data.length, byAction }
}
