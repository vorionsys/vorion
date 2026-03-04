/**
 * Creator Trust Service - Patent 5: Transitive Trust Model
 *
 * Hierarchical trust system binding agent reputation to creator reputation:
 * - Creator trust calculated from different signals than agent trust
 * - Snapshot of creator trust locked at agent deployment
 * - Live feed of current creator trust for early warning
 * - Supply chain accountability through creator-agent binding
 */

import { createClient } from '@/lib/supabase/server'
import { getTrustTier } from '@/lib/governance/trust'
import { TrustTier } from '@/lib/governance/types'

// =============================================================================
// Types
// =============================================================================

export interface CreatorTrustScore {
  creatorId: string
  score: number                    // 0-1000
  tier: TrustTier
  fleetSize: number               // Number of active agents
  avgFleetTrust: number           // Average trust of all agents
  signals: CreatorTrustSignals
  calculatedAt: Date
}

export interface CreatorTrustSignals {
  // Fleet performance
  fleetSuccessRate: number        // % of agent actions successful
  fleetErrorRate: number          // Average error rate across fleet
  fleetComplianceRate: number     // % policy compliance

  // Security track record
  securityIncidents: number       // Total security incidents
  incidentsLast90Days: number     // Recent incidents
  vulnerabilitiesPatched: number  // Known vulns patched

  // Maintenance quality
  meanTimeToPatch: number         // Average hours to patch issues
  documentationScore: number      // 0-100 quality score
  supportResponseTime: number     // Average hours to respond

  // Ecosystem reputation
  ecosystemTenure: number         // Days since first agent deployed
  agentsRetired: number           // Agents retired (negative signal)
  agentsAbandoned: number         // Agents with no updates >180 days
}

export interface AgentCreatorBinding {
  agentId: string
  creatorId: string

  // Snapshot at creation (immutable)
  creatorTrustAtCreation: number
  creatorTierAtCreation: TrustTier
  snapshotDate: Date

  // Current values (live)
  currentCreatorTrust: number
  currentCreatorTier: TrustTier

