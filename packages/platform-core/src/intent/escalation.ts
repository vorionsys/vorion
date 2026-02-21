/**
 * INTENT Escalation Service
 *
 * Manages human-in-the-loop approval workflows for high-risk intents.
 * Uses PostgreSQL as primary storage with Redis for caching and fast lookups.
 * Supports escalation creation, acknowledgment, approval/rejection, and timeout handling.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import { getConfig, type Config } from '../common/config.js';
import { getRedis } from '../common/redis.js';
import { getDatabase } from '../common/db.js';
import type { ID } from '../common/types.js';
import { EscalationError, DatabaseError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { extractTenantId } from '../common/tenant-context.js';
import {
  escalations,
  type EscalationRow,
  type NewEscalationRow,
} from './schema.js';
import {
  escalationsCreated,
  escalationResolutions,
  escalationPendingDuration,
  escalationsPending,
  updateSlaBreachRate,
  updateEscalationApprovalRate,
} from './metrics.js';

const logger = createLogger({ component: 'escalation' });

// =============================================================================
// DEPENDENCY INJECTION TYPES
// =============================================================================

/**
 * Dependencies for EscalationService
 *
 * Use these to inject dependencies for testing or custom configurations.
 * If not provided, defaults to global singletons for backward compatibility.
 */
export interface EscalationServiceDependencies {
  /** Drizzle database instance */
  database?: NodePgDatabase;
  /** Redis client instance */
  redis?: Redis;
  /** Application configuration */
  config?: Config;
}

export type EscalationStatus = 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'timeout' | 'cancelled';

export interface EscalationRecord {
  id: ID;
  intentId: ID;
  tenantId: ID;
  reason: string;
  reasonCategory: 'trust_insufficient' | 'high_risk' | 'policy_violation' | 'manual_review' | 'constraint_escalate';
  escalatedTo: string; // Role or user ID
  escalatedBy?: string;
  status: EscalationStatus;
  resolution?: {
    resolvedBy: string;
    resolvedAt: string;
    notes?: string;
  };
  timeout: string; // ISO duration (e.g., "PT1H" for 1 hour)
  timeoutAt: string; // ISO timestamp when escalation expires
  acknowledgedAt?: string;
  slaBreached: boolean;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Options for creating an escalation
 *
 * SECURITY: tenantId is now obtained from TenantContext in the create() method,
 * not from user input. This prevents tenant ID injection attacks.
 */
export interface CreateEscalationOptions {
  intentId: ID;
  reason: string;
  reasonCategory: EscalationRecord['reasonCategory'];
  escalatedTo: string;
  escalatedBy?: string;
  timeout?: string; // ISO duration, defaults to config
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ResolveEscalationOptions {
  resolvedBy: string;
  notes?: string;
}

/**
 * Filters for listing escalations
 *
 * SECURITY: tenantId is obtained from TenantContext in the list() method.
 */
export interface ListEscalationFilters {
  status?: EscalationStatus | EscalationStatus[];
  intentId?: ID;
  escalatedTo?: string;
  limit?: number;
  cursor?: ID;
  includeSlaBreached?: boolean;
}

/**
 * Calculate timeout timestamp from ISO duration
 */
function calculateTimeout(isoDuration: string): Date {
  const now = new Date();

  // Parse ISO 8601 duration (simplified: PT1H, PT30M, P1D, etc.)
  const match = isoDuration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) {
    throw new EscalationError(`Invalid ISO duration: ${isoDuration}`, { isoDuration });
  }

  const days = parseInt(match[1] ?? '0', 10);
  const hours = parseInt(match[2] ?? '0', 10);
  const minutes = parseInt(match[3] ?? '0', 10);
  const seconds = parseInt(match[4] ?? '0', 10);

  now.setDate(now.getDate() + days);
  now.setHours(now.getHours() + hours);
  now.setMinutes(now.getMinutes() + minutes);
  now.setSeconds(now.getSeconds() + seconds);

