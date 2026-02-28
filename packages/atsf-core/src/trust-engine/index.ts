/**
 * Trust Engine - Behavioral Trust Scoring
 *
 * Calculates and maintains trust scores for entities based on behavioral signals.
 * Features 6-tier trust system with event emission for observability.
 *
 * @packageDocumentation
 */

import { EventEmitter } from "events";
import { createLogger } from "../common/logger.js";
import type {
  TrustScore,
  TrustLevel,
  TrustSignal,
  TrustComponents,
  ID,
} from "../common/types.js";
import type { PersistenceProvider } from "../persistence/types.js";
import {
  READINESS_EXCEPTION_REASON_CODES,
  type ReadinessException,
  type FreshnessException,
  type ReadinessExceptionReasonCode,
  type TrustRecord,
  type TrustHistoryEntry,
} from "./types.js";

export * from "./types.js";

const logger = createLogger({ component: "trust-engine" });

/**
 * Trust level thresholds (8 tiers T0-T7) - per BASIS specification
 */
export const TRUST_THRESHOLDS: Record<
  TrustLevel,
  { min: number; max: number }
> = {
  0: { min: 0, max: 199 }, // T0 Sandbox
  1: { min: 200, max: 349 }, // T1 Observed
  2: { min: 350, max: 499 }, // T2 Provisional
  3: { min: 500, max: 649 }, // T3 Monitored
  4: { min: 650, max: 799 }, // T4 Standard
  5: { min: 800, max: 875 }, // T5 Trusted
  6: { min: 876, max: 950 }, // T6 Certified
  7: { min: 951, max: 1000 }, // T7 Autonomous
};

/**
 * Trust level names (8 tiers T0-T7) - per BASIS specification
 */
export const TRUST_LEVEL_NAMES: Record<TrustLevel, string> = {
  0: "Sandbox",
  1: "Observed",
  2: "Provisional",
  3: "Monitored",
  4: "Standard",
  5: "Trusted",
  6: "Certified",
  7: "Autonomous",
};

/**
 * Signal weights for score calculation
 */
export const SIGNAL_WEIGHTS: Record<keyof TrustComponents, number> = {
  behavioral: 0.4,
  compliance: 0.25,
  identity: 0.2,
  context: 0.15,
};

/**
 * Trust event types
 */
export type TrustEventType =
  | "trust:initialized"
  | "trust:signal_recorded"
  | "trust:score_changed"
  | "trust:tier_changed"
  | "trust:readiness_adjusted"
  | "trust:freshness_adjusted"
  | "trust:decay_applied"
  | "trust:failure_detected"
  | "trust:recovery_applied"
  | "trust:recovery_milestone";

/**
 * Base trust event
 */
export interface TrustEvent {
  type: TrustEventType;
  entityId: ID;
  timestamp: string;
}

/**
 * Entity initialized event
 */
export interface TrustInitializedEvent extends TrustEvent {
  type: "trust:initialized";
  initialScore: TrustScore;
  initialLevel: TrustLevel;
}

/**
 * Signal recorded event
 */
export interface TrustSignalRecordedEvent extends TrustEvent {
  type: "trust:signal_recorded";
  signal: TrustSignal;
  previousScore: TrustScore;
  newScore: TrustScore;
}

/**
 * Score changed event
 */
export interface TrustScoreChangedEvent extends TrustEvent {
  type: "trust:score_changed";
  previousScore: TrustScore;
  newScore: TrustScore;
  delta: number;
  reason: string;
}

/**
 * Tier changed event
 */
export interface TrustTierChangedEvent extends TrustEvent {
  type: "trust:tier_changed";
  previousLevel: TrustLevel;
  newLevel: TrustLevel;
  previousLevelName: string;
  newLevelName: string;
  direction: "promoted" | "demoted";
}

/**
 * Decay applied event
 */
export interface TrustDecayAppliedEvent extends TrustEvent {
  type: "trust:decay_applied";
  previousScore: TrustScore;
  newScore: TrustScore;
  decayAmount: number;
  stalenessMs: number;
  accelerated: boolean;
}

/**
 * Readiness Degree adjusted event (primary neutral terminology)
 */
export interface TrustReadinessAdjustedEvent extends TrustEvent {
  type: "trust:readiness_adjusted";
  previousScore: TrustScore;
  newScore: TrustScore;
  adjustmentAmount: number;
  stalenessMs: number;
  accelerated: boolean;
}

/**
 * Freshness adjustment event (neutral terminology alias for trust:decay_applied)
 */
export interface TrustFreshnessAdjustedEvent extends TrustEvent {
  type: "trust:freshness_adjusted";
  previousScore: TrustScore;
  newScore: TrustScore;
  adjustmentAmount: number;
  stalenessMs: number;
  accelerated: boolean;
}

/**
 * Failure detected event
 */
export interface TrustFailureDetectedEvent extends TrustEvent {
  type: "trust:failure_detected";
  signal: TrustSignal;
  failureCount: number;
  acceleratedDecayActive: boolean;
}

/**
 * Recovery applied event
 */
export interface TrustRecoveryAppliedEvent extends TrustEvent {
  type: "trust:recovery_applied";
  signal: TrustSignal;
  previousScore: TrustScore;
  newScore: TrustScore;
  recoveryAmount: number;
  consecutiveSuccesses: number;
  acceleratedRecoveryActive: boolean;
}

/**
 * Recovery milestone event (e.g., restored to previous tier)
 */
export interface TrustRecoveryMilestoneEvent extends TrustEvent {
  type: "trust:recovery_milestone";
  milestone: "tier_restored" | "full_recovery" | "accelerated_recovery_earned";
  previousScore: TrustScore;
  newScore: TrustScore;
  details: string;
}

/**
 * Union of all trust events
 */
export type AnyTrustEvent =
  | TrustInitializedEvent
  | TrustSignalRecordedEvent
  | TrustScoreChangedEvent
  | TrustTierChangedEvent
  | TrustReadinessAdjustedEvent
  | TrustFreshnessAdjustedEvent
  | TrustDecayAppliedEvent
  | TrustFailureDetectedEvent
  | TrustRecoveryAppliedEvent
  | TrustRecoveryMilestoneEvent;

/**
 * Trust calculation result
 */
export interface TrustCalculation {
  score: TrustScore;
  level: TrustLevel;
  components: TrustComponents;
  factors: string[];
}

