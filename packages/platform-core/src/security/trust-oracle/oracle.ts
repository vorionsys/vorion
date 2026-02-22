/**
 * Trust Oracle Service
 * Main service for vendor trust scoring and third-party risk assessment
 */

import {
  TrustScore,
  TrustFactor,
  RiskAssessment,
  VendorInfo,
  HealthEvent,
  Observable,
  Observer,
  Subscription,
  ComplianceCertification,
  Contract,
  SecurityRating,
  BreachRecord,
} from './types.js';
import { VendorRegistry } from './vendor-registry.js';
import { RiskScorer, TrustScoreInput, RiskAssessmentInput } from './risk-scorer.js';
import { DataSourceManager } from './data-sources.js';
import { ContinuousMonitoringService, MonitoringStorage } from './continuous-monitoring.js';
import { AlertManager, CreateAlertInput } from './alerts.js';
import { ReportingService } from './reporting.js';

// ============================================================================
// Trust Oracle Interface
// ============================================================================

export interface TrustOracle {
  // Core trust scoring
  getVendorTrustScore(vendorId: string): Promise<TrustScore>;
  getEntityTrustScore(entityId: string, entityType: string): Promise<TrustScore>;

  // Risk assessment
  assessThirdPartyRisk(vendor: VendorInfo): Promise<RiskAssessment>;

  // Monitoring
  monitorVendorHealth(vendorId: string): Observable<HealthEvent>;
}

// ============================================================================
// Trust Oracle Configuration
// ============================================================================

export interface TrustOracleConfig {
  vendorRegistry: VendorRegistry;
  riskScorer: RiskScorer;
  dataSourceManager: DataSourceManager;
  monitoringService: ContinuousMonitoringService;
  alertManager: AlertManager;
  reportingService: ReportingService;
  storage: TrustOracleStorage;
  cache: TrustScoreCache;
  options: TrustOracleOptions;
}

export interface TrustOracleOptions {
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  autoMonitoringEnabled: boolean;
  alertOnScoreDegradation: boolean;
  degradationThreshold: number;
  parallelDataFetching: boolean;
}

export interface TrustOracleStorage {
  saveTrustScore(vendorId: string, score: TrustScore): Promise<void>;
  getTrustScore(vendorId: string): Promise<TrustScore | null>;
  getTrustScoreHistory(vendorId: string, limit: number): Promise<TrustScore[]>;
  saveRiskAssessment(vendorId: string, assessment: RiskAssessment): Promise<void>;
  getRiskAssessment(vendorId: string): Promise<RiskAssessment | null>;
}

export interface TrustScoreCache {
  get(key: string): TrustScore | null;
  set(key: string, score: TrustScore, ttlSeconds: number): void;
  invalidate(key: string): void;
  clear(): void;
}

// ============================================================================
// Trust Oracle Service Implementation
// ============================================================================

export class TrustOracleService implements TrustOracle {
  private readonly config: TrustOracleConfig;
  private readonly healthSubscribers: Map<string, Set<Observer<HealthEvent>>> = new Map();

  constructor(config: TrustOracleConfig) {
    this.config = config;
  }

  // ============================================================================
  // Trust Score Methods
  // ============================================================================

  async getVendorTrustScore(vendorId: string): Promise<TrustScore> {
    // Check cache first
    if (this.config.options.cacheEnabled) {
      const cached = this.config.cache.get(`trust:${vendorId}`);
      if (cached && this.isScoreValid(cached)) {
        return cached;
      }
    }

    // Get vendor information
    const vendor = await this.config.vendorRegistry.getVendor(vendorId);

    // Gather all data for scoring
    const scoreInput = await this.gatherScoreInput(vendorId, vendor);

    // Calculate trust score
    const trustScore = await this.config.riskScorer.calculateTrustScore(scoreInput);

    // Check for score degradation
    await this.checkScoreDegradation(vendorId, vendor, trustScore);

    // Store and cache the score
    await this.config.storage.saveTrustScore(vendorId, trustScore);

    if (this.config.options.cacheEnabled) {
      this.config.cache.set(
        `trust:${vendorId}`,
        trustScore,
        this.config.options.cacheTTLSeconds,
      );
    }

    return trustScore;
  }

