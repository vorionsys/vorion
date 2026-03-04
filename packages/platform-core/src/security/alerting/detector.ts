/**
 * Security Alert Detector
 *
 * Detects security events and triggers alerts based on configurable rules.
 * Built-in detection for common security threats:
 * - Brute force attacks
 * - Credential stuffing
 * - Privilege escalation attempts
 * - Unusual access patterns
 * - API key abuse
 * - Security configuration changes
 *
 * @packageDocumentation
 * @module security/alerting/detector
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../../common/logger.js';
import { getRedis } from '../../common/redis.js';
import {
  type SecurityAlert,
  type AlertRule,
  type AlertCondition,
  type AlertThreshold,
  type CreateAlertInput,
  type AlertContext,
  AlertSeverity,
  SecurityEventType,
  ConditionOperator,
} from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

const logger = createLogger({ component: 'security-alert-detector' });

// =============================================================================
// Constants
// =============================================================================

const COUNTER_PREFIX = 'vorion:alerting:counter:';
const COOLDOWN_PREFIX = 'vorion:alerting:cooldown:';
const CREDENTIAL_TRACK_PREFIX = 'vorion:alerting:credential:';

// =============================================================================
// Types
// =============================================================================

/**
 * Security event for detection
 */
export interface DetectorSecurityEvent {
  /** Event type */
  type: SecurityEventType;
  /** Event context */
  context: AlertContext;
  /** When the event occurred */
  timestamp: Date;
  /** Whether the action was successful */
  success: boolean;
  /** Additional event data */
  data?: Record<string, unknown>;
}

/**
 * Detection result
 */
export interface DetectionResult {
  /** Whether an alert should be triggered */
  shouldAlert: boolean;
  /** The alert to create (if shouldAlert is true) */
  alert?: CreateAlertInput;
  /** Which rule triggered the alert */
  triggeredRule?: AlertRule;
  /** Reason for detection/non-detection */
  reason: string;
}

/**
 * Configuration for built-in detection rules
 */
export interface BuiltInDetectorConfig {
  /** Brute force detection */
  bruteForce: {
    enabled: boolean;
    maxAttempts: number;
    windowSeconds: number;
    severity: AlertSeverity;
  };
  /** Credential stuffing detection */
  credentialStuffing: {
    enabled: boolean;
    minUniqueUsers: number;
    maxUniquePasswords: number;
    windowSeconds: number;
    severity: AlertSeverity;
  };
  /** Privilege escalation detection */
  privilegeEscalation: {
    enabled: boolean;
    severity: AlertSeverity;
  };
  /** Unusual access patterns */
  unusualAccess: {
    enabled: boolean;
    geoAnomalyEnabled: boolean;
    timeAnomalyEnabled: boolean;
    severity: AlertSeverity;
    normalHoursStart: number;
    normalHoursEnd: number;
    normalDays: number[];
  };
  /** API key abuse detection */
  apiKeyAbuse: {
    enabled: boolean;
    rateLimitHitsThreshold: number;
    windowSeconds: number;
    severity: AlertSeverity;
  };
  /** Security configuration changes */
  configChanges: {
    enabled: boolean;
    severity: AlertSeverity;
  };
}

/**
 * Default built-in detector configuration
 */
export const DEFAULT_BUILTIN_DETECTOR_CONFIG: BuiltInDetectorConfig = {
  bruteForce: {
    enabled: true,
    maxAttempts: 5,
    windowSeconds: 300, // 5 minutes
    severity: AlertSeverity.HIGH,
  },
  credentialStuffing: {
    enabled: true,
    minUniqueUsers: 5,
    maxUniquePasswords: 3,
    windowSeconds: 600, // 10 minutes
    severity: AlertSeverity.CRITICAL,
  },
  privilegeEscalation: {
    enabled: true,
    severity: AlertSeverity.CRITICAL,
  },
  unusualAccess: {
    enabled: true,
    geoAnomalyEnabled: true,
    timeAnomalyEnabled: true,
    severity: AlertSeverity.MEDIUM,
    normalHoursStart: 6,
    normalHoursEnd: 22,
    normalDays: [1, 2, 3, 4, 5], // Monday-Friday
  },
  apiKeyAbuse: {
    enabled: true,
    rateLimitHitsThreshold: 10,
    windowSeconds: 60,
    severity: AlertSeverity.HIGH,
  },
  configChanges: {
    enabled: true,
    severity: AlertSeverity.MEDIUM,
  },
};