  return now;
}

/**
 * Map database row to EscalationRecord
 */
function mapRow(row: EscalationRow): EscalationRecord {
  const base: EscalationRecord = {
    id: row.id,
    intentId: row.intentId,
    tenantId: row.tenantId,
    reason: row.reason,
    reasonCategory: row.reasonCategory,
    escalatedTo: row.escalatedTo,
    status: row.status,
    timeout: row.timeout,
    timeoutAt: row.timeoutAt.toISOString(),
    slaBreached: row.slaBreached ?? false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.escalatedBy) {
    base.escalatedBy = row.escalatedBy;
  }

  if (row.acknowledgedAt) {
    base.acknowledgedAt = row.acknowledgedAt.toISOString();
  }

  if (row.resolvedBy && row.resolvedAt) {
    base.resolution = {
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt.toISOString(),
    };
    if (row.resolutionNotes) {
      base.resolution.notes = row.resolutionNotes;
    }
  }

  if (row.context) {
    base.context = row.context as Record<string, unknown>;
  }

  if (row.metadata) {
    base.metadata = row.metadata as Record<string, unknown>;
  }

  return base;
}

/**
 * Escalation Service with PostgreSQL persistence and Redis caching
 *
 * SECURITY: All methods now accept TenantContext instead of raw tenantId.
 * TenantContext can only be created from validated JWT tokens, preventing
 * tenant ID injection attacks.
 *
 * @see TenantContext in ../common/tenant-context.ts
 */
export class EscalationService {
  private config: Config;
  private redis: Redis;
  private db: NodePgDatabase;
  private readonly cachePrefix = 'escalation:cache:';
  private readonly indexPrefix = 'escalation:idx:';
  private readonly cacheTtlSeconds = 300; // 5 minutes cache TTL

  /**
   * Create a new EscalationService instance.
   *
   * @param deps - Optional dependencies for dependency injection.
   *               If not provided, uses global singletons (backward compatible).
   *
   * @example
   * // Default usage (backward compatible)
   * const service = new EscalationService();
   *
   * @example
   * // With dependency injection (for testing)
   * const service = new EscalationService({
   *   database: mockDb,
   *   redis: mockRedis,
   *   config: testConfig,
   * });
   */
  constructor(deps: EscalationServiceDependencies = {}) {
    this.config = deps.config ?? getConfig();
    this.redis = deps.redis ?? getRedis();
    this.db = deps.database ?? getDatabase();
  }

