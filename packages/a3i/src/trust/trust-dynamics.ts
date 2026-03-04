/**
 * Trust Dynamics - Asymmetric trust updates per ATSF v2.0
 *
 * Implements:
 * - Logarithmic gain (slow trust building)
 * - Exponential loss (fast trust loss, 7-10x ratio, tier-scaled)
 * - Cooldown periods (7 days after any trust drop)
 * - Oscillation detection (circuit breaker trigger)
 * - Graduated circuit breaker: normal → degraded → tripped
 * - Tier-aware auto-reset: T0 sandbox resets in 15min; T3+ require admin
 *
 * Key principle: "Trust is hard to gain, easy to lose"
 *
 * Zero-trust default: new agents start at score 1, not at the neutral midpoint.
 * Any failure from score 1 immediately trips the CB (T0: 15min auto-reset).
 */

import {
  type TrustDynamicsConfig,
  type TrustDynamicsState,
  type CooldownState,
  type CircuitBreakerState,
  DEFAULT_TRUST_DYNAMICS,
} from '@vorionsys/contracts';

/**
 * Result of a trust update operation
 */
export interface TrustUpdateResult {
  /** New trust score after update */
  newScore: number;
  /** Delta applied (can be 0 if blocked) */
  delta: number;
  /** Whether the update was blocked by cooldown */
  blockedByCooldown: boolean;
  /** Whether the update was blocked by degraded circuit breaker state */
  blockedByDegraded: boolean;
  /** Whether this triggered or is currently in a hard circuit breaker trip */
  circuitBreakerTripped: boolean;
  /** Reason for circuit breaker event if active */
  circuitBreakerReason?: string;
  /** Whether the circuit breaker is in degraded (soft CB) state */
  circuitBreakerDegraded: boolean;
  /** Current circuit breaker state */
  circuitBreakerState: CircuitBreakerState;
  /** Whether oscillation was detected */
  oscillationDetected: boolean;
  /** Updated dynamics state */
  state: TrustDynamicsState;
}

/**
 * Options for trust update
 */
export interface TrustUpdateOptions {
  /** Current trust score (0-1000) — sourced from TrustProfile.adjustedScore */
  currentScore: number;
  /** Whether the observation was successful */
  success: boolean;
  /** Trust ceiling based on observation tier (0-1000) — from OBSERVATION_CEILINGS */
  ceiling: number;
  /** Magnitude of the outcome (for weighted updates) */
  magnitude?: number;
  /**
   * Whether this is an outcome reversal (provisional success → final failure).
   * Used for audit logging and cooldown labeling only — does NOT apply an
   * extra penalty multiplier (that would be double jeopardy).
   */
  isReversal?: boolean;
  /**
   * Current trust tier (0-7). Determines the failure penalty ratio and CB reset times.
   * T0 uses penaltyRatioMin (lenient) and auto-resets CB in 15 min.
   * T7 uses penaltyRatioMax (strict) and requires admin to reset CB.
   * Defaults to 0 (most lenient / quickest CB recovery).
   */
  tier?: number;
  /**
   * Methodology key for repeat-failure detection.
   * Identifies the approach/category of the action (e.g. factorCode, signal type,
   * tool name). When the same key fails `methodologyFailureThreshold` times within
   * `methodologyWindowHours`, the circuit breaker trips (hard) with reason
   * `repeat_methodology_failure`.
   * Optional — no tracking if omitted.
   */
  methodologyKey?: string;
  /** Current time (for testing) */
  now?: Date;
}

/**
 * TrustDynamicsEngine - Implements asymmetric trust scoring with graduated circuit breaker
 *
 * Circuit breaker states:
 *   normal   → first significant loss → degraded (gains blocked, auto-reset per tier)
 *   degraded → score drops below hard threshold → tripped (all blocked, tier-dep reset)
 *   tripped  → T0-T2 auto-reset, T3+ admin required
 *
 * Zero-trust: new agents begin at score 1 (in the pipeline layer). A failure from
 * score 1 drops the newScore below circuitBreakerThreshold (100) → immediate hard trip.
 * T0 auto-resets in 15 minutes — giving the sandbox a quick redemption path.
 */
export class TrustDynamicsEngine {
  private readonly config: TrustDynamicsConfig;
  private readonly states: Map<string, TrustDynamicsState> = new Map();

  constructor(config: Partial<TrustDynamicsConfig> = {}) {
    this.config = { ...DEFAULT_TRUST_DYNAMICS, ...config };
  }

