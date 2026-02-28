/**
 * Trust Profile types - represents an agent's current trust state
 */

import type { ObservationTier, TrustBand } from "./enums.js";

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
  | "automated" // Standard system observations (1x weight)
  | "hitl_approval" // Human-in-the-loop approval (5x weight)
  | "hitl_rejection" // Human rejection/correction (5x weight)
  | "examination" // Formal examination result (3x weight)
  | "audit" // Third-party audit finding (3x weight)
  | "sandbox_test" // Shadow/testnet observation (0.5x weight)
  | "peer_review"; // Cross-agent endorsement (2x weight)

/**
 * Default evidence type multipliers
 *
 * These multipliers solve the 1000-event cold-start problem by giving
 * HITL approvals significantly more weight than automated observations.
 */
export const EVIDENCE_TYPE_MULTIPLIERS: Record<EvidenceType, number> = {
  automated: 1.0,
  hitl_approval: 5.0, // HITL approval = 5 automated observations
  hitl_rejection: 5.0, // HITL rejection impact is also amplified
  examination: 3.0, // Formal exams count more
  audit: 3.0, // Audits are authoritative
  sandbox_test: 0.5, // Sandbox/testnet observations count less (unverified)
  peer_review: 2.0, // Cross-agent reviews have moderate weight
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
  /** Daily decay rate for stale evidence */
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
  IMMEDIATE = "IMMEDIATE",
  /** 4 hours - API calls */
  SHORT_TERM = "SHORT_TERM",
  /** 3 days - simple transactions */
  MEDIUM_TERM = "MEDIUM_TERM",
  /** 30 days - financial trades */
  LONG_TERM = "LONG_TERM",
  /** 90 days - investments */
  EXTENDED = "EXTENDED",
}

/** Outcome windows in milliseconds for each risk profile */
export const RISK_PROFILE_WINDOWS: Record<RiskProfile, number> = {
  [RiskProfile.IMMEDIATE]: 5 * 60 * 1000, // 5 minutes
  [RiskProfile.SHORT_TERM]: 4 * 60 * 60 * 1000, // 4 hours
  [RiskProfile.MEDIUM_TERM]: 3 * 24 * 60 * 60 * 1000, // 3 days
  [RiskProfile.LONG_TERM]: 30 * 24 * 60 * 60 * 1000, // 30 days
  [RiskProfile.EXTENDED]: 90 * 24 * 60 * 60 * 1000, // 90 days
};

/**
 * Configuration for asymmetric trust dynamics
 * Per ATSF v2.0: "Trust is hard to gain, easy to lose" (10:1 ratio)
 */
export interface TrustDynamicsConfig {
  /**
   * Logarithmic gain rate for positive evidence
   * Trust gain formula: delta = gainRate * log(1 + (ceiling - current))
   * Default: 0.01 (slow gain)
   */
  gainRate: number;

  /**
   * Exponential loss rate for negative evidence
   * Trust loss formula: delta = -lossRate * current
   * Default: 0.10 (10x faster than gain)
   */
  lossRate: number;

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
   * Penalty multiplier for outcome reversals
   * When provisional success becomes final failure
   * Default: 2.0 (2x normal failure penalty)
   */
  reversalPenaltyMultiplier: number;

  /**
   * Minimum trust score threshold for circuit breaker trigger
   * Default: 100 (trust < 100 on 0-1000 scale triggers circuit breaker)
   */
  circuitBreakerThreshold: number;
}

/** Default trust dynamics configuration per ATSF v2.0 */
export const DEFAULT_TRUST_DYNAMICS: TrustDynamicsConfig = {
  gainRate: 0.01, // Logarithmic gain (slow)
  lossRate: 0.1, // Exponential loss (10x faster)
  cooldownHours: 168, // 7 days after any drop
  oscillationThreshold: 3, // 3 direction changes triggers alert
  oscillationWindowHours: 24, // Within 24 hours
  reversalPenaltyMultiplier: 2.0, // 2x penalty for reversals
  circuitBreakerThreshold: 100, // Trust < 100 (on 0-1000 scale) triggers circuit breaker
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
  from: "gain" | "loss";
  /** New direction: 'gain' or 'loss' */
  to: "gain" | "loss";
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
  lastDirection: "gain" | "loss" | "none";
  /** Whether circuit breaker is tripped */
  circuitBreakerTripped: boolean;
  /** Reason for circuit breaker if tripped */
  circuitBreakerReason?: string;
  /** When circuit breaker was tripped */
  circuitBreakerTrippedAt?: Date;
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