  async getEntityTrustScore(entityId: string, entityType: string): Promise<TrustScore> {
    // Handle different entity types
    switch (entityType) {
      case 'vendor':
        return this.getVendorTrustScore(entityId);

      case 'subsidiary':
        // Get parent vendor and assess subsidiary
        const parentVendor = await this.findParentVendor(entityId);
        if (parentVendor) {
          return this.assessSubsidiaryTrust(entityId, parentVendor);
        }
        throw new TrustOracleError('ENTITY_NOT_FOUND', `Subsidiary ${entityId} not found`);

      case 'subcontractor':
        // Assess subcontractor through vendor relationship
        return this.assessSubcontractorTrust(entityId);

      default:
        throw new TrustOracleError('INVALID_ENTITY_TYPE', `Unknown entity type: ${entityType}`);
    }
  }

  async getTrustScoreHistory(vendorId: string, limit: number = 100): Promise<TrustScore[]> {
    return this.config.storage.getTrustScoreHistory(vendorId, limit);
  }

  async compareTrustScores(vendorIds: string[]): Promise<TrustScoreComparison> {
    const scores = await Promise.all(
      vendorIds.map(async (id) => ({
        vendorId: id,
        score: await this.getVendorTrustScore(id),
      })),
    );

    const sortedByScore = [...scores].sort((a, b) => b.score.score - a.score.score);
    const avgScore = scores.reduce((sum, s) => sum + s.score.score, 0) / scores.length;

    return {
      vendors: scores,
      ranking: sortedByScore.map(s => s.vendorId),
      averageScore: avgScore,
      highestScore: sortedByScore[0],
      lowestScore: sortedByScore[sortedByScore.length - 1],
      comparisonDate: new Date(),
    };
  }

  // ============================================================================
  // Risk Assessment Methods
  // ============================================================================

  async assessThirdPartyRisk(vendor: VendorInfo): Promise<RiskAssessment> {
    // Check for existing recent assessment
    const existingAssessment = await this.config.storage.getRiskAssessment(vendor.id);
    if (existingAssessment && this.isAssessmentValid(existingAssessment)) {
      return existingAssessment;
    }

    // Gather assessment input
    const assessmentInput = await this.gatherAssessmentInput(vendor.id, vendor);

    // Perform risk assessment
    const assessment = await this.config.riskScorer.assessRisk(assessmentInput);

    // Store assessment
    await this.config.storage.saveRiskAssessment(vendor.id, assessment);

    // Create alerts for critical findings
    await this.createAssessmentAlerts(vendor, assessment);

    return assessment;
  }

