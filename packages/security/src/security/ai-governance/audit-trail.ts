/**
 * AI Audit Trail
 * Comprehensive logging and compliance reporting for AI operations
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  AIAuditLogEntry,
  AIAuditAction,
  QueryAuditData,
  ResponseAuditData,
  TokenUsage,
  CostAttribution,
  AuditMetadata,
  AuditLevel,
  ComplianceReport,
  ComplianceSummary,
  ComplianceDetails,
  ViolationSummary,
  InjectionDetectionResult,
  OutputFilterResult,
} from './types';

/**
 * Audit configuration
 */
export interface AuditConfig {
  enabled: boolean;
  defaultAuditLevel: AuditLevel;
  logQueries: boolean;
  logResponses: boolean;
  hashSensitiveData: boolean;
  retentionDays: number;
  maxEntriesInMemory: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  currency: string;
  complianceFrameworks: string[];
  alertOnAnomalies: boolean;
  anomalyThresholds: AnomalyThresholds;
}

/**
 * Anomaly detection thresholds
 */
export interface AnomalyThresholds {
  maxQueriesPerMinute: number;
  maxTokensPerQuery: number;
  maxCostPerQuery: number;
  injectionRateThreshold: number;
}

/**
 * Audit query options
 */
export interface AuditQueryOptions {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  modelId?: string;
  action?: AIAuditAction | AIAuditAction[];
  sessionId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'cost' | 'tokens';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Audit storage interface
 */
export interface AuditStorage {
  save(entry: AIAuditLogEntry): Promise<void>;
  get(id: string): Promise<AIAuditLogEntry | null>;
  query(options: AuditQueryOptions): Promise<AIAuditLogEntry[]>;
  count(options: AuditQueryOptions): Promise<number>;
  delete(id: string): Promise<void>;
  deleteOlderThan(date: Date): Promise<number>;
  getAggregatedStats(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalQueries: number;
    totalTokens: number;
    totalCost: number;
    uniqueUsers: number;
    actionCounts: Record<string, number>;
  }>;
}

/**
 * In-memory audit storage implementation
 */
export class InMemoryAuditStorage implements AuditStorage {
  private entries: Map<string, AIAuditLogEntry> = new Map();
  private maxEntries: number;

  constructor(maxEntries: number = 100000) {
    this.maxEntries = maxEntries;
  }