  /**
   * Create a new escalation for an intent
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param options - Escalation creation options
   * @returns Created escalation record
   */
  async create(ctx: TenantContext, options: CreateEscalationOptions): Promise<EscalationRecord> {
    const tenantId = extractTenantId(ctx);
    const timeout = options.timeout ?? this.config.intent.escalationTimeout ?? 'PT1H';
    const timeoutAt = calculateTimeout(timeout);
    const now = new Date();

    const newEscalation: NewEscalationRow = {
      id: randomUUID(),
      intentId: options.intentId,
      tenantId,
      reason: options.reason,
      reasonCategory: options.reasonCategory,
      escalatedTo: options.escalatedTo,
      escalatedBy: options.escalatedBy ?? ctx.userId,
      status: 'pending',
      timeout,
      timeoutAt,
      context: options.context ?? null,
      metadata: options.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into PostgreSQL
    const [row] = await this.db.insert(escalations).values(newEscalation).returning();
    if (!row) throw new DatabaseError('Failed to create escalation', { intentId: options.intentId });

    const escalation = mapRow(row);

    // Update Redis indexes for fast lookups
    // Wrapped in try/catch: DB is source of truth, Redis index failure is non-fatal
    try {
      await this.updateRedisIndexes(escalation, 'add');
    } catch (error) {
      logger.error(
        { error, escalationId: escalation.id, intentId: options.intentId },
        'Failed to update Redis indexes after escalation creation (non-fatal)'
      );
    }

    // Record metrics
    escalationsCreated.inc({
      tenant_id: tenantId,
      intent_type: (options.metadata?.intentType as string) ?? 'unknown',
      reason_category: options.reasonCategory,
    });
    escalationsPending.inc({ tenant_id: tenantId });

    logger.info(
      { escalationId: escalation.id, intentId: options.intentId, tenantId, timeout },
      'Escalation created'
    );

    return escalation;
  }

  /**
   * Get an escalation by ID
   *
   * @param id - Escalation ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Escalation record or null if not found
   */
  async get(id: ID, ctx: TenantContext): Promise<EscalationRecord | null> {
    const tenantId = extractTenantId(ctx);

    // Try cache first
    const cached = await this.redis.get(this.cachePrefix + id);
    if (cached) {
      const escalation = JSON.parse(cached) as EscalationRecord;
      // Verify tenant - SECURITY: always validate tenant ownership
      if (escalation.tenantId !== tenantId) {
        logger.warn(
          { escalationId: id, requestedTenantId: tenantId, actualTenantId: escalation.tenantId },
          'SECURITY: Cross-tenant escalation access attempt blocked'
        );
        return null;
      }
      return escalation;
    }

    // Query database with tenant filter - SECURITY: always filter by tenant
    const [row] = await this.db
      .select()
      .from(escalations)
      .where(and(eq(escalations.id, id), eq(escalations.tenantId, tenantId)));

    if (!row) return null;

    const escalation = mapRow(row);

    // Populate cache
    await this.redis.set(
      this.cachePrefix + id,
      JSON.stringify(escalation),
      'EX',
      this.cacheTtlSeconds
    );

    return escalation;
  }

  /**
   * Get escalation by intent ID (most recent)
   *
   * @param intentId - Intent ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Most recent escalation for the intent or null if not found
   */
  async getByIntentId(intentId: ID, ctx: TenantContext): Promise<EscalationRecord | null> {
    const tenantId = extractTenantId(ctx);

    // SECURITY: Always filter by tenant to prevent cross-tenant access
    const [row] = await this.db
      .select()
      .from(escalations)
      .where(and(eq(escalations.intentId, intentId), eq(escalations.tenantId, tenantId)))
      .orderBy(desc(escalations.createdAt))
      .limit(1);

    if (!row) return null;
    return mapRow(row);
  }

  /**
   * List escalations with filters
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param filters - Optional filters for status, intentId, etc.
   * @returns Array of escalation records
   */
  async list(ctx: TenantContext, filters?: ListEscalationFilters): Promise<EscalationRecord[]> {
    const tenantId = extractTenantId(ctx);
    const { status, intentId, escalatedTo, limit = 50, cursor, includeSlaBreached } = filters ?? {};
    const conditions = [eq(escalations.tenantId, tenantId)];

    if (status) {
      if (Array.isArray(status)) {
        conditions.push(inArray(escalations.status, status));
      } else {
        conditions.push(eq(escalations.status, status));
      }
    }

    if (intentId) {
      conditions.push(eq(escalations.intentId, intentId));
    }

    if (escalatedTo) {
      conditions.push(eq(escalations.escalatedTo, escalatedTo));
    }

    // Filter by SLA breach status
    if (includeSlaBreached !== undefined) {
      conditions.push(eq(escalations.slaBreached, includeSlaBreached));
    }

    // Cursor-based pagination
    if (cursor) {
      const [cursorEsc] = await this.db
        .select({ createdAt: escalations.createdAt })
        .from(escalations)
        .where(eq(escalations.id, cursor));

      if (cursorEsc?.createdAt) {
        conditions.push(lt(escalations.createdAt, cursorEsc.createdAt));
      }
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    const rows = await this.db
      .select()
      .from(escalations)
      .where(whereClause)
      .orderBy(desc(escalations.createdAt))
      .limit(Math.min(limit, 100));

    return rows.map(mapRow);
  }

  /**
   * List pending escalations for a tenant (optimized with Redis index)
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param options - Pagination options
   * @returns Array of pending escalation records
   */
  async listPending(
    ctx: TenantContext,
    options?: { limit?: number; offset?: number }
  ): Promise<EscalationRecord[]> {
    const tenantId = extractTenantId(ctx);
    const limit = Math.min(options?.limit ?? 50, 100);
    const offset = options?.offset ?? 0;

    // Use Redis set for fast pending lookup
    const pendingIds = await this.redis.smembers(`${this.indexPrefix}pending:${tenantId}`);

    if (pendingIds.length === 0) {
      // Fall back to database if index is empty (cold start)
      return this.list(ctx, { status: 'pending', limit });
    }

    // Fetch from database to ensure consistency
    const rows = await this.db
      .select()
      .from(escalations)
      .where(
        and(
          eq(escalations.tenantId, tenantId),
          eq(escalations.status, 'pending'),
          inArray(escalations.id, pendingIds)
        )
      )
      .orderBy(escalations.createdAt)
      .limit(limit)
      .offset(offset);

    return rows.map(mapRow);
  }

  /**
   * Acknowledge an escalation (SLA tracking)
   *
   * @param id - Escalation ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Acknowledged escalation record or null if not found
   */
  async acknowledge(id: ID, ctx: TenantContext): Promise<EscalationRecord | null> {
    const tenantId = extractTenantId(ctx);
    const acknowledgedBy = ctx.userId;
    const escalation = await this.get(id, ctx);
    if (!escalation) return null;

    if (escalation.status !== 'pending') {
      logger.warn({ escalationId: id, currentStatus: escalation.status }, 'Cannot acknowledge non-pending escalation');
      return escalation;
    }

    const now = new Date();

    const [row] = await this.db
      .update(escalations)
      .set({
        status: 'acknowledged',
        acknowledgedAt: now,
        updatedAt: now,
        metadata: {
          ...(escalation.metadata ?? {}),
          acknowledgedBy,
        },
      })
      .where(
        and(
          eq(escalations.id, id),
          eq(escalations.tenantId, tenantId),
          eq(escalations.status, 'pending')
        )
      )
      .returning();

    if (!row) return escalation;

    const updated = mapRow(row);

    // Update cache and indexes
    await this.invalidateCache(id);
    await this.redis.srem(`${this.indexPrefix}pending:${tenantId}`, id);

    logger.info({ escalationId: id, acknowledgedBy }, 'Escalation acknowledged');

    return updated;
  }

  /**
   * Approve an escalation
   *
   * @param id - Escalation ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param options - Resolution options (notes, etc.)
   * @returns Approved escalation record or null if not found
   */
  async approve(id: ID, ctx: TenantContext, options?: Omit<ResolveEscalationOptions, 'resolvedBy'>): Promise<EscalationRecord | null> {
    return this.resolve(id, ctx, 'approved', { resolvedBy: ctx.userId, ...options });
  }

  /**
   * Reject an escalation
   *
   * @param id - Escalation ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param options - Resolution options (notes, etc.)
   * @returns Rejected escalation record or null if not found
   */
  async reject(id: ID, ctx: TenantContext, options?: Omit<ResolveEscalationOptions, 'resolvedBy'>): Promise<EscalationRecord | null> {
    return this.resolve(id, ctx, 'rejected', { resolvedBy: ctx.userId, ...options });
  }

  /**
   * Cancel an escalation
   *
   * @param id - Escalation ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param options - Resolution options (notes, etc.)
   * @returns Cancelled escalation record or null if not found
   */
  async cancel(id: ID, ctx: TenantContext, options?: Omit<ResolveEscalationOptions, 'resolvedBy'>): Promise<EscalationRecord | null> {
    return this.resolve(id, ctx, 'cancelled', { resolvedBy: ctx.userId, ...options });
  }

  /**
   * Resolve an escalation (internal)
   *
   * @param id - Escalation ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param status - Resolution status
   * @param options - Resolution options
   * @returns Resolved escalation record or null if not found
   */
  private async resolve(
    id: ID,
    ctx: TenantContext,
    status: 'approved' | 'rejected' | 'cancelled',
    options: ResolveEscalationOptions
  ): Promise<EscalationRecord | null> {
    const tenantId = extractTenantId(ctx);
    const escalation = await this.get(id, ctx);
    if (!escalation) return null;

    if (!['pending', 'acknowledged'].includes(escalation.status)) {
      logger.warn({ escalationId: id, currentStatus: escalation.status }, 'Escalation already resolved');
      return escalation;
    }

    const now = new Date();
    const pendingDuration = (now.getTime() - new Date(escalation.createdAt).getTime()) / 1000;

    // Check SLA breach
    const timeoutAt = new Date(escalation.timeoutAt);
    const slaBreached = now > timeoutAt;

    const [row] = await this.db
      .update(escalations)
      .set({
        status,
        resolvedBy: options.resolvedBy,
        resolvedAt: now,
        resolutionNotes: options.notes ?? null,
        slaBreached,
        updatedAt: now,
      })
      .where(
        and(
          eq(escalations.id, id),
          eq(escalations.tenantId, tenantId),
          inArray(escalations.status, ['pending', 'acknowledged'])
        )
      )
      .returning();

    if (!row) return escalation;

    const updated = mapRow(row);

    // Update cache and indexes
    await this.invalidateCache(id);
    await this.updateRedisIndexes(updated, 'remove');

    // Record metrics
    escalationResolutions.inc({
      tenant_id: tenantId,
      resolution: status,
    });
    escalationPendingDuration.observe(
      { tenant_id: tenantId, resolution: status },
      pendingDuration
    );
    escalationsPending.dec({ tenant_id: tenantId });

    // Update SLA breach rate and approval rate gauges
    // Fire and forget to not block the resolution
    this.updateRateGauges(ctx).catch((error) => {
      logger.warn({ error, tenantId }, 'Failed to update rate gauges');
    });

    logger.info(
      { escalationId: id, status, resolvedBy: options.resolvedBy, pendingDuration, slaBreached },
      'Escalation resolved'
    );

    return updated;
  }

  /**
   * Update SLA breach rate and approval rate gauges for a tenant
   */
  private async updateRateGauges(ctx: TenantContext): Promise<void> {
    const tenantId = extractTenantId(ctx);
    const stats = await this.getSlaStats(ctx);
    updateSlaBreachRate(tenantId, stats.breachRate);

    // Calculate approval rate from resolved escalations
    const [approvalStats] = await this.db
      .select({
        total: sql<number>`count(*) filter (where ${escalations.status} in ('approved', 'rejected'))`,
        approved: sql<number>`count(*) filter (where ${escalations.status} = 'approved')`,
      })
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));

    const approvalTotal = Number(approvalStats?.total ?? 0);
    const approvedCount = Number(approvalStats?.approved ?? 0);
    const approvalRate = approvalTotal > 0 ? approvedCount / approvalTotal : 0;
    updateEscalationApprovalRate(tenantId, approvalRate);
  }

