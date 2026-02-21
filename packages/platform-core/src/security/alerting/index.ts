/**
 * Security Alerting System
 *
 * Comprehensive security alerting system with:
 * - Configurable alert rules and detection
 * - Multiple delivery channels (Slack, PagerDuty, Email, Webhook, SNS)
 * - Alert deduplication and rate limiting
 * - Escalation management
 * - Maintenance window support
 * - Integration with incident response
 *
 * @packageDocumentation
 * @module security/alerting
 */

// =============================================================================
// Types
// =============================================================================

export {
  // Enums
  AlertSeverity,
  AlertChannel,
  SecurityEventType,
  ConditionOperator,

  // Alert types
  type AlertContext,
  type SecurityAlert,
  type CreateAlertInput,

  // Rule types
  type AlertCondition,
  type AlertThreshold,
  type ChannelConfig,
  type AlertRule,

  // Configuration types
  type MaintenanceWindow,
  type EscalationPolicy,
  type AlertConfig,

  // Event types
  type AlertEvent,
  type AlertEventCallback,
  type AlertDeliveryResult,

  // Schemas
  alertSeveritySchema,
  alertChannelSchema,
  securityEventTypeSchema,
  conditionOperatorSchema,
  alertContextSchema,
  securityAlertSchema,
  createAlertInputSchema,
  alertConditionSchema,
  alertThresholdSchema,
  channelConfigSchema,
  alertRuleSchema,
  maintenanceWindowSchema,
  escalationPolicySchema,
  alertConfigSchema,
  alertDeliveryResultSchema,

  // Defaults
  DEFAULT_ALERT_CONFIG,
} from './types.js';

// =============================================================================
// Detector
// =============================================================================

export {
  SecurityAlertDetector,
  getSecurityAlertDetector,
  resetSecurityAlertDetector,
  createSecurityAlertDetector,

  // Types
  type DetectorSecurityEvent,
  type DetectionResult,
  type BuiltInDetectorConfig,
  type SecurityAlertDetectorOptions,

  // Defaults
  DEFAULT_BUILTIN_DETECTOR_CONFIG,
} from './detector.js';

// =============================================================================
// Service
// =============================================================================

export {
  SecurityAlertService,
  getSecurityAlertService,
  resetSecurityAlertService,
  createSecurityAlertService,

  // Types
  type SecurityAlertServiceOptions,
} from './service.js';

// =============================================================================
// Channels
// =============================================================================

export {
  // Slack
  SlackAlertChannel,
  createSlackChannel,
  type SlackChannelConfig,

  // PagerDuty
  PagerDutyAlertChannel,
  createPagerDutyChannel,
  type PagerDutyChannelConfig,

  // Email
  EmailAlertChannel,
  createEmailChannel,
  type EmailChannelConfig,

  // Webhook
  WebhookAlertChannel,
  createWebhookChannel,
  createSignedWebhookChannel,
  type WebhookChannelConfig,

  // SNS
  SNSAlertChannel,
  createSNSChannel,
  type SNSChannelConfig,

  // Common interface
  type AlertChannelInterface,
} from './channels/index.js';

// =============================================================================
// Convenience Functions
// =============================================================================

import { SecurityAlertService, getSecurityAlertService } from './service.js';
import { SecurityEventType, AlertSeverity, type CreateAlertInput, type AlertContext } from './types.js';

/**
 * Quick alert creation for common security events
 */