/**
 * Trust Engine configuration
 */
export interface TrustEngineConfig {
  /** Base decay rate per interval (default: 0.01 = 1%) */
  decayRate?: number;
  /** Decay interval in milliseconds (default: 60000 = 1 minute) */
  decayIntervalMs?: number;
  /** Signal value threshold below which a signal is considered a failure (default: 0.3) */
  failureThreshold?: number;
  /** Multiplier applied to decay rate when entity has recent failures (default: 1.0) */
  acceleratedDecayMultiplier?: number;
  /** Time window in ms to consider failures as "recent" (default: 3600000 = 1 hour) */
  failureWindowMs?: number;
  /** Minimum failures within window to trigger accelerated decay (default: 2) */
  minFailuresForAcceleration?: number;
  /** Persistence provider for storing trust records */
  persistence?: PersistenceProvider;
  /** Auto-persist changes (default: true when persistence is provided) */
  autoPersist?: boolean;

  // Recovery configuration
  /** Signal value threshold above which a signal is considered a success (default: 0.7) */
  successThreshold?: number;
  /** Base recovery rate per successful signal (default: 0.02 = 2%) */
  recoveryRate?: number;
  /** Multiplier for recovery when entity has consecutive successes (default: 1.5) */
  acceleratedRecoveryMultiplier?: number;
  /** Minimum consecutive successes to trigger accelerated recovery (default: 3) */
  minSuccessesForAcceleration?: number;
  /** Time window in ms to consider successes as "recent" (default: 3600000 = 1 hour) */
  successWindowMs?: number;
  /** Maximum score boost per recovery signal (default: 50 points) */
  maxRecoveryPerSignal?: number;

  // Event subscription limits (to prevent wildcard overhead)
  /** Maximum number of listeners per event type (default: 100) */
  maxListenersPerEvent?: number;
  /** Maximum total listeners across all events (default: 1000) */
  maxTotalListeners?: number;
  /** Warn when listener count exceeds this percentage of max (default: 0.8 = 80%) */
  listenerWarningThreshold?: number;

  /** Freshness adjustment mode (default: checkpoint_schedule) */
  freshnessMode?: "legacy_interval" | "checkpoint_schedule";
  /** Absolute day checkpoints since last trust-relevant action */
  freshnessCheckpointDays?: number[];
  /** Reduction percentages per checkpoint (0..1) */
  freshnessCheckpointReductions?: number[];
  /** Readiness Degree adjustment mode (preferred name) */
  readinessMode?: "legacy_interval" | "checkpoint_schedule";
  /** Readiness Degree checkpoint days (preferred name) */
  readinessCheckpointDays?: number[];
  /** Readiness Degree checkpoint reductions (preferred name) */
  readinessCheckpointReductions?: number[];
  /** Allowed readiness exception reason codes (default: READINESS_EXCEPTION_REASON_CODES) */
  readinessExceptionAllowedReasons?: ReadinessExceptionReasonCode[];
  /** Maximum readiness exception duration in ms (default: 30 days) */
  readinessExceptionMaxDurationMs?: number;
  /** @deprecated Use readinessExceptionAllowedReasons */
  freshnessExceptionAllowedReasons?: ReadinessExceptionReasonCode[];
  /** @deprecated Use readinessExceptionMaxDurationMs */
  freshnessExceptionMaxDurationMs?: number;
}

