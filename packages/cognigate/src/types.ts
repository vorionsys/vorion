/**
 * Cognigate TypeScript SDK - Type Definitions
 *
 * Core types for the Cognigate AI governance API
 */

import { z } from 'zod';

import {
  TrustTier,
  TIER_THRESHOLDS,
  scoreToTier,
  getTierName,
  getTierColor,
  type TierThreshold,
} from '@vorionsys/shared-constants';

// =============================================================================
// TRUST TIERS (from @vorionsys/shared-constants)
// =============================================================================

// Re-export from shared-constants for SDK consumers
// This ensures all Vorion products use the same tier definitions
export {
  TrustTier,
  TIER_THRESHOLDS,
  scoreToTier,
  getTierName,
  getTierColor,
  type TierThreshold,
};

// =============================================================================
// GOVERNANCE DECISIONS
// =============================================================================

/**
 * Possible outcomes of a governance evaluation.
 *
 * - `ALLOW`: Action is permitted at the agent's current trust level
 * - `DENY`: Action is blocked due to insufficient trust or policy violation
 * - `ESCALATE`: Action requires human review or higher-authority approval
 * - `DEGRADE`: Action is partially allowed with reduced capabilities
 */
export type GovernanceDecision = 'ALLOW' | 'DENY' | 'ESCALATE' | 'DEGRADE';

/**
 * Complete result of a governance evaluation for an agent action.
 *
 * Contains the authorization decision, trust context at evaluation time,
 * capability grants/denials, and a proof ID for audit trail linkage.
 */
export interface GovernanceResult {
  /** The governance decision rendered */
  decision: GovernanceDecision;
  /** Trust score at evaluation time (0-1000) */
  trustScore: number;
  /** Trust tier at evaluation time */
  trustTier: TrustTier;
  /** Capabilities approved for this action */
  grantedCapabilities: string[];
  /** Capabilities that were denied */
  deniedCapabilities: string[];
  /** Human-readable explanation of the decision */
  reasoning: string;
  /** Constraints applied to the allowed action (e.g., rate limits, resource restrictions) */
  constraints?: Record<string, unknown>;
  /** Proof record ID for the immutable audit trail */
  proofId?: string;
  /** When the evaluation was performed */
  timestamp: Date;
}

// =============================================================================
// INTENT PARSING
// =============================================================================

/**
 * A parsed intent representing what an agent wants to do.
 *
 * Intents are created by parsing raw user/agent input into a structured
 * format with action classification, risk assessment, and capability requirements.
 */
export interface Intent {
  /** Unique intent identifier */
  id: string;
  /** ID of the entity (agent) submitting the intent */
  entityId: string;
  /** Original unstructured input text */
  rawInput: string;
  /** Structured action derived from the raw input */
  parsedAction: string;
  /** Action parameters extracted from the input */
  parameters: Record<string, unknown>;
  /** Assessed risk level of the intended action */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Capabilities the agent must have to perform this action */
  requiredCapabilities: string[];
  /** When the intent was created */
  timestamp: Date;
}

/**
 * Result of parsing raw input into a structured Intent.
 *
 * Includes the primary interpretation with a confidence score,
 * plus optional alternative interpretations for ambiguous inputs.
 */
export interface IntentParseResult {
  /** Primary parsed intent */
  intent: Intent;
  /** Confidence score for the primary interpretation (0-1) */
  confidence: number;
  /** Alternative interpretations if the input was ambiguous */
  alternativeInterpretations?: Intent[];
}

// =============================================================================
// TRUST STATUS
// =============================================================================

/**
 * Current trust status for an entity (agent) in the governance system.
 *
 * Provides a comprehensive view of trust standing, including the composite
 * score, individual factor scores, granted capabilities, compliance state,
 * and any active warnings.
 */
export interface TrustStatus {
  /** Unique identifier of the entity */
  entityId: string;
  /** Composite trust score on the 0-1000 scale */
  trustScore: number;
  /** Current trust tier (T0-T7) */
  trustTier: TrustTier;
  /** Human-readable tier name (e.g., 'Standard', 'Trusted') */
  tierName: string;
  /** Capabilities currently granted at this trust level */
  capabilities: string[];
  /** Individual trust factor scores (e.g., reliability, compliance) */
  factorScores: Record<string, number>;
  /** When the trust score was last evaluated */
  lastEvaluated: Date;
  /** Whether the entity meets all compliance requirements */
  compliant: boolean;
  /** Active warnings about trust degradation or policy violations */
  warnings: string[];
}

