/**
 * INTENT Read Audit Logging
 *
 * SOC2 compliant audit logging for read operations in the INTENT module.
 * Tracks who accessed/viewed data for compliance reporting.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

import { eq, and, gte, lte, desc, count } from "drizzle-orm";

import { auditReads } from "./schema.js";
import {
  withCircuitBreaker,
  withCircuitBreakerResult,
  CircuitBreakerOpenError,
} from "../common/circuit-breaker.js";
import { getDatabase } from "../common/db.js";
import { createLogger } from "../common/logger.js";
import { getRedis } from "../common/redis.js";

import type { ID } from "../common/types.js";

// Dead-letter queue key for audit entries that overflow the in-memory queue
// SOC2 requires completeness - we must never drop audit entries
const AUDIT_DLQ_KEY = "audit:dlq";

// Re-export CircuitBreakerOpenError for consumers
export { CircuitBreakerOpenError };

const logger = createLogger({ component: "intent-audit" });

// =============================================================================
// AUDIT ACTION TYPES
// =============================================================================

export type AuditAction =
  | "intent.create"
  | "intent.read"
  | "intent.read_list"
  | "intent.update"
  | "intent.delete"
  | "escalation.read"
  | "escalation.approve"
  | "escalation.reject"
  | "webhook.read"
  | "webhook.read_deliveries"
  | "webhook.read_delivery"
  | "webhook.read_failed_deliveries"
  | "webhook.replay"
  | "gdpr.export"
  | "gdpr.erase"
  | "governance.read_regime"
  | "governance.update_config";

// =============================================================================
// AUDIT ENTRY TYPES
// =============================================================================

export type AuditResourceType =
  | "intent"
  | "escalation"
  | "webhook"
  | "user_data"
  | "governance";

export interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

export type CreateAuditEntry = Omit<AuditEntry, "id" | "timestamp">;

// =============================================================================
// AUDIT QUERY TYPES
// =============================================================================

export interface AuditQueryFilters {
  tenantId: ID;
  userId?: string;
  action?: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// ASYNC AUDIT QUEUE
// =============================================================================

/**
 * Simple in-memory queue for fire-and-forget audit logging.
 * Uses setImmediate to not block the request path.
 * SOC2 Compliance: Overflowed entries are persisted to Redis DLQ, never dropped.
 */
