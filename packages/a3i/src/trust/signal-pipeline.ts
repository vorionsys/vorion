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
   * - 'rate_limited'    : agent exceeded signal rate limit; dropped before processing
   */
  blockReason?: 'circuit_breaker' | 'degraded' | 'cooldown' | 'zero_delta' | 'rate_limited';
}

/**
 * Blocked signal event — emitted via onBlocked for forensic audit trail
 */
export interface BlockedSignalEvent {
  agentId: string;
  factorCode: string;
  blockReason: NonNullable<SignalResult['blockReason']>;
  timestamp: Date;
  signal: SignalInput;
  dynamicsResult?: TrustUpdateResult;
}

/**
 * Metrics event — emitted via onSignalProcessed after every signal
 */
export interface SignalMetrics {
  agentId: string;
  factorCode: string;
  success: boolean;
  blocked: boolean;
  blockReason?: SignalResult['blockReason'];
  delta: number;
  durationMs: number;
  timestamp: Date;
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
  /**
   * Error handler for fire-and-forget dispatches via `dispatchSignal()`.
   * Called when a dispatched signal fails processing.
   * @default logs to console.error
   */
  onDispatchError?: (error: unknown, signal: SignalInput) => void;

  // ── P2: Rate limiting ──

  /**
   * Maximum signals per agent within the rate limit window.
   * Excess signals are dropped with blockReason 'rate_limited'.
   * Set to 0 to disable rate limiting.
   * @default 0 (disabled)
   */
  rateLimitPerAgent?: number;
  /**
   * Rate limit window in milliseconds.
   * @default 60000 (1 minute)
   */
  rateLimitWindowMs?: number;

  // ── P2: Audit trail ──

  /**
   * Called whenever a signal is blocked (CB, cooldown, degraded, rate limit, zero_delta).
   * Use for forensic audit logging and compliance.
   */
  onBlocked?: (event: BlockedSignalEvent) => void;

  // ── P3: Metrics / observability ──

