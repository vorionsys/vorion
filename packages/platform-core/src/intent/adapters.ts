/**
 * Intent Adapters
 *
 * Provides conversion between internal Intent type (src/common/types.ts)
 * and canonical Intent type (@vorion/contracts).
 *
 * This adapter layer enables gradual migration to canonical types while
 * maintaining backwards compatibility with existing internal code.
 *
 * @packageDocumentation
 */

import {
  ActionType,
  DataSensitivity,
  Reversibility,
  TrustBand,
} from '@vorionsys/contracts';
import type {
  Canonical,
} from '@vorionsys/contracts';
import type {
  Intent as InternalIntent,
  IntentStatus as InternalIntentStatus,
  TrustLevel,
} from '../common/types.js';

// Import canonical TrustScore for TrustSnapshot compatibility
type CanonicalTrustScore = Canonical.TrustScore;

// Use canonical types from the Canonical namespace
type CanonicalIntent = Canonical.Intent;
type CanonicalIntentContext = Canonical.IntentContext;
type CanonicalIntentStatus = Canonical.IntentStatus;
type TrustSnapshot = Canonical.TrustSnapshot;
type CreateIntentRequest = Canonical.CreateIntentRequest;

// =============================================================================
// TYPE MAPPINGS
// =============================================================================

/**
 * Maps internal trust level (0-7) to canonical TrustBand enum
 */
export function trustLevelToTrustBand(level: TrustLevel | null | undefined): TrustBand {
  if (level === null || level === undefined) {
    return TrustBand.T0_SANDBOX;
  }

  const mapping: Record<TrustLevel, TrustBand> = {
    0: TrustBand.T0_SANDBOX,
    1: TrustBand.T1_OBSERVED,
    2: TrustBand.T2_PROVISIONAL,
    3: TrustBand.T3_MONITORED,
    4: TrustBand.T4_STANDARD,
    5: TrustBand.T5_TRUSTED,
    6: TrustBand.T6_CERTIFIED,
    7: TrustBand.T7_AUTONOMOUS,
  };

  return mapping[level] ?? TrustBand.T0_SANDBOX;
}

/**
 * Maps canonical TrustBand enum to internal trust level (0-7)
 */
export function trustBandToTrustLevel(band: TrustBand): TrustLevel {
  return band as TrustLevel;
}

/**
 * Parses action type string to ActionType enum
 */
export function parseActionType(value: string | null | undefined): ActionType {
  if (!value) return ActionType.EXECUTE;

  const normalized = value.toLowerCase();
  const mapping: Record<string, ActionType> = {
    read: ActionType.READ,
    write: ActionType.WRITE,
    delete: ActionType.DELETE,
    execute: ActionType.EXECUTE,
    communicate: ActionType.COMMUNICATE,
    transfer: ActionType.TRANSFER,
  };

  return mapping[normalized] ?? ActionType.EXECUTE;
}

/**
 * Parses data sensitivity string to DataSensitivity enum
 */
export function parseDataSensitivity(value: string | null | undefined): DataSensitivity {
  if (!value) return DataSensitivity.INTERNAL;

  const normalized = value.toUpperCase();
  const mapping: Record<string, DataSensitivity> = {
    PUBLIC: DataSensitivity.PUBLIC,
    INTERNAL: DataSensitivity.INTERNAL,
    CONFIDENTIAL: DataSensitivity.CONFIDENTIAL,
    RESTRICTED: DataSensitivity.RESTRICTED,
  };

  return mapping[normalized] ?? DataSensitivity.INTERNAL;
}

/**
 * Parses reversibility string to Reversibility enum
 */
export function parseReversibility(value: string | null | undefined): Reversibility {
  if (!value) return Reversibility.REVERSIBLE;

  const normalized = value.toUpperCase();
  const mapping: Record<string, Reversibility> = {
    REVERSIBLE: Reversibility.REVERSIBLE,
    PARTIALLY_REVERSIBLE: Reversibility.PARTIALLY_REVERSIBLE,
    IRREVERSIBLE: Reversibility.IRREVERSIBLE,
  };

  return mapping[normalized] ?? Reversibility.REVERSIBLE;
}

// =============================================================================
// INTERNAL TO CANONICAL
// =============================================================================

/**
 * Extended internal intent with optional canonical fields
 * This represents the transitional state where internal intents may have
 * canonical fields attached
 */
export interface ExtendedInternalIntent extends InternalIntent {
  correlationId?: string | null;
  actionType?: string | null;
  resourceScope?: string[] | null;
  dataSensitivity?: string | null;
  reversibility?: string | null;
  expiresAt?: string | null;
  denialReason?: string | null;
  failureReason?: string | null;
  decisionId?: string | null;
  executionId?: string | null;
  source?: string | null;
}

/**
 * Converts internal Intent to canonical Intent format
 *
 * @param internal - Internal intent (may include extended canonical fields)
 * @returns Canonical intent
 */