  /**
   * Get or create dynamics state for an agent
   */
  getState(agentId: string): TrustDynamicsState {
    let state = this.states.get(agentId);
    if (!state) {
      state = this.createInitialState(agentId);
      this.states.set(agentId, state);
    }
    return state;
  }

  /**
   * Create initial dynamics state for a new agent
   */
  private createInitialState(agentId: string): TrustDynamicsState {
    return {
      agentId,
      cooldown: { inCooldown: false },
      directionChanges: [],
      lastDirection: 'none',
      circuitBreakerState: 'normal',
      circuitBreakerTripped: false,
      methodologyFailures: {},
    };
  }

  /**
   * Update trust score with asymmetric dynamics
   *
   * Gain: delta = gainRate * log(1 + (ceiling - current))
   * Loss: delta = -lossRate * current  (lossRate = gainRate * penaltyRatio(tier))
   *
   * Gain is blocked during cooldown AND during degraded CB state.
   * Hard CB blocks all updates. Tier-aware auto-reset clears CB automatically for
   * low-tier agents (T0: 15min, T1: 1hr, T2: 2hr); T3+ require admin.
   */
  updateTrust(agentId: string, options: TrustUpdateOptions): TrustUpdateResult {
    const now = options.now ?? new Date();
    const tier = options.tier ?? 0;
    const state = this.getState(agentId);

    // Auto-reset CB if the per-tier timeout has passed
    this.checkAndAutoResetCb(state, tier, now);

    // Hard CB: block ALL updates immediately
    if (state.circuitBreakerState === 'tripped') {
      return {
        newScore: options.currentScore,
        delta: 0,
        blockedByCooldown: false,
        blockedByDegraded: false,
        circuitBreakerTripped: true,
        circuitBreakerReason: state.circuitBreakerReason,
        circuitBreakerDegraded: false,
        circuitBreakerState: 'tripped',
        oscillationDetected: false,
        state,
      };
    }

    // Update cooldown state
    this.updateCooldownState(state, now);

    // Calculate delta based on success/failure
    let delta: number;
    let blockedByCooldown = false;
    let blockedByDegraded = false;
    const direction: 'gain' | 'loss' = options.success ? 'gain' : 'loss';

    if (options.success) {
      delta = this.calculateGain(options.currentScore, options.ceiling);

      // Block gain during degraded CB (soft CB: gains suppressed, losses still land).
      // Degraded is checked first — it's the semantically significant state.
      // Cooldown may also be active concurrently; once degraded auto-resets, cooldown takes over.
      if (state.circuitBreakerState === 'degraded') {
        delta = 0;
        blockedByDegraded = true;
      }
      // Block gain during cooldown (only if degraded is not already blocking)
      else if (state.cooldown.inCooldown) {
        delta = 0;
        blockedByCooldown = true;
      }
    } else {
      // Tier-scaled exponential loss (isReversal used for labeling only, no extra penalty)
      delta = this.calculateLoss(options.currentScore, tier);
      this.startCooldown(state, now, options.isReversal ? 'outcome_reversal' : 'trust_loss');
    }

    // Track direction changes for oscillation detection
    const oscillationDetected = this.trackDirectionChange(state, direction, options.currentScore, now);

    // Apply delta
    const newScore = this.clampScore(options.currentScore + delta, 0, options.ceiling);

    // ── Circuit breaker evaluation ──
    let circuitBreakerTripped = false;
    let circuitBreakerReason: string | undefined;

    if (oscillationDetected) {
      // Oscillation = behavioral anomaly → hard trip immediately (skip degraded step)
      circuitBreakerTripped = true;
      circuitBreakerReason = 'oscillation_detected';
      this.tripCircuitBreaker(state, circuitBreakerReason, tier, now);
    } else if (!options.success) {
      // Score-based CB checks only on losses (gains from low baseline don't trip CB)
      if (newScore < this.config.circuitBreakerThreshold) {
        // Score dropped below hard floor → hard trip (also escalates from degraded)
        circuitBreakerTripped = true;
        circuitBreakerReason = 'trust_below_threshold';
        this.tripCircuitBreaker(state, circuitBreakerReason, tier, now);
      } else if (
        newScore < this.config.degradedThreshold &&
        state.circuitBreakerState === 'normal'
      ) {
        // Score dropped into warning zone (between degradedThreshold and hard threshold)
        // → enter degraded mode (gains blocked, auto-resets per tier)
        this.enterDegradedMode(state, tier, 'trust_near_threshold', now);
      }

      // Methodology check: always run on failures, independent of score-CB path
      // Hard trip immediately (repeat bad pattern = deliberate, not gradual)
      if (!circuitBreakerTripped && options.methodologyKey) {
        const methodologyTripped = this.trackMethodologyFailure(state, options.methodologyKey, now);
        if (methodologyTripped) {
          circuitBreakerTripped = true;
          circuitBreakerReason = `repeat_methodology_failure:${options.methodologyKey}`;
          this.tripCircuitBreaker(state, circuitBreakerReason, tier, now);
        }
      }
    }

    // Update last direction
    state.lastDirection = direction;

    return {
      newScore,
      delta,
      blockedByCooldown,
      blockedByDegraded,
      circuitBreakerTripped,
      circuitBreakerReason,
      circuitBreakerDegraded: state.circuitBreakerState === 'degraded',
      circuitBreakerState: state.circuitBreakerState,
      oscillationDetected,
      state,
    };
  }