  /**
   * Process timed out escalations
   */
  async processTimeouts(): Promise<number> {
    const now = new Date();

    // Find all pending/acknowledged escalations past timeout
    // Use row locking to prevent concurrent workers from processing the same rows
    const timedOut = await this.db
      .select()
      .from(escalations)
      .where(
        and(
          inArray(escalations.status, ['pending', 'acknowledged']),
          lte(escalations.timeoutAt, now)
        )
      )
      .for('update', { skipLocked: true });

    let processed = 0;

    for (const row of timedOut) {
      const pendingDuration = (now.getTime() - row.createdAt.getTime()) / 1000;

      await this.db
        .update(escalations)
        .set({
          status: 'timeout',
          slaBreached: true,
          updatedAt: now,
        })
        .where(eq(escalations.id, row.id));

      // Update indexes
      await this.invalidateCache(row.id);
      await this.redis.srem(`${this.indexPrefix}pending:${row.tenantId}`, row.id);
      await this.redis.zrem(`${this.indexPrefix}timeouts`, row.id);

      // Record metrics
      escalationResolutions.inc({
        tenant_id: row.tenantId,
        resolution: 'timeout',
      });
      escalationPendingDuration.observe(
        { tenant_id: row.tenantId, resolution: 'timeout' },
        pendingDuration
      );
      escalationsPending.dec({ tenant_id: row.tenantId });

      logger.warn(
        { escalationId: row.id, intentId: row.intentId },
        'Escalation timed out'
      );

      processed++;
    }

    return processed;
  }

