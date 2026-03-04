/**
 * Stakeholder Notification Action
 *
 * Automated notification dispatch to relevant stakeholders during incidents.
 * Supports multiple channels and escalation paths.
 *
 * @packageDocumentation
 * @module security/incident/actions/notify-stakeholders
 */

import { createLogger } from '../../../common/logger.js';
import type {
  ActionDefinition,
  ActionContext,
  ActionResult,
  IncidentSeverity,
  NotificationChannel,
} from '../types.js';

const logger = createLogger({ component: 'action-notify-stakeholders' });

// ============================================================================
// Notification Types
// ============================================================================

export interface StakeholderNotification {
  stakeholder: string;
  role: string;
  channel: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  sentAt?: Date;
  deliveredAt?: Date;
  messageId?: string;
  error?: string;
}

export interface NotificationTemplate {
  subject: string;
  body: string;
  urgency: 'low' | 'normal' | 'high' | 'critical';
}

export interface StakeholderConfig {
  id: string;
  name: string;
  role: 'security_team' | 'engineering' | 'management' | 'legal' | 'communications' | 'executive' | 'dpo' | 'external';
  channels: {
    channel: string;
    address: string;
    priority: number;
  }[];
  severityThreshold: IncidentSeverity;
}

// ============================================================================
// Notification Service Interface
// ============================================================================

export interface StakeholderNotificationService {
  /** Send Slack message */
  sendSlack(channel: string, message: NotificationTemplate): Promise<{ success: boolean; messageId?: string }>;

  /** Send email */
  sendEmail(to: string, message: NotificationTemplate): Promise<{ success: boolean; messageId?: string }>;

  /** Send PagerDuty alert */
  sendPagerDuty(routingKey: string, message: NotificationTemplate): Promise<{ success: boolean; incidentId?: string }>;

  /** Send SMS */
  sendSms(phoneNumber: string, message: string): Promise<{ success: boolean; messageId?: string }>;

  /** Send Teams message */
  sendTeams(webhookUrl: string, message: NotificationTemplate): Promise<{ success: boolean; messageId?: string }>;

  /** Get stakeholders for a given severity and incident type */
  getStakeholders(severity: IncidentSeverity, incidentType: string): Promise<StakeholderConfig[]>;
}

// ============================================================================
// Default Mock Notification Service
// ============================================================================

class MockStakeholderNotificationService implements StakeholderNotificationService {
  async sendSlack(
    channel: string,
    message: NotificationTemplate
  ): Promise<{ success: boolean; messageId?: string }> {
    logger.info('Sending Slack message', { channel, subject: message.subject });
    await this.simulateOperation(300);
    return { success: true, messageId: `slack-${Date.now()}` };
  }

  async sendEmail(
    to: string,
    message: NotificationTemplate
  ): Promise<{ success: boolean; messageId?: string }> {
    logger.info('Sending email', { to, subject: message.subject });
    await this.simulateOperation(500);
    return { success: true, messageId: `email-${Date.now()}` };
  }

  async sendPagerDuty(
    routingKey: string,
    message: NotificationTemplate
  ): Promise<{ success: boolean; incidentId?: string }> {
    logger.info('Sending PagerDuty alert', { routingKey, subject: message.subject });
    await this.simulateOperation(400);
    return { success: true, incidentId: `pd-${Date.now()}` };
  }

  async sendSms(
    phoneNumber: string,
    message: string
  ): Promise<{ success: boolean; messageId?: string }> {
    logger.info('Sending SMS', { phoneNumber: phoneNumber.slice(0, -4) + '****' });
    await this.simulateOperation(600);
    return { success: true, messageId: `sms-${Date.now()}` };
  }

  async sendTeams(
    webhookUrl: string,
    message: NotificationTemplate
  ): Promise<{ success: boolean; messageId?: string }> {
    logger.info('Sending Teams message', { subject: message.subject });
    await this.simulateOperation(350);
    return { success: true, messageId: `teams-${Date.now()}` };
  }