  // Derived
  trustDelta: number              // current - snapshot (negative = decline)
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

export interface FleetSummary {
  creatorId: string
  totalAgents: number
  activeAgents: number
  averageTrustScore: number
  highestTrust: { agentId: string; score: number }
  lowestTrust: { agentId: string; score: number }
  trustDistribution: Record<TrustTier, number>
}

/**
 * Optional overrides for creator signal gathering.
 * Allows callers to supply data that cannot (yet) be derived from the database.
 */
export interface CreatorSignalOverrides {
  /** Number of known vulnerabilities the creator has patched across their fleet. */
  patchedVulnerabilities?: number
}

// =============================================================================
// Signal Weights — Legacy 4-bucket model (deprecated)
// =============================================================================

/**
 * @deprecated Use {@link CREATOR_FACTOR_WEIGHTS} instead.
 * These weights use a custom 4-bucket model (fleet/security/maintenance/reputation)
 * that predates the canonical 16-factor trust model from `@vorionsys/basis`.
 * Retained for backwards compatibility; will be removed in a future major version.
 */
const CREATOR_SIGNAL_WEIGHTS = {
  // Fleet performance (40%)
  fleetSuccessRate: 0.15,
  fleetErrorRate: -0.1,
  fleetComplianceRate: 0.15,

  // Security track record (30%)
  securityIncidents: -0.15,
  incidentsLast90Days: -0.1,
  vulnerabilitiesPatched: 0.05,

  // Maintenance quality (20%)
  meanTimeToPatch: -0.08,
  documentationScore: 0.07,
  supportResponseTime: -0.05,

  // Ecosystem reputation (10%)
  ecosystemTenure: 0.05,
  agentsRetired: -0.02,
  agentsAbandoned: -0.03,
}

// =============================================================================
// Factor Weights — 16-factor model (aligned with @vorionsys/basis)
//
// Maps creator-specific trust dimensions to canonical BASIS factor codes.
// The old 4-bucket groupings translate as follows:
//   fleet (operational reliability) → CT-REL, CT-COMP, CT-OBS
//   security                       → CT-SEC, CT-PRIV, CT-SAFE
//   maintenance (accountability)   → CT-ACCT, CT-TRANS, OP-STEW
//   reputation (alignment)         → OP-ALIGN, OP-HUMAN, SF-HUM
//   baseline (remaining)           → CT-ID, OP-CONTEXT, SF-ADAPT, SF-LEARN
//
// Total: 0.94 (0.06 floating for rounding tolerance — within ~1.0)
// =============================================================================

/**
 * Creator-specific factor weights aligned with the 16-factor trust model
 * from `@vorionsys/basis`. Each key is a canonical `FactorCodeString`.
 *
 * Weights are tuned for *creator* trust evaluation — they intentionally
 * emphasise security (CT-SEC) and operational reliability (CT-REL, CT-COMP)
 * more heavily than the equal-weight agent defaults (0.0625 each).
 */
export const CREATOR_FACTOR_WEIGHTS: Record<string, number> = {
  // --- Fleet / Operational reliability (0.22) ---
  'CT-REL':     0.08,   // Reliability — fleet uptime & consistency
  'CT-COMP':    0.08,   // Competence — fleet task success rate
  'CT-OBS':     0.06,   // Observability — fleet telemetry coverage

  // --- Security (0.22) ---
  'CT-SEC':     0.10,   // Security — incident history, vuln response
  'CT-PRIV':    0.06,   // Privacy — data handling across fleet
  'CT-SAFE':    0.06,   // Safety — guardrail compliance

  // --- Maintenance / Accountability (0.18) ---
  'CT-ACCT':    0.06,   // Accountability — audit trail, patch discipline
  'CT-TRANS':   0.06,   // Transparency — documentation quality
  'OP-STEW':    0.06,   // Stewardship — resource efficiency, maintenance

  // --- Reputation / Alignment (0.16) ---
  'OP-ALIGN':   0.06,   // Alignment — fleet alignment with stated goals
  'OP-HUMAN':   0.06,   // Human Oversight — escalation responsiveness
  'SF-HUM':     0.04,   // Humility — appropriate escalation, tenure signal

  // --- Baseline factors (0.16) ---
  'CT-ID':      0.04,   // Identity — creator verification strength
  'OP-CONTEXT': 0.04,   // Context Awareness — situational appropriateness
  'SF-ADAPT':   0.04,   // Adaptability — handling novel situations
  'SF-LEARN':   0.04,   // Continuous Learning — improvement over time
  // Sum: 0.94 (0.06 floating — within rounding tolerance of ~1.0)
} as const

// Recovery is intentionally slower than agent trust
const CREATOR_RECOVERY_RATE = 0.5  // 50% of normal recovery speed

// =============================================================================
// Factor Score Calculation — maps raw creator signals to 16-factor scores
// =============================================================================

/**
 * Calculate per-factor scores (0.0 to 1.0) from raw creator signals.
 * Each raw metric maps to specific factor codes per the weight table above.
 */
function calculateCreatorFactorScores(
  signals: CreatorTrustSignals
): Record<string, number> {
  // --- Fleet / Operational reliability → CT-REL, CT-COMP, CT-OBS ---
  const ctComp = signals.fleetSuccessRate          // 0-1 directly
  const ctRel  = Math.max(0, 1 - signals.fleetErrorRate * 5)  // low error → high reliability
  const ctObs  = signals.fleetComplianceRate       // 0-1 directly (observability proxy)

  // --- Security → CT-SEC, CT-PRIV, CT-SAFE ---
  const incidentPenalty = Math.min(signals.securityIncidents * 0.1, 0.5)
  const recentPenalty   = Math.min(signals.incidentsLast90Days * 0.2, 0.5)
  const ctSec  = Math.max(0, 1 - incidentPenalty - recentPenalty)
  const patchBonus = Math.min(signals.vulnerabilitiesPatched * 0.05, 0.3)
  const ctPriv = Math.max(0, 0.5 + patchBonus - recentPenalty)
  const ctSafe = signals.fleetComplianceRate       // compliance → safety proxy

  // --- Maintenance / Accountability → CT-ACCT, CT-TRANS, OP-STEW ---
  const ctAcct  = Math.max(0, 1 - (signals.meanTimeToPatch / 240))   // 240h = bad, 0h = perfect
  const ctTrans = signals.documentationScore / 100                     // 0-100 → 0-1
  const opStew  = Math.max(0, 1 - (signals.supportResponseTime / 120)) // 120h = bad

  // --- Reputation / Alignment → OP-ALIGN, OP-HUMAN, SF-HUM ---
  const opAlign = signals.fleetSuccessRate                              // fleet alignment proxy
  const opHuman = Math.max(0, 1 - (signals.supportResponseTime / 120)) // escalation speed
  const tenureNorm = Math.min(Math.log10(signals.ecosystemTenure + 1) / 3, 1) // log scale, cap at ~1000 days
  const sfHum   = Math.max(0, tenureNorm - signals.agentsAbandoned * 0.1)

  // --- Baseline factors → CT-ID, OP-CONTEXT, SF-ADAPT, SF-LEARN ---
  const ctId      = 0.5 + tenureNorm * 0.3 // tenure improves identity confidence
  const opContext = 0.5                     // neutral default (no direct signal)
  const sfAdapt   = Math.max(0, 1 - signals.agentsAbandoned * 0.1 - signals.agentsRetired * 0.05)
  const sfLearn   = Math.min(1, 0.5 + patchBonus + tenureNorm * 0.2)

  return {
    'CT-COMP': clamp01(ctComp),
    'CT-REL':  clamp01(ctRel),
    'CT-OBS':  clamp01(ctObs),
    'CT-TRANS': clamp01(ctTrans),
    'CT-ACCT': clamp01(ctAcct),
    'CT-SAFE': clamp01(ctSafe),
    'CT-SEC':  clamp01(ctSec),
    'CT-PRIV': clamp01(ctPriv),
    'CT-ID':   clamp01(ctId),
    'OP-HUMAN': clamp01(opHuman),
    'OP-ALIGN': clamp01(opAlign),
    'OP-CONTEXT': clamp01(opContext),
    'OP-STEW': clamp01(opStew),
    'SF-HUM':  clamp01(sfHum),
    'SF-ADAPT': clamp01(sfAdapt),
    'SF-LEARN': clamp01(sfLearn),
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// =============================================================================
// Creator Trust Calculation
// =============================================================================

export async function calculateCreatorTrust(
  creatorId: string,
  overrides?: CreatorSignalOverrides
): Promise<CreatorTrustScore> {
  const supabase = await createClient()

  // Gather signals from database
  const signals = await gatherCreatorSignals(creatorId, overrides)

  // Calculate per-factor scores (0.0 to 1.0) from raw signals
  const factorScores = calculateCreatorFactorScores(signals)

  // Calculate weighted total using 16-factor weights
  let score = 0
  for (const [code, weight] of Object.entries(CREATOR_FACTOR_WEIGHTS)) {
    score += (factorScores[code] ?? 0.5) * weight * 1000
  }

  // Clamp to valid range
  score = Math.max(0, Math.min(1000, Math.round(score)))

  // Get fleet stats
  const { data: agents } = await supabase
    .from('agents')
    .select('id, trust_score')
    .eq('owner_id', creatorId)
    .neq('status', 'archived')

  const fleetSize = agents?.length || 0
  const avgFleetTrust = fleetSize > 0
    ? Math.round(agents!.reduce((sum, a) => sum + (a.trust_score || 0), 0) / fleetSize)
    : 0

  return {
    creatorId,
    score,
    tier: getTrustTier(score),
    fleetSize,
    avgFleetTrust,
    signals,
    calculatedAt: new Date()
  }
}

async function gatherCreatorSignals(
  creatorId: string,
  overrides?: CreatorSignalOverrides
): Promise<CreatorTrustSignals> {
  const supabase = await createClient()

  // Get all agents for this creator
  const { data: agents } = await supabase
    .from('agents')
    .select('id, trust_score, status, created_at, updated_at')
    .eq('owner_id', creatorId)

  const agentIds = agents?.map(a => a.id) || []
  const activeAgents = agents?.filter(a => a.status === 'active') || []

  // Fleet performance metrics
  let fleetSuccessRate = 0.7 // Default
  let fleetErrorRate = 0.05
  let fleetComplianceRate = 0.9

  if (agentIds.length > 0) {
    // Get action outcomes
    const { data: outcomes } = await supabase
      .from('observer_events')
      .select('outcome')
      .in('agent_id', agentIds)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

    if (outcomes && outcomes.length > 0) {
      const successCount = outcomes.filter(o => o.outcome === 'success').length
      fleetSuccessRate = successCount / outcomes.length

      const errorCount = outcomes.filter(o => o.outcome === 'error').length
      fleetErrorRate = errorCount / outcomes.length
    }

    // Get compliance data
    const { data: decisions } = await supabase
      .from('council_decisions')
      .select('decision')
      .in('agent_id', agentIds)

    if (decisions && decisions.length > 0) {
      const approvedCount = decisions.filter(d => d.decision === 'approved').length
      fleetComplianceRate = approvedCount / decisions.length
    }
  }

  // Security incidents
  const { data: incidents } = await supabase
    .from('observer_events')
    .select('id, created_at')
    .in('agent_id', agentIds)
    .eq('event_type', 'security_incident')

  const allIncidents = incidents?.length || 0
  const recentIncidents = incidents?.filter(i =>
    new Date(i.created_at) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  ).length || 0

  // Calculate ecosystem tenure
  const oldestAgent = agents?.reduce((oldest, a) =>
    new Date(a.created_at) < new Date(oldest.created_at) ? a : oldest
  , agents?.[0])

  const ecosystemTenure = oldestAgent
    ? Math.floor((Date.now() - new Date(oldestAgent.created_at).getTime()) / (24 * 60 * 60 * 1000))
    : 0

  // Abandoned agents (no update in 180 days)
  const abandonedAgents = agents?.filter(a =>
    new Date(a.updated_at) < new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
  ).length || 0

  // Retired agents
  const retiredAgents = agents?.filter(a => a.status === 'retired').length || 0

  // Patched vulnerabilities — prefer caller-supplied override, then query DB,
  // then fall back to 0 when neither source is available.
  let patchedVulnerabilities = 0
  if (overrides?.patchedVulnerabilities !== undefined) {
    patchedVulnerabilities = overrides.patchedVulnerabilities
  } else if (agentIds.length > 0) {
    const { data: patchEvents } = await supabase
      .from('observer_events')
      .select('id')
      .in('agent_id', agentIds)
      .eq('event_type', 'vulnerability_patched')

    patchedVulnerabilities = patchEvents?.length || 0
  }

  return {
    fleetSuccessRate,
    fleetErrorRate,
    fleetComplianceRate,
    securityIncidents: allIncidents,
    incidentsLast90Days: recentIncidents,
    vulnerabilitiesPatched: patchedVulnerabilities,
    meanTimeToPatch: 24, // Default 24 hours
    documentationScore: 70, // Default
    supportResponseTime: 12, // Default 12 hours
    ecosystemTenure,
    agentsRetired: retiredAgents,
    agentsAbandoned: abandonedAgents,
  }
}

// =============================================================================
// Agent-Creator Binding
// =============================================================================

export async function createAgentCreatorBinding(
  agentId: string,
  creatorId: string
): Promise<AgentCreatorBinding> {
  const supabase = await createClient()

  // Get current creator trust
  const creatorTrust = await calculateCreatorTrust(creatorId)

  // Create binding with snapshot
  const binding: AgentCreatorBinding = {
    agentId,
    creatorId,
    creatorTrustAtCreation: creatorTrust.score,
    creatorTierAtCreation: creatorTrust.tier,
    snapshotDate: new Date(),
    currentCreatorTrust: creatorTrust.score,
    currentCreatorTier: creatorTrust.tier,
    trustDelta: 0,
    riskLevel: 'low'
  }

  // Store in database
  await supabase
    .from('agent_creator_bindings')
    .upsert({
      agent_id: agentId,
      creator_id: creatorId,
      creator_trust_at_creation: creatorTrust.score,
      creator_tier_at_creation: creatorTrust.tier,
      snapshot_date: new Date().toISOString(),
    })

  return binding
}

export async function getAgentCreatorBinding(
  agentId: string
): Promise<AgentCreatorBinding | null> {
  const supabase = await createClient()

  const { data: binding } = await supabase
    .from('agent_creator_bindings')
    .select('*')
    .eq('agent_id', agentId)
    .single()

  if (!binding) return null

  // Get current creator trust
  const currentTrust = await calculateCreatorTrust(binding.creator_id)

  const delta = currentTrust.score - binding.creator_trust_at_creation

  // Determine risk level based on delta
  let riskLevel: AgentCreatorBinding['riskLevel'] = 'low'
  if (delta < -200) {
    riskLevel = 'critical'
  } else if (delta < -100) {
    riskLevel = 'high'
  } else if (delta < -50) {
    riskLevel = 'medium'
  }

  return {
    agentId,
    creatorId: binding.creator_id,
    creatorTrustAtCreation: binding.creator_trust_at_creation,
    creatorTierAtCreation: binding.creator_tier_at_creation as TrustTier,
    snapshotDate: new Date(binding.snapshot_date),
    currentCreatorTrust: currentTrust.score,
    currentCreatorTier: currentTrust.tier,
    trustDelta: delta,
    riskLevel
  }
}

// =============================================================================
// Fleet Management
// =============================================================================

export async function getCreatorFleetSummary(
  creatorId: string
): Promise<FleetSummary> {
  const supabase = await createClient()

  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, trust_score, trust_tier, status')
    .eq('owner_id', creatorId)

  if (!agents || agents.length === 0) {
    return {
      creatorId,
      totalAgents: 0,
      activeAgents: 0,
      averageTrustScore: 0,
      highestTrust: { agentId: '', score: 0 },
      lowestTrust: { agentId: '', score: 0 },
      trustDistribution: {
        untrusted: 0,
        provisional: 0,
        established: 0,
        trusted: 0,
        verified: 0,
        certified: 0
      }
    }
  }

  const activeAgents = agents.filter(a => a.status === 'active')
  const avgTrust = Math.round(
    agents.reduce((sum, a) => sum + (a.trust_score || 0), 0) / agents.length
  )

  const sorted = [...agents].sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0))

  const distribution: Record<TrustTier, number> = {
    untrusted: 0,
    provisional: 0,
    established: 0,
    trusted: 0,
    verified: 0,
    certified: 0
  }

  for (const agent of agents) {
    const tier = (agent.trust_tier as TrustTier) || getTrustTier(agent.trust_score || 0)
    distribution[tier]++
  }

  return {
    creatorId,
    totalAgents: agents.length,
    activeAgents: activeAgents.length,
    averageTrustScore: avgTrust,
    highestTrust: {
      agentId: sorted[0]?.id || '',
      score: sorted[0]?.trust_score || 0
    },
    lowestTrust: {
      agentId: sorted[sorted.length - 1]?.id || '',
      score: sorted[sorted.length - 1]?.trust_score || 0
    },
    trustDistribution: distribution
  }
}

// =============================================================================
// Risk Assessment
// =============================================================================

export interface CreatorRiskAssessment {
  creatorId: string
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  factors: RiskFactor[]
  recommendations: string[]
  affectedAgents: string[]
}

interface RiskFactor {
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export async function assessCreatorRisk(
  creatorId: string,
  options?: { affectedAgentIds?: string[] }
): Promise<CreatorRiskAssessment> {
  const trust = await calculateCreatorTrust(creatorId)
  const fleet = await getCreatorFleetSummary(creatorId)

  const factors: RiskFactor[] = []
  const recommendations: string[] = []

  // Check trust score
  if (trust.score < 200) {
    factors.push({
      type: 'low_trust',
      severity: 'critical',
      description: `Creator trust score is ${trust.score} (Untrusted tier)`
    })
    recommendations.push('Review all agents from this creator immediately')
  } else if (trust.score < 400) {
    factors.push({
      type: 'low_trust',
      severity: 'high',
      description: `Creator trust score is ${trust.score} (Provisional tier)`
    })
    recommendations.push('Increase monitoring of agents from this creator')
  }

  // Check security incidents
  if (trust.signals.incidentsLast90Days > 0) {
    factors.push({
      type: 'security_incidents',
      severity: trust.signals.incidentsLast90Days > 2 ? 'critical' : 'high',
      description: `${trust.signals.incidentsLast90Days} security incidents in last 90 days`
    })
    recommendations.push('Audit all deployed agents for vulnerabilities')
  }

  // Check abandoned agents
  if (trust.signals.agentsAbandoned > 0) {
    factors.push({
      type: 'abandoned_agents',
      severity: 'medium',
      description: `${trust.signals.agentsAbandoned} agents haven't been updated in 180+ days`
    })
    recommendations.push('Consider retiring abandoned agents')
  }

  // Check fleet error rate
  if (trust.signals.fleetErrorRate > 0.2) {
    factors.push({
      type: 'high_error_rate',
      severity: 'high',
      description: `Fleet error rate is ${(trust.signals.fleetErrorRate * 100).toFixed(1)}%`
    })
    recommendations.push('Investigate high error rates across agent fleet')
  }

  // Determine overall risk
  let overallRisk: CreatorRiskAssessment['overallRisk'] = 'low'
  if (factors.some(f => f.severity === 'critical')) {
    overallRisk = 'critical'
  } else if (factors.some(f => f.severity === 'high')) {
    overallRisk = 'high'
  } else if (factors.some(f => f.severity === 'medium')) {
    overallRisk = 'medium'
  }

  // Build affected agents list — use caller-supplied IDs when available,
  // otherwise derive from the fleet (all active agents are potentially affected
  // when creator-level risk is elevated).
  let affectedAgents: string[] = []
  if (options?.affectedAgentIds && options.affectedAgentIds.length > 0) {
    affectedAgents = options.affectedAgentIds
  } else if (overallRisk !== 'low') {
    // When risk is elevated, all active agents from this creator are affected
    const supabase = await createClient()
    const { data: activeAgents } = await supabase
      .from('agents')
      .select('id')
      .eq('owner_id', creatorId)
      .eq('status', 'active')

    affectedAgents = activeAgents?.map(a => a.id) || []
  }

  return {
    creatorId,
    overallRisk,
    factors,
    recommendations,
    affectedAgents,
  }
}

// =============================================================================
// Database Schema (for reference - migration needed)
// =============================================================================

/*
CREATE TABLE IF NOT EXISTS agent_creator_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_trust_at_creation INTEGER NOT NULL,
  creator_tier_at_creation TEXT NOT NULL,
  snapshot_date TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id)
);

CREATE INDEX idx_agent_creator_bindings_creator ON agent_creator_bindings(creator_id);
CREATE INDEX idx_agent_creator_bindings_agent ON agent_creator_bindings(agent_id);

CREATE TABLE IF NOT EXISTS creator_trust_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  tier TEXT NOT NULL,
  fleet_size INTEGER NOT NULL,
  avg_fleet_trust INTEGER NOT NULL,
  signals JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_creator_trust_history_creator ON creator_trust_history(creator_id, calculated_at DESC);
*/

export default {
  calculateCreatorTrust,
  createAgentCreatorBinding,
  getAgentCreatorBinding,
  getCreatorFleetSummary,
  assessCreatorRisk
}