  /**
   * Get escalation history for an intent
   *
   * @param intentId - Intent ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Array of escalation records for the intent
   */
  async getHistory(intentId: ID, ctx: TenantContext): Promise<EscalationRecord[]> {
    const tenantId = extractTenantId(ctx);

    // SECURITY: Always filter by tenant to prevent cross-tenant access
    const rows = await this.db
      .select()
      .from(escalations)
      .where(and(eq(escalations.intentId, intentId), eq(escalations.tenantId, tenantId)))
      .orderBy(escalations.createdAt);

    return rows.map(mapRow);
  }

  /**
   * Check if an intent has a pending escalation
   *
   * @param intentId - Intent ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns True if there is a pending or acknowledged escalation
   */
  async hasPendingEscalation(intentId: ID, ctx: TenantContext): Promise<boolean> {
    const escalation = await this.getByIntentId(intentId, ctx);
    return escalation?.status === 'pending' || escalation?.status === 'acknowledged';
  }

  /**
   * Get SLA breach statistics for a tenant
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param since - Optional start date for statistics
   * @returns SLA statistics
   */
  async getSlaStats(ctx: TenantContext, since?: Date): Promise<{
    total: number;
    breached: number;
    breachRate: number;
    avgResolutionTime: number;
  }> {
    const tenantId = extractTenantId(ctx);
    const conditions = [eq(escalations.tenantId, tenantId)];
    if (since) {
      conditions.push(lte(escalations.createdAt, since));
    }

    const [stats] = await this.db
      .select({
        total: sql<number>`count(*)`,
        breached: sql<number>`count(*) filter (where ${escalations.slaBreached} = true)`,
        avgTime: sql<number>`avg(extract(epoch from (coalesce(${escalations.resolvedAt}, now()) - ${escalations.createdAt})))`,
      })
      .from(escalations)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

    const total = Number(stats?.total ?? 0);
    const breached = Number(stats?.breached ?? 0);
    const avgResolutionTime = Number(stats?.avgTime ?? 0);

    return {
      total,
      breached,
      breachRate: total > 0 ? breached / total : 0,
      avgResolutionTime,
    };
  }

