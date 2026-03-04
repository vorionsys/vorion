/**
 * FedRAMP Compliance Metrics
 *
 * Provides metrics tracking for FedRAMP compliance including:
 * - Vulnerability aging
 * - POA&M status
 * - Control implementation percentage
 * - Scan compliance rate
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import type { VulnerabilitySeverity, VulnerabilityFinding, ScanResult } from './continuous-monitoring.js';
import type { POAMItem, RiskLevel, POAMStatus } from './poam.js';
import type { FedRAMPControl } from './controls.js';
import type { ImplementationStatus } from '../types.js';

const logger = createLogger({ component: 'fedramp-metrics' });

// =============================================================================
// TYPES
// =============================================================================

/**
 * Time periods for metrics
 */
export const TIME_PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as const;
export type TimePeriod = (typeof TIME_PERIODS)[number];

/**
 * Metric trend direction
 */
export const TREND_DIRECTIONS = ['improving', 'stable', 'degrading'] as const;
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];

/**
 * Vulnerability aging metrics
 */
export interface VulnerabilityAgingMetrics {
  /** Calculation timestamp */
  calculatedAt: Date;
  /** Total open vulnerabilities */
  totalOpen: number;
  /** By severity */
  bySeverity: Record<VulnerabilitySeverity, {
    total: number;
    averageAgeDays: number;
    oldestDays: number;
    withinSLA: number;
    outsideSLA: number;
    percentWithinSLA: number;
  }>;
  /** Aging buckets */
  agingBuckets: {
    '0-30': number;
    '31-60': number;
    '61-90': number;
    '91-180': number;
    '180+': number;
  };
  /** Overall average age */
  overallAverageAgeDays: number;
  /** Oldest vulnerability age */
  oldestVulnerabilityDays: number;
  /** Trend vs previous period */
  trend: TrendDirection;
  /** Previous period average for comparison */
  previousPeriodAverage?: number;
}

/**
 * POA&M metrics
 */
export interface POAMMetrics {
  /** Calculation timestamp */
  calculatedAt: Date;
  /** Total POA&M items */
  totalItems: number;
  /** By status */
  byStatus: Record<POAMStatus, number>;
  /** By risk level */
  byRiskLevel: Record<RiskLevel, {
    total: number;
    open: number;
    overdue: number;
    averageAgeDays: number;
  }>;
  /** Overdue items */
  overdueItems: number;
  /** Overdue percentage */
  overduePercentage: number;
  /** Average time to close (days) */
  averageTimeToCloseDays: number;
  /** Closure rate (last 90 days) */
  closureRateLast90Days: number;
  /** Items opened last 30 days */
  openedLast30Days: number;
  /** Items closed last 30 days */
  closedLast30Days: number;
  /** Net change last 30 days */
  netChangeLast30Days: number;
  /** Trend */
  trend: TrendDirection;
  /** Deviations pending */
  deviationsPending: number;
  /** Deviations approved */
  deviationsApproved: number;
}

/**
 * Control implementation metrics
 */
export interface ControlImplementationMetrics {
  /** Calculation timestamp */
  calculatedAt: Date;
  /** Total controls in baseline */
  totalControls: number;
  /** By implementation status */
  byStatus: Record<ImplementationStatus, number>;
  /** Implementation percentage */
  implementationPercentage: number;
  /** Partial implementation percentage */
  partialImplementationPercentage: number;
  /** By control family */
  byFamily: Array<{
    family: string;
    total: number;
    implemented: number;
    percentage: number;
  }>;
  /** Controls with automated testing */
  automatedTestingCoverage: {
    total: number;
    withAutomatedTests: number;
    percentage: number;
  };
  /** High priority (P1) implementation */
  p1Implementation: {
    total: number;
    implemented: number;
    percentage: number;
  };
  /** Trend */
  trend: TrendDirection;
  /** Previous period percentage */
  previousPeriodPercentage?: number;
}

/**
 * Scan compliance metrics
 */
