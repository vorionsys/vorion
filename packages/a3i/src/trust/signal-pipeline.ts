/**
 * Trust Signal Pipeline - Pattern C Bridge
 *
 * Connects the two trust engines:
 * - Fast lane: TrustDynamicsEngine (real-time, event-driven, in-memory stateful)
 * - Slow lane: TrustProfileService (evidence aggregation, durable, full 16-factor)
 *
 * Flow: Signal → TrustDynamicsEngine → delta → TrustEvidence → TrustProfileService
 *
 * The fast lane computes a real-time delta using asymmetric scoring rules
 * (logarithmic gain, tier-scaled loss, cooldown, circuit breaker).
 * The delta is then written as TrustEvidence into the slow lane so that the
 * full 16-factor profile stays current without re-reading all historical data.
 *
 * The slow lane's adjustedScore feeds back into the fast lane as currentScore
 * on the next signal, closing the loop.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ObservationTier,
  OBSERVATION_CEILINGS,
  type TrustEvidence,
  type TrustProfile,
} from '@vorionsys/contracts';

import { TrustDynamicsEngine, type TrustUpdateResult } from './trust-dynamics.js';
import { TrustProfileService } from './profile-service.js';

// ============================================================
// Types
// ============================================================

/**
 * A behavioral signal from the system — the atomic unit fed into the pipeline
 */
export interface SignalInput {
  /** Agent whose trust is affected */
  agentId: string;
  /** Whether the signal represents a positive or negative outcome */
  success: boolean;
  /**
   * Factor code this signal affects on the 16-factor model (e.g. 'SA-SAFE', 'CT-COMP').
   * Used as the factorCode on the resulting TrustEvidence for the slow lane.
   */
  factorCode: string;
  /**
   * Optional methodology key for repeat-failure tracking in the fast lane.
   * Identifies the approach/category (e.g. 'safety:harm_refusal', 'SA-SAFE').
   * Defaults to factorCode when not specified.
   */
  methodologyKey?: string;
  /** Optional magnitude multiplier passed to the dynamics engine */
  magnitude?: number;
  /** Whether this is an outcome reversal (provisional success → final failure) */
  isReversal?: boolean;
  /** Time reference for deterministic testing */
  now?: Date;
}

/**
 * Result of processing a signal through both lanes
 */
export interface SignalResult {
  /** Real-time result from the fast lane */
  dynamicsResult: TrustUpdateResult;
  /**
   * Profile after slow-lane update, or the unchanged profile if the
   * update was blocked. Null if no profile existed and creation failed.
   */
  profile: TrustProfile | null;
  /**
   * Evidence record written to the slow lane.
   * Null when blocked by cooldown or circuit breaker.
   */
  evidence: TrustEvidence | null;
  /** True when no evidence was written to the slow lane */
  blocked: boolean;
  /**
   * Reason for blocking when blocked=true:
   * - 'circuit_breaker' : hard CB tripped — agent locked until reset
   * - 'degraded'        : soft CB — gain blocked, losses still apply; auto-resets per tier
   * - 'cooldown'        : cooldown active after a loss; gain blocked temporarily
   * - 'zero_delta'      : delta was 0 (e.g. gain at ceiling); nothing to persist
   */
  blockReason?: 'circuit_breaker' | 'degraded' | 'cooldown' | 'zero_delta';
}

/**
 * Configuration for the pipeline
 */
export interface SignalPipelineConfig {
  /**
   * Observation tier used when creating a profile for a new agent.
   * @default ObservationTier.BLACK_BOX
   */
  defaultObservationTier?: ObservationTier;
  /**
   * Source label on generated evidence records.
   * @default 'trust_dynamics'
   */
  evidenceSource?: string;
}

// ============================================================
// Constants
// ============================================================

/**
 * Baseline trust score used for fast-lane dynamics when no profile exists yet.
 *
 * Zero-trust default: 1 (not 500). A new agent starts at the absolute minimum.
 * Any failure from score 1 immediately trips the hard circuit breaker.
 * T0 (Sandbox) CB auto-resets in 15 minutes, giving the agent a redemption path
 * without requiring admin intervention at the lowest tier.
 */
const BASELINE_SCORE = 1;

// ============================================================
// Pipeline
// ============================================================

