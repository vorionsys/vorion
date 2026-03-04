/**
 * Trust Profile types - represents an agent's current trust state
 */

import type { ObservationTier, TrustBand } from './enums.js';

/**
 * Graduated circuit breaker state for the trust dynamics engine.
 *
 * - 'normal'   : standard operation
 * - 'degraded' : soft CB — score entered the warning zone; gains blocked,
 *                losses still apply; auto-resets after tier-appropriate timeout
 * - 'tripped'  : hard CB — all updates blocked; tier-dependent auto-reset
 *                (T0-T2 auto-reset, T3+ require admin)
 */
export type CircuitBreakerState = 'normal' | 'degraded' | 'tripped';

/**
 * Trust factor scores for an agent
 *
 * Each factor is scored 0.0-1.0 where:
 * - 0.0: No evidence / unproven
 * - 0.5: Baseline / meets minimum
 * - 1.0: Maximum trust / proven excellence
 *
 * The 16 core factors are defined in @vorionsys/basis.
 * Factor codes: CT-COMP, CT-REL, CT-OBS, CT-TRANS, CT-ACCT, CT-SAFE,
 *               CT-SEC, CT-PRIV, CT-ID, OP-HUMAN, OP-ALIGN, OP-CONTEXT,
 *               OP-STEW, SF-HUM, SF-ADAPT, SF-LEARN
 */
export type TrustFactorScores = Record<string, number>;

/**
 * Evidence type classification for weighted trust calculations
 *
 * HITL evidence is weighted more heavily to solve the cold-start problem:
 * - A single HITL approval counts as much as ~10 automated observations
 * - This allows agents to graduate faster with human oversight
 */
export type EvidenceType =
  | 'automated'      // Standard system observations (1x weight)
  | 'hitl_approval'  // Human-in-the-loop approval (5x weight)
  | 'hitl_rejection' // Human rejection/correction (5x weight)
  | 'examination'    // Formal examination result (3x weight)
  | 'audit'          // Third-party audit finding (3x weight)
  | 'sandbox_test'   // Shadow/testnet observation (0.5x weight)
  | 'peer_review';   // Cross-agent endorsement (2x weight)

/**
 * Default evidence type multipliers
 *
 * These multipliers solve the 1000-event cold-start problem by giving
 * HITL approvals significantly more weight than automated observations.
 *
 * IMPORTANT: Multipliers > 1.0 are only applied to POSITIVE evidence.
 * Negative evidence is never amplified by these multipliers — the tier-scaled
 * penalty formula (7-10x) is the sole mechanism for negative amplification.
 * hitl_rejection is listed as 1.0 to make this explicit.
 */
export const EVIDENCE_TYPE_MULTIPLIERS: Record<EvidenceType, number> = {
  automated: 1.0,
  hitl_approval: 5.0,    // HITL approval = 5 automated observations (positive only)
  hitl_rejection: 1.0,   // No extra amplification — tier penalty formula handles negatives
  examination: 3.0,      // Formal exams count more (positive findings only)
  audit: 3.0,            // Audits are authoritative (positive findings only)
  sandbox_test: 0.5,     // Sandbox/testnet observations count less (unverified)
  peer_review: 2.0,      // Cross-agent reviews have moderate weight (positive only)
};

/**
 * Evidence item used to calculate trust dimensions
 */
export interface TrustEvidence {
  /** Unique identifier for this evidence */
  evidenceId: string;
  /** Which trust factor this evidence affects (e.g. 'CT-COMP', 'OP-ALIGN') */
  factorCode: string;
  /** Score impact (-1000 to +1000) on the 0-1000 scale */
  impact: number;
  /** Human-readable source of evidence */
  source: string;
  /** When this evidence was collected */
  collectedAt: Date;
  /** When this evidence expires (optional) */
  expiresAt?: Date;
  /**
   * Evidence type for weighted calculations
   * Defaults to 'automated' if not specified
   */
  evidenceType?: EvidenceType;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Complete trust profile for an agent
 */
export interface TrustProfile {
  /** Unique profile identifier */
  profileId: string;
  /** Agent this profile belongs to */
  agentId: string;

  /** Individual factor scores (each 0.0-1.0) */
  factorScores: TrustFactorScores;

