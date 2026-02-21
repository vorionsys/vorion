/**
 * Alert Management
 * Trust score degradation, breach notifications, compliance expiration, and SIEM integration
 */

import {
  Alert,
  AlertType,
  AlertSeverity,
  AlertStatus,
  AlertAction,
  HealthEvent,
  TrustScore,
  ComplianceCertification,
  Contract,
  VendorInfo,
  PaginatedResponse,
} from './types';

// ============================================================================
// Alert Manager Configuration
// ============================================================================

export interface AlertManagerConfig {
  storage: AlertStorage;
  notificationChannels: NotificationChannel[];
  siemIntegration?: SIEMIntegration;
  escalationPolicies: EscalationPolicy[];
  deduplicationWindow: number; // milliseconds
  autoResolveEnabled: boolean;
}

export interface EscalationPolicy {
  name: string;
  conditions: EscalationCondition[];
  actions: EscalationAction[];
}

export interface EscalationCondition {
  field: 'severity' | 'type' | 'age' | 'vendorTier';
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'in';
  value: unknown;
}

export interface EscalationAction {
  type: 'notify' | 'assign' | 'change_severity' | 'create_incident';
  config: Record<string, unknown>;
}

// ============================================================================
// Alert Manager Service
// ============================================================================

export class AlertManager {
  private readonly config: AlertManagerConfig;
  private readonly recentAlerts: Map<string, Alert> = new Map();

  constructor(config: AlertManagerConfig) {
    this.config = config;
  }

  // ============================================================================
  // Alert Creation
  // ============================================================================

  async createAlert(input: CreateAlertInput): Promise<Alert> {
    // Check for duplicates
    const dedupeKey = this.generateDedupeKey(input);
    const existingAlert = this.recentAlerts.get(dedupeKey);

    if (existingAlert && this.isWithinDedupeWindow(existingAlert)) {
      // Update existing alert instead of creating new
      return this.updateAlert(existingAlert.id, {
        relatedEvents: [...existingAlert.relatedEvents, ...(input.relatedEvents || [])],
      });
    }

    const alert: Alert = {
      id: this.generateAlertId(),
      vendorId: input.vendorId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      description: input.description,
      source: input.source,
      createdAt: new Date(),
      status: 'open',
      relatedEvents: input.relatedEvents || [],
      actions: this.generateAlertActions(input),
      metadata: input.metadata || {},
    };

    await this.config.storage.saveAlert(alert);
    this.recentAlerts.set(dedupeKey, alert);

    // Send notifications
    await this.sendNotifications(alert);

    // Send to SIEM
    if (this.config.siemIntegration) {
      await this.sendToSIEM(alert);
    }

    // Check escalation policies
    await this.checkEscalationPolicies(alert);

    return alert;
  }

  async createAlertFromHealthEvent(event: HealthEvent, vendor: VendorInfo): Promise<Alert | null> {
    const alertType = this.mapHealthEventToAlertType(event.type);
    if (!alertType) return null;

    const severity = this.mapEventSeverityToAlertSeverity(event.severity);

    return this.createAlert({
      vendorId: event.vendorId,
      type: alertType,
      severity,
      title: event.title,
      description: event.description,
      source: event.source,
      relatedEvents: [event.id],
      metadata: {
        eventType: event.type,
        vendorName: vendor.name,
        vendorTier: vendor.tier,
        ...event.metadata,
      },
    });
  }

  async createTrustScoreDegradationAlert(
    vendorId: string,
    vendor: VendorInfo,
    previousScore: TrustScore,
    currentScore: TrustScore,
  ): Promise<Alert> {
    const scoreDrop = previousScore.score - currentScore.score;
    const severity = this.calculateDegradationSeverity(scoreDrop, vendor.tier);

    return this.createAlert({
      vendorId,
      type: 'trust_score_degradation',
      severity,
      title: `Trust score degradation detected for ${vendor.name}`,
      description: `Trust score dropped from ${previousScore.score} (${previousScore.grade}) to ${currentScore.score} (${currentScore.grade})`,
      source: 'trust_oracle',
      metadata: {
        vendorName: vendor.name,
        vendorTier: vendor.tier,
        previousScore: previousScore.score,
        previousGrade: previousScore.grade,
        currentScore: currentScore.score,
        currentGrade: currentScore.grade,
        scoreDrop,
        affectedFactors: currentScore.factors.filter(f => {
          const prevFactor = previousScore.factors.find(pf => pf.category === f.category);
          return prevFactor && prevFactor.score - f.score > 5;
        }),
      },
    });
  }