/**
 * TrustSignalPipeline - Pattern C bridge between fast and slow trust lanes
 *
 * Usage:
 * ```ts
 * const pipeline = createSignalPipeline(dynamics, profiles);
 * const result = await pipeline.process({
 *   agentId: 'agent-123',
 *   success: false,
 *   factorCode: 'SA-SAFE',
 *   methodologyKey: 'safety:harm_refusal',
 * });
 * ```
 */
export class TrustSignalPipeline {
  private readonly dynamics: TrustDynamicsEngine;
  private readonly profiles: TrustProfileService;
  private readonly config: Required<SignalPipelineConfig>;

  constructor(
    dynamics: TrustDynamicsEngine,
    profiles: TrustProfileService,
    config: SignalPipelineConfig = {}
  ) {
    this.dynamics = dynamics;
    this.profiles = profiles;
    this.config = {
      defaultObservationTier: config.defaultObservationTier ?? ObservationTier.BLACK_BOX,
      evidenceSource: config.evidenceSource ?? 'trust_dynamics',
    };
  }

  /**
   * Process a behavioral signal through both trust lanes.
   *
   * 1. Read current profile (slow lane) to get adjustedScore and tier
   * 2. Run fast lane (dynamics) to compute real-time delta
   * 3. If not blocked: convert delta → TrustEvidence → update slow lane
   * 4. Return combined result
   */
  async process(signal: SignalInput): Promise<SignalResult> {
    const now = signal.now ?? new Date();

    // ── Step 1: Read slow lane for current state ──
    const profile = await this.profiles.get(signal.agentId);
    const currentScore = profile?.adjustedScore ?? BASELINE_SCORE;
    const observationTier = profile?.observationTier ?? this.config.defaultObservationTier;
    const tier = profile?.band ?? 0;
    const ceiling = OBSERVATION_CEILINGS[observationTier];

    // ── Step 2: Fast lane — compute dynamics delta ──
    const dynamicsResult = this.dynamics.updateTrust(signal.agentId, {
      currentScore,
      success: signal.success,
      ceiling,
      tier,
      magnitude: signal.magnitude,
      isReversal: signal.isReversal,
      methodologyKey: signal.methodologyKey ?? signal.factorCode,
      now,
    });

    // ── Step 3a: Circuit breaker — don't write evidence ──
    if (dynamicsResult.circuitBreakerTripped) {
      return {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'circuit_breaker',
      };
    }

    // ── Step 3b: Degraded CB blocked gain — no-op ──
    if (dynamicsResult.blockedByDegraded) {
      return {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'degraded',
      };
    }

    // ── Step 3c: Cooldown blocked gain — no-op ──
    if (dynamicsResult.blockedByCooldown) {
      return {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'cooldown',
      };
    }

    // ── Step 3d: Zero delta — nothing to persist ──
    if (dynamicsResult.delta === 0) {
      return {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'zero_delta',
      };
    }

    // ── Step 3e: Convert delta → TrustEvidence ──
    const evidence: TrustEvidence = {
      evidenceId: uuidv4(),
      factorCode: signal.factorCode,
      impact: dynamicsResult.delta,  // 0-1000 scale, matches TrustCalculator expectations
      source: this.config.evidenceSource,
      collectedAt: now,
      evidenceType: 'automated',
    };

    // ── Step 4: Slow lane — persist evidence ──
    let updatedProfile: TrustProfile | null = profile;

    if (profile) {
      const result = await this.profiles.update(signal.agentId, [evidence], { now });
      updatedProfile = result.profile ?? profile;
    } else {
      // First signal for this agent — create the profile
      const createResult = await this.profiles.create(
        signal.agentId,
        observationTier,
        [evidence],
        { now }
      );
      updatedProfile = createResult.profile ?? null;
    }

    return {
      dynamicsResult,
      profile: updatedProfile,
      evidence,
      blocked: false,
    };
  }
}

/**
 * Create a TrustSignalPipeline with the given engines and configuration
 */
export function createSignalPipeline(
  dynamics: TrustDynamicsEngine,
  profiles: TrustProfileService,
  config?: SignalPipelineConfig
): TrustSignalPipeline {
  return new TrustSignalPipeline(dynamics, profiles, config);
}