  /** Composite trust score (weighted sum, 0-1000) */
  compositeScore: number;

  /** Observation tier determines trust ceiling */
  observationTier: ObservationTier;

  /** Score after applying observation ceiling (0-1000) */
  adjustedScore: number;

  /** Current trust band (T0-T7) */
  band: TrustBand;

  /** When this profile was calculated */
  calculatedAt: Date;

  /** When this profile expires and needs recalculation */
  validUntil?: Date;

  /** Evidence items used in calculation */
  evidence: TrustEvidence[];

  /** Version for optimistic concurrency */
  version: number;
}

/**
 * Summary view of a trust profile
 */
export interface TrustProfileSummary {
  agentId: string;
  /** Raw composite score (0-1000) */
  compositeScore: number;
  /** Adjusted score after observation ceiling (0-1000) */
  adjustedScore: number;
  band: TrustBand;
  observationTier: ObservationTier;
  calculatedAt: Date;
}

/**
 * Request to calculate trust for an agent
 */
export interface TrustCalculationRequest {
  agentId: string;
  observationTier: ObservationTier;
  evidence: TrustEvidence[];
}

/**
 * Configuration for trust band thresholds (T0-T7)
 */
export interface BandThresholds {
  T0: { min: number; max: number };
  T1: { min: number; max: number };
  T2: { min: number; max: number };
  T3: { min: number; max: number };
  T4: { min: number; max: number };
  T5: { min: number; max: number };
  T6: { min: number; max: number };
  T7: { min: number; max: number };
}

/**
 * Default band thresholds on 0-1000 scale
 *
 * These thresholds determine which TrustBand an agent falls into
 * based on their adjusted trust score.
 *
 * 8-tier model (T0-T7):
 * - T0: Sandbox (0-199)
 * - T1: Observed (200-349)
 * - T2: Provisional (350-499)
 * - T3: Monitored (500-649)
 * - T4: Standard (650-799)
 * - T5: Trusted (800-875)
 * - T6: Certified (876-950)
 * - T7: Autonomous (951-1000)
 */
export const DEFAULT_BAND_THRESHOLDS: BandThresholds = {
  T0: { min: 0, max: 199 },
  T1: { min: 200, max: 349 },
  T2: { min: 350, max: 499 },
  T3: { min: 500, max: 649 },
  T4: { min: 650, max: 799 },
  T5: { min: 800, max: 875 },
  T6: { min: 876, max: 950 },
  T7: { min: 951, max: 1000 },
};

/**
 * Configuration for band transitions
 */
export interface BandingConfig {
  thresholds: BandThresholds;
  /** Points buffer to prevent oscillation */
  hysteresis: number;
  /**
   * Daily decay rate for stale evidence freshness weighting (0.0 to 1.0).
   * Reduces the influence of older evidence in banding calculations.
   * NOTE: This is NOT inactivity decay. For inactivity decay, see
   * DECAY_MILESTONES (stepped milestones: 7/14/28/42/56/84/112/140/182 days).
   */
  decayRate: number;
  /** Minimum days at current band before promotion */
  promotionDelay: number;
}

/** Default banding configuration */
export const DEFAULT_BANDING_CONFIG: BandingConfig = {
  thresholds: DEFAULT_BAND_THRESHOLDS,
  /** Points buffer on 0-1000 scale to prevent oscillation */
  hysteresis: 30,
  decayRate: 0.01,
  promotionDelay: 7,
};

/**
 * Risk profile for temporal outcome tracking
 * Determines how long to wait before finalizing outcome
 */
export enum RiskProfile {
  /** 5 minutes - computations, queries */
  IMMEDIATE = 'IMMEDIATE',
  /** 4 hours - API calls */
  SHORT_TERM = 'SHORT_TERM',
  /** 3 days - simple transactions */
  MEDIUM_TERM = 'MEDIUM_TERM',
  /** 30 days - financial trades */
  LONG_TERM = 'LONG_TERM',
  /** 90 days - investments */
  EXTENDED = 'EXTENDED',
}

/** Outcome windows in milliseconds for each risk profile */
export const RISK_PROFILE_WINDOWS: Record<RiskProfile, number> = {
  [RiskProfile.IMMEDIATE]: 5 * 60 * 1000,           // 5 minutes
  [RiskProfile.SHORT_TERM]: 4 * 60 * 60 * 1000,     // 4 hours
  [RiskProfile.MEDIUM_TERM]: 3 * 24 * 60 * 60 * 1000, // 3 days
  [RiskProfile.LONG_TERM]: 30 * 24 * 60 * 60 * 1000,  // 30 days
  [RiskProfile.EXTENDED]: 90 * 24 * 60 * 60 * 1000,   // 90 days
};

/**
 * Configuration for asymmetric trust dynamics
 * Per ATSF v2.0: "Trust is hard to gain, easy to lose" (7-10x ratio, tier-scaled)
 *
 * Failure penalty scales linearly from penaltyRatioMin at T0 (Sandbox) to
 * penaltyRatioMax at T7 (Autonomous). This allows early-stage agents room to
 * grow while applying strict accountability at higher tiers. A single penalty
 * mechanism is used — stacking separate penalties is prohibited (double jeopardy).
 */
export interface TrustDynamicsConfig {
  /**
   * Logarithmic gain rate for positive evidence
   * Trust gain formula: delta = gainRate * log(1 + (ceiling - current))
   * Default: 0.01 (slow gain)
   */
  gainRate: number;

