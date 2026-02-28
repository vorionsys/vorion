/**
 * Trust Engine Types
 *
 * Extracted from trust-engine/index.ts to break circular dependency with
 * persistence/types.ts.
 *
 * @packageDocumentation
 */

import type {
  TrustScore,
  TrustLevel,
  TrustComponents,
  TrustSignal,
  ID,
} from "../common/types.js";

/**
 * Time-bound exception for Readiness Degree adjustments.
 */
export interface ReadinessException {
  /** Human-readable reason for exception */
  reason: string;
  /** Exception issue timestamp */
  issuedAt: string;
  /** Exception expiration timestamp */
  expiresAt: string;
  /** 0..1 scale applied to scheduled reductions while exception is active (default: 1) */
  reductionScale: number;
}

/**
 * Canonical reason codes for time-bound readiness exceptions.
 */
export const READINESS_EXCEPTION_REASON_CODES = [
  "approved_leave",
  "planned_maintenance",
  "telemetry_outage",
  "legal_hold",
  "incident_response",
  "dependency_outage",
] as const;

export type ReadinessExceptionReasonCode =
  (typeof READINESS_EXCEPTION_REASON_CODES)[number];

/**
 * @deprecated Use ReadinessException.
 */
export type FreshnessException = ReadinessException;

/**
 * Entity trust record
 */
export interface TrustRecord {
  entityId: ID;
  score: TrustScore;
  level: TrustLevel;
  components: TrustComponents;
  signals: TrustSignal[];
  lastCalculatedAt: string;
  history: TrustHistoryEntry[];
  /** Recent failure timestamps for accelerated decay */
  recentFailures: string[];
  /** Recent success timestamps for recovery */
  recentSuccesses: string[];
  /** Peak score achieved (for recovery milestone tracking) */
  peakScore: TrustScore;
  /** Consecutive successful signals count */
  consecutiveSuccesses: number;
  /** Scheduled readiness checkpoint index */
  readinessCheckpointIndex?: number;
  /** Deferred multiplier accumulated during active exception windows */
  deferredReadinessMultiplier?: number;
  /** Optional active readiness exception */
  readinessException?: ReadinessException;
  /** Baseline score captured when readiness schedule starts */
  readinessBaselineScore?: TrustScore;
  /** @deprecated Use readinessCheckpointIndex */
  freshnessCheckpointIndex?: number;
  /** @deprecated Use deferredReadinessMultiplier */
  deferredFreshnessMultiplier?: number;
  /** @deprecated Use readinessException */
  freshnessException?: FreshnessException;
  /** @deprecated Use readinessBaselineScore */
  freshnessBaselineScore?: TrustScore;
}

/**
 * Trust history entry
 */
export interface TrustHistoryEntry {
  score: TrustScore;
  level: TrustLevel;
  reason: string;
  timestamp: string;
}
