/**
 * FedRAMP Continuous Monitoring (ConMon) Module
 *
 * Comprehensive FedRAMP compliance capabilities including:
 * - Continuous Monitoring (ConMon) service
 * - NIST 800-53 Rev 5 control implementation
 * - POA&M (Plan of Action & Milestones) management
 * - System boundary documentation
 * - Incident reporting (US-CERT compliant)
 * - 3PAO assessment support
 * - FedRAMP metrics and dashboards
 * - SSP (System Security Plan) generation
 *
 * @packageDocumentation
 */

// =============================================================================
// CONTINUOUS MONITORING
// =============================================================================

export {
  ContinuousMonitoringService,
  // Types
  type VulnerabilitySeverity,
  type ScanType,
  type AssessmentType,
  type VulnerabilityFinding,
  type ScanResult,
  type ScheduledAssessment,
  type ConMonConfig,
  type ScannerConfig,
  type ConMonStatusReport,
  // Constants
  VULNERABILITY_SEVERITIES,
  SCAN_TYPES,
  ASSESSMENT_TYPES,
  FEDRAMP_REMEDIATION_TIMEFRAMES,
  // Schemas
  vulnerabilityFindingSchema,
  scanResultSchema,
  scheduledAssessmentSchema,
} from './continuous-monitoring.js';

// =============================================================================
// CONTROLS
// =============================================================================

export {
  // Framework
  fedrampModerateFramework,
  fedrampModerateControls,
  // Types
  type FedRAMPControl,
  type ControlResponsibility,
  type ControlOrigination,
  type ImpactLevel,
  type ControlAssessmentProcedure,
  type ControlParameter,
  // Utility Functions
  getControlsByFamily,
  getControlById,
  getControlsByResponsibility,
  getControlsByStatus,
  getAutomatedControls,
  calculateImplementationPercentage,
  getControlFamiliesSummary,
  // Constants
  CONTROL_RESPONSIBILITIES,
  CONTROL_ORIGINATIONS,
  IMPACT_LEVELS,
} from './controls.js';

// =============================================================================
// POA&M
// =============================================================================

export {
  POAMService,
  // Types
  type POAMStatus,
  type WeaknessSource,
  type RiskLevel,
  type DeviationType,
  type DeviationStatus,
  type POAMMilestone,
  type POAMItem,
  type POAMComment,
  type DeviationRequest,
  type POAMConfig,
  type POAMSummaryStatistics,
  type POAMReport,
  // Constants
  POAM_STATUSES,
  WEAKNESS_SOURCES,
  RISK_LEVELS,
  DEVIATION_TYPES,
  DEVIATION_STATUSES,
  // Schemas
  milestoneSchema,
  poamItemSchema,
  deviationRequestSchema,
} from './poam.js';

// =============================================================================
// BOUNDARY
// =============================================================================

export {
  BoundaryService,
  // Types
  type ComponentType,
  type ComponentStatus,
  type DataClassification,
  type ConnectionType,
  type InterconnectionType,
  type ExternalServiceType,
  type SystemComponent,
  type DataFlow,
  type NetworkZone,
  type SystemInterconnection,
  type ExternalService,
  type DiagramMetadata,
  type BoundaryConfig,
  type BoundaryInventorySummary,
  type SSPBoundaryDocumentation,
  // Constants
  COMPONENT_TYPES,
  COMPONENT_STATUSES,
  DATA_CLASSIFICATIONS,
  CONNECTION_TYPES,
  INTERCONNECTION_TYPES,
  EXTERNAL_SERVICE_TYPES,
  // Schemas
  systemComponentSchema,
  dataFlowSchema,
  networkZoneSchema,
  systemInterconnectionSchema,
  externalServiceSchema,
  diagramMetadataSchema,
} from './boundary.js';

// =============================================================================
// INCIDENT REPORTING
// =============================================================================

