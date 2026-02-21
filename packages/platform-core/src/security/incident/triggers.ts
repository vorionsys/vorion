/**
 * Incident Triggers - Automatic Incident Creation from Alerts
 *
 * Maps alerts from various sources to incidents with appropriate severity,
 * type, and playbook selection.
 *
 * @packageDocumentation
 * @module security/incident/triggers
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../common/logger.js';
import {
  Alert,
  AlertRule,
  AlertCondition,
  IncidentType,
  IncidentSeverity,
  IncidentStatus,
  CreateIncidentInput,
  Playbook,
} from './types.js';
import type { AnomalyAlert, Anomaly, AnomalySeverity } from '../anomaly/types.js';

const logger = createLogger({ component: 'incident-triggers' });

// ============================================================================
// Trigger Configuration
// ============================================================================

export interface IncidentTriggerConfig {
  /** Whether automatic triggering is enabled */
  enabled: boolean;
  /** Default cooldown between similar incidents (seconds) */
  defaultCooldownSeconds: number;
  /** Whether to deduplicate alerts */
  deduplication: {
    enabled: boolean;
    windowMinutes: number;
    hashFields: string[];
  };
  /** Whether to auto-merge related incidents */
  autoMerge: {
    enabled: boolean;
    windowMinutes: number;
  };
  /** Severity escalation rules */
  severityEscalation: {
    enabled: boolean;
    /** Number of similar alerts before escalation */
    alertCountThreshold: number;
    /** Time window for alert counting (minutes) */
    windowMinutes: number;
  };
}

const DEFAULT_TRIGGER_CONFIG: IncidentTriggerConfig = {
  enabled: true,
  defaultCooldownSeconds: 300, // 5 minutes
  deduplication: {
    enabled: true,
    windowMinutes: 15,
    hashFields: ['source', 'type', 'userId', 'ipAddress'],
  },
  autoMerge: {
    enabled: true,
    windowMinutes: 30,
  },
  severityEscalation: {
    enabled: true,
    alertCountThreshold: 5,
    windowMinutes: 10,
  },
};

// ============================================================================
// Default Alert Rules
// ============================================================================