  // ============================================================
  // Private: Circuit Breaker State Machine
  // ============================================================

  /**
   * Enter degraded mode (soft CB).
   * Gains become blocked; losses still apply; auto-resets per tier.
   */
  private enterDegradedMode(
    state: TrustDynamicsState,
    tier: number,
    reason: string,
    now: Date
  ): void {
    state.circuitBreakerState = 'degraded';
    state.circuitBreakerTripped = false;  // degraded is NOT a full trip
    state.circuitBreakerReason = reason;
    state.circuitBreakerTrippedAt = now;
    state.tierAtCbEvent = tier;
  }

  /**
   * Trip the circuit breaker to hard 'tripped' state.
   * Blocks all updates until admin reset or tier-appropriate timeout.
   */
  private tripCircuitBreaker(
    state: TrustDynamicsState,
    reason: string,
    tier: number,
    now: Date
  ): void {
    state.circuitBreakerState = 'tripped';
    state.circuitBreakerTripped = true;
    state.circuitBreakerReason = reason;
    state.circuitBreakerTrippedAt = now;
    state.tierAtCbEvent = tier;
  }

  /**
   * Check if any CB auto-reset timeout has elapsed and silently clear the CB state.
   * Called at the start of every updateTrust() call — no action needed by the caller.
   *
   * T0 sandbox: degraded auto-resets in 5min, tripped in 15min.
   * T3+: tripped state NEVER auto-resets (admin required).
   */
  private checkAndAutoResetCb(state: TrustDynamicsState, tier: number, now: Date): void {
    if (state.circuitBreakerState === 'normal') return;

    const cbTier = state.tierAtCbEvent ?? tier;
    const cbAt = state.circuitBreakerTrippedAt;
    if (!cbAt) return;

    const elapsedMs = now.getTime() - cbAt.getTime();

    if (state.circuitBreakerState === 'degraded') {
      const resetMin =
        this.config.cbDegradedAutoResetMinutes[cbTier] ??
        this.config.cbDegradedAutoResetMinutes[0]!;
      if (elapsedMs >= resetMin * 60_000) {
        this.clearCbState(state);
      }
    } else if (state.circuitBreakerState === 'tripped') {
      const resetMin = this.config.cbTrippedAutoResetMinutes[cbTier];
      if (resetMin !== null && resetMin !== undefined) {
        if (elapsedMs >= resetMin * 60_000) {
          this.clearCbState(state);
        }
      }
      // If resetMin is null: no auto-reset, admin override required
    }
  }

  /**
   * Clear all CB state back to normal.
   * Resets CB flags, clears oscillation history, methodology failures, and cooldown
   * (CB reset = full redemption path — clearing the cooldown is part of the fresh start).
   */
  private clearCbState(state: TrustDynamicsState): void {
    state.circuitBreakerState = 'normal';
    state.circuitBreakerTripped = false;
    state.circuitBreakerReason = undefined;
    state.circuitBreakerTrippedAt = undefined;
    state.tierAtCbEvent = undefined;
    state.directionChanges = [];
    state.methodologyFailures = {};
    state.cooldown = { inCooldown: false };
  }

  // ============================================================
  // Private: Score Calculations
  // ============================================================

  /**
   * Calculate trust gain using logarithmic formula
   * delta = gainRate * log(1 + (ceiling - current))
   *
   * This creates diminishing returns as trust approaches ceiling
   */
  private calculateGain(currentScore: number, ceiling: number): number {
    const headroom = Math.max(0, ceiling - currentScore);
    const delta = this.config.gainRate * Math.log(1 + headroom);
    return Math.max(0, delta);
  }

