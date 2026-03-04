/**
 * Compliance Reporting Type Definitions
 *
 * Defines compliance frameworks, controls, assessments, and reporting types
 * for SOC 2 Type II, NIST 800-53, and other regulatory frameworks.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// =============================================================================
// COMPLIANCE PRIORITIES
// =============================================================================

export const CONTROL_PRIORITIES = ['P1', 'P2', 'P3'] as const;
export type ControlPriority = (typeof CONTROL_PRIORITIES)[number];

export const controlPrioritySchema = z.enum(CONTROL_PRIORITIES);

// =============================================================================
// IMPLEMENTATION STATUS
// =============================================================================

export const IMPLEMENTATION_STATUSES = [
  'implemented',
  'partially-implemented',
  'planned',
  'not-applicable',
] as const;
export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

export const implementationStatusSchema = z.enum(IMPLEMENTATION_STATUSES);

// =============================================================================
// FINDING SEVERITY
// =============================================================================

export const FINDING_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const findingSeveritySchema = z.enum(FINDING_SEVERITIES);

// =============================================================================
// EVIDENCE TYPES
// =============================================================================

export const EVIDENCE_TYPES = [
  'log',
  'config',
  'screenshot',
  'document',
  'api-response',
  'test-result',
  'policy',
  'attestation',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);

// =============================================================================
// EVIDENCE
// =============================================================================

/**
 * Evidence supporting a compliance control
 */
export interface Evidence {
  /** Unique identifier for the evidence */
  id: string;
  /** Type of evidence */
  type: EvidenceType;
  /** Human-readable title */
  title: string;
  /** Description of what this evidence demonstrates */
  description: string;
  /** Source of the evidence (system, file path, API, etc.) */
  source: string;
  /** When the evidence was collected */
  collectedAt: Date;
  /** Hash of the evidence content for integrity */
  contentHash?: string;
  /** Reference URL or path */
  reference?: string;
  /** Raw content or summary */
  content?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export const evidenceSchema = z.object({
  id: z.string().min(1),
  type: evidenceTypeSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  source: z.string().min(1),
  collectedAt: z.coerce.date(),
  contentHash: z.string().optional(),
  reference: z.string().optional(),
  content: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// COMPLIANCE CONTROL
// =============================================================================

/**
 * A single compliance control requirement
 */
export interface ComplianceControl {
  /** Control identifier (e.g., 'CC6.1' for SOC 2, 'AC-2' for NIST) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Detailed description of the control requirement */
  description: string;
  /** Control family/category */
  family: string;
  /** Implementation priority */
  priority: ControlPriority;
  /** Current implementation status */
  implementation: ImplementationStatus;
  /** Collected evidence for this control */
  evidence: Evidence[];
  /** Automated test function for continuous monitoring */
  automatedTest?: () => Promise<boolean>;
  /** Related controls from other frameworks */
  crossReferences?: string[];
  /** Control owner/responsible party */
  owner?: string;
  /** Last assessment date */
  lastAssessed?: Date;
  /** Notes from assessors */
  notes?: string;
}

export const complianceControlSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  family: z.string().min(1),
  priority: controlPrioritySchema,
  implementation: implementationStatusSchema,
  evidence: z.array(evidenceSchema),
  crossReferences: z.array(z.string()).optional(),
  owner: z.string().optional(),
  lastAssessed: z.coerce.date().optional(),
  notes: z.string().optional(),
});

// =============================================================================
// COMPLIANCE FRAMEWORK
// =============================================================================

/**
 * A compliance framework definition
 */
export interface ComplianceFramework {
  /** Unique framework identifier */
  id: string;
  /** Framework name (e.g., 'SOC 2 Type II') */
  name: string;
  /** Framework version */
  version: string;
  /** Framework description */
  description?: string;
  /** Controls defined in this framework */
  controls: ComplianceControl[];
  /** Framework effective date */
  effectiveDate?: Date;
  /** Regulatory body or standard organization */
  authority?: string;
}

export const complianceFrameworkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  controls: z.array(complianceControlSchema),
  effectiveDate: z.coerce.date().optional(),
  authority: z.string().optional(),
});

// =============================================================================
// CONTROL ASSESSMENT
// =============================================================================

/**
 * Assessment result for a single control
 */
