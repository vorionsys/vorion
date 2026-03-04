/**
 * Database-backed Audit Log Store
 *
 * Provides persistent storage for security audit events using Drizzle ORM
 * with PostgreSQL. Addresses the security audit finding that in-memory
 * audit logs in secrets-rotation.ts are not persisted.
 *
 * Features:
 * - Full CRUD operations with proper indexing
 * - Query support with flexible filtering
 * - Request ID correlation for tracing
 * - Retention management with soft delete
 * - Both database and in-memory implementations
 * - Factory function for environment-based selection
 *
 * @packageDocumentation
 * @module audit/db-store
 */

import { eq, and, desc, lt, gte, lte, or, sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDatabase, type Database } from '../common/db.js';
import { createLogger } from '../common/logger.js';
import { getConfig } from '../common/config.js';
import type { ID, Timestamp } from '../common/types.js';
import type {
  SecurityEventCategory,
  SecuritySeverity,
  SecurityOutcome,
  SecurityEventType,
} from './security-events.js';

const logger = createLogger({ component: 'audit-db-store' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Audit entry for database storage
 *
 * This interface represents a security audit event that can be persisted
 * to the database. It's designed to capture all relevant security context
 * for SOC 2 compliance and forensic analysis.
 */
export interface AuditEntry {
  /** Unique identifier for the audit entry */
  id: string;

  /** Timestamp when the event occurred */
  timestamp: Timestamp;

  /** Type of security event */
  eventType: SecurityEventType | string;

  /** Event category (authentication, authorization, etc.) */
  category: SecurityEventCategory | string;

  /** Event severity level */
  severity: SecuritySeverity;

  /** ID of the actor performing the action */
  actorId: string;

  /** Type of actor (user, agent, service, system) */
  actorType: 'user' | 'agent' | 'service' | 'system';

  /** Display name of the actor */
  actorName?: string;

  /** IP address of the actor */
  actorIp?: string;

  /** Action performed */
  action: string;

  /** Type of resource affected */
  resourceType: string;

  /** ID of the resource affected */
  resourceId: string;

  /** Name of the resource */
  resourceName?: string;

  /** Outcome of the action */
  outcome: SecurityOutcome;

  /** Reason for the outcome (especially for failures/blocks) */
  reason?: string;

  /** Tenant ID for multi-tenant isolation */
  tenantId: ID;

  /** Request ID for correlation */
  requestId?: ID;

  /** Trace ID for distributed tracing */
  traceId?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Filter options for querying audit entries
 */
export interface AuditQueryFilter {
  /** Filter by tenant ID (required for multi-tenant isolation) */
  tenantId?: ID;

  /** Filter by event type */
  eventType?: SecurityEventType | string;

  /** Filter by category */
  category?: SecurityEventCategory | string;

  /** Filter by severity */
  severity?: SecuritySeverity;

  /** Filter by actor ID */
  actorId?: string;

  /** Filter by actor type */
  actorType?: 'user' | 'agent' | 'service' | 'system';

  /** Filter by resource type */
  resourceType?: string;

  /** Filter by resource ID */
  resourceId?: string;

  /** Filter by outcome */
  outcome?: SecurityOutcome;

  /** Filter by request ID */
  requestId?: ID;

  /** Start time for time range filter */
  startTime?: Timestamp;

  /** End time for time range filter */
  endTime?: Timestamp;

  /** Maximum number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Sort order */
  orderDirection?: 'asc' | 'desc';
}

// =============================================================================
// AUDIT LOG STORE INTERFACE
// =============================================================================

/**
 * Interface for audit log storage implementations
 *
 * This interface defines the contract for audit log storage backends.
 * Implementations can use databases, in-memory storage, or other backends.
 */
export interface AuditLogStore {
  /**
   * Log an audit entry
   *
   * @param entry - The audit entry to log
   * @returns Promise that resolves when the entry is logged
   */
  log(entry: AuditEntry): Promise<void>;

  /**
   * Query audit entries with filters
   *
   * @param filter - Query filters
   * @returns Promise resolving to matching audit entries
   */
  query(filter: AuditQueryFilter): Promise<AuditEntry[]>;

  /**
   * Get all audit entries for a specific request
   *
   * @param requestId - The request ID to search for
   * @returns Promise resolving to all entries with the given request ID
   */
  getByRequestId(requestId: string): Promise<AuditEntry[]>;

  /**
   * Delete entries older than the specified date
   *
   * @param olderThan - Delete entries older than this date
   * @returns Promise resolving to the number of deleted entries
   */
  retention(olderThan: Date): Promise<number>;
}

// =============================================================================
// DATABASE SCHEMA
// =============================================================================

/**
 * Audit severity enum for database
 */
export const auditEntrySeverityEnum = pgEnum('audit_entry_severity', [
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

/**
 * Audit outcome enum for database
 */
export const auditEntryOutcomeEnum = pgEnum('audit_entry_outcome', [
  'success',
  'failure',
  'blocked',
  'escalated',
]);

/**
 * Audit entries table schema
 *
 * Stores security audit events with comprehensive indexing
 * for efficient querying and compliance reporting.
 */
export const auditEntries = pgTable(
  'audit_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Timestamps
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // Event identification
    eventType: text('event_type').notNull(),
    category: text('category').notNull(),
    severity: auditEntrySeverityEnum('severity').notNull().default('info'),

    // Actor information
    actorId: text('actor_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorName: text('actor_name'),
    actorIp: text('actor_ip'),

    // Action and resource
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    resourceName: text('resource_name'),

    // Outcome
    outcome: auditEntryOutcomeEnum('outcome').notNull().default('success'),
    reason: text('reason'),

    // Context
    tenantId: text('tenant_id').notNull(),
    requestId: text('request_id'),
    traceId: text('trace_id'),

    // Additional data
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (table) => ({
    // Index for tenant-based queries (required for multi-tenant isolation)
    tenantIdIdx: index('audit_entries_tenant_id_idx').on(table.tenantId),

    // Index for time-based queries and retention
    timestampIdx: index('audit_entries_timestamp_idx').on(table.timestamp),

    // Composite index for common query patterns
    tenantTimestampIdx: index('audit_entries_tenant_timestamp_idx').on(
      table.tenantId,
      table.timestamp
    ),

    // Index for request ID correlation
    requestIdIdx: index('audit_entries_request_id_idx').on(table.requestId),

    // Index for event type filtering
    eventTypeIdx: index('audit_entries_event_type_idx').on(table.eventType),

    // Index for category filtering
    categoryIdx: index('audit_entries_category_idx').on(table.category),

    // Index for severity-based queries (for alerting)
    severityIdx: index('audit_entries_severity_idx').on(table.severity),

    // Index for actor-based queries
    actorIdIdx: index('audit_entries_actor_id_idx').on(table.actorId),

    // Index for resource-based queries
    resourceIdx: index('audit_entries_resource_idx').on(
      table.resourceType,
      table.resourceId
    ),

    // Index for outcome-based queries
    outcomeIdx: index('audit_entries_outcome_idx').on(table.outcome),
  })
);

// Type inference from schema
export type AuditEntryRecord = typeof auditEntries.$inferSelect;
export type NewAuditEntryRecord = typeof auditEntries.$inferInsert;

// =============================================================================
// DATABASE AUDIT STORE IMPLEMENTATION
// =============================================================================

/**
 * Database-backed audit log store implementation
 *
 * Uses PostgreSQL via Drizzle ORM for persistent storage of audit events.
 * Provides comprehensive querying capabilities for compliance reporting
 * and forensic analysis.
 */
export class DatabaseAuditStore implements AuditLogStore {
  private db: Database;

  /**
   * Create a new DatabaseAuditStore
   *
   * @param options - Configuration options
   */
  constructor(options?: { database?: Database }) {
    this.db = options?.database ?? getDatabase();
    logger.info('DatabaseAuditStore initialized');
  }

  /**
   * Log an audit entry to the database
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditEntries).values({
        id: entry.id,
        timestamp: new Date(entry.timestamp),
        eventType: entry.eventType,
        category: entry.category,
        severity: entry.severity,
        actorId: entry.actorId,
        actorType: entry.actorType,
        actorName: entry.actorName,
        actorIp: entry.actorIp,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        resourceName: entry.resourceName,
        outcome: entry.outcome,
        reason: entry.reason,
        tenantId: entry.tenantId,
        requestId: entry.requestId,
        traceId: entry.traceId,
        metadata: entry.metadata,
      });

      logger.debug(
        {
          entryId: entry.id,
          eventType: entry.eventType,
          tenantId: entry.tenantId,
        },
        'Audit entry logged to database'
      );
    } catch (error) {
      logger.error(
        { error, entryId: entry.id, eventType: entry.eventType },
        'Failed to log audit entry to database'
      );
      throw error;
    }
  }

  /**
   * Query audit entries with filters
   */
  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    try {
      const conditions = [];

      if (filter.tenantId) {
        conditions.push(eq(auditEntries.tenantId, filter.tenantId));
      }

      if (filter.eventType) {
        conditions.push(eq(auditEntries.eventType, filter.eventType));
      }

      if (filter.category) {
        conditions.push(eq(auditEntries.category, filter.category));
      }

      if (filter.severity) {
        conditions.push(eq(auditEntries.severity, filter.severity));
      }

      if (filter.actorId) {
        conditions.push(eq(auditEntries.actorId, filter.actorId));
      }

      if (filter.actorType) {
        conditions.push(eq(auditEntries.actorType, filter.actorType));
      }

      if (filter.resourceType) {
        conditions.push(eq(auditEntries.resourceType, filter.resourceType));
      }

      if (filter.resourceId) {
        conditions.push(eq(auditEntries.resourceId, filter.resourceId));
      }

      if (filter.outcome) {
        conditions.push(eq(auditEntries.outcome, filter.outcome));
      }

      if (filter.requestId) {
        conditions.push(eq(auditEntries.requestId, filter.requestId));
      }

      if (filter.startTime) {
        conditions.push(gte(auditEntries.timestamp, new Date(filter.startTime)));
      }

      if (filter.endTime) {
        conditions.push(lte(auditEntries.timestamp, new Date(filter.endTime)));
      }

      const limit = Math.min(filter.limit ?? 100, 1000);
      const offset = filter.offset ?? 0;

      const orderFn = filter.orderDirection === 'asc'
        ? (col: typeof auditEntries.timestamp) => col
        : desc;

      let query = this.db
        .select()
        .from(auditEntries)
        .orderBy(orderFn(auditEntries.timestamp))
        .limit(limit)
        .offset(offset);

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      const records = await query;

      return records.map((record) => this.mapRecordToEntry(record));
    } catch (error) {
      logger.error({ error, filter }, 'Failed to query audit entries');
      throw error;
    }
  }

  /**
   * Get all audit entries for a specific request ID
   */
  async getByRequestId(requestId: string): Promise<AuditEntry[]> {
    try {
      const records = await this.db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.requestId, requestId))
        .orderBy(auditEntries.timestamp);

      return records.map((record) => this.mapRecordToEntry(record));
    } catch (error) {
      logger.error({ error, requestId }, 'Failed to get audit entries by request ID');
      throw error;
    }
  }

  /**
   * Delete entries older than the specified date
   *
   * This is used for retention management. Entries older than the
   * specified date are permanently deleted.
   */
  async retention(olderThan: Date): Promise<number> {
    try {
      const result = await this.db
        .delete(auditEntries)
        .where(lt(auditEntries.timestamp, olderThan))
        .returning({ id: auditEntries.id });

      const deletedCount = result.length;

      if (deletedCount > 0) {
        logger.info(
          { deletedCount, olderThan: olderThan.toISOString() },
          'Audit entries purged'
        );
      }

      return deletedCount;
    } catch (error) {
      logger.error({ error, olderThan }, 'Failed to purge audit entries');
      throw error;
    }
  }

  /**
   * Get statistics about audit entries
   */
  async getStats(tenantId?: ID): Promise<{
    totalEntries: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    byOutcome: Record<string, number>;
  }> {
    try {
      const conditions = tenantId ? [eq(auditEntries.tenantId, tenantId)] : [];

      // Total count
      const [totalResult] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEntries)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      // By category
      const categoryResults = await this.db
        .select({
          category: auditEntries.category,
          count: sql<number>`count(*)::int`,
        })
        .from(auditEntries)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(auditEntries.category);

      // By severity
      const severityResults = await this.db
        .select({
          severity: auditEntries.severity,
          count: sql<number>`count(*)::int`,
        })
        .from(auditEntries)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(auditEntries.severity);

      // By outcome
      const outcomeResults = await this.db
        .select({
          outcome: auditEntries.outcome,
          count: sql<number>`count(*)::int`,
        })
        .from(auditEntries)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .groupBy(auditEntries.outcome);

      return {
        totalEntries: totalResult?.count ?? 0,
        byCategory: Object.fromEntries(
          categoryResults.map((r) => [r.category, r.count])
        ),
        bySeverity: Object.fromEntries(
          severityResults.map((r) => [r.severity, r.count])
        ),
        byOutcome: Object.fromEntries(
          outcomeResults.map((r) => [r.outcome, r.count])
        ),
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to get audit stats');
      throw error;
    }
  }

  /**
   * Map a database record to an AuditEntry
   */
  private mapRecordToEntry(record: AuditEntryRecord): AuditEntry {
    return {
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      eventType: record.eventType,
      category: record.category,
      severity: record.severity as SecuritySeverity,
      actorId: record.actorId,
      actorType: record.actorType as 'user' | 'agent' | 'service' | 'system',
      actorName: record.actorName ?? undefined,
      actorIp: record.actorIp ?? undefined,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      resourceName: record.resourceName ?? undefined,
      outcome: record.outcome as SecurityOutcome,
      reason: record.reason ?? undefined,
      tenantId: record.tenantId,
      requestId: record.requestId ?? undefined,
      traceId: record.traceId ?? undefined,
      metadata: record.metadata ?? undefined,
    };
  }
}

// =============================================================================
// IN-MEMORY AUDIT STORE IMPLEMENTATION
// =============================================================================

/**
 * In-memory audit log store for testing
 *
 * Stores audit entries in memory. Useful for unit tests and development.
 * Not suitable for production use as data is lost on restart.
 */
export class InMemoryAuditStore implements AuditLogStore {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  /**
   * Create a new InMemoryAuditStore
   *
   * @param options - Configuration options
   */
  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? 10000;
    logger.info({ maxEntries: this.maxEntries }, 'InMemoryAuditStore initialized');
  }

  /**
   * Log an audit entry to memory
   */
  async log(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);

    // Keep bounded to prevent memory issues
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    logger.debug(
      { entryId: entry.id, eventType: entry.eventType },
      'Audit entry logged to memory'
    );
  }

  /**
   * Query audit entries with filters
   */
  async query(filter: AuditQueryFilter): Promise<AuditEntry[]> {
    let results = [...this.entries];

    if (filter.tenantId) {
      results = results.filter((e) => e.tenantId === filter.tenantId);
    }

    if (filter.eventType) {
      results = results.filter((e) => e.eventType === filter.eventType);
    }

    if (filter.category) {
      results = results.filter((e) => e.category === filter.category);
    }

    if (filter.severity) {
      results = results.filter((e) => e.severity === filter.severity);
    }

    if (filter.actorId) {
      results = results.filter((e) => e.actorId === filter.actorId);
    }

    if (filter.actorType) {
      results = results.filter((e) => e.actorType === filter.actorType);
    }

    if (filter.resourceType) {
      results = results.filter((e) => e.resourceType === filter.resourceType);
    }

    if (filter.resourceId) {
      results = results.filter((e) => e.resourceId === filter.resourceId);
    }

    if (filter.outcome) {
      results = results.filter((e) => e.outcome === filter.outcome);
    }

    if (filter.requestId) {
      results = results.filter((e) => e.requestId === filter.requestId);
    }

    if (filter.startTime) {
      const startDate = new Date(filter.startTime);
      results = results.filter((e) => new Date(e.timestamp) >= startDate);
    }

    if (filter.endTime) {
      const endDate = new Date(filter.endTime);
      results = results.filter((e) => new Date(e.timestamp) <= endDate);
    }

    // Sort by timestamp
    results.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return filter.orderDirection === 'asc' ? aTime - bTime : bTime - aTime;
    });

    // Apply pagination
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get all audit entries for a specific request ID
   */
  async getByRequestId(requestId: string): Promise<AuditEntry[]> {
    return this.entries
      .filter((e) => e.requestId === requestId)
      .sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return aTime - bTime;
      });
  }

  /**
   * Delete entries older than the specified date
   */
  async retention(olderThan: Date): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => new Date(e.timestamp) >= olderThan
    );
    const deleted = before - this.entries.length;

    if (deleted > 0) {
      logger.info(
        { deletedCount: deleted, olderThan: olderThan.toISOString() },
        'Audit entries purged from memory'
      );
    }

    return deleted;
  }

  /**
   * Clear all entries (for testing)
   */
  clear(): void {
    this.entries = [];
    logger.debug('In-memory audit store cleared');
  }

  /**
   * Get all entries (for testing)
   */
  getAll(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get entry count
   */
  get count(): number {
    return this.entries.length;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Store type for factory function
 */
export type AuditStoreType = 'database' | 'memory';

/**
 * Options for creating an audit store
 */
export interface CreateAuditStoreOptions {
  /** Type of store to create (auto-detected from environment if not specified) */
  type?: AuditStoreType;

  /** Database instance (for database store) */
  database?: Database;

  /** Maximum entries for in-memory store */
  maxEntries?: number;
}

/**
 * Create an audit log store based on environment configuration
 *
 * This factory function creates the appropriate audit store based on
 * the current environment. In production/staging, it uses the database
 * store. In development/test, it can use either based on configuration.
 *
 * @param options - Store configuration options
 * @returns An AuditLogStore implementation
 *
 * @example
 * ```typescript
 * // Auto-detect based on environment
 * const store = createAuditStore();
 *
 * // Force database store
 * const dbStore = createAuditStore({ type: 'database' });
 *
 * // Force in-memory store (for testing)
 * const memStore = createAuditStore({ type: 'memory' });
 * ```
 */
export function createAuditStore(options?: CreateAuditStoreOptions): AuditLogStore {
  const config = getConfig();
  const env = config.env;

  // Determine store type
  let storeType: AuditStoreType;

  if (options?.type) {
    storeType = options.type;
  } else if (env === 'production' || env === 'staging') {
    // Always use database in production/staging
    storeType = 'database';
  } else {
    // Use environment variable or default to database
    const envStoreType = process.env['VORION_AUDIT_STORE_TYPE'];
    storeType = (envStoreType === 'memory' ? 'memory' : 'database');
  }

  if (storeType === 'database') {
    logger.info({ env }, 'Creating database audit store');
    return new DatabaseAuditStore({ database: options?.database });
  } else {
    logger.info({ env, maxEntries: options?.maxEntries }, 'Creating in-memory audit store');
    return new InMemoryAuditStore({ maxEntries: options?.maxEntries });
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let auditStoreInstance: AuditLogStore | null = null;

/**
 * Get the singleton audit store instance
 *
 * @param options - Store configuration options (only used on first call)
 * @returns The singleton AuditLogStore instance
 */
export function getAuditStore(options?: CreateAuditStoreOptions): AuditLogStore {
  if (!auditStoreInstance) {
    auditStoreInstance = createAuditStore(options);
  }
  return auditStoreInstance;
}

/**
 * Reset the singleton audit store (for testing)
 */
export function resetAuditStore(): void {
  auditStoreInstance = null;
  logger.info('Audit store singleton reset');
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create an audit entry with a new UUID
 *
 * @param data - Partial audit entry data
 * @returns Complete AuditEntry with generated ID and timestamp
 */
export function createAuditEntry(
  data: Omit<AuditEntry, 'id' | 'timestamp'> & { timestamp?: Timestamp }
): AuditEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: data.timestamp ?? new Date().toISOString(),
    ...data,
  };
}

/**
 * Helper to log a security event to the audit store
 *
 * @param store - The audit store to use
 * @param event - Event details
 * @returns Promise resolving when the event is logged
 */
export async function logSecurityEvent(
  store: AuditLogStore,
  event: {
    eventType: SecurityEventType | string;
    category: SecurityEventCategory | string;
    severity: SecuritySeverity;
    actor: {
      id: string;
      type: 'user' | 'agent' | 'service' | 'system';
      name?: string;
      ip?: string;
    };
    action: string;
    resource: {
      type: string;
      id: string;
      name?: string;
    };
    outcome: SecurityOutcome;
    reason?: string;
    tenantId: ID;
    requestId?: ID;
    traceId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const entry = createAuditEntry({
    eventType: event.eventType,
    category: event.category,
    severity: event.severity,
    actorId: event.actor.id,
    actorType: event.actor.type,
    actorName: event.actor.name,
    actorIp: event.actor.ip,
    action: event.action,
    resourceType: event.resource.type,
    resourceId: event.resource.id,
    resourceName: event.resource.name,
    outcome: event.outcome,
    reason: event.reason,
    tenantId: event.tenantId,
    requestId: event.requestId,
    traceId: event.traceId,
    metadata: event.metadata,
  });

  await store.log(entry);
}