  async getStakeholders(
    severity: IncidentSeverity,
    incidentType: string
  ): Promise<StakeholderConfig[]> {
    // Return mock stakeholders based on severity
    const stakeholders: StakeholderConfig[] = [
      {
        id: 'security-team',
        name: 'Security Team',
        role: 'security_team',
        channels: [
          { channel: 'slack', address: '#security-incidents', priority: 1 },
          { channel: 'email', address: 'security@company.com', priority: 2 },
        ],
        severityThreshold: 'P4',
      },
    ];

    if (severity === 'P1' || severity === 'P2') {
      stakeholders.push(
        {
          id: 'incident-commander',
          name: 'Incident Commander',
          role: 'security_team',
          channels: [
            { channel: 'pagerduty', address: 'security-oncall', priority: 1 },
            { channel: 'sms', address: '+1-555-0100', priority: 2 },
          ],
          severityThreshold: 'P2',
        },
        {
          id: 'engineering-lead',
          name: 'Engineering Lead',
          role: 'engineering',
          channels: [
            { channel: 'slack', address: '#engineering-oncall', priority: 1 },
            { channel: 'pagerduty', address: 'engineering-oncall', priority: 2 },
          ],
          severityThreshold: 'P2',
        }
      );
    }

    if (severity === 'P1') {
      stakeholders.push(
        {
          id: 'ciso',
          name: 'CISO',
          role: 'executive',
          channels: [
            { channel: 'sms', address: '+1-555-0101', priority: 1 },
            { channel: 'email', address: 'ciso@company.com', priority: 2 },
          ],
          severityThreshold: 'P1',
        },
        {
          id: 'legal-team',
          name: 'Legal Team',
          role: 'legal',
          channels: [
            { channel: 'email', address: 'legal@company.com', priority: 1 },
            { channel: 'slack', address: '#legal-security', priority: 2 },
          ],
          severityThreshold: 'P1',
        },
        {
          id: 'cto',
          name: 'CTO',
          role: 'executive',
          channels: [
            { channel: 'sms', address: '+1-555-0102', priority: 1 },
            { channel: 'email', address: 'cto@company.com', priority: 2 },
          ],
          severityThreshold: 'P1',
        }
      );

      // Add DPO for data breach incidents
      if (incidentType === 'data_breach') {
        stakeholders.push({
          id: 'dpo',
          name: 'Data Protection Officer',
          role: 'dpo',
          channels: [
            { channel: 'email', address: 'dpo@company.com', priority: 1 },
            { channel: 'sms', address: '+1-555-0103', priority: 2 },
          ],
          severityThreshold: 'P1',
        });
      }
    }

    return stakeholders;
  }