export {
  IncidentReportingService,
  // Types
  type IncidentCategory,
  type IncidentStatus,
  type NotificationRecipient,
  type EvidenceType,
  type PreservedEvidence,
  type IncidentNotification,
  type SecurityIncident,
  type IncidentReportingConfig,
  type IncidentMonthlyReport,
  type USCERTIncidentReport,
  // Constants
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_DEFINITIONS,
  INCIDENT_STATUSES,
  NOTIFICATION_RECIPIENTS,
  EVIDENCE_TYPES,
  // Schemas
  preservedEvidenceSchema,
  incidentNotificationSchema,
  securityIncidentSchema,
} from './incident-reporting.js';

// =============================================================================
// ASSESSMENT
// =============================================================================

export {
  AssessmentService,
  // Types
  type AssessmentType as AssessmentServiceType,
  type AssessmentStatus,
  type FindingStatus,
  type FindingRiskLevel,
  type PackageDocumentType,
  type ThirdPartyAssessor,
  type AssessmentFinding,
  type ControlTestResult,
  type SecurityAssessmentReport,
  type PackageDocument,
  type PreparationChecklistItem,
  type AssessmentConfig,
  type AuthorizationPackageStatus,
  // Constants
  ASSESSMENT_TYPES as ASSESSMENT_SERVICE_TYPES,
  ASSESSMENT_STATUSES,
  FINDING_STATUSES,
  FINDING_RISK_LEVELS,
  PACKAGE_DOCUMENT_TYPES,
  // Schemas
  assessmentFindingSchema,
  controlTestResultSchema,
  packageDocumentSchema,
} from './assessment.js';

// =============================================================================
// METRICS
// =============================================================================

export {
  MetricsService,
  // Types
  type TimePeriod,
  type TrendDirection,
  type VulnerabilityAgingMetrics,
  type POAMMetrics,
  type ControlImplementationMetrics,
  type ScanComplianceMetrics,
  type ConMonDashboardMetrics,
  type MetricDataPoint,
  type MetricsConfig,
  // Constants
  TIME_PERIODS,
  TREND_DIRECTIONS,
} from './metrics.js';

// =============================================================================
// SSP GENERATOR
// =============================================================================

export {
  SSPGeneratorService,
  // Types
  type SSPSection,
  type SystemInformation,
  type SSPUserType,
  type ControlImplementationStatement,
  type ExportFormat,
  type SSPGeneratorConfig,
  type SystemSecurityPlan,
  type SSPSummaryReport,
  type OSCALSystemSecurityPlan,
  // Constants
  SSP_SECTIONS,
  EXPORT_FORMATS,
} from './ssp-generator.js';

// =============================================================================
// CONVENIENCE FACTORY FUNCTIONS
// =============================================================================

import { ContinuousMonitoringService, type ConMonConfig } from './continuous-monitoring.js';
import { POAMService, type POAMConfig } from './poam.js';
import { BoundaryService, type BoundaryConfig } from './boundary.js';
import { IncidentReportingService, type IncidentReportingConfig } from './incident-reporting.js';
import { AssessmentService, type AssessmentConfig } from './assessment.js';
import { MetricsService, type MetricsConfig } from './metrics.js';
import { SSPGeneratorService, type SSPGeneratorConfig } from './ssp-generator.js';

/**
 * FedRAMP module configuration
 */
export interface FedRAMPModuleConfig {
  /** System name */
  systemName: string;
  /** Organization name */
  organizationName: string;
  /** FedRAMP package ID */
  fedrampPackageId?: string;
  /** Authorization level */
  authorizationLevel: 'low' | 'moderate' | 'high';
  /** ATO date */
  atoDate: Date;
  /** ATO expiration date */
  atoExpirationDate: Date;
  /** ISSO contact */
  isso: { name: string; email: string; phone?: string };
  /** System owner */
  systemOwner: { name: string; email: string };
  /** Authorizing official */
  authorizingOfficial?: { name: string; email: string };
}

