/**
 * INTENT - Goal Processing (SDK Package)
 *
 * This module provides intent handling for the @vorionsys/atsf-core SDK.
 *
 * For production use with persistence, use the full implementation from the
 * vorion core package. This SDK package provides:
 * - Type definitions aligned with @vorion/contracts
 * - In-memory mock for testing
 * - Interface definitions for custom implementations
 *
 * @packageDocumentation
 */

import { createLogger } from "../common/logger.js";
import type { Intent, ID, IntentStatus } from "../common/types.js";
import type {
  IIntentService,
  IntentSubmission,
  SubmitOptions,
} from "./types.js";

export * from "./types.js";

/* eslint-disable no-redeclare */

const logger = createLogger({ component: "intent" });

// =============================================================================
// CANONICAL FIELD ENUMS (aligned with @vorion/contracts)
// =============================================================================

/**
 * Action types for categorizing intents
 */
export const ActionType = {
  READ: "read",
  WRITE: "write",
  DELETE: "delete",
  EXECUTE: "execute",
  COMMUNICATE: "communicate",
  TRANSFER: "transfer",
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/**
 * Data sensitivity levels
 */
export const DataSensitivity = {
  PUBLIC: "PUBLIC",
  INTERNAL: "INTERNAL",
  CONFIDENTIAL: "CONFIDENTIAL",
  RESTRICTED: "RESTRICTED",
} as const;

export type DataSensitivity =
  (typeof DataSensitivity)[keyof typeof DataSensitivity];

/**
 * Action reversibility classification
 */
export const Reversibility = {
  REVERSIBLE: "REVERSIBLE",
  PARTIALLY_REVERSIBLE: "PARTIALLY_REVERSIBLE",
  IRREVERSIBLE: "IRREVERSIBLE",
} as const;

export type Reversibility = (typeof Reversibility)[keyof typeof Reversibility];

/* eslint-enable no-redeclare */

// =============================================================================
// IN-MEMORY MOCK IMPLEMENTATION
// =============================================================================

/**
 * In-memory intent service for testing and development
 *
 * WARNING: This is NOT suitable for production use.
 * For production, connect to the Vorion API or use the full
 * implementation from the vorion core package.
 *
 * @example
 * ```typescript
 * // For testing
 * const mockService = new MockIntentService();
 * const intent = await mockService.submit({
 *   entityId: 'agent-123',
 *   goal: 'Send notification',
 *   context: { channel: 'email' },
 *   actionType: ActionType.COMMUNICATE,
 *   dataSensitivity: DataSensitivity.INTERNAL,
 *   reversibility: Reversibility.REVERSIBLE,
 * }, { tenantId: 'tenant-1' });
 * ```
 */
export class MockIntentService implements IIntentService {
  private intents: Map<ID, Intent> = new Map();

  /**
   * Submit a new intent (in-memory)
   */
  async submit(
    submission: IntentSubmission,
    options: SubmitOptions,
  ): Promise<Intent> {
    const now = new Date().toISOString();
    const correlationId = submission.correlationId ?? crypto.randomUUID();

    const intent: Intent = {
      id: crypto.randomUUID(),
      tenantId: options.tenantId,
      entityId: submission.entityId,
      goal: submission.goal,
      context: submission.context,
      metadata: submission.metadata ?? {},
      status: "pending",
      createdAt: now,
      updatedAt: now,
      trustSnapshot: options.trustSnapshot ?? null,
      trustLevel: options.trustLevel ?? null,

      // Canonical fields
      correlationId,
      actionType: submission.actionType ?? null,
      resourceScope: submission.resourceScope ?? null,
      dataSensitivity: submission.dataSensitivity ?? null,
      reversibility: submission.reversibility ?? null,
      expiresAt: submission.expiresIn
        ? new Date(Date.now() + submission.expiresIn).toISOString()
        : null,
      source: submission.source ?? null,
    };

    this.intents.set(intent.id, intent);
    logger.info(
      { intentId: intent.id, goal: intent.goal, correlationId },
      "Intent submitted (mock)",
    );

    return intent;
  }

  /**
   * Get an intent by ID
   */
  async get(id: ID, tenantId: ID): Promise<Intent | undefined> {
    const intent = this.intents.get(id);
    if (intent && intent.tenantId === tenantId) {
      return intent;
    }
    return undefined;
  }

  /**
   * Update intent status
   */
  async updateStatus(
    id: ID,
    tenantId: ID,
    status: IntentStatus,
  ): Promise<Intent | undefined> {
    const intent = this.intents.get(id);
    if (!intent || intent.tenantId !== tenantId) return undefined;

    intent.status = status;
    intent.updatedAt = new Date().toISOString();
    logger.info({ intentId: id, status }, "Intent status updated (mock)");

    return intent;
  }

  /**
   * List intents for an entity
   */
  async listByEntity(entityId: ID, tenantId: ID): Promise<Intent[]> {
    return Array.from(this.intents.values()).filter(
      (i) => i.entityId === entityId && i.tenantId === tenantId,
    );
  }

  /**
   * Clear all intents (useful for test cleanup)
   */
  clear(): void {
    this.intents.clear();
  }

  /**
   * Get total count of intents (useful for testing)
   */
  count(): number {
    return this.intents.size;
  }
}

// =============================================================================
// BACKWARDS COMPATIBLE EXPORTS
// =============================================================================

/**
 * Intent service class
 *
 * @deprecated Use MockIntentService explicitly for testing, or implement
 *             IIntentService for production use with the Vorion API.
 */
export class IntentService extends MockIntentService {}

// =============================================================================
// SERVICE FACTORY & INJECTION
// =============================================================================

let intentService: IIntentService | null = null;

/**
 * Set the intent service implementation to use at runtime.
 * Call this during application bootstrap with a real backend.
 */
export function setIntentService(service: IIntentService): void {
  intentService = service;
}

/**
 * Get the configured intent service.
 * Throws if no real backend has been provided via setIntentService().
 */
export function getIntentService(): IIntentService {
  if (!intentService) {
    throw new Error(
      "No intent service backend configured. Pass a real IntentService implementation or see docs for setup.",
    );
  }
  return intentService;
}

/**
 * Create a new intent service instance
 *
 * Throws if no real backend is provided. For tests, use createMockIntentService().
 */
export function createIntentService(service?: IIntentService): IIntentService {
  if (!service) {
    throw new Error(
      "No intent service backend configured. Pass a real IntentService implementation or see docs for setup.",
    );
  }
  return service;
}

/**
 * Create a mock intent service for testing only.
 */
export function createMockIntentService(): MockIntentService {
  return new MockIntentService();
}

// =============================================================================
// PRODUCTION IMPLEMENTATION
// =============================================================================

export { PersistentIntentService } from "./persistent-intent-service.js";
export type { PersistentIntentServiceConfig } from "./persistent-intent-service.js";