const defaultAlertRules: AlertRule[] = [
  // Anomaly Detection Rules
  {
    id: 'anomaly-impossible-travel',
    name: 'Impossible Travel Detected',
    enabled: true,
    conditions: [
      { field: 'source', operator: 'equals', value: 'anomaly_detector' },
      { field: 'type', operator: 'equals', value: 'impossible-travel' },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.ACCOUNT_COMPROMISE,
      severity: 'P2',
      titleTemplate: 'Account Compromise Suspected: {{title}}',
      descriptionTemplate: 'Impossible travel detected for user. {{description}}',
      tags: ['anomaly', 'impossible-travel', 'account-security'],
    },
    playbookId: 'playbook-account-compromise-v1',
    cooldownSeconds: 300,
    priority: 80,
  },
  {
    id: 'anomaly-volume-spike',
    name: 'Volume Spike Detected',
    enabled: true,
    conditions: [
      { field: 'source', operator: 'equals', value: 'anomaly_detector' },
      { field: 'type', operator: 'equals', value: 'volume-spike' },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.DENIAL_OF_SERVICE,
      severity: 'P3',
      titleTemplate: 'Traffic Anomaly: {{title}}',
      descriptionTemplate: 'Unusual traffic volume detected. {{description}}',
      tags: ['anomaly', 'volume', 'traffic'],
    },
    cooldownSeconds: 600,
    priority: 60,
  },
  {
    id: 'anomaly-failed-auth-spike',
    name: 'Failed Authentication Spike',
    enabled: true,
    conditions: [
      { field: 'source', operator: 'equals', value: 'anomaly_detector' },
      { field: 'type', operator: 'equals', value: 'failed-auth-spike' },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.UNAUTHORIZED_ACCESS,
      severity: 'P2',
      titleTemplate: 'Brute Force Attack: {{title}}',
      descriptionTemplate: 'High volume of failed authentication attempts detected. {{description}}',
      tags: ['anomaly', 'brute-force', 'authentication'],
    },
    playbookId: 'playbook-account-compromise-v1',
    cooldownSeconds: 300,
    priority: 85,
  },

  // Data Breach Rules
  {
    id: 'data-exfiltration',
    name: 'Data Exfiltration Detected',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'contains', value: 'exfiltration' },
      { field: 'severity', operator: 'in', value: ['critical', 'error'] },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.DATA_BREACH,
      severity: 'P1',
      titleTemplate: 'Data Breach: {{title}}',
      descriptionTemplate: 'Potential data exfiltration detected. Immediate action required. {{description}}',
      tags: ['data-breach', 'exfiltration', 'critical'],
    },
    playbookId: 'playbook-data-breach-v1',
    cooldownSeconds: 0, // No cooldown for critical alerts
    priority: 100,
  },
  {
    id: 'sensitive-data-access',
    name: 'Unusual Sensitive Data Access',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'contains', value: 'sensitive' },
      { field: 'rawData.accessType', operator: 'equals', value: 'bulk' },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.DATA_BREACH,
      severity: 'P2',
      titleTemplate: 'Suspicious Data Access: {{title}}',
      descriptionTemplate: 'Unusual access to sensitive data detected. {{description}}',
      tags: ['data-breach', 'sensitive-data', 'suspicious'],
    },
    playbookId: 'playbook-data-breach-v1',
    cooldownSeconds: 600,
    priority: 75,
  },

  // Malware Rules
  {
    id: 'malware-detected',
    name: 'Malware Detection',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'contains', value: 'malware' },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.MALWARE,
      severity: 'P1',
      titleTemplate: 'Malware Detected: {{title}}',
      descriptionTemplate: 'Malware has been detected on the system. {{description}}',
      tags: ['malware', 'security', 'critical'],
    },
    cooldownSeconds: 0,
    priority: 95,
  },
  {
    id: 'ransomware-activity',
    name: 'Ransomware Activity',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'in', value: ['ransomware', 'file-encryption', 'mass-file-modification'] },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.RANSOMWARE,
      severity: 'P1',
      titleTemplate: 'CRITICAL: Ransomware Activity: {{title}}',
      descriptionTemplate: 'Ransomware activity has been detected. Immediate isolation required. {{description}}',
      tags: ['ransomware', 'critical', 'immediate-action'],
    },
    cooldownSeconds: 0,
    priority: 100,
  },

  // Access Control Rules
  {
    id: 'privilege-escalation',
    name: 'Privilege Escalation Attempt',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'contains', value: 'privilege' },
      { field: 'rawData.action', operator: 'in', value: ['escalate', 'elevate', 'admin'] },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.UNAUTHORIZED_ACCESS,
      severity: 'P2',
      titleTemplate: 'Privilege Escalation: {{title}}',
      descriptionTemplate: 'Unauthorized privilege escalation attempt detected. {{description}}',
      tags: ['privilege-escalation', 'access-control'],
    },
    playbookId: 'playbook-account-compromise-v1',
    cooldownSeconds: 300,
    priority: 80,
  },

  // Insider Threat Rules
  {
    id: 'insider-threat-activity',
    name: 'Insider Threat Activity',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'contains', value: 'insider' },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.INSIDER_THREAT,
      severity: 'P2',
      titleTemplate: 'Insider Threat: {{title}}',
      descriptionTemplate: 'Potential insider threat activity detected. {{description}}',
      tags: ['insider-threat', 'internal'],
    },
    cooldownSeconds: 600,
    priority: 70,
  },

  // Configuration Rules
  {
    id: 'security-config-change',
    name: 'Critical Security Configuration Change',
    enabled: true,
    conditions: [
      { field: 'type', operator: 'equals', value: 'config-change' },
      { field: 'rawData.category', operator: 'equals', value: 'security' },
      { field: 'rawData.unauthorized', operator: 'equals', value: true },
    ],
    conditionOperator: 'and',
    incidentConfig: {
      type: IncidentType.CONFIGURATION_ERROR,
      severity: 'P2',
      titleTemplate: 'Unauthorized Config Change: {{title}}',
      descriptionTemplate: 'Unauthorized security configuration change detected. {{description}}',
      tags: ['configuration', 'unauthorized', 'security'],
    },
    cooldownSeconds: 300,
    priority: 65,
  },
];

