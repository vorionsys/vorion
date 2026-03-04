/**
 * Database types for Aurais
 * Matches supabase/migrations/001_initial_schema.sql
 */

export type Plan = 'core' | 'starter' | 'pro' | 'team' | 'enterprise'
export type AgentStatus = 'draft' | 'training' | 'active' | 'suspended' | 'archived'

export interface Profile {
  id: string
  name: string | null
  email: string | null
  avatar_url: string | null
  plan: Plan
  organization: string | null
  timezone: string
  created_at: string
  updated_at: string
}

export interface Agent {
  id: string
  user_id: string
  name: string
  description: string | null
  system_prompt: string
  model: string
  trust_tier: number
  trust_score: number
  car_id: string | null
  status: AgentStatus
  specialization: string
  capabilities: string[]
  personality_traits: string[]
  metadata: Record<string, unknown>
  executions: number
  last_active_at: string | null
  created_at: string
  updated_at: string
}

export interface ActivityLogEntry {
  id: string
  user_id: string
  agent_id: string | null
  action: string
  description: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface CreateAgentInput {
  name: string
  description?: string
  system_prompt?: string
  model?: string
  specialization?: string
  capabilities?: string[]
  personality_traits?: string[]
}

export interface UpdateAgentInput {
  name?: string
  description?: string
  system_prompt?: string
  model?: string
  status?: AgentStatus
  specialization?: string
  capabilities?: string[]
  personality_traits?: string[]
}

export interface UpdateProfileInput {
  name?: string
  avatar_url?: string
  plan?: Plan
  organization?: string
  timezone?: string
}
