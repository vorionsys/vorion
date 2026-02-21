/**
 * GDPR Data Export Service
 *
 * Provides GDPR-compliant data export functionality for the INTENT module.
 * Supports right to access (data export) and right to erasure (soft delete).
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { Queue, Worker, Job } from 'bullmq';
import { eq, and, desc, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import { getConfig, type Config } from '../common/config.js';
import { getRedis } from '../common/redis.js';
import { getDatabase, withLongQueryTimeout } from '../common/db.js';
import { createAuditService, createAuditHelper, type AuditService } from '../audit/index.js';
import {
  withCircuitBreaker,
  CircuitBreakerOpenError,
} from '../common/circuit-breaker.js';
import type { ID } from '../common/types.js';
import { ForbiddenError, RateLimitError } from '../common/errors.js';
import {
  intents,
  intentEvents,
  intentEvaluations,
  escalations,
  auditRecords,
} from './schema.js';
import {
  getGdprRateLimiter,
  type GdprRateLimiter,
  type RateLimitResult,
  type QueueDepthResult,
} from './gdpr-rate-limiter.js';

const logger = createLogger({ component: 'gdpr' });

// =============================================================================
// GDPR AUTHORIZATION TYPES
// =============================================================================

/**
 * User roles that can perform GDPR operations
 */
export type GdprRole = 'admin' | 'tenant:admin' | 'dpo' | 'gdpr:admin' | 'user';

/**
 * GDPR authorization context - MUST be provided for all GDPR operations.
 * This context is constructed from the JWT token in the API layer.
 */
export interface GdprAuthorizationContext {
  /** The ID of the user making the request (from JWT sub claim) */
  requestingUserId: ID;
  /** The tenant ID of the requesting user (from JWT tenantId claim) */
  requestingUserTenantId: ID;
  /** The roles of the requesting user (from JWT roles claim) */
  roles: GdprRole[];
  /** IP address of the request for audit logging */
  ipAddress?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** For erasure operations: whether explicit consent was provided */
  hasExplicitConsent?: boolean;
}

/**
 * Result of an authorization check
 */
export interface GdprAuthorizationResult {
  /** Whether the operation is authorized */
  authorized: boolean;
  /** Reason for the authorization decision */
  reason: string;
  /** The specific permission that granted access (if authorized) */
  grantedBy?: 'self' | 'admin' | 'dpo' | 'tenant_admin' | 'gdpr_admin';
}

// =============================================================================
// GDPR AUTHORIZATION HELPERS
// =============================================================================

/**
 * Check if user has admin role
 */
function hasAdminRole(roles: GdprRole[]): boolean {
  return roles.includes('admin');
}

/**
 * Check if user has tenant admin role
 */
function hasTenantAdminRole(roles: GdprRole[]): boolean {
  return roles.includes('tenant:admin');
}

/**
 * Check if user has DPO (Data Protection Officer) role
 */
function hasDpoRole(roles: GdprRole[]): boolean {
  return roles.includes('dpo');
}

/**
 * Check if user has GDPR admin role
 */
function hasGdprAdminRole(roles: GdprRole[]): boolean {
  return roles.includes('gdpr:admin');
}

/**
 * Check if user has any elevated role (admin, tenant:admin, dpo, gdpr:admin)
 */
function hasElevatedRole(roles: GdprRole[]): boolean {
  return hasAdminRole(roles) || hasTenantAdminRole(roles) || hasDpoRole(roles) || hasGdprAdminRole(roles);
}

/**
 * Validate tenant membership - requesting user's tenant must match target tenant.
 * This is a critical security check to prevent cross-tenant data access.
 *
 * @param authContext - The authorization context
 * @param targetTenantId - The tenant ID being accessed
 * @throws ForbiddenError if tenant mismatch
 */
function validateTenantMembership(
  authContext: GdprAuthorizationContext,
  targetTenantId: ID
): void {
  if (authContext.requestingUserTenantId !== targetTenantId) {
    throw new ForbiddenError(
      'Cross-tenant GDPR operations are not permitted',
      {
        requestingTenant: authContext.requestingUserTenantId,
        targetTenant: targetTenantId,
      }
    );
  }
}

/**
 * Check authorization for GDPR data export (Article 15 - Right of Access).
 *
 * Authorization rules:
 * - User can export their own data (data subject)
 * - Admin/DPO/Tenant Admin can export any user's data within tenant
 *
 * @param authContext - The authorization context from JWT
 * @param targetUserId - The user whose data is being exported
 * @param targetTenantId - The tenant context for the export
 * @returns Authorization result with reason
 */