class AuditQueue {
  private queue: CreateAuditEntry[] = [];
  private processing = false;
  private readonly maxBatchSize = 100;
  private readonly flushIntervalMs = 1000;
  private readonly maxQueueSize = 10000;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dlqFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Start periodic flush
    this.startFlushTimer();
    // Start DLQ recovery timer
    this.startDlqFlushTimer();
  }

  /**
   * Add an entry to the queue for async processing
   */
  async enqueue(entry: CreateAuditEntry): Promise<void> {
    this.queue.push(entry);

    // If queue is getting large, process immediately
    if (this.queue.length >= this.maxBatchSize) {
      try {
        await this.flush();
      } catch (error) {
        logger.error({ error }, "Failed to flush audit queue during enqueue");
      }
    }
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Start the DLQ recovery timer - tries to recover entries from DLQ periodically
   */
  private startDlqFlushTimer(): void {
    if (this.dlqFlushTimer) {
      clearInterval(this.dlqFlushTimer);
    }
    // Try to recover from DLQ every 30 seconds
    this.dlqFlushTimer = setInterval(() => {
      this.recoverFromDlq();
    }, 30000);
  }

  /**
   * Persist entries to Redis dead-letter queue for SOC2 compliance.
   * Audit entries must NEVER be dropped - they are persisted to DLQ for later recovery.
   */
  private async persistToDlq(entries: CreateAuditEntry[]): Promise<void> {
    try {
      const redis = getRedis();
      const serialized = entries.map((e) => JSON.stringify(e));
      await redis.rpush(AUDIT_DLQ_KEY, ...serialized);
      logger.warn(
        { count: entries.length },
        "Audit entries persisted to DLQ for SOC2 compliance",
      );
    } catch (dlqError) {
      // Last resort: log entries for manual recovery
      logger.error(
        { error: dlqError, entries, count: entries.length },
        "CRITICAL: Failed to persist audit entries to DLQ - logging for manual recovery",
      );
    }
  }

  /**
   * Recover entries from DLQ and attempt to flush them
   */
  private async recoverFromDlq(): Promise<void> {
    if (this.processing) return;

    try {
      const redis = getRedis();
      const dlqLength = await redis.llen(AUDIT_DLQ_KEY);

      if (dlqLength === 0) return;

      // Only recover if main queue has capacity
      if (this.queue.length >= this.maxQueueSize / 2) {
        logger.debug({ dlqLength }, "DLQ recovery skipped - main queue busy");
        return;
      }

      // Pop a batch from DLQ
      const batchSize = Math.min(this.maxBatchSize, dlqLength);
      const entries: CreateAuditEntry[] = [];

      for (let i = 0; i < batchSize; i++) {
        const item = await redis.lpop(AUDIT_DLQ_KEY);
        if (item) {
          try {
            entries.push(JSON.parse(item) as CreateAuditEntry);
          } catch {
            logger.error({ item }, "Failed to parse DLQ entry");
          }
        }
      }

      if (entries.length > 0) {
        // Add recovered entries to main queue for processing
        this.queue.unshift(...entries);
        logger.info({ count: entries.length }, "Recovered entries from DLQ");
      }
    } catch (error) {
      logger.error({ error }, "Failed to recover from DLQ");
    }
  }

  /**
   * Get the current DLQ size for monitoring
   */
  async getDlqSize(): Promise<number> {
    try {
      const redis = getRedis();
      return await redis.llen(AUDIT_DLQ_KEY);
    } catch {
      return 0;
    }
  }

  /**
   * Flush the queue to the database.
   * Uses circuit breaker to prevent cascading failures and avoid
   * overwhelming the database during outages.
   */
  private async flush(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const batch = this.queue.splice(0, this.maxBatchSize);

    try {
      // Use withCircuitBreakerResult to avoid throwing on circuit open
      // since audit logging should never fail the main request
      const result = await withCircuitBreakerResult(
        "auditService",
        async () => {
          const db = getDatabase();
          const now = new Date();

          const values = batch.map((entry) => ({
            id: randomUUID(),
            tenantId: entry.tenantId,
            userId: entry.userId,
            action: entry.action,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            metadata: entry.metadata ?? null,
            ipAddress: entry.ipAddress ?? null,
            userAgent: entry.userAgent ?? null,
            timestamp: now,
          }));

          await db.insert(auditReads).values(values);
          return batch.length;
        },
      );

      if (result.success) {
        logger.debug(
          { count: batch.length },
          "Audit entries flushed to database",
        );
      } else if (result.circuitOpen) {
        // Circuit is open - re-queue for later retry
        logger.warn(
          { count: batch.length },
          "Audit circuit breaker is open, re-queuing entries for retry",
        );
        if (this.queue.length < this.maxQueueSize) {
          this.queue.unshift(...batch);
        } else {
          // SOC2 compliance: persist to DLQ instead of dropping
          await this.persistToDlq(batch);
        }
      } else {
        // Execution failed
        logger.error(
          { error: result.error, count: batch.length },
          "Failed to flush audit entries",
        );
        // Re-queue failed entries for retry (with limit to prevent memory issues)
        if (this.queue.length < this.maxQueueSize) {
          this.queue.unshift(...batch);
        } else {
          // SOC2 compliance: persist to DLQ instead of dropping
          await this.persistToDlq(batch);
        }
      }
    } catch (error) {
      // Catch-all for unexpected errors
      logger.error(
        { error, count: batch.length },
        "Unexpected error flushing audit entries",
      );

      // Re-queue failed entries for retry
      if (this.queue.length < this.maxQueueSize) {
        this.queue.unshift(...batch);
      } else {
        // SOC2 compliance: persist to DLQ instead of dropping
        await this.persistToDlq(batch);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Force flush and cleanup (for graceful shutdown)
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dlqFlushTimer) {
      clearInterval(this.dlqFlushTimer);
      this.dlqFlushTimer = null;
    }
    await this.flush();
  }
}

/**
 * Get the current audit DLQ size for monitoring/alerting
 * @returns Number of entries in the DLQ
 */
export async function getAuditDlqSize(): Promise<number> {
  return getAuditQueue().getDlqSize();
}

// Singleton queue instance
let auditQueue: AuditQueue | null = null;

function getAuditQueue(): AuditQueue {
  if (!auditQueue) {
    auditQueue = new AuditQueue();
  }
  return auditQueue;
}

// =============================================================================
// AUDIT FUNCTIONS
// =============================================================================

/**
 * Record an audit entry asynchronously.
 * Uses a queue to batch writes and avoid blocking the request path.
 *
 * @param entry - The audit entry to record (without id and timestamp)
 */
export async function recordAudit(entry: CreateAuditEntry): Promise<void> {
  // Fire and forget - enqueue for async processing
  setImmediate(() => {
    try {
      getAuditQueue().enqueue(entry);
    } catch (error) {
      // Log but don't throw - audit logging should never fail requests
      logger.error({ error, entry }, "Failed to enqueue audit entry");
    }
  });
}

/**
 * Record an audit entry synchronously (for testing or critical paths).
 * Prefer recordAudit() for production use.
 * Protected by circuit breaker to prevent cascading failures.
 *
 * @param entry - The audit entry to record
 * @returns The created audit entry with id and timestamp
 * @throws CircuitBreakerOpenError if the audit service circuit breaker is open
 */
export async function recordAuditSync(
  entry: CreateAuditEntry,
): Promise<AuditEntry> {
  return withCircuitBreaker("auditService", async () => {
    const db = getDatabase();
    const now = new Date();
    const id = randomUUID();

    const [row] = await db
      .insert(auditReads)
      .values({
        id,
        tenantId: entry.tenantId,
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        timestamp: now,
      })
      .returning();

    logger.debug(
      {
        auditId: row.id,
        action: entry.action,
        resourceType: entry.resourceType,
      },
      "Audit entry recorded",
    );

    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      action: row.action as AuditAction,
      resourceType: row.resourceType as AuditResourceType,
      resourceId: row.resourceId,
      metadata: row.metadata as Record<string, unknown> | undefined,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
      timestamp: row.timestamp,
    };
  });
}

