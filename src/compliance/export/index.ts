/**
 * Compliance Evidence Export
 *
 * Provides functionality for exporting compliance evidence to external auditors.
 * Includes evidence collection, tamper-evident hashing, and report generation.
 *
 * @packageDocumentation
 */

// =============================================================================
// EVIDENCE COLLECTOR
// =============================================================================

export {
  // Main class
  EvidenceCollector,
  getEvidenceCollector,
  resetEvidenceCollector,

  // Types
  type EvidenceCollectionFilter,
  type CollectedAuditEvent,
  type CollectedPolicyChange,
  type CollectedAccessDecision,
  type CollectedTrustScoreChange,
  type CollectedEscalationDecision,
  type CollectedDataRetentionLog,
  type EvidenceCollection,
  type EvidenceEventType,

  // Constants
  EVIDENCE_EVENT_TYPES,
} from './evidence-collector.js';

// =============================================================================
// HASH VERIFIER
// =============================================================================

export {
  // Main class
  HashVerifier,
  getHashVerifier,
  resetHashVerifier,
  createHashVerifier,

  // Types
  type EvidenceHash,
  type EvidenceMerkleProof,
  type EvidenceSignature,
  type TamperEvidentPackage,
  type VerificationInstructions,
  type HashVerifierConfig,
} from './hash-verifier.js';

// =============================================================================
// REPORT GENERATOR
// =============================================================================

export {
  // Main class
  ReportGenerator,
  getReportGenerator,
  resetReportGenerator,

  // Types
  type ExportFormat,
  type ReportGenerationOptions,
  type ReportHeader,
  type ExecutiveSummary,
  type ComplianceEvidenceReport,
  type ReportSection,
  type ExportJobStatus,
  type ExportJob,
} from './report-generator.js';

// =============================================================================
// SCHEDULED EXPORTS
// =============================================================================

export {
  // Main class
  ScheduledExportManager,
  getScheduledExportManager,
  resetScheduledExportManager,

  // Types
  type ScheduledExportConfig,
  type ExportSchedule,
  type ExportDestination,
  type S3Destination,
  type EmailDestination,
  type WebhookDestination,
  type ScheduledExportJob,
  type ExportDeliveryResult,
} from './scheduled-exports.js';

// =============================================================================
// COMPLIANCE EXPORT SERVICE
// =============================================================================

export {
  // Main service
  ComplianceExportService,
  getComplianceExportService,
  resetComplianceExportService,

  // Types
  type ExportRequest,
  type ExportResult,
  type ComplianceStatusSummary,
  type EventSummary,
} from './service.js';
