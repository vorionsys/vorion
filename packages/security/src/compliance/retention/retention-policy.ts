/**
 * Data Retention Policy Definitions
 *
 * Defines retention policies for different data types to ensure
 * GDPR compliance and proper data lifecycle management.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { ID } from '../../common/types.js';

// =============================================================================
// RETENTION POLICY TYPES
// =============================================================================

/**
 * Intent status types for retention policy
 */
export type IntentStatusKey = 'approved' | 'denied' | 'failed' | 'escalated';

/**
 * Retention periods by intent status (in days)
 */
export interface IntentRetentionPeriods {
  approved: number;
  denied: number;
  failed: number;
  escalated: number;
}

/**
 * Complete retention policy configuration
 */
export interface RetentionPolicyConfig {
  /** Intent retention periods by status */
  intents: IntentRetentionPeriods;
  /** Audit log retention in days (2 years for SOC2) */
  auditLogs: number;
  /** Cryptographic proofs retention in days (7 years for legal compliance) */
  proofs: number;
  /** Session data retention in days */
  sessions: number;
  /** API key access logs retention in days */
  apiKeyLogs: number;
}

/**
 * Default retention policies
 *
 * These values are based on common compliance requirements:
 * - GDPR: Right to erasure, generally 30 days for failed/denied
 * - SOC2: Audit logs must be retained for 2 years
 * - Legal: Financial proofs often require 7-year retention
 */
export const DEFAULT_RETENTION_POLICIES: RetentionPolicyConfig = {
  intents: {
    approved: 90,    // 90 days for approved intents
    denied: 90,      // 90 days for denied intents
    failed: 30,      // 30 days for GDPR compliance
    escalated: 180,  // 180 days for escalated intents (may need longer review)
  },
  auditLogs: 730,    // 2 years (SOC2 requirement)
  proofs: 2555,      // 7 years (legal/financial compliance)
  sessions: 30,      // 30 days for session data
  apiKeyLogs: 90,    // 90 days for API key access logs
};

/**
 * Retention policy schema for validation
 */
export const retentionPolicySchema = z.object({
  intents: z.object({
    approved: z.number().int().min(1).max(3650),
    denied: z.number().int().min(1).max(3650),
    failed: z.number().int().min(1).max(3650),
    escalated: z.number().int().min(1).max(3650),
  }),
  auditLogs: z.number().int().min(1).max(3650),
  proofs: z.number().int().min(1).max(3650),
  sessions: z.number().int().min(1).max(3650),
  apiKeyLogs: z.number().int().min(1).max(3650),
});

// =============================================================================
// LITIGATION HOLD TYPES
// =============================================================================

/**
 * Status of a litigation hold
 */
export type LitigationHoldStatus = 'active' | 'released';

/**
 * Type of data subject to litigation hold
 */
export type LitigationHoldDataType =
  | 'intent'
  | 'audit_log'
  | 'proof'
  | 'session'
  | 'api_key_log'
  | 'all';

/**
 * Litigation hold record
 */
export interface LitigationHold {
  /** Unique hold identifier */
  id: ID;
  /** Tenant this hold applies to */
  tenantId: ID;
  /** Legal matter reference */
  matterReference: string;
  /** Description of the hold */
  description: string;
  /** Type of data held */
  dataType: LitigationHoldDataType;
  /** Specific entity IDs to hold (optional - if empty, applies to all of dataType) */
  entityIds?: ID[];
  /** Hold status */
  status: LitigationHoldStatus;
  /** Who created the hold */
  createdBy: ID;
  /** When the hold was created */
  createdAt: string;
  /** When the hold expires (optional) */
  expiresAt?: string;
  /** Who released the hold (if released) */
  releasedBy?: ID;
  /** When the hold was released */
  releasedAt?: string;
  /** Reason for release */
  releaseReason?: string;
}

/**
 * Input for creating a litigation hold
 */
export interface CreateLitigationHoldInput {
  tenantId: ID;
  matterReference: string;
  description: string;
  dataType: LitigationHoldDataType;
  entityIds?: ID[];
  createdBy: ID;
  expiresAt?: string;
}

/**
 * Input for releasing a litigation hold
 */
export interface ReleaseLitigationHoldInput {
  holdId: ID;
  tenantId: ID;
  releasedBy: ID;
  releaseReason: string;
}

/**
 * Schema for creating a litigation hold
 */