export interface ScanComplianceMetrics {
  /** Calculation timestamp */
  calculatedAt: Date;
  /** Monthly scan compliance */
  monthlyScanCompliance: {
    lastTwelveMonths: number[];
    percentCompliant: number;
    missedMonths: string[];
  };
  /** Last scan information */
  lastScan: {
    date?: Date;
    type?: string;
    daysSinceLastScan?: number;
    isOverdue: boolean;
  };
  /** Scan coverage */
  coverage: {
    totalAssets: number;
    scannedAssets: number;
    coveragePercentage: number;
    unscannedAssets: string[];
  };
  /** Scan findings trends */
  findingsTrends: {
    period: string;
    critical: number;
    high: number;
    moderate: number;
    low: number;
  }[];
  /** Authenticated scan percentage */
  authenticatedScanPercentage: number;
  /** Trend */
  trend: TrendDirection;
}

/**
 * ConMon dashboard metrics
 */
export interface ConMonDashboardMetrics {
  /** Generation timestamp */
  generatedAt: Date;
  /** System name */
  systemName: string;
  /** Authorization status */
  authorizationStatus: 'active' | 'expiring-soon' | 'expired';
  /** Days until ATO expiration */
  daysUntilATOExpiration: number;
  /** Overall compliance score (0-100) */
  overallComplianceScore: number;
  /** Vulnerability metrics */
  vulnerabilityMetrics: VulnerabilityAgingMetrics;
  /** POA&M metrics */
  poamMetrics: POAMMetrics;
  /** Control metrics */
  controlMetrics: ControlImplementationMetrics;
  /** Scan metrics */
  scanMetrics: ScanComplianceMetrics;
  /** Key risk indicators */
  keyRiskIndicators: Array<{
    indicator: string;
    value: number;
    threshold: number;
    status: 'green' | 'yellow' | 'red';
    trend: TrendDirection;
  }>;
  /** Action items */
  actionItems: Array<{
    priority: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    dueDate?: Date;
  }>;
}

/**
 * Historical metric data point
 */
export interface MetricDataPoint {
  timestamp: Date;
  value: number;
  metadata?: Record<string, unknown>;
}

/**
 * Metrics configuration
 */
export interface MetricsConfig {
  /** System name */
  systemName: string;
  /** ATO date */
  atoDate: Date;
  /** ATO expiration date */
  atoExpirationDate: Date;
  /** Authorization level */
  authorizationLevel: 'low' | 'moderate' | 'high';
  /** SLA for vulnerability remediation (days) */
  remediationSLAs: Record<VulnerabilitySeverity, number>;
  /** Monthly scan requirement day */
  monthlyScanRequirementDay: number;
  /** Enable historical tracking */
  trackHistory: boolean;
}

// =============================================================================
// METRICS SERVICE
// =============================================================================

/**
 * FedRAMP Metrics Service
 */
export class MetricsService {
  private config: MetricsConfig;
  private vulnerabilityHistory: MetricDataPoint[];
  private poamHistory: MetricDataPoint[];
  private controlHistory: MetricDataPoint[];
  private scanHistory: MetricDataPoint[];

  constructor(config: MetricsConfig) {
    this.config = config;
    this.vulnerabilityHistory = [];
    this.poamHistory = [];
    this.controlHistory = [];
    this.scanHistory = [];

    logger.info(
      { systemName: config.systemName },
      'Metrics service initialized'
    );
  }

  // ===========================================================================
  // VULNERABILITY AGING METRICS
  // ===========================================================================

  /**
   * Calculate vulnerability aging metrics
   */
  calculateVulnerabilityMetrics(vulnerabilities: VulnerabilityFinding[]): VulnerabilityAgingMetrics {
    const openVulns = vulnerabilities.filter((v) =>
      ['open', 'in-progress'].includes(v.status)
    );

    const now = new Date();

    const bySeverity: VulnerabilityAgingMetrics['bySeverity'] = {
      critical: this.calculateSeverityMetrics(openVulns, 'critical', now),
      high: this.calculateSeverityMetrics(openVulns, 'high', now),
      moderate: this.calculateSeverityMetrics(openVulns, 'moderate', now),
      low: this.calculateSeverityMetrics(openVulns, 'low', now),
    };

    const agingBuckets = this.calculateAgingBuckets(openVulns, now);

    const allAges = openVulns.map((v) =>
      Math.floor((now.getTime() - v.firstDetected.getTime()) / (1000 * 60 * 60 * 24))
    );
    const overallAverageAgeDays =
      allAges.length > 0 ? Math.round(allAges.reduce((a, b) => a + b, 0) / allAges.length) : 0;
    const oldestVulnerabilityDays = allAges.length > 0 ? Math.max(...allAges) : 0;

    // Calculate trend
    const previousAverage = this.vulnerabilityHistory.length > 0
      ? this.vulnerabilityHistory[this.vulnerabilityHistory.length - 1].value
      : undefined;
    const trend = this.calculateTrend(overallAverageAgeDays, previousAverage, true);

    const metrics: VulnerabilityAgingMetrics = {
      calculatedAt: now,
      totalOpen: openVulns.length,
      bySeverity,
      agingBuckets,
      overallAverageAgeDays,
      oldestVulnerabilityDays,
      trend,
      previousPeriodAverage: previousAverage,
    };

    // Store historical data point
    if (this.config.trackHistory) {
      this.vulnerabilityHistory.push({
        timestamp: now,
        value: overallAverageAgeDays,
        metadata: { totalOpen: openVulns.length },
      });
    }

    return metrics;
  }