function checkExportAuthorization(
  authContext: GdprAuthorizationContext,
  targetUserId: ID,
  targetTenantId: ID
): GdprAuthorizationResult {
  // First validate tenant membership
  validateTenantMembership(authContext, targetTenantId);

  // Check if requesting user is the data subject
  const isSelf = authContext.requestingUserId === targetUserId;
  if (isSelf) {
    return {
      authorized: true,
      reason: 'Data subject requesting own data export',
      grantedBy: 'self',
    };
  }

  // Check elevated roles
  if (hasAdminRole(authContext.roles)) {
    return {
      authorized: true,
      reason: 'Admin role authorized for data export',
      grantedBy: 'admin',
    };
  }

  if (hasDpoRole(authContext.roles)) {
    return {
      authorized: true,
      reason: 'DPO role authorized for data export',
      grantedBy: 'dpo',
    };
  }

  if (hasTenantAdminRole(authContext.roles)) {
    return {
      authorized: true,
      reason: 'Tenant admin role authorized for data export',
      grantedBy: 'tenant_admin',
    };
  }

  if (hasGdprAdminRole(authContext.roles)) {
    return {
      authorized: true,
      reason: 'GDPR admin role authorized for data export',
      grantedBy: 'gdpr_admin',
    };
  }

  // Not authorized
  return {
    authorized: false,
    reason: 'User is not the data subject and does not have admin/DPO privileges',
  };
}

/**
 * Check authorization for GDPR data erasure (Article 17 - Right to Erasure).
 *
 * Authorization rules (more restrictive than export):
 * - User can request erasure of their own data (data subject with implicit consent)
 * - Admin/DPO can erase any user's data within tenant (with explicit consent requirement)
 * - Tenant admin requires explicit consent flag for erasing others' data
 * - GDPR admin can erase with explicit consent
 *
 * @param authContext - The authorization context from JWT
 * @param targetUserId - The user whose data is being erased
 * @param targetTenantId - The tenant context for the erasure
 * @returns Authorization result with reason
 */
function checkErasureAuthorization(
  authContext: GdprAuthorizationContext,
  targetUserId: ID,
  targetTenantId: ID
): GdprAuthorizationResult {
  // First validate tenant membership
  validateTenantMembership(authContext, targetTenantId);

  // Check if requesting user is the data subject
  const isSelf = authContext.requestingUserId === targetUserId;
  if (isSelf) {
    return {
      authorized: true,
      reason: 'Data subject requesting own data erasure',
      grantedBy: 'self',
    };
  }

  // For non-self erasure, require elevated roles AND explicit consent
  const requiresExplicitConsent = !isSelf;

  // Check elevated roles with consent requirements
  if (hasAdminRole(authContext.roles)) {
    if (requiresExplicitConsent && !authContext.hasExplicitConsent) {
      return {
        authorized: false,
        reason: 'Admin erasure of non-self data requires explicit consent confirmation',
      };
    }
    return {
      authorized: true,
      reason: 'Admin role authorized for data erasure with consent',
      grantedBy: 'admin',
    };
  }

  if (hasDpoRole(authContext.roles)) {
    if (requiresExplicitConsent && !authContext.hasExplicitConsent) {
      return {
        authorized: false,
        reason: 'DPO erasure of non-self data requires explicit consent confirmation',
      };
    }
    return {
      authorized: true,
      reason: 'DPO role authorized for data erasure with consent',
      grantedBy: 'dpo',
    };
  }

  if (hasTenantAdminRole(authContext.roles)) {
    if (requiresExplicitConsent && !authContext.hasExplicitConsent) {
      return {
        authorized: false,
        reason: 'Tenant admin erasure of non-self data requires explicit consent confirmation',
      };
    }
    return {
      authorized: true,
      reason: 'Tenant admin role authorized for data erasure with consent',
      grantedBy: 'tenant_admin',
    };
  }

  if (hasGdprAdminRole(authContext.roles)) {
    if (requiresExplicitConsent && !authContext.hasExplicitConsent) {
      return {
        authorized: false,
        reason: 'GDPR admin erasure of non-self data requires explicit consent confirmation',
      };
    }
    return {
      authorized: true,
      reason: 'GDPR admin role authorized for data erasure with consent',
      grantedBy: 'gdpr_admin',
    };
  }

  // Not authorized
  return {
    authorized: false,
    reason: 'User is not the data subject and does not have admin/DPO privileges for erasure',
  };
}

/**
 * Check authorization for viewing GDPR export status/data.
 *
 * Authorization rules:
 * - User can view their own export status
 * - Admin/DPO/Tenant Admin can view any export within tenant
 *
 * @param authContext - The authorization context from JWT
 * @param exportUserId - The user who owns the export
 * @param exportTenantId - The tenant context for the export
 * @returns Authorization result with reason
 */
function checkExportViewAuthorization(
  authContext: GdprAuthorizationContext,
  exportUserId: ID,
  exportTenantId: ID
): GdprAuthorizationResult {
  // First validate tenant membership
  validateTenantMembership(authContext, exportTenantId);

  // Check if requesting user owns the export
  const isSelf = authContext.requestingUserId === exportUserId;
  if (isSelf) {
    return {
      authorized: true,
      reason: 'User viewing own export status',
      grantedBy: 'self',
    };
  }

  // Check elevated roles
  if (hasElevatedRole(authContext.roles)) {
    const grantedBy = hasAdminRole(authContext.roles) ? 'admin' :
      hasDpoRole(authContext.roles) ? 'dpo' :
      hasTenantAdminRole(authContext.roles) ? 'tenant_admin' : 'gdpr_admin';
    return {
      authorized: true,
      reason: `Elevated role (${grantedBy}) authorized for viewing export status`,
      grantedBy,
    };
  }

  // Not authorized
  return {
    authorized: false,
    reason: 'User does not own this export and lacks elevated privileges',
  };
}