  async createComplianceExpirationAlert(
    vendorId: string,
    vendor: VendorInfo,
    certification: ComplianceCertification,
    daysUntilExpiration: number,
  ): Promise<Alert> {
    const severity: AlertSeverity =
      daysUntilExpiration <= 7 ? 'critical' :
        daysUntilExpiration <= 30 ? 'error' :
          daysUntilExpiration <= 60 ? 'warning' : 'info';

    return this.createAlert({
      vendorId,
      type: 'compliance_expiration',
      severity,
      title: `${certification.framework} certification expiring for ${vendor.name}`,
      description: `${certification.framework} certification expires in ${daysUntilExpiration} days on ${certification.expirationDate.toISOString().split('T')[0]}`,
      source: 'trust_oracle',
      metadata: {
        vendorName: vendor.name,
        vendorTier: vendor.tier,
        certificationId: certification.id,
        framework: certification.framework,
        expirationDate: certification.expirationDate,
        daysUntilExpiration,
        certificationBody: certification.certificationBody,
      },
    });
  }

  async createContractExpirationAlert(
    vendorId: string,
    vendor: VendorInfo,
    contract: Contract,
    daysUntilExpiration: number,
  ): Promise<Alert> {
    const severity: AlertSeverity =
      daysUntilExpiration <= 7 ? 'critical' :
        daysUntilExpiration <= 30 ? 'error' :
          daysUntilExpiration <= 60 ? 'warning' : 'info';

    return this.createAlert({
      vendorId,
      type: 'contract_expiration',
      severity,
      title: `Contract expiring for ${vendor.name}`,
      description: `${contract.type} contract expires in ${daysUntilExpiration} days on ${contract.endDate.toISOString().split('T')[0]}`,
      source: 'trust_oracle',
      metadata: {
        vendorName: vendor.name,
        vendorTier: vendor.tier,
        contractId: contract.id,
        contractType: contract.type,
        endDate: contract.endDate,
        daysUntilExpiration,
        autoRenewal: contract.autoRenewal,
        contractValue: contract.value,
      },
    });
  }

  async createBreachAlert(
    vendorId: string,
    vendor: VendorInfo,
    breach: BreachAlertInput,
  ): Promise<Alert> {
    const severity = this.calculateBreachSeverity(breach);

    return this.createAlert({
      vendorId,
      type: 'breach_notification',
      severity,
      title: `Data breach reported for ${vendor.name}`,
      description: breach.description,
      source: breach.source,
      metadata: {
        vendorName: vendor.name,
        vendorTier: vendor.tier,
        breachDate: breach.breachDate,
        disclosureDate: breach.disclosureDate,
        recordsAffected: breach.recordsAffected,
        dataTypes: breach.dataTypes,
        breachId: breach.breachId,
      },
    });
  }

  // ============================================================================
  // Alert Management
  // ============================================================================

  async getAlert(alertId: string): Promise<Alert> {
    const alert = await this.config.storage.getAlert(alertId);
    if (!alert) {
      throw new AlertError('ALERT_NOT_FOUND', `Alert ${alertId} not found`);
    }
    return alert;
  }

  async updateAlert(alertId: string, updates: UpdateAlertInput): Promise<Alert> {
    const alert = await this.getAlert(alertId);

    const updatedAlert: Alert = {
      ...alert,
      ...updates,
      id: alert.id, // Prevent ID modification
      vendorId: alert.vendorId, // Prevent vendor modification
      createdAt: alert.createdAt, // Prevent creation date modification
    };

    await this.config.storage.saveAlert(updatedAlert);

    return updatedAlert;
  }

  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<Alert> {
    return this.updateAlert(alertId, {
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      assignee: acknowledgedBy,
    });
  }