export const createLitigationHoldSchema = z.object({
  matterReference: z.string().min(1).max(255),
  description: z.string().min(1).max(2000),
  dataType: z.enum(['intent', 'audit_log', 'proof', 'session', 'api_key_log', 'all']),
  entityIds: z.array(z.string().uuid()).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Schema for releasing a litigation hold
 */
export const releaseLitigationHoldSchema = z.object({
  releaseReason: z.string().min(1).max(2000),
});

// =============================================================================
// RETENTION REPORT TYPES
// =============================================================================

/**
 * Data category statistics for retention report
 */
export interface DataCategoryStats {
  /** Total records in this category */
  totalRecords: number;
  /** Records eligible for deletion */
  eligibleForDeletion: number;
  /** Records protected by litigation hold */
  protectedByHold: number;
  /** Oldest record date */
  oldestRecordDate?: string;
  /** Records deleted in last run */
  deletedInLastRun: number;
  /** Records anonymized in last run */
  anonymizedInLastRun: number;
}

/**
 * Retention enforcement run result
 */
export interface RetentionEnforcementResult {
  /** Category of data processed */
  category: string;
  /** Number of records deleted */
  recordsDeleted: number;
  /** Number of records anonymized */
  recordsAnonymized: number;
  /** Number of records skipped (litigation hold) */
  recordsSkipped: number;
  /** Any errors encountered */
  errors: string[];
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Complete retention enforcement report
 */
export interface RetentionReport {
  /** Unique report identifier */
  reportId: ID;
  /** When the report was generated */
  generatedAt: string;
  /** When enforcement started */
  enforcementStartedAt: string;
  /** When enforcement completed */
  enforcementCompletedAt: string;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Policy configuration used */
  policyConfig: RetentionPolicyConfig;
  /** Results by category */
  results: {
    intents: RetentionEnforcementResult;
    auditLogs: RetentionEnforcementResult;
    proofs: RetentionEnforcementResult;
    sessions: RetentionEnforcementResult;
    apiKeyLogs: RetentionEnforcementResult;
  };
  /** Overall statistics */
  summary: {
    totalRecordsProcessed: number;
    totalRecordsDeleted: number;
    totalRecordsAnonymized: number;
    totalRecordsSkipped: number;
    totalErrors: number;
  };
  /** Active litigation holds at time of enforcement */
  activeLitigationHolds: number;
  /** Whether enforcement completed successfully */
  success: boolean;
  /** Any critical errors that prevented completion */
  criticalErrors: string[];
}

/**
 * Compliance status for retention
 */
export interface RetentionComplianceStatus {
  /** Whether all policies are being enforced */
  compliant: boolean;
  /** Last successful enforcement run */
  lastEnforcementRun?: string;
  /** Next scheduled enforcement run */
  nextScheduledRun?: string;
  /** Current policy configuration */
  policyConfig: RetentionPolicyConfig;
  /** Categories with overdue data */
  overdueCategories: Array<{
    category: string;
    oldestRecordDate: string;
    retentionPeriodDays: number;
    daysOverdue: number;
    recordCount: number;
  }>;
  /** Active litigation holds */
  activeLitigationHolds: LitigationHold[];
  /** Last enforcement report summary */
  lastReportSummary?: {
    reportId: ID;
    generatedAt: string;
    totalDeleted: number;
    totalAnonymized: number;
    success: boolean;
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the retention period for a specific intent status
 */
export function getIntentRetentionPeriod(
  status: string,
  config: RetentionPolicyConfig = DEFAULT_RETENTION_POLICIES
): number {
  const statusKey = status.toLowerCase() as IntentStatusKey;
  return config.intents[statusKey] ?? config.intents.approved;
}

/**
 * Calculate the cutoff date for retention
 */
export function getRetentionCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

/**
 * Check if a date is past the retention period
 */
export function isPastRetention(
  recordDate: Date | string,
  retentionDays: number
): boolean {
  const date = typeof recordDate === 'string' ? new Date(recordDate) : recordDate;
  const cutoff = getRetentionCutoffDate(retentionDays);
  return date < cutoff;
}

/**
 * Merge custom retention policies with defaults
 */
export function mergeRetentionPolicies(
  custom: Partial<RetentionPolicyConfig>
): RetentionPolicyConfig {
  return {
    intents: {
      ...DEFAULT_RETENTION_POLICIES.intents,
      ...custom.intents,
    },
    auditLogs: custom.auditLogs ?? DEFAULT_RETENTION_POLICIES.auditLogs,
    proofs: custom.proofs ?? DEFAULT_RETENTION_POLICIES.proofs,
    sessions: custom.sessions ?? DEFAULT_RETENTION_POLICIES.sessions,
    apiKeyLogs: custom.apiKeyLogs ?? DEFAULT_RETENTION_POLICIES.apiKeyLogs,
  };
}
