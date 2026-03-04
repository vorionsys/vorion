/**
 * Trust Oracle - Vendor Trust Scoring and Third-Party Risk Management
 *
 * A comprehensive service for assessing, monitoring, and managing
 * third-party vendor risk within the Vorion security platform.
 *
 * @module trust-oracle
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // Trust Score Types
  TrustScore,
  TrustGrade,
  TrustTrend,
  TrustFactor,
  TrustFactorCategory,
  DataQualityMetrics,

  // Risk Assessment Types
  RiskAssessment,
  RiskLevel,
  RiskCategory,
  ControlStatus,
  Recommendation,
  RequiredAction,
  AssessorInfo,

  // Vendor Types
  VendorInfo,
  VendorCategory,
  VendorTier,
  VendorStatus,
  VendorContact,
  VendorMetadata,
  ContactPerson,

  // Contract Types
  Contract,
  ContractType,
  ContractStatus,
  ContractValue,
  SLA,
  DataProcessingTerms,
  SecurityRequirement,
  ContractDocument,

  // Compliance Types
  ComplianceCertification,
  ComplianceFramework,
  CertificationStatus,
  CertificationDocument,

  // Monitoring Types
  HealthEvent,
  HealthEventType,
  MonitoringConfig,
  MonitoringCheck,
  MonitoringFrequency,
  AlertThreshold,

  // External Data Types
  SecurityRating,
  SecurityRatingFactor,
  SecurityIssue,
  BreachRecord,
  CertificateInfo,
  SanctionEntry,
  ThreatIntelligence,
  ThreatIndicator,

  // Alert Types
  Alert,
  AlertType,
  AlertSeverity,
  AlertStatus,
  AlertAction,

  // Report Types
  VendorRiskReport,
  ReportType,
  ReportSummary,
  ReportSection,
  ReportAttachment,
  ChartData,
  TableData,

  // API Types
  PaginatedResponse,
  ApiError,
  AuditLogEntry,

  // Observable Types
  Observable,
  Observer,
  Subscription,
} from './types';

// ============================================================================
// Main Oracle Service
// ============================================================================

export {
  TrustOracleService,
  createTrustOracle,
  getDefaultTrustOracleOptions,
  TrustOracleError,
} from './oracle';

export type {
  TrustOracle,
  TrustOracleConfig,
  TrustOracleOptions,
  TrustOracleStorage,
  TrustScoreCache,
} from './oracle';

// ============================================================================
// Vendor Registry
// ============================================================================

export {
  VendorRegistry,
  VendorRegistryError,
} from './vendor-registry';

export type {
  VendorRegistryConfig,
  CreateVendorInput,
  UpdateVendorInput,
  ListVendorsOptions,
  CreateContractInput,
  UpdateContractInput,
  CreateCertificationInput,
  UpdateCertificationInput,
  CertificationVerificationResult,
  SLABreachRecord,
  OnboardingWorkflow,
  OnboardingStep,
  VendorStorage,
  AuditLogger,
  NotificationService,
  WorkflowEngine,
} from './vendor-registry';

// ============================================================================
// Risk Scoring Engine
// ============================================================================

export {
  RiskScorer,
  createRiskScorer,
} from './risk-scorer';

export type {
  RiskScorerConfig,
  FactorWeights,
  IndustryBenchmarks,
  GradeThresholds,
  RiskThresholds,
  TrustScoreInput,
  RiskAssessmentInput,
  FinancialData,
  FinancialEvent,
  SecurityQuestionnaireResult,
  ComplianceGap,
  SLAPerformance,
  UptimeHistory,
  DisasterRecoveryInfo,
  EncryptionPractices,
  AccessControlsInfo,
  NewsSentiment,
  IndustryRanking,
  SecurityControl,
} from './risk-scorer';

// ============================================================================
// Continuous Monitoring
// ============================================================================

export {
  ContinuousMonitoringService,
  createContinuousMonitoringService,
  getDefaultPollingIntervals,
  MonitoringError,
} from './continuous-monitoring';

export type {
  ContinuousMonitoringConfig,
  PollingIntervals,
  MonitoringStatus,
  CheckResult,
  HealthEventQueryOptions,
  HealthEventStats,
  MonitoringStorage,
  AlertDispatcher,
} from './continuous-monitoring';

// ============================================================================
// Data Sources
// ============================================================================

export {
  DataSourceManager,
  DataSource,
  DataSourceError,
  createDataSourceManager,
  getDefaultDataSourceConfig,
} from './data-sources';

export type {
  DataSourceConfig,
  DataSourceType,
  RateLimitConfig,
  CacheConfig,
  RetryConfig,
  DataSourceManagerConfig,
  DataSourceStatus,
  DarkWebMention,
} from './data-sources';

// ============================================================================
// Alert Management
// ============================================================================

export {
  AlertManager,
  createAlertManager,
  getDefaultEscalationPolicies,
  AlertError,
} from './alerts';

export type {
  AlertManagerConfig,
  EscalationPolicy,
  EscalationCondition,
  EscalationAction,
  CreateAlertInput,
  UpdateAlertInput,
  AlertResolution,
  AlertComment,
  ListAlertsOptions,
  AlertStats,
  BreachAlertInput,
  NotificationChannel,
  NotificationPayload,
  SIEMIntegration,
  SIEMEvent,
  SIEMIndicator,
  AlertStorage,
} from './alerts';

// ============================================================================
// Reporting
// ============================================================================

export {
  ReportingService,
  createReportingService,
  ReportingError,
} from './reporting';

export type {
  ReportingServiceConfig,
  ReportDataProviders,
  ReportOptions,
  ListReportsOptions,
  ReportSchedule,
  ExportResult,
  ReportStorage,
  TemplateEngine,
  ExportService,
} from './reporting';

// ============================================================================
// REST API
// ============================================================================

export {
  TrustOracleApiRouter,
  createTrustOracleApi,
  generateOpenApiSpec,
} from './api';

export type {
  TrustOracleApiConfig,
  AuthMiddleware,
  RateLimiter,
  AuthContext,
  ApiRequest,
  ApiResponse,
} from './api';

// ============================================================================
// Module Info
// ============================================================================

export const MODULE_INFO = {
  name: 'trust-oracle',
  version: '1.0.0',
  description: 'Vendor Trust Scoring and Third-Party Risk Management',
  author: 'Vorion Security Platform',
  license: 'MIT',
};

// ============================================================================
// Quick Start Factory
// ============================================================================

import { TrustOracleService, TrustOracleConfig } from './oracle';
import { VendorRegistry } from './vendor-registry';
import { RiskScorer } from './risk-scorer';
import { DataSourceManager, getDefaultDataSourceConfig } from './data-sources';
import { ContinuousMonitoringService, getDefaultPollingIntervals } from './continuous-monitoring';
import { AlertManager, getDefaultEscalationPolicies } from './alerts';
import { ReportingService } from './reporting';
import { TrustOracleApiRouter } from './api';

/**
 * Quick start configuration for Trust Oracle
 * Provides a simplified setup with default configurations
 */
