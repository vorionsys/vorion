/**
 * Continuous Monitoring Service
 * Real-time vendor health monitoring including security posture, certificates, DNS, and dark web
 */

import {
  HealthEvent,
  HealthEventType,
  MonitoringConfig,
  MonitoringCheck,
  MonitoringFrequency,
  AlertThreshold,
  VendorInfo,
  Observable,
  Observer,
  Subscription,
  CertificateInfo,
  TrustScore,
} from './types';
import { DataSourceManager, DarkWebMention } from './data-sources';

// ============================================================================
// Continuous Monitoring Service
// ============================================================================

export interface ContinuousMonitoringConfig {
  dataSourceManager: DataSourceManager;
  storage: MonitoringStorage;
  alertDispatcher: AlertDispatcher;
  defaultPollingIntervals: PollingIntervals;
  enabledChecks: string[];
}

export interface PollingIntervals {
  securityPosture: number; // milliseconds
  certificates: number;
  dns: number;
  breaches: number;
  darkWeb: number;
  news: number;
  sanctions: number;
}

export class ContinuousMonitoringService {
  private readonly config: ContinuousMonitoringConfig;
  private readonly activeMonitors: Map<string, VendorMonitor> = new Map();
  private readonly eventSubscribers: Map<string, Set<Observer<HealthEvent>>> = new Map();

  constructor(config: ContinuousMonitoringConfig) {
    this.config = config;
  }

  // ============================================================================
  // Monitor Management
  // ============================================================================

  async startMonitoring(vendorId: string, vendorConfig: MonitoringConfig): Promise<void> {
    if (this.activeMonitors.has(vendorId)) {
      throw new MonitoringError('ALREADY_MONITORING', `Already monitoring vendor ${vendorId}`);
    }

    const monitor = new VendorMonitor(vendorId, vendorConfig, this.config, this);
    this.activeMonitors.set(vendorId, monitor);

    await monitor.start();

    console.log(`Started monitoring vendor ${vendorId}`);
  }

  async stopMonitoring(vendorId: string): Promise<void> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    await monitor.stop();
    this.activeMonitors.delete(vendorId);

