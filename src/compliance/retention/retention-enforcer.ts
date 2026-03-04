/**
 * Data Retention Enforcement Service
 *
 * Enforces retention policies by deleting or anonymizing data
 * that has exceeded its retention period, while respecting
 * litigation holds.
 *
 * @packageDocumentation
 */

import { eq, and, lt, inArray, sql, desc, asc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { createLogger } from '../../common/logger.js';
import { getDatabase } from '../../common/db.js';
import { DatabaseError, ServiceError, isVorionError } from '../../common/errors.js';
import type { ID } from '../../common/types.js';
import {
  intents,
  auditRecords,
  intentEvents,
  intentEvaluations,
  webhookDeliveries,
  auditReads,
} from '../../intent/schema.js';
import { proofs } from '../../db/schema/proofs.js';
import { AuditService, createAuditService } from '../../audit/service.js';
import {
  type RetentionPolicyConfig,
  type LitigationHold,
  type RetentionReport,
  type RetentionEnforcementResult,
  type RetentionComplianceStatus,
  type CreateLitigationHoldInput,
  type ReleaseLitigationHoldInput,
  DEFAULT_RETENTION_POLICIES,
  getRetentionCutoffDate,
  mergeRetentionPolicies,
} from './retention-policy.js';

const logger = createLogger({ component: 'retention-enforcer' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies for RetentionEnforcer
 */
export interface RetentionEnforcerDependencies {
  database?: NodePgDatabase;
  auditService?: AuditService;
}

/**
 * Options for enforcement run
 */
export interface EnforcementOptions {
  /** Dry run - don't actually delete, just report what would be deleted */
  dryRun?: boolean;
  /** Maximum records to process per category (for batching) */
  batchSize?: number;
  /** Specific categories to enforce (default: all) */
  categories?: Array<'intents' | 'auditLogs' | 'proofs' | 'sessions' | 'apiKeyLogs'>;
}

// =============================================================================
// RETENTION ENFORCER SERVICE
// =============================================================================

/**
 * Service for enforcing data retention policies
 */
export class RetentionEnforcer {
  private db: NodePgDatabase | null = null;
  private injectedDb: NodePgDatabase | null = null;
  private auditService: AuditService;
  private policyConfig: RetentionPolicyConfig;
  private litigationHolds: Map<ID, LitigationHold> = new Map();
  private lastEnforcementRun?: string;
  private lastReport?: RetentionReport;

  constructor(
    deps: RetentionEnforcerDependencies = {},
    policyConfig?: Partial<RetentionPolicyConfig>
  ) {
    if (deps.database) {
      this.injectedDb = deps.database;
      this.db = deps.database;
    }
    this.auditService = deps.auditService ?? createAuditService(deps);
    this.policyConfig = mergeRetentionPolicies(policyConfig ?? {});
  }

  /**
   * Get the database instance (lazy initialization if not injected)
   */
  private getDb(): NodePgDatabase {
    if (!this.db) {
      this.db = this.injectedDb ?? getDatabase();
    }
    return this.db;
  }

  /**
   * Get current retention policy configuration
   */
  getPolicyConfig(): RetentionPolicyConfig {
    return { ...this.policyConfig };
  }

  /**
   * Update retention policy configuration
   */
  updatePolicyConfig(config: Partial<RetentionPolicyConfig>): void {
    this.policyConfig = mergeRetentionPolicies(config);
    logger.info({ config: this.policyConfig }, 'Retention policy configuration updated');
  }

  // ===========================================================================
  // LITIGATION HOLD MANAGEMENT
  // ===========================================================================

  /**
   * Create a new litigation hold
   */
  async createLitigationHold(input: CreateLitigationHoldInput): Promise<LitigationHold> {
    const hold: LitigationHold = {
      id: randomUUID(),
      tenantId: input.tenantId,
      matterReference: input.matterReference,
      description: input.description,
      dataType: input.dataType,
      entityIds: input.entityIds,
      status: 'active',
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };

    this.litigationHolds.set(hold.id, hold);

    // Audit the creation
    await this.auditService.record({
      tenantId: input.tenantId,
      eventType: 'data.litigation_hold_created',
      actor: { type: 'user', id: input.createdBy },
      target: { type: 'system', id: hold.id },
      action: 'create_litigation_hold',
      outcome: 'success',
      metadata: {
        holdId: hold.id,
        matterReference: hold.matterReference,
        dataType: hold.dataType,
        entityIds: hold.entityIds,
      },
    });

    logger.info(
      {
        holdId: hold.id,
        tenantId: hold.tenantId,
        matterReference: hold.matterReference,
        dataType: hold.dataType,
      },
      'Litigation hold created'
    );

    return hold;
  }

  /**
   * Release a litigation hold
   */
  async releaseLitigationHold(input: ReleaseLitigationHoldInput): Promise<LitigationHold | null> {
    const hold = this.litigationHolds.get(input.holdId);

    if (!hold) {
      return null;
    }

    if (hold.tenantId !== input.tenantId) {
      throw new ServiceError(
        'Cannot release hold from different tenant',
        'retention-enforcer',
        'releaseLitigationHold',
        { holdId: input.holdId, tenantId: input.tenantId }
      );
    }

    const updatedHold: LitigationHold = {
      ...hold,
      status: 'released',
      releasedBy: input.releasedBy,
      releasedAt: new Date().toISOString(),
      releaseReason: input.releaseReason,
    };

    this.litigationHolds.set(input.holdId, updatedHold);

    // Audit the release
    await this.auditService.record({
      tenantId: input.tenantId,
      eventType: 'data.litigation_hold_released',
      actor: { type: 'user', id: input.releasedBy },
      target: { type: 'system', id: input.holdId },
      action: 'release_litigation_hold',
      outcome: 'success',
      metadata: {
        holdId: input.holdId,
        matterReference: hold.matterReference,
        releaseReason: input.releaseReason,
      },
    });

    logger.info(
      {
        holdId: input.holdId,
        tenantId: input.tenantId,
        matterReference: hold.matterReference,
        releasedBy: input.releasedBy,
      },
      'Litigation hold released'
    );

    return updatedHold;
  }

  /**
   * Get a litigation hold by ID
   */
  getLitigationHold(holdId: ID): LitigationHold | null {
    return this.litigationHolds.get(holdId) ?? null;
  }

  /**
   * List all active litigation holds for a tenant
   */
  getActiveLitigationHolds(tenantId?: ID): LitigationHold[] {
    const holds = Array.from(this.litigationHolds.values())
      .filter((h) => h.status === 'active')
      .filter((h) => !tenantId || h.tenantId === tenantId);

    // Check for expired holds and mark them as released
    const now = new Date();
    for (const hold of holds) {
      if (hold.expiresAt && new Date(hold.expiresAt) < now) {
        hold.status = 'released';
        hold.releasedAt = now.toISOString();
        hold.releaseReason = 'Automatic expiration';
      }
    }

    return holds.filter((h) => h.status === 'active');
  }

  /**
   * Check if a record is protected by litigation hold
   */
  private isProtectedByHold(
    dataType: string,
    entityId?: ID,
    tenantId?: ID
  ): boolean {
    const activeHolds = this.getActiveLitigationHolds(tenantId);

    for (const hold of activeHolds) {
      // Check if hold applies to this data type
      if (hold.dataType !== 'all' && hold.dataType !== dataType) {
        continue;
      }

      // If no specific entity IDs, the hold applies to all
      if (!hold.entityIds || hold.entityIds.length === 0) {
        return true;
      }

      // Check if specific entity is held
      if (entityId && hold.entityIds.includes(entityId)) {
        return true;
      }
    }

    return false;
  }

  // ===========================================================================
  // ENFORCEMENT METHODS
  // ===========================================================================

  /**
   * Main enforcement method - enforces all retention policies
   */
  async enforceRetention(options: EnforcementOptions = {}): Promise<RetentionReport> {
    const reportId = randomUUID();
    const startTime = performance.now();
    const enforcementStartedAt = new Date().toISOString();
    const errors: string[] = [];

    const batchSize = options.batchSize ?? 1000;
    const categories = options.categories ?? [
      'intents',
      'auditLogs',
      'proofs',
      'sessions',
      'apiKeyLogs',
    ];

    logger.info(
      {
        reportId,
        dryRun: options.dryRun ?? false,
        categories,
        batchSize,
      },
      'Starting retention enforcement'
    );

    // Initialize results
    const results: RetentionReport['results'] = {
      intents: this.createEmptyResult('intents'),
      auditLogs: this.createEmptyResult('auditLogs'),
      proofs: this.createEmptyResult('proofs'),
      sessions: this.createEmptyResult('sessions'),
      apiKeyLogs: this.createEmptyResult('apiKeyLogs'),
    };

    // Process each category
    for (const category of categories) {
      try {
        switch (category) {
          case 'intents':
            results.intents = await this.enforceIntentRetention(batchSize, options.dryRun);
            break;
          case 'auditLogs':
            results.auditLogs = await this.enforceAuditLogRetention(batchSize, options.dryRun);
            break;
          case 'proofs':
            results.proofs = await this.enforceProofRetention(batchSize, options.dryRun);
            break;
          case 'sessions':
            results.sessions = await this.enforceSessionRetention(batchSize, options.dryRun);
            break;
          case 'apiKeyLogs':
            results.apiKeyLogs = await this.enforceApiKeyLogRetention(batchSize, options.dryRun);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${category}: ${message}`);
        logger.error({ category, error }, 'Error enforcing retention for category');
      }
    }

    const endTime = performance.now();
    const totalDurationMs = Math.round(endTime - startTime);

    // Calculate summary
    const summary = {
      totalRecordsProcessed:
        results.intents.recordsDeleted +
        results.intents.recordsAnonymized +
        results.intents.recordsSkipped +
        results.auditLogs.recordsDeleted +
        results.auditLogs.recordsAnonymized +
        results.auditLogs.recordsSkipped +
        results.proofs.recordsDeleted +
        results.proofs.recordsAnonymized +
        results.proofs.recordsSkipped +
        results.sessions.recordsDeleted +
        results.sessions.recordsAnonymized +
        results.sessions.recordsSkipped +
        results.apiKeyLogs.recordsDeleted +
        results.apiKeyLogs.recordsAnonymized +
        results.apiKeyLogs.recordsSkipped,
      totalRecordsDeleted:
        results.intents.recordsDeleted +
        results.auditLogs.recordsDeleted +
        results.proofs.recordsDeleted +
        results.sessions.recordsDeleted +
        results.apiKeyLogs.recordsDeleted,
      totalRecordsAnonymized:
        results.intents.recordsAnonymized +
        results.auditLogs.recordsAnonymized +
        results.proofs.recordsAnonymized +
        results.sessions.recordsAnonymized +
        results.apiKeyLogs.recordsAnonymized,
      totalRecordsSkipped:
        results.intents.recordsSkipped +
        results.auditLogs.recordsSkipped +
        results.proofs.recordsSkipped +
        results.sessions.recordsSkipped +
        results.apiKeyLogs.recordsSkipped,
      totalErrors: errors.length,
    };

    const report: RetentionReport = {
      reportId,
      generatedAt: new Date().toISOString(),
      enforcementStartedAt,
      enforcementCompletedAt: new Date().toISOString(),
      totalDurationMs,
      policyConfig: this.policyConfig,
      results,
      summary,
      activeLitigationHolds: this.getActiveLitigationHolds().length,
      success: errors.length === 0,
      criticalErrors: errors,
    };

    this.lastEnforcementRun = enforcementStartedAt;
    this.lastReport = report;

    // Audit the enforcement run
    await this.auditService.record({
      tenantId: 'system',
      eventType: 'system.retention_enforcement_completed',
      actor: { type: 'system', id: 'retention-enforcer' },
      target: { type: 'system', id: reportId },
      action: 'enforce_retention',
      outcome: report.success ? 'success' : 'partial',
      metadata: {
        reportId,
        totalDeleted: summary.totalRecordsDeleted,
        totalAnonymized: summary.totalRecordsAnonymized,
        totalSkipped: summary.totalRecordsSkipped,
        durationMs: totalDurationMs,
        dryRun: options.dryRun ?? false,
      },
    });

    logger.info(
      {
        reportId,
        totalDeleted: summary.totalRecordsDeleted,
        totalAnonymized: summary.totalRecordsAnonymized,
        totalSkipped: summary.totalRecordsSkipped,
        durationMs: totalDurationMs,
        success: report.success,
      },
      'Retention enforcement completed'
    );

    return report;
  }

  /**
   * Enforce retention for intents
   */
  private async enforceIntentRetention(
    batchSize: number,
    dryRun?: boolean
  ): Promise<RetentionEnforcementResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    let recordsDeleted = 0;
    let recordsAnonymized = 0;
    let recordsSkipped = 0;

    try {
      const db = this.getDb();

      // Process each intent status with its retention period
      const statusRetention: Array<{ status: string; days: number }> = [
        { status: 'approved', days: this.policyConfig.intents.approved },
        { status: 'denied', days: this.policyConfig.intents.denied },
        { status: 'failed', days: this.policyConfig.intents.failed },
        { status: 'escalated', days: this.policyConfig.intents.escalated },
        { status: 'completed', days: this.policyConfig.intents.approved },
        { status: 'cancelled', days: this.policyConfig.intents.denied },
      ];

      for (const { status, days } of statusRetention) {
        const cutoffDate = getRetentionCutoffDate(days);

        // Find intents past retention
        const expiredIntents = await db
          .select({ id: intents.id, tenantId: intents.tenantId })
          .from(intents)
          .where(
            and(
              eq(intents.status, status as 'approved' | 'denied' | 'failed' | 'escalated' | 'completed' | 'cancelled'),
              lt(intents.createdAt, cutoffDate)
            )
          )
          .limit(batchSize);

        for (const intent of expiredIntents) {
          // Check litigation hold
          if (this.isProtectedByHold('intent', intent.id, intent.tenantId)) {
            recordsSkipped++;
            continue;
          }

          if (!dryRun) {
            // Delete related records first
            await db.delete(intentEvents).where(eq(intentEvents.intentId, intent.id));
            await db.delete(intentEvaluations).where(eq(intentEvaluations.intentId, intent.id));
            // Delete the intent
            await db.delete(intents).where(eq(intents.id, intent.id));
          }
          recordsDeleted++;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
      logger.error({ error }, 'Error enforcing intent retention');
    }

    return {
      category: 'intents',
      recordsDeleted,
      recordsAnonymized,
      recordsSkipped,
      errors,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Enforce retention for audit logs
   */
  private async enforceAuditLogRetention(
    batchSize: number,
    dryRun?: boolean
  ): Promise<RetentionEnforcementResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    let recordsDeleted = 0;
    let recordsAnonymized = 0;
    let recordsSkipped = 0;

    try {
      const db = this.getDb();
      const cutoffDate = getRetentionCutoffDate(this.policyConfig.auditLogs);

      // Find audit records past retention (must be archived first)
      const expiredRecords = await db
        .select({ id: auditRecords.id, tenantId: auditRecords.tenantId })
        .from(auditRecords)
        .where(
          and(
            eq(auditRecords.archived, true),
            lt(auditRecords.eventTime, cutoffDate)
          )
        )
        .limit(batchSize);

      for (const record of expiredRecords) {
        // Check litigation hold
        if (this.isProtectedByHold('audit_log', record.id, record.tenantId)) {
          recordsSkipped++;
          continue;
        }

        if (!dryRun) {
          await db.delete(auditRecords).where(eq(auditRecords.id, record.id));
        }
        recordsDeleted++;
      }

      // Also handle audit reads table
      const expiredReads = await db
        .select({ id: auditReads.id, tenantId: auditReads.tenantId })
        .from(auditReads)
        .where(lt(auditReads.timestamp, cutoffDate))
        .limit(batchSize);

      for (const read of expiredReads) {
        if (this.isProtectedByHold('audit_log', read.id, read.tenantId)) {
          recordsSkipped++;
          continue;
        }

        if (!dryRun) {
          await db.delete(auditReads).where(eq(auditReads.id, read.id));
        }
        recordsDeleted++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
      logger.error({ error }, 'Error enforcing audit log retention');
    }

    return {
      category: 'auditLogs',
      recordsDeleted,
      recordsAnonymized,
      recordsSkipped,
      errors,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Enforce retention for proofs
   *
   * Note: Proofs have very long retention (7 years) and should typically
   * only be anonymized, not deleted, to maintain chain integrity
   */
  private async enforceProofRetention(
    batchSize: number,
    dryRun?: boolean
  ): Promise<RetentionEnforcementResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    let recordsDeleted = 0;
    let recordsAnonymized = 0;
    let recordsSkipped = 0;

    try {
      const db = this.getDb();
      const cutoffDate = getRetentionCutoffDate(this.policyConfig.proofs);

      // Find proofs past retention
      const expiredProofs = await db
        .select({ id: proofs.id, entityId: proofs.entityId })
        .from(proofs)
        .where(lt(proofs.createdAt, cutoffDate))
        .limit(batchSize);

      for (const proof of expiredProofs) {
        // Check litigation hold
        if (this.isProtectedByHold('proof', proof.id)) {
          recordsSkipped++;
          continue;
        }

        if (!dryRun) {
          // Anonymize instead of delete to maintain chain integrity
          // Replace PII in inputs/outputs with placeholder
          await db
            .update(proofs)
            .set({
              inputs: { anonymized: true, reason: 'retention_policy' },
              outputs: { anonymized: true, reason: 'retention_policy' },
            })
            .where(eq(proofs.id, proof.id));
        }
        recordsAnonymized++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
      logger.error({ error }, 'Error enforcing proof retention');
    }

    return {
      category: 'proofs',
      recordsDeleted,
      recordsAnonymized,
      recordsSkipped,
      errors,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Enforce retention for sessions
   */
  private async enforceSessionRetention(
    batchSize: number,
    dryRun?: boolean
  ): Promise<RetentionEnforcementResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    let recordsDeleted = 0;
    const recordsAnonymized = 0;
    let recordsSkipped = 0;

    try {
      // Sessions are typically stored in Redis, not PostgreSQL
      // This is a placeholder for session cleanup
      // In a real implementation, this would call the session manager

      logger.debug('Session retention enforcement - sessions managed by session manager');

      // If we had a session store table, we would clean it here
      // For now, just log that this is handled elsewhere
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
      logger.error({ error }, 'Error enforcing session retention');
    }

    return {
      category: 'sessions',
      recordsDeleted,
      recordsAnonymized,
      recordsSkipped,
      errors,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  /**
   * Enforce retention for API key logs
   */
  private async enforceApiKeyLogRetention(
    batchSize: number,
    dryRun?: boolean
  ): Promise<RetentionEnforcementResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    let recordsDeleted = 0;
    const recordsAnonymized = 0;
    let recordsSkipped = 0;

    try {
      const db = this.getDb();
      const cutoffDate = getRetentionCutoffDate(this.policyConfig.apiKeyLogs);

      // Clean up webhook delivery logs (as an example of API-related logs)
      const expiredDeliveries = await db
        .select({ id: webhookDeliveries.id, tenantId: webhookDeliveries.tenantId })
        .from(webhookDeliveries)
        .where(lt(webhookDeliveries.createdAt, cutoffDate))
        .limit(batchSize);

      for (const delivery of expiredDeliveries) {
        if (this.isProtectedByHold('api_key_log', delivery.id, delivery.tenantId)) {
          recordsSkipped++;
          continue;
        }

        if (!dryRun) {
          await db.delete(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
        }
        recordsDeleted++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push(message);
      logger.error({ error }, 'Error enforcing API key log retention');
    }

    return {
      category: 'apiKeyLogs',
      recordsDeleted,
      recordsAnonymized,
      recordsSkipped,
      errors,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // ===========================================================================
  // COMPLIANCE STATUS
  // ===========================================================================

  /**
   * Get the current compliance status for retention
   */
  async getComplianceStatus(): Promise<RetentionComplianceStatus> {
    const db = this.getDb();
    const overdueCategories: RetentionComplianceStatus['overdueCategories'] = [];

    // Check for overdue intents
    for (const [status, days] of Object.entries(this.policyConfig.intents)) {
      const cutoffDate = getRetentionCutoffDate(days as number);

      const [result] = await db
        .select({
          count: sql<number>`count(*)`,
          oldest: sql<Date>`min(created_at)`,
        })
        .from(intents)
        .where(
          and(
            eq(intents.status, status as 'approved' | 'denied' | 'failed' | 'escalated'),
            lt(intents.createdAt, cutoffDate)
          )
        );

      if (result && Number(result.count) > 0 && result.oldest) {
        const daysOverdue = Math.floor(
          (cutoffDate.getTime() - new Date(result.oldest).getTime()) / (1000 * 60 * 60 * 24)
        );
        overdueCategories.push({
          category: `intents.${status}`,
          oldestRecordDate: new Date(result.oldest).toISOString(),
          retentionPeriodDays: days as number,
          daysOverdue,
          recordCount: Number(result.count),
        });
      }
    }

    // Check for overdue audit logs
    const auditCutoff = getRetentionCutoffDate(this.policyConfig.auditLogs);
    const [auditResult] = await db
      .select({
        count: sql<number>`count(*)`,
        oldest: sql<Date>`min(event_time)`,
      })
      .from(auditRecords)
      .where(
        and(
          eq(auditRecords.archived, true),
          lt(auditRecords.eventTime, auditCutoff)
        )
      );

    if (auditResult && Number(auditResult.count) > 0 && auditResult.oldest) {
      const daysOverdue = Math.floor(
        (auditCutoff.getTime() - new Date(auditResult.oldest).getTime()) / (1000 * 60 * 60 * 24)
      );
      overdueCategories.push({
        category: 'auditLogs',
        oldestRecordDate: new Date(auditResult.oldest).toISOString(),
        retentionPeriodDays: this.policyConfig.auditLogs,
        daysOverdue,
        recordCount: Number(auditResult.count),
      });
    }

    // Build status
    const status: RetentionComplianceStatus = {
      compliant: overdueCategories.length === 0,
      lastEnforcementRun: this.lastEnforcementRun,
      policyConfig: this.policyConfig,
      overdueCategories,
      activeLitigationHolds: this.getActiveLitigationHolds(),
    };

    if (this.lastReport) {
      status.lastReportSummary = {
        reportId: this.lastReport.reportId,
        generatedAt: this.lastReport.generatedAt,
        totalDeleted: this.lastReport.summary.totalRecordsDeleted,
        totalAnonymized: this.lastReport.summary.totalRecordsAnonymized,
        success: this.lastReport.success,
      };
    }

    return status;
  }

  /**
   * Get the last enforcement report
   */
  getLastReport(): RetentionReport | undefined {
    return this.lastReport;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Create an empty enforcement result
   */
  private createEmptyResult(category: string): RetentionEnforcementResult {
    return {
      category,
      recordsDeleted: 0,
      recordsAnonymized: 0,
      recordsSkipped: 0,
      errors: [],
      durationMs: 0,
    };
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

let retentionEnforcerInstance: RetentionEnforcer | null = null;

/**
 * Get or create the retention enforcer singleton
 */
export function getRetentionEnforcer(
  deps?: RetentionEnforcerDependencies,
  policyConfig?: Partial<RetentionPolicyConfig>
): RetentionEnforcer {
  if (!retentionEnforcerInstance) {
    retentionEnforcerInstance = new RetentionEnforcer(deps, policyConfig);
  }
  return retentionEnforcerInstance;
}

/**
 * Create a new retention enforcer instance
 */
export function createRetentionEnforcer(
  deps?: RetentionEnforcerDependencies,
  policyConfig?: Partial<RetentionPolicyConfig>
): RetentionEnforcer {
  return new RetentionEnforcer(deps, policyConfig);
}

/**
 * Reset the retention enforcer singleton (for testing)
 */
export function resetRetentionEnforcer(): void {
  retentionEnforcerInstance = null;
}