  /**
   * Called after every signal completes processing (blocked or not).
   * Use for metrics collection, dashboards, alerting.
   */
  onSignalProcessed?: (metrics: SignalMetrics) => void;
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
 *
 * // Awaited (use in canary, API handlers, etc.)
 * const result = await pipeline.process({
 *   agentId: 'agent-123',
 *   success: false,
 *   factorCode: 'SA-SAFE',
 *   methodologyKey: 'safety:harm_refusal',
 * });
 *
 * // Fire-and-forget with error capture (use in gate, orchestrator)
 * pipeline.dispatchSignal({
 *   agentId: 'agent-123',
 *   success: true,
 *   factorCode: 'CT-COMP',
 * });
 * ```
 */
export class TrustSignalPipeline {
  private readonly dynamics: TrustDynamicsEngine;
  private readonly profiles: TrustProfileService;
  private readonly config: Required<SignalPipelineConfig>;

  /**
   * Per-agent promise chain for serialization.
   * Concurrent signals for the SAME agent are queued; different agents run in parallel.
   * This prevents race conditions between the fast-lane read of adjustedScore
   * and the slow-lane profile update.
   */
  private readonly agentLocks: Map<string, Promise<SignalResult>> = new Map();

  /**
   * Per-agent sliding window for rate limiting.
   * Stores timestamps of recent signals within the rate limit window.
   */
  private readonly rateLimitWindows: Map<string, number[]> = new Map();

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
      onDispatchError: config.onDispatchError ?? ((error, signal) => {
        console.error('[TrustSignalPipeline] dispatch error for agent', signal.agentId, error);
      }),
      rateLimitPerAgent: config.rateLimitPerAgent ?? 0,
      rateLimitWindowMs: config.rateLimitWindowMs ?? 60_000,
      onBlocked: config.onBlocked ?? (() => {}),
      onSignalProcessed: config.onSignalProcessed ?? (() => {}),
    };
  }

  /**
   * Process a behavioral signal through both trust lanes.
   *
   * Signals for the same agentId are serialized (queued) to prevent
   * race conditions. Signals for different agents run concurrently.
   *
   * 1. Read current profile (slow lane) to get adjustedScore and tier
   * 2. Run fast lane (dynamics) to compute real-time delta
   * 3. If not blocked: convert delta → TrustEvidence → update slow lane
   * 4. Return combined result
   */
  async process(signal: SignalInput): Promise<SignalResult> {
    // Chain onto any in-flight processing for this agent
    const previous = this.agentLocks.get(signal.agentId) ?? Promise.resolve(null as unknown as SignalResult);
    const current = previous.then(
      () => this.processInternal(signal),
      () => this.processInternal(signal) // Still process even if previous failed
    );
    this.agentLocks.set(signal.agentId, current);

    try {
      return await current;
    } finally {
      // Clean up lock if this was the last in the chain
      if (this.agentLocks.get(signal.agentId) === current) {
        this.agentLocks.delete(signal.agentId);
      }
    }
  }

  /**
   * Fire-and-forget signal dispatch with error capture.
   *
   * Use this instead of `pipeline.process({...}).catch(() => {})`.
   * Errors are routed to the configured `onDispatchError` handler
   * rather than being silently swallowed.
   */
  dispatchSignal(signal: SignalInput): void {
    this.process(signal).catch((error) => {
      this.config.onDispatchError(error, signal);
    });
  }

  /**
   * Check and enforce per-agent rate limit.
   * Returns true if the signal should be dropped.
   */
  private isRateLimited(agentId: string, nowMs: number): boolean {
    const limit = this.config.rateLimitPerAgent;
    if (limit <= 0) return false; // disabled

    const windowMs = this.config.rateLimitWindowMs;
    const cutoff = nowMs - windowMs;

    // Get or create the sliding window for this agent
    let timestamps = this.rateLimitWindows.get(agentId);
    if (!timestamps) {
      timestamps = [];
      this.rateLimitWindows.set(agentId, timestamps);
    }

    // Evict expired entries
    while (timestamps.length > 0 && timestamps[0]! < cutoff) {
      timestamps.shift();
    }

    // Check limit
    if (timestamps.length >= limit) {
      return true;
    }

    // Record this signal
    timestamps.push(nowMs);
    return false;
  }

  /**
   * Emit a blocked signal event to the audit trail callback.
   */
  private emitBlocked(
    signal: SignalInput,
    blockReason: NonNullable<SignalResult['blockReason']>,
    now: Date,
    dynamicsResult?: TrustUpdateResult
  ): void {
    this.config.onBlocked({
      agentId: signal.agentId,
      factorCode: signal.factorCode,
      blockReason,
      timestamp: now,
      signal,
      dynamicsResult,
    });
  }

  /**
   * Emit metrics for a processed signal.
   */
  private emitMetrics(
    signal: SignalInput,
    result: SignalResult,
    now: Date,
    startMs: number
  ): void {
    this.config.onSignalProcessed({
      agentId: signal.agentId,
      factorCode: signal.factorCode,
      success: signal.success,
      blocked: result.blocked,
      blockReason: result.blockReason,
      delta: result.dynamicsResult?.delta ?? 0,
      durationMs: Date.now() - startMs,
      timestamp: now,
    });
  }

  /**
   * Internal processing — the actual pipeline logic.
   * Called within the per-agent serialization chain.
   */
  private async processInternal(signal: SignalInput): Promise<SignalResult> {
    const now = signal.now ?? new Date();
    const startMs = Date.now();

    // ── Step 0: Rate limit check (before any processing) ──
    if (this.isRateLimited(signal.agentId, now.getTime())) {
      const result: SignalResult = {
        dynamicsResult: {
          delta: 0,
          newScore: 0,
          circuitBreakerTripped: false,
          circuitBreakerDegraded: false,
          blockedByCooldown: false,
          blockedByDegraded: false,
        } as TrustUpdateResult,
        profile: null,
        evidence: null,
        blocked: true,
        blockReason: 'rate_limited',
      };
      this.emitBlocked(signal, 'rate_limited', now);
      this.emitMetrics(signal, result, now, startMs);
      return result;
    }

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
      const result: SignalResult = {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'circuit_breaker',
      };
      this.emitBlocked(signal, 'circuit_breaker', now, dynamicsResult);
      this.emitMetrics(signal, result, now, startMs);
      return result;
    }

    // ── Step 3b: Degraded CB blocked gain — no-op ──
    if (dynamicsResult.blockedByDegraded) {
      const result: SignalResult = {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'degraded',
      };
      this.emitBlocked(signal, 'degraded', now, dynamicsResult);
      this.emitMetrics(signal, result, now, startMs);
      return result;
    }

    // ── Step 3c: Cooldown blocked gain — no-op ──
    if (dynamicsResult.blockedByCooldown) {
      const result: SignalResult = {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'cooldown',
      };
      this.emitBlocked(signal, 'cooldown', now, dynamicsResult);
      this.emitMetrics(signal, result, now, startMs);
      return result;
    }

    // ── Step 3d: Zero delta — nothing to persist ──
    if (dynamicsResult.delta === 0) {
      const result: SignalResult = {
        dynamicsResult,
        profile,
        evidence: null,
        blocked: true,
        blockReason: 'zero_delta',
      };
      this.emitBlocked(signal, 'zero_delta', now, dynamicsResult);
      this.emitMetrics(signal, result, now, startMs);
      return result;
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
      const pResult = await this.profiles.update(signal.agentId, [evidence], { now });
      updatedProfile = pResult.profile ?? profile;
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

    const result: SignalResult = {
      dynamicsResult,
      profile: updatedProfile,
      evidence,
      blocked: false,
    };
    this.emitMetrics(signal, result, now, startMs);
    return result;
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
