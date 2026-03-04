'use client';

import { getSupabaseClient, isSupabaseConfigured } from '../supabase-client';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

/**
 * Supabase Studio Client
 *
 * Replaces the previous Firebase-based studio client.
 * Reuses the existing Supabase connection (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY).
 *
 * Required Supabase tables:
 *
 * -- studio_agents: Tracks active agents in the studio simulation
 * CREATE TABLE studio_agents (
 *   id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   name       TEXT NOT NULL,
 *   role       TEXT NOT NULL,
 *   faction    TEXT NOT NULL,
 *   ability    TEXT NOT NULL,
 *   level      INTEGER NOT NULL DEFAULT 1,
 *   xp         INTEGER NOT NULL DEFAULT 0,
 *   trust_score INTEGER NOT NULL DEFAULT 50,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 *
 * -- studio_messages (scratchpad): Content produced by agents
 * CREATE TABLE studio_messages (
 *   id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   author       TEXT NOT NULL,
 *   faction      TEXT NOT NULL,
 *   role         TEXT NOT NULL,
 *   content      TEXT NOT NULL,
 *   content_type TEXT NOT NULL DEFAULT 'Signal',
 *   level        INTEGER NOT NULL DEFAULT 1,
 *   status       TEXT NOT NULL DEFAULT 'CLEAN',
 *   created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 *
 * -- studio_metrics: Network health metrics (singleton row keyed on id = 'network_health')
 * CREATE TABLE studio_metrics (
 *   id            TEXT PRIMARY KEY DEFAULT 'network_health',
 *   entropy       INTEGER NOT NULL DEFAULT 50,
 *   slope         TEXT NOT NULL DEFAULT 'neutral',
 *   total_actions INTEGER NOT NULL DEFAULT 0,
 *   updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const APP_ID = process.env.NEXT_PUBLIC_STUDIO_APP_ID || 'vorion-studio-v3.0';

export const STUDIO_TABLES = {
  AGENTS: 'studio_agents',
  MESSAGES: 'studio_messages',
  METRICS: 'studio_metrics',
} as const;

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Check whether Supabase is configured for the Studio feature.
 * Reuses the same env vars as the lexicon Supabase client.
 */
export function isStudioConfigured(): boolean {
  return isSupabaseConfigured();
}

/**
 * Returns the shared Supabase client singleton.
 */