  /**
   * Calculate trust loss using tier-scaled exponential formula
   * effectiveLossRate = gainRate * penaltyRatio(tier)
   * delta = -effectiveLossRate * current
   *
   * penaltyRatio scales linearly from penaltyRatioMin at T0 to penaltyRatioMax at T7.
   * A single penalty mechanism is used — no stacking of separate multipliers.
   */
  private calculateLoss(currentScore: number, tier: number = 0): number {
    const clampedTier = Math.max(0, Math.min(7, tier));
    const penaltyRatio =
      this.config.penaltyRatioMin +
      (clampedTier / 7) * (this.config.penaltyRatioMax - this.config.penaltyRatioMin);
    const effectiveLossRate = this.config.gainRate * penaltyRatio;
    return -effectiveLossRate * currentScore;
  }

  // ============================================================
  // Private: Cooldown
  // ============================================================

  private updateCooldownState(state: TrustDynamicsState, now: Date): void {
    if (state.cooldown.inCooldown && state.cooldown.cooldownEndsAt) {
      if (now >= state.cooldown.cooldownEndsAt) {
        state.cooldown = { inCooldown: false };
      }
    }
  }

  private startCooldown(state: TrustDynamicsState, now: Date, reason: string): void {
    const cooldownMs = this.config.cooldownHours * 60 * 60 * 1000;
    state.cooldown = {
      inCooldown: true,
      cooldownStartedAt: now,
      cooldownEndsAt: new Date(now.getTime() + cooldownMs),
      reason,
    };
  }

  // ============================================================
  // Private: Oscillation Detection
  // ============================================================

  private trackDirectionChange(
    state: TrustDynamicsState,
    newDirection: 'gain' | 'loss',
    currentScore: number,
    now: Date
  ): boolean {
    if (state.lastDirection !== 'none' && state.lastDirection !== newDirection) {
      state.directionChanges.push({
        timestamp: now,
        from: state.lastDirection,
        to: newDirection,
        scoreAtChange: currentScore,
      });
    }

    const windowMs = this.config.oscillationWindowHours * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - windowMs);
    state.directionChanges = state.directionChanges.filter((dc) => dc.timestamp >= cutoff);

