/**
 * Cognigate Governance Middleware
 *
 * Integrates Aurais with the Cognigate API for real governance enforcement.
 * Aligned with actual Cognigate API contracts (IntentRequest, EnforceRequest, etc.)
 *
 * API Flow: parseIntent → enforceGovernance → getProof
 * See: https://cognigate.dev/docs
 */

import { env } from '@/lib/env'
import { TIER_THRESHOLDS, ALL_TIERS, type TrustTierName } from '@/lib/trust-tiers'

const COGNIGATE_URL = env.COGNIGATE_API_URL
const COGNIGATE_KEY = env.COGNIGATE_API_KEY

// Re-export canonical tiers for any consumers that imported from governance.ts
export { TIER_THRESHOLDS, ALL_TIERS }

/** Trust tier name as returned by Cognigate API (lowercase) */
export type TrustTier = Lowercase<TrustTierName>
export type GovernanceDecision = 'allow' | 'deny' | 'escalate' | 'modify'

// =============================================================================
// Types aligned with Cognigate API models
// =============================================================================

/** Structured plan as returned by Cognigate /v1/intent */
export interface StructuredPlan {
  plan_id: string
  goal: string
  tools_required: string[]
  endpoints_required: string[]
  data_classifications: string[]
  risk_indicators: Record<string, number>
  risk_score: number
  reasoning_trace: string
}

/** Response from Cognigate POST /v1/intent */
export interface IntentResult {
  intent_id: string
  entity_id: string
  status: 'normalized' | 'blocked' | 'error'
  plan: StructuredPlan | null
  trust_level: number
  trust_score: number
  created_at: string
  error?: string
}

/** Response from Cognigate POST /v1/enforce */
export interface EnforceResult {
  verdict_id: string
  intent_id: string
  plan_id: string
  allowed: boolean
  action: GovernanceDecision
  violations: PolicyViolation[]
  policies_evaluated: string[]
  constraints_evaluated: number
  trust_impact: number
  requires_approval: boolean
  approval_timeout?: string
  rigor_mode: 'lite' | 'standard' | 'strict'
  decided_at: string
  duration_ms: number
}

export interface PolicyViolation {
  policy_id: string
  constraint_id?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  message: string
  blocked: boolean
  remediation?: string
}

export interface TrustStatus {
  entityId: string
  score: number
  tier: TrustTier
  level: number
  capabilities: string[]
  lastAction?: string
  createdAt: string
}

export interface ProofRecord {
  proofId: string
  intentId: string
  timestamp: string
  payloadHash: string
  previousProofId?: string
  previousHash?: string
  sequenceNumber: number
  signature: string
}

// =============================================================================
// API Client
// =============================================================================

function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  if (COGNIGATE_KEY) {
    headers['X-API-Key'] = COGNIGATE_KEY
  }
  return headers
}

/**
 * Parse user message into structured intent via Cognigate /v1/intent
 *
 * Cognigate IntentRequest: { entity_id, goal, context, metadata }
 */
export async function parseIntent(
  entityId: string,
  goal: string,
  context?: {
    source?: string
    conversationId?: string
    timestamp?: string
  }
): Promise<IntentResult> {
  const response = await fetch(`${COGNIGATE_URL}/v1/intent`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      entity_id: entityId,
      goal,
      context: {
        source: context?.source || 'aurais-chat',
        conversation_id: context?.conversationId,
        timestamp: context?.timestamp || new Date().toISOString(),
      },
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || error.error?.message || `Intent parsing failed: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Enforce governance on a parsed intent via Cognigate /v1/enforce
 *
 * Cognigate EnforceRequest: { plan, entity_id, trust_level, trust_score, policy_ids, rigor_mode, context }
 */
export async function enforceGovernance(
  intentResult: IntentResult,
  options?: {
    policyIds?: string[]
    rigorMode?: 'lite' | 'standard' | 'strict'
  }
): Promise<EnforceResult> {
  if (!intentResult.plan) {
    throw new Error('Cannot enforce: intent has no plan (status: ' + intentResult.status + ')')
  }

  const response = await fetch(`${COGNIGATE_URL}/v1/enforce`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      plan: intentResult.plan,
      entity_id: intentResult.entity_id,
      trust_level: intentResult.trust_level,
      trust_score: intentResult.trust_score,
      policy_ids: options?.policyIds || [],
      rigor_mode: options?.rigorMode || null,
      context: {},
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || error.error?.message || `Enforcement failed: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get current trust status for an entity.
 *
 * Trust data comes from the intent response (trust_level, trust_score).
 * For standalone lookups, use the Aurais agents API (/api/agents/[id]).
 * Cognigate has no dedicated trust endpoint.
 */
export function getTrustStatusFromIntent(intentResult: IntentResult): TrustStatus {
  return {
    entityId: intentResult.entity_id,
    score: intentResult.trust_score,
    tier: getTierFromScore(intentResult.trust_score),
    level: intentResult.trust_level,
    capabilities: [],
    createdAt: intentResult.created_at,
  }
}

/**
 * Get default trust status for a new/unknown entity
 */
export function getDefaultTrustStatus(entityId: string): TrustStatus {
  return {
    entityId,
    score: 200,
    tier: 'observed',
    level: 1,
    capabilities: ['sandbox:*', 'data:read/public'],
    createdAt: new Date().toISOString(),
  }
}

/**
 * Submit action outcome to update trust score.
 *
 * NOTE: Cognigate does not yet have an outcome endpoint.
 * Trust score updates happen through the enforce layer (trust_impact field).
 * This function is a placeholder for when the outcome endpoint is built.
 */
export async function submitOutcome(
  entityId: string,
  proofId: string,
  outcome: 'success' | 'failure' | 'partial',
  feedback?: {
    userRating?: number
    flags?: string[]
  }
): Promise<void> {
  // Record outcome through Cognigate enforce layer for trust impact.
  // The enforce endpoint accepts an outcome payload alongside a plan,
  // which triggers trust_impact adjustments on the entity's score.
  try {
    const response = await fetch(`${COGNIGATE_URL}/v1/outcome`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        entity_id: entityId,
        proof_id: proofId,
        outcome,
        feedback: {
          user_rating: feedback?.userRating,
          flags: feedback?.flags,
        },
        timestamp: new Date().toISOString(),
      }),
    })

    // Outcome endpoint may not exist yet — silently degrade
    if (!response.ok && response.status !== 404) {
      const error = await response.json().catch(() => ({}))
      console.warn(
        `[governance] Outcome submission returned ${response.status}: ${error.detail || response.statusText}`
      )
    }
  } catch (err) {
    // Network error — Cognigate unreachable, degrade gracefully
    console.warn('[governance] Failed to submit outcome to Cognigate:', err)
  }
}