  private simulateOperation(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Notification Service
// ============================================================================

let notificationService: StakeholderNotificationService | null = null;

export function setStakeholderNotificationService(service: StakeholderNotificationService): void {
  notificationService = service;
}

export function getStakeholderNotificationService(): StakeholderNotificationService {
  if (!notificationService) {
    throw new Error(
      'No stakeholder notification service configured. Call setStakeholderNotificationService() with a real implementation before use. ' +
      'For tests, use createMockStakeholderNotificationService().'
    );
  }
  return notificationService;
}

/** Create a mock stakeholder notification service for testing only. */
export function createMockStakeholderNotificationService(): StakeholderNotificationService {
  return new MockStakeholderNotificationService();
}

// ============================================================================
// Action Implementation
// ============================================================================

async function executeNotification(context: ActionContext): Promise<ActionResult> {
  const { incident, logger: actionLogger, setVariable, getVariable } = context;
  const startTime = Date.now();
  const notifications: StakeholderNotification[] = [];
  const service = getStakeholderNotificationService();

  actionLogger.info('Starting stakeholder notification', {
    incidentId: incident.id,
    severity: incident.severity,
    type: incident.type,
  });

  try {
    // Get stakeholders based on severity and incident type
    const stakeholders = await service.getStakeholders(
      incident.severity,
      incident.type
    );

    if (stakeholders.length === 0) {
      actionLogger.warn('No stakeholders identified for notification');
      return {
        success: true,
        output: { message: 'No stakeholders identified', notifications: [] },
        metrics: { durationMs: Date.now() - startTime, itemsProcessed: 0 },
        canRollback: false,
      };
    }

    actionLogger.info('Identified stakeholders', {
      count: stakeholders.length,
      roles: Array.from(new Set(stakeholders.map((s) => s.role))),
    });

    // Build notification message
    const template = buildNotificationTemplate(incident);

    let successCount = 0;
    let failureCount = 0;

    // Notify each stakeholder via their preferred channels
    for (const stakeholder of stakeholders) {
      // Check severity threshold
      if (!meetsSeqThreshold(incident.severity, stakeholder.severityThreshold)) {
        actionLogger.debug('Stakeholder below severity threshold', {
          stakeholder: stakeholder.id,
          incidentSeverity: incident.severity,
          threshold: stakeholder.severityThreshold,
        });
        continue;
      }

      // Try channels in priority order
      let notified = false;
      for (const channelConfig of stakeholder.channels.sort((a, b) => a.priority - b.priority)) {
        const notification: StakeholderNotification = {
          stakeholder: stakeholder.id,
          role: stakeholder.role,
          channel: channelConfig.channel,
          status: 'pending',
        };

        try {
          const result = await sendNotification(
            channelConfig.channel,
            channelConfig.address,
            template,
            actionLogger
          );

          notification.status = result.success ? 'sent' : 'failed';
          notification.sentAt = new Date();
          notification.messageId = result.messageId;

          if (result.success) {
            notified = true;
            actionLogger.info('Notification sent', {
              stakeholder: stakeholder.id,
              channel: channelConfig.channel,
            });
            break; // Success, don't try fallback channels
          } else {
            notification.error = result.error;
            actionLogger.warn('Notification failed, trying fallback', {
              stakeholder: stakeholder.id,
              channel: channelConfig.channel,
              error: result.error,
            });
          }
        } catch (error) {
          notification.status = 'failed';
          notification.error = error instanceof Error ? error.message : String(error);
          actionLogger.error('Notification error', {
            stakeholder: stakeholder.id,
            channel: channelConfig.channel,
            error: notification.error,
          });
        }

        notifications.push(notification);
      }

      if (notified) {
        successCount++;
      } else {
        failureCount++;
        actionLogger.error('Failed to notify stakeholder via any channel', {
          stakeholder: stakeholder.id,
        });
      }
    }

    // Store notifications for reference
    setVariable('stakeholder_notifications', notifications);

    const durationMs = Date.now() - startTime;

    // Consider partial success as success (some notifications went through)
    const success = successCount > 0;

    actionLogger.info('Stakeholder notification completed', {
      success,
      successCount,
      failureCount,
      totalNotifications: notifications.length,
      durationMs,
    });

    return {
      success,
      output: {
        message: success
          ? `Notified ${successCount} stakeholder(s) successfully`
          : 'Failed to notify any stakeholders',
        notifications,
        successCount,
        failureCount,
        stakeholdersNotified: stakeholders
          .filter((s) => notifications.some((n) => n.stakeholder === s.id && n.status === 'sent'))
          .map((s) => s.name),
      },
      metrics: {
        durationMs,
        itemsProcessed: successCount,
        itemsFailed: failureCount,
      },
      canRollback: false, // Notifications cannot be rolled back
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    actionLogger.error('Stakeholder notification failed', { error: errorMessage });

    return {
      success: false,
      error: errorMessage,
      metrics: { durationMs: Date.now() - startTime },
      canRollback: false,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildNotificationTemplate(incident: {
  id?: string;
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  type?: string;
  status?: string;
  detectedAt?: Date;
}): NotificationTemplate {
  const severityEmoji: Record<IncidentSeverity, string> = {
    P1: '[CRITICAL]',
    P2: '[HIGH]',
    P3: '[MEDIUM]',
    P4: '[LOW]',
  };

  const urgencyMap: Record<IncidentSeverity, NotificationTemplate['urgency']> = {
    P1: 'critical',
    P2: 'high',
    P3: 'normal',
    P4: 'low',
  };

  const severity = incident.severity || 'P3';
  const title = incident.title || 'Security Incident';
  const description = incident.description || 'No description provided';
  const id = incident.id || 'unknown';
  const type = incident.type || 'unknown';
  const status = incident.status || 'unknown';
  const detectedAt = incident.detectedAt || new Date();

  return {
    subject: `${severityEmoji[severity]} Security Incident: ${title}`,
    body: `
Security Incident Alert
=======================

Incident ID: ${id}
Severity: ${severity}
Type: ${type}
Status: ${status}
Detected: ${detectedAt.toISOString()}

Description:
${description}

Please review and take appropriate action.

---
This is an automated notification from the Incident Response System.
    `.trim(),
    urgency: urgencyMap[severity],
  };
}

function meetsSeqThreshold(
  incidentSeverity: IncidentSeverity,
  threshold: IncidentSeverity
): boolean {
  const severityOrder: Record<IncidentSeverity, number> = {
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
  };

  // Lower number = higher severity
  return severityOrder[incidentSeverity] <= severityOrder[threshold];
}

async function sendNotification(
  channel: string,
  address: string,
  template: NotificationTemplate,
  actionLogger: ActionContext['logger']
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const service = getStakeholderNotificationService();
  switch (channel) {
    case 'slack':
      return service.sendSlack(address, template);

    case 'email':
      return service.sendEmail(address, template);

    case 'pagerduty':
      const pdResult = await service.sendPagerDuty(address, template);
      return { success: pdResult.success, messageId: pdResult.incidentId };

    case 'sms':
      // SMS uses abbreviated message
      const smsMessage = `${template.subject}\n${template.body.slice(0, 140)}...`;
      return service.sendSms(address, smsMessage);

    case 'teams':
      return service.sendTeams(address, template);

    default:
      actionLogger.warn('Unknown notification channel', { channel });
      return { success: false, error: `Unknown channel: ${channel}` };
  }
}

// ============================================================================
// Action Definition Export
// ============================================================================

export const notifyStakeholdersAction: ActionDefinition = {
  id: 'notify-stakeholders',
  name: 'Notify Stakeholders',
  description: 'Send automated notifications to relevant stakeholders based on incident severity and type',
  category: 'notification',
  riskLevel: 'low',
  requiresApproval: false,
  supportsRollback: false,
  defaultTimeoutMs: 120000, // 2 minutes
  maxRetries: 3,
  execute: executeNotification,
  validate: async (context) => {
    const { incident } = context;

    // Always valid - stakeholder list is determined dynamically
    if (!incident.severity) {
      return {
        valid: false,
        reason: 'Incident severity is required for stakeholder notification',
      };
    }

    return { valid: true };
  },
};

export default notifyStakeholdersAction;