// ============================================================================
// Trigger Events
// ============================================================================

export interface TriggerEvents {
  'alert:received': (alert: Alert) => void;
  'alert:matched': (alert: Alert, rule: AlertRule) => void;
  'alert:deduplicated': (alert: Alert, existingIncidentId: string) => void;
  'incident:created': (incidentInput: CreateIncidentInput, rule: AlertRule) => void;
  'incident:merged': (alertId: string, incidentId: string) => void;
}

// ============================================================================
// Incident Trigger Class
// ============================================================================

export class IncidentTrigger extends EventEmitter {
  private readonly config: IncidentTriggerConfig;
  private readonly rules: Map<string, AlertRule> = new Map();
  private readonly playbooks: Map<string, Playbook> = new Map();
  private readonly recentAlerts: Map<string, { timestamp: Date; incidentId?: string }> = new Map();
  private readonly alertCounts: Map<string, { count: number; firstSeen: Date }> = new Map();
  private incidentCreator?: (input: CreateIncidentInput) => Promise<{ id: string }>;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<IncidentTriggerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TRIGGER_CONFIG, ...config };

    // Load default rules
    for (const rule of defaultAlertRules) {
      this.rules.set(rule.id, rule);
    }

    // Start cleanup interval
    this.startCleanupInterval();

    logger.info('IncidentTrigger initialized', {
      enabled: this.config.enabled,
      ruleCount: this.rules.size,
      deduplicationEnabled: this.config.deduplication.enabled,
    });
  }

  /**
   * Register the incident creator function
   */
  registerIncidentCreator(creator: (input: CreateIncidentInput) => Promise<{ id: string }>): void {
    this.incidentCreator = creator;
  }

  /**
   * Register playbooks for auto-selection
   */
  registerPlaybooks(playbooks: Playbook[]): void {
    for (const playbook of playbooks) {
      this.playbooks.set(playbook.id, playbook);
    }
    logger.debug('Playbooks registered for triggers', { count: playbooks.length });
  }

  /**
   * Add or update an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logger.info('Alert rule added', { ruleId: rule.id, name: rule.name });
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): boolean {
    const removed = this.rules.delete(ruleId);
    if (removed) {
      logger.info('Alert rule removed', { ruleId });
    }
    return removed;
  }

  /**
   * Get all rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Process an alert and potentially create an incident
   */
  async processAlert(alert: Alert): Promise<{ incidentCreated: boolean; incidentId?: string; reason?: string }> {
    if (!this.config.enabled) {
      return { incidentCreated: false, reason: 'Triggers disabled' };
    }

    this.emit('alert:received', alert);

    logger.debug('Processing alert', {
      alertId: alert.alertId,
      source: alert.source,
      type: alert.type,
      severity: alert.severity,
    });

    // Check deduplication
    if (this.config.deduplication.enabled) {
      const dedupResult = this.checkDeduplication(alert);
      if (dedupResult.isDuplicate) {
        this.emit('alert:deduplicated', alert, dedupResult.existingIncidentId!);
        logger.debug('Alert deduplicated', {
          alertId: alert.alertId,
          existingIncidentId: dedupResult.existingIncidentId,
        });
        return {
          incidentCreated: false,
          incidentId: dedupResult.existingIncidentId,
          reason: 'Deduplicated - merged with existing incident',
        };
      }
    }

    // Find matching rule
    const matchedRule = this.findMatchingRule(alert);
    if (!matchedRule) {
      logger.debug('No matching rule for alert', { alertId: alert.alertId });
      return { incidentCreated: false, reason: 'No matching rule' };
    }

    this.emit('alert:matched', alert, matchedRule);

    // Check cooldown
    if (matchedRule.cooldownSeconds > 0) {
      const cooldownKey = `${matchedRule.id}:${alert.userId || ''}:${alert.ipAddress || ''}`;
      const lastAlert = this.recentAlerts.get(cooldownKey);

      if (lastAlert) {
        const timeSinceLastAlert = (Date.now() - lastAlert.timestamp.getTime()) / 1000;
        if (timeSinceLastAlert < matchedRule.cooldownSeconds) {
          logger.debug('Alert in cooldown period', {
            alertId: alert.alertId,
            ruleId: matchedRule.id,
            remainingCooldown: matchedRule.cooldownSeconds - timeSinceLastAlert,
          });

          // Auto-merge if enabled
          if (this.config.autoMerge.enabled && lastAlert.incidentId) {
            this.emit('incident:merged', alert.alertId, lastAlert.incidentId);
            return {
              incidentCreated: false,
              incidentId: lastAlert.incidentId,
              reason: 'Merged with recent incident (cooldown)',
            };
          }

          return { incidentCreated: false, reason: 'In cooldown period' };
        }
      }
    }

    // Check severity escalation
    let severity = matchedRule.incidentConfig.severity;
    if (this.config.severityEscalation.enabled) {
      severity = this.checkSeverityEscalation(alert, matchedRule, severity);
    }

    // Create incident input
    const incidentInput = this.buildIncidentInput(alert, matchedRule, severity);

    // Create the incident
    if (!this.incidentCreator) {
      logger.warn('No incident creator registered');
      return { incidentCreated: false, reason: 'No incident creator registered' };
    }

    try {
      const result = await this.incidentCreator(incidentInput);

      // Track for deduplication and cooldown
      const dedupHash = this.calculateAlertHash(alert);
      this.recentAlerts.set(dedupHash, { timestamp: new Date(), incidentId: result.id });

      const cooldownKey = `${matchedRule.id}:${alert.userId || ''}:${alert.ipAddress || ''}`;
      this.recentAlerts.set(cooldownKey, { timestamp: new Date(), incidentId: result.id });

      logger.info('Incident created from alert', {
        alertId: alert.alertId,
        incidentId: result.id,
        ruleId: matchedRule.id,
        severity,
      });

      this.emit('incident:created', incidentInput, matchedRule);

      return { incidentCreated: true, incidentId: result.id };
    } catch (error) {
      logger.error('Failed to create incident from alert', {
        alertId: alert.alertId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        incidentCreated: false,
        reason: `Error creating incident: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Process an anomaly alert from the anomaly detection system
   */
  async processAnomalyAlert(anomalyAlert: AnomalyAlert): Promise<{ incidentCreated: boolean; incidentId?: string; reason?: string }> {
    // Convert anomaly alert to standard alert format
    const alert: Alert = {
      alertId: anomalyAlert.alertId,
      source: 'anomaly_detector',
      type: anomalyAlert.anomaly.type,
      severity: this.mapAnomalySeverity(anomalyAlert.anomaly.severity),
      title: anomalyAlert.anomaly.description,
      description: `Anomaly detected: ${anomalyAlert.anomaly.description}\n\nIndicators:\n${
        anomalyAlert.anomaly.indicators
          .map((i) => `- ${i.description} (weight: ${i.weight})`)
          .join('\n')
      }\n\nSuggested actions:\n${anomalyAlert.anomaly.suggestedActions.map((a) => `- ${a}`).join('\n')}`,
      timestamp: anomalyAlert.anomaly.timestamp,
      userId: anomalyAlert.anomaly.userId,
      ipAddress: anomalyAlert.anomaly.ipAddress,
      rawData: {
        anomalyId: anomalyAlert.anomaly.id,
        confidence: anomalyAlert.anomaly.confidence,
        indicators: anomalyAlert.anomaly.indicators,
        suggestedActions: anomalyAlert.anomaly.suggestedActions,
        metadata: anomalyAlert.anomaly.metadata,
      },
      metadata: {
        anomalyType: anomalyAlert.anomaly.type,
        confidence: anomalyAlert.anomaly.confidence,
      },
    };

    return this.processAlert(alert);
  }

  /**
   * Map from alert severity to incident severity
   */
  mapAlertSeverityToIncident(alertSeverity: Alert['severity']): IncidentSeverity {
    const mapping: Record<Alert['severity'], IncidentSeverity> = {
      critical: 'P1',
      error: 'P2',
      warning: 'P3',
      info: 'P4',
    };
    return mapping[alertSeverity];
  }

  /**
   * Map from anomaly severity to alert severity
   */
  private mapAnomalySeverity(anomalySeverity: AnomalySeverity): Alert['severity'] {
    const mapping: Record<AnomalySeverity, Alert['severity']> = {
      critical: 'critical',
      high: 'error',
      medium: 'warning',
      low: 'info',
    };
    return mapping[anomalySeverity];
  }

  /**
   * Select appropriate playbook for incident type
   */
  selectPlaybook(incidentType: IncidentType, severity: IncidentSeverity): Playbook | undefined {
    // Find matching playbooks
    const matchingPlaybooks: Playbook[] = [];
    const allPlaybooks = Array.from(this.playbooks.values());

    for (const playbook of allPlaybooks) {
      if (!playbook.enabled) continue;

      // Check if playbook matches incident type
      const typeMatch = playbook.triggerConditions.some(
        (condition) =>
          condition.field === 'type' &&
          condition.operator === 'equals' &&
          condition.value === incidentType
      );

      if (typeMatch) {
        matchingPlaybooks.push(playbook);
      }
    }

    if (matchingPlaybooks.length === 0) {
      return undefined;
    }

    // Return first matching playbook (could be enhanced with severity-based selection)
    return matchingPlaybooks[0];
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.recentAlerts.clear();
    this.alertCounts.clear();
    logger.info('IncidentTrigger destroyed');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private findMatchingRule(alert: Alert): AlertRule | undefined {
    // Rules are sorted by priority (highest first)
    const sortedRules = Array.from(this.rules.values())
      .filter((r) => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (this.evaluateConditions(alert, rule.conditions, rule.conditionOperator)) {
        return rule;
      }
    }

    return undefined;
  }

  private evaluateConditions(
    alert: Alert,
    conditions: AlertCondition[],
    operator: 'and' | 'or'
  ): boolean {
    if (conditions.length === 0) return false;

    const results = conditions.map((condition) => this.evaluateCondition(alert, condition));

    if (operator === 'and') {
      return results.every((r) => r);
    } else {
      return results.some((r) => r);
    }
  }

  private evaluateCondition(alert: Alert, condition: AlertCondition): boolean {
    const value = this.getFieldValue(alert, condition.field);

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'not_equals':
        return value !== condition.value;
      case 'contains':
        return typeof value === 'string' && value.includes(String(condition.value));
      case 'not_contains':
        return typeof value === 'string' && !value.includes(String(condition.value));
      case 'matches':
        return typeof value === 'string' && new RegExp(String(condition.value)).test(value);
      case 'gt':
        return typeof value === 'number' && value > Number(condition.value);
      case 'lt':
        return typeof value === 'number' && value < Number(condition.value);
      case 'gte':
        return typeof value === 'number' && value >= Number(condition.value);
      case 'lte':
        return typeof value === 'number' && value <= Number(condition.value);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value);
      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(value);
      case 'exists':
        return value !== undefined && value !== null;
      case 'not_exists':
        return value === undefined || value === null;
      default:
        return false;
    }
  }

  private getFieldValue(alert: Alert, field: string): unknown {
    const parts = field.split('.');
    let value: unknown = alert;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  private checkDeduplication(alert: Alert): { isDuplicate: boolean; existingIncidentId?: string } {
    const hash = this.calculateAlertHash(alert);
    const existing = this.recentAlerts.get(hash);

    if (!existing) {
      return { isDuplicate: false };
    }

    const timeSinceExisting = (Date.now() - existing.timestamp.getTime()) / 1000 / 60;
    if (timeSinceExisting <= this.config.deduplication.windowMinutes) {
      return { isDuplicate: true, existingIncidentId: existing.incidentId };
    }

    return { isDuplicate: false };
  }

  private calculateAlertHash(alert: Alert): string {
    const hashData: Record<string, unknown> = {};

    for (const field of this.config.deduplication.hashFields) {
      hashData[field] = this.getFieldValue(alert, field);
    }

    // Simple hash - in production, use a proper hash function
    return JSON.stringify(hashData);
  }

  private checkSeverityEscalation(
    alert: Alert,
    rule: AlertRule,
    baseSeverity: IncidentSeverity
  ): IncidentSeverity {
    const countKey = `${rule.id}:${alert.type}`;
    const now = new Date();

    let countData = this.alertCounts.get(countKey);

    if (!countData) {
      countData = { count: 1, firstSeen: now };
      this.alertCounts.set(countKey, countData);
      return baseSeverity;
    }

    const windowMs = this.config.severityEscalation.windowMinutes * 60 * 1000;
    if (now.getTime() - countData.firstSeen.getTime() > windowMs) {
      // Reset window
      countData = { count: 1, firstSeen: now };
      this.alertCounts.set(countKey, countData);
      return baseSeverity;
    }

    countData.count++;

    if (countData.count >= this.config.severityEscalation.alertCountThreshold) {
      // Escalate severity
      const severityOrder: IncidentSeverity[] = ['P4', 'P3', 'P2', 'P1'];
      const currentIndex = severityOrder.indexOf(baseSeverity);

      if (currentIndex > 0) {
        const escalatedSeverity = severityOrder[currentIndex - 1];
        logger.info('Severity escalated due to alert volume', {
          ruleId: rule.id,
          alertCount: countData.count,
          baseSeverity,
          escalatedSeverity,
        });
        return escalatedSeverity;
      }
    }

    return baseSeverity;
  }

  private buildIncidentInput(
    alert: Alert,
    rule: AlertRule,
    severity: IncidentSeverity
  ): CreateIncidentInput {
    const config = rule.incidentConfig;

    // Apply template substitution
    const title = this.applyTemplate(config.titleTemplate, alert);
    const description = this.applyTemplate(config.descriptionTemplate, alert);

    // Build affected resources
    const affectedResources: string[] = [];
    if (alert.userId) {
      affectedResources.push(`user:${alert.userId}`);
    }
    if (alert.ipAddress) {
      affectedResources.push(`ip:${alert.ipAddress}`);
    }
    if (alert.resource) {
      affectedResources.push(alert.resource);
    }

    const input: CreateIncidentInput = {
      title,
      description,
      severity,
      status: IncidentStatus.DETECTED,
      type: config.type,
      detectedAt: alert.timestamp,
      affectedResources,
      tags: [
        ...(config.tags || []),
        `source:${alert.source}`,
        `alert:${alert.alertId}`,
        `rule:${rule.id}`,
      ],
      playbook: rule.playbookId,
      metadata: {
        alertId: alert.alertId,
        alertSource: alert.source,
        alertType: alert.type,
        ruleId: rule.id,
        originalAlertSeverity: alert.severity,
        rawAlertData: alert.rawData,
      },
    };

    if (config.autoAssignee) {
      input.assignee = config.autoAssignee;
    }

    return input;
  }

  private applyTemplate(template: string, alert: Alert): string {
    let result = template;

    // Replace simple placeholders
    result = result.replace(/\{\{title\}\}/g, alert.title);
    result = result.replace(/\{\{description\}\}/g, alert.description);
    result = result.replace(/\{\{source\}\}/g, alert.source);
    result = result.replace(/\{\{type\}\}/g, alert.type);
    result = result.replace(/\{\{severity\}\}/g, alert.severity);
    result = result.replace(/\{\{alertId\}\}/g, alert.alertId);

    if (alert.userId) {
      result = result.replace(/\{\{userId\}\}/g, alert.userId);
    }
    if (alert.ipAddress) {
      result = result.replace(/\{\{ipAddress\}\}/g, alert.ipAddress);
    }
    if (alert.resource) {
      result = result.replace(/\{\{resource\}\}/g, alert.resource);
    }

    return result;
  }

  private startCleanupInterval(): void {
    // Clean up old entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      // Clean recent alerts
      const alertEntries = Array.from(this.recentAlerts.entries());
      for (const [key, data] of alertEntries) {
        const ageMinutes = (now - data.timestamp.getTime()) / 1000 / 60;
        if (ageMinutes > this.config.deduplication.windowMinutes) {
          this.recentAlerts.delete(key);
        }
      }

      // Clean alert counts
      const windowMs = this.config.severityEscalation.windowMinutes * 60 * 1000;
      const countEntries = Array.from(this.alertCounts.entries());
      for (const [key, data] of countEntries) {
        if (now - data.firstSeen.getTime() > windowMs) {
          this.alertCounts.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createIncidentTrigger(config?: Partial<IncidentTriggerConfig>): IncidentTrigger {
  return new IncidentTrigger(config);
}
