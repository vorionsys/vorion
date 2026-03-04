/**
 * Alerting Rules and Thresholds
 *
 * Defines alerting rules, thresholds, and notification interfaces
 * for Agent Anchor observability.
 *
 * @packageDocumentation
 */

import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'alerting' });

// ============================================================================
// Types
// ============================================================================

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertState = 'firing' | 'resolved' | 'pending';

export interface AlertRule {
  /** Unique rule identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this rule monitors */
  description: string;
  /** Alert severity */
  severity: AlertSeverity;
  /** Metric query or condition */
  condition: AlertCondition;
  /** Duration before firing (seconds) */
  forSeconds: number;
  /** Labels to attach to alerts */
  labels: Record<string, string>;
  /** Annotations with additional context */
  annotations: Record<string, string>;
  /** Is this rule enabled */
  enabled: boolean;
}

export interface AlertCondition {
  /** Type of condition */
  type: 'threshold' | 'rate' | 'absence' | 'comparison';
  /** Metric name */
  metric: string;
  /** Operator for comparison */
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  /** Threshold value */
  value: number;
  /** Aggregation window (for rate conditions) */
  windowSeconds?: number;
  /** Labels to filter by */
  labels?: Record<string, string>;
}

export interface Alert {
  /** Alert rule ID */
  ruleId: string;
  /** Alert state */
  state: AlertState;
  /** When the alert started firing */
  firedAt?: string;
  /** When the alert was resolved */
  resolvedAt?: string;
  /** Current value that triggered the alert */
  value: number;
  /** Labels from rule + instance */
  labels: Record<string, string>;
  /** Annotations from rule */
  annotations: Record<string, string>;
  /** Alert fingerprint for deduplication */
  fingerprint: string;
}

export interface AlertNotification {
  alert: Alert;
  rule: AlertRule;
  timestamp: string;
}

export type AlertHandler = (notification: AlertNotification) => Promise<void>;