  async save(entry: AIAuditLogEntry): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.entries.size >= this.maxEntries) {
      const sortedEntries = Array.from(this.entries.entries()).sort(
        ([, a], [, b]) => a.timestamp.getTime() - b.timestamp.getTime()
      );
      const toRemove = sortedEntries.slice(0, Math.floor(this.maxEntries * 0.1));
      for (const [id] of toRemove) {
        this.entries.delete(id);
      }
    }
    this.entries.set(entry.id, { ...entry });
  }

  async get(id: string): Promise<AIAuditLogEntry | null> {
    const entry = this.entries.get(id);
    return entry ? { ...entry } : null;
  }

  async query(options: AuditQueryOptions): Promise<AIAuditLogEntry[]> {
    let results = Array.from(this.entries.values());

    // Apply filters
    if (options.startDate) {
      results = results.filter((e) => e.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      results = results.filter((e) => e.timestamp <= options.endDate!);
    }
    if (options.userId) {
      results = results.filter((e) => e.userId === options.userId);
    }
    if (options.modelId) {
      results = results.filter((e) => e.modelId === options.modelId);
    }
    if (options.action) {
      const actions = Array.isArray(options.action) ? options.action : [options.action];
      results = results.filter((e) => actions.includes(e.action));
    }
    if (options.sessionId) {
      results = results.filter((e) => e.sessionId === options.sessionId);
    }

    // Sort
    const sortBy = options.sortBy || 'timestamp';
    const sortOrder = options.sortOrder || 'desc';
    results.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'timestamp':
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
          break;
        case 'cost':
          comparison = a.cost.totalCost - b.cost.totalCost;
          break;
        case 'tokens':
          comparison = a.tokenUsage.totalTokens - b.tokenUsage.totalTokens;
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 100;
    return results.slice(offset, offset + limit).map((e) => ({ ...e }));
  }

  async count(options: AuditQueryOptions): Promise<number> {
    let results = Array.from(this.entries.values());

    if (options.startDate) {
      results = results.filter((e) => e.timestamp >= options.startDate!);
    }
    if (options.endDate) {
      results = results.filter((e) => e.timestamp <= options.endDate!);
    }
    if (options.userId) {
      results = results.filter((e) => e.userId === options.userId);
    }
    if (options.modelId) {
      results = results.filter((e) => e.modelId === options.modelId);
    }
    if (options.action) {
      const actions = Array.isArray(options.action) ? options.action : [options.action];
      results = results.filter((e) => actions.includes(e.action));
    }

    return results.length;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async deleteOlderThan(date: Date): Promise<number> {
    let deleted = 0;
    for (const [id, entry] of this.entries.entries()) {
      if (entry.timestamp < date) {
        this.entries.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async getAggregatedStats(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalQueries: number;
    totalTokens: number;
    totalCost: number;
    uniqueUsers: number;
    actionCounts: Record<string, number>;
  }> {
    const entries = Array.from(this.entries.values()).filter(
      (e) => e.timestamp >= startDate && e.timestamp <= endDate
    );

    const userIds = new Set<string>();
    const actionCounts: Record<string, number> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const entry of entries) {
      userIds.add(entry.userId);
      totalTokens += entry.tokenUsage.totalTokens;
      totalCost += entry.cost.totalCost;
      actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
    }

    return {
      totalQueries: entries.length,
      totalTokens,
      totalCost,
      uniqueUsers: userIds.size,
      actionCounts,
    };
  }
}

/**
 * AI Audit Trail Manager
 * Manages comprehensive audit logging for AI operations
 */
export class AuditTrail extends EventEmitter {
  private config: AuditConfig;
  private storage: AuditStorage;
  private recentQueries: Map<string, Date[]> = new Map();

  constructor(config?: Partial<AuditConfig>, storage?: AuditStorage) {
    super();
    this.config = {
      enabled: true,
      defaultAuditLevel: 'detailed',
      logQueries: true,
      logResponses: true,
      hashSensitiveData: false,
      retentionDays: 90,
      maxEntriesInMemory: 100000,
      costPerInputToken: 0.00001,
      costPerOutputToken: 0.00003,
      currency: 'USD',
      complianceFrameworks: ['SOC2', 'GDPR', 'HIPAA'],
      alertOnAnomalies: true,
      anomalyThresholds: {
        maxQueriesPerMinute: 60,
        maxTokensPerQuery: 100000,
        maxCostPerQuery: 10.0,
        injectionRateThreshold: 0.05,
      },
      ...config,
    };
    this.storage = storage || new InMemoryAuditStorage(this.config.maxEntriesInMemory);
  }

  /**
   * Generate a unique audit entry ID
   */
  private generateId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Log a query
   */
  async logQuery(params: {
    modelId: string;
    userId: string;
    sessionId: string;
    query: QueryAuditData;
    tokenUsage: TokenUsage;
    auditLevel?: AuditLevel;
    metadata?: Partial<AuditMetadata>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AIAuditLogEntry> {
    if (!this.config.enabled) {
      return this.createDisabledEntry(params);
    }

    const auditLevel = params.auditLevel || this.config.defaultAuditLevel;
    const cost = this.calculateCost(params.tokenUsage);

    // Check for anomalies
    await this.checkForAnomalies(params.userId, params.modelId, params.tokenUsage, cost);

    const entry: AIAuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      modelId: params.modelId,
      userId: params.userId,
      sessionId: params.sessionId,
      action: params.query.injectionDetectionResult?.blocked ? 'query-blocked' : 'query',
      query: this.processQueryData(params.query, auditLevel),
      tokenUsage: params.tokenUsage,
      cost,
      metadata: {
        environment: process.env.NODE_ENV || 'development',
        ...params.metadata,
      },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    };

    // Add risk indicators
    if (params.query.injectionDetectionResult?.isInjectionAttempt) {
      entry.riskIndicators = ['injection-attempt'];
      entry.action = 'injection-detected';
    }

    await this.storage.save(entry);
    this.emit('audit:logged', entry);

    return entry;
  }

  /**
   * Log a response
   */
  async logResponse(params: {
    modelId: string;
    userId: string;
    sessionId: string;
    response: ResponseAuditData;
    tokenUsage: TokenUsage;
    auditLevel?: AuditLevel;
    metadata?: Partial<AuditMetadata>;
  }): Promise<AIAuditLogEntry> {
    if (!this.config.enabled) {
      return this.createDisabledEntry(params);
    }

    const auditLevel = params.auditLevel || this.config.defaultAuditLevel;
    const cost = this.calculateCost(params.tokenUsage);

    const entry: AIAuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      modelId: params.modelId,
      userId: params.userId,
      sessionId: params.sessionId,
      action: params.response.filterResult?.blocked ? 'response-filtered' : 'response',
      response: this.processResponseData(params.response, auditLevel),
      tokenUsage: params.tokenUsage,
      cost,
      metadata: {
        environment: process.env.NODE_ENV || 'development',
        ...params.metadata,
      },
    };

    // Add risk indicators for filtered responses
    if (params.response.filterResult?.piiDetected.length) {
      entry.riskIndicators = entry.riskIndicators || [];
      entry.riskIndicators.push('pii-detected');
    }

    await this.storage.save(entry);
    this.emit('audit:logged', entry);

    return entry;
  }

  /**
   * Log a policy violation
   */
  async logPolicyViolation(params: {
    modelId: string;
    userId: string;
    sessionId: string;
    violation: string;
    policyField: string;
    metadata?: Partial<AuditMetadata>;
    ipAddress?: string;
  }): Promise<AIAuditLogEntry> {
    const entry: AIAuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      modelId: params.modelId,
      userId: params.userId,
      sessionId: params.sessionId,
      action: 'policy-violation',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { totalCost: 0, currency: this.config.currency, breakdown: { promptCost: 0, completionCost: 0 } },
      metadata: {
        environment: process.env.NODE_ENV || 'development',
        customFields: { violation: params.violation, policyField: params.policyField },
        ...params.metadata,
      },
      riskIndicators: ['policy-violation'],
      ipAddress: params.ipAddress,
    };

    await this.storage.save(entry);
    this.emit('audit:logged', entry);
    this.emit('policy:violated', entry);

    return entry;
  }

  /**
   * Log rate limit exceeded
   */
  async logRateLimitExceeded(params: {
    modelId: string;
    userId: string;
    sessionId: string;
    limitType: string;
    currentUsage: number;
    limit: number;
    metadata?: Partial<AuditMetadata>;
  }): Promise<AIAuditLogEntry> {
    const entry: AIAuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      modelId: params.modelId,
      userId: params.userId,
      sessionId: params.sessionId,
      action: 'rate-limit-exceeded',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { totalCost: 0, currency: this.config.currency, breakdown: { promptCost: 0, completionCost: 0 } },
      metadata: {
        environment: process.env.NODE_ENV || 'development',
        customFields: {
          limitType: params.limitType,
          currentUsage: params.currentUsage,
          limit: params.limit,
        },
        ...params.metadata,
      },
      riskIndicators: ['rate-limit-exceeded'],
    };

    await this.storage.save(entry);
    this.emit('audit:logged', entry);

    return entry;
  }

  /**
   * Query audit logs
   */
  async queryLogs(options: AuditQueryOptions): Promise<AIAuditLogEntry[]> {
    return this.storage.query(options);
  }

  /**
   * Get audit entry by ID
   */
  async getEntry(id: string): Promise<AIAuditLogEntry | null> {
    return this.storage.get(id);
  }

  /**
   * Count audit entries
   */
  async countEntries(options: AuditQueryOptions): Promise<number> {
    return this.storage.count(options);
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(
    modelId: string,
    reportType: ComplianceReport['reportType'],
    period: { start: Date; end: Date }
  ): Promise<ComplianceReport> {
    const stats = await this.storage.getAggregatedStats(period.start, period.end);

    // Get detailed breakdown
    const allEntries = await this.storage.query({
      modelId,
      startDate: period.start,
      endDate: period.end,
      limit: 100000,
    });

    // Calculate metrics
    const blockedQueries = allEntries.filter(
      (e) => e.action === 'query-blocked' || e.action === 'response-filtered'
    ).length;

    const policyViolations = allEntries.filter((e) => e.action === 'policy-violation').length;

    const biasAlerts = allEntries.filter(
      (e) => e.action === 'bias-detected'
    ).length;

    const injectionAttempts = allEntries.filter(
      (e) => e.action === 'injection-detected'
    ).length;

    const responseTimes = allEntries
      .filter((e) => e.response?.latencyMs)
      .map((e) => e.response!.latencyMs);
    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    const summary: ComplianceSummary = {
      totalQueries: stats.totalQueries,
      blockedQueries,
      filteredResponses: allEntries.filter((e) => e.action === 'response-filtered').length,
      policyViolations,
      biasAlerts,
      injectionAttempts,
      averageResponseTime,
      totalCost: stats.totalCost,
      uniqueUsers: stats.uniqueUsers,
    };

    // Calculate compliance scores
    const accessControlCompliance = this.calculateAccessControlCompliance(allEntries);
    const dataProtectionCompliance = this.calculateDataProtectionCompliance(allEntries);
    const auditingCompliance = this.calculateAuditingCompliance(allEntries);
    const biasMonitoringCompliance = this.calculateBiasMonitoringCompliance(allEntries);

    // Get top violations
    const violationsByType: Record<string, { count: number; lastOccurrence: Date }> = {};
    for (const entry of allEntries) {
      if (entry.riskIndicators) {
        for (const indicator of entry.riskIndicators) {
          if (!violationsByType[indicator]) {
            violationsByType[indicator] = { count: 0, lastOccurrence: entry.timestamp };
          }
          violationsByType[indicator].count++;
          if (entry.timestamp > violationsByType[indicator].lastOccurrence) {
            violationsByType[indicator].lastOccurrence = entry.timestamp;
          }
        }
      }
    }

    const topViolations: ViolationSummary[] = Object.entries(violationsByType)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([type, data]) => ({
        type,
        count: data.count,
        severity: this.getViolationSeverity(type),
        lastOccurrence: data.lastOccurrence,
      }));

    const details: ComplianceDetails = {
      accessControlCompliance,
      dataProtectionCompliance,
      auditingCompliance,
      biasMonitoringCompliance,
      incidentCount: policyViolations + injectionAttempts,
      incidentsByCategory: stats.actionCounts,
      topViolations,
    };

    const overallScore =
      (accessControlCompliance +
        dataProtectionCompliance +
        auditingCompliance +
        biasMonitoringCompliance) /
      4;

    const status: ComplianceReport['status'] =
      overallScore >= 0.9 ? 'compliant' : overallScore >= 0.7 ? 'needs-review' : 'non-compliant';

    const recommendations = this.generateComplianceRecommendations(summary, details, overallScore);

    const report: ComplianceReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      modelId,
      reportType,
      generatedAt: new Date(),
      period,
      summary,
      details,
      recommendations,
      overallScore,
      status,
    };

    this.emit('compliance:report', report);

    return report;
  }

  /**
   * Clean up old audit entries
   */
  async cleanup(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    return this.storage.deleteOlderThan(cutoffDate);
  }

  /**
   * Calculate cost from token usage
   */
  private calculateCost(tokenUsage: TokenUsage): CostAttribution {
    const promptCost = tokenUsage.promptTokens * this.config.costPerInputToken;
    const completionCost = tokenUsage.completionTokens * this.config.costPerOutputToken;

    return {
      totalCost: promptCost + completionCost,
      currency: this.config.currency,
      breakdown: {
        promptCost,
        completionCost,
      },
    };
  }

  /**
   * Process query data based on audit level
   */
  private processQueryData(query: QueryAuditData, auditLevel: AuditLevel): QueryAuditData | undefined {
    if (!this.config.logQueries) return undefined;
    if (auditLevel === 'none') return undefined;

    const processed: QueryAuditData = {
      prompt: auditLevel === 'basic' ? '[LOGGED]' : query.prompt,
      templateId: query.templateId,
      parameters: auditLevel === 'full' ? query.parameters : undefined,
      injectionDetectionResult: query.injectionDetectionResult,
    };

    if (auditLevel !== 'full' && query.sanitizedPrompt) {
      processed.sanitizedPrompt = query.sanitizedPrompt;
    }

    return processed;
  }

  /**
   * Process response data based on audit level
   */
  private processResponseData(
    response: ResponseAuditData,
    auditLevel: AuditLevel
  ): ResponseAuditData | undefined {
    if (!this.config.logResponses) return undefined;
    if (auditLevel === 'none') return undefined;

    const processed: ResponseAuditData = {
      response: auditLevel === 'basic' ? '[LOGGED]' : response.response,
      latencyMs: response.latencyMs,
      modelVersion: response.modelVersion,
    };

    if (response.filteredResponse && auditLevel !== 'basic') {
      processed.filteredResponse = response.filteredResponse;
    }

    if (response.filterResult && auditLevel === 'full') {
      processed.filterResult = response.filterResult;
    }

    return processed;
  }

  /**
   * Check for anomalies in request patterns
   */
  private async checkForAnomalies(
    userId: string,
    modelId: string,
    tokenUsage: TokenUsage,
    cost: CostAttribution
  ): Promise<void> {
    if (!this.config.alertOnAnomalies) return;

    const key = `${userId}:${modelId}`;
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    // Track recent queries
    if (!this.recentQueries.has(key)) {
      this.recentQueries.set(key, []);
    }
    const queries = this.recentQueries.get(key)!;
    queries.push(now);

    // Clean old entries
    const recentQueries = queries.filter((q) => q > oneMinuteAgo);
    this.recentQueries.set(key, recentQueries);

    // Check query rate
    if (recentQueries.length > this.config.anomalyThresholds.maxQueriesPerMinute) {
      this.emit('anomaly:detected', {
        type: 'high-query-rate',
        userId,
        modelId,
        value: recentQueries.length,
        threshold: this.config.anomalyThresholds.maxQueriesPerMinute,
      });
    }

    // Check token usage
    if (tokenUsage.totalTokens > this.config.anomalyThresholds.maxTokensPerQuery) {
      this.emit('anomaly:detected', {
        type: 'high-token-usage',
        userId,
        modelId,
        value: tokenUsage.totalTokens,
        threshold: this.config.anomalyThresholds.maxTokensPerQuery,
      });
    }

    // Check cost
    if (cost.totalCost > this.config.anomalyThresholds.maxCostPerQuery) {
      this.emit('anomaly:detected', {
        type: 'high-cost',
        userId,
        modelId,
        value: cost.totalCost,
        threshold: this.config.anomalyThresholds.maxCostPerQuery,
      });
    }
  }

  /**
   * Create a placeholder entry when audit is disabled
   */
  private createDisabledEntry(params: { modelId: string; userId: string; sessionId: string }): AIAuditLogEntry {
    return {
      id: 'disabled',
      timestamp: new Date(),
      modelId: params.modelId,
      userId: params.userId,
      sessionId: params.sessionId,
      action: 'query',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { totalCost: 0, currency: this.config.currency, breakdown: { promptCost: 0, completionCost: 0 } },
      metadata: { environment: 'disabled' },
    };
  }

  /**
   * Calculate access control compliance score
   */
  private calculateAccessControlCompliance(entries: AIAuditLogEntry[]): number {
    const accessDenied = entries.filter((e) => e.action === 'access-denied').length;
    const total = entries.length;
    if (total === 0) return 1.0;
    return Math.max(0, 1 - accessDenied / total);
  }

  /**
   * Calculate data protection compliance score
   */
  private calculateDataProtectionCompliance(entries: AIAuditLogEntry[]): number {
    const piiIncidents = entries.filter(
      (e) => e.riskIndicators?.includes('pii-detected')
    ).length;
    const total = entries.length;
    if (total === 0) return 1.0;
    return Math.max(0, 1 - (piiIncidents * 2) / total);
  }

  /**
   * Calculate auditing compliance score
   */
  private calculateAuditingCompliance(entries: AIAuditLogEntry[]): number {
    // Check if entries have proper metadata
    const properlyAudited = entries.filter(
      (e) => e.metadata && e.metadata.environment && e.tokenUsage
    ).length;
    const total = entries.length;
    if (total === 0) return 1.0;
    return properlyAudited / total;
  }

  /**
   * Calculate bias monitoring compliance score
   */
  private calculateBiasMonitoringCompliance(entries: AIAuditLogEntry[]): number {
    const biasIncidents = entries.filter((e) => e.action === 'bias-detected').length;
    const total = entries.length;
    if (total === 0) return 1.0;
    return Math.max(0, 1 - (biasIncidents * 3) / total);
  }

  /**
   * Get violation severity
   */
  private getViolationSeverity(type: string): 'low' | 'medium' | 'high' | 'critical' {
    const severities: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
      'injection-attempt': 'critical',
      'pii-detected': 'high',
      'policy-violation': 'high',
      'rate-limit-exceeded': 'medium',
      'bias-detected': 'high',
    };
    return severities[type] || 'medium';
  }

  /**
   * Generate compliance recommendations
   */
  private generateComplianceRecommendations(
    summary: ComplianceSummary,
    details: ComplianceDetails,
    overallScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (summary.injectionAttempts > 0) {
      recommendations.push(
        `${summary.injectionAttempts} injection attempts detected. Review prompt injection defenses.`
      );
    }

    if (summary.policyViolations > 0) {
      recommendations.push(
        `${summary.policyViolations} policy violations recorded. Review access policies.`
      );
    }

    if (details.dataProtectionCompliance < 0.9) {
      recommendations.push('Improve PII detection and redaction in output filtering.');
    }

    if (details.accessControlCompliance < 0.95) {
      recommendations.push('Review and tighten access control policies.');
    }

    if (summary.averageResponseTime > 5000) {
      recommendations.push('Average response time is high. Consider optimization.');
    }

    if (overallScore < 0.8) {
      recommendations.push('Overall compliance score is below target. Schedule security review.');
    }

    return recommendations;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AuditConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): AuditConfig {
    return { ...this.config };
  }

  /**
   * Get usage statistics for a user
   */
  async getUserStats(
    userId: string,
    period: { start: Date; end: Date }
  ): Promise<{
    totalQueries: number;
    totalTokens: number;
    totalCost: number;
    averageTokensPerQuery: number;
  }> {
    const entries = await this.storage.query({
      userId,
      startDate: period.start,
      endDate: period.end,
      limit: 100000,
    });

    const totalTokens = entries.reduce((sum, e) => sum + e.tokenUsage.totalTokens, 0);
    const totalCost = entries.reduce((sum, e) => sum + e.cost.totalCost, 0);

    return {
      totalQueries: entries.length,
      totalTokens,
      totalCost,
      averageTokensPerQuery: entries.length > 0 ? totalTokens / entries.length : 0,
    };
  }
}

export default AuditTrail;