export const SecurityAlerts = {
  /**
   * Create a brute force attack alert
   */
  bruteForce: async (
    context: AlertContext,
    attemptCount: number,
    windowMinutes: number
  ) => {
    const service = getSecurityAlertService();
    return service.createAlert({
      severity: AlertSeverity.HIGH,
      type: SecurityEventType.BRUTE_FORCE,
      title: 'Brute Force Attack Detected',
      message: `Detected ${attemptCount} failed login attempts within ${windowMinutes} minutes`,
      context,
      source: 'security-alerts',
      suggestedActions: [
        'Verify the user account is secure',
        'Consider temporarily blocking the source IP',
        'Review recent access logs',
      ],
      tags: ['brute-force', 'authentication'],
    });
  },

  /**
   * Create a credential stuffing alert
   */
  credentialStuffing: async (
    context: AlertContext,
    uniqueUsers: number,
    uniquePasswords: number
  ) => {
    const service = getSecurityAlertService();
    return service.createAlert({
      severity: AlertSeverity.CRITICAL,
      type: SecurityEventType.CREDENTIAL_STUFFING,
      title: 'Credential Stuffing Attack Detected',
      message: `Detected ${uniqueUsers} unique usernames with only ${uniquePasswords} password patterns from IP ${context.ipAddress}`,
      context,
      source: 'security-alerts',
      suggestedActions: [
        'Block the source IP immediately',
        'Notify affected users',
        'Check for successful logins from this IP',
      ],
      tags: ['credential-stuffing', 'automated-attack'],
    });
  },

  /**
   * Create a privilege escalation alert
   */
  privilegeEscalation: async (
    context: AlertContext,
    attemptedAction: string,
    requiredPermission: string
  ) => {
    const service = getSecurityAlertService();
    return service.createAlert({
      severity: AlertSeverity.CRITICAL,
      type: SecurityEventType.PRIVILEGE_ESCALATION,
      title: 'Privilege Escalation Attempt',
      message: `User ${context.userId} attempted to perform "${attemptedAction}" without "${requiredPermission}" permission`,
      context,
      source: 'security-alerts',
      suggestedActions: [
        'Review user permissions immediately',
        'Audit recent user activity',
        'Consider restricting the user account',
      ],
      tags: ['privilege-escalation', 'authorization'],
    });
  },

  /**
   * Create an unusual access pattern alert
   */
  unusualAccess: async (
    context: AlertContext,
    description: string
  ) => {
    const service = getSecurityAlertService();
    return service.createAlert({
      severity: AlertSeverity.MEDIUM,
      type: SecurityEventType.UNUSUAL_ACCESS_PATTERN,
      title: 'Unusual Access Pattern Detected',
      message: description,
      context,
      source: 'security-alerts',
      suggestedActions: [
        'Verify the access is legitimate',
        'Contact the user if necessary',
        'Review recent session activity',
      ],
      tags: ['unusual-access', 'behavioral'],
    });
  },

  /**
   * Create an API key abuse alert
   */
  apiKeyAbuse: async (
    context: AlertContext,
    apiKeyId: string,
    rateLimitHits: number
  ) => {
    const service = getSecurityAlertService();
    return service.createAlert({
      severity: AlertSeverity.HIGH,
      type: SecurityEventType.API_KEY_ABUSE,
      title: 'API Key Abuse Detected',
      message: `API key ${apiKeyId.slice(0, 8)}... exceeded rate limits ${rateLimitHits} times`,
      context: {
        ...context,
        metadata: { ...context.metadata, apiKeyId },
      },
      source: 'security-alerts',
      suggestedActions: [
        'Contact the API key owner',
        'Consider revoking the key',
        'Review request patterns',
      ],
      tags: ['api-key-abuse', 'rate-limit'],
    });
  },

  /**
   * Create a security configuration change alert
   */
  configChange: async (
    context: AlertContext,
    changeType: string,
    resource: string,
    previousValue?: string,
    newValue?: string
  ) => {
    const service = getSecurityAlertService();
    let message = `Security configuration change: ${changeType} on ${resource}`;
    if (previousValue !== undefined && newValue !== undefined) {
      message += `. Changed from "${previousValue}" to "${newValue}"`;
    }

    return service.createAlert({
      severity: AlertSeverity.MEDIUM,
      type: SecurityEventType.SECURITY_CONFIG_CHANGE,
      title: 'Security Configuration Change',
      message,
      context,
      source: 'security-alerts',
      suggestedActions: [
        'Verify the change was authorized',
        'Document in change management system',
        'Review security implications',
      ],
      tags: ['config-change', 'audit'],
    });
  },

  /**
   * Create a data exfiltration alert
   */
  dataExfiltration: async (
    context: AlertContext,
    description: string
  ) => {
    const service = getSecurityAlertService();
    return service.createAlert({
      severity: AlertSeverity.CRITICAL,
      type: SecurityEventType.DATA_EXFILTRATION,
      title: 'Potential Data Exfiltration',
      message: description,
      context,
      source: 'security-alerts',
      suggestedActions: [
        'Investigate immediately',
        'Preserve evidence',
        'Consider initiating incident response',
        'Notify security team',
      ],
      tags: ['data-exfiltration', 'critical'],
    });
  },

  /**
   * Create a custom security alert
   */
  custom: async (input: CreateAlertInput) => {
    const service = getSecurityAlertService();
    return service.createAlert(input);
  },
};