// =============================================================================
// SecurityAlertDetector Class
// =============================================================================

/**
 * Detects security events and determines when alerts should be triggered
 */
export class SecurityAlertDetector {
  private readonly redis: Redis;
  private readonly customRules: Map<string, AlertRule> = new Map();
  private readonly builtInConfig: BuiltInDetectorConfig;
  private readonly keyPrefix: string;

  constructor(
    options: {
      redis?: Redis;
      builtInConfig?: Partial<BuiltInDetectorConfig>;
      keyPrefix?: string;
    } = {}
  ) {
    this.redis = options.redis ?? getRedis();
    this.builtInConfig = {
      ...DEFAULT_BUILTIN_DETECTOR_CONFIG,
      ...options.builtInConfig,
    };
    this.keyPrefix = options.keyPrefix ?? 'vorion:alerting:';

    logger.info(
      { builtInConfig: this.builtInConfig },
      'SecurityAlertDetector initialized'
    );
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Process a security event and determine if alerts should be triggered
   */
  async detect(event: DetectorSecurityEvent): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];

    // Check built-in detectors
    const builtInResults = await this.runBuiltInDetectors(event);
    results.push(...builtInResults);

    // Check custom rules
    const customResults = await this.runCustomRules(event);
    results.push(...customResults);

    // Log detection results
    const alertResults = results.filter(r => r.shouldAlert);
    if (alertResults.length > 0) {
      logger.info(
        {
          eventType: event.type,
          alertCount: alertResults.length,
          rules: alertResults.map(r => r.triggeredRule?.id ?? 'built-in'),
        },
        'Security alerts triggered'
      );
    }