/**
 * Get proof record by ID via Cognigate /v1/proof/:id
 */
export async function getProof(proofId: string): Promise<ProofRecord> {
  const response = await fetch(`${COGNIGATE_URL}/v1/proof/${proofId}`, {
    headers: getHeaders(),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || `Proof retrieval failed: ${response.statusText}`)
  }

  const result = await response.json()

  return {
    proofId: result.proof_id,
    intentId: result.intent_id,
    timestamp: result.timestamp,
    payloadHash: result.payload_hash,
    previousProofId: result.previous_proof_id,
    previousHash: result.previous_hash,
    sequenceNumber: result.sequence_number,
    signature: result.signature,
  }
}

/**
 * Get proof chain statistics via Cognigate /v1/proof/stats
 */
export async function getProofStats(): Promise<{
  chainLength: number
  lastProofAt: string
  status: 'healthy' | 'degraded'
}> {
  const response = await fetch(`${COGNIGATE_URL}/v1/proof/stats`, {
    headers: getHeaders(),
  })

  if (!response.ok) {
    return {
      chainLength: 0,
      lastProofAt: new Date().toISOString(),
      status: 'degraded',
    }
  }

  const result = await response.json()

  return {
    chainLength: result.proof_chain_length,
    lastProofAt: result.last_proof_at,
    status: 'healthy',
  }
}

/**
 * Check Cognigate health via /health (no /v1 prefix)
 */
export async function checkHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  basisVersion: string
  layers: {
    intent: string
    enforce: string
    proof: string
  }
}> {
  try {
    const response = await fetch(`${COGNIGATE_URL}/health`, {
      headers: getHeaders(),
    })

    if (!response.ok) {
      return {
        status: 'unhealthy',
        version: 'unknown',
        basisVersion: 'unknown',
        layers: { intent: 'unknown', enforce: 'unknown', proof: 'unknown' },
      }
    }

    const result = await response.json()

    return {
      status: result.status,
      version: result.version,
      basisVersion: result.basis_version,
      layers: result.layers,
    }
  } catch {
    return {
      status: 'unhealthy',
      version: 'unknown',
      basisVersion: 'unknown',
      layers: { intent: 'unknown', enforce: 'unknown', proof: 'unknown' },
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

export { getTierStylesFromScore, getTierStylesFromName, getTierColor } from '@/lib/trust-tiers'

export function getTierFromScore(score: number): TrustTier {
  const clamped = Math.max(0, Math.min(1000, score))
  if (clamped >= 951) return 'autonomous'
  if (clamped >= 876) return 'certified'
  if (clamped >= 800) return 'trusted'
  if (clamped >= 650) return 'standard'
  if (clamped >= 500) return 'monitored'
  if (clamped >= 350) return 'provisional'
  if (clamped >= 200) return 'observed'
  return 'sandbox'
}

export function getDecisionColor(decision: GovernanceDecision): string {
  const colors: Record<GovernanceDecision, string> = {
    allow: 'bg-green-900/50 text-green-400',
    deny: 'bg-red-900/50 text-red-400',
    escalate: 'bg-yellow-900/50 text-yellow-400',
    modify: 'bg-orange-900/50 text-orange-400',
  }
  return colors[decision] || 'bg-gray-900/50 text-gray-400'
}