// =============================================================================
// PROOF RECORDS (Immutable Audit Trail)
// =============================================================================

/**
 * An immutable proof record in the governance audit trail.
 *
 * Proof records form a hash-linked chain, ensuring tamper-evident
 * logging of every governance decision and its outcome. Each record
 * captures the trust score delta caused by the action.
 */
export interface ProofRecord {
  /** Unique proof record identifier */
  id: string;
  /** Entity (agent) this proof belongs to */
  entityId: string;
  /** Associated intent identifier */
  intentId: string;
  /** Governance decision that was made */
  decision: GovernanceDecision;
  /** Human-readable action description */
  action: string;
  /** Outcome of the action execution */
  outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL' | 'PENDING';
  /** Trust score before the action was evaluated */
  trustScoreBefore: number;
  /** Trust score after the outcome was recorded */
  trustScoreAfter: number;
  /** When this proof was recorded */
  timestamp: Date;
  /** Cryptographic hash of this record's contents */
  hash: string;
  /** Hash of the preceding record in the chain */
  previousHash: string;
  /** Additional context or metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregate statistics for an entity's proof chain.
 *
 * Provides a high-level view of governance activity, including
 * success rates, average trust, and chain integrity status.
 */
export interface ProofChainStats {
  /** Total number of proof records in the chain */
  totalRecords: number;
  /** Ratio of successful outcomes (0-1) */
  successRate: number;
  /** Mean trust score across all records */
  averageTrustScore: number;
  /** Whether the hash chain is intact (no tampering detected) */
  chainIntegrity: boolean;
  /** When chain integrity was last verified */
  lastVerified: Date;
}

// =============================================================================
// AGENTS
// =============================================================================

/**
 * An agent registered in the Cognigate governance system.
 *
 * Represents a governed AI agent with its trust profile, operational
 * status, capabilities, and performance metrics.
 */
export interface Agent {
  /** Unique agent identifier */
  id: string;
  /** Human-readable agent name */
  name: string;
  /** Agent description or purpose */
  description: string;
  /** ID of the user/organization that owns this agent */
  ownerId: string;
  /** Current trust score (0-1000) */
  trustScore: number;
  /** Current trust tier (T0-T7) */
  trustTier: TrustTier;
  /** Operational status of the agent */
  status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'TERMINATED';
  /** Capabilities granted to the agent */
  capabilities: string[];
  /** Total number of governance-evaluated executions */
  executions: number;
  /** Ratio of successful executions (0-1) */
  successRate: number;
  /** When the agent was created */
  createdAt: Date;
  /** When the agent was last updated */
  updatedAt: Date;
  /** Additional agent metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Request payload for creating a new agent.
 */
export interface CreateAgentRequest {
  /** Human-readable agent name */
  name: string;
  /** Optional agent description */
  description?: string;
  /** Optional template to initialize the agent from */
  template?: string;
  /** Capabilities to grant on creation */
  initialCapabilities?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Request payload for updating an existing agent.
 *
 * All fields are optional; only provided fields are updated.
 */
export interface UpdateAgentRequest {
  /** Updated agent name */
  name?: string;
  /** Updated description */
  description?: string;
  /** Updated operational status */
  status?: 'ACTIVE' | 'PAUSED';
  /** Updated metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// API RESPONSES
// =============================================================================

/**
 * Standard API response envelope for all Cognigate endpoints.
 *
 * @typeParam T - The type of the response data payload
 */
export interface ApiResponse<T> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data (present when success is true) */
  data?: T;
  /** Error details (present when success is false) */
  error?: ApiError;
  /** Unique identifier for this request (useful for support tickets) */
  requestId: string;
  /** Server-side timestamp of the response */
  timestamp: Date;
}

/**
 * Structured error returned by the Cognigate API.
 */
export interface ApiError {
  /** Machine-readable error code (e.g., 'AGENT_NOT_FOUND', 'RATE_LIMITED') */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error context or field-level validation errors */
  details?: Record<string, unknown>;
}

/**
 * Paginated response wrapper for list endpoints.
 *
 * @typeParam T - The type of items in the list
 */
export interface PaginatedResponse<T> {
  /** Items on the current page */
  items: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current page number (1-indexed) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Whether more pages are available */
  hasMore: boolean;
}

// =============================================================================
// WEBHOOKS
// =============================================================================

/**
 * A webhook event delivered to registered webhook endpoints.
 *
 * Events are signed with HMAC-SHA256 using the webhook secret
 * for verification. Use `verifyWebhookSignature()` to validate.
 */
export interface WebhookEvent {
  /** Unique event identifier */
  id: string;
  /** Type of event that occurred */
  type: WebhookEventType;
  /** ID of the entity (agent) associated with the event */
  entityId: string;
  /** Event-specific data payload */
  payload: Record<string, unknown>;
  /** When the event occurred */
  timestamp: Date;
  /** HMAC-SHA256 signature for payload verification */
  signature: string;
}

/**
 * Types of webhook events emitted by the Cognigate system.
 *
 * Events follow a `resource.action` naming convention covering
 * agent lifecycle, trust changes, governance decisions, and alerts.
 */
export type WebhookEventType =
  | 'agent.created'
  | 'agent.updated'
  | 'agent.deleted'
  | 'agent.status_changed'
  | 'trust.score_changed'
  | 'trust.tier_changed'
  | 'governance.decision'
  | 'proof.recorded'
  | 'alert.triggered';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Configuration options for the Cognigate SDK client.
 *
 * @example
 * ```typescript
 * const config: CognigateConfig = {
 *   apiKey: 'cg_live_abc123',
 *   baseUrl: 'https://cognigate.example.com/v1',
 *   timeout: 15000,
 *   retries: 2,
 * };
 * ```
 */
export interface CognigateConfig {
  /** API key for authentication (required) */
  apiKey: string;
  /** Base URL for the Cognigate API (defaults to https://cognigate.dev/v1) */
  baseUrl?: string;
  /** Request timeout in milliseconds (defaults to 30000) */
  timeout?: number;
  /** Number of retry attempts for transient failures (defaults to 3) */
  retries?: number;
  /** Enable debug logging to console (defaults to false) */
  debug?: boolean;
  /** Secret for verifying inbound webhook signatures */
  webhookSecret?: string;
}

// =============================================================================
// ZOD SCHEMAS (for runtime validation)
// =============================================================================

/** Zod schema for runtime validation of TrustStatus API responses. */
export const TrustStatusSchema = z.object({
  entityId: z.string(),
  trustScore: z.number().min(0).max(1000),
  trustTier: z.nativeEnum(TrustTier),
  tierName: z.string(),
  capabilities: z.array(z.string()),
  factorScores: z.record(z.string(), z.number()),
  lastEvaluated: z.coerce.date(),
  compliant: z.boolean(),
  warnings: z.array(z.string()),
});

/** Zod schema for runtime validation of GovernanceResult API responses. */
export const GovernanceResultSchema = z.object({
  decision: z.enum(['ALLOW', 'DENY', 'ESCALATE', 'DEGRADE']),
  trustScore: z.number(),
  trustTier: z.nativeEnum(TrustTier),
  grantedCapabilities: z.array(z.string()),
  deniedCapabilities: z.array(z.string()),
  reasoning: z.string(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  proofId: z.string().optional(),
  timestamp: z.coerce.date(),
});

/** Zod schema for runtime validation of ProofRecord API responses. */
export const ProofRecordSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  intentId: z.string(),
  decision: z.enum(['ALLOW', 'DENY', 'ESCALATE', 'DEGRADE']),
  action: z.string(),
  outcome: z.enum(['SUCCESS', 'FAILURE', 'PARTIAL', 'PENDING']),
  trustScoreBefore: z.number(),
  trustScoreAfter: z.number(),
  timestamp: z.coerce.date(),
  hash: z.string(),
  previousHash: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Zod schema for runtime validation of Agent API responses. */
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ownerId: z.string(),
  trustScore: z.number(),
  trustTier: z.nativeEnum(TrustTier),
  status: z.enum(['ACTIVE', 'PAUSED', 'SUSPENDED', 'TERMINATED']),
  capabilities: z.array(z.string()),
  executions: z.number(),
  successRate: z.number(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