  /**
   * Minimum failure penalty ratio, applied at T0 (Sandbox)
   * Effective loss rate = gainRate * penaltyRatioMin
   * Default: 7 (7x gainRate — lenient for new/recovering agents)
   */
  penaltyRatioMin: number;

  /**
   * Maximum failure penalty ratio, applied at T7 (Autonomous)
   * Effective loss rate = gainRate * penaltyRatioMax
   * Default: 10 (10x gainRate — strict for highest-trust agents)
   */
  penaltyRatioMax: number;

  /**
   * Cooldown period in hours after any trust drop
   * During cooldown, trust cannot increase
   * Default: 168 hours (7 days)
   */
  cooldownHours: number;

  /**
   * Number of direction changes (gain→loss or loss→gain)
   * within the oscillation window that triggers circuit breaker
   * Default: 3
   */
  oscillationThreshold: number;

  /**
   * Time window in hours for oscillation detection
   * Default: 24 hours
   */
  oscillationWindowHours: number;

  /**
   * Minimum trust score threshold for circuit breaker trigger
   * Default: 100 (trust < 100 on 0-1000 scale triggers circuit breaker)
   */
  circuitBreakerThreshold: number;

  /**
   * Number of failures with the same methodology key within the window
   * required to trip the circuit breaker.
   * Default: 3
   */
  methodologyFailureThreshold: number;

  /**
   * Rolling time window in hours for methodology failure detection.
   * Default: 72 hours (3 days)
   */
  methodologyWindowHours: number;

  /**
   * Score threshold (0-1000) for entering degraded mode (soft circuit breaker).
   * When a LOSS drives the score below this value (but above circuitBreakerThreshold),
   * the engine enters 'degraded' state: gains are blocked, losses still apply.
   * Degraded auto-resets after cbDegradedAutoResetMinutes[tier].
   * Default: 200 (T0/T1 boundary — warning zone)
   */
  degradedThreshold: number;

  /**
   * Minutes until automatic recovery from 'degraded' mode, indexed by tier (T0=index 0..T7=index 7).
   * After this timeout the engine resets to 'normal' without admin action.
   * Lower tiers recover faster (sandbox agents get short timeouts).
   * Default: [5, 15, 30, 120, 240, 720, 1440, 2880]  (T0: 5min → T7: 2 days)
   */
  cbDegradedAutoResetMinutes: readonly number[];

