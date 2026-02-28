/**
 * Intent Service Types
 *
 * Extracted from intent/index.ts to break circular dependency with
 * persistent-intent-service.ts.
 *
 * @packageDocumentation
 */

import type { Intent, ID, IntentStatus } from "../common/types.js";

// =============================================================================
// CANONICAL FIELD TYPE ALIASES
// (Narrow string unions matching the const objects in index.ts)
// =============================================================================

/** Action type values (mirrors ActionType const in index.ts) */
type ActionTypeValue =
  | "read"
  | "write"
  | "delete"
  | "execute"
  | "communicate"
  | "transfer";

/** Data sensitivity values (mirrors DataSensitivity const in index.ts) */
type DataSensitivityValue =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "RESTRICTED";

/** Reversibility values (mirrors Reversibility const in index.ts) */
type ReversibilityValue =
  | "REVERSIBLE"
  | "PARTIALLY_REVERSIBLE"
  | "IRREVERSIBLE";

// =============================================================================
// INTENT SUBMISSION TYPES
// =============================================================================

/**
 * Intent submission request with canonical fields
 */
export interface IntentSubmission {
  /** Agent/entity making the request */
  entityId: ID;
  /** Human-readable goal/action description */
  goal: string;
  /** Additional context for evaluation */
  context: Record<string, unknown>;
  /** Optional metadata */
  metadata?: Record<string, unknown>;

  // Canonical fields (optional for backwards compatibility)
  /** Correlation ID for distributed tracing */
  correlationId?: string;
  /** Action type category */
  actionType?: ActionTypeValue;
  /** Resources this intent accesses/modifies */
  resourceScope?: string[];
  /** Data sensitivity level */
  dataSensitivity?: DataSensitivityValue;
  /** Whether action can be undone */
  reversibility?: ReversibilityValue;
  /** Intent expiration in milliseconds from now */
  expiresIn?: number;
  /** Source system identifier */
  source?: string;
}

/**
 * Options for submitting an intent
 */
export interface SubmitOptions {
  /** Tenant identifier */
  tenantId: ID;
  /** Trust snapshot at submission time */
  trustSnapshot?: Record<string, unknown> | null;
  /** Current trust level of the entity */
  trustLevel?: number;
}

// =============================================================================
// INTENT SERVICE INTERFACE
// =============================================================================

/**
 * Interface for intent service implementations
 *
 * Implement this interface to create custom intent handling:
 * - API client for remote Vorion service
 * - Custom persistence layer
 * - Testing mocks with specific behaviors
 */
export interface IIntentService {
  submit(submission: IntentSubmission, options: SubmitOptions): Promise<Intent>;
  get(id: ID, tenantId: ID): Promise<Intent | undefined>;
  updateStatus(
    id: ID,
    tenantId: ID,
    status: IntentStatus,
  ): Promise<Intent | undefined>;
  listByEntity(entityId: ID, tenantId: ID): Promise<Intent[]>;
}