export interface ControlAssessment {
  /** Control ID being assessed */
  controlId: string;
  /** Control name */
  controlName: string;
  /** Assessment status */
  status: ImplementationStatus;
  /** Whether automated test passed (if applicable) */
  automatedTestPassed?: boolean;
  /** Assessment timestamp */
  assessedAt: Date;
  /** Evidence collected during assessment */
  evidence: Evidence[];
  /** Assessment notes */
  notes?: string;
  /** Gaps identified */
  gaps?: string[];
  /** Risk score (0-100) */
  riskScore?: number;
}

export const controlAssessmentSchema = z.object({
  controlId: z.string().min(1),
  controlName: z.string().min(1),
  status: implementationStatusSchema,
  automatedTestPassed: z.boolean().optional(),
  assessedAt: z.coerce.date(),
  evidence: z.array(evidenceSchema),
  notes: z.string().optional(),
  gaps: z.array(z.string()).optional(),
  riskScore: z.number().min(0).max(100).optional(),
});

// =============================================================================
// FINDING
// =============================================================================

/**
 * A compliance finding or deficiency
 */
export interface Finding {
  /** Unique finding identifier */
  id: string;
  /** Finding title */
  title: string;
  /** Detailed description */
  description: string;
  /** Severity level */
  severity: FindingSeverity;
  /** Related control IDs */
  relatedControls: string[];
  /** When the finding was identified */
  identifiedAt: Date;
  /** Current status */
  status: 'open' | 'in-progress' | 'remediated' | 'accepted';
  /** Remediation plan */
  remediationPlan?: string;
  /** Target remediation date */
  targetRemediationDate?: Date;
  /** Actual remediation date */
  remediatedAt?: Date;
  /** Risk if not remediated */
  riskDescription?: string;
  /** Assigned owner */
  owner?: string;
}

export const findingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: findingSeveritySchema,
  relatedControls: z.array(z.string()),
  identifiedAt: z.coerce.date(),
  status: z.enum(['open', 'in-progress', 'remediated', 'accepted']),
  remediationPlan: z.string().optional(),
  targetRemediationDate: z.coerce.date().optional(),
  remediatedAt: z.coerce.date().optional(),
  riskDescription: z.string().optional(),
  owner: z.string().optional(),
});

// =============================================================================
// COMPLIANCE REPORT
// =============================================================================

/**
 * Report summary statistics
 */
export interface ReportSummary {
  /** Total number of controls assessed */
  totalControls: number;
  /** Number of fully implemented controls */
  implemented: number;
  /** Number of partially implemented controls */
  partiallyImplemented: number;
  /** Number of planned controls */
  planned: number;
  /** Number of not applicable controls */
  notApplicable: number;
  /** Number of automated tests passed */
  automatedTestsPassed: number;
  /** Number of automated tests failed */
  automatedTestsFailed: number;
  /** Overall compliance percentage */
  compliancePercentage: number;
}

export const reportSummarySchema = z.object({
  totalControls: z.number().int().nonnegative(),
  implemented: z.number().int().nonnegative(),
  partiallyImplemented: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
  automatedTestsPassed: z.number().int().nonnegative(),
  automatedTestsFailed: z.number().int().nonnegative(),
  compliancePercentage: z.number().min(0).max(100),
});

/**
 * Complete compliance report
 */