  async resolveAlert(alertId: string, resolution: AlertResolution): Promise<Alert> {
    const alert = await this.updateAlert(alertId, {
      status: 'resolved',
      resolvedAt: new Date(),
      metadata: {
        ...((await this.getAlert(alertId)).metadata),
        resolution,
      },
    });

    // Remove from deduplication cache
    const dedupeKey = this.generateDedupeKey({
      vendorId: alert.vendorId,
      type: alert.type,
      title: alert.title,
    } as CreateAlertInput);
    this.recentAlerts.delete(dedupeKey);

    return alert;
  }

  async suppressAlert(alertId: string, reason: string, duration: number): Promise<Alert> {
    return this.updateAlert(alertId, {
      status: 'suppressed',
      metadata: {
        ...((await this.getAlert(alertId)).metadata),
        suppressionReason: reason,
        suppressedUntil: new Date(Date.now() + duration),
      },
    });
  }

  async assignAlert(alertId: string, assignee: string): Promise<Alert> {
    return this.updateAlert(alertId, {
      assignee,
      status: 'investigating',
    });
  }

  async addComment(alertId: string, comment: AlertComment): Promise<void> {
    await this.config.storage.addAlertComment(alertId, comment);
  }

  // ============================================================================
  // Alert Queries
  // ============================================================================

  async listAlerts(options: ListAlertsOptions): Promise<PaginatedResponse<Alert>> {
    return this.config.storage.listAlerts(options);
  }

  async getVendorAlerts(vendorId: string, options: ListAlertsOptions = {}): Promise<Alert[]> {
    const result = await this.config.storage.listAlerts({
      ...options,
      vendorId,
    });
    return result.data;
  }

  async getOpenAlerts(options: ListAlertsOptions = {}): Promise<Alert[]> {
    const result = await this.config.storage.listAlerts({
      ...options,
      statuses: ['open', 'acknowledged', 'investigating'],
    });
    return result.data;
  }

  async getAlertsByType(type: AlertType, options: ListAlertsOptions = {}): Promise<Alert[]> {
    const result = await this.config.storage.listAlerts({
      ...options,
      types: [type],
    });
    return result.data;
  }

