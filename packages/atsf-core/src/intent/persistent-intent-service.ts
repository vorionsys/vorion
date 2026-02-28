/**
 * Persistent Intent Service
 *
 * Production-quality intent service that provides:
 * - Input validation via Zod schemas
 * - Automatic expiration of stale intents
 * - State machine enforcement for status transitions
 * - Correlation ID tracking for distributed tracing
 * - Tenant isolation
 *
 * Uses an in-memory store by default. For durable persistence, subclass
 * and override the storage methods, or use the Supabase-backed variant.
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

const logger = createLogger({ component: "persistent-intent-service" });

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Valid status transitions for the intent lifecycle.
 * Any transition not listed here is rejected.
 */
const VALID_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  pending: ["evaluating", "cancelled"],
  evaluating: ["approved", "denied", "escalated", "failed"],
  approved: ["executing", "cancelled"],
  denied: [],
  escalated: ["approved", "denied", "cancelled"],
  executing: ["completed", "failed"],
  completed: [],
  failed: ["pending"], // allow retry
  cancelled: [],
};

// =============================================================================
// VALIDATION
// =============================================================================

function validateSubmission(submission: IntentSubmission): string[] {
  const errors: string[] = [];

  if (!submission.entityId || typeof submission.entityId !== "string") {
    errors.push("entityId is required and must be a non-empty string");
  }
  if (!submission.goal || typeof submission.goal !== "string") {
    errors.push("goal is required and must be a non-empty string");
  }
  if (submission.goal && submission.goal.length > 10_000) {
    errors.push("goal must be 10,000 characters or fewer");
  }
  if (
    submission.context !== undefined &&
    (typeof submission.context !== "object" || submission.context === null)
  ) {
    errors.push("context must be a plain object");
  }
  if (submission.expiresIn !== undefined) {
    if (typeof submission.expiresIn !== "number" || submission.expiresIn <= 0) {
      errors.push("expiresIn must be a positive number (milliseconds)");
    }
    if (submission.expiresIn > 86_400_000) {
      errors.push("expiresIn cannot exceed 24 hours (86400000ms)");
    }
  }

  return errors;
}

// =============================================================================
// PERSISTENT INTENT SERVICE
// =============================================================================

export interface PersistentIntentServiceConfig {
  /** Default expiration time for intents without explicit expiresIn (ms). Default: 1 hour */
  defaultExpirationMs?: number;
  /** How often to sweep expired intents (ms). Default: 60 seconds. 0 to disable. */
  expirationSweepIntervalMs?: number;
  /** Maximum intents per entity per tenant. Default: 1000 */
  maxIntentsPerEntity?: number;
}

const DEFAULT_CONFIG: Required<PersistentIntentServiceConfig> = {
  defaultExpirationMs: 3_600_000,
  expirationSweepIntervalMs: 60_000,
  maxIntentsPerEntity: 1_000,
};

/**
 * Production-quality intent service with validation, state machine,
 * expiration, and tenant isolation.
 */