// ============================================================================
// Default Alert Rules
// ============================================================================

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  // ========== Critical Alerts ==========
  {
    id: 'anchor_trust_tier_drops',
    name: 'Frequent Trust Tier Drops',
    description: 'High rate of agents dropping trust tiers may indicate system issues',
    severity: 'critical',
    condition: {
      type: 'rate',
      metric: 'anchor_tier_transitions_total',
      operator: '>',
      value: 10,
      windowSeconds: 300,
      labels: { direction: 'down' },
    },
    forSeconds: 60,
    labels: { component: 'trust' },
    annotations: {
      summary: 'High rate of trust tier drops',
      runbook: 'Check attestation pipeline and scoring factors',
    },
    enabled: true,
  },
  {
    id: 'anchor_a2a_high_failure_rate',
    name: 'A2A High Failure Rate',
    description: 'A2A invocations are failing at high rate',
    severity: 'critical',
    condition: {
      type: 'rate',
      metric: 'anchor_a2a_invocations_total',
      operator: '>',
      value: 0.1, // 10% failure rate
      windowSeconds: 300,
      labels: { outcome: 'failure' },
    },
    forSeconds: 120,
    labels: { component: 'a2a' },
    annotations: {
      summary: 'A2A failure rate exceeds 10%',
      runbook: 'Check network connectivity and target agent health',
    },
    enabled: true,
  },
  {
    id: 'anchor_attestation_backlog',
    name: 'Attestation Processing Backlog',
    description: 'Attestations are backing up and not being processed',
    severity: 'critical',
    condition: {
      type: 'threshold',
      metric: 'anchor_attestations_pending',
      operator: '>',
      value: 1000,
    },
    forSeconds: 300,
    labels: { component: 'attestation' },
    annotations: {
      summary: 'Attestation backlog exceeds 1000',
      runbook: 'Check database connectivity and attestation processor health',
    },
    enabled: true,
  },
  {
    id: 'anchor_sandbox_runtime_unavailable',
    name: 'Sandbox Runtime Unavailable',
    description: 'Sandbox container runtime is not available',
    severity: 'critical',
    condition: {
      type: 'threshold',
      metric: 'anchor_sandbox_containers_active',
      operator: '==',
      value: 0,
    },
    forSeconds: 60,
    labels: { component: 'sandbox' },
    annotations: {
      summary: 'No active sandbox containers - runtime may be down',
      runbook: 'Check Docker/gVisor daemon status',
    },
    enabled: true,
  },

  // ========== Warning Alerts ==========
  {
    id: 'anchor_trust_score_computation_slow',
    name: 'Slow Trust Score Computation',
    description: 'Trust score computation is taking longer than expected',
    severity: 'warning',
    condition: {
      type: 'threshold',
      metric: 'anchor_trust_score_computation_duration_seconds',
      operator: '>',
      value: 0.5, // 500ms
    },
    forSeconds: 300,
    labels: { component: 'trust' },
    annotations: {
      summary: 'Trust score computation taking > 500ms',
      runbook: 'Check database performance and attestation query optimization',
    },
    enabled: true,
  },
  {
    id: 'anchor_a2a_latency_high',
    name: 'A2A High Latency',
    description: 'A2A invocation latency is elevated',
    severity: 'warning',
    condition: {
      type: 'threshold',
      metric: 'anchor_a2a_invocation_duration_seconds',
      operator: '>',
      value: 5, // 5 seconds
    },
    forSeconds: 180,
    labels: { component: 'a2a' },
    annotations: {
      summary: 'A2A latency exceeds 5 seconds',
      runbook: 'Check target agent performance and network latency',
    },
    enabled: true,
  },
  {
    id: 'anchor_a2a_circuit_breakers_open',
    name: 'A2A Circuit Breakers Open',
    description: 'Multiple A2A endpoints have open circuit breakers',
    severity: 'warning',
    condition: {
      type: 'rate',
      metric: 'anchor_a2a_circuit_breaker_state_changes_total',
      operator: '>',
      value: 5,
      windowSeconds: 300,
      labels: { to_state: 'open' },
    },
    forSeconds: 60,
    labels: { component: 'a2a' },
    annotations: {
      summary: 'Multiple A2A circuit breakers opening',
      runbook: 'Check endpoint health and reduce traffic if necessary',
    },
    enabled: true,
  },
  {
    id: 'anchor_sandbox_near_capacity',
    name: 'Sandbox Near Capacity',
    description: 'Active sandbox containers approaching limit',
    severity: 'warning',
    condition: {
      type: 'threshold',
      metric: 'anchor_sandbox_containers_active',
      operator: '>',
      value: 80, // 80% of configured max
    },
    forSeconds: 300,
    labels: { component: 'sandbox' },
    annotations: {
      summary: 'Sandbox container count at 80% capacity',
      runbook: 'Scale sandbox infrastructure or review container lifecycle',
    },
    enabled: true,
  },
  {
    id: 'anchor_human_approval_pending',
    name: 'Human Approval Queue Growing',
    description: 'Human approval requests are pending',
    severity: 'warning',
    condition: {
      type: 'rate',
      metric: 'anchor_human_approval_requests_total',
      operator: '>',
      value: 10,
      windowSeconds: 3600,
      labels: { outcome: 'pending' },
    },
    forSeconds: 300,
    labels: { component: 'trust' },
    annotations: {
      summary: 'Human approval queue has > 10 pending requests',
      runbook: 'Review pending tier promotion requests',
    },
    enabled: true,
  },

  // ========== Info Alerts ==========
  {
    id: 'anchor_new_agents_registered',
    name: 'New Agents Registered',
    description: 'Spike in new agent registrations',
    severity: 'info',
    condition: {
      type: 'rate',
      metric: 'anchor_agents_registered_total',
      operator: '>',
      value: 100,
      windowSeconds: 3600,
    },
    forSeconds: 0,
    labels: { component: 'registry' },
    annotations: {
      summary: 'More than 100 agents registered in the last hour',
      runbook: 'Informational - review for suspicious activity if unusual',
    },
    enabled: true,
  },
  {
    id: 'anchor_tier_promotions',
    name: 'Trust Tier Promotions',
    description: 'Agents being promoted to higher tiers',
    severity: 'info',
    condition: {
      type: 'rate',
      metric: 'anchor_tier_transitions_total',
      operator: '>',
      value: 5,
      windowSeconds: 3600,
      labels: { direction: 'up' },
    },
    forSeconds: 0,
    labels: { component: 'trust' },
    annotations: {
      summary: 'Multiple trust tier promotions in the last hour',
      runbook: 'Informational - verify promotions are expected',
    },
    enabled: true,
  },
  {
    id: 'anchor_policy_violations',
    name: 'Sandbox Policy Violations',
    description: 'Sandbox policy violations detected',
    severity: 'info',
    condition: {
      type: 'rate',
      metric: 'anchor_network_policy_violations_total',
      operator: '>',
      value: 5,
      windowSeconds: 3600,
    },
    forSeconds: 0,
    labels: { component: 'sandbox' },
    annotations: {
      summary: 'Sandbox policy violations in the last hour',
      runbook: 'Review agent behavior and policy configurations',
    },
    enabled: true,
  },
];

// ============================================================================
// Alert Manager
// ============================================================================

