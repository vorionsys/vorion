/**
 * INTENT Module Types
 *
 * Shared type definitions for the INTENT module.
 * This file exists to break circular dependencies between:
 * - index.ts (IntentService)
 * - queues.ts (uses IntentService)
 * - routes.ts (uses IntentService)
 * - shutdown.ts (uses queues.ts)
 *
 * @packageDocumentation
 */

import type {
  ID,
  Intent,
  IntentEvaluationRecord,
  IntentStatus,
  TrustLevel,
  TrustScore,
  EvaluationPayload,
} from '../common/types.js';
import type { IntentEventRecord, PaginatedResult } from './repository.js';

// =============================================================================
// Intent Submission Types
// =============================================================================

/**
 * Payload size limits for security and performance
 */
export const PAYLOAD_LIMITS = {
  MAX_PAYLOAD_SIZE_BYTES: 1024 * 1024, // 1MB max total payload
  MAX_CONTEXT_BYTES: 64 * 1024, // 64KB max context (backward compatible)
  MAX_CONTEXT_KEYS: 100,
  MAX_STRING_LENGTH: 10000,
} as const;

/**
 * Intent submission payload (inferred from schema in index.ts)
 */
export interface IntentSubmission {
  entityId: string;
  goal: string;
  context: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  intentType?: string;
  priority?: number;
  idempotencyKey?: string;
}

/**
 * Options for submitting an intent
 */
export interface SubmitOptions {
  tenantId: ID;
  trustSnapshot?: Record<string, unknown> | null;
  /** Current trust level of the entity (for trust gate validation) */
  trustLevel?: TrustLevel;
  /** Skip trust gate validation (use with caution) */
  bypassTrustGate?: boolean;
  /** User ID for consent validation (required when consent checking is enabled) */
  userId?: ID;
  /** Skip consent validation (use with caution - only for system intents) */
  bypassConsentCheck?: boolean;
}

/**
 * Options for listing intents
 */
export interface ListOptions {
  tenantId: ID;
  entityId?: ID;
  status?: IntentStatus;
  /** Page size limit (default: 50, max: 1000) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
  /** Cursor for pagination (last intent ID from previous page) - mutually exclusive with offset */
  cursor?: ID;
  /**
   * If true, throw an error when limit exceeds MAX_PAGE_SIZE instead of silently capping.
   * Default: false (silently cap to MAX_PAGE_SIZE for backwards compatibility)
   */
  strictLimitValidation?: boolean;
}

/**
 * Options for cancelling an intent
 */
export interface CancelOptions {
  tenantId: ID;
  reason: string;
  cancelledBy?: string;
}

/**
 * Intent with associated events and evaluations
 */
export interface IntentWithEvents {
  intent: Intent;
  events: IntentEventRecord[];
  evaluations?: IntentEvaluationRecord[];
}

// =============================================================================
// Bulk Intent Types
// =============================================================================

/**
 * Options for bulk intent submission
 */
export interface BulkIntentOptions {
  /** Stop processing on first error (default: false - continue processing all items) */
  stopOnError?: boolean;
  /** Return successful items even if some fail (default: true) */
  returnPartial?: boolean;
}

/**
 * Bulk intent submission request
 */
export interface BulkIntentSubmission {
  /** Array of intents to submit (1-100 items) */
  intents: IntentSubmission[];
  /** Optional processing options */
  options?: BulkIntentOptions;
}

/**
 * Result for a single failed intent in bulk submission
 * Note: 'input' uses a generic type to accommodate Zod-inferred types from the actual implementation
 */
export interface BulkIntentFailure<T = IntentSubmission> {
  /** Index of the failed intent in the original array */
  index: number;
  /** The original input that failed */
  input: T;
  /** Error message describing the failure */
  error: string;
}

/**
 * Result of bulk intent submission
 * Note: Uses generic type to accommodate Zod-inferred types from the actual implementation
 */
export interface BulkIntentResult<T = IntentSubmission> {
  /** Successfully created intents */
  successful: Intent[];
  /** Failed intents with error details */
  failed: BulkIntentFailure<T>[];
  /** Summary statistics */
  stats: {
    /** Total number of intents in the request */
    total: number;
    /** Number of successfully created intents */
    succeeded: number;
    /** Number of failed intents */
    failed: number;
  };
}

// =============================================================================
// Intent Service Interface
// =============================================================================

/**
 * Interface for the IntentService class.
 * This interface is used to break circular dependencies by allowing
 * other modules to depend on the interface instead of the implementation.
 *
 * Note: Methods use less strict types to accommodate Zod-inferred types
 * from the actual implementation while maintaining type safety for consumers.
 */
export interface IIntentService {
  submit(payload: Record<string, unknown>, options: SubmitOptions): Promise<Intent>;
  get(id: ID, tenantId: ID): Promise<Intent | null>;
  getWithEvents(id: ID, tenantId: ID): Promise<IntentWithEvents | null>;
  updateStatus(
    id: ID,
    tenantId: ID,
    status: IntentStatus,
    previousStatus?: IntentStatus,
    options?: { skipValidation?: boolean; hasReason?: boolean; hasPermission?: boolean }
  ): Promise<Intent | null>;
  cancel(id: ID, options: CancelOptions): Promise<Intent | null>;
  delete(id: ID, tenantId: ID): Promise<Intent | null>;
  list(options: ListOptions): Promise<PaginatedResult<Intent>>;
  submitBulk(
    submissions: Record<string, unknown>[],
    options: {
      tenantId: ID;
      stopOnError?: boolean;
      trustSnapshot?: Record<string, unknown> | null;
      trustLevel?: TrustLevel;
      bypassTrustGate?: boolean;
      userId?: ID;
      bypassConsentCheck?: boolean;
    }
  ): Promise<BulkIntentResult<Record<string, unknown>>>;
  updateTrustMetadata(
    id: ID,
    tenantId: ID,
    trustSnapshot: Record<string, unknown> | null,
    trustLevel?: TrustLevel,
    trustScore?: TrustScore
  ): Promise<Intent | null>;
  recordEvaluation(
    intentId: ID,
    tenantId: ID,
    payload: EvaluationPayload
  ): Promise<IntentEvaluationRecord>;
  verifyEventChain(intentId: ID): Promise<{
    valid: boolean;
    invalidAt?: number;
    error?: string;
  }>;
  getRequiredTrustLevel(intentType?: string | null): TrustLevel;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { Intent, IntentStatus, TrustLevel, TrustScore, ID, EvaluationPayload };
export type { IntentEventRecord, PaginatedResult };