    console.log(`Stopped monitoring vendor ${vendorId}`);
  }

  async updateMonitoringConfig(vendorId: string, config: Partial<MonitoringConfig>): Promise<void> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    await monitor.updateConfig(config);
  }

  getMonitoringStatus(vendorId: string): MonitoringStatus | null {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) return null;

    return monitor.getStatus();
  }

  getAllMonitoringStatuses(): MonitoringStatus[] {
    return Array.from(this.activeMonitors.values()).map(m => m.getStatus());
  }

  // ============================================================================
  // Event Subscription (Observable pattern)
  // ============================================================================

  monitorVendorHealth(vendorId: string): Observable<HealthEvent> {
    return {
      subscribe: (observer: Observer<HealthEvent>): Subscription => {
        if (!this.eventSubscribers.has(vendorId)) {
          this.eventSubscribers.set(vendorId, new Set());
        }

        this.eventSubscribers.get(vendorId)!.add(observer);

        return {
          unsubscribe: () => {
            this.eventSubscribers.get(vendorId)?.delete(observer);
          },
        };
      },
    };
  }

  // Internal method to emit events
  emitHealthEvent(vendorId: string, event: HealthEvent): void {
    const subscribers = this.eventSubscribers.get(vendorId);
    if (subscribers) {
      for (const subscriber of subscribers) {
        try {
          subscriber.next(event);
        } catch (error) {
          console.error('Error notifying subscriber:', error);
        }
      }
    }

    // Also emit to global subscribers
    const globalSubscribers = this.eventSubscribers.get('*');
    if (globalSubscribers) {
      for (const subscriber of globalSubscribers) {
        try {
          subscriber.next(event);
        } catch (error) {
          console.error('Error notifying global subscriber:', error);
        }
      }
    }

    // Store event
    this.config.storage.saveHealthEvent(event).catch(console.error);

    // Dispatch alerts if needed
    this.config.alertDispatcher.dispatchIfNeeded(event).catch(console.error);
  }

  // ============================================================================
  // Manual Check Triggers
  // ============================================================================

  async triggerSecurityPostureCheck(vendorId: string): Promise<HealthEvent[]> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    return monitor.runSecurityPostureCheck();
  }

  async triggerCertificateCheck(vendorId: string): Promise<HealthEvent[]> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    return monitor.runCertificateCheck();
  }

  async triggerDNSCheck(vendorId: string): Promise<HealthEvent[]> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    return monitor.runDNSCheck();
  }

  async triggerBreachCheck(vendorId: string): Promise<HealthEvent[]> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    return monitor.runBreachCheck();
  }

  async triggerDarkWebScan(vendorId: string): Promise<HealthEvent[]> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    return monitor.runDarkWebScan();
  }

  async triggerFullCheck(vendorId: string): Promise<HealthEvent[]> {
    const monitor = this.activeMonitors.get(vendorId);
    if (!monitor) {
      throw new MonitoringError('NOT_MONITORING', `Not monitoring vendor ${vendorId}`);
    }

    return monitor.runAllChecks();
  }

  // ============================================================================
  // Historical Data Access
  // ============================================================================

  async getHealthEvents(
    vendorId: string,
    options: HealthEventQueryOptions,
  ): Promise<HealthEvent[]> {
    return this.config.storage.getHealthEvents(vendorId, options);
  }

  async getHealthEventStats(vendorId: string, days: number): Promise<HealthEventStats> {
    const events = await this.config.storage.getHealthEvents(vendorId, {
      startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      endDate: new Date(),
    });

    const stats: HealthEventStats = {
      total: events.length,
      bySeverity: {
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      },
      byType: {} as Record<HealthEventType, number>,
      resolved: 0,
      unresolved: 0,
      averageResolutionTime: 0,
    };

    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const event of events) {
      stats.bySeverity[event.severity]++;
      stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;

      if (event.resolvedAt) {
        stats.resolved++;
        resolvedCount++;
        totalResolutionTime += event.resolvedAt.getTime() - event.detectedAt.getTime();
      } else {
        stats.unresolved++;
      }
    }

    if (resolvedCount > 0) {
      stats.averageResolutionTime = totalResolutionTime / resolvedCount;
    }

    return stats;
  }
}

// ============================================================================
// Vendor Monitor (Internal)
// ============================================================================

class VendorMonitor {
  private readonly vendorId: string;
  private monitoringConfig: MonitoringConfig;
  private readonly serviceConfig: ContinuousMonitoringConfig;
  private readonly service: ContinuousMonitoringService;
  private readonly intervalIds: Map<string, ReturnType<typeof setInterval>> = new Map();
  private readonly checkResults: Map<string, CheckResult> = new Map();
  private running: boolean = false;

  constructor(
    vendorId: string,
    monitoringConfig: MonitoringConfig,
    serviceConfig: ContinuousMonitoringConfig,
    service: ContinuousMonitoringService,
  ) {
    this.vendorId = vendorId;
    this.monitoringConfig = monitoringConfig;
    this.serviceConfig = serviceConfig;
    this.service = service;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Schedule all enabled checks
    for (const check of this.monitoringConfig.checks) {
      if (check.enabled) {
        this.scheduleCheck(check);
      }
    }

    // Run initial checks
    await this.runAllChecks();
  }

  async stop(): Promise<void> {
    this.running = false;

    // Clear all intervals
    for (const [checkType, intervalId] of this.intervalIds) {
      clearInterval(intervalId);
    }
    this.intervalIds.clear();
  }

  async updateConfig(updates: Partial<MonitoringConfig>): Promise<void> {
    this.monitoringConfig = { ...this.monitoringConfig, ...updates };

    // Reschedule checks
    await this.stop();
    await this.start();
  }

  getStatus(): MonitoringStatus {
    return {
      vendorId: this.vendorId,
      running: this.running,
      config: this.monitoringConfig,
      checkResults: Object.fromEntries(this.checkResults),
      lastActivity: this.getLastActivity(),
    };
  }