const DEFAULT_READINESS_CHECKPOINT_DAYS = [
  7, 14, 28, 42, 56, 84, 112, 140, 182,
];
const DEFAULT_READINESS_REDUCTIONS = [
  0.06, 0.06, 0.06, 0.06, 0.06, 0.05, 0.05, 0.05, 0.05,
];
const DEFAULT_READINESS_EXCEPTION_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function toMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function clampReductionScale(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Trust Engine service with event emission and subscription limits
 */
export class TrustEngine extends EventEmitter {
  private records: Map<ID, TrustRecord> = new Map();
  private _decayRate: number;
  private _decayIntervalMs: number;
  private _failureThreshold: number;
  private _acceleratedDecayMultiplier: number;
  private _failureWindowMs: number;
  private _minFailuresForAcceleration: number;
  private _persistence?: PersistenceProvider;
  private _autoPersist: boolean;

  // Recovery configuration
  private _successThreshold: number;
  private _recoveryRate: number;
  private _acceleratedRecoveryMultiplier: number;
  private _minSuccessesForAcceleration: number;
  private _successWindowMs: number;
  private _maxRecoveryPerSignal: number;

  // Event subscription limits
  private _maxListenersPerEvent: number;
  private _maxTotalListeners: number;
  private _listenerWarningThreshold: number;
  private _listenerCounts: Map<string, number> = new Map();
  private _totalListeners = 0;
  private _readinessMode: "legacy_interval" | "checkpoint_schedule";
  private _readinessCheckpointDays: number[];
  private _readinessCheckpointReductions: number[];
  private _allowedReadinessExceptionReasons: Set<ReadinessExceptionReasonCode>;
  private _readinessExceptionMaxDurationMs: number;

  constructor(config: TrustEngineConfig = {}) {
    super();
    this._decayRate = config.decayRate ?? 0.01;
    this._decayIntervalMs = config.decayIntervalMs ?? 60000;
    this._failureThreshold = config.failureThreshold ?? 0.3;
    this._acceleratedDecayMultiplier = config.acceleratedDecayMultiplier ?? 1.0;
    this._failureWindowMs = config.failureWindowMs ?? 3600000; // 1 hour
    this._minFailuresForAcceleration = config.minFailuresForAcceleration ?? 2;
    this._persistence = config.persistence;
    this._autoPersist = config.autoPersist ?? config.persistence !== undefined;

    // Recovery configuration
    this._successThreshold = config.successThreshold ?? 0.7;
    this._recoveryRate = config.recoveryRate ?? 0.02;
    this._acceleratedRecoveryMultiplier =
      config.acceleratedRecoveryMultiplier ?? 1.5;
    this._minSuccessesForAcceleration = config.minSuccessesForAcceleration ?? 3;
    this._successWindowMs = config.successWindowMs ?? 3600000; // 1 hour
    this._maxRecoveryPerSignal = config.maxRecoveryPerSignal ?? 50;

    // Event subscription limits (to prevent wildcard overhead)
    this._maxListenersPerEvent = config.maxListenersPerEvent ?? 100;
    this._maxTotalListeners = config.maxTotalListeners ?? 1000;
    this._listenerWarningThreshold = config.listenerWarningThreshold ?? 0.8;

    this._readinessMode =
      config.readinessMode ??
      config.freshnessMode ??
      (config.decayIntervalMs !== undefined || config.decayRate !== undefined
        ? "legacy_interval"
        : "checkpoint_schedule");
    this._readinessCheckpointDays = config.readinessCheckpointDays ??
      config.freshnessCheckpointDays ?? [...DEFAULT_READINESS_CHECKPOINT_DAYS];
    this._readinessCheckpointReductions =
      config.readinessCheckpointReductions ??
        config.freshnessCheckpointReductions ?? [
          ...DEFAULT_READINESS_REDUCTIONS,
        ];
    if (
      this._readinessCheckpointDays.length !==
      this._readinessCheckpointReductions.length
    ) {
      throw new Error(
        "freshnessCheckpointDays and freshnessCheckpointReductions must have equal length",
      );
    }
    this._allowedReadinessExceptionReasons = new Set(
      config.readinessExceptionAllowedReasons ??
        config.freshnessExceptionAllowedReasons ?? [
          ...READINESS_EXCEPTION_REASON_CODES,
        ],
    );
    this._readinessExceptionMaxDurationMs =
      config.readinessExceptionMaxDurationMs ??
      config.freshnessExceptionMaxDurationMs ??
      DEFAULT_READINESS_EXCEPTION_MAX_DURATION_MS;

    // Set default max listeners on EventEmitter
    this.setMaxListeners(this._maxListenersPerEvent);
  }

  private validateReadinessExceptionOptions(options: {
    reason: string;
    expiresAt: string;
    reductionScale?: number;
  }): void {
    if (
      !this._allowedReadinessExceptionReasons.has(
        options.reason as ReadinessExceptionReasonCode,
      )
    ) {
      throw new Error(
        `Unsupported readiness exception reason: ${options.reason}. ` +
          `Allowed reasons: ${Array.from(this._allowedReadinessExceptionReasons).join(", ")}`,
      );
    }

    const now = Date.now();
    const expiresAtMs = new Date(options.expiresAt).getTime();

    if (Number.isNaN(expiresAtMs)) {
      throw new Error("Invalid expiresAt timestamp for readiness exception");
    }

    if (expiresAtMs <= now) {
      throw new Error("Readiness exception expiresAt must be in the future");
    }

    if (expiresAtMs - now > this._readinessExceptionMaxDurationMs) {
      throw new Error(
        `Readiness exception duration exceeds configured maximum (${this._readinessExceptionMaxDurationMs} ms)`,
      );
    }
  }

  private getCheckpointIntervalMs(index: number): number {
    if (index <= 0) {
      return toMs(this._readinessCheckpointDays[0] ?? 7);
    }
    const current =
      this._readinessCheckpointDays[index] ??
      this._readinessCheckpointDays[this._readinessCheckpointDays.length - 1] ??
      7;
    const previous = this._readinessCheckpointDays[index - 1] ?? 0;
    return toMs(Math.max(1, current - previous));
  }

  private ensureReadinessState(record: TrustRecord): void {
    record.readinessCheckpointIndex ??= record.freshnessCheckpointIndex ?? 0;
    record.deferredReadinessMultiplier ??=
      record.deferredFreshnessMultiplier ?? 1;
    record.readinessBaselineScore ??=
      record.freshnessBaselineScore ?? record.score;

    record.freshnessCheckpointIndex = record.readinessCheckpointIndex;
    record.deferredFreshnessMultiplier = record.deferredReadinessMultiplier;
    record.freshnessBaselineScore = record.readinessBaselineScore;
    record.freshnessException =
      record.readinessException ?? record.freshnessException;
  }

  private isUsingDefaultReadinessSchedule(): boolean {
    if (
      this._readinessCheckpointDays.length !==
      DEFAULT_READINESS_CHECKPOINT_DAYS.length
    ) {
      return false;
    }
    if (
      this._readinessCheckpointReductions.length !==
      DEFAULT_READINESS_REDUCTIONS.length
    ) {
      return false;
    }

    return (
      this._readinessCheckpointDays.every(
        (v, i) => v === DEFAULT_READINESS_CHECKPOINT_DAYS[i],
      ) &&
      this._readinessCheckpointReductions.every(
        (v, i) => v === DEFAULT_READINESS_REDUCTIONS[i],
      )
    );
  }

  private isReadinessExceptionActive(
    record: TrustRecord,
    now: number,
  ): boolean {
    const exception = record.readinessException ?? record.freshnessException;
    if (!exception) return false;
    const issuedAt = new Date(exception.issuedAt).getTime();
    const expiresAt = new Date(exception.expiresAt).getTime();
    return now >= issuedAt && now < expiresAt;
  }

  private async applyDeferredReadinessCatchupIfExpired(
    record: TrustRecord,
  ): Promise<void> {
    const exception = record.readinessException ?? record.freshnessException;
    if (!exception) return;

    const now = Date.now();
    const expiresAt = new Date(exception.expiresAt).getTime();
    if (now < expiresAt) return;

    this.ensureReadinessState(record);
    const deferredMultiplier = record.deferredReadinessMultiplier ?? 1;
    if (deferredMultiplier < 1) {
      const previousScore = record.score;
      const adjustedScore = Math.max(
        0,
        Math.round(record.score * deferredMultiplier),
      );
      record.score = adjustedScore;
      record.level = this.scoreToLevel(adjustedScore);
      record.deferredReadinessMultiplier = 1;
      record.deferredFreshnessMultiplier = 1;

      this.emitReadinessAdjustmentEvents(record.entityId, {
        previousScore,
        newScore: record.score,
        stalenessMs: 0,
        accelerated: false,
      });
    }

    delete record.readinessException;
    delete record.freshnessException;
  }

  private async applyScheduledReadinessAdjustment(
    record: TrustRecord,
  ): Promise<void> {
    this.ensureReadinessState(record);
    await this.applyDeferredReadinessCatchupIfExpired(record);

    while (
      (record.readinessCheckpointIndex ?? 0) <
      this._readinessCheckpointDays.length
    ) {
      const checkpointIndex = record.readinessCheckpointIndex ?? 0;
      const intervalMs = this.getCheckpointIntervalMs(checkpointIndex);
      const stalenessMs =
        Date.now() - new Date(record.lastCalculatedAt).getTime();
      if (stalenessMs < intervalMs) {
        break;
      }

      const previousScore = record.score;
      const previousLevel = record.level;
      const fullReduction =
        this._readinessCheckpointReductions[checkpointIndex] ?? 0;
      const activeException = this.isReadinessExceptionActive(
        record,
        Date.now(),
      );
      const scale = activeException
        ? clampReductionScale(
            (record.readinessException ?? record.freshnessException)
              ?.reductionScale,
          )
        : 1;
      const appliedReduction = fullReduction * scale;
      const appliedMultiplier = 1 - appliedReduction;
      const fullMultiplier = 1 - fullReduction;

      record.score = Math.max(0, Math.round(record.score * appliedMultiplier));
      const isFinalCheckpoint =
        checkpointIndex === this._readinessCheckpointDays.length - 1;
      if (
        isFinalCheckpoint &&
        !activeException &&
        this.isUsingDefaultReadinessSchedule()
      ) {
        const baseline =
          record.readinessBaselineScore ??
          record.freshnessBaselineScore ??
          record.score;
        record.score = Math.max(0, Math.round(baseline * 0.5));
      }
      record.level = this.scoreToLevel(record.score);
      record.readinessCheckpointIndex = checkpointIndex + 1;
      record.freshnessCheckpointIndex = record.readinessCheckpointIndex;

      const lastCalculatedMs = new Date(record.lastCalculatedAt).getTime();
      record.lastCalculatedAt = new Date(
        lastCalculatedMs + intervalMs,
      ).toISOString();

      if (activeException && appliedMultiplier > 0 && fullMultiplier >= 0) {
        const debtFactor = fullMultiplier / appliedMultiplier;
        record.deferredReadinessMultiplier =
          (record.deferredReadinessMultiplier ?? 1) * debtFactor;
        record.deferredFreshnessMultiplier = record.deferredReadinessMultiplier;
      }

      if (previousScore !== record.score) {
        this.emitReadinessAdjustmentEvents(record.entityId, {
          previousScore,
          newScore: record.score,
          stalenessMs,
          accelerated: false,
        });

        if (previousLevel !== record.level) {
          this.emitTrustEvent({
            type: "trust:tier_changed",
            entityId: record.entityId,
            timestamp: new Date().toISOString(),
            previousLevel,
            newLevel: record.level,
            previousLevelName: TRUST_LEVEL_NAMES[previousLevel],
            newLevelName: TRUST_LEVEL_NAMES[record.level],
            direction: record.level < previousLevel ? "demoted" : "promoted",
          });
        }

        await this.autoPersistRecord(record);
      }
    }
  }

  private emitReadinessAdjustmentEvents(
    entityId: ID,
    details: {
      previousScore: TrustScore;
      newScore: TrustScore;
      stalenessMs: number;
      accelerated: boolean;
    },
  ): void {
    const adjustmentAmount = details.previousScore - details.newScore;

    this.emitTrustEvent({
      type: "trust:readiness_adjusted",
      entityId,
      timestamp: new Date().toISOString(),
      previousScore: details.previousScore,
      newScore: details.newScore,
      adjustmentAmount,
      stalenessMs: details.stalenessMs,
      accelerated: details.accelerated,
    });

    this.emitTrustEvent({
      type: "trust:freshness_adjusted",
      entityId,
      timestamp: new Date().toISOString(),
      previousScore: details.previousScore,
      newScore: details.newScore,
      adjustmentAmount,
      stalenessMs: details.stalenessMs,
      accelerated: details.accelerated,
    });

    this.emitTrustEvent({
      type: "trust:decay_applied",
      entityId,
      timestamp: new Date().toISOString(),
      previousScore: details.previousScore,
      newScore: details.newScore,
      decayAmount: adjustmentAmount,
      stalenessMs: details.stalenessMs,
      accelerated: details.accelerated,
    });
  }

  /**
   * Add event listener with subscription limits
   * @throws Error if listener limits are exceeded
   */
  override on(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    this.checkListenerLimits(String(eventName));
    this.incrementListenerCount(String(eventName));
    return super.on(eventName, listener);
  }

  /**
   * Add one-time event listener with subscription limits
   */
  override once(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    this.checkListenerLimits(String(eventName));
    this.incrementListenerCount(String(eventName));
    // Wrap listener to decrement count when removed
    const wrappedListener = (...args: unknown[]) => {
      this.decrementListenerCount(String(eventName));
      listener(...args);
    };
    return super.once(eventName, wrappedListener);
  }

  /**
   * Remove event listener
   */
  override off(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    this.decrementListenerCount(String(eventName));
    return super.off(eventName, listener);
  }

  /**
   * Remove event listener (alias)
   */
  override removeListener(
    eventName: string | symbol,
    listener: (...args: unknown[]) => void,
  ): this {
    this.decrementListenerCount(String(eventName));
    return super.removeListener(eventName, listener);
  }

  /**
   * Remove all listeners for an event
   */
  override removeAllListeners(eventName?: string | symbol): this {
    if (eventName) {
      const count = this._listenerCounts.get(String(eventName)) ?? 0;
      this._totalListeners -= count;
      this._listenerCounts.delete(String(eventName));
    } else {
      this._totalListeners = 0;
      this._listenerCounts.clear();
    }
    return super.removeAllListeners(eventName);
  }

  /**
   * Check if adding a listener would exceed limits
   */
  private checkListenerLimits(eventName: string): void {
    const currentEventCount = this._listenerCounts.get(eventName) ?? 0;

    // Check per-event limit
    if (currentEventCount >= this._maxListenersPerEvent) {
      throw new Error(
        `Maximum listeners (${this._maxListenersPerEvent}) exceeded for event "${eventName}". ` +
          `Consider using fewer listeners or increasing maxListenersPerEvent.`,
      );
    }

    // Check total limit
    if (this._totalListeners >= this._maxTotalListeners) {
      throw new Error(
        `Maximum total listeners (${this._maxTotalListeners}) exceeded. ` +
          `Consider removing unused listeners or increasing maxTotalListeners.`,
      );
    }

    // Warn if approaching limits
    const eventThreshold =
      this._maxListenersPerEvent * this._listenerWarningThreshold;
    const totalThreshold =
      this._maxTotalListeners * this._listenerWarningThreshold;

    if (currentEventCount >= eventThreshold) {
      logger.warn(
        {
          eventName,
          current: currentEventCount,
          max: this._maxListenersPerEvent,
        },
        `Approaching listener limit for event "${eventName}"`,
      );
    }

    if (this._totalListeners >= totalThreshold) {
      logger.warn(
        { current: this._totalListeners, max: this._maxTotalListeners },
        "Approaching total listener limit",
      );
    }
  }

  /**
   * Increment listener count for an event
   */
  private incrementListenerCount(eventName: string): void {
    const current = this._listenerCounts.get(eventName) ?? 0;
    this._listenerCounts.set(eventName, current + 1);
    this._totalListeners++;
  }

  /**
   * Decrement listener count for an event
   */
  private decrementListenerCount(eventName: string): void {
    const current = this._listenerCounts.get(eventName) ?? 0;
    if (current > 0) {
      this._listenerCounts.set(eventName, current - 1);
      this._totalListeners--;
    }
  }

  /**
   * Get current listener statistics
   */
  getListenerStats(): {
    totalListeners: number;
    maxTotalListeners: number;
    listenersByEvent: Record<string, number>;
    maxListenersPerEvent: number;
  } {
    return {
      totalListeners: this._totalListeners,
      maxTotalListeners: this._maxTotalListeners,
      listenersByEvent: Object.fromEntries(this._listenerCounts),
      maxListenersPerEvent: this._maxListenersPerEvent,
    };
  }

  /**
   * Get the current decay rate
   */
  get decayRate(): number {
    return this._decayRate;
  }

  /**
   * Get the decay interval in milliseconds
   */
  get decayIntervalMs(): number {
    return this._decayIntervalMs;
  }

  /**
   * Get the failure threshold
   */
  get failureThreshold(): number {
    return this._failureThreshold;
  }

  /**
   * Get the accelerated decay multiplier
   */
  get acceleratedDecayMultiplier(): number {
    return this._acceleratedDecayMultiplier;
  }

  /**
   * Get the persistence provider
   */
  get persistence(): PersistenceProvider | undefined {
    return this._persistence;
  }

  /**
   * Get the success threshold
   */
  get successThreshold(): number {
    return this._successThreshold;
  }

  /**
   * Get the recovery rate
   */
  get recoveryRate(): number {
    return this._recoveryRate;
  }

  /**
   * Get the accelerated recovery multiplier
   */
  get acceleratedRecoveryMultiplier(): number {
    return this._acceleratedRecoveryMultiplier;
  }

  /**
   * Load all records from persistence
   */
  async loadFromPersistence(): Promise<number> {
    if (!this._persistence) {
      throw new Error("No persistence provider configured");
    }

    const records = await this._persistence.query();
    this.records.clear();

    for (const record of records) {
      this.records.set(record.entityId, record);
    }

    logger.info(
      { count: records.length },
      "Loaded trust records from persistence",
    );
    return records.length;
  }

  /**
   * Save all records to persistence
   */
  async saveToPersistence(): Promise<number> {
    if (!this._persistence) {
      throw new Error("No persistence provider configured");
    }

    let count = 0;
    for (const record of this.records.values()) {
      await this._persistence.save(record);
      count++;
    }

    logger.info({ count }, "Saved trust records to persistence");
    return count;
  }

  /**
   * Persist a single record if auto-persist is enabled
   */
  private async autoPersistRecord(record: TrustRecord): Promise<void> {
    if (this._persistence && this._autoPersist) {
      await this._persistence.save(record);
    }
  }

  /**
   * Close the trust engine and persistence provider
   */
  async close(): Promise<void> {
    if (this._persistence) {
      await this._persistence.close();
    }
    this.removeAllListeners();
  }

  /**
   * Emit a trust event
   */
  private emitTrustEvent(event: AnyTrustEvent): void {
    this.emit(event.type, event);
    this.emit("trust:*", event); // Wildcard for all events
    logger.debug({ event }, "Trust event emitted");
  }

  /**
   * Calculate trust score for an entity
   */
  async calculate(entityId: ID): Promise<TrustCalculation> {
    const record = this.records.get(entityId);
    const signals = record?.signals ?? [];
    const currentLevel = record?.level ?? 1;

    // Calculate component scores
    const components = this.calculateComponents(signals, currentLevel);

    // Calculate weighted total
    const score = Math.round(
      components.behavioral * SIGNAL_WEIGHTS.behavioral * 1000 +
        components.compliance * SIGNAL_WEIGHTS.compliance * 1000 +
        components.identity * SIGNAL_WEIGHTS.identity * 1000 +
        components.context * SIGNAL_WEIGHTS.context * 1000,
    );

    // Clamp to valid range
    const clampedScore = Math.max(0, Math.min(1000, score));
    const level = this.scoreToLevel(clampedScore);

    const factors = this.getSignificantFactors(components);

    logger.debug(
      { entityId, score: clampedScore, level, components },
      "Trust calculated",
    );

    return {
      score: clampedScore,
      level,
      components,
      factors,
    };
  }

  /**
   * Check if an entity has accelerated decay active
   */
  private hasAcceleratedDecay(record: TrustRecord): boolean {
    const now = Date.now();
    const recentFailures = record.recentFailures.filter(
      (timestamp) =>
        now - new Date(timestamp).getTime() < this._failureWindowMs,
    );
    return recentFailures.length >= this._minFailuresForAcceleration;
  }

  /**
   * Clean up old failure timestamps outside the window
   */
  private cleanupFailures(record: TrustRecord): void {
    const now = Date.now();
    record.recentFailures = record.recentFailures.filter(
      (timestamp) =>
        now - new Date(timestamp).getTime() < this._failureWindowMs,
    );
  }

  /**
   * Clean up old success timestamps outside the window
   */
  private cleanupSuccesses(record: TrustRecord): void {
    const now = Date.now();
    record.recentSuccesses = record.recentSuccesses.filter(
      (timestamp) =>
        now - new Date(timestamp).getTime() < this._successWindowMs,
    );
  }

  /**
   * Check if an entity has accelerated recovery active
   */
  private hasAcceleratedRecovery(record: TrustRecord): boolean {
    return record.consecutiveSuccesses >= this._minSuccessesForAcceleration;
  }

  /**
   * Calculate recovery amount for a success signal
   */
  private calculateRecoveryAmount(
    record: TrustRecord,
    signalValue: number,
  ): number {
    // Base recovery based on signal strength
    const signalStrength =
      (signalValue - this._successThreshold) / (1 - this._successThreshold);
    let baseRecovery = Math.round(this._recoveryRate * 1000 * signalStrength);

    // Apply accelerated recovery if earned
    if (this.hasAcceleratedRecovery(record)) {
      baseRecovery = Math.round(
        baseRecovery * this._acceleratedRecoveryMultiplier,
      );
    }

    // Cap at maximum recovery per signal
    return Math.min(baseRecovery, this._maxRecoveryPerSignal);
  }

  /**
   * Apply recovery to a trust record
   */
  private async applyRecovery(
    record: TrustRecord,
    signal: TrustSignal,
    recoveryAmount: number,
  ): Promise<void> {
    const previousScore = record.score;
    const previousLevel = record.level;
    const accelerated = this.hasAcceleratedRecovery(record);

    // Apply recovery (don't exceed 1000)
    record.score = Math.min(1000, record.score + recoveryAmount);
    record.level = this.scoreToLevel(record.score);

    // Track peak score
    if (record.score > record.peakScore) {
      record.peakScore = record.score;
    }

    record.lastCalculatedAt = new Date().toISOString();

    // Emit recovery event
    this.emitTrustEvent({
      type: "trust:recovery_applied",
      entityId: record.entityId,
      timestamp: new Date().toISOString(),
      signal,
      previousScore,
      newScore: record.score,
      recoveryAmount,
      consecutiveSuccesses: record.consecutiveSuccesses,
      acceleratedRecoveryActive: accelerated,
    });

    // Check for milestones
    if (previousLevel !== record.level && record.level > previousLevel) {
      this.emitTrustEvent({
        type: "trust:recovery_milestone",
        entityId: record.entityId,
        timestamp: new Date().toISOString(),
        milestone: "tier_restored",
        previousScore,
        newScore: record.score,
        details: `Promoted from ${TRUST_LEVEL_NAMES[previousLevel]} to ${TRUST_LEVEL_NAMES[record.level]}`,
      });
    }

    // Check if accelerated recovery was just earned
    if (record.consecutiveSuccesses === this._minSuccessesForAcceleration) {
      this.emitTrustEvent({
        type: "trust:recovery_milestone",
        entityId: record.entityId,
        timestamp: new Date().toISOString(),
        milestone: "accelerated_recovery_earned",
        previousScore,
        newScore: record.score,
        details: `Earned accelerated recovery after ${this._minSuccessesForAcceleration} consecutive successes`,
      });
    }

    // Check for full recovery
    if (record.score >= record.peakScore && previousScore < record.peakScore) {
      this.emitTrustEvent({
        type: "trust:recovery_milestone",
        entityId: record.entityId,
        timestamp: new Date().toISOString(),
        milestone: "full_recovery",
        previousScore,
        newScore: record.score,
        details: `Fully recovered to peak score of ${record.peakScore}`,
      });
    }

    logger.info(
      {
        entityId: record.entityId,
        previousScore,
        newScore: record.score,
        recoveryAmount,
        accelerated,
      },
      "Trust recovery applied",
    );
  }

  /**
   * Get trust score for an entity (with automatic decay)
   */
  async getScore(entityId: ID): Promise<TrustRecord | undefined> {
    const record = this.records.get(entityId);

    if (record) {
      // Clean up old failures
      this.cleanupFailures(record);

      if (this._readinessMode === "checkpoint_schedule") {
        await this.applyScheduledReadinessAdjustment(record);
        return record;
      }

      // Apply decay if stale
      const staleness =
        Date.now() - new Date(record.lastCalculatedAt).getTime();
      if (staleness > this._decayIntervalMs) {
        const previousScore = record.score;
        const previousLevel = record.level;

        // Check if accelerated decay should apply
        const accelerated = this.hasAcceleratedDecay(record);
        const effectiveDecayRate = accelerated
          ? this._decayRate * this._acceleratedDecayMultiplier
          : this._decayRate;

        // Apply decay based on staleness
        const decayPeriods = Math.floor(staleness / this._decayIntervalMs);
        const decayMultiplier = Math.pow(1 - effectiveDecayRate, decayPeriods);
        const decayedScore = Math.round(record.score * decayMultiplier);
        const clampedScore = Math.max(0, decayedScore);

        record.score = clampedScore;
        record.level = this.scoreToLevel(clampedScore);
        record.lastCalculatedAt = new Date().toISOString();

        // Emit decay event
        if (previousScore !== record.score) {
          this.emitTrustEvent({
            type: "trust:decay_applied",
            entityId,
            timestamp: new Date().toISOString(),
            previousScore,
            newScore: record.score,
            decayAmount: previousScore - record.score,
            stalenessMs: staleness,
            accelerated,
          });

          // Emit tier change if applicable
          if (previousLevel !== record.level) {
            this.emitTrustEvent({
              type: "trust:tier_changed",
              entityId,
              timestamp: new Date().toISOString(),
              previousLevel,
              newLevel: record.level,
              previousLevelName: TRUST_LEVEL_NAMES[previousLevel],
              newLevelName: TRUST_LEVEL_NAMES[record.level],
              direction: record.level < previousLevel ? "demoted" : "promoted",
            });
          }

          // Auto-persist after decay
          await this.autoPersistRecord(record);
        }
      }
    }

    return record;
  }

  /**
   * Record a trust signal
   */
  async recordSignal(signal: TrustSignal): Promise<void> {
    let record = this.records.get(signal.entityId);
    let isNewEntity = false;

    if (!record) {
      record = this.createInitialRecord(signal.entityId);
      this.records.set(signal.entityId, record);
      isNewEntity = true;
    }

    const previousScore = record.score;
    const previousLevel = record.level;

    // Detect failure signals
    if (signal.value < this._failureThreshold) {
      record.recentFailures.push(signal.timestamp);
      this.cleanupFailures(record);

      // Reset consecutive successes on failure
      record.consecutiveSuccesses = 0;

      const acceleratedDecayActive = this.hasAcceleratedDecay(record);

      this.emitTrustEvent({
        type: "trust:failure_detected",
        entityId: signal.entityId,
        timestamp: new Date().toISOString(),
        signal,
        failureCount: record.recentFailures.length,
        acceleratedDecayActive,
      });

      logger.warn(
        {
          entityId: signal.entityId,
          signalType: signal.type,
          signalValue: signal.value,
          failureCount: record.recentFailures.length,
          acceleratedDecayActive,
        },
        "Failure signal detected",
      );
    }

    // Detect success signals and apply recovery
    if (signal.value >= this._successThreshold) {
      record.recentSuccesses.push(signal.timestamp);
      record.consecutiveSuccesses++;
      this.cleanupSuccesses(record);

      // Calculate and apply recovery
      const recoveryAmount = this.calculateRecoveryAmount(record, signal.value);
      if (recoveryAmount > 0) {
        await this.applyRecovery(record, signal, recoveryAmount);
      }

      logger.info(
        {
          entityId: signal.entityId,
          signalType: signal.type,
          signalValue: signal.value,
          consecutiveSuccesses: record.consecutiveSuccesses,
          recoveryAmount,
        },
        "Success signal detected",
      );
    }

    // Add signal
    record.signals.push(signal);

    // Keep only recent signals (last 1000)
    if (record.signals.length > 1000) {
      record.signals = record.signals.slice(-1000);
    }

    // Recalculate
    const calculation = await this.calculate(signal.entityId);

    // Update record
    record.score = calculation.score;
    record.level = calculation.level;
    record.components = calculation.components;
    record.lastCalculatedAt = new Date().toISOString();
    record.readinessCheckpointIndex = 0;
    record.deferredReadinessMultiplier = 1;
    record.readinessBaselineScore = calculation.score;
    record.freshnessCheckpointIndex = 0;
    record.deferredFreshnessMultiplier = 1;
    record.freshnessBaselineScore = calculation.score;

    // Record history if significant change
    if (Math.abs(calculation.score - previousScore) >= 10) {
      record.history.push({
        score: calculation.score,
        level: calculation.level,
        reason: `Signal: ${signal.type}`,
        timestamp: new Date().toISOString(),
      });

      // Keep last 100 history entries
      if (record.history.length > 100) {
        record.history = record.history.slice(-100);
      }
    }

    // Emit signal recorded event
    this.emitTrustEvent({
      type: "trust:signal_recorded",
      entityId: signal.entityId,
      timestamp: new Date().toISOString(),
      signal,
      previousScore,
      newScore: calculation.score,
    });

    // Emit score changed event if significant
    if (Math.abs(calculation.score - previousScore) >= 5) {
      this.emitTrustEvent({
        type: "trust:score_changed",
        entityId: signal.entityId,
        timestamp: new Date().toISOString(),
        previousScore,
        newScore: calculation.score,
        delta: calculation.score - previousScore,
        reason: `Signal: ${signal.type}`,
      });
    }

    // Emit tier changed event if applicable
    if (previousLevel !== calculation.level && !isNewEntity) {
      this.emitTrustEvent({
        type: "trust:tier_changed",
        entityId: signal.entityId,
        timestamp: new Date().toISOString(),
        previousLevel,
        newLevel: calculation.level,
        previousLevelName: TRUST_LEVEL_NAMES[previousLevel],
        newLevelName: TRUST_LEVEL_NAMES[calculation.level],
        direction: calculation.level > previousLevel ? "promoted" : "demoted",
      });
    }

    // Auto-persist if enabled
    await this.autoPersistRecord(record);

    logger.debug(
      {
        entityId: signal.entityId,
        signalType: signal.type,
        newScore: calculation.score,
      },
      "Signal recorded",
    );
  }

  /**
   * Initialize trust for a new entity
   */
  async initializeEntity(
    entityId: ID,
    initialLevel: TrustLevel = 1,
  ): Promise<TrustRecord> {
    const score = TRUST_THRESHOLDS[initialLevel].min;
    const record: TrustRecord = {
      entityId,
      score,
      level: initialLevel,
      components: {
        behavioral: 0.5,
        compliance: 0.5,
        identity: 0.5,
        context: 0.5,
      },
      signals: [],
      lastCalculatedAt: new Date().toISOString(),
      history: [
        {
          score,
          level: initialLevel,
          reason: "Initial registration",
          timestamp: new Date().toISOString(),
        },
      ],
      recentFailures: [],
      recentSuccesses: [],
      peakScore: score,
      consecutiveSuccesses: 0,
      readinessCheckpointIndex: 0,
      deferredReadinessMultiplier: 1,
      readinessBaselineScore: score,
      freshnessCheckpointIndex: 0,
      deferredFreshnessMultiplier: 1,
      freshnessBaselineScore: score,
    };

    this.records.set(entityId, record);

    // Auto-persist if enabled
    await this.autoPersistRecord(record);

    // Emit initialized event
    this.emitTrustEvent({
      type: "trust:initialized",
      entityId,
      timestamp: new Date().toISOString(),
      initialScore: score,
      initialLevel,
    });

    logger.info({ entityId, initialLevel }, "Entity trust initialized");

    return record;
  }

  /**
   * Get all entity IDs
   */
  getEntityIds(): ID[] {
    return Array.from(this.records.keys());
  }

  /**
   * Get trust level name
   */
  getLevelName(level: TrustLevel): string {
    return TRUST_LEVEL_NAMES[level];
  }

  /**
   * Convert score to trust level
   */
  private scoreToLevel(score: TrustScore): TrustLevel {
    for (const [level, { min, max }] of Object.entries(TRUST_THRESHOLDS)) {
      if (score >= min && score <= max) {
        return parseInt(level) as TrustLevel;
      }
    }
    return 0;
  }

  /**
   * Calculate component scores from signals
   */
  private calculateComponents(
    signals: TrustSignal[],
    currentLevel: TrustLevel,
  ): TrustComponents {
    // Group signals by type
    const behavioral = signals.filter((s) => s.type.startsWith("behavioral."));
    const compliance = signals.filter((s) => s.type.startsWith("compliance."));
    const identity = signals.filter((s) => s.type.startsWith("identity."));
    const context = signals.filter((s) => s.type.startsWith("context."));

    return {
      behavioral: this.averageSignalValue(behavioral, 0.5, currentLevel),
      compliance: this.averageSignalValue(compliance, 0.5, currentLevel),
      identity: this.averageSignalValue(identity, 0.5, currentLevel),
      context: this.averageSignalValue(context, 0.5, currentLevel),
    };
  }

  /**
   * Calculate average signal value with default
   */
  private averageSignalValue(
    signals: TrustSignal[],
    defaultValue: number,
    currentLevel: TrustLevel,
  ): number {
    if (signals.length === 0) return defaultValue;

    // Weight recent signals more heavily
    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;

    for (const signal of signals) {
      const age = now - new Date(signal.timestamp).getTime();
      const weight = Math.exp(-age / (7 * 24 * 60 * 60 * 1000)); // 7-day half-life
      const adjustedValue = this.adjustSignalValueForTier(
        signal,
        defaultValue,
        currentLevel,
      );
      weightedSum += adjustedValue * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : defaultValue;
  }

  /**
   * Human/manual positive approvals carry less upward impact at higher tiers.
   */
  private adjustSignalValueForTier(
    signal: TrustSignal,
    defaultValue: number,
    currentLevel: TrustLevel,
  ): number {
    if (!this.isHumanApprovalSignal(signal) || signal.value <= defaultValue) {
      return signal.value;
    }

    const assistFactor = this.getHumanApprovalAssistFactor(currentLevel);
    return defaultValue + (signal.value - defaultValue) * assistFactor;
  }

  private isHumanApprovalSignal(signal: TrustSignal): boolean {
    const source = signal.source?.toLowerCase() ?? "";
    return (
      source === "manual" ||
      source === "human" ||
      source === "human_review" ||
      source === "human-approval"
    );
  }

  private getHumanApprovalAssistFactor(level: TrustLevel): number {
    switch (level) {
      case 0:
      case 1:
        return 1.0;
      case 2:
        return 0.85;
      case 3:
        return 0.7;
      case 4:
        return 0.55;
      case 5:
        return 0.4;
      case 6:
        return 0.3;
      case 7:
        return 0.2;
      default:
        return 1.0;
    }
  }

  /**
   * Get significant factors affecting the score
   */
  private getSignificantFactors(components: TrustComponents): string[] {
    const factors: string[] = [];

    if (components.behavioral < 0.3) {
      factors.push("Low behavioral trust");
    }
    if (components.compliance < 0.3) {
      factors.push("Low compliance score");
    }
    if (components.identity < 0.3) {
      factors.push("Weak identity verification");
    }
    if (components.context < 0.3) {
      factors.push("Unusual context signals");
    }

    return factors;
  }

  /**
   * Create initial trust record
   */
  private createInitialRecord(entityId: ID): TrustRecord {
    const initialScore = TRUST_THRESHOLDS[1].min;
    return {
      entityId,
      score: initialScore, // Start at L1 (Provisional) minimum
      level: 1,
      components: {
        behavioral: 0.5,
        compliance: 0.5,
        identity: 0.5,
        context: 0.5,
      },
      signals: [],
      lastCalculatedAt: new Date().toISOString(),
      history: [],
      recentFailures: [],
      recentSuccesses: [],
      peakScore: initialScore,
      consecutiveSuccesses: 0,
      readinessCheckpointIndex: 0,
      deferredReadinessMultiplier: 1,
      readinessBaselineScore: initialScore,
      freshnessCheckpointIndex: 0,
      deferredFreshnessMultiplier: 1,
      freshnessBaselineScore: initialScore,
    };
  }

  /**
   * Configure a time-bound Readiness Degree exception for an entity.
   */
  setReadinessException(
    entityId: ID,
    options: {
      reason: ReadinessExceptionReasonCode;
      expiresAt: string;
      reductionScale?: number;
    },
  ): void {
    const record = this.records.get(entityId);
    if (!record) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    this.validateReadinessExceptionOptions(options);
    this.ensureReadinessState(record);
    record.readinessException = {
      reason: options.reason,
      issuedAt: new Date().toISOString(),
      expiresAt: options.expiresAt,
      reductionScale: clampReductionScale(options.reductionScale),
    };
    record.freshnessException = record.readinessException;
  }

  /**
   * @deprecated Use setReadinessException.
   */
  setFreshnessException(
    entityId: ID,
    options: {
      reason: ReadinessExceptionReasonCode;
      expiresAt: string;
      reductionScale?: number;
    },
  ): void {
    this.setReadinessException(entityId, options);
  }

  /**
   * Clear Readiness Degree exception for an entity.
   */
  clearReadinessException(entityId: ID): void {
    const record = this.records.get(entityId);
    if (!record) {
      return;
    }
    delete record.readinessException;
    delete record.freshnessException;
  }

  /**
   * @deprecated Use clearReadinessException.
   */
  clearFreshnessException(entityId: ID): void {
    this.clearReadinessException(entityId);
  }

  /**
   * Get active Readiness Degree exception for an entity.
   */
  getReadinessException(entityId: ID): ReadinessException | undefined {
    const record = this.records.get(entityId);
    return record?.readinessException ?? record?.freshnessException;
  }

  /**
   * @deprecated Use getReadinessException.
   */
  getFreshnessException(entityId: ID): FreshnessException | undefined {
    return this.getReadinessException(entityId);
  }

  /**
   * Check if accelerated decay is currently active for an entity
   */
  isAcceleratedDecayActive(entityId: ID): boolean {
    const record = this.records.get(entityId);
    if (!record) return false;
    return this.hasAcceleratedDecay(record);
  }

  /**
   * Check if accelerated recovery is currently active for an entity
   */
  isAcceleratedRecoveryActive(entityId: ID): boolean {
    const record = this.records.get(entityId);
    if (!record) return false;
    return this.hasAcceleratedRecovery(record);
  }

  /**
   * Get current failure count for an entity
   */
  getFailureCount(entityId: ID): number {
    const record = this.records.get(entityId);
    if (!record) return 0;
    this.cleanupFailures(record);
    return record.recentFailures.length;
  }

  /**
   * Get consecutive success count for an entity
   */
  getConsecutiveSuccessCount(entityId: ID): number {
    const record = this.records.get(entityId);
    if (!record) return 0;
    return record.consecutiveSuccesses;
  }

  /**
   * Get peak score for an entity
   */
  getPeakScore(entityId: ID): TrustScore {
    const record = this.records.get(entityId);
    if (!record) return 0;
    return record.peakScore;
  }
}

/**
 * Create a new Trust Engine instance
 */
export function createTrustEngine(config?: TrustEngineConfig): TrustEngine {
  return new TrustEngine(config);
}