export interface ComplianceReport {
  /** Report ID */
  id: string;
  /** Framework being reported on */
  framework: string;
  /** Framework version */
  frameworkVersion: string;
  /** When the report was generated */
  generatedAt: Date;
  /** Assessment period */
  period: {
    start: Date;
    end: Date;
  };
  /** Summary statistics */
  summary: ReportSummary;
  /** Individual control assessments */
  controls: ControlAssessment[];
  /** Findings identified */
  findings: Finding[];
  /** Recommendations for improvement */
  recommendations: string[];
  /** Report preparer */
  preparedBy?: string;
  /** Report reviewer */
  reviewedBy?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export const complianceReportSchema = z.object({
  id: z.string().min(1),
  framework: z.string().min(1),
  frameworkVersion: z.string().min(1),
  generatedAt: z.coerce.date(),
  period: z.object({
    start: z.coerce.date(),
    end: z.coerce.date(),
  }),
  summary: reportSummarySchema,
  controls: z.array(controlAssessmentSchema),
  findings: z.array(findingSchema),
  recommendations: z.array(z.string()),
  preparedBy: z.string().optional(),
  reviewedBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// =============================================================================
// CONTINUOUS MONITORING
// =============================================================================

/**
 * Monitoring status for a control
 */
export interface MonitoringStatus {
  /** Control ID */
  controlId: string;
  /** Whether monitoring is enabled */
  enabled: boolean;
  /** Last check timestamp */
  lastCheck?: Date;
  /** Last check result */
  lastResult?: boolean;
  /** Check frequency in seconds */
  checkFrequency: number;
  /** Consecutive failures */
  consecutiveFailures: number;
  /** Alert threshold for failures */
  alertThreshold: number;
  /** Whether alert has been triggered */
  alertTriggered: boolean;
}

export const monitoringStatusSchema = z.object({
  controlId: z.string().min(1),
  enabled: z.boolean(),
  lastCheck: z.coerce.date().optional(),
  lastResult: z.boolean().optional(),
  checkFrequency: z.number().int().positive(),
  consecutiveFailures: z.number().int().nonnegative(),
  alertThreshold: z.number().int().positive(),
  alertTriggered: z.boolean(),
});

// =============================================================================
// FRAMEWORK MAPPING
// =============================================================================

/**
 * Mapping between controls in different frameworks
 */
export interface ControlMapping {
  /** Source framework ID */
  sourceFramework: string;
  /** Source control ID */
  sourceControlId: string;
  /** Target framework ID */
  targetFramework: string;
  /** Target control IDs */
  targetControlIds: string[];
  /** Mapping strength (exact, partial, related) */
  mappingType: 'exact' | 'partial' | 'related';
  /** Notes about the mapping */
  notes?: string;
}

export const controlMappingSchema = z.object({
  sourceFramework: z.string().min(1),
  sourceControlId: z.string().min(1),
  targetFramework: z.string().min(1),
  targetControlIds: z.array(z.string()),
  mappingType: z.enum(['exact', 'partial', 'related']),
  notes: z.string().optional(),
});

// =============================================================================
// ASSESSMENT OPTIONS
// =============================================================================

/**
 * Options for running an assessment
 */
export interface AssessmentOptions {
  /** Framework to assess */
  frameworkId: string;
  /** Assessment period start */
  periodStart?: Date;
  /** Assessment period end */
  periodEnd?: Date;
  /** Run automated tests */
  runAutomatedTests?: boolean;
  /** Collect fresh evidence */
  collectEvidence?: boolean;
  /** Control IDs to assess (if empty, assess all) */
  controlIds?: string[];
  /** Include findings from previous assessments */
  includePreviousFindings?: boolean;
}

export const assessmentOptionsSchema = z.object({
  frameworkId: z.string().min(1),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  runAutomatedTests: z.boolean().optional(),
  collectEvidence: z.boolean().optional(),
  controlIds: z.array(z.string()).optional(),
  includePreviousFindings: z.boolean().optional(),
});

// =============================================================================
// COMPLIANCE ENGINE CONFIG
// =============================================================================

/**
 * Configuration for the compliance engine
 */
export interface ComplianceEngineConfig {
  /** Enabled frameworks */
  enabledFrameworks: string[];
  /** Monitoring configuration */
  monitoring: {
    enabled: boolean;
    defaultCheckFrequency: number;
    defaultAlertThreshold: number;
  };
  /** Evidence collection configuration */
  evidence: {
    retentionDays: number;
    autoCollect: boolean;
    hashAlgorithm: 'sha256' | 'sha384' | 'sha512';
  };
  /** Reporting configuration */
  reporting: {
    defaultFormat: 'json' | 'pdf' | 'html';
    includeRawEvidence: boolean;
  };
}

export const complianceEngineConfigSchema = z.object({
  enabledFrameworks: z.array(z.string()),
  monitoring: z.object({
    enabled: z.boolean(),
    defaultCheckFrequency: z.number().int().positive(),
    defaultAlertThreshold: z.number().int().positive(),
  }),
  evidence: z.object({
    retentionDays: z.number().int().positive(),
    autoCollect: z.boolean(),
    hashAlgorithm: z.enum(['sha256', 'sha384', 'sha512']),
  }),
  reporting: z.object({
    defaultFormat: z.enum(['json', 'pdf', 'html']),
    includeRawEvidence: z.boolean(),
  }),
});

export const DEFAULT_COMPLIANCE_ENGINE_CONFIG: ComplianceEngineConfig = {
  enabledFrameworks: ['soc2-type2', 'nist-800-53'],
  monitoring: {
    enabled: true,
    defaultCheckFrequency: 3600, // 1 hour
    defaultAlertThreshold: 3,
  },
  evidence: {
    retentionDays: 365,
    autoCollect: true,
    hashAlgorithm: 'sha256',
  },
  reporting: {
    defaultFormat: 'json',
    includeRawEvidence: false,
  },
};