  private calculateSeverityMetrics(
    vulns: VulnerabilityFinding[],
    severity: VulnerabilitySeverity,
    now: Date
  ): VulnerabilityAgingMetrics['bySeverity']['critical'] {
    const severityVulns = vulns.filter((v) => v.severity === severity);
    const sla = this.config.remediationSLAs[severity];

    const ages = severityVulns.map((v) =>
      Math.floor((now.getTime() - v.firstDetected.getTime()) / (1000 * 60 * 60 * 24))
    );

    const withinSLA = severityVulns.filter((v) => {
      const age = Math.floor((now.getTime() - v.firstDetected.getTime()) / (1000 * 60 * 60 * 24));
      return age <= sla;
    }).length;

    return {
      total: severityVulns.length,
      averageAgeDays: ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
      oldestDays: ages.length > 0 ? Math.max(...ages) : 0,
      withinSLA,
      outsideSLA: severityVulns.length - withinSLA,
      percentWithinSLA: severityVulns.length > 0 ? Math.round((withinSLA / severityVulns.length) * 100) : 100,
    };
  }

  private calculateAgingBuckets(
    vulns: VulnerabilityFinding[],
    now: Date
  ): VulnerabilityAgingMetrics['agingBuckets'] {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '180+': 0 };

    for (const vuln of vulns) {
      const age = Math.floor((now.getTime() - vuln.firstDetected.getTime()) / (1000 * 60 * 60 * 24));

      if (age <= 30) buckets['0-30']++;
      else if (age <= 60) buckets['31-60']++;
      else if (age <= 90) buckets['61-90']++;
      else if (age <= 180) buckets['91-180']++;
      else buckets['180+']++;
    }