  async assessMultipleVendors(vendorIds: string[]): Promise<Map<string, RiskAssessment>> {
    const assessments = new Map<string, RiskAssessment>();

    const results = await Promise.allSettled(
      vendorIds.map(async (id) => {
        const vendor = await this.config.vendorRegistry.getVendor(id);
        const assessment = await this.assessThirdPartyRisk(vendor);
        return { id, assessment };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        assessments.set(result.value.id, result.value.assessment);
      }
    }

    return assessments;
  }

  async getConcentrationRisk(): Promise<ConcentrationRiskAnalysis> {
    // Analyze risk concentration across vendor portfolio
    const vendors = await this.config.vendorRegistry.listVendors({ pageSize: 1000 });

    const assessments = await this.assessMultipleVendors(vendors.data.map(v => v.id));

    const categoryConcentration: Record<string, number> = {};
    const tierConcentration: Record<string, number> = {};
    const riskConcentration: Record<string, number> = {};

    for (const vendor of vendors.data) {
      categoryConcentration[vendor.category] = (categoryConcentration[vendor.category] || 0) + 1;
      tierConcentration[vendor.tier] = (tierConcentration[vendor.tier] || 0) + 1;

      const assessment = assessments.get(vendor.id);
      if (assessment) {
        riskConcentration[assessment.overallRisk] = (riskConcentration[assessment.overallRisk] || 0) + 1;
      }
    }

    return {
      totalVendors: vendors.data.length,
      categoryConcentration,
      tierConcentration,
      riskConcentration,
      topConcentrationRisks: this.identifyConcentrationRisks(categoryConcentration),
      analysisDate: new Date(),
    };
  }

  // ============================================================================
  // Monitoring Methods
  // ============================================================================

  monitorVendorHealth(vendorId: string): Observable<HealthEvent> {
    return {
      subscribe: (observer: Observer<HealthEvent>): Subscription => {
        // Register subscriber
        if (!this.healthSubscribers.has(vendorId)) {
          this.healthSubscribers.set(vendorId, new Set());
        }
        this.healthSubscribers.get(vendorId)!.add(observer);

        // Start monitoring if not already running
        this.ensureMonitoringStarted(vendorId).catch(console.error);

        return {
          unsubscribe: () => {
            this.healthSubscribers.get(vendorId)?.delete(observer);
          },
        };
      },
    };
  }

  async startVendorMonitoring(vendorId: string): Promise<void> {
    const vendor = await this.config.vendorRegistry.getVendor(vendorId);

    await this.config.monitoringService.startMonitoring(vendorId, {
      vendorId,
      enabled: true,
      frequency: this.getMonitoringFrequency(vendor.tier),
      checks: this.getMonitoringChecks(vendor.tier),
      alertThresholds: this.getAlertThresholds(vendor.tier),
      notificationChannels: [],
    });
  }

  async stopVendorMonitoring(vendorId: string): Promise<void> {
    await this.config.monitoringService.stopMonitoring(vendorId);
  }

  async getMonitoringStatus(vendorId: string): Promise<MonitoringStatus> {
    const status = this.config.monitoringService.getMonitoringStatus(vendorId);

    if (!status) {
      return {
        vendorId,
        isMonitored: false,
        lastCheck: null,
        healthScore: null,
        activeAlerts: 0,
      };
    }

    const activeAlerts = await this.config.alertManager.getVendorAlerts(vendorId, {
      statuses: ['open', 'acknowledged'],
    });

    return {
      vendorId,
      isMonitored: status.running,
      lastCheck: status.lastActivity,
      healthScore: await this.calculateHealthScore(vendorId),
      activeAlerts: activeAlerts.length,
    };
  }

  // ============================================================================
  // Data Gathering
  // ============================================================================

  private async gatherScoreInput(vendorId: string, vendor: VendorInfo): Promise<TrustScoreInput> {
    const dataManager = this.config.dataSourceManager;

    // Fetch data in parallel if enabled
    if (this.config.options.parallelDataFetching) {
      const [
        securityRatings,
        certifications,
        breachRecords,
        healthEvents,
        contracts,
        sanctions,
        threatIntel,
        darkWebMentions,
      ] = await Promise.all([
        dataManager.getSecurityRatings(vendor.domain).catch(() => []),
        this.config.vendorRegistry.getVendorCertifications(vendorId).catch(() => []),
        dataManager.getBreachRecords(vendor.domain).catch(() => []),
        this.config.monitoringService.getHealthEvents(vendorId, { limit: 100 }).catch(() => []),
        this.config.vendorRegistry.getVendorContracts(vendorId).catch(() => []),
        dataManager.checkSanctions(vendor.legalName, 'company').catch(() => []),
        dataManager.getThreatIntelligence(vendor.domain).catch(() => []),
        dataManager.scanDarkWeb(vendor.domain).catch(() => []),
      ]);

      return {
        vendorId,
        vendor,
        securityRatings,
        certifications,
        breachRecords,
        securityIncidents: healthEvents.filter(e => e.type === 'security_incident'),
        slaPerformance: this.extractSLAPerformance(contracts),
        sanctionsMatches: sanctions.map(s => ({ source: s.source, matchScore: s.matchScore })),
        darkWebMentions: darkWebMentions.map(m => ({
          mentionType: m.mentionType,
          discoveredAt: m.discoveredAt,
          confidence: m.confidence,
        })),
        dataProcessingTerms: this.extractDataProcessingTerms(contracts),
        securityRequirements: this.extractSecurityRequirements(contracts),
      };
    } else {
      // Sequential fetching for lower resource usage
      const securityRatings = await dataManager.getSecurityRatings(vendor.domain).catch(() => []);
      const certifications = await this.config.vendorRegistry.getVendorCertifications(vendorId).catch(() => []);
      const breachRecords = await dataManager.getBreachRecords(vendor.domain).catch(() => []);
      const contracts = await this.config.vendorRegistry.getVendorContracts(vendorId).catch(() => []);

      return {
        vendorId,
        vendor,
        securityRatings,
        certifications,
        breachRecords,
        slaPerformance: this.extractSLAPerformance(contracts),
        dataProcessingTerms: this.extractDataProcessingTerms(contracts),
        securityRequirements: this.extractSecurityRequirements(contracts),
      };
    }
  }

  private async gatherAssessmentInput(
    vendorId: string,
    vendor: VendorInfo,
  ): Promise<RiskAssessmentInput> {
    // Build on score input
    const scoreInput = await this.gatherScoreInput(vendorId, vendor);

    // Add additional assessment-specific data
    const contracts = await this.config.vendorRegistry.getVendorContracts(vendorId);

    return {
      ...scoreInput,
      securityControls: await this.gatherSecurityControls(vendorId),
      contractualAuditRights: this.checkAuditRights(contracts),
    };
  }

  private async gatherSecurityControls(vendorId: string): Promise<SecurityControl[]> {
    // In production, this would gather actual control evidence
    return [];
  }

  private extractSLAPerformance(contracts: Contract[]): SLAPerformance[] {
    const slaPerformance: SLAPerformance[] = [];

    for (const contract of contracts) {
      for (const sla of contract.slas) {
        slaPerformance.push({
          name: sla.name,
          target: sla.target,
          actual: sla.currentPerformance || sla.target,
          breachCount: sla.breachCount,
        });
      }
    }

    return slaPerformance;
  }

  private extractDataProcessingTerms(contracts: Contract[]): DataProcessingTermsInput | undefined {
    const dpa = contracts.find(c => c.dataProcessingTerms);
    if (!dpa?.dataProcessingTerms) return undefined;

    return {
      dataSubjectRights: dpa.dataProcessingTerms.dataSubjectRights,
      breachNotificationHours: dpa.dataProcessingTerms.breachNotificationHours,
      transferMechanisms: dpa.dataProcessingTerms.transferMechanisms,
    };
  }

  private extractSecurityRequirements(contracts: Contract[]): SecurityRequirementInput[] {
    const requirements: SecurityRequirementInput[] = [];

    for (const contract of contracts) {
      for (const req of contract.securityRequirements) {
        requirements.push({
          priority: req.priority,
          verified: req.verified,
        });
      }
    }

    return requirements;
  }

  private checkAuditRights(contracts: Contract[]): AuditRightsInfo {
    // Check if any contract has audit rights
    const hasAuditRights = contracts.some(c =>
      c.securityRequirements.some(r =>
        r.requirement.toLowerCase().includes('audit'),
      ),
    );

    return {
      exists: hasAuditRights,
      exercised: false, // Would be tracked separately
    };
  }

  // ============================================================================
  // Score Validation and Alerts
  // ============================================================================

  private isScoreValid(score: TrustScore): boolean {
    return score.validUntil > new Date();
  }

  private isAssessmentValid(assessment: RiskAssessment): boolean {
    return assessment.validUntil > new Date();
  }

  private async checkScoreDegradation(
    vendorId: string,
    vendor: VendorInfo,
    newScore: TrustScore,
  ): Promise<void> {
    if (!this.config.options.alertOnScoreDegradation) return;

    const history = await this.config.storage.getTrustScoreHistory(vendorId, 1);
    if (history.length === 0) return;

    const previousScore = history[0];
    const degradation = previousScore.score - newScore.score;

    if (degradation >= this.config.options.degradationThreshold) {
      await this.config.alertManager.createTrustScoreDegradationAlert(
        vendorId,
        vendor,
        previousScore,
        newScore,
      );
    }
  }

  private async createAssessmentAlerts(
    vendor: VendorInfo,
    assessment: RiskAssessment,
  ): Promise<void> {
    // Alert for critical risk level
    if (assessment.overallRisk === 'critical') {
      await this.config.alertManager.createAlert({
        vendorId: vendor.id,
        type: 'security_incident',
        severity: 'critical',
        title: `Critical risk level for vendor ${vendor.name}`,
        description: `Risk assessment indicates critical risk level. Immediate action required.`,
        source: 'trust_oracle',
        metadata: {
          assessmentId: assessment.assessmentId,
          riskScore: assessment.riskScore,
          categories: assessment.categories.filter(c => c.risk === 'critical').map(c => c.name),
        },
      });
    }

    // Alert for required actions with urgent deadlines
    const urgentActions = assessment.requiredActions.filter(a => {
      const daysUntilDeadline = (a.deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return daysUntilDeadline <= 7 && a.status === 'pending';
    });

    for (const action of urgentActions) {
      await this.config.alertManager.createAlert({
        vendorId: vendor.id,
        type: 'compliance_expiration',
        severity: 'error',
        title: `Urgent action required: ${action.action}`,
        description: `Action deadline: ${action.deadline.toISOString().split('T')[0]}. ${action.reason}`,
        source: 'trust_oracle',
        metadata: {
          actionId: action.id,
          deadline: action.deadline,
        },
      });
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async findParentVendor(subsidiaryId: string): Promise<VendorInfo | null> {
    const vendors = await this.config.vendorRegistry.listVendors({ pageSize: 1000 });

    for (const vendor of vendors.data) {
      if (vendor.metadata.subsidiaries?.includes(subsidiaryId)) {
        return vendor;
      }
    }

    return null;
  }

  private async assessSubsidiaryTrust(
    subsidiaryId: string,
    parentVendor: VendorInfo,
  ): Promise<TrustScore> {
    // Start with parent vendor score
    const parentScore = await this.getVendorTrustScore(parentVendor.id);

    // Apply subsidiary-specific adjustments
    const adjustedScore: TrustScore = {
      ...parentScore,
      score: parentScore.score * 0.9, // 10% reduction for being a subsidiary
      confidence: parentScore.confidence * 0.8, // Lower confidence
      calculatedAt: new Date(),
    };

    return adjustedScore;
  }

  private async assessSubcontractorTrust(subcontractorId: string): Promise<TrustScore> {
    // Find vendor relationship
    const vendor = await this.config.vendorRegistry.getVendor(subcontractorId);
    return this.getVendorTrustScore(vendor.id);
  }

  private async ensureMonitoringStarted(vendorId: string): Promise<void> {
    if (!this.config.options.autoMonitoringEnabled) return;

    const status = this.config.monitoringService.getMonitoringStatus(vendorId);
    if (!status || !status.running) {
      await this.startVendorMonitoring(vendorId);
    }
  }

  private async calculateHealthScore(vendorId: string): Promise<number> {
    const events = await this.config.monitoringService.getHealthEvents(vendorId, {
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    let healthScore = 100;

    for (const event of events) {
      if (!event.resolvedAt) {
        switch (event.severity) {
          case 'critical': healthScore -= 20; break;
          case 'error': healthScore -= 10; break;
          case 'warning': healthScore -= 5; break;
        }
      }
    }

    return Math.max(0, healthScore);
  }

  private getMonitoringFrequency(tier: string): 'realtime' | 'hourly' | 'daily' | 'weekly' {
    switch (tier) {
      case 'critical': return 'realtime';
      case 'high': return 'hourly';
      case 'medium': return 'daily';
      default: return 'weekly';
    }
  }

  private getMonitoringChecks(tier: string): MonitoringCheck[] {
    const baseChecks: MonitoringCheck[] = [
      { type: 'security_posture', enabled: true, frequency: 'daily', config: {} },
      { type: 'certificates', enabled: true, frequency: 'daily', config: {} },
      { type: 'breaches', enabled: true, frequency: 'daily', config: {} },
    ];

    if (tier === 'critical' || tier === 'high') {
      baseChecks.push(
        { type: 'dark_web', enabled: true, frequency: 'daily', config: {} },
        { type: 'sanctions', enabled: true, frequency: 'daily', config: {} },
        { type: 'dns', enabled: true, frequency: 'daily', config: {} },
      );
    }

    return baseChecks;
  }

  private getAlertThresholds(tier: string): AlertThreshold[] {
    const thresholds: AlertThreshold[] = [
      { metric: 'trust_score', operator: 'lt', value: 60, severity: 'warning' },
      { metric: 'trust_score', operator: 'lt', value: 40, severity: 'error' },
    ];

    if (tier === 'critical') {
      thresholds.push({ metric: 'trust_score', operator: 'lt', value: 70, severity: 'warning' });
    }

    return thresholds;
  }

  private identifyConcentrationRisks(
    categoryConcentration: Record<string, number>,
  ): string[] {
    const risks: string[] = [];
    const total = Object.values(categoryConcentration).reduce((a, b) => a + b, 0);

    for (const [category, count] of Object.entries(categoryConcentration)) {
      const percentage = (count / total) * 100;
      if (percentage > 30) {
        risks.push(`High concentration in ${category} (${percentage.toFixed(1)}%)`);
      }
    }

    return risks;
  }
}

// ============================================================================
// Types
// ============================================================================

interface TrustScoreComparison {
  vendors: Array<{ vendorId: string; score: TrustScore }>;
  ranking: string[];
  averageScore: number;
  highestScore: { vendorId: string; score: TrustScore };
  lowestScore: { vendorId: string; score: TrustScore };
  comparisonDate: Date;
}

interface ConcentrationRiskAnalysis {
  totalVendors: number;
  categoryConcentration: Record<string, number>;
  tierConcentration: Record<string, number>;
  riskConcentration: Record<string, number>;
  topConcentrationRisks: string[];
  analysisDate: Date;
}

interface MonitoringStatus {
  vendorId: string;
  isMonitored: boolean;
  lastCheck: Date | null;
  healthScore: number | null;
  activeAlerts: number;
}

interface MonitoringCheck {
  type: string;
  enabled: boolean;
  frequency: 'realtime' | 'hourly' | 'daily' | 'weekly';
  config: Record<string, unknown>;
}

interface AlertThreshold {
  metric: string;
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
  value: number;
  severity: 'warning' | 'error' | 'critical';
}

interface SecurityControl {
  id: string;
  name: string;
  implemented: boolean;
  effectiveness: 'strong' | 'adequate' | 'weak' | 'missing';
  lastVerified: Date;
}

interface SLAPerformance {
  name: string;
  target: number;
  actual: number;
  breachCount: number;
}

interface DataProcessingTermsInput {
  dataSubjectRights: boolean;
  breachNotificationHours: number;
  transferMechanisms: string[];
}

interface SecurityRequirementInput {
  priority: 'mandatory' | 'recommended';
  verified: boolean;
}

interface AuditRightsInfo {
  exists: boolean;
  exercised: boolean;
}

// ============================================================================
// Error Class
// ============================================================================

export class TrustOracleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TrustOracleError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createTrustOracle(config: TrustOracleConfig): TrustOracleService {
  return new TrustOracleService(config);
}

export function getDefaultTrustOracleOptions(): TrustOracleOptions {
  return {
    cacheEnabled: true,
    cacheTTLSeconds: 3600, // 1 hour
    autoMonitoringEnabled: true,
    alertOnScoreDegradation: true,
    degradationThreshold: 10, // Alert if score drops by 10+ points
    parallelDataFetching: true,
  };
}