  /**
   * Minutes until automatic recovery from 'tripped' state, indexed by tier.
   * null = no auto-reset at that tier; admin override required.
   * T0-T2: auto-reset allowed; T3+: admin required.
   * Default: [15, 60, 120, null, null, null, null, null]
   *          (T0: 15min, T1: 1hr, T2: 2hr; T3-T7: admin only)
   */
  cbTrippedAutoResetMinutes: readonly (number | null)[];
}

/** Default trust dynamics configuration per ATSF v2.0 */
export const DEFAULT_TRUST_DYNAMICS: TrustDynamicsConfig = {
  gainRate: 0.01,                    // Logarithmic gain (slow)
  penaltyRatioMin: 7,                // T0 loss = 7x gainRate (early-stage leniency)
  penaltyRatioMax: 10,               // T7 loss = 10x gainRate (strict at full autonomy)
  cooldownHours: 168,                // 7 days after any drop
  oscillationThreshold: 3,           // 3 direction changes triggers alert
  oscillationWindowHours: 24,        // Within 24 hours
  circuitBreakerThreshold: 100,      // Trust < 100 (on 0-1000 scale) → hard CB trip
  methodologyFailureThreshold: 3,    // 3 same-methodology failures → circuit breaker
  methodologyWindowHours: 72,        // Within 72 hours (3 days)
  degradedThreshold: 200,            // Trust < 200 on a LOSS → degraded mode (warning zone)
  // Per-tier degraded auto-reset (minutes): T0=5min → T7=2 days
  cbDegradedAutoResetMinutes: [5, 15, 30, 120, 240, 720, 1440, 2880] as readonly number[],
  // Per-tier tripped auto-reset (minutes): null = admin required; T0=15min, T1=1hr, T2=2hr, T3+=admin
  cbTrippedAutoResetMinutes: [15, 60, 120, null, null, null, null, null] as readonly (number | null)[],
};

/**
 * Cooldown state for an agent
 */
export interface CooldownState {
  /** Whether the agent is currently in cooldown */
  inCooldown: boolean;
  /** When the cooldown started */
  cooldownStartedAt?: Date;
  /** When the cooldown ends */
  cooldownEndsAt?: Date;
  /** Reason for cooldown */
  reason?: string;
}

/**
 * Direction change entry for oscillation detection
 */
export interface DirectionChange {
  /** Timestamp of the direction change */
  timestamp: Date;
  /** Previous direction: 'gain' or 'loss' */
  from: 'gain' | 'loss';
  /** New direction: 'gain' or 'loss' */
  to: 'gain' | 'loss';
  /** Trust score at time of change (0-1000) */
  scoreAtChange: number;
}

/**
 * Trust dynamics state for an agent
 */
export interface TrustDynamicsState {
  /** Agent ID */
  agentId: string;
  /** Current cooldown state */
  cooldown: CooldownState;
  /** Recent direction changes for oscillation detection */
  directionChanges: DirectionChange[];
  /** Last trust update direction */
  lastDirection: 'gain' | 'loss' | 'none';
  /**
   * Graduated circuit breaker state.
   * 'normal' → 'degraded' (score warning zone) → 'tripped' (hard lock)
   * See CircuitBreakerState for full semantics.
   */
  circuitBreakerState: CircuitBreakerState;
  /**
   * Whether circuit breaker is fully tripped (hard CB).
   * Derived from circuitBreakerState === 'tripped'.
   * Kept for backwards compatibility.
   */
  circuitBreakerTripped: boolean;
  /** Reason for the current circuit breaker event (degraded or tripped) */
  circuitBreakerReason?: string;
  /** When the current circuit breaker event was triggered */
  circuitBreakerTrippedAt?: Date;
  /**
   * Agent tier at the time the circuit breaker event was triggered.
   * Used to select the correct per-tier auto-reset timeout.
   */
  tierAtCbEvent?: number;
  /**
   * Recent failure timestamps keyed by methodology key.
   * Used to detect repeated failures with the same approach.
   */
  methodologyFailures: Record<string, Date[]>;
}

/**
 * Provisional outcome for temporal tracking
 */
export interface ProvisionalOutcome {
  /** Unique outcome ID */
  outcomeId: string;
  /** Associated agent ID */
  agentId: string;
  /** Action that generated this outcome */
  actionId: string;
  /** When the action was recorded */
  recordedAt: Date;
  /** Provisional success indicator */
  provisionalSuccess: boolean;
  /** Magnitude of the outcome (for tail risk detection) */
  magnitude: number;
  /** Risk profile determining outcome window */
  riskProfile: RiskProfile;
  /** When the outcome window closes */
  outcomeWindowEnds: Date;
  /** Final success (null if not yet finalized) */
  finalSuccess: boolean | null;
  /** Final magnitude (null if not yet finalized) */
  finalMagnitude: number | null;
  /** Whether this was a reversal (provisional success → final failure) */
  wasReversal: boolean;
}