  private getLastActivity(): Date | null {
    let latest: Date | null = null;
    for (const result of this.checkResults.values()) {
      if (!latest || result.timestamp > latest) {
        latest = result.timestamp;
      }
    }
    return latest;
  }

  private scheduleCheck(check: MonitoringCheck): void {
    const interval = this.getIntervalForFrequency(check.frequency);

    const intervalId = setInterval(async () => {
      if (!this.running) return;

      try {
        await this.runCheck(check.type);
      } catch (error) {
        console.error(`Error running check ${check.type} for vendor ${this.vendorId}:`, error);
      }
    }, interval);

    this.intervalIds.set(check.type, intervalId);
  }

  private getIntervalForFrequency(frequency: MonitoringFrequency): number {
    const intervals = this.serviceConfig.defaultPollingIntervals;

    switch (frequency) {
      case 'realtime':
        return 60 * 1000; // 1 minute
      case 'hourly':
        return 60 * 60 * 1000; // 1 hour
      case 'daily':
        return 24 * 60 * 60 * 1000; // 24 hours
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000; // 7 days
      default:
        return 60 * 60 * 1000; // Default to hourly
    }
  }

  async runAllChecks(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];

    for (const check of this.monitoringConfig.checks) {
      if (check.enabled) {
        try {
          const checkEvents = await this.runCheck(check.type);
          events.push(...checkEvents);
        } catch (error) {
          console.error(`Error in check ${check.type}:`, error);
        }
      }
    }