  async getAlertStats(vendorId?: string): Promise<AlertStats> {
    return this.config.storage.getAlertStats(vendorId);
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  async bulkAcknowledge(alertIds: string[], acknowledgedBy: string): Promise<Alert[]> {
    const results: Alert[] = [];
    for (const alertId of alertIds) {
      try {
        const alert = await this.acknowledgeAlert(alertId, acknowledgedBy);
        results.push(alert);
      } catch (error) {
        console.error(`Failed to acknowledge alert ${alertId}:`, error);
      }
    }
    return results;
  }

  async bulkResolve(alertIds: string[], resolution: AlertResolution): Promise<Alert[]> {
    const results: Alert[] = [];
    for (const alertId of alertIds) {
      try {
        const alert = await this.resolveAlert(alertId, resolution);
        results.push(alert);
      } catch (error) {
        console.error(`Failed to resolve alert ${alertId}:`, error);
      }
    }
    return results;
  }

  async autoResolveStaleAlerts(maxAgeHours: number): Promise<number> {
    if (!this.config.autoResolveEnabled) return 0;

    const staleAlerts = await this.config.storage.getStaleAlerts(maxAgeHours);
    let resolvedCount = 0;

    for (const alert of staleAlerts) {
      try {
        await this.resolveAlert(alert.id, {
          type: 'auto_resolved',
          reason: `Auto-resolved after ${maxAgeHours} hours of inactivity`,
          resolvedBy: 'system',
        });
        resolvedCount++;
      } catch (error) {
        console.error(`Failed to auto-resolve alert ${alert.id}:`, error);
      }
    }

    return resolvedCount;
  }

  // ============================================================================
  // Notification Management
  // ============================================================================

  private async sendNotifications(alert: Alert): Promise<void> {
    const channels = this.config.notificationChannels.filter(c =>
      this.shouldNotifyChannel(c, alert),
    );

    const notifications = channels.map(channel =>
      this.sendNotificationToChannel(channel, alert).catch(error => {
        console.error(`Failed to send notification to ${channel.type}:`, error);
      }),
    );

    await Promise.all(notifications);
  }

  private shouldNotifyChannel(channel: NotificationChannel, alert: Alert): boolean {
    // Check severity threshold
    const severityOrder = { info: 0, warning: 1, error: 2, critical: 3 };
    if (severityOrder[alert.severity] < severityOrder[channel.minSeverity || 'info']) {
      return false;
    }

    // Check alert type filter
    if (channel.alertTypes && !channel.alertTypes.includes(alert.type)) {
      return false;
    }

    return channel.enabled;
  }

  private async sendNotificationToChannel(
    channel: NotificationChannel,
    alert: Alert,
  ): Promise<void> {
    const payload = this.formatNotificationPayload(channel, alert);

    switch (channel.type) {
      case 'email':
        await this.sendEmailNotification(channel, payload);
        break;
      case 'slack':
        await this.sendSlackNotification(channel, payload);
        break;
      case 'teams':
        await this.sendTeamsNotification(channel, payload);
        break;
      case 'pagerduty':
        await this.sendPagerDutyNotification(channel, payload);
        break;
      case 'webhook':
        await this.sendWebhookNotification(channel, payload);
        break;
    }
  }

  private formatNotificationPayload(
    channel: NotificationChannel,
    alert: Alert,
  ): NotificationPayload {
    return {
      title: alert.title,
      description: alert.description,
      severity: alert.severity,
      type: alert.type,
      vendorId: alert.vendorId,
      alertId: alert.id,
      createdAt: alert.createdAt,
      source: alert.source,
      actions: alert.actions,
      metadata: alert.metadata,
    };
  }

  private async sendEmailNotification(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<void> {
    // Email implementation
    console.log('Sending email notification:', payload);
  }

  private async sendSlackNotification(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<void> {
    const webhookUrl = channel.config.webhookUrl as string;
    if (!webhookUrl) return;

    const slackPayload = {
      text: payload.title,
      attachments: [{
        color: this.getSeverityColor(payload.severity),
        title: payload.title,
        text: payload.description,
        fields: [
          { title: 'Severity', value: payload.severity, short: true },
          { title: 'Type', value: payload.type, short: true },
          { title: 'Vendor', value: payload.vendorId, short: true },
          { title: 'Source', value: payload.source, short: true },
        ],
        footer: 'Trust Oracle',
        ts: Math.floor(payload.createdAt.getTime() / 1000),
      }],
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload),
    });
  }

  private async sendTeamsNotification(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<void> {
    const webhookUrl = channel.config.webhookUrl as string;
    if (!webhookUrl) return;

    const teamsPayload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: this.getSeverityColor(payload.severity).replace('#', ''),
      summary: payload.title,
      sections: [{
        activityTitle: payload.title,
        activitySubtitle: `Severity: ${payload.severity}`,
        facts: [
          { name: 'Type', value: payload.type },
          { name: 'Vendor', value: payload.vendorId },
          { name: 'Source', value: payload.source },
        ],
        text: payload.description,
      }],
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teamsPayload),
    });
  }

  private async sendPagerDutyNotification(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<void> {
    const routingKey = channel.config.routingKey as string;
    if (!routingKey) return;

    const pdPayload = {
      routing_key: routingKey,
      event_action: 'trigger',
      dedup_key: payload.alertId,
      payload: {
        summary: payload.title,
        severity: this.mapSeverityToPagerDuty(payload.severity),
        source: 'Trust Oracle',
        custom_details: {
          description: payload.description,
          vendor_id: payload.vendorId,
          alert_type: payload.type,
          ...payload.metadata,
        },
      },
    };

    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pdPayload),
    });
  }

  private async sendWebhookNotification(
    channel: NotificationChannel,
    payload: NotificationPayload,
  ): Promise<void> {
    const webhookUrl = channel.config.url as string;
    if (!webhookUrl) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (channel.config.authHeader) {
      headers['Authorization'] = channel.config.authHeader as string;
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }

  // ============================================================================
  // SIEM Integration
  // ============================================================================

  private async sendToSIEM(alert: Alert): Promise<void> {
    const siem = this.config.siemIntegration;
    if (!siem) return;

    const siemEvent = this.formatSIEMEvent(alert);

    try {
      await siem.sendEvent(siemEvent);
    } catch (error) {
      console.error('Failed to send event to SIEM:', error);
    }
  }

  private formatSIEMEvent(alert: Alert): SIEMEvent {
    return {
      timestamp: alert.createdAt,
      eventType: 'security_alert',
      severity: this.mapSeverityToSIEM(alert.severity),
      source: 'trust_oracle',
      category: 'vendor_risk',
      subcategory: alert.type,
      description: alert.title,
      details: {
        alertId: alert.id,
        vendorId: alert.vendorId,
        description: alert.description,
        source: alert.source,
        status: alert.status,
        ...alert.metadata,
      },
      indicators: this.extractIndicators(alert),
    };
  }

  private mapSeverityToSIEM(severity: AlertSeverity): number {
    const mapping: Record<AlertSeverity, number> = {
      info: 1,
      warning: 3,
      error: 5,
      critical: 8,
    };
    return mapping[severity];
  }

  private extractIndicators(alert: Alert): SIEMIndicator[] {
    const indicators: SIEMIndicator[] = [];

    // Extract vendor domain as indicator
    if (alert.metadata.domain) {
      indicators.push({
        type: 'domain',
        value: alert.metadata.domain as string,
        confidence: 'high',
      });
    }

    return indicators;
  }

  // ============================================================================
  // Escalation
  // ============================================================================

  private async checkEscalationPolicies(alert: Alert): Promise<void> {
    for (const policy of this.config.escalationPolicies) {
      if (this.matchesEscalationConditions(alert, policy.conditions)) {
        await this.executeEscalationActions(alert, policy.actions);
      }
    }
  }

  private matchesEscalationConditions(
    alert: Alert,
    conditions: EscalationCondition[],
  ): boolean {
    for (const condition of conditions) {
      if (!this.matchesCondition(alert, condition)) {
        return false;
      }
    }
    return true;
  }

  private matchesCondition(alert: Alert, condition: EscalationCondition): boolean {
    let fieldValue: unknown;

    switch (condition.field) {
      case 'severity':
        fieldValue = alert.severity;
        break;
      case 'type':
        fieldValue = alert.type;
        break;
      case 'age':
        fieldValue = Date.now() - alert.createdAt.getTime();
        break;
      case 'vendorTier':
        fieldValue = alert.metadata.vendorTier;
        break;
      default:
        return false;
    }

    switch (condition.operator) {
      case 'eq':
        return fieldValue === condition.value;
      case 'neq':
        return fieldValue !== condition.value;
      case 'gt':
        return (fieldValue as number) > (condition.value as number);
      case 'lt':
        return (fieldValue as number) < (condition.value as number);
      case 'in':
        return (condition.value as unknown[]).includes(fieldValue);
      default:
        return false;
    }
  }

  private async executeEscalationActions(
    alert: Alert,
    actions: EscalationAction[],
  ): Promise<void> {
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'notify':
            await this.escalationNotify(alert, action.config);
            break;
          case 'assign':
            await this.assignAlert(alert.id, action.config.assignee as string);
            break;
          case 'change_severity':
            await this.updateAlert(alert.id, {
              severity: action.config.newSeverity as AlertSeverity,
            });
            break;
          case 'create_incident':
            await this.createIncident(alert, action.config);
            break;
        }
      } catch (error) {
        console.error(`Failed to execute escalation action ${action.type}:`, error);
      }
    }
  }

  private async escalationNotify(
    alert: Alert,
    config: Record<string, unknown>,
  ): Promise<void> {
    // Send escalation notifications
    const recipients = config.recipients as string[];
    console.log(`Escalating alert ${alert.id} to:`, recipients);
  }

  private async createIncident(
    alert: Alert,
    config: Record<string, unknown>,
  ): Promise<void> {
    // Create incident in incident management system
    console.log(`Creating incident for alert ${alert.id}`);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateDedupeKey(input: CreateAlertInput): string {
    return `${input.vendorId}:${input.type}:${input.title}`;
  }

  private isWithinDedupeWindow(alert: Alert): boolean {
    return Date.now() - alert.createdAt.getTime() < this.config.deduplicationWindow;
  }

  private generateAlertActions(input: CreateAlertInput): AlertAction[] {
    const actions: AlertAction[] = [
      {
        type: 'link',
        label: 'View Vendor Details',
        target: `/vendors/${input.vendorId}`,
      },
    ];

    // Add type-specific actions
    switch (input.type) {
      case 'trust_score_degradation':
        actions.push({
          type: 'link',
          label: 'View Trust Score History',
          target: `/vendors/${input.vendorId}/trust-history`,
        });
        break;
      case 'compliance_expiration':
        actions.push({
          type: 'api_call',
          label: 'Request Renewal',
          target: `/api/vendors/${input.vendorId}/certifications/request-renewal`,
          parameters: { certificationId: input.metadata?.certificationId },
        });
        break;
      case 'breach_notification':
        actions.push({
          type: 'workflow',
          label: 'Start Incident Response',
          target: 'incident_response_workflow',
          parameters: { vendorId: input.vendorId, breachId: input.metadata?.breachId },
        });
        break;
    }

    return actions;
  }

  private mapHealthEventToAlertType(eventType: string): AlertType | null {
    const mapping: Record<string, AlertType> = {
      security_incident: 'security_incident',
      breach_disclosure: 'breach_notification',
      certificate_expiring: 'certificate_expiration',
      certificate_expired: 'certificate_expiration',
      compliance_gap: 'compliance_expiration',
      score_degradation: 'trust_score_degradation',
      sla_breach: 'sla_violation',
      dark_web_mention: 'dark_web_exposure',
      sanctions_match: 'sanctions_match',
    };
    return mapping[eventType] || null;
  }

  private mapEventSeverityToAlertSeverity(
    eventSeverity: 'info' | 'warning' | 'error' | 'critical',
  ): AlertSeverity {
    return eventSeverity;
  }

  private calculateDegradationSeverity(
    scoreDrop: number,
    vendorTier: string,
  ): AlertSeverity {
    const tierMultiplier = vendorTier === 'critical' ? 2 : vendorTier === 'high' ? 1.5 : 1;
    const adjustedDrop = scoreDrop * tierMultiplier;

    if (adjustedDrop >= 30) return 'critical';
    if (adjustedDrop >= 20) return 'error';
    if (adjustedDrop >= 10) return 'warning';
    return 'info';
  }

  private calculateBreachSeverity(breach: BreachAlertInput): AlertSeverity {
    const sensitiveTypes = ['passwords', 'financial', 'health', 'ssn', 'credit_card'];
    const hasSensitiveData = breach.dataTypes.some(t =>
      sensitiveTypes.some(s => t.toLowerCase().includes(s)),
    );

    if (hasSensitiveData && (breach.recordsAffected || 0) > 100000) return 'critical';
    if (hasSensitiveData || (breach.recordsAffected || 0) > 1000000) return 'error';
    if ((breach.recordsAffected || 0) > 10000) return 'warning';
    return 'info';
  }

  private getSeverityColor(severity: AlertSeverity): string {
    const colors: Record<AlertSeverity, string> = {
      info: '#2196F3',
      warning: '#FF9800',
      error: '#F44336',
      critical: '#9C27B0',
    };
    return colors[severity];
  }

  private mapSeverityToPagerDuty(severity: AlertSeverity): string {
    const mapping: Record<AlertSeverity, string> = {
      info: 'info',
      warning: 'warning',
      error: 'error',
      critical: 'critical',
    };
    return mapping[severity];
  }
}