export function toCanonicalIntent(internal: ExtendedInternalIntent): CanonicalIntent {
  // Build trust snapshot from internal fields
  const trustSnapshot: TrustSnapshot = {
    score: (internal.trustScore ?? 0) as CanonicalTrustScore,
    band: trustLevelToTrustBand(internal.trustLevel),
    capturedAt: new Date(internal.createdAt),
    profileVersion: undefined,
  };

  // Extract context fields from internal context
  const internalContext = internal.context ?? {};
  const canonicalContext: CanonicalIntentContext = {
    domain: internalContext.domain as string | undefined,
    environment: internalContext.environment as string | undefined,
    onBehalfOf: internalContext.onBehalfOf as string | undefined,
    sessionId: internalContext.sessionId as string | undefined,
    parentIntentId: internalContext.parentIntentId as string | undefined,
    priority: internal.priority ?? (internalContext.priority as number | undefined),
    handlesPii: internalContext.handlesPii as boolean | undefined,
    handlesPhi: internalContext.handlesPhi as boolean | undefined,
    jurisdictions: internalContext.jurisdictions as string[] | undefined,
    tags: internalContext.tags as string[] | undefined,
    metadata: internal.metadata,
  };

  const canonical: CanonicalIntent = {
    intentId: internal.id,
    tenantId: internal.tenantId,
    agentId: internal.entityId,
    correlationId: internal.correlationId ?? crypto.randomUUID(),
    action: internal.goal,
    actionType: parseActionType(internal.actionType ?? internal.intentType),
    resourceScope: internal.resourceScope ?? [],
    dataSensitivity: parseDataSensitivity(internal.dataSensitivity),
    reversibility: parseReversibility(internal.reversibility),
    context: canonicalContext,
    trustSnapshot,
    status: internal.status as CanonicalIntentStatus,
    createdAt: new Date(internal.createdAt),
    updatedAt: new Date(internal.updatedAt),
    expiresAt: internal.expiresAt ? new Date(internal.expiresAt) : undefined,
    deletedAt: internal.deletedAt ? new Date(internal.deletedAt) : undefined,
    cancellationReason: internal.cancellationReason ?? undefined,
    denialReason: internal.denialReason ?? undefined,
    failureReason: internal.failureReason ?? undefined,
    source: internal.source ?? undefined,
    decisionId: internal.decisionId ?? undefined,
    executionId: internal.executionId ?? undefined,
  };

  return canonical;
}

// =============================================================================
// CANONICAL TO INTERNAL
// =============================================================================

/**
 * Converts canonical Intent to internal Intent format
 *
 * @param canonical - Canonical intent from @vorion/contracts
 * @returns Internal intent with extended fields
 */
export function toInternalIntent(canonical: CanonicalIntent): ExtendedInternalIntent {
  // Flatten context metadata into internal context
  const internalContext: Record<string, unknown> = {
    domain: canonical.context.domain,
    environment: canonical.context.environment,
    onBehalfOf: canonical.context.onBehalfOf,
    sessionId: canonical.context.sessionId,
    parentIntentId: canonical.context.parentIntentId,
    handlesPii: canonical.context.handlesPii,
    handlesPhi: canonical.context.handlesPhi,
    jurisdictions: canonical.context.jurisdictions,
    tags: canonical.context.tags,
    ...canonical.context.metadata,
  };

  // Remove undefined values
  Object.keys(internalContext).forEach((key) => {
    if (internalContext[key] === undefined) {
      delete internalContext[key];
    }
  });

  const internal: ExtendedInternalIntent = {
    id: canonical.intentId,
    tenantId: canonical.tenantId,
    entityId: canonical.agentId,
    goal: canonical.action,
    intentType: canonical.actionType,
    priority: canonical.context.priority,
    context: internalContext,
    metadata: canonical.context.metadata ?? {},
    trustSnapshot: {
      score: canonical.trustSnapshot.score,
      band: canonical.trustSnapshot.band,
    },
    trustLevel: trustBandToTrustLevel(canonical.trustSnapshot.band),
    trustScore: canonical.trustSnapshot.score as number,
    status: canonical.status as InternalIntentStatus,
    createdAt: canonical.createdAt.toISOString(),
    updatedAt: canonical.updatedAt.toISOString(),
    deletedAt: canonical.deletedAt?.toISOString() ?? null,
    cancellationReason: canonical.cancellationReason ?? null,

    // Extended canonical fields
    correlationId: canonical.correlationId,
    actionType: canonical.actionType,
    resourceScope: canonical.resourceScope,
    dataSensitivity: canonical.dataSensitivity,
    reversibility: canonical.reversibility,
    expiresAt: canonical.expiresAt?.toISOString() ?? null,
    denialReason: canonical.denialReason ?? null,
    failureReason: canonical.failureReason ?? null,
    decisionId: canonical.decisionId ?? null,
    executionId: canonical.executionId ?? null,
    source: canonical.source ?? null,
  };

  return internal;
}

// =============================================================================
// CREATE REQUEST ADAPTERS
// =============================================================================

/**
 * Converts a CreateIntentRequest to internal submission format
 */
export function fromCreateIntentRequest(
  request: CreateIntentRequest,
  tenantId: string
): {
  submission: {
    entityId: string;
    goal: string;
    context: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    intentType?: string;
    priority?: number;
    idempotencyKey?: string;
  };
  extended: {
    correlationId?: string;
    actionType: string;
    resourceScope: string[];
    dataSensitivity: string;
    reversibility: string;
    expiresAt?: Date;
    source?: string;
  };
} {
  return {
    submission: {
      entityId: request.agentId,
      goal: request.action,
      context: request.context ?? {},
      metadata: request.context?.metadata,
      intentType: request.actionType,
      priority: request.context?.priority,
    },
    extended: {
      correlationId: request.correlationId,
      actionType: request.actionType,
      resourceScope: request.resourceScope,
      dataSensitivity: request.dataSensitivity,
      reversibility: request.reversibility,
      expiresAt: request.expiresInMs
        ? new Date(Date.now() + request.expiresInMs)
        : undefined,
      source: request.source,
    },
  };
}

// =============================================================================
// BATCH ADAPTERS
// =============================================================================

/**
 * Converts an array of internal intents to canonical format
 */
export function toCanonicalIntents(internals: ExtendedInternalIntent[]): CanonicalIntent[] {
  return internals.map(toCanonicalIntent);
}

/**
 * Converts an array of canonical intents to internal format
 */
export function toInternalIntents(canonicals: CanonicalIntent[]): ExtendedInternalIntent[] {
  return canonicals.map(toInternalIntent);
}