    return events;
  }

  private async runCheck(checkType: string): Promise<HealthEvent[]> {
    const checkMethods: Record<string, () => Promise<HealthEvent[]>> = {
      security_posture: () => this.runSecurityPostureCheck(),
      certificates: () => this.runCertificateCheck(),
      dns: () => this.runDNSCheck(),
      breaches: () => this.runBreachCheck(),
      dark_web: () => this.runDarkWebScan(),
      news: () => this.runNewsScan(),
      sanctions: () => this.runSanctionsCheck(),
    };

    const method = checkMethods[checkType];
    if (!method) {
      console.warn(`Unknown check type: ${checkType}`);
      return [];
    }

    const events = await method();

    this.checkResults.set(checkType, {
      timestamp: new Date(),
      success: true,
      eventsGenerated: events.length,
    });

    return events;
  }

  // ============================================================================
  // Check Implementations
  // ============================================================================

  async runSecurityPostureCheck(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];
    const dataSourceManager = this.serviceConfig.dataSourceManager;

    // Get vendor domain from storage
    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    // Get current security ratings
    const ratings = await dataSourceManager.getSecurityRatings(vendorInfo.domain);

    for (const rating of ratings) {
      // Check for score degradation
      const previousScore = await this.serviceConfig.storage.getPreviousSecurityScore(
        this.vendorId,
        rating.source,
      );

      if (previousScore !== null && rating.rating < previousScore - 10) {
        const event = this.createHealthEvent(
          'score_degradation',
          rating.rating < previousScore - 20 ? 'error' : 'warning',
          `Security score degradation detected`,
          `${rating.source} score dropped from ${previousScore} to ${rating.rating}`,
          { source: rating.source, previousScore, currentScore: rating.rating },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }

      // Check for critical issues
      for (const factor of rating.factors) {
        const criticalIssues = factor.issues.filter(i => i.severity === 'critical' && !i.resolved);
        for (const issue of criticalIssues) {
          const event = this.createHealthEvent(
            'security_incident',
            'critical',
            `Critical security issue: ${issue.title}`,
            issue.description,
            { source: rating.source, category: factor.name, issue },
          );
          events.push(event);
          this.service.emitHealthEvent(this.vendorId, event);
        }
      }

      // Store current score
      await this.serviceConfig.storage.saveSecurityScore(
        this.vendorId,
        rating.source,
        rating.rating,
      );
    }

    return events;
  }

  async runCertificateCheck(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];
    const dataSourceManager = this.serviceConfig.dataSourceManager;

    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    const certificates = await dataSourceManager.getCertificateInfo(vendorInfo.domain);

    for (const cert of certificates) {
      // Check for expiring certificates
      if (cert.daysUntilExpiry <= 0) {
        const event = this.createHealthEvent(
          'certificate_expired',
          'critical',
          `SSL Certificate expired`,
          `Certificate for ${cert.domain} expired on ${cert.validTo.toISOString()}`,
          { certificate: cert },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      } else if (cert.daysUntilExpiry <= 30) {
        const event = this.createHealthEvent(
          'certificate_expiring',
          cert.daysUntilExpiry <= 7 ? 'error' : 'warning',
          `SSL Certificate expiring soon`,
          `Certificate for ${cert.domain} expires in ${cert.daysUntilExpiry} days`,
          { certificate: cert },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }

      // Check for weak algorithms
      const weakAlgorithms = ['MD5', 'SHA1', 'MD2'];
      if (weakAlgorithms.some(alg => cert.algorithm.toUpperCase().includes(alg))) {
        const event = this.createHealthEvent(
          'security_incident',
          'warning',
          `Weak certificate algorithm detected`,
          `Certificate for ${cert.domain} uses ${cert.algorithm}`,
          { certificate: cert },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }

      // Check for small key sizes
      if (cert.keySize < 2048) {
        const event = this.createHealthEvent(
          'security_incident',
          'warning',
          `Small certificate key size detected`,
          `Certificate for ${cert.domain} has key size of ${cert.keySize} bits`,
          { certificate: cert },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }
    }

    return events;
  }

  async runDNSCheck(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];

    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    // Get current DNS records
    const currentRecords = await this.fetchDNSRecords(vendorInfo.domain);
    const previousRecords = await this.serviceConfig.storage.getPreviousDNSRecords(this.vendorId);

    if (previousRecords) {
      // Check for NS changes
      const nsChanged = this.compareDNSRecords(
        currentRecords.filter(r => r.type === 'NS'),
        previousRecords.filter(r => r.type === 'NS'),
      );

      if (nsChanged) {
        const event = this.createHealthEvent(
          'dns_change',
          'warning',
          `DNS nameserver change detected`,
          `Nameserver records for ${vendorInfo.domain} have changed`,
          { domain: vendorInfo.domain, previousNS: previousRecords.filter(r => r.type === 'NS'), currentNS: currentRecords.filter(r => r.type === 'NS') },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }

      // Check for MX changes
      const mxChanged = this.compareDNSRecords(
        currentRecords.filter(r => r.type === 'MX'),
        previousRecords.filter(r => r.type === 'MX'),
      );

      if (mxChanged) {
        const event = this.createHealthEvent(
          'dns_change',
          'info',
          `DNS MX record change detected`,
          `Mail server records for ${vendorInfo.domain} have changed`,
          { domain: vendorInfo.domain },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }
    }

    // Check domain expiration
    const domainInfo = await this.fetchDomainInfo(vendorInfo.domain);
    if (domainInfo && domainInfo.expirationDate) {
      const daysUntilExpiry = Math.floor(
        (domainInfo.expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilExpiry <= 30) {
        const event = this.createHealthEvent(
          'domain_expiring',
          daysUntilExpiry <= 7 ? 'error' : 'warning',
          `Domain expiring soon`,
          `Domain ${vendorInfo.domain} expires in ${daysUntilExpiry} days`,
          { domain: vendorInfo.domain, expirationDate: domainInfo.expirationDate },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }
    }

    // Store current DNS records
    await this.serviceConfig.storage.saveDNSRecords(this.vendorId, currentRecords);

    return events;
  }

  async runBreachCheck(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];
    const dataSourceManager = this.serviceConfig.dataSourceManager;

    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    const breaches = await dataSourceManager.getBreachRecords(vendorInfo.domain);
    const knownBreaches = await this.serviceConfig.storage.getKnownBreaches(this.vendorId);
    const knownBreachIds = new Set(knownBreaches.map(b => b.id));

    for (const breach of breaches) {
      if (!knownBreachIds.has(breach.id)) {
        // New breach detected
        const event = this.createHealthEvent(
          'breach_disclosure',
          this.getBreachSeverity(breach),
          `Data breach detected`,
          `${vendorInfo.name} involved in data breach: ${breach.description}`,
          { breach },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);

        // Store the breach
        await this.serviceConfig.storage.saveKnownBreach(this.vendorId, breach);
      }
    }

    return events;
  }

  async runDarkWebScan(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];
    const dataSourceManager = this.serviceConfig.dataSourceManager;

    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    const mentions = await dataSourceManager.scanDarkWeb(vendorInfo.domain);
    const knownMentions = await this.serviceConfig.storage.getKnownDarkWebMentions(this.vendorId);
    const knownMentionIds = new Set(knownMentions.map(m => m.id));

    for (const mention of mentions) {
      if (!knownMentionIds.has(mention.id)) {
        const severity = this.getDarkWebMentionSeverity(mention);

        const event = this.createHealthEvent(
          'dark_web_mention',
          severity,
          `Dark web mention detected`,
          `${mention.mentionType} related to ${vendorInfo.name} found`,
          { mention },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);

        // Store the mention
        await this.serviceConfig.storage.saveKnownDarkWebMention(this.vendorId, mention);
      }
    }

    return events;
  }

  async runNewsScan(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];

    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    // Fetch and analyze news (simplified implementation)
    const newsItems = await this.fetchSecurityNews(vendorInfo.name);

    for (const item of newsItems) {
      if (item.sentiment < -0.7 && item.isSecurityRelated) {
        const event = this.createHealthEvent(
          'negative_news',
          'warning',
          `Negative security news detected`,
          item.headline,
          { article: item },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }
    }

    return events;
  }

  async runSanctionsCheck(): Promise<HealthEvent[]> {
    const events: HealthEvent[] = [];
    const dataSourceManager = this.serviceConfig.dataSourceManager;

    const vendorInfo = await this.serviceConfig.storage.getVendorInfo(this.vendorId);
    if (!vendorInfo) return events;

    const matches = await dataSourceManager.checkSanctions(vendorInfo.legalName, 'company');

    for (const match of matches) {
      if (match.matchScore > 0.8) {
        const event = this.createHealthEvent(
          'sanctions_match',
          match.matchScore > 0.95 ? 'critical' : 'error',
          `Sanctions list match detected`,
          `${vendorInfo.name} matches ${match.source} sanctions list (${Math.round(match.matchScore * 100)}% confidence)`,
          { match },
        );
        events.push(event);
        this.service.emitHealthEvent(this.vendorId, event);
      }
    }

    return events;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createHealthEvent(
    type: HealthEventType,
    severity: HealthEvent['severity'],
    title: string,
    description: string,
    metadata: Record<string, unknown>,
  ): HealthEvent {
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      vendorId: this.vendorId,
      type,
      severity,
      title,
      description,
      source: 'continuous_monitoring',
      detectedAt: new Date(),
      impact: this.assessImpact(type, severity),
      metadata,
    };
  }

  private assessImpact(type: HealthEventType, severity: HealthEvent['severity']): string {
    const impactMap: Record<HealthEventType, Record<HealthEvent['severity'], string>> = {
      security_incident: {
        critical: 'Immediate security threat to organization',
        error: 'Significant security concern requiring action',
        warning: 'Potential security issue requiring monitoring',
        info: 'Security information for awareness',
      },
      breach_disclosure: {
        critical: 'Major data breach affecting sensitive data',
        error: 'Data breach with significant exposure',
        warning: 'Data breach with limited exposure',
        info: 'Historical breach for awareness',
      },
      certificate_expiring: {
        critical: 'Service disruption imminent',
        error: 'Service disruption likely within days',
        warning: 'Certificate renewal needed soon',
        info: 'Certificate renewal reminder',
      },
      certificate_expired: {
        critical: 'Active service disruption possible',
        error: 'Service may be affected',
        warning: 'Certificate expired but may not be in use',
        info: 'Expired certificate detected',
      },
      dns_change: {
        critical: 'Potential domain hijacking',
        error: 'Significant DNS infrastructure change',
        warning: 'DNS configuration change detected',
        info: 'Minor DNS change detected',
      },
      domain_expiring: {
        critical: 'Domain loss imminent',
        error: 'Domain expires within days',
        warning: 'Domain renewal needed',
        info: 'Domain renewal reminder',
      },
      compliance_gap: {
        critical: 'Major compliance violation',
        error: 'Significant compliance gap',
        warning: 'Compliance concern identified',
        info: 'Minor compliance observation',
      },
      score_degradation: {
        critical: 'Severe trust score decline',
        error: 'Significant trust score decline',
        warning: 'Trust score declining',
        info: 'Minor score fluctuation',
      },
      sla_breach: {
        critical: 'Critical SLA violation',
        error: 'SLA breach detected',
        warning: 'SLA at risk',
        info: 'SLA performance note',
      },
      service_outage: {
        critical: 'Complete service unavailable',
        error: 'Partial service outage',
        warning: 'Service degradation',
        info: 'Transient service issue',
      },
      dark_web_mention: {
        critical: 'Active data sale or credentials dump',
        error: 'Significant dark web exposure',
        warning: 'Dark web mention detected',
        info: 'Dark web discussion noted',
      },
      sanctions_match: {
        critical: 'High-confidence sanctions match',
        error: 'Probable sanctions match',
        warning: 'Potential sanctions match',
        info: 'Low-confidence sanctions match',
      },
      negative_news: {
        critical: 'Major security incident in news',
        error: 'Significant negative coverage',
        warning: 'Negative news detected',
        info: 'News mention for awareness',
      },
      financial_alert: {
        critical: 'Bankruptcy or major financial crisis',
        error: 'Significant financial concern',
        warning: 'Financial stability concern',
        info: 'Financial news for awareness',
      },
    };

    return impactMap[type]?.[severity] || 'Impact assessment pending';
  }

  private getBreachSeverity(breach: { recordsAffected?: number; dataTypes: string[] }): HealthEvent['severity'] {
    const sensitiveTypes = ['passwords', 'financial', 'health', 'ssn', 'credit_card'];
    const hasSensitiveData = breach.dataTypes.some(t =>
      sensitiveTypes.some(s => t.toLowerCase().includes(s)),
    );

    if (hasSensitiveData && (breach.recordsAffected || 0) > 100000) return 'critical';
    if (hasSensitiveData || (breach.recordsAffected || 0) > 1000000) return 'error';
    if ((breach.recordsAffected || 0) > 10000) return 'warning';
    return 'info';
  }

  private getDarkWebMentionSeverity(mention: DarkWebMention): HealthEvent['severity'] {
    if (mention.mentionType === 'credential_dump' && mention.confidence > 0.8) return 'critical';
    if (mention.mentionType === 'data_sale') return 'error';
    if (mention.mentionType === 'credential_dump') return 'error';
    if (mention.mentionType === 'exploit') return 'warning';
    return 'info';
  }

  private async fetchDNSRecords(domain: string): Promise<DNSRecord[]> {
    const dns = await import('node:dns');
    const resolver = new dns.promises.Resolver();
    const records: DNSRecord[] = [];

    // Resolve A records
    try {
      const addresses = await resolver.resolve4(domain, { ttl: true });
      for (const addr of addresses) {
        records.push({ type: 'A', value: addr.address, ttl: addr.ttl ?? 3600 });
      }
    } catch { /* record type may not exist */ }

    // Resolve NS records
    try {
      const ns = await resolver.resolveNs(domain);
      for (const name of ns) {
        records.push({ type: 'NS', value: name, ttl: 86400 });
      }
    } catch { /* record type may not exist */ }

    // Resolve MX records
    try {
      const mx = await resolver.resolveMx(domain);
      for (const entry of mx) {
        records.push({ type: 'MX', value: `${entry.priority} ${entry.exchange}`, ttl: 3600 });
      }
    } catch { /* record type may not exist */ }

    return records;
  }

  private async fetchDomainInfo(domain: string): Promise<DomainInfo | null> {
    // WHOIS requires a third-party library or external API.
    // Return partial info derived from DNS when WHOIS is unavailable.
    return {
      domain,
      registrar: 'WHOIS lookup requires external integration',
      creationDate: new Date(0),
      expirationDate: new Date(0),
      updatedDate: new Date(),
    };
  }

  private async fetchSecurityNews(vendorName: string): Promise<NewsItem[]> {
    // News API implementation
    // In production, integrate with news APIs
    return [];
  }

  private compareDNSRecords(current: DNSRecord[], previous: DNSRecord[]): boolean {
    if (current.length !== previous.length) return true;

    const currentValues = new Set(current.map(r => `${r.type}:${r.value}`));
    const previousValues = new Set(previous.map(r => `${r.type}:${r.value}`));

    for (const value of currentValues) {
      if (!previousValues.has(value)) return true;
    }

    return false;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface MonitoringStatus {
  vendorId: string;
  running: boolean;
  config: MonitoringConfig;
  checkResults: Record<string, CheckResult>;
  lastActivity: Date | null;
}

export interface CheckResult {
  timestamp: Date;
  success: boolean;
  eventsGenerated: number;
  error?: string;
}

export interface HealthEventQueryOptions {
  startDate?: Date;
  endDate?: Date;
  types?: HealthEventType[];
  severities?: HealthEvent['severity'][];
  limit?: number;
  offset?: number;
}

export interface HealthEventStats {
  total: number;
  bySeverity: Record<HealthEvent['severity'], number>;
  byType: Record<HealthEventType, number>;
  resolved: number;
  unresolved: number;
  averageResolutionTime: number;
}

interface DNSRecord {
  type: string;
  value: string;
  ttl: number;
}

interface DomainInfo {
  domain: string;
  registrar: string;
  creationDate: Date;
  expirationDate: Date;
  updatedDate: Date;
}

interface NewsItem {
  headline: string;
  source: string;
  publishedAt: Date;
  sentiment: number;
  isSecurityRelated: boolean;
  url: string;
}

// ============================================================================
// Storage Interface
// ============================================================================

export interface MonitoringStorage {
  // Vendor info
  getVendorInfo(vendorId: string): Promise<VendorInfo | null>;

  // Health events
  saveHealthEvent(event: HealthEvent): Promise<void>;
  getHealthEvents(vendorId: string, options: HealthEventQueryOptions): Promise<HealthEvent[]>;

  // Security scores
  getPreviousSecurityScore(vendorId: string, source: string): Promise<number | null>;
  saveSecurityScore(vendorId: string, source: string, score: number): Promise<void>;

  // DNS records
  getPreviousDNSRecords(vendorId: string): Promise<DNSRecord[] | null>;
  saveDNSRecords(vendorId: string, records: DNSRecord[]): Promise<void>;

  // Breaches
  getKnownBreaches(vendorId: string): Promise<{ id: string }[]>;
  saveKnownBreach(vendorId: string, breach: { id: string }): Promise<void>;

  // Dark web mentions
  getKnownDarkWebMentions(vendorId: string): Promise<DarkWebMention[]>;
  saveKnownDarkWebMention(vendorId: string, mention: DarkWebMention): Promise<void>;
}

// ============================================================================
// Alert Dispatcher Interface
// ============================================================================

export interface AlertDispatcher {
  dispatchIfNeeded(event: HealthEvent): Promise<void>;
}

// ============================================================================
// Error Class
// ============================================================================

export class MonitoringError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MonitoringError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createContinuousMonitoringService(
  config: ContinuousMonitoringConfig,
): ContinuousMonitoringService {
  return new ContinuousMonitoringService(config);
}

export function getDefaultPollingIntervals(): PollingIntervals {
  return {
    securityPosture: 6 * 60 * 60 * 1000, // 6 hours
    certificates: 24 * 60 * 60 * 1000, // 24 hours
    dns: 24 * 60 * 60 * 1000, // 24 hours
    breaches: 12 * 60 * 60 * 1000, // 12 hours
    darkWeb: 24 * 60 * 60 * 1000, // 24 hours
    news: 6 * 60 * 60 * 1000, // 6 hours
    sanctions: 24 * 60 * 60 * 1000, // 24 hours
  };
}
