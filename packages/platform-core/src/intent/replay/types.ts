/**
 * REPLAY TYPES
 *
 * Shared type definitions for the replay module.
 * Extracted to avoid circular dependencies between index.ts and comparator.ts
 *
 * @packageDocumentation
 */

import type {
  ID,
  ControlAction,
  TrustLevel,
  TrustScore,
  Timestamp,
} from '../../common/types.js';

// ============================================================================
// Difference Types (used by both ReplayResult and ComparisonReport)
// ============================================================================

/**
 * Type of difference detected
 */
export type DifferenceType =
  | 'decision'
  | 'policy_applied'
  | 'policy_missing'
  | 'trust_score'
  | 'trust_level'
  | 'timing'
  | 'evaluation_order'
  | 'constraint'
  | 'metadata';

/**
 * Severity of the difference
 */
export type DifferenceSeverity = 'info' | 'warning' | 'critical';

/**
 * Individual difference between original and replay
 */
export interface Difference {
  type: DifferenceType;
  severity: DifferenceSeverity;
  path: string;
  originalValue: unknown;
  replayValue: unknown;
  description: string;
  impact?: string;
}

/**
 * Timing comparison
 */
export interface TimingComparison {
  originalDurationMs: number;
  replayDurationMs: number;
  differenceMs: number;
  percentageChange: number;
  significant: boolean;
}

/**
 * Policy comparison
 */
export interface PolicyComparison {
  policyId: ID;
  policyName: string;
  originalApplied: boolean;
  replayApplied: boolean;
  originalAction?: ControlAction;
  replayAction?: ControlAction;
  actionChanged: boolean;
}

/**
 * Complete comparison report
 */
export interface ComparisonReport {
  id: ID;
  intentId: ID;
  replayId: ID;
  generatedAt: Timestamp;

  /** Overall match status */
  isMatch: boolean;

  /** Decision comparison */
  decision: {
    originalAction: ControlAction;
    replayAction: ControlAction;
    matches: boolean;
  };

  /** All differences found */
  differences: Difference[];

  /** Policy-level comparison */
  policyComparison: PolicyComparison[];

  /** Timing comparison */
  timing: TimingComparison;

  /** Summary statistics */
  summary: {
    totalDifferences: number;
    criticalDifferences: number;
    warningDifferences: number;
    infoDifferences: number;
    policiesCompared: number;
    policiesChanged: number;
  };

  /** Recommendations based on differences */
  recommendations: string[];
}

// ============================================================================
// Replay Result Types
// ============================================================================

/**
 * Steps in the replay execution
 */
export type ReplayStep =
  | 'restore'
  | 'trust-evaluation'
  | 'policy-evaluation'
  | 'decision'
  | 'execution'
  | 'complete';

/**
 * Individual step in replay execution
 */
export interface ReplayStepResult {
  step: ReplayStep;
  status: 'completed' | 'skipped' | 'stopped' | 'error';
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Result of a replay execution
 */
export interface ReplayResult {
  replayId: ID;
  intentId: ID;
  snapshotId: ID;
  tenantId: ID;
  replayedAt: Timestamp;

  /** Whether the replay completed successfully */
  success: boolean;

  /** Whether this was a dry run */
  dryRun: boolean;

  /** Execution steps */
  steps: ReplayStepResult[];

  /** Final outcome */
  outcome: {
    action: ControlAction;
    reason?: string;
    trustScore: TrustScore;
    trustLevel: TrustLevel;
    policiesApplied?: Array<{
      policyId: ID;
      policyName: string;
      action: ControlAction;
      reason?: string;
    }>;
  };

  /** Differences from original execution */
  differences: Difference[];

  /** Timing information */
  timing: {
    totalDurationMs: number;
    stepBreakdown: Record<ReplayStep, number>;
  };

  /** Comparison report if requested */
  comparison?: ComparisonReport;

  /** Error information if failed */
  error?: {
    message: string;
    step?: ReplayStep;
  };
}