    return state.directionChanges.length >= this.config.oscillationThreshold;
  }

  // ============================================================
  // Private: Methodology Failure Tracking
  // ============================================================

  /**
   * Track a failure for a specific methodology key.
   * Prunes timestamps outside the rolling window, then checks if the threshold
   * has been reached. Returns true if the circuit breaker should trip.
   */
  private trackMethodologyFailure(
    state: TrustDynamicsState,
    methodologyKey: string,
    now: Date
  ): boolean {
    if (!state.methodologyFailures[methodologyKey]) {
      state.methodologyFailures[methodologyKey] = [];
    }

    state.methodologyFailures[methodologyKey]!.push(now);

    const windowMs = this.config.methodologyWindowHours * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - windowMs);
    state.methodologyFailures[methodologyKey] = state.methodologyFailures[
      methodologyKey
    ]!.filter((ts) => ts >= cutoff);

    return (
      state.methodologyFailures[methodologyKey]!.length >=
      this.config.methodologyFailureThreshold
    );
  }

  // ============================================================
  // Private: Utilities
  // ============================================================

  private clampScore(score: number, min: number, max: number): number {
    return Math.round(Math.max(min, Math.min(max, score)) * 100) / 100;
  }

  // ============================================================
  // Public: Queries
  // ============================================================

  /**
   * Check if agent is in cooldown
   */
  isInCooldown(agentId: string, now: Date = new Date()): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;
    this.updateCooldownState(state, now);
    return state.cooldown.inCooldown;
  }

  /**
   * Check if hard circuit breaker is tripped
   */
  isCircuitBreakerTripped(agentId: string): boolean {
    const state = this.states.get(agentId);
    return (state?.circuitBreakerState ?? 'normal') === 'tripped';
  }

  /**
   * Check if circuit breaker is in degraded (soft CB) state
   */
  isCircuitBreakerDegraded(agentId: string): boolean {
    const state = this.states.get(agentId);
    return (state?.circuitBreakerState ?? 'normal') === 'degraded';
  }

  /**
   * Get the current circuit breaker state for an agent
   */
  getCircuitBreakerState(agentId: string): CircuitBreakerState {
    const state = this.states.get(agentId);
    return state?.circuitBreakerState ?? 'normal';
  }

  /**
   * Get cooldown info for an agent
   */
  getCooldownInfo(agentId: string, now: Date = new Date()): CooldownState {
    const state = this.states.get(agentId);
    if (!state) return { inCooldown: false };
    this.updateCooldownState(state, now);
    return { ...state.cooldown };
  }

  /**
   * Get time remaining in cooldown (in hours)
   */
  getCooldownRemainingHours(agentId: string, now: Date = new Date()): number {
    const state = this.states.get(agentId);
    if (!state || !state.cooldown.inCooldown || !state.cooldown.cooldownEndsAt) {
      return 0;
    }
    this.updateCooldownState(state, now);
    if (!state.cooldown.inCooldown) return 0;
    const remainingMs = state.cooldown.cooldownEndsAt!.getTime() - now.getTime();
    return Math.max(0, remainingMs / (60 * 60 * 1000));
  }

  // ============================================================
  // Public: Circuit Breaker Reset
  // ============================================================

  /**
   * Reset the circuit breaker (degraded or tripped) for an agent.
   *
   * Without adminOverride: checks tier-appropriate timeout.
   *   - Degraded: resets if cbDegradedAutoResetMinutes[tier] has elapsed
   *   - Tripped T0-T2: resets if cbTrippedAutoResetMinutes[tier] has elapsed
   *   - Tripped T3+: NEVER auto-resets without admin (cbTrippedAutoResetMinutes = null)
   *
   * With adminOverride=true: always succeeds regardless of tier or timeout.
   *
   * Returns true if the reset succeeded, false if the agent doesn't exist,
   * is already normal, or the timeout has not yet elapsed.
   */
  resetCircuitBreaker(agentId: string, adminOverride: boolean = false, now: Date = new Date()): boolean {
    const state = this.states.get(agentId);
    if (!state) return false;
    if (state.circuitBreakerState === 'normal') return true;

    if (adminOverride) {
      this.clearCbState(state);
      return true;
    }

    // Non-admin: check tier-appropriate timeout
    const cbTier = state.tierAtCbEvent ?? 0;
    const cbAt = state.circuitBreakerTrippedAt;
    const elapsedMs = cbAt ? now.getTime() - cbAt.getTime() : Infinity;

    if (state.circuitBreakerState === 'degraded') {
      const resetMin =
        this.config.cbDegradedAutoResetMinutes[cbTier] ??
        this.config.cbDegradedAutoResetMinutes[0]!;
      if (elapsedMs >= resetMin * 60_000) {
        this.clearCbState(state);
        return true;
      }
      return false;
    }

    // 'tripped'
    const resetMin = this.config.cbTrippedAutoResetMinutes[cbTier];
    if (resetMin === null || resetMin === undefined) {
      // Admin required for this tier
      return false;
    }
    if (elapsedMs >= resetMin * 60_000) {
      this.clearCbState(state);
      return true;
    }
    return false;
  }

  // ============================================================
  // Public: Decay
  // ============================================================

  /**
   * Apply time-based decay to a trust score
   * Decay formula: score * (1 - decayRate)^days
   */
  applyDecay(currentScore: number, daysSinceUpdate: number, decayRate?: number): number {
    const rate = decayRate ?? this.config.gainRate;
    const decayFactor = Math.pow(1 - rate, daysSinceUpdate);
    return currentScore * decayFactor;
  }

  /**
   * Get the penalty ratio (failure-to-gain asymmetry) for a given tier.
   * Returns penaltyRatioMin at T0, penaltyRatioMax at T7, linear between.
   * Default: T7 (maximum) to match legacy 10:1 expectations.
   */
  getAsymmetryRatio(tier: number = 7): number {
    const clampedTier = Math.max(0, Math.min(7, tier));
    return (
      this.config.penaltyRatioMin +
      (clampedTier / 7) * (this.config.penaltyRatioMax - this.config.penaltyRatioMin)
    );
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<TrustDynamicsConfig> {
    return { ...this.config };
  }

  /**
   * Clear all state (for testing)
   */
  clearAllState(): void {
    this.states.clear();
  }
}

/**
 * Create a trust dynamics engine with default configuration
 */
export function createTrustDynamicsEngine(
  config?: Partial<TrustDynamicsConfig>
): TrustDynamicsEngine {
  return new TrustDynamicsEngine(config);
}
