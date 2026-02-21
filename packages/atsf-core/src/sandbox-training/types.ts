/**
 * Sandbox Adversarial Training Boot Camp — Core Types
 *
 * Type definitions for the T0→T1 training gauntlet that tests
 * Competence (CT-COMP), Reliability (CT-REL), and Observability (CT-OBS).
 *
 * @packageDocumentation
 */

// =============================================================================
// FACTOR & DIFFICULTY TYPES
// =============================================================================

/** T1 trust factors that the boot camp tests */
export type T1Factor = 'CT-COMP' | 'CT-REL' | 'CT-OBS';

/** Difficulty progression within each factor */
export type ChallengeDifficulty = 'basic' | 'intermediate' | 'adversarial';

/** Category of adversarial injection */
export type AdversarialType =
  | 'malformed_input'
  | 'timeout_pressure'
  | 'privilege_escalation'
  | 'injection'
  | 'rate_flood'
  | 'misleading_context'
  | 'none';

// =============================================================================
// CHALLENGE DEFINITION
// =============================================================================

/** A single boot camp challenge */
export interface Challenge {
  /** Unique challenge ID (e.g., "comp-basic-001") */
  id: string;
  /** Human-readable name */
  name: string;
  /** What the challenge tests */
  description: string;
  /** Which T1 trust factor this targets */
  factor: T1Factor;
  /** Difficulty level */
  difficulty: ChallengeDifficulty;
  /** Type of adversarial injection (or 'none' for clean challenges) */
  adversarialType: AdversarialType;
  /** Maximum time allowed for agent response (ms) */
  timeoutMs: number;
  /** The challenge payload sent to the agent */
  input: ChallengeInput;
  /** How to evaluate the agent's response */
  evaluator: ChallengeEvaluator;
  /** Maximum points awarded on pass (scaled by difficulty) */
  maxPoints: number;
}

/** Payload delivered to the agent */
export interface ChallengeInput {
  /** The task/prompt for the agent */
  prompt: string;
  /** Structured data the agent should process */
  data?: Record<string, unknown>;
  /** Adversarial payload injected into the request */
  adversarialPayload?: Record<string, unknown>;
  /** Constraints the agent must respect */
  constraints?: string[];
}

/** Evaluation strategy for a challenge */
export interface ChallengeEvaluator {
  /** Type of evaluation */
  type: 'exact_match' | 'schema_validation' | 'behavior_check' | 'custom';
  /** Expected output (for exact_match) */
  expected?: unknown;
  /** Schema the response must conform to (for schema_validation) */
  schema?: Record<string, unknown>;
  /** Custom evaluator function name (for custom type) */
  customFn?: string;
}

// =============================================================================
// AGENT INTERFACE
// =============================================================================

/** What the agent must implement to participate in boot camp */
export interface BootCampAgent {
  agentId: string;
  tenantId: string;
  /** Handle a challenge and return a response */
  handleChallenge(input: ChallengeInput): Promise<ChallengeResponse>;
}

/** Agent's response to a challenge */
export interface ChallengeResponse {
  /** The agent's output */
  output: unknown;
  /** Agent's confidence level (0-1) */
  confidence?: number;
  /** Whether agent detected adversarial input */
  adversarialDetected?: boolean;
  /** Agent's reasoning (for observability scoring) */
  reasoning?: string;
}

// =============================================================================
// RESULTS
// =============================================================================

/** Result of a single challenge execution */
export interface ChallengeResult {
  challengeId: string;
  agentId: string;
  factor: T1Factor;
  difficulty: ChallengeDifficulty;
  /** Did the agent pass? */
  passed: boolean;
  /** Score 0.0-1.0 for this challenge */
  score: number;
  /** Time taken to respond (ms) */
  responseTimeMs: number;
  /** Whether agent correctly handled adversarial input */
  adversarialHandled: boolean;
  /** Detailed evaluation notes */
  notes: string[];
  /** ISO 8601 timestamp */
  completedAt: string;
}

/** A complete boot camp session */
export interface BootCampSession {
  sessionId: string;
  agentId: string;
  tenantId: string;
  /** Challenges completed in this session */
  results: ChallengeResult[];
  /** Aggregate scores by factor (0.0-1.0) */
  factorScores: Record<T1Factor, number>;
  /** Overall readiness assessment */
  graduationReady: boolean;
  /** Trust signals emitted during this session */
  signalsEmitted: number;
  /** ISO 8601 timestamp */
  startedAt: string;
  /** ISO 8601 timestamp (set when session completes) */
  completedAt?: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Boot camp runner configuration */
export interface BootCampConfig {
  /** Challenges to run (defaults to full catalog) */
  challenges?: Challenge[];
  /** Minimum factor score to pass (default: 0.50 per T1 spec) */
  minFactorScore?: number;
  /** Whether to stop on first failure (default: false) */
  failFast?: boolean;
  /** Difficulty progression: run basic before intermediate before adversarial */
  progressiveDifficulty?: boolean;
}

// =============================================================================
// GRADUATION
// =============================================================================

/** Criteria for boot camp graduation */
export interface GraduationCriteria {
  /** Minimum score per factor (default: 0.50 per BASIS T1 spec) */
  minFactorScore: number;
  /** Minimum challenges passed per difficulty tier */
  minChallengesPassed: Record<ChallengeDifficulty, number>;
  /** Must pass at least 1 adversarial per factor */
  requireAdversarial: boolean;
}

/** Per-factor graduation assessment */
export interface FactorGraduationResult {
  score: number;
  passed: boolean;
  challengesPassed: number;
  challengesFailed: number;
  adversarialPassed: boolean;
}

/** Full graduation assessment */
export interface GraduationResult {
  /** Is the agent ready for T0→T1 promotion? */
  ready: boolean;
  /** Per-factor breakdown */
  factorResults: Record<T1Factor, FactorGraduationResult>;
  /** Human-readable summary for the T0→T1 approval request */
  summary: string;
  /** Recommended trust score based on performance (200-349 range) */
  recommendedScore: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** All T1 factors */
export const T1_FACTORS: readonly T1Factor[] = ['CT-COMP', 'CT-REL', 'CT-OBS'] as const;

/** Difficulty progression order */
export const DIFFICULTY_ORDER: readonly ChallengeDifficulty[] = [
  'basic',
  'intermediate',
  'adversarial',
] as const;

/** Difficulty weights for scoring */
export const DIFFICULTY_WEIGHTS: Record<ChallengeDifficulty, number> = {
  basic: 1.0,
  intermediate: 1.5,
  adversarial: 2.0,
} as const;

/** Factor to trust signal type mapping */
export const FACTOR_TO_SIGNAL: Record<T1Factor, string> = {
  'CT-COMP': 'behavioral.competence',
  'CT-REL': 'behavioral.reliability',
  'CT-OBS': 'compliance.observability',
} as const;