// =============================================================================
// DEPENDENCY INJECTION TYPES
// =============================================================================

/**
 * Dependencies for GdprService
 *
 * Use these to inject dependencies for testing or custom configurations.
 * If not provided, defaults to global singletons for backward compatibility.
 */
export interface GdprServiceDependencies {
  /** Drizzle database instance */
  database?: NodePgDatabase;
  /** Redis client instance */
  redis?: Redis;
  /** Application configuration */
  config?: Config;
  /** Audit service instance */
  auditService?: AuditService;
}

/**
 * Maximum number of items in a single inArray query
 * Prevents unbounded queries that can cause database performance issues
 */
const QUERY_BATCH_SIZE = 100;

/**
 * Split an array into chunks of specified size
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// =============================================================================
// TYPES
// =============================================================================

export type GdprExportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

export interface GdprExportRequest {
  id: ID;
  userId: ID;
  tenantId: ID;
  status: GdprExportStatus;
  requestedAt: string;
  completedAt?: string;
  expiresAt?: string;
  downloadUrl?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface GdprExportData {
  exportId: ID;
  userId: ID;
  tenantId: ID;
  exportTimestamp: string;
  dataCategories: string[];
  retentionPeriods: Record<string, string>;
  data: {
    intents: GdprIntentData[];
    events: GdprEventData[];
    escalations: GdprEscalationData[];
    auditRecords: GdprAuditData[];
  };
  metadata: {
    totalRecords: number;
    exportVersion: string;
    gdprArticle: string;
  };
}

export interface GdprIntentData {
  id: ID;
  goal: string;
  intentType: string | null;
  status: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface GdprEventData {
  id: ID;
  intentId: ID;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface GdprEscalationData {
  id: ID;
  intentId: ID;
  reason: string;
  reasonCategory: string;
  escalatedTo: string;
  status: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface GdprAuditData {
  id: ID;
  eventType: string;
  action: string;
  outcome: string;
  eventTime: string;
  metadata?: Record<string, unknown>;
}

export interface GdprErasureResult {
  userId: ID;
  tenantId: ID;
  erasedAt: string;
  counts: {
    intents: number;
    events: number;
    escalations: number;
  };
}

// =============================================================================
// GDPR SERVICE
// =============================================================================

/**
 * GDPR Service for data export and erasure
 */
export class GdprService {
  private db: NodePgDatabase;
  private redis: Redis;
  private config: Config;
  private auditService: AuditService;
  private auditHelper: ReturnType<typeof createAuditHelper>;
  private readonly cachePrefix = 'gdpr:export:';
  private readonly exportTtlSeconds = 24 * 60 * 60; // 24 hours

  /**
   * Create a new GdprService instance.
   *
   * @param deps - Optional dependencies for dependency injection.
   *               If not provided, uses global singletons (backward compatible).
   *
   * @example
   * // Default usage (backward compatible)
   * const service = new GdprService();
   *
   * @example
   * // With dependency injection (for testing)
   * const service = new GdprService({
   *   database: mockDb,
   *   redis: mockRedis,
   *   config: testConfig,
   *   auditService: mockAuditService,
   * });
   */
  constructor(deps: GdprServiceDependencies = {}) {
    this.db = deps.database ?? getDatabase();
    this.redis = deps.redis ?? getRedis();
    this.config = deps.config ?? getConfig();
    this.auditService = deps.auditService ?? createAuditService();
    this.auditHelper = createAuditHelper(this.auditService);
  }

  /**
   * Record an authorization decision in the audit log.
   * This is critical for GDPR compliance and security monitoring.
   *
   * @param authContext - The authorization context
   * @param operation - The GDPR operation being performed
   * @param targetUserId - The user whose data is being accessed
   * @param targetTenantId - The tenant context
   * @param result - The authorization result
   */
  private async recordAuthorizationDecision(
    authContext: GdprAuthorizationContext,
    operation: 'export' | 'export_view' | 'export_download' | 'erasure',
    targetUserId: ID,
    targetTenantId: ID,
    result: GdprAuthorizationResult
  ): Promise<void> {
    const eventType = result.authorized ? 'authz.granted' : 'authz.denied';
    const outcome = result.authorized ? 'success' : 'failure';

    await this.auditService.record({
      tenantId: targetTenantId,
      eventType,
      actor: {
        type: 'user',
        id: authContext.requestingUserId,
        ip: authContext.ipAddress,
      },
      target: {
        type: 'user',
        id: targetUserId,
      },
      action: `gdpr_${operation}_authorization`,
      outcome,
      reason: result.reason,
      metadata: {
        gdprOperation: operation,
        requestingUserTenant: authContext.requestingUserTenantId,
        targetTenant: targetTenantId,
        grantedBy: result.grantedBy,
        roles: authContext.roles,
        hasExplicitConsent: authContext.hasExplicitConsent,
      },
      requestId: authContext.requestId,
    });

    if (result.authorized) {
      logger.info(
        {
          operation,
          requestingUserId: authContext.requestingUserId,
          targetUserId,
          targetTenantId,
          grantedBy: result.grantedBy,
          reason: result.reason,
        },
        'GDPR authorization granted'
      );
    } else {
      logger.warn(
        {
          operation,
          requestingUserId: authContext.requestingUserId,
          targetUserId,
          targetTenantId,
          reason: result.reason,
        },
        'GDPR authorization denied'
      );
    }
  }