  /**
   * Update Redis indexes for fast lookups
   */
  private async updateRedisIndexes(
    escalation: EscalationRecord,
    operation: 'add' | 'remove'
  ): Promise<void> {
    const pendingKey = `${this.indexPrefix}pending:${escalation.tenantId}`;
    const timeoutKey = `${this.indexPrefix}timeouts`;
    const intentKey = `${this.indexPrefix}intent:${escalation.intentId}`;

    if (operation === 'add' && ['pending', 'acknowledged'].includes(escalation.status)) {
      await this.redis.sadd(pendingKey, escalation.id);
      await this.redis.zadd(timeoutKey, new Date(escalation.timeoutAt).getTime(), escalation.id);
      await this.redis.rpush(intentKey, escalation.id);
    } else if (operation === 'remove') {
      await this.redis.srem(pendingKey, escalation.id);
      await this.redis.zrem(timeoutKey, escalation.id);
    }
  }

  /**
   * Invalidate cache for an escalation
   */
  private async invalidateCache(id: ID): Promise<void> {
    await this.redis.del(this.cachePrefix + id);
  }

  /**
   * Rebuild Redis indexes from PostgreSQL (for recovery/consistency)
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Number of records indexed
   */
  async rebuildIndexes(ctx: TenantContext): Promise<{ indexed: number }> {
    const tenantId = extractTenantId(ctx);
    const conditions = [eq(escalations.tenantId, tenantId)];

    // Get all pending/acknowledged escalations
    const pendingRows = await this.db
      .select()
      .from(escalations)
      .where(
        conditions.length > 0
          ? and(...conditions, inArray(escalations.status, ['pending', 'acknowledged']))
          : inArray(escalations.status, ['pending', 'acknowledged'])
      );

    // Clear existing indexes for this tenant
    await this.redis.del(`${this.indexPrefix}pending:${tenantId}`);

    // Rebuild indexes
    for (const row of pendingRows) {
      const escalation = mapRow(row);
      await this.updateRedisIndexes(escalation, 'add');
    }

    logger.info({ tenantId, indexed: pendingRows.length }, 'Rebuilt escalation indexes');

    return { indexed: pendingRows.length };
  }
}

/**
 * Create a new escalation service instance with dependency injection.
 *
 * This is the preferred way to create services in production code
 * as it makes dependencies explicit and testable.
 *
 * @param deps - Optional dependencies. If not provided, uses global singletons.
 * @returns Configured EscalationService instance
 *
 * @example
 * // Default usage (backward compatible)
 * const service = createEscalationService();
 *
 * @example
 * // With custom dependencies
 * const service = createEscalationService({
 *   database: customDb,
 *   redis: customRedis,
 *   config: customConfig,
 * });
 */
export function createEscalationService(
  deps: EscalationServiceDependencies = {}
): EscalationService {
  return new EscalationService(deps);
}