    return results;
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.customRules.set(rule.id, rule);
    logger.info({ ruleId: rule.id, ruleName: rule.name }, 'Custom rule added');
  }

  /**
   * Remove a custom alert rule
   */
  removeRule(ruleId: string): boolean {
    const removed = this.customRules.delete(ruleId);
    if (removed) {
      logger.info({ ruleId }, 'Custom rule removed');
    }
    return removed;
  }

  /**
   * Get all custom rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.customRules.values());
  }

  /**
   * Check if an alert is in cooldown
   */
  async isInCooldown(fingerprint: string): Promise<boolean> {
    const key = `${COOLDOWN_PREFIX}${fingerprint}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Set cooldown for an alert
   */
  async setCooldown(fingerprint: string, seconds: number): Promise<void> {
    const key = `${COOLDOWN_PREFIX}${fingerprint}`;
    await this.redis.setex(key, seconds, '1');
  }

  /**
   * Get current counter value
   */
  async getCounter(key: string): Promise<number> {
    const value = await this.redis.get(`${COUNTER_PREFIX}${key}`);
    return value ? parseInt(value, 10) : 0;
  }

  // ===========================================================================
  // Built-in Detectors
  // ===========================================================================

  private async runBuiltInDetectors(event: DetectorSecurityEvent): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];

    // Brute force detection
    if (this.builtInConfig.bruteForce.enabled) {
      const bruteForceResult = await this.detectBruteForce(event);
      if (bruteForceResult) results.push(bruteForceResult);
    }

    // Credential stuffing detection
    if (this.builtInConfig.credentialStuffing.enabled) {
      const credentialStuffingResult = await this.detectCredentialStuffing(event);
      if (credentialStuffingResult) results.push(credentialStuffingResult);
    }

    // Privilege escalation detection
    if (this.builtInConfig.privilegeEscalation.enabled) {
      const privEscResult = await this.detectPrivilegeEscalation(event);
      if (privEscResult) results.push(privEscResult);
    }

    // Unusual access pattern detection
    if (this.builtInConfig.unusualAccess.enabled) {
      const unusualAccessResult = await this.detectUnusualAccess(event);
      if (unusualAccessResult) results.push(unusualAccessResult);
    }

    // API key abuse detection
    if (this.builtInConfig.apiKeyAbuse.enabled) {
      const apiKeyAbuseResult = await this.detectApiKeyAbuse(event);
      if (apiKeyAbuseResult) results.push(apiKeyAbuseResult);
    }

    // Security config change detection
    if (this.builtInConfig.configChanges.enabled) {
      const configChangeResult = await this.detectConfigChange(event);
      if (configChangeResult) results.push(configChangeResult);
    }

    return results;
  }

  /**
   * Detect brute force attacks
   * Triggers when N failed logins occur in M minutes for the same identifier
   */
  private async detectBruteForce(event: DetectorSecurityEvent): Promise<DetectionResult | null> {
    // Only check failed authentication events
    if (event.success) return null;

    const relevantTypes: SecurityEventType[] = [
      SecurityEventType.BRUTE_FORCE,
      SecurityEventType.ACCOUNT_LOCKOUT,
    ];

    // Check if event is auth-related or explicitly marked as brute force
    const isAuthEvent = event.type === SecurityEventType.BRUTE_FORCE ||
      event.type === SecurityEventType.ACCOUNT_LOCKOUT ||
      (event.data?.eventType === 'login' && !event.success);

    if (!relevantTypes.includes(event.type) && !isAuthEvent) {
      return null;
    }

    const config = this.builtInConfig.bruteForce;
    const identifier = event.context.userId || event.context.ipAddress;

    if (!identifier) {
      return { shouldAlert: false, reason: 'No identifier available for brute force detection' };
    }

    // Increment counter
    const counterKey = `brute_force:${identifier}`;
    const count = await this.incrementSlidingWindowCounter(
      counterKey,
      config.windowSeconds
    );

    if (count >= config.maxAttempts) {
      const fingerprint = this.generateFingerprint('brute_force', identifier);

      // Check cooldown
      if (await this.isInCooldown(fingerprint)) {
        return { shouldAlert: false, reason: 'Alert in cooldown period' };
      }

      return {
        shouldAlert: true,
        reason: `Brute force attack detected: ${count} failed attempts in ${config.windowSeconds}s`,
        alert: {
          severity: config.severity,
          type: SecurityEventType.BRUTE_FORCE,
          title: 'Brute Force Attack Detected',
          message: `Detected ${count} failed login attempts for ${event.context.userId ? 'user' : 'IP'} ${identifier} within ${config.windowSeconds / 60} minutes. This may indicate a brute force attack attempt.`,
          context: event.context,
          source: 'security-alert-detector',
          suggestedActions: [
            'Verify the user account is secure',
            'Consider temporarily blocking the source IP',
            'Review recent access logs for the affected account',
            'Enable or strengthen MFA if not already in place',
          ],
          tags: ['brute-force', 'authentication'],
        },
      };
    }

    return { shouldAlert: false, reason: `Failed attempts: ${count}/${config.maxAttempts}` };
  }

  /**
   * Detect credential stuffing attacks
   * Many different users with few unique passwords from same source
   */
  private async detectCredentialStuffing(event: DetectorSecurityEvent): Promise<DetectionResult | null> {
    // Only check failed authentication events
    if (event.success) return null;

    const isAuthEvent = event.type === SecurityEventType.CREDENTIAL_STUFFING ||
      (event.data?.eventType === 'login' && !event.success);

    if (!isAuthEvent && event.type !== SecurityEventType.CREDENTIAL_STUFFING) {
      return null;
    }

    const config = this.builtInConfig.credentialStuffing;
    const ipAddress = event.context.ipAddress;

    if (!ipAddress) {
      return { shouldAlert: false, reason: 'No IP address for credential stuffing detection' };
    }

    // Track unique users and passwords per IP
    const usersKey = `${CREDENTIAL_TRACK_PREFIX}users:${ipAddress}`;
    const passwordsKey = `${CREDENTIAL_TRACK_PREFIX}passwords:${ipAddress}`;

    // Add user to set
    if (event.context.userId) {
      await this.redis.sadd(usersKey, event.context.userId);
      await this.redis.expire(usersKey, config.windowSeconds);
    }

    // Hash password attempt and add to set (we don't store actual passwords)
    const passwordHash = event.data?.passwordHash as string | undefined;
    if (passwordHash) {
      const hash = createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
      await this.redis.sadd(passwordsKey, hash);
      await this.redis.expire(passwordsKey, config.windowSeconds);
    }

    const uniqueUsers = await this.redis.scard(usersKey);
    const uniquePasswords = await this.redis.scard(passwordsKey);

    // Credential stuffing: many users, few passwords
    if (uniqueUsers >= config.minUniqueUsers && uniquePasswords <= config.maxUniquePasswords) {
      const fingerprint = this.generateFingerprint('credential_stuffing', ipAddress);

      if (await this.isInCooldown(fingerprint)) {
        return { shouldAlert: false, reason: 'Alert in cooldown period' };
      }

      return {
        shouldAlert: true,
        reason: `Credential stuffing detected: ${uniqueUsers} users, ${uniquePasswords} passwords`,
        alert: {
          severity: config.severity,
          type: SecurityEventType.CREDENTIAL_STUFFING,
          title: 'Credential Stuffing Attack Detected',
          message: `Detected potential credential stuffing from IP ${ipAddress}: ${uniqueUsers} unique usernames attempted with only ${uniquePasswords} unique password patterns. This is a strong indicator of an automated attack using leaked credentials.`,
          context: event.context,
          source: 'security-alert-detector',
          suggestedActions: [
            'Block the source IP immediately',
            'Notify affected users to reset passwords',
            'Review if any attempts were successful',
            'Check for compromised accounts in recent breach databases',
            'Consider implementing rate limiting on authentication endpoints',
          ],
          tags: ['credential-stuffing', 'authentication', 'automated-attack'],
        },
      };
    }

    return { shouldAlert: false, reason: `Users: ${uniqueUsers}, Passwords: ${uniquePasswords}` };
  }

  /**
   * Detect privilege escalation attempts
   */
  private async detectPrivilegeEscalation(event: DetectorSecurityEvent): Promise<DetectionResult | null> {
    if (event.type !== SecurityEventType.PRIVILEGE_ESCALATION &&
        event.type !== SecurityEventType.UNAUTHORIZED_ACCESS) {
      return null;
    }

    const config = this.builtInConfig.privilegeEscalation;
    const fingerprint = this.generateFingerprint(
      'priv_esc',
      event.context.userId || event.context.ipAddress || 'unknown'
    );

    if (await this.isInCooldown(fingerprint)) {
      return { shouldAlert: false, reason: 'Alert in cooldown period' };
    }

    const attemptedAction = event.data?.attemptedAction as string || 'unknown action';
    const requiredPermission = event.data?.requiredPermission as string || 'unknown permission';

    return {
      shouldAlert: true,
      reason: 'Privilege escalation attempt detected',
      alert: {
        severity: config.severity,
        type: SecurityEventType.PRIVILEGE_ESCALATION,
        title: 'Privilege Escalation Attempt Detected',
        message: `User ${event.context.userId || 'unknown'} attempted to perform ${attemptedAction} without required permission ${requiredPermission}. This may indicate an attempt to gain unauthorized access to elevated privileges.`,
        context: event.context,
        source: 'security-alert-detector',
        suggestedActions: [
          'Review user account permissions immediately',
          'Check for recent permission changes',
          'Audit all actions by this user in the past 24 hours',
          'Consider temporarily restricting the user account',
          'Investigate potential account compromise',
        ],
        tags: ['privilege-escalation', 'authorization'],
      },
    };
  }

  /**
   * Detect unusual access patterns (geo anomaly, time anomaly)
   */
  private async detectUnusualAccess(event: DetectorSecurityEvent): Promise<DetectionResult | null> {
    const relevantTypes: SecurityEventType[] = [
      SecurityEventType.UNUSUAL_ACCESS_PATTERN,
      SecurityEventType.IMPOSSIBLE_TRAVEL,
      SecurityEventType.NEW_DEVICE_LOGIN,
      SecurityEventType.UNUSUAL_TIME_ACCESS,
    ];

    if (!relevantTypes.includes(event.type)) {
      return null;
    }

    const config = this.builtInConfig.unusualAccess;
    const fingerprint = this.generateFingerprint(
      'unusual_access',
      `${event.context.userId}:${event.type}`
    );

    if (await this.isInCooldown(fingerprint)) {
      return { shouldAlert: false, reason: 'Alert in cooldown period' };
    }

    let title: string;
    let message: string;
    const suggestedActions: string[] = [];

    switch (event.type) {
      case SecurityEventType.IMPOSSIBLE_TRAVEL:
        title = 'Impossible Travel Detected';
        message = `User ${event.context.userId} logged in from ${event.context.location?.city || event.context.location?.country || 'unknown location'} shortly after being in a different geographic location. This may indicate account compromise.`;
        suggestedActions.push(
          'Verify the login with the user',
          'Check for VPN or proxy usage',
          'Review recent account activity',
          'Consider requiring password reset',
        );
        break;

      case SecurityEventType.NEW_DEVICE_LOGIN:
        title = 'New Device Login Detected';
        message = `User ${event.context.userId} logged in from a previously unseen device. User agent: ${event.context.userAgent || 'unknown'}`;
        suggestedActions.push(
          'Send notification to user about new device',
          'Verify the login is legitimate',
          'Consider requiring additional authentication',
        );
        break;

      case SecurityEventType.UNUSUAL_TIME_ACCESS:
        title = 'Unusual Time Access Detected';
        const hour = event.timestamp.getHours();
        message = `User ${event.context.userId} accessed the system at ${hour}:00, which is outside their normal access hours.`;
        suggestedActions.push(
          'Verify if the user is traveling or working remotely',
          'Check for any anomalous activity during this session',
          'Review the accessed resources',
        );
        break;

      default:
        title = 'Unusual Access Pattern Detected';
        message = `Unusual access pattern detected for user ${event.context.userId}.`;
        suggestedActions.push(
          'Review recent activity for this user',
          'Verify the access is legitimate',
        );
    }

    return {
      shouldAlert: true,
      reason: `Unusual access pattern: ${event.type}`,
      alert: {
        severity: config.severity,
        type: event.type,
        title,
        message,
        context: event.context,
        source: 'security-alert-detector',
        suggestedActions,
        tags: ['unusual-access', 'behavioral-anomaly'],
      },
    };
  }

  /**
   * Detect API key abuse (excessive rate limit hits)
   */
  private async detectApiKeyAbuse(event: DetectorSecurityEvent): Promise<DetectionResult | null> {
    if (event.type !== SecurityEventType.RATE_LIMIT_EXCEEDED &&
        event.type !== SecurityEventType.API_KEY_ABUSE) {
      return null;
    }

    const config = this.builtInConfig.apiKeyAbuse;
    const apiKeyId = event.data?.apiKeyId as string || event.context.metadata?.apiKeyId as string;

    if (!apiKeyId) {
      return { shouldAlert: false, reason: 'No API key ID for abuse detection' };
    }

    // Count rate limit hits
    const counterKey = `api_key_abuse:${apiKeyId}`;
    const count = await this.incrementSlidingWindowCounter(
      counterKey,
      config.windowSeconds
    );

    if (count >= config.rateLimitHitsThreshold) {
      const fingerprint = this.generateFingerprint('api_key_abuse', apiKeyId);

      if (await this.isInCooldown(fingerprint)) {
        return { shouldAlert: false, reason: 'Alert in cooldown period' };
      }

      return {
        shouldAlert: true,
        reason: `API key abuse: ${count} rate limit hits`,
        alert: {
          severity: config.severity,
          type: SecurityEventType.API_KEY_ABUSE,
          title: 'API Key Abuse Detected',
          message: `API key ${apiKeyId.slice(0, 8)}... has exceeded rate limits ${count} times in the past ${config.windowSeconds} seconds. This may indicate compromised credentials or a misconfigured client.`,
          context: event.context,
          source: 'security-alert-detector',
          suggestedActions: [
            'Contact the API key owner',
            'Consider temporarily revoking the key',
            'Review the requests being made',
            'Check for signs of credential compromise',
          ],
          tags: ['api-key-abuse', 'rate-limit'],
        },
      };
    }

    return { shouldAlert: false, reason: `Rate limit hits: ${count}/${config.rateLimitHitsThreshold}` };
  }

  /**
   * Detect security configuration changes
   */
  private async detectConfigChange(event: DetectorSecurityEvent): Promise<DetectionResult | null> {
    const relevantTypes: SecurityEventType[] = [
      SecurityEventType.SECURITY_CONFIG_CHANGE,
      SecurityEventType.ADMIN_ACTION,
      SecurityEventType.KEY_ROTATION,
    ];

    if (!relevantTypes.includes(event.type)) {
      return null;
    }

    const config = this.builtInConfig.configChanges;
    const fingerprint = this.generateFingerprint(
      'config_change',
      `${event.context.userId}:${event.data?.changeType || 'unknown'}`
    );

    if (await this.isInCooldown(fingerprint)) {
      return { shouldAlert: false, reason: 'Alert in cooldown period' };
    }

    const changeType = event.data?.changeType as string || 'unknown';
    const changedResource = event.data?.resource as string || 'unknown resource';
    const previousValue = event.data?.previousValue;
    const newValue = event.data?.newValue;

    return {
      shouldAlert: true,
      reason: `Security configuration change: ${changeType}`,
      alert: {
        severity: config.severity,
        type: event.type,
        title: 'Security Configuration Change',
        message: `User ${event.context.userId || 'system'} made a security-related configuration change: ${changeType} on ${changedResource}.${previousValue !== undefined ? ` Changed from "${previousValue}" to "${newValue}".` : ''}`,
        context: event.context,
        source: 'security-alert-detector',
        suggestedActions: [
          'Verify the change was authorized',
          'Document the change in your change management system',
          'Review the security implications',
        ],
        tags: ['config-change', 'audit'],
      },
    };
  }

  // ===========================================================================
  // Custom Rule Evaluation
  // ===========================================================================

  private async runCustomRules(event: DetectorSecurityEvent): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];

    // Sort rules by priority (higher first)
    const sortedRules = Array.from(this.customRules.values())
      .filter(rule => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      // Check if rule applies to this event type
      if (!rule.eventTypes.includes(event.type)) {
        continue;
      }

      // Evaluate conditions
      if (rule.conditions && !this.evaluateConditions(rule.conditions, event)) {
        continue;
      }

      // Check threshold if defined
      if (rule.threshold) {
        const thresholdMet = await this.checkThreshold(rule.threshold, event, rule.id);
        if (!thresholdMet) {
          continue;
        }
      }

      // Check cooldown
      const fingerprint = this.generateRuleFingerprint(rule, event);
      if (await this.isInCooldown(fingerprint)) {
        continue;
      }

      // Rule matched - create alert
      const alert = this.createAlertFromRule(rule, event);
      results.push({
        shouldAlert: true,
        alert,
        triggeredRule: rule,
        reason: `Rule ${rule.name} matched`,
      });

      // Stop processing if rule says so
      if (rule.stopOnMatch) {
        break;
      }
    }

    return results;
  }

  private evaluateConditions(conditions: AlertCondition[], event: DetectorSecurityEvent): boolean {
    for (const condition of conditions) {
      const value = this.getFieldValue(condition.field, event);
      if (!this.evaluateCondition(condition, value)) {
        return false;
      }
    }
    return true;
  }

  private getFieldValue(field: string, event: DetectorSecurityEvent): unknown {
    const parts = field.split('.');
    let value: unknown = event;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  private evaluateCondition(condition: AlertCondition, value: unknown): boolean {
    const { operator, value: conditionValue } = condition;

    switch (operator) {
      case ConditionOperator.EQUALS:
        return value === conditionValue;

      case ConditionOperator.NOT_EQUALS:
        return value !== conditionValue;

      case ConditionOperator.GREATER_THAN:
        return typeof value === 'number' && typeof conditionValue === 'number' && value > conditionValue;

      case ConditionOperator.LESS_THAN:
        return typeof value === 'number' && typeof conditionValue === 'number' && value < conditionValue;

      case ConditionOperator.GREATER_THAN_OR_EQUALS:
        return typeof value === 'number' && typeof conditionValue === 'number' && value >= conditionValue;

      case ConditionOperator.LESS_THAN_OR_EQUALS:
        return typeof value === 'number' && typeof conditionValue === 'number' && value <= conditionValue;

      case ConditionOperator.CONTAINS:
        return typeof value === 'string' && typeof conditionValue === 'string' && value.includes(conditionValue);

      case ConditionOperator.NOT_CONTAINS:
        return typeof value === 'string' && typeof conditionValue === 'string' && !value.includes(conditionValue);

      case ConditionOperator.MATCHES:
        if (typeof value !== 'string' || typeof conditionValue !== 'string') return false;
        try {
          return new RegExp(conditionValue).test(value);
        } catch {
          return false;
        }

      case ConditionOperator.IN:
        return Array.isArray(conditionValue) && conditionValue.includes(value);

      case ConditionOperator.NOT_IN:
        return Array.isArray(conditionValue) && !conditionValue.includes(value);

      default:
        return false;
    }
  }

  private async checkThreshold(
    threshold: AlertThreshold,
    event: DetectorSecurityEvent,
    ruleId: string
  ): Promise<boolean> {
    const groupValue = threshold.groupBy
      ? this.getFieldValue(threshold.groupBy, event)
      : 'global';

    const counterKey = `rule:${ruleId}:${groupValue}`;
    const count = await this.incrementSlidingWindowCounter(
      counterKey,
      threshold.windowSeconds
    );

    return count >= threshold.count;
  }

  private createAlertFromRule(rule: AlertRule, event: DetectorSecurityEvent): CreateAlertInput {
    // Apply message template if provided
    let message = rule.messageTemplate || `Alert triggered by rule: ${rule.name}`;
    let title = rule.titleTemplate || rule.name;

    // Simple template replacement
    message = this.applyTemplate(message, event);
    title = this.applyTemplate(title, event);

    return {
      severity: rule.severity,
      type: event.type,
      title,
      message,
      context: event.context,
      source: `rule:${rule.id}`,
      suggestedActions: rule.tags?.includes('auto-remediation')
        ? ['Automatic remediation may be applied']
        : undefined,
      tags: rule.tags,
    };
  }

  private applyTemplate(template: string, event: DetectorSecurityEvent): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, field) => {
      const value = this.getFieldValue(field.trim(), event);
      return value !== undefined ? String(value) : match;
    });
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Increment a sliding window counter and return the new count
   */
  private async incrementSlidingWindowCounter(
    key: string,
    windowSeconds: number
  ): Promise<number> {
    const fullKey = `${COUNTER_PREFIX}${key}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Use Redis sorted set for sliding window
    const pipeline = this.redis.pipeline();

    // Add current timestamp
    pipeline.zadd(fullKey, now, `${now}:${Math.random()}`);

    // Remove old entries
    pipeline.zremrangebyscore(fullKey, '-inf', windowStart);

    // Count entries in window
    pipeline.zcard(fullKey);

    // Set expiry
    pipeline.expire(fullKey, windowSeconds + 60);

    const results = await pipeline.exec();

    // Get count from zcard result (index 2)
    const countResult = results?.[2];
    if (countResult && !countResult[0]) {
      return countResult[1] as number;
    }

    return 0;
  }

  /**
   * Generate a fingerprint for deduplication
   */
  private generateFingerprint(type: string, identifier: string): string {
    return createHash('sha256')
      .update(`${type}:${identifier}`)
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * Generate a fingerprint for a rule match
   */
  private generateRuleFingerprint(rule: AlertRule, event: DetectorSecurityEvent): string {
    const identifier = event.context.userId || event.context.ipAddress || 'global';
    return this.generateFingerprint(`rule:${rule.id}`, identifier);
  }

  /**
   * Get the built-in configuration
   */
  getBuiltInConfig(): BuiltInDetectorConfig {
    return { ...this.builtInConfig };
  }

  /**
   * Update built-in configuration
   */
  updateBuiltInConfig(config: Partial<BuiltInDetectorConfig>): void {
    Object.assign(this.builtInConfig, config);
    logger.info({ config }, 'Built-in detector configuration updated');
  }

  /**
   * Reset all counters (primarily for testing)
   */
  async resetCounters(): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${COUNTER_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');

    logger.info('All counters reset');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Options for creating a SecurityAlertDetector
 */
export interface SecurityAlertDetectorOptions {
  redis?: Redis;
  builtInConfig?: Partial<BuiltInDetectorConfig>;
  keyPrefix?: string;
}

let detectorInstance: SecurityAlertDetector | null = null;

/**
 * Get or create the singleton SecurityAlertDetector instance
 */
export function getSecurityAlertDetector(
  options?: SecurityAlertDetectorOptions
): SecurityAlertDetector {
  if (!detectorInstance) {
    detectorInstance = new SecurityAlertDetector(options);
  }
  return detectorInstance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
export function resetSecurityAlertDetector(): void {
  detectorInstance = null;
}

/**
 * Create a new SecurityAlertDetector instance
 */
export function createSecurityAlertDetector(
  options?: SecurityAlertDetectorOptions
): SecurityAlertDetector {
  return new SecurityAlertDetector(options);
}