    return buckets;
  }

  // ===========================================================================
  // POA&M METRICS
  // ===========================================================================

  /**
   * Calculate POA&M metrics
   */
  calculatePOAMMetrics(poamItems: POAMItem[]): POAMMetrics {
    const now = new Date();

    const byStatus: Record<POAMStatus, number> = {
      open: poamItems.filter((i) => i.status === 'open').length,
      ongoing: poamItems.filter((i) => i.status === 'ongoing').length,
      completed: poamItems.filter((i) => i.status === 'completed').length,
      closed: poamItems.filter((i) => i.status === 'closed').length,
      'risk-accepted': poamItems.filter((i) => i.status === 'risk-accepted').length,
      'false-positive': poamItems.filter((i) => i.status === 'false-positive').length,
      delayed: poamItems.filter((i) => i.status === 'delayed').length,
    };

    const openItems = poamItems.filter((i) => ['open', 'ongoing', 'delayed'].includes(i.status));
    const overdueItems = openItems.filter((i) => i.daysOverdue > 0);

    const byRiskLevel = this.calculatePOAMRiskLevelMetrics(poamItems, now);

    // Calculate closure rate
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const closedLast90Days = poamItems.filter(
      (i) => i.status === 'closed' && i.actualCompletionDate && i.actualCompletionDate >= ninetyDaysAgo
    );
    const openedLast90Days = poamItems.filter((i) => i.detectedDate >= ninetyDaysAgo);
    const closureRate = openedLast90Days.length > 0
      ? Math.round((closedLast90Days.length / openedLast90Days.length) * 100)
      : 100;

    // Calculate average time to close
    const closedItems = poamItems.filter((i) => i.status === 'closed' && i.actualCompletionDate);
    const avgTimeToClose = closedItems.length > 0
      ? Math.round(
          closedItems.reduce((sum, i) => {
            return sum + ((i.actualCompletionDate!.getTime() - i.detectedDate.getTime()) / (1000 * 60 * 60 * 24));
          }, 0) / closedItems.length
        )
      : 0;

    // Last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const openedLast30 = poamItems.filter((i) => i.detectedDate >= thirtyDaysAgo).length;
    const closedLast30 = poamItems.filter(
      (i) => i.status === 'closed' && i.actualCompletionDate && i.actualCompletionDate >= thirtyDaysAgo
    ).length;

    const previousTotal = this.poamHistory.length > 0
      ? this.poamHistory[this.poamHistory.length - 1].value
      : undefined;
    const trend = this.calculateTrend(openItems.length, previousTotal, true);

    const metrics: POAMMetrics = {
      calculatedAt: now,
      totalItems: poamItems.length,
      byStatus,
      byRiskLevel,
      overdueItems: overdueItems.length,
      overduePercentage: openItems.length > 0 ? Math.round((overdueItems.length / openItems.length) * 100) : 0,
      averageTimeToCloseDays: avgTimeToClose,
      closureRateLast90Days: closureRate,
      openedLast30Days: openedLast30,
      closedLast30Days: closedLast30,
      netChangeLast30Days: openedLast30 - closedLast30,
      trend,
      deviationsPending: poamItems.filter((i) => i.deviationRequestId).length,
      deviationsApproved: poamItems.filter((i) => i.status === 'risk-accepted').length,
    };

    if (this.config.trackHistory) {
      this.poamHistory.push({
        timestamp: now,
        value: openItems.length,
        metadata: { overdueItems: overdueItems.length },
      });
    }

    return metrics;
  }

  private calculatePOAMRiskLevelMetrics(
    items: POAMItem[],
    now: Date
  ): POAMMetrics['byRiskLevel'] {
    const riskLevels: RiskLevel[] = ['very-high', 'high', 'moderate', 'low', 'very-low'];
    const result: POAMMetrics['byRiskLevel'] = {} as any;

    for (const level of riskLevels) {
      const levelItems = items.filter((i) => i.riskLevel === level);
      const openItems = levelItems.filter((i) => ['open', 'ongoing', 'delayed'].includes(i.status));
      const overdueItems = openItems.filter((i) => i.daysOverdue > 0);

      const ages = openItems.map((i) =>
        Math.floor((now.getTime() - i.detectedDate.getTime()) / (1000 * 60 * 60 * 24))
      );

      result[level] = {
        total: levelItems.length,
        open: openItems.length,
        overdue: overdueItems.length,
        averageAgeDays: ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0,
      };
    }

    return result;
  }

  // ===========================================================================
  // CONTROL IMPLEMENTATION METRICS
  // ===========================================================================

  /**
   * Calculate control implementation metrics
   */
  calculateControlMetrics(controls: FedRAMPControl[]): ControlImplementationMetrics {
    const now = new Date();

    const byStatus: Record<ImplementationStatus, number> = {
      implemented: controls.filter((c) => c.implementation === 'implemented').length,
      'partially-implemented': controls.filter((c) => c.implementation === 'partially-implemented').length,
      planned: controls.filter((c) => c.implementation === 'planned').length,
      'not-applicable': controls.filter((c) => c.implementation === 'not-applicable').length,
    };

    const applicableControls = controls.filter((c) => c.implementation !== 'not-applicable');
    const implementedControls = controls.filter((c) => c.implementation === 'implemented');
    const partialControls = controls.filter((c) => c.implementation === 'partially-implemented');

    const implementationPercentage = applicableControls.length > 0
      ? Math.round((implementedControls.length / applicableControls.length) * 100)
      : 0;

    const partialPercentage = applicableControls.length > 0
      ? Math.round((partialControls.length / applicableControls.length) * 100)
      : 0;

    const byFamily = this.calculateFamilyMetrics(controls);

    const controlsWithTests = controls.filter((c) => c.assessmentProcedure.automatedTestAvailable);
    const automatedTestingCoverage = {
      total: controls.length,
      withAutomatedTests: controlsWithTests.length,
      percentage: Math.round((controlsWithTests.length / controls.length) * 100),
    };

    const p1Controls = controls.filter((c) => c.priority === 'P1');
    const p1Implemented = p1Controls.filter((c) => c.implementation === 'implemented');
    const p1Implementation = {
      total: p1Controls.length,
      implemented: p1Implemented.length,
      percentage: p1Controls.length > 0 ? Math.round((p1Implemented.length / p1Controls.length) * 100) : 0,
    };

    const previousPercentage = this.controlHistory.length > 0
      ? this.controlHistory[this.controlHistory.length - 1].value
      : undefined;
    const trend = this.calculateTrend(implementationPercentage, previousPercentage, false);

    const metrics: ControlImplementationMetrics = {
      calculatedAt: now,
      totalControls: controls.length,
      byStatus,
      implementationPercentage,
      partialImplementationPercentage: partialPercentage,
      byFamily,
      automatedTestingCoverage,
      p1Implementation,
      trend,
      previousPeriodPercentage: previousPercentage,
    };

    if (this.config.trackHistory) {
      this.controlHistory.push({
        timestamp: now,
        value: implementationPercentage,
      });
    }

    return metrics;
  }

  private calculateFamilyMetrics(
    controls: FedRAMPControl[]
  ): ControlImplementationMetrics['byFamily'] {
    const families = new Map<string, FedRAMPControl[]>();

    for (const control of controls) {
      const family = control.family;
      const existing = families.get(family) || [];
      existing.push(control);
      families.set(family, existing);
    }

    return Array.from(families.entries())
      .map(([family, familyControls]) => ({
        family,
        total: familyControls.length,
        implemented: familyControls.filter((c) => c.implementation === 'implemented').length,
        percentage: Math.round(
          (familyControls.filter((c) => c.implementation === 'implemented').length /
            familyControls.length) *
            100
        ),
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }

  // ===========================================================================
  // SCAN COMPLIANCE METRICS
  // ===========================================================================

  /**
   * Calculate scan compliance metrics
   */
  calculateScanMetrics(
    scans: ScanResult[],
    totalAssets: number,
    scannedAssetIds: string[]
  ): ScanComplianceMetrics {
    const now = new Date();

    // Monthly scan compliance for last 12 months
    const monthlyCompliance: number[] = [];
    const missedMonths: string[] = [];

    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const monthName = monthStart.toLocaleString('default', { month: 'short', year: 'numeric' });

      const monthScans = scans.filter(
        (s) => s.endTime >= monthStart && s.endTime <= monthEnd && s.scanType === 'vulnerability'
      );

      if (monthScans.length > 0) {
        monthlyCompliance.push(1);
      } else {
        monthlyCompliance.push(0);
        missedMonths.push(monthName);
      }
    }

    const percentCompliant = Math.round((monthlyCompliance.filter((m) => m === 1).length / 12) * 100);

    // Last scan info
    const lastScan = scans
      .filter((s) => s.scanType === 'vulnerability')
      .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())[0];

    const daysSinceLastScan = lastScan
      ? Math.floor((now.getTime() - lastScan.endTime.getTime()) / (1000 * 60 * 60 * 24))
      : undefined;

    // Coverage
    const unscannedAssets = Array.from(
      { length: totalAssets },
      (_, i) => `asset-${i}`
    ).filter((id) => !scannedAssetIds.includes(id));

    // Findings trends (last 6 months)
    const findingsTrends = this.calculateFindingsTrends(scans);

    // Authenticated scan percentage
    const authenticatedScans = scans.filter((s) => s.credentialType);
    const authenticatedPercentage = scans.length > 0
      ? Math.round((authenticatedScans.length / scans.length) * 100)
      : 0;

    const previousCompliance = this.scanHistory.length > 0
      ? this.scanHistory[this.scanHistory.length - 1].value
      : undefined;
    const trend = this.calculateTrend(percentCompliant, previousCompliance, false);

    const metrics: ScanComplianceMetrics = {
      calculatedAt: now,
      monthlyScanCompliance: {
        lastTwelveMonths: monthlyCompliance,
        percentCompliant,
        missedMonths,
      },
      lastScan: {
        date: lastScan?.endTime,
        type: lastScan?.scanType,
        daysSinceLastScan,
        isOverdue: daysSinceLastScan !== undefined && daysSinceLastScan > 30,
      },
      coverage: {
        totalAssets,
        scannedAssets: scannedAssetIds.length,
        coveragePercentage: Math.round((scannedAssetIds.length / totalAssets) * 100),
        unscannedAssets: unscannedAssets.slice(0, 10), // Limit for display
      },
      findingsTrends,
      authenticatedScanPercentage: authenticatedPercentage,
      trend,
    };

    if (this.config.trackHistory) {
      this.scanHistory.push({
        timestamp: now,
        value: percentCompliant,
      });
    }

    return metrics;
  }

  private calculateFindingsTrends(scans: ScanResult[]): ScanComplianceMetrics['findingsTrends'] {
    const trends: ScanComplianceMetrics['findingsTrends'] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const monthName = monthStart.toLocaleString('default', { month: 'short' });

      const monthScans = scans.filter(
        (s) => s.endTime >= monthStart && s.endTime <= monthEnd
      );

      const totals = { critical: 0, high: 0, moderate: 0, low: 0 };
      for (const scan of monthScans) {
        totals.critical += scan.findingCounts.critical;
        totals.high += scan.findingCounts.high;
        totals.moderate += scan.findingCounts.moderate;
        totals.low += scan.findingCounts.low;
      }

      trends.push({
        period: monthName,
        ...totals,
      });
    }

    return trends;
  }

  // ===========================================================================
  // DASHBOARD METRICS
  // ===========================================================================

  /**
   * Generate comprehensive ConMon dashboard metrics
   */
  generateDashboardMetrics(
    vulnerabilities: VulnerabilityFinding[],
    poamItems: POAMItem[],
    controls: FedRAMPControl[],
    scans: ScanResult[],
    totalAssets: number,
    scannedAssetIds: string[]
  ): ConMonDashboardMetrics {
    const now = new Date();

    const vulnMetrics = this.calculateVulnerabilityMetrics(vulnerabilities);
    const poamMetrics = this.calculatePOAMMetrics(poamItems);
    const controlMetrics = this.calculateControlMetrics(controls);
    const scanMetrics = this.calculateScanMetrics(scans, totalAssets, scannedAssetIds);

    // Calculate days until ATO expiration
    const daysUntilExpiration = Math.floor(
      (this.config.atoExpirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    let authorizationStatus: 'active' | 'expiring-soon' | 'expired';
    if (daysUntilExpiration < 0) {
      authorizationStatus = 'expired';
    } else if (daysUntilExpiration < 90) {
      authorizationStatus = 'expiring-soon';
    } else {
      authorizationStatus = 'active';
    }

    // Calculate overall compliance score
    const overallScore = this.calculateOverallScore(
      vulnMetrics,
      poamMetrics,
      controlMetrics,
      scanMetrics
    );

    // Key risk indicators
    const kris = this.calculateKeyRiskIndicators(
      vulnMetrics,
      poamMetrics,
      controlMetrics,
      scanMetrics
    );

    // Action items
    const actionItems = this.generateActionItems(
      vulnMetrics,
      poamMetrics,
      controlMetrics,
      scanMetrics,
      authorizationStatus,
      daysUntilExpiration
    );

    return {
      generatedAt: now,
      systemName: this.config.systemName,
      authorizationStatus,
      daysUntilATOExpiration: daysUntilExpiration,
      overallComplianceScore: overallScore,
      vulnerabilityMetrics: vulnMetrics,
      poamMetrics,
      controlMetrics,
      scanMetrics,
      keyRiskIndicators: kris,
      actionItems,
    };
  }

  private calculateOverallScore(
    vulnMetrics: VulnerabilityAgingMetrics,
    poamMetrics: POAMMetrics,
    controlMetrics: ControlImplementationMetrics,
    scanMetrics: ScanComplianceMetrics
  ): number {
    // Weighted score calculation
    const vulnScore = 100 - Math.min(vulnMetrics.totalOpen * 2, 50);
    const poamScore = 100 - poamMetrics.overduePercentage;
    const controlScore = controlMetrics.implementationPercentage;
    const scanScore = scanMetrics.monthlyScanCompliance.percentCompliant;

    // Weights: Vulnerabilities 30%, POA&M 25%, Controls 25%, Scans 20%
    return Math.round(
      vulnScore * 0.3 + poamScore * 0.25 + controlScore * 0.25 + scanScore * 0.2
    );
  }

  private calculateKeyRiskIndicators(
    vulnMetrics: VulnerabilityAgingMetrics,
    poamMetrics: POAMMetrics,
    controlMetrics: ControlImplementationMetrics,
    scanMetrics: ScanComplianceMetrics
  ): ConMonDashboardMetrics['keyRiskIndicators'] {
    return [
      {
        indicator: 'Critical Vulnerabilities',
        value: vulnMetrics.bySeverity.critical.total,
        threshold: 0,
        status: vulnMetrics.bySeverity.critical.total === 0 ? 'green' : 'red',
        trend: vulnMetrics.trend,
      },
      {
        indicator: 'High Vulnerabilities',
        value: vulnMetrics.bySeverity.high.total,
        threshold: 5,
        status: vulnMetrics.bySeverity.high.total <= 5 ? 'green' : vulnMetrics.bySeverity.high.total <= 10 ? 'yellow' : 'red',
        trend: vulnMetrics.trend,
      },
      {
        indicator: 'Overdue POA&M Items',
        value: poamMetrics.overdueItems,
        threshold: 0,
        status: poamMetrics.overdueItems === 0 ? 'green' : poamMetrics.overdueItems <= 3 ? 'yellow' : 'red',
        trend: poamMetrics.trend,
      },
      {
        indicator: 'Control Implementation',
        value: controlMetrics.implementationPercentage,
        threshold: 100,
        status: controlMetrics.implementationPercentage >= 95 ? 'green' : controlMetrics.implementationPercentage >= 80 ? 'yellow' : 'red',
        trend: controlMetrics.trend,
      },
      {
        indicator: 'Scan Compliance',
        value: scanMetrics.monthlyScanCompliance.percentCompliant,
        threshold: 100,
        status: scanMetrics.monthlyScanCompliance.percentCompliant === 100 ? 'green' : scanMetrics.monthlyScanCompliance.percentCompliant >= 90 ? 'yellow' : 'red',
        trend: scanMetrics.trend,
      },
    ];
  }

  private generateActionItems(
    vulnMetrics: VulnerabilityAgingMetrics,
    poamMetrics: POAMMetrics,
    controlMetrics: ControlImplementationMetrics,
    scanMetrics: ScanComplianceMetrics,
    authStatus: string,
    daysToExpiration: number
  ): ConMonDashboardMetrics['actionItems'] {
    const items: ConMonDashboardMetrics['actionItems'] = [];

    if (vulnMetrics.bySeverity.critical.total > 0) {
      items.push({
        priority: 'critical',
        description: `Remediate ${vulnMetrics.bySeverity.critical.total} critical vulnerabilities immediately`,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    if (poamMetrics.overdueItems > 0) {
      items.push({
        priority: 'high',
        description: `Address ${poamMetrics.overdueItems} overdue POA&M items`,
      });
    }

    if (scanMetrics.lastScan.isOverdue) {
      items.push({
        priority: 'high',
        description: 'Conduct monthly vulnerability scan - scan is overdue',
      });
    }

    if (authStatus === 'expiring-soon') {
      items.push({
        priority: 'high',
        description: `ATO expires in ${daysToExpiration} days - initiate reauthorization`,
      });
    }

    if (controlMetrics.implementationPercentage < 100) {
      items.push({
        priority: 'medium',
        description: `Complete implementation of ${controlMetrics.byStatus.planned} planned controls`,
      });
    }

    return items.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  private calculateTrend(
    current: number,
    previous: number | undefined,
    lowerIsBetter: boolean
  ): TrendDirection {
    if (previous === undefined) return 'stable';

    const threshold = 5; // 5% change threshold
    const change = ((current - previous) / previous) * 100;

    if (Math.abs(change) < threshold) return 'stable';

    if (lowerIsBetter) {
      return change < 0 ? 'improving' : 'degrading';
    } else {
      return change > 0 ? 'improving' : 'degrading';
    }
  }

  /**
   * Get historical data for a metric
   */
  getHistory(metricType: 'vulnerability' | 'poam' | 'control' | 'scan'): MetricDataPoint[] {
    switch (metricType) {
      case 'vulnerability':
        return [...this.vulnerabilityHistory];
      case 'poam':
        return [...this.poamHistory];
      case 'control':
        return [...this.controlHistory];
      case 'scan':
        return [...this.scanHistory];
    }
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(dashboard: ConMonDashboardMetrics): string {
    return JSON.stringify(dashboard, null, 2);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default MetricsService;