  /**
   * Enforce authorization for a GDPR operation.
   * Throws ForbiddenError if not authorized.
   *
   * @param authContext - The authorization context
   * @param operation - The GDPR operation
   * @param targetUserId - The target user ID
   * @param targetTenantId - The target tenant ID
   * @param checkFn - The authorization check function to use
   */
  private async enforceAuthorization(
    authContext: GdprAuthorizationContext,
    operation: 'export' | 'export_view' | 'export_download' | 'erasure',
    targetUserId: ID,
    targetTenantId: ID,
    checkFn: (ctx: GdprAuthorizationContext, userId: ID, tenantId: ID) => GdprAuthorizationResult
  ): Promise<GdprAuthorizationResult> {
    const result = checkFn(authContext, targetUserId, targetTenantId);

    // Record the authorization decision
    await this.recordAuthorizationDecision(
      authContext,
      operation,
      targetUserId,
      targetTenantId,
      result
    );

    if (!result.authorized) {
      throw new ForbiddenError(result.reason, {
        operation,
        requestingUserId: authContext.requestingUserId,
        targetUserId,
        targetTenantId,
      });
    }

    return result;
  }

  /**
   * Export all user data for GDPR compliance (Article 15 - Right of Access)
   * Uses extended statement timeout for complex multi-table queries.
   * Protected by circuit breaker to prevent cascading failures.
   *
   * REQUIRES: GdprAuthorizationContext must be provided and valid.
   *
   * @param authContext - Authorization context from JWT (REQUIRED)
   * @param userId - The user/entity ID to export data for
   * @param tenantId - The tenant context
   * @returns Complete export data structure
   * @throws ForbiddenError if authorization fails
   * @throws StatementTimeoutError if the query exceeds the long query timeout
   * @throws CircuitBreakerOpenError if the GDPR service circuit breaker is open
   */
  async exportUserData(
    authContext: GdprAuthorizationContext,
    userId: ID,
    tenantId: ID
  ): Promise<GdprExportData> {
    // Enforce authorization before any data access
    await this.enforceAuthorization(
      authContext,
      'export',
      userId,
      tenantId,
      checkExportAuthorization
    );
    const exportId = randomUUID();
    const exportTimestamp = new Date().toISOString();

    logger.info({ userId, tenantId, exportId }, 'Starting GDPR data export');

    // Wrap the entire export in circuit breaker protection
    return withCircuitBreaker('gdprService', async () => {
      // Use long query timeout for GDPR exports as they can involve complex joins
      return withLongQueryTimeout(async () => {
        // Fetch all user intents (including soft-deleted for complete history)
        const userIntents = await this.db
          .select()
          .from(intents)
          .where(
            and(
              eq(intents.entityId, userId),
              eq(intents.tenantId, tenantId)
            )
          )
          .orderBy(desc(intents.createdAt));

        const intentIds = userIntents.map((i) => i.id);

        // Fetch events for all user intents (chunked to avoid unbounded inArray queries)
        const userEvents: (typeof intentEvents.$inferSelect)[] = [];
        if (intentIds.length > 0) {
          const intentIdChunks = chunkArray(intentIds, QUERY_BATCH_SIZE);
          for (const chunk of intentIdChunks) {
            const batchEvents = await this.db
              .select()
              .from(intentEvents)
              .where(inArray(intentEvents.intentId, chunk))
              .orderBy(desc(intentEvents.occurredAt));
            userEvents.push(...batchEvents);
          }
        }

        // Fetch escalations for user intents (chunked to avoid unbounded inArray queries)
        const userEscalations: (typeof escalations.$inferSelect)[] = [];
        if (intentIds.length > 0) {
          const intentIdChunks = chunkArray(intentIds, QUERY_BATCH_SIZE);
          for (const chunk of intentIdChunks) {
            const batchEscalations = await this.db
              .select()
              .from(escalations)
              .where(
                and(
                  inArray(escalations.intentId, chunk),
                  eq(escalations.tenantId, tenantId)
                )
              )
              .orderBy(desc(escalations.createdAt));
            userEscalations.push(...batchEscalations);
          }
        }

        // Fetch ALL audit records where user is the actor or target
        // GDPR Article 15 requires complete data export - no arbitrary limits
        // Use streaming pagination to handle large datasets without OOM
        const userAuditRecords: (typeof auditRecords.$inferSelect)[] = [];
        const AUDIT_BATCH_SIZE = 1000;
        let auditOffset = 0;
        let hasMoreAuditRecords = true;

        while (hasMoreAuditRecords) {
          const batch = await this.db
            .select()
            .from(auditRecords)
            .where(
              and(
                eq(auditRecords.tenantId, tenantId),
                eq(auditRecords.actorId, userId)
              )
            )
            .orderBy(desc(auditRecords.eventTime))
            .limit(AUDIT_BATCH_SIZE)
            .offset(auditOffset);

          userAuditRecords.push(...batch);
          auditOffset += AUDIT_BATCH_SIZE;
          hasMoreAuditRecords = batch.length === AUDIT_BATCH_SIZE;
        }

      // Transform data to GDPR export format
      const exportData: GdprExportData = {
        exportId,
        userId,
        tenantId,
        exportTimestamp,
        dataCategories: [
          'intents',
          'intent_events',
          'escalations',
          'audit_records',
        ],
        retentionPeriods: {
          intents: this.config.intent.softDeleteRetentionDays
            ? `${this.config.intent.softDeleteRetentionDays} days after deletion`
            : '90 days after deletion',
          intent_events: this.config.intent.eventRetentionDays
            ? `${this.config.intent.eventRetentionDays} days`
            : '365 days',
          escalations: 'Retained with associated intent',
          audit_records: this.config.audit?.retentionDays
            ? `${this.config.audit.retentionDays} days`
            : '2555 days (7 years)',
        },
        data: {
          intents: userIntents.map((intent) => ({
            id: intent.id,
            goal: intent.goal,
            intentType: intent.intentType,
            status: intent.status,
            context: (intent.context ?? {}) as Record<string, unknown>,
            metadata: (intent.metadata ?? {}) as Record<string, unknown>,
            createdAt: intent.createdAt.toISOString(),
            updatedAt: intent.updatedAt.toISOString(),
            deletedAt: intent.deletedAt?.toISOString() ?? null,
          })),
          events: userEvents.map((event) => ({
            id: event.id,
            intentId: event.intentId,
            eventType: event.eventType,
            payload: (event.payload ?? {}) as Record<string, unknown>,
            occurredAt: event.occurredAt.toISOString(),
          })),
          escalations: userEscalations.map((esc) => ({
            id: esc.id,
            intentId: esc.intentId,
            reason: esc.reason,
            reasonCategory: esc.reasonCategory,
            escalatedTo: esc.escalatedTo,
            status: esc.status,
            createdAt: esc.createdAt.toISOString(),
            resolvedAt: esc.resolvedAt?.toISOString() ?? null,
          })),
          auditRecords: userAuditRecords.map((record) => ({
            id: record.id,
            eventType: record.eventType,
            action: record.action,
            outcome: record.outcome,
            eventTime: record.eventTime.toISOString(),
            metadata: (record.metadata ?? undefined) as Record<string, unknown> | undefined,
          })),
        },
        metadata: {
          totalRecords:
            userIntents.length +
            userEvents.length +
            userEscalations.length +
            userAuditRecords.length,
          exportVersion: '1.0',
          gdprArticle: 'Article 15 - Right of Access',
        },
      };

      logger.info(
        {
          userId,
          tenantId,
          exportId,
          intentsCount: userIntents.length,
          eventsCount: userEvents.length,
          escalationsCount: userEscalations.length,
          auditCount: userAuditRecords.length,
        },
        'GDPR data export completed'
      );

        return exportData;
      }, 'exportUserData');
    });
  }