export function getStudioClient(): SupabaseClient | null {
  return getSupabaseClient();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Sign in anonymously via Supabase Auth.
 * Returns the Supabase User on success, or null on failure.
 */
export async function signInAnonymous() {
  const client = getStudioClient();
  if (!client) return null;

  try {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    return data.user;
  } catch (err) {
    console.error('Supabase anonymous auth failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Realtime subscriptions
// ---------------------------------------------------------------------------

export type UnsubscribeFn = () => void;

/**
 * Subscribe to realtime changes on studio_messages.
 * Calls `callback` with the full ordered list of messages whenever data changes.
 */
export function subscribeToMessages(
  callback: (messages: StudioMessage[]) => void,
): UnsubscribeFn {
  const client = getStudioClient();
  if (!client) return () => {};

  // Initial fetch
  const fetchMessages = async () => {
    const { data } = await client
      .from(STUDIO_TABLES.MESSAGES)
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100);

    if (data) {
      callback(data.map(rowToMessage));
    }
  };

  fetchMessages();

  const channel: RealtimeChannel = client
    .channel('studio-messages')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: STUDIO_TABLES.MESSAGES },
      () => {
        // Refetch on any change for simplicity and ordering consistency
        fetchMessages();
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}

/**
 * Subscribe to realtime changes on studio_agents.
 * Calls `callback` with the full list of agents whenever data changes.
 */
export function subscribeToAgents(
  callback: (agents: StudioAgent[]) => void,
): UnsubscribeFn {
  const client = getStudioClient();
  if (!client) return () => {};

  const fetchAgents = async () => {
    const { data } = await client
      .from(STUDIO_TABLES.AGENTS)
      .select('*')
      .order('created_at', { ascending: true });

    if (data) {
      callback(data.map(rowToAgent));
    }
  };

  fetchAgents();

  const channel: RealtimeChannel = client
    .channel('studio-agents')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: STUDIO_TABLES.AGENTS },
      () => {
        fetchAgents();
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}

/**
 * Subscribe to realtime changes on studio_metrics (network_health row).
 * Calls `callback` with the metrics object whenever it changes.
 */
export function subscribeToMetrics(
  callback: (metrics: StudioMetrics) => void,
): UnsubscribeFn {
  const client = getStudioClient();
  if (!client) return () => {};

  const fetchMetrics = async () => {
    const { data } = await client
      .from(STUDIO_TABLES.METRICS)
      .select('*')
      .eq('id', 'network_health')
      .single();

    if (data) {
      callback(rowToMetrics(data));
    }
  };

  fetchMetrics();

  const channel: RealtimeChannel = client
    .channel('studio-metrics')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: STUDIO_TABLES.METRICS },
      () => {
        fetchMetrics();
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Insert a new message into studio_messages (scratchpad).
 */
export async function addMessage(msg: Omit<StudioMessage, 'id' | 'created_at'>): Promise<string | null> {
  const client = getStudioClient();
  if (!client) return null;

  const { data, error } = await client
    .from(STUDIO_TABLES.MESSAGES)
    .insert({
      author: msg.author,
      faction: msg.faction,
      role: msg.role,
      content: msg.content,
      content_type: msg.contentType,
      level: msg.level,
      status: msg.status,
    })
    .select('id')
    .single();

  if (error) {
    console.error('addMessage error:', error);
    return null;
  }
  return data.id;
}

/**
 * Insert a new agent into studio_agents.
 */
export async function addAgent(agent: Omit<StudioAgent, 'id' | 'created_at'>): Promise<string | null> {
  const client = getStudioClient();
  if (!client) return null;

  const { data, error } = await client
    .from(STUDIO_TABLES.AGENTS)
    .insert({
      name: agent.name,
      role: agent.role,
      faction: agent.faction,
      ability: agent.ability,
      level: agent.level,
      xp: agent.xp,
      trust_score: agent.trustScore,
    })
    .select('id')
    .single();

  if (error) {
    console.error('addAgent error:', error);
    return null;
  }
  return data.id;
}

/**
 * Delete an agent by ID.
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const client = getStudioClient();
  if (!client) return false;

  const { error } = await client
    .from(STUDIO_TABLES.AGENTS)
    .delete()
    .eq('id', id);

  if (error) {
    console.error('deleteAgent error:', error);
    return false;
  }
  return true;
}

/**
 * Increment an agent's XP by a given amount (default 25).
 */
export async function updateAgentXP(id: string, amount: number = 25): Promise<boolean> {
  const client = getStudioClient();
  if (!client) return false;

  // Supabase doesn't have a built-in increment; use RPC or read-then-write.
  // For simplicity we use a raw RPC-style update with a sub-select.
  const { data: current, error: fetchError } = await client
    .from(STUDIO_TABLES.AGENTS)
    .select('xp')
    .eq('id', id)
    .single();

  if (fetchError || !current) return false;

  const { error } = await client
    .from(STUDIO_TABLES.AGENTS)
    .update({ xp: (current.xp ?? 0) + amount })
    .eq('id', id);

  if (error) {
    console.error('updateAgentXP error:', error);
    return false;
  }
  return true;
}

/**
 * Upsert network health metrics.
 * Uses the fixed id 'network_health' as the singleton key.
 */
export async function updateMetrics(entropy: number, slope: string): Promise<boolean> {
  const client = getStudioClient();
  if (!client) return false;

  // Read current total_actions to increment
  const { data: current } = await client
    .from(STUDIO_TABLES.METRICS)
    .select('total_actions')
    .eq('id', 'network_health')
    .single();

  const totalActions = ((current?.total_actions as number) ?? 0) + 1;

  const { error } = await client
    .from(STUDIO_TABLES.METRICS)
    .upsert({
      id: 'network_health',
      entropy,
      slope,
      total_actions: totalActions,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error('updateMetrics error:', error);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Row types & mappers
// ---------------------------------------------------------------------------

export interface StudioMessage {
  id: string;
  author: string;
  faction: string;
  role: string;
  content: string;
  contentType: string;
  level: number;
  status: string;
  created_at?: string;
}

export interface StudioAgent {
  id: string;
  name: string;
  role: string;
  faction: string;
  ability: string;
  level: number;
  xp: number;
  trustScore: number;
  created_at?: string;
}

export interface StudioMetrics {
  entropy: number;
  slope: string;
  totalActions: number;
}

function rowToMessage(row: Record<string, unknown>): StudioMessage {
  return {
    id: row.id as string,
    author: row.author as string,
    faction: row.faction as string,
    role: row.role as string,
    content: row.content as string,
    contentType: (row.content_type as string) || 'Signal',
    level: (row.level as number) || 1,
    status: (row.status as string) || 'CLEAN',
    created_at: row.created_at as string | undefined,
  };
}

function rowToAgent(row: Record<string, unknown>): StudioAgent {
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as string,
    faction: row.faction as string,
    ability: row.ability as string,
    level: (row.level as number) || 1,
    xp: (row.xp as number) || 0,
    trustScore: (row.trust_score as number) || 50,
    created_at: row.created_at as string | undefined,
  };
}

function rowToMetrics(row: Record<string, unknown>): StudioMetrics {
  return {
    entropy: typeof row.entropy === 'number' ? row.entropy : 50,
    slope: typeof row.slope === 'string' ? row.slope : 'neutral',
    totalActions: (row.total_actions as number) || 0,
  };
}
