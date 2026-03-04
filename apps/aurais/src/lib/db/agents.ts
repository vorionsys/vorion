import { createClient } from '@/lib/supabase/server'
import type { Agent, CreateAgentInput, UpdateAgentInput } from './types'

/**
 * List all agents for the current user.
 */
export async function listAgents(): Promise<Agent[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to list agents:', error.message)
    return []
  }

  return (data ?? []) as Agent[]
}

/**
 * Get a single agent by ID (must belong to current user via RLS).
 */
export async function getAgent(id: string): Promise<Agent | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as Agent
}

/**
 * Create a new agent for the current user.
 */
export async function createAgent(input: CreateAgentInput): Promise<Agent | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('agents')
    .insert({
      user_id: user.id,
      name: input.name,
      description: input.description ?? null,
      system_prompt: input.system_prompt ?? '',
      model: input.model ?? 'claude-sonnet-4-20250514',
      specialization: input.specialization ?? 'core',
      capabilities: input.capabilities ?? [],
      personality_traits: input.personality_traits ?? [],
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create agent:', error.message)
    return null
  }

  return data as Agent
}

/**
 * Update an agent (must belong to current user via RLS).
 */
export async function updateAgent(id: string, input: UpdateAgentInput): Promise<Agent | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agents')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update agent:', error.message)
    return null
  }

  return data as Agent
}

/**
 * Delete an agent (must belong to current user via RLS).
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('agents')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Failed to delete agent:', error.message)
    return false
  }

  return true
}
