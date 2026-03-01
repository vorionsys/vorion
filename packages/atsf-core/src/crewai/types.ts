/**
 * CrewAI Adapter Types
 *
 * Type definitions for CrewAI integration with trust-gated multi-agent crews.
 *
 * @packageDocumentation
 */

import type { TrustLevel, TrustScore } from '../common/types.js';

// =============================================================================
// CREW CONFIGURATION
// =============================================================================

/**
 * Trust-aware crew agent configuration
 */
export interface CrewAgentConfig {
  /** Unique agent identifier */
  agentId: string;
  /** Agent role within the crew */
  role: string;
  /** Agent goal description */
  goal?: string;
  /** Initial trust level for new agents */
  initialTrustLevel?: TrustLevel;
  /** Minimum trust level required for task execution */
  minTrustLevel?: TrustLevel;
  /** Whether this agent can delegate tasks to others */
  allowDelegation?: boolean;
  /** Whether to record task execution as behavioral signals */
  recordTaskExecution?: boolean;
  /** Whether to record delegation as behavioral signals */
  recordDelegation?: boolean;
  /** Whether to record errors as failure signals */
  recordErrors?: boolean;
  /** Custom signal weights */
  signalWeights?: CrewSignalWeights;
}

/**
 * Signal weights for crew operations
 */
export interface CrewSignalWeights {
  taskSuccess?: number;
  taskFailure?: number;
  delegationSuccess?: number;
  delegationFailure?: number;
  crewSuccess?: number;
  crewFailure?: number;
}

/**
 * Crew configuration
 */
export interface CrewConfig {
  /** Unique crew identifier */
  crewId: string;
  /** Execution process type */
  process?: CrewProcess;
  /** Minimum average trust across all crew members for kickoff */
  minCrewTrust?: TrustLevel;
  /** Maximum number of tasks that can fail before crew aborts */
  maxTaskFailures?: number;
  /** Whether to record crew-level events as behavioral signals */
  recordCrewEvents?: boolean;
}

/**
 * Crew execution process type
 */
export type CrewProcess = 'sequential' | 'hierarchical';

// =============================================================================
// TASK TYPES
// =============================================================================

/**
 * Trust-aware task definition
 */
export interface CrewTaskConfig {
  /** Task identifier */
  taskId: string;
  /** Task description */
  description: string;
  /** Expected output description */
  expectedOutput?: string;
  /** Assigned agent ID (if pre-assigned) */
  assignedAgentId?: string;
  /** Minimum trust level for this specific task */
  minTrustLevel?: TrustLevel;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * CrewAI callback event types
 */
export type CrewCallbackEvent =
  | 'task_start'
  | 'task_end'
  | 'task_error'
  | 'delegation_start'
  | 'delegation_end'
  | 'delegation_error'
  | 'crew_start'
  | 'crew_end'
  | 'crew_error';

/**
 * Trust signal source for crew events
 */
export interface CrewSignalSource {
  event: CrewCallbackEvent;
  taskId?: string;
  agentId?: string;
  targetAgentId?: string;
  crewId?: string;
  duration?: number;
  error?: Error;
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Trust check result for crew operations
 */
export interface CrewTrustCheckResult {
  allowed: boolean;
  agentId: string;
  currentLevel: TrustLevel;
  currentScore: number;
  requiredLevel: TrustLevel;
  reason: string;
}

/**
 * Task execution result with trust context
 */
export interface TrustedTaskResult<T = unknown> {
  result: T;
  taskId: string;
  agentId: string;
  trustCheck: CrewTrustCheckResult;
  signalsRecorded: number;
  finalScore: number;
  finalLevel: TrustLevel;
}

/**
 * Crew execution result with trust context
 */
export interface TrustedCrewResult<T = unknown> {
  results: TrustedTaskResult<T>[];
  crewId: string;
  crewTrust: number;
  totalSignalsRecorded: number;
  tasksFailed: number;
  tasksCompleted: number;
}

/**
 * Delegation result with trust context
 */
export interface DelegationResult<T = unknown> {
  result: T;
  fromAgentId: string;
  toAgentId: string;
  trustCheck: CrewTrustCheckResult;
  delegateeTrustCheck: CrewTrustCheckResult;
}

// =============================================================================
// TRUST-GATED EXECUTOR TYPES
// =============================================================================

/**
 * Configuration for the TrustGatedCrewExecutor wrapper
 */
export interface TrustGatedCrewExecutorConfig {
  /** Crew configuration */
  crew: CrewConfig;
  /** Agent configurations */
  agents: CrewAgentConfig[];
  /** Minimum trust score (0-1000) required before task execution (default: 200) */
  trustScoreThreshold?: TrustScore;
  /** Minimum trust level required before task execution (default: 1) */
  trustLevelThreshold?: TrustLevel;
  /** Trust score penalty applied on task failure (default: 0.1 signal value = failure) */
  failureDecaySignalValue?: number;
  /** Trust score reward applied on task success (default: 0.85 signal value = success) */
  successRecoverySignalValue?: number;
  /** Tenant ID for enforcement context (default: 'default') */
  tenantId?: string;
  /** Whether to run enforcement (intent -> enforce -> execute) when available (default: true) */
  enableEnforcement?: boolean;
}

/**
 * Result of a trust-gated task execution attempt
 */
export interface TrustGatedTaskResult<T = unknown> {
  /** Whether the task was allowed to execute */
  allowed: boolean;
  /** The task execution result (if allowed and successful) */
  result?: TrustedTaskResult<T>;
  /** The agent that was assigned to the task */
  agentId: string;
  /** The task that was attempted */
  taskId: string;
  /** Trust score at time of decision */
  trustScoreAtDecision: TrustScore;
  /** Trust level at time of decision */
  trustLevelAtDecision: TrustLevel;
  /** Enforcement tier (GREEN/YELLOW/RED) if enforcement was used */
  enforcementTier?: 'GREEN' | 'YELLOW' | 'RED';
  /** Human-readable reason for the decision */
  reason: string;
  /** Duration of the gating decision in ms */
  gatingLatencyMs: number;
}

/**
 * Aggregated result from a trust-gated crew kickoff
 */
export interface TrustGatedCrewResult<T = unknown> {
  /** Results for each task (including denied tasks) */
  taskResults: TrustGatedTaskResult<T>[];
  /** The inner crew result (only tasks that executed) */
  crewResult?: TrustedCrewResult<T>;
  /** Total tasks attempted */
  totalTasks: number;
  /** Tasks that were allowed and completed */
  tasksCompleted: number;
  /** Tasks denied by trust gating */
  tasksDeniedByTrust: number;
  /** Tasks that failed during execution */
  tasksFailed: number;
  /** Crew ID */
  crewId: string;
}