export interface QuickStartConfig {
  // Storage implementations (required)
  vendorStorage: import('./vendor-registry').VendorStorage;
  monitoringStorage: import('./continuous-monitoring').MonitoringStorage;
  alertStorage: import('./alerts').AlertStorage;
  reportStorage: import('./reporting').ReportStorage;
  trustOracleStorage: import('./oracle').TrustOracleStorage;

  // Optional overrides
  dataSourceConfig?: import('./data-sources').DataSourceManagerConfig;
  riskScorerConfig?: Partial<import('./risk-scorer').RiskScorerConfig>;
  alertEscalationPolicies?: import('./alerts').EscalationPolicy[];

  // Services
  auditLogger: import('./vendor-registry').AuditLogger;
  notificationService: import('./vendor-registry').NotificationService;
  workflowEngine: import('./vendor-registry').WorkflowEngine;
  templateEngine: import('./reporting').TemplateEngine;
  exportService: import('./reporting').ExportService;

  // API configuration
  authMiddleware: import('./api').AuthMiddleware;
  rateLimiter: import('./api').RateLimiter;
}

/**
 * Creates a fully configured Trust Oracle system with all components
 */
export function createTrustOracleSystem(config: QuickStartConfig): TrustOracleSystem {
  // Create data source manager
  const dataSourceManager = new DataSourceManager(
    config.dataSourceConfig || getDefaultDataSourceConfig(),
  );

  // Create risk scorer
  const riskScorer = new RiskScorer(config.riskScorerConfig);

  // Create vendor registry
  const vendorRegistry = new VendorRegistry({
    storage: config.vendorStorage,
    auditLogger: config.auditLogger,
    notificationService: config.notificationService,
    workflowEngine: config.workflowEngine,
  });

  // Create alert manager
  const alertManager = new AlertManager({
    storage: config.alertStorage,
    notificationChannels: [],
    escalationPolicies: config.alertEscalationPolicies || getDefaultEscalationPolicies(),
    deduplicationWindow: 3600000, // 1 hour
    autoResolveEnabled: true,
  });

  // Create alert dispatcher for monitoring service
  const alertDispatcher: import('./continuous-monitoring').AlertDispatcher = {
    async dispatchIfNeeded(event) {
      if (event.severity === 'critical' || event.severity === 'error') {
        const vendor = await vendorRegistry.getVendor(event.vendorId);
        await alertManager.createAlertFromHealthEvent(event, vendor);
      }
    },
  };

  // Create monitoring service
  const monitoringService = new ContinuousMonitoringService({
    dataSourceManager,
    storage: config.monitoringStorage,
    alertDispatcher,
    defaultPollingIntervals: getDefaultPollingIntervals(),
    enabledChecks: [
      'security_posture',
      'certificates',
      'dns',
      'breaches',
      'dark_web',
      'sanctions',
    ],
  });

  // Trust oracle placeholder for lazy initialization
  let trustOracleInstance: TrustOracleService | null = null;
  const getTrustOracle = (): TrustOracleService => {
    if (!trustOracleInstance) {
      throw new Error('Trust oracle not initialized');
    }
    return trustOracleInstance;
  };

  // Create reporting service with lazy trust oracle access
  const reportingService: ReportingService = new ReportingService({
    storage: config.reportStorage,
    auditLogger: config.auditLogger,
    templateEngine: config.templateEngine,
    exportService: config.exportService,
    dataProviders: {
      getVendorInfo: (vendorId) => vendorRegistry.getVendor(vendorId),
      getTrustScore: (vendorId) => getTrustOracle().getVendorTrustScore(vendorId),
      getTrustScoreHistory: (vendorId, days) => getTrustOracle().getTrustScoreHistory(vendorId, days),
      getRiskAssessment: async (vendorId) => {
        const vendor = await vendorRegistry.getVendor(vendorId);
        return getTrustOracle().assessThirdPartyRisk(vendor);
      },
      getCertifications: (vendorId) => vendorRegistry.getVendorCertifications(vendorId),
      getContracts: (vendorId) => vendorRegistry.getVendorContracts(vendorId),
      getAlerts: (vendorId, days) => alertManager.getVendorAlerts(vendorId, {
        startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      }),
      getHealthEvents: (vendorId, days) => monitoringService.getHealthEvents(vendorId, {
        startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      }),
    },
  });

  // Create cache implementation
  const cacheStore = new Map<string, { score: import('./types').TrustScore; expiresAt: number }>();
  const cache: import('./oracle').TrustScoreCache = {
    get(key: string) {
      const entry = cacheStore.get(key);
      if (!entry || Date.now() > entry.expiresAt) {
        cacheStore.delete(key);
        return null;
      }
      return entry.score;
    },
    set(key: string, score: import('./types').TrustScore, ttlSeconds: number) {
      cacheStore.set(key, {
        score,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    },
    invalidate(key: string) {
      cacheStore.delete(key);
    },
    clear() {
      cacheStore.clear();
    },
  };

  // Create trust oracle
  trustOracleInstance = new TrustOracleService({
    vendorRegistry,
    riskScorer,
    dataSourceManager,
    monitoringService,
    alertManager,
    reportingService,
    storage: config.trustOracleStorage,
    cache,
    options: {
      cacheEnabled: true,
      cacheTTLSeconds: 3600,
      autoMonitoringEnabled: true,
      alertOnScoreDegradation: true,
      degradationThreshold: 10,
      parallelDataFetching: true,
    },
  });
  const trustOracle: TrustOracleService = trustOracleInstance;

  // Create API router
  const apiRouter = new TrustOracleApiRouter({
    trustOracle,
    vendorRegistry,
    alertManager,
    reportingService,
    monitoringService,
    authMiddleware: config.authMiddleware,
    rateLimiter: config.rateLimiter,
  });

  return {
    trustOracle,
    vendorRegistry,
    riskScorer,
    dataSourceManager,
    monitoringService,
    alertManager,
    reportingService,
    apiRouter,
  };
}

/**
 * Complete Trust Oracle system with all components
 */
export interface TrustOracleSystem {
  trustOracle: TrustOracleService;
  vendorRegistry: VendorRegistry;
  riskScorer: RiskScorer;
  dataSourceManager: DataSourceManager;
  monitoringService: ContinuousMonitoringService;
  alertManager: AlertManager;
  reportingService: ReportingService;
  apiRouter: TrustOracleApiRouter;
}