export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private handlers: AlertHandler[] = [];
  private evaluationInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Load default rules
    for (const rule of DEFAULT_ALERT_RULES) {
      this.rules.set(rule.id, rule);
    }
    logger.info({ ruleCount: this.rules.size }, 'Alert manager initialized');
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logger.debug({ ruleId: rule.id }, 'Alert rule added');
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    logger.debug({ ruleId }, 'Alert rule removed');
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): void {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
      logger.debug({ ruleId, enabled }, 'Alert rule enabled state changed');
    }
  }

  /**
   * Register an alert handler
   */
  onAlert(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Get all rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(
      (a) => a.state === 'firing' || a.state === 'pending'
    );
  }

  /**
   * Generate alert fingerprint for deduplication
   */
  private generateFingerprint(ruleId: string, labels: Record<string, string>): string {
    const sortedLabels = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${ruleId}:${sortedLabels}`;
  }

  /**
   * Fire an alert
   */
  async fireAlert(
    ruleId: string,
    value: number,
    instanceLabels: Record<string, string> = {}
  ): Promise<void> {
    const rule = this.rules.get(ruleId);
    if (!rule || !rule.enabled) {
      return;
    }

    const labels = { ...rule.labels, ...instanceLabels };
    const fingerprint = this.generateFingerprint(ruleId, labels);

    let alert = this.activeAlerts.get(fingerprint);
    if (!alert) {
      alert = {
        ruleId,
        state: rule.forSeconds > 0 ? 'pending' : 'firing',
        firedAt: new Date().toISOString(),
        value,
        labels,
        annotations: rule.annotations,
        fingerprint,
      };
      this.activeAlerts.set(fingerprint, alert);
    } else {
      alert.value = value;
      // If was pending and now exceeds forSeconds, transition to firing
      if (alert.state === 'pending' && alert.firedAt) {
        const pendingDuration = Date.now() - new Date(alert.firedAt).getTime();
        if (pendingDuration >= rule.forSeconds * 1000) {
          alert.state = 'firing';
        }
      }
    }

    if (alert.state === 'firing') {
      await this.notifyHandlers(alert, rule);
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(
    ruleId: string,
    instanceLabels: Record<string, string> = {}
  ): Promise<void> {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return;
    }

    const labels = { ...rule.labels, ...instanceLabels };
    const fingerprint = this.generateFingerprint(ruleId, labels);

    const alert = this.activeAlerts.get(fingerprint);
    if (alert && alert.state !== 'resolved') {
      alert.state = 'resolved';
      alert.resolvedAt = new Date().toISOString();

      await this.notifyHandlers(alert, rule);

      // Remove resolved alerts after a delay
      setTimeout(() => {
        this.activeAlerts.delete(fingerprint);
      }, 60000);
    }
  }

  /**
   * Notify all handlers
   */
  private async notifyHandlers(alert: Alert, rule: AlertRule): Promise<void> {
    const notification: AlertNotification = {
      alert,
      rule,
      timestamp: new Date().toISOString(),
    };

    for (const handler of this.handlers) {
      try {
        await handler(notification);
      } catch (error) {
        logger.error({ error, ruleId: rule.id }, 'Alert handler failed');
      }
    }
  }

  /**
   * Get alert summary
   */
  getSummary(): {
    total: number;
    firing: number;
    pending: number;
    bySeverity: Record<AlertSeverity, number>;
  } {
    const alerts = this.getActiveAlerts();
    const bySeverity: Record<AlertSeverity, number> = {
      critical: 0,
      warning: 0,
      info: 0,
    };

    let firing = 0;
    let pending = 0;

    for (const alert of alerts) {
      const rule = this.rules.get(alert.ruleId);
      if (rule) {
        bySeverity[rule.severity]++;
      }
      if (alert.state === 'firing') firing++;
      if (alert.state === 'pending') pending++;
    }

    return {
      total: alerts.length,
      firing,
      pending,
      bySeverity,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: AlertManager | null = null;

export function createAlertManager(): AlertManager {
  if (!instance) {
    instance = new AlertManager();
  }
  return instance;
}

export function getAlertManager(): AlertManager {
  if (!instance) {
    throw new Error('AlertManager not initialized');
  }
  return instance;
}

// ============================================================================
// Built-in Handlers
// ============================================================================

/**
 * Logging handler - logs all alerts
 */
export const loggingAlertHandler: AlertHandler = async (notification) => {
  const { alert, rule } = notification;

  const logFn =
    rule.severity === 'critical'
      ? logger.error.bind(logger)
      : rule.severity === 'warning'
        ? logger.warn.bind(logger)
        : logger.info.bind(logger);

  logFn(
    {
      ruleId: rule.id,
      state: alert.state,
      value: alert.value,
      labels: alert.labels,
    },
    `Alert ${alert.state}: ${rule.name}`
  );
};

/**
 * Webhook handler factory
 */
export function createWebhookAlertHandler(webhookUrl: string): AlertHandler {
  return async (notification) => {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });
    } catch (error) {
      logger.error({ error, webhookUrl }, 'Webhook alert handler failed');
    }
  };
}