  /**
   * Create an async export request (queues the export job)
   *
   * REQUIRES: GdprAuthorizationContext must be provided and valid.
   *
   * @param authContext - Authorization context from JWT (REQUIRED)
   * @param userId - The user/entity ID to export data for
   * @param tenantId - The tenant context
   * @returns Export request record
   * @throws ForbiddenError if authorization fails
   */
  async createExportRequest(
    authContext: GdprAuthorizationContext,
    userId: ID,
    tenantId: ID
  ): Promise<GdprExportRequest> {
    // Enforce authorization before creating export request
    const authResult = await this.enforceAuthorization(
      authContext,
      'export',
      userId,
      tenantId,
      checkExportAuthorization
    );

    const requestId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.exportTtlSeconds * 1000);

    const request: GdprExportRequest = {
      id: requestId,
      userId,
      tenantId,
      status: 'pending',
      requestedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadata: {
        requestedBy: authContext.requestingUserId,
        authorizedBy: authResult.grantedBy,
        requestingUserTenant: authContext.requestingUserTenantId,
      },
    };

    // Store request in Redis
    await this.redis.set(
      this.cachePrefix + requestId,
      JSON.stringify(request),
      'EX',
      this.exportTtlSeconds
    );

    // Record audit event
    await this.auditHelper.recordIntentEvent(
      tenantId,
      'data.exported',
      requestId,
      { type: 'user', id: authContext.requestingUserId },
      {
        outcome: 'success',
        metadata: {
          gdprAction: 'export_request_created',
          targetUserId: userId,
          expiresAt: expiresAt.toISOString(),
          authorizedBy: authResult.grantedBy,
        },
      }
    );

