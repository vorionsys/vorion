/**
 * Built-in Security Policies
 *
 * Pre-configured security policies for common use cases:
 * - Require MFA for admin access
 * - Block access from high-risk IPs
 * - Require approval for bulk data export
 * - Enhanced logging for sensitive resources
 * - Rate limit by user risk score
 *
 * @packageDocumentation
 */

import type { SecurityPolicy } from './types.js';

/**
 * Create a policy ID from name
 */
function createPolicyId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Get current timestamp
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Require MFA for admin access
 *
 * When a user with admin role accesses any endpoint, they must have
 * completed MFA verification within the last 5 minutes.
 */
export const requireMfaForAdminPolicy: SecurityPolicy = {
  id: createPolicyId('require-mfa-admin'),
  name: 'Require MFA for Admin Access',
  description: 'Requires multi-factor authentication for users with admin role',
  priority: 1000,
  enabled: true,
  conditions: [
    {
      type: 'user_attribute',
      field: 'role',
      operator: 'equals',
      value: 'admin',
    },
  ],
  rules: [
    {
      type: 'require_mfa',
      enforced: true,
      methods: ['totp', 'webauthn', 'hardware_key'],
      timeout: 300, // 5 minutes
      rememberDevice: false,
    },
  ],
  actions: [
    {
      type: 'log',
      level: 'info',
      message: 'Admin access with MFA verification',
      includeUser: true,
      includeRequest: true,
      tags: ['admin-access', 'mfa-verified'],
    },
  ],
  version: '1.0.0',
  tags: ['admin', 'mfa', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Block access from high-risk IPs
 *
 * Blocks requests from IPs with a reputation score below 30.
 * Also notifies the security team.
 */
export const blockHighRiskIpsPolicy: SecurityPolicy = {
  id: createPolicyId('block-high-risk-ips'),
  name: 'Block Access from High-Risk IPs',
  description: 'Blocks access from IP addresses with poor reputation scores',
  priority: 2000,
  enabled: true,
  conditions: [
    {
      type: 'risk_based',
      field: 'ip_reputation',
      operator: 'less_than',
      value: 30,
    },
  ],
  rules: [
    {
      type: 'block_access',
      enforced: true,
      reason: 'Access blocked due to high-risk IP address',
      errorCode: 'IP_BLOCKED',
    },
  ],
  actions: [
    {
      type: 'deny',
      reason: 'Access blocked due to high-risk IP address',
      errorCode: 'IP_BLOCKED',
      httpStatus: 403,
      retryable: false,
    },
    {
      type: 'notify',
      channels: ['slack', 'email'],
      severity: 'high',
      template: 'high-risk-ip-access',
      includeContext: true,
    },
    {
      type: 'log',
      level: 'warn',
      message: 'Blocked access from high-risk IP',
      includeContext: true,
      includeRequest: true,
      tags: ['blocked', 'high-risk-ip'],
    },
  ],
  version: '1.0.0',
  tags: ['security', 'ip-reputation', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Require approval for bulk data export
 *
 * When a user attempts to export more than 1000 records,
 * require manager approval before proceeding.
 */
export const requireApprovalForBulkExportPolicy: SecurityPolicy = {
  id: createPolicyId('require-approval-bulk-export'),
  name: 'Require Approval for Bulk Data Export',
  description: 'Requires manager approval for bulk data export operations',
  priority: 800,
  enabled: true,
  conditions: [
    {
      type: 'composite',
      operator: 'and',
      conditions: [
        {
          type: 'request_attribute',
          field: 'path',
          operator: 'matches',
          value: '.*/(export|download|bulk).*',
        },
        {
          type: 'request_attribute',
          field: 'query',
          queryParam: 'limit',
          operator: 'greater_than',
          value: 1000,
        },
      ],
    },
  ],
  rules: [
    {
      type: 'require_approval',
      enforced: true,
      approverRoles: ['manager', 'data-steward', 'admin'],
      approvalTimeout: 3600, // 1 hour
      minApprovers: 1,
      requireJustification: true,
      autoRejectOnTimeout: true,
    },
    {
      type: 'audit_log',
      enforced: true,
      level: 'detailed',
      includeRequest: true,
      destination: 'audit-log',
    },
  ],
  actions: [
    {
      type: 'challenge',
      method: 'approval',
      timeout: 3600,
    },
    {
      type: 'notify',
      channels: ['email'],
      recipients: [], // Will use approverRoles
      severity: 'medium',
      template: 'bulk-export-approval-request',
      includeContext: true,
    },
    {
      type: 'log',
      level: 'info',
      message: 'Bulk export request pending approval',
      includeUser: true,
      includeRequest: true,
      tags: ['bulk-export', 'pending-approval'],
    },
  ],
  version: '1.0.0',
  tags: ['data-protection', 'approval', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Enhanced logging for sensitive resources
 *
 * When accessing resources with confidential or higher sensitivity,
 * enable detailed audit logging.
 */
export const enhancedLoggingForSensitiveResourcesPolicy: SecurityPolicy = {
  id: createPolicyId('enhanced-logging-sensitive'),
  name: 'Enhanced Logging for Sensitive Resources',
  description: 'Enables detailed audit logging for access to sensitive resources',
  priority: 500,
  enabled: true,
  conditions: [
    {
      type: 'resource_attribute',
      field: 'sensitivity_level',
      operator: 'in',
      value: ['confidential', 'restricted', 'top_secret'],
    },
  ],
  rules: [
    {
      type: 'audit_log',
      enforced: true,
      level: 'full',
      includeRequest: true,
      includeResponse: true,
      includeHeaders: true,
      redactFields: ['password', 'token', 'secret', 'key', 'credential'],
      destination: 'sensitive-audit-log',
    },
  ],
  actions: [
    {
      type: 'log',
      level: 'info',
      message: 'Access to sensitive resource',
      includeContext: true,
      includeRequest: true,
      includeUser: true,
      tags: ['sensitive-access', 'audit'],
    },
    {
      type: 'modify',
      addHeaders: {
        'X-Audit-Trail': 'enabled',
        'X-Sensitivity-Level': 'high',
      },
    },
  ],
  version: '1.0.0',
  tags: ['audit', 'sensitive-data', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Rate limit by user risk score
 *
 * Users with higher risk scores get lower rate limits.
 */
export const rateLimitByRiskScorePolicy: SecurityPolicy = {
  id: createPolicyId('rate-limit-by-risk'),
  name: 'Rate Limit by User Risk Score',
  description: 'Applies dynamic rate limiting based on user risk assessment',
  priority: 600,
  enabled: true,
  conditions: [
    {
      type: 'risk_based',
      field: 'user_risk_score',
      operator: 'greater_than',
      value: 50,
    },
  ],
  rules: [
    {
      type: 'rate_limit',
      enforced: true,
      limit: 30, // Lower limit for risky users
      window: 60,
      windowUnit: 'second',
      keyBy: ['user', 'ip'],
      burstLimit: 5,
      retryAfter: 60,
    },
  ],
  actions: [
    {
      type: 'log',
      level: 'info',
      message: 'Applied risk-based rate limiting',
      includeUser: true,
      tags: ['rate-limit', 'risk-based'],
    },
  ],
  version: '1.0.0',
  tags: ['rate-limit', 'risk-based', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Require MFA outside business hours
 *
 * Additional verification required for access outside normal working hours.
 */
export const mfaOutsideBusinessHoursPolicy: SecurityPolicy = {
  id: createPolicyId('mfa-outside-business-hours'),
  name: 'Require MFA Outside Business Hours',
  description: 'Requires MFA verification for access outside business hours (9 AM - 6 PM)',
  priority: 700,
  enabled: true,
  conditions: [
    {
      type: 'time_based',
      field: 'business_hours',
      operator: 'equals',
      value: false,
      timezone: 'UTC',
      startHour: 9,
      endHour: 18,
      daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    },
  ],
  rules: [
    {
      type: 'require_mfa',
      enforced: true,
      methods: ['totp', 'push', 'sms'],
      timeout: 600, // 10 minutes
      rememberDevice: true,
      rememberDuration: 28800, // 8 hours
    },
  ],
  actions: [
    {
      type: 'log',
      level: 'info',
      message: 'Off-hours access with MFA',
      includeUser: true,
      tags: ['off-hours', 'mfa'],
    },
  ],
  version: '1.0.0',
  tags: ['mfa', 'business-hours', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Block requests with critical threat level
 *
 * Immediately block any request with critical threat assessment.
 */
export const blockCriticalThreatsPolicy: SecurityPolicy = {
  id: createPolicyId('block-critical-threats'),
  name: 'Block Critical Threats',
  description: 'Immediately blocks requests identified as critical threats',
  priority: 3000, // Very high priority
  enabled: true,
  conditions: [
    {
      type: 'risk_based',
      field: 'threat_level',
      operator: 'equals',
      value: 'critical',
    },
  ],
  rules: [
    {
      type: 'block_access',
      enforced: true,
      reason: 'Request blocked due to critical threat detection',
      errorCode: 'THREAT_BLOCKED',
    },
  ],
  actions: [
    {
      type: 'deny',
      reason: 'Request blocked due to critical threat detection',
      errorCode: 'THREAT_BLOCKED',
      httpStatus: 403,
      retryable: false,
    },
    {
      type: 'notify',
      channels: ['pagerduty', 'slack'],
      severity: 'critical',
      template: 'critical-threat-blocked',
      includeContext: true,
    },
    {
      type: 'escalate',
      severity: 'critical',
      assignToRoles: ['security-team', 'incident-responder'],
      createIncident: true,
      incidentType: 'security-threat',
      timeout: 300,
    },
    {
      type: 'quarantine',
      duration: 24,
      durationUnit: 'hour',
      reason: 'Critical threat detected',
      notifyUser: false,
      notifyAdmin: true,
      allowAppeal: false,
    },
    {
      type: 'log',
      level: 'error',
      message: 'Critical threat blocked',
      includeContext: true,
      includeRequest: true,
      includeUser: true,
      tags: ['critical', 'threat', 'blocked'],
    },
  ],
  version: '1.0.0',
  tags: ['security', 'threat', 'critical', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Geo-restrict sensitive operations
 *
 * Sensitive operations only allowed from approved countries.
 */
export const geoRestrictSensitiveOperationsPolicy: SecurityPolicy = {
  id: createPolicyId('geo-restrict-sensitive'),
  name: 'Geo-Restrict Sensitive Operations',
  description: 'Restricts sensitive operations to approved geographic locations',
  priority: 900,
  enabled: true,
  conditions: [
    {
      type: 'composite',
      operator: 'and',
      conditions: [
        {
          type: 'resource_attribute',
          field: 'sensitivity_level',
          operator: 'in',
          value: ['restricted', 'top_secret'],
        },
        {
          type: 'request_attribute',
          field: 'method',
          operator: 'in',
          value: ['POST', 'PUT', 'DELETE', 'PATCH'],
        },
      ],
    },
  ],
  rules: [
    {
      type: 'geo_restriction',
      enforced: true,
      allowedCountries: ['US', 'CA', 'GB', 'DE', 'FR', 'AU'],
      blockedCountries: [],
    },
  ],
  actions: [
    {
      type: 'log',
      level: 'info',
      message: 'Geo-validated sensitive operation',
      includeContext: true,
      tags: ['geo-check', 'sensitive'],
    },
  ],
  version: '1.0.0',
  tags: ['geo-restriction', 'sensitive', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Session security for high-risk users
 *
 * Shorter session timeouts for users with elevated risk scores.
 */
export const sessionSecurityHighRiskUsersPolicy: SecurityPolicy = {
  id: createPolicyId('session-security-high-risk'),
  name: 'Session Security for High-Risk Users',
  description: 'Applies stricter session controls for high-risk users',
  priority: 650,
  enabled: true,
  conditions: [
    {
      type: 'risk_based',
      field: 'user_risk_score',
      operator: 'greater_than',
      value: 70,
    },
  ],
  rules: [
    {
      type: 'session_timeout',
      enforced: true,
      maxDuration: 3600, // 1 hour max session
      idleTimeout: 300, // 5 minutes idle timeout
      requireReauth: true,
    },
  ],
  actions: [
    {
      type: 'log',
      level: 'info',
      message: 'Applied high-risk session controls',
      includeUser: true,
      tags: ['session', 'high-risk'],
    },
  ],
  version: '1.0.0',
  tags: ['session', 'risk-based', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * Data masking for PII fields
 *
 * Automatically mask PII fields in responses for non-privileged users.
 */
export const dataMaskingForPiiPolicy: SecurityPolicy = {
  id: createPolicyId('data-masking-pii'),
  name: 'Data Masking for PII Fields',
  description: 'Masks personally identifiable information for non-privileged users',
  priority: 400,
  enabled: true,
  conditions: [
    {
      type: 'composite',
      operator: 'and',
      conditions: [
        {
          type: 'resource_attribute',
          field: 'data_type',
          operator: 'equals',
          value: 'pii',
        },
        {
          type: 'user_attribute',
          field: 'role',
          operator: 'not_in',
          value: ['admin', 'data-steward', 'compliance-officer'],
        },
      ],
    },
  ],
  rules: [
    {
      type: 'data_masking',
      enforced: true,
      fields: [
        'ssn',
        'socialSecurityNumber',
        'taxId',
        'bankAccount',
        'creditCard',
        'dateOfBirth',
        'phoneNumber',
        'email',
        'address',
      ],
      maskType: 'partial',
      partialMaskPattern: '***',
    },
  ],
  actions: [
    {
      type: 'modify',
      addHeaders: {
        'X-Data-Masked': 'true',
      },
    },
    {
      type: 'log',
      level: 'debug',
      message: 'PII data masked',
      tags: ['pii', 'masked'],
    },
  ],
  version: '1.0.0',
  tags: ['pii', 'data-masking', 'built-in'],
  createdAt: now(),
  updatedAt: now(),
  createdBy: 'system',
};

/**
 * All built-in policies
 */
export const builtInPolicies: SecurityPolicy[] = [
  requireMfaForAdminPolicy,
  blockHighRiskIpsPolicy,
  requireApprovalForBulkExportPolicy,
  enhancedLoggingForSensitiveResourcesPolicy,
  rateLimitByRiskScorePolicy,
  mfaOutsideBusinessHoursPolicy,
  blockCriticalThreatsPolicy,
  geoRestrictSensitiveOperationsPolicy,
  sessionSecurityHighRiskUsersPolicy,
  dataMaskingForPiiPolicy,
];

/**
 * Get built-in policies by tags
 */
export function getBuiltInPoliciesByTag(tag: string): SecurityPolicy[] {
  return builtInPolicies.filter(p => p.tags?.includes(tag));
}

/**
 * Get all built-in policy IDs
 */
export function getBuiltInPolicyIds(): string[] {
  return builtInPolicies.map(p => p.id);
}
