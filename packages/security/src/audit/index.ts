/**
 * Audit Engine
 *
 * Provides comprehensive audit logging with chain integrity for compliance
 * and forensic analysis.
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Audit Types
// =============================================================================

export type {
  AuditSeverity,
  AuditOutcome,
  AuditCategory,
  AuditEventType,
  ActorType,
  TargetType,
  AuditActor,
  AuditTarget,
  AuditStateChange,
  AuditRecord,
  CreateAuditRecordInput,
  AuditQueryFilters,
  AuditQueryResult,
  ChainIntegrityResult,
  // Retention types
  AuditArchiveResult,
  AuditPurgeResult,
  AuditCleanupResult,
} from './types.js';

export {
  AUDIT_SEVERITIES,
  AUDIT_OUTCOMES,
  AUDIT_CATEGORIES,
  AUDIT_EVENT_TYPES,
  ACTOR_TYPES,
  TARGET_TYPES,
} from './types.js';

// =============================================================================
// Core Audit Service
// =============================================================================

export {
  AuditService,
  AuditHelper,
  createAuditService,
  createAuditHelper,
  type AuditServiceDependencies,
} from './service.js';

// =============================================================================
// Security Events (SOC 2 Compliance)
// =============================================================================

export {
  // Event categories and types
  SECURITY_EVENT_CATEGORIES,
  SECURITY_SEVERITIES,
  SECURITY_OUTCOMES,
  SECURITY_EVENT_TYPES,
  AUTHENTICATION_EVENT_TYPES,
  AUTHORIZATION_EVENT_TYPES,
  DATA_ACCESS_EVENT_TYPES,
  CONFIGURATION_EVENT_TYPES,
  INCIDENT_EVENT_TYPES,

  // Type definitions
  type SecurityEventCategory,
  type SecuritySeverity,
  type SecurityOutcome,
  type SecurityEventType,
  type SecurityActor,
  type SecurityResource,
  type SecurityEvent,
  type CreateSecurityEventInput,

  // Schemas
  securityActorSchema,
  securityResourceSchema,
  securityEventSchema,
  createSecurityEventInputSchema,

  // Helpers
  getSecurityEventDefinition,
  getSecurityEventsByCategory,
  getSecurityEventsBySeverity,
  isValidSecurityEventType,
  getAllSecurityEventTypes,
  getSoc2Control,
} from './security-events.js';

// =============================================================================
// Security Audit Logger
// =============================================================================

export {
  SecurityAuditLogger,
  ScopedSecurityLogger,
  getSecurityAuditLogger,
  createSecurityAuditLogger,
  resetSecurityAuditLogger,
  type SecurityRequestContext,
  type SecurityLoggerConfig,
  type SecurityLoggerDependencies,
} from './security-logger.js';

// =============================================================================
// Compliance Reporter
// =============================================================================

export {
  ComplianceReporter,
  createComplianceReporter,
  getSoc2Controls,
  getSoc2Control as getComplianceSoc2Control,
  SOC2_CONTROLS,
  type Soc2Control,
  type ReportFilters,
  type ReportSummary,
  type ComplianceReport,
  type Soc2ControlCoverage,
  type AuditEventRecord,
  type ExportFormat,
  type ReportOptions,
} from './compliance-reporter.js';

// =============================================================================
// Database-backed Audit Store
// =============================================================================

export {
  // Interface and types
  type AuditLogStore,
  type AuditEntry,
  type AuditQueryFilter,
  type AuditStoreType,
  type CreateAuditStoreOptions,

  // Implementations
  DatabaseAuditStore,
  InMemoryAuditStore,

  // Schema exports (for migrations)
  auditEntries,
  auditEntrySeverityEnum,
  auditEntryOutcomeEnum,
  type AuditEntryRecord,
  type NewAuditEntryRecord,

  // Factory and singleton
  createAuditStore,
  getAuditStore,
  resetAuditStore,

  // Helper functions
  createAuditEntry,
  logSecurityEvent,
} from './db-store.js';