    logger.info(
      { requestId, userId, tenantId, requestedBy: authContext.requestingUserId, authorizedBy: authResult.grantedBy },
      'GDPR export request created'
    );

    return request;
  }

  /**
   * Get export request status
   *
   * REQUIRES: GdprAuthorizationContext must be provided and valid.
   *
   * @param authContext - Authorization context from JWT (REQUIRED)
   * @param requestId - The export request ID
   * @param tenantId - The tenant context for validation
   * @returns Export request or null if not found/expired
   * @throws ForbiddenError if authorization fails
   */
  async getExportRequest(
    authContext: GdprAuthorizationContext,
    requestId: ID,
    tenantId: ID
  ): Promise<GdprExportRequest | null> {
    const cached = await this.redis.get(this.cachePrefix + requestId);
    if (!cached) return null;

    const request = JSON.parse(cached) as GdprExportRequest;

    // Validate tenant match first (basic check before authorization)
    if (request.tenantId !== tenantId) {
      return null;
    }

    // Enforce authorization - user must own the export or have elevated privileges
    await this.enforceAuthorization(
      authContext,
      'export_view',
      request.userId,
      request.tenantId,
      checkExportViewAuthorization
    );

    // Check if expired
    if (request.expiresAt && new Date(request.expiresAt) < new Date()) {
      request.status = 'expired';
    }

    return request;
  }

  /**
   * Update export request status
   *
   * @param requestId - The export request ID
   * @param updates - Fields to update
   */
  async updateExportRequest(
    requestId: ID,
    updates: Partial<GdprExportRequest>
  ): Promise<GdprExportRequest | null> {
    const cached = await this.redis.get(this.cachePrefix + requestId);
    if (!cached) return null;

    const request = JSON.parse(cached) as GdprExportRequest;
    const updated: GdprExportRequest = { ...request, ...updates };

    // Calculate remaining TTL
    const ttl = await this.redis.ttl(this.cachePrefix + requestId);
    if (ttl > 0) {
      await this.redis.set(
        this.cachePrefix + requestId,
        JSON.stringify(updated),
        'EX',
        ttl
      );
    }

    return updated;
  }

  /**
   * Store completed export data
   *
   * @param requestId - The export request ID
   * @param data - The export data
   */
  async storeExportData(requestId: ID, data: GdprExportData): Promise<string> {
    const dataKey = `${this.cachePrefix}data:${requestId}`;

    // Store the export data
    await this.redis.set(
      dataKey,
      JSON.stringify(data),
      'EX',
      this.exportTtlSeconds
    );

    // Generate download URL (in production, this would be a signed URL or file storage)
    const downloadUrl = `/api/v1/intent/gdpr/export/${requestId}/download`;

    // Update request with download URL
    await this.updateExportRequest(requestId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      downloadUrl,
    });

    return downloadUrl;
  }

  /**
   * Get stored export data for download
   *
   * REQUIRES: GdprAuthorizationContext must be provided and valid.
   *
   * @param authContext - Authorization context from JWT (REQUIRED)
   * @param requestId - The export request ID
   * @param tenantId - The tenant context for validation
   * @returns Export data or null if not found/expired
   * @throws ForbiddenError if authorization fails
   */
  async getExportData(
    authContext: GdprAuthorizationContext,
    requestId: ID,
    tenantId: ID
  ): Promise<GdprExportData | null> {
    // First get request metadata (without auth check, we need userId for auth)
    const cached = await this.redis.get(this.cachePrefix + requestId);
    if (!cached) return null;

    const request = JSON.parse(cached) as GdprExportRequest;

    // Validate tenant match first
    if (request.tenantId !== tenantId) {
      return null;
    }

    // Enforce authorization for download (more sensitive than viewing status)
    await this.enforceAuthorization(
      authContext,
      'export_download',
      request.userId,
      request.tenantId,
      checkExportViewAuthorization
    );

    // Check status
    if (request.status !== 'completed') {
      return null;
    }

    const dataKey = `${this.cachePrefix}data:${requestId}`;
    const dataCached = await this.redis.get(dataKey);
    if (!dataCached) return null;

    // Record download audit event
    await this.auditService.record({
      tenantId,
      eventType: 'data.read',
      actor: {
        type: 'user',
        id: authContext.requestingUserId,
        ip: authContext.ipAddress,
      },
      target: {
        type: 'user',
        id: request.userId,
      },
      action: 'gdpr_export_download',
      outcome: 'success',
      metadata: {
        exportRequestId: requestId,
        exportUserId: request.userId,
        gdprArticle: 'Article 15 - Right of Access',
      },
      requestId: authContext.requestId,
    });

    return JSON.parse(dataCached) as GdprExportData;
  }

  /**
   * Soft delete all user data (Article 17 - Right to Erasure)
   * Protected by circuit breaker to prevent cascading failures.
   *
   * REQUIRES: GdprAuthorizationContext must be provided and valid.
   * NOTE: For non-self erasure, authContext.hasExplicitConsent must be true.
   *
   * @param authContext - Authorization context from JWT (REQUIRED)
   * @param userId - The user/entity ID to erase data for
   * @param tenantId - The tenant context
   * @returns Erasure result with counts
   * @throws ForbiddenError if authorization fails
   * @throws CircuitBreakerOpenError if the GDPR service circuit breaker is open
   */
  async eraseUserData(
    authContext: GdprAuthorizationContext,
    userId: ID,
    tenantId: ID
  ): Promise<GdprErasureResult> {
    // Enforce authorization before any data modification
    const authResult = await this.enforceAuthorization(
      authContext,
      'erasure',
      userId,
      tenantId,
      checkErasureAuthorization
    );

    const now = new Date();

    logger.info(
      {
        userId,
        tenantId,
        erasedBy: authContext.requestingUserId,
        authorizedBy: authResult.grantedBy,
        isSelfRequest: authContext.requestingUserId === userId,
      },
      'Starting GDPR data erasure'
    );

    // Wrap the entire erasure operation in circuit breaker protection
    return withCircuitBreaker('gdprService', async () => {
      // Get all user intents
      const userIntents = await this.db
        .select({ id: intents.id })
        .from(intents)
        .where(
          and(
            eq(intents.entityId, userId),
            eq(intents.tenantId, tenantId)
          )
        );

      const intentIds = userIntents.map((i) => i.id);

      // Soft delete intents (clear PII but keep audit trail)
      const intentResult = await this.db
        .update(intents)
        .set({
          deletedAt: now,
          updatedAt: now,
          context: {}, // Clear sensitive data
          metadata: {
            erasedAt: now.toISOString(),
            erasedBy: authContext.requestingUserId,
            authorizedBy: authResult.grantedBy,
          },
          goal: '[ERASED]',
        })
        .where(
          and(
            eq(intents.entityId, userId),
            eq(intents.tenantId, tenantId)
          )
        )
        .returning({ id: intents.id });

      // Clear event payloads for erased intents (chunked to avoid unbounded inArray queries)
      let eventsCleared = 0;
      if (intentIds.length > 0) {
        const intentIdChunks = chunkArray(intentIds, QUERY_BATCH_SIZE);
        for (const chunk of intentIdChunks) {
          const eventResult = await this.db
            .update(intentEvents)
            .set({
              payload: { erased: true, erasedAt: now.toISOString() },
            })
            .where(inArray(intentEvents.intentId, chunk))
            .returning({ id: intentEvents.id });

          eventsCleared += eventResult.length;
        }
      }

      // Mark escalations as erased (chunked to avoid unbounded inArray queries)
      let escalationsMarked = 0;
      if (intentIds.length > 0) {
        const intentIdChunks = chunkArray(intentIds, QUERY_BATCH_SIZE);
        for (const chunk of intentIdChunks) {
          const escalationResult = await this.db
            .update(escalations)
            .set({
              metadata: {
                erased: true,
                erasedAt: now.toISOString(),
                erasedBy: authContext.requestingUserId,
                authorizedBy: authResult.grantedBy,
              },
              context: null,
              updatedAt: now,
            })
            .where(
              and(
                inArray(escalations.intentId, chunk),
                eq(escalations.tenantId, tenantId)
              )
            )
            .returning({ id: escalations.id });

          escalationsMarked += escalationResult.length;
        }
      }

      const result: GdprErasureResult = {
        userId,
        tenantId,
        erasedAt: now.toISOString(),
        counts: {
          intents: intentResult.length,
          events: eventsCleared,
          escalations: escalationsMarked,
        },
      };

      // Record audit event for erasure
      await this.auditService.record({
        tenantId,
        eventType: 'data.deleted',
        actor: {
          type: 'user',
          id: authContext.requestingUserId,
          ip: authContext.ipAddress,
        },
        target: { type: 'user', id: userId },
        action: 'gdpr_erasure',
        outcome: 'success',
        metadata: {
          gdprArticle: 'Article 17 - Right to Erasure',
          counts: result.counts,
          authorizedBy: authResult.grantedBy,
          isSelfRequest: authContext.requestingUserId === userId,
          hasExplicitConsent: authContext.hasExplicitConsent,
        },
        requestId: authContext.requestId,
      });

      logger.info(
        {
          userId,
          tenantId,
          erasedBy: authContext.requestingUserId,
          authorizedBy: authResult.grantedBy,
          counts: result.counts,
        },
        'GDPR data erasure completed'
      );

      return result;
    });
  }
}