/**
 * Create a complete FedRAMP compliance module
 */
export function createFedRAMPModule(config: FedRAMPModuleConfig): {
  conmon: ContinuousMonitoringService;
  poam: POAMService;
  boundary: BoundaryService;
  incidents: IncidentReportingService;
  assessment: AssessmentService;
  metrics: MetricsService;
  sspGenerator: SSPGeneratorService;
} {
  const conmonConfig: ConMonConfig = {
    organizationName: config.organizationName,
    systemName: config.systemName,
    authorizationLevel: config.authorizationLevel,
    atoDate: config.atoDate,
    atoExpirationDate: config.atoExpirationDate,
    remediationTimeframes: {
      critical: config.authorizationLevel === 'high' ? 15 : 30,
      high: 30,
      moderate: 90,
      low: 180,
    },
    scanners: [],
    notifications: {
      enabled: true,
      emailRecipients: [config.isso.email],
      scanCompletionNotify: true,
      overdueNotify: true,
      overdueDaysThreshold: 7,
    },
  };

  const poamConfig: POAMConfig = {
    organizationName: config.organizationName,
    systemName: config.systemName,
    isso: config.isso,
    systemOwner: config.systemOwner,
    authorizingOfficial: config.authorizingOfficial || config.systemOwner,
    idPrefix: 'POAM',
    autoCalculateOverdue: true,
    upcomingDeadlineThreshold: 14,
  };

  const boundaryConfig: BoundaryConfig = {
    systemName: config.systemName,
    organizationName: config.organizationName,
    boundaryDescription: `Authorization boundary for ${config.systemName}`,
    authorizationLevel: config.authorizationLevel,
    primaryDataCenter: 'Primary Data Center',
  };

  const incidentConfig: IncidentReportingConfig = {
    organizationName: config.organizationName,
    systemName: config.systemName,
    fedrampPackageId: config.fedrampPackageId || 'PENDING',
    isso: { ...config.isso, phone: config.isso.phone || '' },
    ciso: { ...config.isso, phone: config.isso.phone || '' },
    usCertPoc: { name: 'US-CERT', email: 'soc@cisa.gov', phone: '888-282-0870' },
    fedrampPmoPoc: { name: 'FedRAMP PMO', email: 'info@fedramp.gov' },
    evidenceRetentionDays: 365,
    autoEscalation: true,
  };

  const assessmentConfig: AssessmentConfig = {
    systemName: config.systemName,
    organizationName: config.organizationName,
    fedrampPackageId: config.fedrampPackageId,
    authorizationLevel: config.authorizationLevel,
    isso: config.isso,
    systemOwner: config.systemOwner,
  };

  const metricsConfig: MetricsConfig = {
    systemName: config.systemName,
    atoDate: config.atoDate,
    atoExpirationDate: config.atoExpirationDate,
    authorizationLevel: config.authorizationLevel,
    remediationSLAs: {
      critical: config.authorizationLevel === 'high' ? 15 : 30,
      high: 30,
      moderate: 90,
      low: 180,
    },
    monthlyScanRequirementDay: 15,
    trackHistory: true,
  };

  const sspConfig: SSPGeneratorConfig = {
    templateVersion: 'Rev 5',
    includeAppendices: true,
    includeDiagrams: true,
    defaultExportFormat: 'json',
  };

  return {
    conmon: new ContinuousMonitoringService(conmonConfig),
    poam: new POAMService(poamConfig),
    boundary: new BoundaryService(boundaryConfig),
    incidents: new IncidentReportingService(incidentConfig),
    assessment: new AssessmentService(assessmentConfig),
    metrics: new MetricsService(metricsConfig),
    sspGenerator: new SSPGeneratorService(sspConfig),
  };
}

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export default {
  ContinuousMonitoringService,
  POAMService,
  BoundaryService,
  IncidentReportingService,
  AssessmentService,
  MetricsService,
  SSPGeneratorService,
  createFedRAMPModule,
};
