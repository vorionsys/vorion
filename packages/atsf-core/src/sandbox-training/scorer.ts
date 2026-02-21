/**
 * Sandbox Adversarial Training Boot Camp — Scorer
 *
 * Maps challenge results to trust signals and attestation records
 * compatible with the Vorion trust engine and agent registry.
 *
 * @packageDocumentation
 */

import type { ChallengeResult } from './types.js';
import { FACTOR_TO_SIGNAL, DIFFICULTY_WEIGHTS } from './types.js';
import type { TrustSignal } from '../common/types.js';

// =============================================================================
// TRUST SIGNAL GENERATION
// =============================================================================

/**
 * Convert a challenge result into a trust signal for the trust engine.
 *
 * Signal type follows the `behavioral.*` and `compliance.*` patterns
 * expected by the trust engine's component scoring.
 */
export function challengeToTrustSignal(result: ChallengeResult): TrustSignal {
  const signalPrefix = FACTOR_TO_SIGNAL[result.factor];

  return {
    id: `bootcamp-${result.challengeId}-${Date.now()}`,
    entityId: result.agentId,
    type: `${signalPrefix}.${result.difficulty}`,
    value: result.score,
    source: 'sandbox-training',
    timestamp: result.completedAt,
    metadata: {
      challengeId: result.challengeId,
      passed: result.passed,
      adversarialHandled: result.adversarialHandled,
      responseTimeMs: result.responseTimeMs,
      weight: DIFFICULTY_WEIGHTS[result.difficulty],
    },
  };
}

// =============================================================================
// ATTESTATION GENERATION
// =============================================================================

/** Attestation record shape (compatible with agent registry's NewAttestation) */
export interface BootCampAttestation {
  agentId: string;
  type: 'BEHAVIORAL';
  outcome: 'success' | 'failure' | 'warning';
  action: string;
  evidence: Record<string, unknown>;
  source: string;
}

/**
 * Convert a challenge result into a BEHAVIORAL attestation
 * for the agent registry.
 */
export function challengeToAttestation(
  result: ChallengeResult
): BootCampAttestation {
  return {
    agentId: result.agentId,
    type: 'BEHAVIORAL',
    outcome: result.passed ? 'success' : 'failure',
    action: `bootcamp.${result.factor}.${result.difficulty}`,
    evidence: {
      challengeId: result.challengeId,
      score: result.score,
      adversarialHandled: result.adversarialHandled,
      responseTimeMs: result.responseTimeMs,
      notes: result.notes,
      weight: DIFFICULTY_WEIGHTS[result.difficulty],
    },
    source: 'sandbox-training',
  };
}

/**
 * Calculate the weighted score contribution of a challenge result.
 */
export function calculateWeightedScore(result: ChallengeResult): number {
  return result.score * DIFFICULTY_WEIGHTS[result.difficulty];
}

/**
 * Calculate the total weighted score for a set of challenge results.
 */
export function calculateTotalWeightedScore(
  results: ChallengeResult[]
): number {
  if (results.length === 0) return 0;

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const result of results) {
    const weight = DIFFICULTY_WEIGHTS[result.difficulty];
    totalWeightedScore += result.score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
}