// =============================================================================
// GDPR EXPORT QUEUE
// =============================================================================

const GDPR_EXPORT_QUEUE_NAME = 'gdpr:export';

let gdprExportQueue: Queue | null = null;
let gdprExportWorker: Worker | null = null;
let gdprService: GdprService | null = null;

/**
 * Get or create the GDPR export queue
 */
export function getGdprExportQueue(): Queue {
  if (!gdprExportQueue) {
    const redis = getRedis();
    gdprExportQueue = new Queue(GDPR_EXPORT_QUEUE_NAME, {
      connection: redis.duplicate(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 60 * 60, // Keep completed jobs for 24 hours
          count: 100,
        },
        removeOnFail: false,
      },
    });
  }
  return gdprExportQueue;
}

/**
 * Authorization context stored with the job for background processing.
 * This is a serialized version of GdprAuthorizationContext.
 */
interface GdprExportJobData {
  requestId: ID;
  userId: ID;
  tenantId: ID;
  enqueuedAt: string;
  /** Serialized authorization context - already validated at request time */
  authContext: {
    requestingUserId: ID;
    requestingUserTenantId: ID;
    roles: GdprRole[];
    ipAddress?: string;
    requestId?: string;
  };
}

/**
 * Enqueue a GDPR export job
 *
 * Authorization is already validated when createExportRequest is called.
 * The authContext is stored with the job so the worker can record proper audit trails.
 *
 * @param requestId - The export request ID
 * @param userId - The user to export data for
 * @param tenantId - The tenant context
 * @param authContext - The validated authorization context
 */
