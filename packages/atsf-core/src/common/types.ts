/**
 * Common types used throughout Vorion
 *
 * These types provide backwards compatibility with legacy code.
 * For new code, prefer using canonical types from @vorionsys/contracts.
 *
 * @see {@link @vorionsys/contracts} for canonical type definitions
 * @packageDocumentation
 */

/**
 * Unique identifier type
 */
export type ID = string;

/**
 * Timestamp in ISO 8601 format
 */
export type Timestamp = string;

/**
 * Trust level (T0-T7)
 *
 * Canonical 8-tier trust model using numeric values 0-7 on a 0-1000 scale.
 *
 * - T0: Sandbox (0-199) - Isolated testing
 * - T1: Observed (200-349) - Read-only, monitored
 * - T2: Provisional (350-499) - Basic operations, heavy supervision
 * - T3: Monitored (500-649) - Standard operations, continuous monitoring
 * - T4: Standard (650-799) - External API access, policy-governed
 * - T5: Trusted (800-875) - Cross-agent communication
 * - T6: Certified (876-950) - Admin tasks, minimal oversight
 * - T7: Autonomous (951-1000) - Full autonomy, self-governance
 */
export type TrustLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Trust score (0-1000)
 */
export type TrustScore = number;

/**
 * Entity types that can be governed
 */
export type EntityType = 'agent' | 'user' | 'service' | 'system';

/**
 * Intent status
 *
 * Represents the lifecycle states of an intent through the governance pipeline.
 *
 * @see {@link @vorionsys/contracts!Intent} for canonical intent definition
 */
export type IntentStatus =
  | 'pending'
  | 'evaluating'
  | 'approved'
  | 'denied'
  | 'escalated'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Control action types
 */
export type ControlAction =
  | 'allow'
  | 'deny'
  | 'escalate'
  | 'limit'
  | 'monitor'
  | 'terminate';

/**
 * Entity identity
 */
export interface Entity {
  id: ID;
  type: EntityType;
  name: string;
  trustScore: TrustScore;
  trustLevel: TrustLevel;
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Intent representing a goal to be governed
 */
export interface Intent {
  id: ID;
  tenantId?: ID;
  entityId: ID;
  goal: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: IntentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Trust snapshot at submission time */
  trustSnapshot?: Record<string, unknown> | null;
  /** Current trust level of the entity */
  trustLevel?: number | null;
  /** Correlation ID for distributed tracing */
  correlationId?: string;
  /** Action type category */
  actionType?: string | null;
  /** Resources this intent accesses/modifies */
  resourceScope?: string[] | null;
  /** Data sensitivity level */
  dataSensitivity?: string | null;
  /** Whether action can be undone */
  reversibility?: string | null;
  /** Intent expiration */
  expiresAt?: string | null;
  /** Source system identifier */
  source?: string | null;
}

/**
 * Constraint definition
 */
export interface Constraint {
  id: ID;
  namespace: string;
  name: string;
  description: string;
  version: string;
  rule: ConstraintRule;
  enabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Constraint rule definition
 */
export interface ConstraintRule {
  when: ConstraintCondition;
  evaluate: ConstraintEvaluation[];
}

/**
 * Constraint condition
 */
export interface ConstraintCondition {
  intentType?: string;
  entityType?: EntityType;
  conditions?: Record<string, unknown>;
}

/**
 * Constraint evaluation step
 */
export interface ConstraintEvaluation {
  condition: string;
  result: ControlAction;
  reason?: string;
}

/**
 * Evaluation result from BASIS
 */
export interface EvaluationResult {
  constraintId: ID;
  passed: boolean;
  action: ControlAction;
  reason: string;
  details: Record<string, unknown>;
  durationMs: number;
  evaluatedAt: Timestamp;
}

/**
 * Decision from ENFORCE
 */
export interface Decision {
  intentId: ID;
  action: ControlAction;
  constraintsEvaluated: EvaluationResult[];
  trustScore: TrustScore;
  trustLevel: TrustLevel;
  escalation?: EscalationRequest;
  decidedAt: Timestamp;
}

/**
 * Escalation request
 */
export interface EscalationRequest {
  id: ID;
  intentId: ID;
  reason: string;
  escalatedTo: string;
  timeout: string;
  status: 'pending' | 'approved' | 'rejected' | 'timeout';
  createdAt: Timestamp;
}

/**
 * Proof record for audit trail
 */
export interface Proof {
  id: ID;
  chainPosition: number;
  intentId: ID;
  entityId: ID;
  decision: Decision;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  /** SHA-256 hash (primary chain hash) */
  hash: string;
  /** SHA3-256 hash (integrity anchor, future-proof). Absent on pre-upgrade records. */
  hash3?: string;
  previousHash: string;
  signature: string;
  createdAt: Timestamp;
}

/**
 * Trust signal for scoring
 *
 * Represents evidence that affects trust score calculation.
 * Maps to canonical TrustEvidence from @vorionsys/contracts.
 *
 * @see {@link @vorionsys/contracts!TrustEvidence} for canonical evidence type
 */
export interface TrustSignal {
  id: ID;
  entityId: ID;
  type: string;
  value: number;
  /** Source of the signal (optional for backwards compatibility) */
  source?: string;
  timestamp: Timestamp;
  /** Additional metadata (optional for backwards compatibility) */
  metadata?: Record<string, unknown>;
}

/**
 * Trust score breakdown (Legacy 4-dimension model)
 *
 * @deprecated Prefer using canonical TrustFactorScores from @vorionsys/contracts
 * which uses 16 trust factors (CT-COMP, CT-REL, CT-OBS, etc.) scored 0.0-1.0
 *
 * @see {@link @vorionsys/contracts!TrustFactorScores} for canonical factor model
 */
export interface TrustComponents {
  behavioral: number;
  compliance: number;
  identity: number;
  context: number;
}

/**
 * Risk level for operations
 *
 * Maps to canonical RiskProfile from @vorionsys/contracts.
 *
 * @see {@link @vorionsys/contracts!RiskProfile} for canonical risk levels
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error types
 */
export class VorionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'VorionError';
  }
}

export class ConstraintViolationError extends VorionError {
  constructor(
    public constraintId: ID,
    public constraintName: string,
    message: string,
    public suggestion?: string
  ) {
    super(message, 'CONSTRAINT_VIOLATION', { constraintId, constraintName });
    this.name = 'ConstraintViolationError';
  }
}

export class TrustInsufficientError extends VorionError {
  constructor(
    public required: TrustLevel,
    public actual: TrustLevel
  ) {
    super(
      `Trust level ${actual} insufficient, requires ${required}`,
      'TRUST_INSUFFICIENT',
      { required, actual }
    );
    this.name = 'TrustInsufficientError';
  }
}
