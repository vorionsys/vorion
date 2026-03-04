/**
 * Data Retention Compliance Module
 *
 * Provides automated data retention policy enforcement for GDPR
 * and other compliance requirements.
 *
 * Features:
 * - Configurable retention policies by data type
 * - Litigation hold support to prevent deletion
 * - Scheduled enforcement with leader election
 * - Comprehensive audit logging
 * - Compliance status reporting
 *
 * @packageDocumentation
 */

// =============================================================================
// POLICY DEFINITIONS
// =============================================================================

export {
  // Types
  type IntentStatusKey,
  type IntentRetentionPeriods,
  type RetentionPolicyConfig,
  type LitigationHoldStatus,
  type LitigationHoldDataType,
  type LitigationHold,
  type CreateLitigationHoldInput,
  type ReleaseLitigationHoldInput,
  type DataCategoryStats,
  type RetentionEnforcementResult,
  type RetentionReport,
  type RetentionComplianceStatus,
  // Constants
  DEFAULT_RETENTION_POLICIES,
  // Schemas
  retentionPolicySchema,
  createLitigationHoldSchema,
  releaseLitigationHoldSchema,
  // Helper functions
  getIntentRetentionPeriod,
  getRetentionCutoffDate,
  isPastRetention,
  mergeRetentionPolicies,
} from './retention-policy.js';

// =============================================================================
// ENFORCEMENT SERVICE
// =============================================================================

export {
  // Types
  type RetentionEnforcerDependencies,
  type EnforcementOptions,
  // Class
  RetentionEnforcer,
  // Factory functions
  getRetentionEnforcer,
  createRetentionEnforcer,
  resetRetentionEnforcer,
} from './retention-enforcer.js';

// =============================================================================
// SCHEDULER
// =============================================================================

export {
  // Types
  type RetentionSchedulerConfig,
  type RetentionSchedulerStatus,
  // Constants
  DEFAULT_SCHEDULER_CONFIG,
  // Class
  RetentionScheduler,
  // Factory functions
  getRetentionScheduler,
  createRetentionScheduler,
  resetRetentionScheduler,
  // Convenience functions
  startRetentionScheduler,
  stopRetentionScheduler,
} from './retention-scheduler.js';