export async function enqueueGdprExport(
  requestId: ID,
  userId: ID,
  tenantId: ID,
  authContext: GdprAuthorizationContext
): Promise<void> {
  const queue = getGdprExportQueue();
  await queue.add('export', {
    requestId,
    userId,
    tenantId,
    enqueuedAt: new Date().toISOString(),
    authContext: {
      requestingUserId: authContext.requestingUserId,
      requestingUserTenantId: authContext.requestingUserTenantId,
      roles: authContext.roles,
      ipAddress: authContext.ipAddress,
      requestId: authContext.requestId,
    },
  } satisfies GdprExportJobData);

  logger.info(
    { requestId, userId, tenantId, requestedBy: authContext.requestingUserId },
    'GDPR export job enqueued'
  );
}

/**
 * Process GDPR export jobs
 *
 * The job includes the authorization context that was validated at request time.
 * This allows proper audit trails without re-validating authorization.
 */
async function processGdprExportJob(
  job: Job<GdprExportJobData>
): Promise<void> {
  const { requestId, userId, tenantId, authContext: storedAuthContext } = job.data;

  logger.info(
    { requestId, userId, tenantId, requestedBy: storedAuthContext.requestingUserId },
    'Processing GDPR export job'
  );

  if (!gdprService) {
    gdprService = new GdprService();
  }

  // Reconstruct authorization context from stored data.
  // Authorization was already validated when the job was created.
  const authContext: GdprAuthorizationContext = {
    requestingUserId: storedAuthContext.requestingUserId,
    requestingUserTenantId: storedAuthContext.requestingUserTenantId,
    roles: storedAuthContext.roles,
    ipAddress: storedAuthContext.ipAddress,
    requestId: storedAuthContext.requestId,
  };

  try {
    // Update status to processing
    await gdprService.updateExportRequest(requestId, { status: 'processing' });

    // Perform the export with the stored authorization context
    const exportData = await gdprService.exportUserData(authContext, userId, tenantId);

    // Store the export data and get download URL
    await gdprService.storeExportData(requestId, exportData);

    logger.info(
      { requestId, userId, tenantId, recordCount: exportData.metadata.totalRecords },
      'GDPR export job completed'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await gdprService.updateExportRequest(requestId, {
      status: 'failed',
      error: errorMessage,
    });

    logger.error(
      { requestId, userId, tenantId, error: errorMessage },
      'GDPR export job failed'
    );

    throw error;
  }
}

/**
 * Register GDPR export worker
 */
export function registerGdprWorker(): void {
  if (gdprExportWorker) return;

  const redis = getRedis();
  const config = getConfig();
  const concurrency = config.gdpr.exportConcurrency ?? Math.max(2, os.cpus().length);
  gdprExportWorker = new Worker(
    GDPR_EXPORT_QUEUE_NAME,
    processGdprExportJob,
    {
      connection: redis.duplicate(),
      concurrency,
      lockDuration: 5 * 60 * 1000, // 5 minutes lock
    }
  );

  gdprExportWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'GDPR export worker completed job');
  });

  gdprExportWorker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, error: error.message },
      'GDPR export worker job failed'
    );
  });

  logger.info('GDPR export worker registered');
}

/**
 * Shutdown GDPR export worker
 */
export async function shutdownGdprWorker(): Promise<void> {
  if (gdprExportWorker) {
    await gdprExportWorker.close();
    gdprExportWorker = null;
    logger.info('GDPR export worker shutdown');
  }

  if (gdprExportQueue) {
    await gdprExportQueue.close();
    gdprExportQueue = null;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new GDPR service instance with dependency injection.
 *
 * This is the preferred way to create services in production code
 * as it makes dependencies explicit and testable.
 *
 * @param deps - Optional dependencies. If not provided, uses global singletons.
 * @returns Configured GdprService instance
 *
 * @example
 * // Default usage (backward compatible)
 * const service = createGdprService();
 *
 * @example
 * // With custom dependencies
 * const service = createGdprService({
 *   database: customDb,
 *   redis: customRedis,
 *   config: customConfig,
 * });
 */
export function createGdprService(
  deps: GdprServiceDependencies = {}
): GdprService {
  return new GdprService(deps);
}