export class PersistentIntentService implements IIntentService {
  private intents = new Map<ID, Intent>();
  private entityIndex = new Map<string, Set<ID>>(); // "tenantId:entityId" → intent IDs
  private config: Required<PersistentIntentServiceConfig>;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: PersistentIntentServiceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.expirationSweepIntervalMs > 0) {
      this.sweepTimer = setInterval(
        () => this.sweepExpired(),
        this.config.expirationSweepIntervalMs,
      );
      // Don't prevent Node.js from exiting
      if (
        this.sweepTimer &&
        typeof this.sweepTimer === "object" &&
        "unref" in this.sweepTimer
      ) {
        this.sweepTimer.unref();
      }
    }
  }

  /**
   * Submit a new intent with full validation.
   */
  async submit(
    submission: IntentSubmission,
    options: SubmitOptions,
  ): Promise<Intent> {
    // Validate input
    const errors = validateSubmission(submission);
    if (errors.length > 0) {
      throw new Error(`Invalid intent submission: ${errors.join("; ")}`);
    }

    if (!options.tenantId) {
      throw new Error("tenantId is required in SubmitOptions");
    }

    // Check per-entity limit
    const indexKey = `${options.tenantId}:${submission.entityId}`;
    const existingIds = this.entityIndex.get(indexKey);
    if (existingIds && existingIds.size >= this.config.maxIntentsPerEntity) {
      throw new Error(
        `Entity '${submission.entityId}' has reached the maximum of ${this.config.maxIntentsPerEntity} active intents`,
      );
    }

    const now = new Date().toISOString();
    const correlationId = submission.correlationId ?? crypto.randomUUID();
    const expiresAt = submission.expiresIn
      ? new Date(Date.now() + submission.expiresIn).toISOString()
      : new Date(Date.now() + this.config.defaultExpirationMs).toISOString();

    const intent: Intent = {
      id: crypto.randomUUID(),
      tenantId: options.tenantId,
      entityId: submission.entityId,
      goal: submission.goal,
      context: submission.context ?? {},
      metadata: submission.metadata ?? {},
      status: "pending",
      createdAt: now,
      updatedAt: now,
      trustSnapshot: options.trustSnapshot ?? null,
      trustLevel: options.trustLevel ?? null,
      correlationId,
      actionType: submission.actionType ?? null,
      resourceScope: submission.resourceScope ?? null,
      dataSensitivity: submission.dataSensitivity ?? null,
      reversibility: submission.reversibility ?? null,
      expiresAt,
      source: submission.source ?? null,
    };

    // Store
    this.intents.set(intent.id, intent);

    // Update entity index
    if (!this.entityIndex.has(indexKey)) {
      this.entityIndex.set(indexKey, new Set());
    }
    this.entityIndex.get(indexKey)!.add(intent.id);

    logger.info(
      {
        intentId: intent.id,
        entityId: intent.entityId,
        tenantId: options.tenantId,
        goal: intent.goal.slice(0, 100),
        correlationId,
        actionType: intent.actionType,
      },
      "Intent submitted",
    );

    return intent;
  }

  /**
   * Get an intent by ID with tenant isolation.
   */
  async get(id: ID, tenantId: ID): Promise<Intent | undefined> {
    const intent = this.intents.get(id);
    if (!intent || intent.tenantId !== tenantId) {
      return undefined;
    }

    // Check expiration
    if (this.isExpired(intent)) {
      await this.expireIntent(intent);
      return undefined;
    }

    return intent;
  }

  /**
   * Update intent status with state machine enforcement.
   */
  async updateStatus(
    id: ID,
    tenantId: ID,
    status: IntentStatus,
  ): Promise<Intent | undefined> {
    const intent = this.intents.get(id);
    if (!intent || intent.tenantId !== tenantId) {
      return undefined;
    }

    // Validate transition
    const allowed = VALID_TRANSITIONS[intent.status];
    if (!allowed || !allowed.includes(status)) {
      throw new Error(
        `Invalid status transition: '${intent.status}' → '${status}'. ` +
          `Allowed transitions from '${intent.status}': [${allowed?.join(", ") ?? "none"}]`,
      );
    }

    const previousStatus = intent.status;
    intent.status = status;
    intent.updatedAt = new Date().toISOString();

    // Clean up terminal intents from entity index
    if (
      status === "completed" ||
      status === "cancelled" ||
      status === "denied"
    ) {
      const indexKey = `${tenantId}:${intent.entityId}`;
      this.entityIndex.get(indexKey)?.delete(id);
    }

    logger.info(
      { intentId: id, from: previousStatus, to: status },
      "Intent status updated",
    );

    return intent;
  }

  /**
   * List intents for an entity with tenant isolation.
   */
  async listByEntity(entityId: ID, tenantId: ID): Promise<Intent[]> {
    const indexKey = `${tenantId}:${entityId}`;
    const ids = this.entityIndex.get(indexKey);
    if (!ids || ids.size === 0) return [];

    const results: Intent[] = [];
    for (const id of ids) {
      const intent = this.intents.get(id);
      if (intent && !this.isExpired(intent)) {
        results.push(intent);
      }
    }

    // Sort by creation time (newest first)
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Get count of active intents.
   */
  count(): number {
    return this.intents.size;
  }

  /**
   * Shut down the service and clean up timers.
   */
  close(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Clear all intents (for testing).
   */
  clear(): void {
    this.intents.clear();
    this.entityIndex.clear();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private isExpired(intent: Intent): boolean {
    if (!intent.expiresAt) return false;
    return new Date(intent.expiresAt).getTime() < Date.now();
  }

  private async expireIntent(intent: Intent): Promise<void> {
    if (
      intent.status !== "completed" &&
      intent.status !== "cancelled" &&
      intent.status !== "denied"
    ) {
      intent.status = "cancelled";
      intent.updatedAt = new Date().toISOString();
      logger.debug({ intentId: intent.id }, "Intent expired");
    }
  }

  private sweepExpired(): void {
    let swept = 0;
    for (const [id, intent] of this.intents) {
      if (this.isExpired(intent)) {
        // Remove terminal intents entirely, expire active ones
        const isTerminal = [
          "completed",
          "cancelled",
          "denied",
          "failed",
        ].includes(intent.status);
        if (isTerminal) {
          this.intents.delete(id);
          const indexKey = `${intent.tenantId}:${intent.entityId}`;
          this.entityIndex.get(indexKey)?.delete(id);
          swept++;
        } else {
          this.expireIntent(intent);
          swept++;
        }
      }
    }
    if (swept > 0) {
      logger.debug({ swept }, "Expired intents swept");
    }
  }
}