// ============================================================================
// Types
// ============================================================================

export interface CreateAlertInput {
  vendorId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  source: string;
  relatedEvents?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateAlertInput {
  severity?: AlertSeverity;
  status?: AlertStatus;
  assignee?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  relatedEvents?: string[];
  metadata?: Record<string, unknown>;
}

export interface AlertResolution {
  type: 'resolved' | 'false_positive' | 'accepted_risk' | 'auto_resolved';
  reason: string;
  resolvedBy: string;
  notes?: string;
}

export interface AlertComment {
  author: string;
  content: string;
  createdAt: Date;
}

export interface ListAlertsOptions {
  vendorId?: string;
  types?: AlertType[];
  severities?: AlertSeverity[];
  statuses?: AlertStatus[];
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AlertStats {
  total: number;
  open: number;
  acknowledged: number;
  investigating: number;
  resolved: number;
  suppressed: number;
  bySeverity: Record<AlertSeverity, number>;
  byType: Record<AlertType, number>;
  averageResolutionTime: number;
  mttr: number; // Mean time to resolve
}

export interface BreachAlertInput {
  breachId: string;
  breachDate: Date;
  disclosureDate: Date;
  description: string;
  source: string;
  recordsAffected?: number;
  dataTypes: string[];
}

// ============================================================================
// Notification Channel Types
// ============================================================================

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'teams' | 'pagerduty' | 'webhook';
  enabled: boolean;
  minSeverity?: AlertSeverity;
  alertTypes?: AlertType[];
  config: Record<string, unknown>;
}

export interface NotificationPayload {
  title: string;
  description: string;
  severity: AlertSeverity;
  type: AlertType;
  vendorId: string;
  alertId: string;
  createdAt: Date;
  source: string;
  actions: AlertAction[];
  metadata: Record<string, unknown>;
}

// ============================================================================
// SIEM Integration Types
// ============================================================================

export interface SIEMIntegration {
  type: 'splunk' | 'elastic' | 'sentinel' | 'qradar' | 'custom';
  config: Record<string, unknown>;
  sendEvent(event: SIEMEvent): Promise<void>;
}

export interface SIEMEvent {
  timestamp: Date;
  eventType: string;
  severity: number;
  source: string;
  category: string;
  subcategory: string;
  description: string;
  details: Record<string, unknown>;
  indicators: SIEMIndicator[];
}

export interface SIEMIndicator {
  type: 'ip' | 'domain' | 'hash' | 'email' | 'url';
  value: string;
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================================
// Storage Interface
// ============================================================================

export interface AlertStorage {
  saveAlert(alert: Alert): Promise<void>;
  getAlert(alertId: string): Promise<Alert | null>;
  listAlerts(options: ListAlertsOptions): Promise<PaginatedResponse<Alert>>;
  getStaleAlerts(maxAgeHours: number): Promise<Alert[]>;
  getAlertStats(vendorId?: string): Promise<AlertStats>;
  addAlertComment(alertId: string, comment: AlertComment): Promise<void>;
}

// ============================================================================
// Error Class
// ============================================================================

export class AlertError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AlertError';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createAlertManager(config: AlertManagerConfig): AlertManager {
  return new AlertManager(config);
}

export function getDefaultEscalationPolicies(): EscalationPolicy[] {
  return [
    {
      name: 'Critical Vendor Alert',
      conditions: [
        { field: 'severity', operator: 'eq', value: 'critical' },
        { field: 'vendorTier', operator: 'in', value: ['critical', 'high'] },
      ],
      actions: [
        { type: 'notify', config: { recipients: ['security-team@company.com'] } },
        { type: 'create_incident', config: { priority: 'P1' } },
      ],
    },
    {
      name: 'Aged Alert Escalation',
      conditions: [
        { field: 'age', operator: 'gt', value: 24 * 60 * 60 * 1000 }, // 24 hours
        { field: 'severity', operator: 'in', value: ['error', 'critical'] },
      ],
      actions: [
        { type: 'notify', config: { recipients: ['security-manager@company.com'] } },
        { type: 'change_severity', config: { newSeverity: 'critical' } },
      ],
    },
    {
      name: 'Breach Notification',
      conditions: [
        { field: 'type', operator: 'eq', value: 'breach_notification' },
      ],
      actions: [
        { type: 'notify', config: { recipients: ['legal@company.com', 'security@company.com'] } },
        { type: 'create_incident', config: { priority: 'P1', template: 'breach_response' } },
      ],
    },
  ];
}