// =============================================================================
// AUDIT QUERY FUNCTIONS
// =============================================================================

/**
 * Query audit log entries for compliance reporting.
 * Supports filtering by user, action, resource, and time range.
 * Protected by circuit breaker to prevent cascading failures.
 *
 * @param filters - Query filters
 * @returns Paginated audit entries
 * @throws CircuitBreakerOpenError if the audit service circuit breaker is open
 */
export async function queryAuditLog(
  filters: AuditQueryFilters,
): Promise<AuditQueryResult> {
  return withCircuitBreaker("auditService", async () => {
    const db = getDatabase();
    const limit = Math.min(filters.limit ?? 50, 1000);
    const offset = filters.offset ?? 0;

    const conditions = [eq(auditReads.tenantId, filters.tenantId)];

    if (filters.userId) {
      conditions.push(eq(auditReads.userId, filters.userId));
    }

    if (filters.action) {
      conditions.push(eq(auditReads.action, filters.action));
    }

    if (filters.resourceType) {
      conditions.push(eq(auditReads.resourceType, filters.resourceType));
    }

    if (filters.resourceId) {
      conditions.push(eq(auditReads.resourceId, filters.resourceId));
    }

    if (filters.from) {
      conditions.push(gte(auditReads.timestamp, filters.from));
    }

    if (filters.to) {
      conditions.push(lte(auditReads.timestamp, filters.to));
    }

    // Get total count using COUNT(*) - avoids OOM on large tables
    const countResult = await db
      .select({ count: count() })
      .from(auditReads)
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;

    // Get paginated results
    const rows = await db
      .select()
      .from(auditReads)
      .where(and(...conditions))
      .orderBy(desc(auditReads.timestamp))
      .limit(limit)
      .offset(offset);

    const entries: AuditEntry[] = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      action: row.action as AuditAction,
      resourceType: row.resourceType as AuditResourceType,
      resourceId: row.resourceId,
      metadata: row.metadata as Record<string, unknown> | undefined,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
      timestamp: row.timestamp,
    }));

    return {
      entries,
      total,
      hasMore: offset + entries.length < total,
    };
  });
}

/**
 * Get audit entries for a specific resource.
 * Useful for showing access history on a detail page.
 *
 * @param tenantId - Tenant identifier
 * @param resourceType - Type of resource
 * @param resourceId - Resource identifier
 * @param limit - Maximum entries to return
 * @returns Recent audit entries for the resource
 */
export async function getResourceAuditHistory(
  tenantId: ID,
  resourceType: AuditResourceType,
  resourceId: string,
  limit = 100,
): Promise<AuditEntry[]> {
  const result = await queryAuditLog({
    tenantId,
    resourceType,
    resourceId,
    limit,
  });

  return result.entries;
}

/**
 * Get audit entries for a specific user.
 * Useful for user activity reports and compliance audits.
 *
 * @param tenantId - Tenant identifier
 * @param userId - User identifier
 * @param options - Query options
 * @returns Audit entries for the user
 */
export async function getUserAuditHistory(
  tenantId: ID,
  userId: string,
  options?: { from?: Date; to?: Date; limit?: number },
): Promise<AuditEntry[]> {
  const result = await queryAuditLog({
    tenantId,
    userId,
    from: options?.from,
    to: options?.to,
    limit: options?.limit,
  });

  return result.entries;
}

// =============================================================================
// CLEANUP & SHUTDOWN
// =============================================================================

/**
 * Gracefully shutdown the audit system.
 * Flushes any pending entries before returning.
 */
export async function shutdownAuditSystem(): Promise<void> {
  if (auditQueue) {
    await auditQueue.shutdown();
    auditQueue = null;
  }
}

// =============================================================================
// HELPER FUNCTIONS FOR ROUTES
// =============================================================================

/**
 * Extract request metadata for audit logging.
 * Helper function to standardize metadata extraction from requests.
 *
 * @param request - Fastify request object
 * @returns Metadata object with IP and user agent
 */
export function extractRequestMetadata(request: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): { ipAddress?: string; userAgent?: string } {
  const userAgentHeader = request.headers?.["user-agent"];
  return {
    ipAddress: request.ip,
    userAgent: Array.isArray(userAgentHeader)
      ? userAgentHeader[0]
      : userAgentHeader,
  };
}
