/**
 * Tests for Built-in Security Policies
 *
 * Comprehensive mutation-killing tests that pin down every literal value
 * in built-in-policies.ts to eliminate Stryker mutant survivors.
 */

import { describe, it, expect } from 'vitest';

import {
  builtInPolicies,
  getBuiltInPoliciesByTag,
  getBuiltInPolicyIds,
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
} from '../built-in-policies.js';

// ============================================================================
// createPolicyId — exercises the function indirectly through policy IDs
// ============================================================================

describe('createPolicyId (validated via policy IDs)', () => {
  it('should convert names to lowercase with dashes and strip special chars', () => {
    // Each policy ID proves createPolicyId works: lowercase, spaces→dashes, no special chars
    expect(requireMfaForAdminPolicy.id).toBe('require-mfa-admin');
    expect(blockHighRiskIpsPolicy.id).toBe('block-high-risk-ips');
    expect(requireApprovalForBulkExportPolicy.id).toBe('require-approval-bulk-export');
    expect(enhancedLoggingForSensitiveResourcesPolicy.id).toBe('enhanced-logging-sensitive');
    expect(rateLimitByRiskScorePolicy.id).toBe('rate-limit-by-risk');
    expect(mfaOutsideBusinessHoursPolicy.id).toBe('mfa-outside-business-hours');
    expect(blockCriticalThreatsPolicy.id).toBe('block-critical-threats');
    expect(geoRestrictSensitiveOperationsPolicy.id).toBe('geo-restrict-sensitive');
    expect(sessionSecurityHighRiskUsersPolicy.id).toBe('session-security-high-risk');
    expect(dataMaskingForPiiPolicy.id).toBe('data-masking-pii');
  });
});

// ============================================================================
// builtInPolicies array
// ============================================================================

describe('builtInPolicies array', () => {
  it('should contain exactly 10 policies', () => {
    expect(builtInPolicies).toHaveLength(10);
  });

  it('should have unique IDs across all policies', () => {
    const ids = builtInPolicies.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
  });

  it('should have all policies enabled with version 1.0.0 and createdBy system', () => {
    for (const policy of builtInPolicies) {
      expect(policy.enabled).toBe(true);
      expect(policy.version).toBe('1.0.0');
      expect(policy.createdBy).toBe('system');
    }
  });

  it('should have non-empty conditions, rules, and actions for every policy', () => {
    for (const policy of builtInPolicies) {
      expect(policy.conditions.length).toBeGreaterThanOrEqual(1);
      expect(policy.rules.length).toBeGreaterThanOrEqual(1);
      expect(policy.actions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should have valid ISO timestamps for createdAt and updatedAt', () => {
    for (const policy of builtInPolicies) {
      expect(policy.createdAt).toEqual(expect.any(String));
      expect(policy.updatedAt).toEqual(expect.any(String));
      // Validate ISO format
      expect(new Date(policy.createdAt!).toISOString()).toBe(policy.createdAt);
      expect(new Date(policy.updatedAt!).toISOString()).toBe(policy.updatedAt);
    }
  });

  it('should tag every policy with "built-in"', () => {
    for (const policy of builtInPolicies) {
      expect(policy.tags).toBeDefined();
      expect(policy.tags).toContain('built-in');
    }
  });

  it('should have correct priority ordering', () => {
    const expectedPriorityOrder = [
      { id: blockCriticalThreatsPolicy.id, priority: 3000 },
      { id: blockHighRiskIpsPolicy.id, priority: 2000 },
      { id: requireMfaForAdminPolicy.id, priority: 1000 },
      { id: geoRestrictSensitiveOperationsPolicy.id, priority: 900 },
      { id: requireApprovalForBulkExportPolicy.id, priority: 800 },
      { id: mfaOutsideBusinessHoursPolicy.id, priority: 700 },
      { id: sessionSecurityHighRiskUsersPolicy.id, priority: 650 },
      { id: rateLimitByRiskScorePolicy.id, priority: 600 },
      { id: enhancedLoggingForSensitiveResourcesPolicy.id, priority: 500 },
      { id: dataMaskingForPiiPolicy.id, priority: 400 },
    ];

    const sortedByPriority = [...builtInPolicies].sort(
      (a, b) => b.priority - a.priority
    );

    for (let i = 0; i < expectedPriorityOrder.length; i++) {
      expect(sortedByPriority[i].id).toBe(expectedPriorityOrder[i].id);
      expect(sortedByPriority[i].priority).toBe(expectedPriorityOrder[i].priority);
    }
  });

  it('should contain the 10 policies in the declared order', () => {
    expect(builtInPolicies[0]).toBe(requireMfaForAdminPolicy);
    expect(builtInPolicies[1]).toBe(blockHighRiskIpsPolicy);
    expect(builtInPolicies[2]).toBe(requireApprovalForBulkExportPolicy);
    expect(builtInPolicies[3]).toBe(enhancedLoggingForSensitiveResourcesPolicy);
    expect(builtInPolicies[4]).toBe(rateLimitByRiskScorePolicy);
    expect(builtInPolicies[5]).toBe(mfaOutsideBusinessHoursPolicy);
    expect(builtInPolicies[6]).toBe(blockCriticalThreatsPolicy);
    expect(builtInPolicies[7]).toBe(geoRestrictSensitiveOperationsPolicy);
    expect(builtInPolicies[8]).toBe(sessionSecurityHighRiskUsersPolicy);
    expect(builtInPolicies[9]).toBe(dataMaskingForPiiPolicy);
  });
});

// ============================================================================
// requireMfaForAdminPolicy — EVERY literal
// ============================================================================

describe('requireMfaForAdminPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(requireMfaForAdminPolicy.id).toBe('require-mfa-admin');
    expect(requireMfaForAdminPolicy.name).toBe('Require MFA for Admin Access');
    expect(requireMfaForAdminPolicy.description).toBe(
      'Requires multi-factor authentication for users with admin role'
    );
  });

  it('should have priority 1000', () => {
    expect(requireMfaForAdminPolicy.priority).toBe(1000);
  });

  it('should have enabled=true, version=1.0.0, createdBy=system', () => {
    expect(requireMfaForAdminPolicy.enabled).toBe(true);
    expect(requireMfaForAdminPolicy.version).toBe('1.0.0');
    expect(requireMfaForAdminPolicy.createdBy).toBe('system');
  });

  it('should have tags [admin, mfa, built-in]', () => {
    expect(requireMfaForAdminPolicy.tags).toEqual(['admin', 'mfa', 'built-in']);
  });

  it('should have exactly 1 condition: user_attribute/role equals admin', () => {
    expect(requireMfaForAdminPolicy.conditions).toHaveLength(1);
    const c = requireMfaForAdminPolicy.conditions[0] as any;
    expect(c.type).toBe('user_attribute');
    expect(c.field).toBe('role');
    expect(c.operator).toBe('equals');
    expect(c.value).toBe('admin');
  });

  it('should have exactly 1 rule: require_mfa with all fields', () => {
    expect(requireMfaForAdminPolicy.rules).toHaveLength(1);
    const r = requireMfaForAdminPolicy.rules[0] as any;
    expect(r.type).toBe('require_mfa');
    expect(r.enforced).toBe(true);
    expect(r.methods).toEqual(['totp', 'webauthn', 'hardware_key']);
    expect(r.methods).toHaveLength(3);
    expect(r.timeout).toBe(300);
    expect(r.rememberDevice).toBe(false);
  });

  it('should have exactly 1 action: log with all fields', () => {
    expect(requireMfaForAdminPolicy.actions).toHaveLength(1);
    const a = requireMfaForAdminPolicy.actions[0] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Admin access with MFA verification');
    expect(a.includeUser).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.tags).toEqual(['admin-access', 'mfa-verified']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// blockHighRiskIpsPolicy — EVERY literal
// ============================================================================

describe('blockHighRiskIpsPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(blockHighRiskIpsPolicy.id).toBe('block-high-risk-ips');
    expect(blockHighRiskIpsPolicy.name).toBe('Block Access from High-Risk IPs');
    expect(blockHighRiskIpsPolicy.description).toBe(
      'Blocks access from IP addresses with poor reputation scores'
    );
  });

  it('should have priority 2000', () => {
    expect(blockHighRiskIpsPolicy.priority).toBe(2000);
  });

  it('should have tags [security, ip-reputation, built-in]', () => {
    expect(blockHighRiskIpsPolicy.tags).toEqual(['security', 'ip-reputation', 'built-in']);
  });

  it('should have exactly 1 condition: risk_based/ip_reputation less_than 30', () => {
    expect(blockHighRiskIpsPolicy.conditions).toHaveLength(1);
    const c = blockHighRiskIpsPolicy.conditions[0] as any;
    expect(c.type).toBe('risk_based');
    expect(c.field).toBe('ip_reputation');
    expect(c.operator).toBe('less_than');
    expect(c.value).toBe(30);
  });

  it('should have exactly 1 rule: block_access with reason and errorCode', () => {
    expect(blockHighRiskIpsPolicy.rules).toHaveLength(1);
    const r = blockHighRiskIpsPolicy.rules[0] as any;
    expect(r.type).toBe('block_access');
    expect(r.enforced).toBe(true);
    expect(r.reason).toBe('Access blocked due to high-risk IP address');
    expect(r.errorCode).toBe('IP_BLOCKED');
  });

  it('should have exactly 3 actions: deny, notify, log', () => {
    expect(blockHighRiskIpsPolicy.actions).toHaveLength(3);
    const actionTypes = blockHighRiskIpsPolicy.actions.map(a => a.type);
    expect(actionTypes).toEqual(['deny', 'notify', 'log']);
  });

  it('should have deny action with all fields', () => {
    const a = blockHighRiskIpsPolicy.actions[0] as any;
    expect(a.type).toBe('deny');
    expect(a.reason).toBe('Access blocked due to high-risk IP address');
    expect(a.errorCode).toBe('IP_BLOCKED');
    expect(a.httpStatus).toBe(403);
    expect(a.retryable).toBe(false);
  });

  it('should have notify action with all fields', () => {
    const a = blockHighRiskIpsPolicy.actions[1] as any;
    expect(a.type).toBe('notify');
    expect(a.channels).toEqual(['slack', 'email']);
    expect(a.channels).toHaveLength(2);
    expect(a.severity).toBe('high');
    expect(a.template).toBe('high-risk-ip-access');
    expect(a.includeContext).toBe(true);
  });

  it('should have log action with all fields', () => {
    const a = blockHighRiskIpsPolicy.actions[2] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('warn');
    expect(a.message).toBe('Blocked access from high-risk IP');
    expect(a.includeContext).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.tags).toEqual(['blocked', 'high-risk-ip']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// requireApprovalForBulkExportPolicy — EVERY literal
// ============================================================================

describe('requireApprovalForBulkExportPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(requireApprovalForBulkExportPolicy.id).toBe('require-approval-bulk-export');
    expect(requireApprovalForBulkExportPolicy.name).toBe('Require Approval for Bulk Data Export');
    expect(requireApprovalForBulkExportPolicy.description).toBe(
      'Requires manager approval for bulk data export operations'
    );
  });

  it('should have priority 800', () => {
    expect(requireApprovalForBulkExportPolicy.priority).toBe(800);
  });

  it('should have tags [data-protection, approval, built-in]', () => {
    expect(requireApprovalForBulkExportPolicy.tags).toEqual(['data-protection', 'approval', 'built-in']);
  });

  it('should have exactly 1 composite AND condition with 2 sub-conditions', () => {
    expect(requireApprovalForBulkExportPolicy.conditions).toHaveLength(1);
    const c = requireApprovalForBulkExportPolicy.conditions[0] as any;
    expect(c.type).toBe('composite');
    expect(c.operator).toBe('and');
    expect(c.conditions).toHaveLength(2);
  });

  it('should have path sub-condition with matches operator and regex', () => {
    const sub = (requireApprovalForBulkExportPolicy.conditions[0] as any).conditions[0];
    expect(sub.type).toBe('request_attribute');
    expect(sub.field).toBe('path');
    expect(sub.operator).toBe('matches');
    expect(sub.value).toBe('.*/(export|download|bulk).*');
  });

  it('should have query/limit sub-condition with greater_than 1000', () => {
    const sub = (requireApprovalForBulkExportPolicy.conditions[0] as any).conditions[1];
    expect(sub.type).toBe('request_attribute');
    expect(sub.field).toBe('query');
    expect(sub.queryParam).toBe('limit');
    expect(sub.operator).toBe('greater_than');
    expect(sub.value).toBe(1000);
  });

  it('should have exactly 2 rules: require_approval and audit_log', () => {
    expect(requireApprovalForBulkExportPolicy.rules).toHaveLength(2);
    expect(requireApprovalForBulkExportPolicy.rules[0].type).toBe('require_approval');
    expect(requireApprovalForBulkExportPolicy.rules[1].type).toBe('audit_log');
  });

  it('should have require_approval rule with all fields', () => {
    const r = requireApprovalForBulkExportPolicy.rules[0] as any;
    expect(r.type).toBe('require_approval');
    expect(r.enforced).toBe(true);
    expect(r.approverRoles).toEqual(['manager', 'data-steward', 'admin']);
    expect(r.approverRoles).toHaveLength(3);
    expect(r.approvalTimeout).toBe(3600);
    expect(r.minApprovers).toBe(1);
    expect(r.requireJustification).toBe(true);
    expect(r.autoRejectOnTimeout).toBe(true);
  });

  it('should have audit_log rule with all fields', () => {
    const r = requireApprovalForBulkExportPolicy.rules[1] as any;
    expect(r.type).toBe('audit_log');
    expect(r.enforced).toBe(true);
    expect(r.level).toBe('detailed');
    expect(r.includeRequest).toBe(true);
    expect(r.destination).toBe('audit-log');
  });

  it('should have exactly 3 actions: challenge, notify, log', () => {
    expect(requireApprovalForBulkExportPolicy.actions).toHaveLength(3);
    const types = requireApprovalForBulkExportPolicy.actions.map(a => a.type);
    expect(types).toEqual(['challenge', 'notify', 'log']);
  });

  it('should have challenge action with method=approval and timeout=3600', () => {
    const a = requireApprovalForBulkExportPolicy.actions[0] as any;
    expect(a.type).toBe('challenge');
    expect(a.method).toBe('approval');
    expect(a.timeout).toBe(3600);
  });

  it('should have notify action with all fields', () => {
    const a = requireApprovalForBulkExportPolicy.actions[1] as any;
    expect(a.type).toBe('notify');
    expect(a.channels).toEqual(['email']);
    expect(a.channels).toHaveLength(1);
    expect(a.recipients).toEqual([]);
    expect(a.recipients).toHaveLength(0);
    expect(a.severity).toBe('medium');
    expect(a.template).toBe('bulk-export-approval-request');
    expect(a.includeContext).toBe(true);
  });

  it('should have log action with all fields', () => {
    const a = requireApprovalForBulkExportPolicy.actions[2] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Bulk export request pending approval');
    expect(a.includeUser).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.tags).toEqual(['bulk-export', 'pending-approval']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// enhancedLoggingForSensitiveResourcesPolicy — EVERY literal
// ============================================================================

describe('enhancedLoggingForSensitiveResourcesPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.id).toBe('enhanced-logging-sensitive');
    expect(enhancedLoggingForSensitiveResourcesPolicy.name).toBe(
      'Enhanced Logging for Sensitive Resources'
    );
    expect(enhancedLoggingForSensitiveResourcesPolicy.description).toBe(
      'Enables detailed audit logging for access to sensitive resources'
    );
  });

  it('should have priority 500', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.priority).toBe(500);
  });

  it('should have tags [audit, sensitive-data, built-in]', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.tags).toEqual([
      'audit',
      'sensitive-data',
      'built-in',
    ]);
  });

  it('should have exactly 1 condition: resource_attribute/sensitivity_level in array', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.conditions).toHaveLength(1);
    const c = enhancedLoggingForSensitiveResourcesPolicy.conditions[0] as any;
    expect(c.type).toBe('resource_attribute');
    expect(c.field).toBe('sensitivity_level');
    expect(c.operator).toBe('in');
    expect(c.value).toEqual(['confidential', 'restricted', 'top_secret']);
    expect(c.value).toHaveLength(3);
  });

  it('should have exactly 1 rule: audit_log with all fields', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.rules).toHaveLength(1);
    const r = enhancedLoggingForSensitiveResourcesPolicy.rules[0] as any;
    expect(r.type).toBe('audit_log');
    expect(r.enforced).toBe(true);
    expect(r.level).toBe('full');
    expect(r.includeRequest).toBe(true);
    expect(r.includeResponse).toBe(true);
    expect(r.includeHeaders).toBe(true);
    expect(r.redactFields).toEqual(['password', 'token', 'secret', 'key', 'credential']);
    expect(r.redactFields).toHaveLength(5);
    expect(r.destination).toBe('sensitive-audit-log');
  });

  it('should have exactly 2 actions: log and modify', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.actions).toHaveLength(2);
    const types = enhancedLoggingForSensitiveResourcesPolicy.actions.map(a => a.type);
    expect(types).toEqual(['log', 'modify']);
  });

  it('should have log action with all fields', () => {
    const a = enhancedLoggingForSensitiveResourcesPolicy.actions[0] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Access to sensitive resource');
    expect(a.includeContext).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.includeUser).toBe(true);
    expect(a.tags).toEqual(['sensitive-access', 'audit']);
    expect(a.tags).toHaveLength(2);
  });

  it('should have modify action with exact headers', () => {
    const a = enhancedLoggingForSensitiveResourcesPolicy.actions[1] as any;
    expect(a.type).toBe('modify');
    expect(a.addHeaders).toEqual({
      'X-Audit-Trail': 'enabled',
      'X-Sensitivity-Level': 'high',
    });
    expect(a.addHeaders['X-Audit-Trail']).toBe('enabled');
    expect(a.addHeaders['X-Sensitivity-Level']).toBe('high');
  });
});

// ============================================================================
// rateLimitByRiskScorePolicy — EVERY literal
// ============================================================================

describe('rateLimitByRiskScorePolicy', () => {
  it('should have correct id, name, description', () => {
    expect(rateLimitByRiskScorePolicy.id).toBe('rate-limit-by-risk');
    expect(rateLimitByRiskScorePolicy.name).toBe('Rate Limit by User Risk Score');
    expect(rateLimitByRiskScorePolicy.description).toBe(
      'Applies dynamic rate limiting based on user risk assessment'
    );
  });

  it('should have priority 600', () => {
    expect(rateLimitByRiskScorePolicy.priority).toBe(600);
  });

  it('should have tags [rate-limit, risk-based, built-in]', () => {
    expect(rateLimitByRiskScorePolicy.tags).toEqual(['rate-limit', 'risk-based', 'built-in']);
  });

  it('should have exactly 1 condition: risk_based/user_risk_score greater_than 50', () => {
    expect(rateLimitByRiskScorePolicy.conditions).toHaveLength(1);
    const c = rateLimitByRiskScorePolicy.conditions[0] as any;
    expect(c.type).toBe('risk_based');
    expect(c.field).toBe('user_risk_score');
    expect(c.operator).toBe('greater_than');
    expect(c.value).toBe(50);
  });

  it('should have exactly 1 rule: rate_limit with all fields', () => {
    expect(rateLimitByRiskScorePolicy.rules).toHaveLength(1);
    const r = rateLimitByRiskScorePolicy.rules[0] as any;
    expect(r.type).toBe('rate_limit');
    expect(r.enforced).toBe(true);
    expect(r.limit).toBe(30);
    expect(r.window).toBe(60);
    expect(r.windowUnit).toBe('second');
    expect(r.keyBy).toEqual(['user', 'ip']);
    expect(r.keyBy).toHaveLength(2);
    expect(r.burstLimit).toBe(5);
    expect(r.retryAfter).toBe(60);
  });

  it('should have exactly 1 action: log with all fields', () => {
    expect(rateLimitByRiskScorePolicy.actions).toHaveLength(1);
    const a = rateLimitByRiskScorePolicy.actions[0] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Applied risk-based rate limiting');
    expect(a.includeUser).toBe(true);
    expect(a.tags).toEqual(['rate-limit', 'risk-based']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// mfaOutsideBusinessHoursPolicy — EVERY literal
// ============================================================================

describe('mfaOutsideBusinessHoursPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(mfaOutsideBusinessHoursPolicy.id).toBe('mfa-outside-business-hours');
    expect(mfaOutsideBusinessHoursPolicy.name).toBe('Require MFA Outside Business Hours');
    expect(mfaOutsideBusinessHoursPolicy.description).toBe(
      'Requires MFA verification for access outside business hours (9 AM - 6 PM)'
    );
  });

  it('should have priority 700', () => {
    expect(mfaOutsideBusinessHoursPolicy.priority).toBe(700);
  });

  it('should have tags [mfa, business-hours, built-in]', () => {
    expect(mfaOutsideBusinessHoursPolicy.tags).toEqual(['mfa', 'business-hours', 'built-in']);
  });

  it('should have exactly 1 condition: time_based with all fields', () => {
    expect(mfaOutsideBusinessHoursPolicy.conditions).toHaveLength(1);
    const c = mfaOutsideBusinessHoursPolicy.conditions[0] as any;
    expect(c.type).toBe('time_based');
    expect(c.field).toBe('business_hours');
    expect(c.operator).toBe('equals');
    expect(c.value).toBe(false);
    expect(c.timezone).toBe('UTC');
    expect(c.startHour).toBe(9);
    expect(c.endHour).toBe(18);
    expect(c.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(c.daysOfWeek).toHaveLength(5);
  });

  it('should have exactly 1 rule: require_mfa with all fields', () => {
    expect(mfaOutsideBusinessHoursPolicy.rules).toHaveLength(1);
    const r = mfaOutsideBusinessHoursPolicy.rules[0] as any;
    expect(r.type).toBe('require_mfa');
    expect(r.enforced).toBe(true);
    expect(r.methods).toEqual(['totp', 'push', 'sms']);
    expect(r.methods).toHaveLength(3);
    expect(r.timeout).toBe(600);
    expect(r.rememberDevice).toBe(true);
    expect(r.rememberDuration).toBe(28800);
  });

  it('should have exactly 1 action: log with all fields', () => {
    expect(mfaOutsideBusinessHoursPolicy.actions).toHaveLength(1);
    const a = mfaOutsideBusinessHoursPolicy.actions[0] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Off-hours access with MFA');
    expect(a.includeUser).toBe(true);
    expect(a.tags).toEqual(['off-hours', 'mfa']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// blockCriticalThreatsPolicy — EVERY literal
// ============================================================================

describe('blockCriticalThreatsPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(blockCriticalThreatsPolicy.id).toBe('block-critical-threats');
    expect(blockCriticalThreatsPolicy.name).toBe('Block Critical Threats');
    expect(blockCriticalThreatsPolicy.description).toBe(
      'Immediately blocks requests identified as critical threats'
    );
  });

  it('should have priority 3000 (highest)', () => {
    expect(blockCriticalThreatsPolicy.priority).toBe(3000);
    const max = Math.max(...builtInPolicies.map(p => p.priority));
    expect(blockCriticalThreatsPolicy.priority).toBe(max);
  });

  it('should have tags [security, threat, critical, built-in]', () => {
    expect(blockCriticalThreatsPolicy.tags).toEqual(['security', 'threat', 'critical', 'built-in']);
    expect(blockCriticalThreatsPolicy.tags).toHaveLength(4);
  });

  it('should have exactly 1 condition: risk_based/threat_level equals critical', () => {
    expect(blockCriticalThreatsPolicy.conditions).toHaveLength(1);
    const c = blockCriticalThreatsPolicy.conditions[0] as any;
    expect(c.type).toBe('risk_based');
    expect(c.field).toBe('threat_level');
    expect(c.operator).toBe('equals');
    expect(c.value).toBe('critical');
  });

  it('should have exactly 1 rule: block_access with all fields', () => {
    expect(blockCriticalThreatsPolicy.rules).toHaveLength(1);
    const r = blockCriticalThreatsPolicy.rules[0] as any;
    expect(r.type).toBe('block_access');
    expect(r.enforced).toBe(true);
    expect(r.reason).toBe('Request blocked due to critical threat detection');
    expect(r.errorCode).toBe('THREAT_BLOCKED');
  });

  it('should have exactly 5 actions: deny, notify, escalate, quarantine, log', () => {
    expect(blockCriticalThreatsPolicy.actions).toHaveLength(5);
    const types = blockCriticalThreatsPolicy.actions.map(a => a.type);
    expect(types).toEqual(['deny', 'notify', 'escalate', 'quarantine', 'log']);
  });

  it('should have deny action with all fields', () => {
    const a = blockCriticalThreatsPolicy.actions[0] as any;
    expect(a.type).toBe('deny');
    expect(a.reason).toBe('Request blocked due to critical threat detection');
    expect(a.errorCode).toBe('THREAT_BLOCKED');
    expect(a.httpStatus).toBe(403);
    expect(a.retryable).toBe(false);
  });

  it('should have notify action with all fields', () => {
    const a = blockCriticalThreatsPolicy.actions[1] as any;
    expect(a.type).toBe('notify');
    expect(a.channels).toEqual(['pagerduty', 'slack']);
    expect(a.channels).toHaveLength(2);
    expect(a.severity).toBe('critical');
    expect(a.template).toBe('critical-threat-blocked');
    expect(a.includeContext).toBe(true);
  });

  it('should have escalate action with all fields', () => {
    const a = blockCriticalThreatsPolicy.actions[2] as any;
    expect(a.type).toBe('escalate');
    expect(a.severity).toBe('critical');
    expect(a.assignToRoles).toEqual(['security-team', 'incident-responder']);
    expect(a.assignToRoles).toHaveLength(2);
    expect(a.createIncident).toBe(true);
    expect(a.incidentType).toBe('security-threat');
    expect(a.timeout).toBe(300);
  });

  it('should have quarantine action with all fields', () => {
    const a = blockCriticalThreatsPolicy.actions[3] as any;
    expect(a.type).toBe('quarantine');
    expect(a.duration).toBe(24);
    expect(a.durationUnit).toBe('hour');
    expect(a.reason).toBe('Critical threat detected');
    expect(a.notifyUser).toBe(false);
    expect(a.notifyAdmin).toBe(true);
    expect(a.allowAppeal).toBe(false);
  });

  it('should have log action with all fields', () => {
    const a = blockCriticalThreatsPolicy.actions[4] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('error');
    expect(a.message).toBe('Critical threat blocked');
    expect(a.includeContext).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.includeUser).toBe(true);
    expect(a.tags).toEqual(['critical', 'threat', 'blocked']);
    expect(a.tags).toHaveLength(3);
  });
});

// ============================================================================
// geoRestrictSensitiveOperationsPolicy — EVERY literal
// ============================================================================

describe('geoRestrictSensitiveOperationsPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(geoRestrictSensitiveOperationsPolicy.id).toBe('geo-restrict-sensitive');
    expect(geoRestrictSensitiveOperationsPolicy.name).toBe('Geo-Restrict Sensitive Operations');
    expect(geoRestrictSensitiveOperationsPolicy.description).toBe(
      'Restricts sensitive operations to approved geographic locations'
    );
  });

  it('should have priority 900', () => {
    expect(geoRestrictSensitiveOperationsPolicy.priority).toBe(900);
  });

  it('should have tags [geo-restriction, sensitive, built-in]', () => {
    expect(geoRestrictSensitiveOperationsPolicy.tags).toEqual([
      'geo-restriction',
      'sensitive',
      'built-in',
    ]);
  });

  it('should have exactly 1 composite AND condition with 2 sub-conditions', () => {
    expect(geoRestrictSensitiveOperationsPolicy.conditions).toHaveLength(1);
    const c = geoRestrictSensitiveOperationsPolicy.conditions[0] as any;
    expect(c.type).toBe('composite');
    expect(c.operator).toBe('and');
    expect(c.conditions).toHaveLength(2);
  });

  it('should have sensitivity_level sub-condition with in [restricted, top_secret]', () => {
    const sub = (geoRestrictSensitiveOperationsPolicy.conditions[0] as any).conditions[0];
    expect(sub.type).toBe('resource_attribute');
    expect(sub.field).toBe('sensitivity_level');
    expect(sub.operator).toBe('in');
    expect(sub.value).toEqual(['restricted', 'top_secret']);
    expect(sub.value).toHaveLength(2);
  });

  it('should have method sub-condition with in [POST, PUT, DELETE, PATCH]', () => {
    const sub = (geoRestrictSensitiveOperationsPolicy.conditions[0] as any).conditions[1];
    expect(sub.type).toBe('request_attribute');
    expect(sub.field).toBe('method');
    expect(sub.operator).toBe('in');
    expect(sub.value).toEqual(['POST', 'PUT', 'DELETE', 'PATCH']);
    expect(sub.value).toHaveLength(4);
  });

  it('should have exactly 1 rule: geo_restriction with all fields', () => {
    expect(geoRestrictSensitiveOperationsPolicy.rules).toHaveLength(1);
    const r = geoRestrictSensitiveOperationsPolicy.rules[0] as any;
    expect(r.type).toBe('geo_restriction');
    expect(r.enforced).toBe(true);
    expect(r.allowedCountries).toEqual(['US', 'CA', 'GB', 'DE', 'FR', 'AU']);
    expect(r.allowedCountries).toHaveLength(6);
    expect(r.blockedCountries).toEqual([]);
    expect(r.blockedCountries).toHaveLength(0);
  });

  it('should have exactly 1 action: log with all fields', () => {
    expect(geoRestrictSensitiveOperationsPolicy.actions).toHaveLength(1);
    const a = geoRestrictSensitiveOperationsPolicy.actions[0] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Geo-validated sensitive operation');
    expect(a.includeContext).toBe(true);
    expect(a.tags).toEqual(['geo-check', 'sensitive']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// sessionSecurityHighRiskUsersPolicy — EVERY literal
// ============================================================================

describe('sessionSecurityHighRiskUsersPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(sessionSecurityHighRiskUsersPolicy.id).toBe('session-security-high-risk');
    expect(sessionSecurityHighRiskUsersPolicy.name).toBe('Session Security for High-Risk Users');
    expect(sessionSecurityHighRiskUsersPolicy.description).toBe(
      'Applies stricter session controls for high-risk users'
    );
  });

  it('should have priority 650', () => {
    expect(sessionSecurityHighRiskUsersPolicy.priority).toBe(650);
  });

  it('should have tags [session, risk-based, built-in]', () => {
    expect(sessionSecurityHighRiskUsersPolicy.tags).toEqual(['session', 'risk-based', 'built-in']);
  });

  it('should have exactly 1 condition: risk_based/user_risk_score greater_than 70', () => {
    expect(sessionSecurityHighRiskUsersPolicy.conditions).toHaveLength(1);
    const c = sessionSecurityHighRiskUsersPolicy.conditions[0] as any;
    expect(c.type).toBe('risk_based');
    expect(c.field).toBe('user_risk_score');
    expect(c.operator).toBe('greater_than');
    expect(c.value).toBe(70);
  });

  it('should have exactly 1 rule: session_timeout with all fields', () => {
    expect(sessionSecurityHighRiskUsersPolicy.rules).toHaveLength(1);
    const r = sessionSecurityHighRiskUsersPolicy.rules[0] as any;
    expect(r.type).toBe('session_timeout');
    expect(r.enforced).toBe(true);
    expect(r.maxDuration).toBe(3600);
    expect(r.idleTimeout).toBe(300);
    expect(r.requireReauth).toBe(true);
  });

  it('should have exactly 1 action: log with all fields', () => {
    expect(sessionSecurityHighRiskUsersPolicy.actions).toHaveLength(1);
    const a = sessionSecurityHighRiskUsersPolicy.actions[0] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('info');
    expect(a.message).toBe('Applied high-risk session controls');
    expect(a.includeUser).toBe(true);
    expect(a.tags).toEqual(['session', 'high-risk']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// dataMaskingForPiiPolicy — EVERY literal
// ============================================================================

describe('dataMaskingForPiiPolicy', () => {
  it('should have correct id, name, description', () => {
    expect(dataMaskingForPiiPolicy.id).toBe('data-masking-pii');
    expect(dataMaskingForPiiPolicy.name).toBe('Data Masking for PII Fields');
    expect(dataMaskingForPiiPolicy.description).toBe(
      'Masks personally identifiable information for non-privileged users'
    );
  });

  it('should have priority 400', () => {
    expect(dataMaskingForPiiPolicy.priority).toBe(400);
  });

  it('should have tags [pii, data-masking, built-in]', () => {
    expect(dataMaskingForPiiPolicy.tags).toEqual(['pii', 'data-masking', 'built-in']);
  });

  it('should have exactly 1 composite AND condition with 2 sub-conditions', () => {
    expect(dataMaskingForPiiPolicy.conditions).toHaveLength(1);
    const c = dataMaskingForPiiPolicy.conditions[0] as any;
    expect(c.type).toBe('composite');
    expect(c.operator).toBe('and');
    expect(c.conditions).toHaveLength(2);
  });

  it('should have data_type sub-condition: resource_attribute equals pii', () => {
    const sub = (dataMaskingForPiiPolicy.conditions[0] as any).conditions[0];
    expect(sub.type).toBe('resource_attribute');
    expect(sub.field).toBe('data_type');
    expect(sub.operator).toBe('equals');
    expect(sub.value).toBe('pii');
  });

  it('should have role sub-condition: user_attribute not_in [admin, data-steward, compliance-officer]', () => {
    const sub = (dataMaskingForPiiPolicy.conditions[0] as any).conditions[1];
    expect(sub.type).toBe('user_attribute');
    expect(sub.field).toBe('role');
    expect(sub.operator).toBe('not_in');
    expect(sub.value).toEqual(['admin', 'data-steward', 'compliance-officer']);
    expect(sub.value).toHaveLength(3);
  });

  it('should have exactly 1 rule: data_masking with all 9 fields and mask config', () => {
    expect(dataMaskingForPiiPolicy.rules).toHaveLength(1);
    const r = dataMaskingForPiiPolicy.rules[0] as any;
    expect(r.type).toBe('data_masking');
    expect(r.enforced).toBe(true);
    expect(r.fields).toEqual([
      'ssn',
      'socialSecurityNumber',
      'taxId',
      'bankAccount',
      'creditCard',
      'dateOfBirth',
      'phoneNumber',
      'email',
      'address',
    ]);
    expect(r.fields).toHaveLength(9);
    expect(r.maskType).toBe('partial');
    expect(r.partialMaskPattern).toBe('***');
  });

  it('should have exactly 2 actions: modify and log', () => {
    expect(dataMaskingForPiiPolicy.actions).toHaveLength(2);
    const types = dataMaskingForPiiPolicy.actions.map(a => a.type);
    expect(types).toEqual(['modify', 'log']);
  });

  it('should have modify action with X-Data-Masked header', () => {
    const a = dataMaskingForPiiPolicy.actions[0] as any;
    expect(a.type).toBe('modify');
    expect(a.addHeaders).toEqual({ 'X-Data-Masked': 'true' });
    expect(a.addHeaders['X-Data-Masked']).toBe('true');
  });

  it('should have log action with debug level and tags', () => {
    const a = dataMaskingForPiiPolicy.actions[1] as any;
    expect(a.type).toBe('log');
    expect(a.level).toBe('debug');
    expect(a.message).toBe('PII data masked');
    expect(a.tags).toEqual(['pii', 'masked']);
    expect(a.tags).toHaveLength(2);
  });
});

// ============================================================================
// getBuiltInPoliciesByTag
// ============================================================================

describe('getBuiltInPoliciesByTag', () => {
  it('should return all 10 policies for tag "built-in"', () => {
    const result = getBuiltInPoliciesByTag('built-in');
    expect(result).toHaveLength(10);
  });

  it('should return exactly 2 MFA policies for tag "mfa"', () => {
    const result = getBuiltInPoliciesByTag('mfa');
    expect(result).toHaveLength(2);
    const ids = result.map(p => p.id);
    expect(ids).toContain(requireMfaForAdminPolicy.id);
    expect(ids).toContain(mfaOutsideBusinessHoursPolicy.id);
    for (const p of result) {
      expect(p.tags).toContain('mfa');
    }
  });

  it('should return empty array for nonexistent tag', () => {
    const result = getBuiltInPoliciesByTag('nonexistent');
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it('should return 2 security-tagged policies', () => {
    const result = getBuiltInPoliciesByTag('security');
    expect(result).toHaveLength(2);
    const ids = result.map(p => p.id);
    expect(ids).toContain(blockHighRiskIpsPolicy.id);
    expect(ids).toContain(blockCriticalThreatsPolicy.id);
  });

  it('should return 1 admin-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('admin');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(requireMfaForAdminPolicy.id);
  });

  it('should return 1 approval-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('approval');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(requireApprovalForBulkExportPolicy.id);
  });

  it('should return 1 audit-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('audit');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(enhancedLoggingForSensitiveResourcesPolicy.id);
  });

  it('should return risk-based policies (rate-limit and session)', () => {
    const result = getBuiltInPoliciesByTag('risk-based');
    expect(result).toHaveLength(2);
    const ids = result.map(p => p.id);
    expect(ids).toContain(rateLimitByRiskScorePolicy.id);
    expect(ids).toContain(sessionSecurityHighRiskUsersPolicy.id);
  });

  it('should return 1 rate-limit-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('rate-limit');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(rateLimitByRiskScorePolicy.id);
  });

  it('should return 1 business-hours-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('business-hours');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(mfaOutsideBusinessHoursPolicy.id);
  });

  it('should return 1 threat-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('threat');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(blockCriticalThreatsPolicy.id);
  });

  it('should return 1 critical-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('critical');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(blockCriticalThreatsPolicy.id);
  });

  it('should return 1 geo-restriction-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('geo-restriction');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(geoRestrictSensitiveOperationsPolicy.id);
  });

  it('should return 1 sensitive-tagged policy (geoRestrict only)', () => {
    const result = getBuiltInPoliciesByTag('sensitive');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(geoRestrictSensitiveOperationsPolicy.id);
  });

  it('should return 1 session-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('session');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(sessionSecurityHighRiskUsersPolicy.id);
  });

  it('should return 1 pii-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('pii');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(dataMaskingForPiiPolicy.id);
  });

  it('should return 1 data-masking-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('data-masking');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(dataMaskingForPiiPolicy.id);
  });

  it('should return 1 ip-reputation-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('ip-reputation');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(blockHighRiskIpsPolicy.id);
  });

  it('should return 1 data-protection-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('data-protection');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(requireApprovalForBulkExportPolicy.id);
  });

  it('should return 1 sensitive-data-tagged policy', () => {
    const result = getBuiltInPoliciesByTag('sensitive-data');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(enhancedLoggingForSensitiveResourcesPolicy.id);
  });
});

// ============================================================================
// getBuiltInPolicyIds
// ============================================================================

describe('getBuiltInPolicyIds', () => {
  it('should return array of 10 unique string IDs', () => {
    const ids = getBuiltInPolicyIds();
    expect(ids).toHaveLength(10);
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('should return IDs in the same order as builtInPolicies', () => {
    const ids = getBuiltInPolicyIds();
    expect(ids).toEqual([
      'require-mfa-admin',
      'block-high-risk-ips',
      'require-approval-bulk-export',
      'enhanced-logging-sensitive',
      'rate-limit-by-risk',
      'mfa-outside-business-hours',
      'block-critical-threats',
      'geo-restrict-sensitive',
      'session-security-high-risk',
      'data-masking-pii',
    ]);
  });
});

// ============================================================================
// Cross-cutting: individual array element mutation killers
// ============================================================================

describe('individual array element assertions (mutation killers)', () => {
  it('requireMfaForAdmin: methods array has totp at index 0, webauthn at 1, hardware_key at 2', () => {
    const methods = (requireMfaForAdminPolicy.rules[0] as any).methods;
    expect(methods[0]).toBe('totp');
    expect(methods[1]).toBe('webauthn');
    expect(methods[2]).toBe('hardware_key');
  });

  it('mfaOutsideBusinessHours: methods array has totp at 0, push at 1, sms at 2', () => {
    const methods = (mfaOutsideBusinessHoursPolicy.rules[0] as any).methods;
    expect(methods[0]).toBe('totp');
    expect(methods[1]).toBe('push');
    expect(methods[2]).toBe('sms');
  });

  it('mfaOutsideBusinessHours: daysOfWeek is [1,2,3,4,5]', () => {
    const days = (mfaOutsideBusinessHoursPolicy.conditions[0] as any).daysOfWeek;
    expect(days[0]).toBe(1);
    expect(days[1]).toBe(2);
    expect(days[2]).toBe(3);
    expect(days[3]).toBe(4);
    expect(days[4]).toBe(5);
  });

  it('enhancedLogging: redactFields has all 5 items at correct indices', () => {
    const fields = (enhancedLoggingForSensitiveResourcesPolicy.rules[0] as any).redactFields;
    expect(fields[0]).toBe('password');
    expect(fields[1]).toBe('token');
    expect(fields[2]).toBe('secret');
    expect(fields[3]).toBe('key');
    expect(fields[4]).toBe('credential');
  });

  it('enhancedLogging: condition value has all 3 sensitivity levels at correct indices', () => {
    const val = (enhancedLoggingForSensitiveResourcesPolicy.conditions[0] as any).value;
    expect(val[0]).toBe('confidential');
    expect(val[1]).toBe('restricted');
    expect(val[2]).toBe('top_secret');
  });

  it('dataMasking: fields array has all 9 PII fields at correct indices', () => {
    const fields = (dataMaskingForPiiPolicy.rules[0] as any).fields;
    expect(fields[0]).toBe('ssn');
    expect(fields[1]).toBe('socialSecurityNumber');
    expect(fields[2]).toBe('taxId');
    expect(fields[3]).toBe('bankAccount');
    expect(fields[4]).toBe('creditCard');
    expect(fields[5]).toBe('dateOfBirth');
    expect(fields[6]).toBe('phoneNumber');
    expect(fields[7]).toBe('email');
    expect(fields[8]).toBe('address');
  });

  it('dataMasking: not_in roles at correct indices', () => {
    const val = (dataMaskingForPiiPolicy.conditions[0] as any).conditions[1].value;
    expect(val[0]).toBe('admin');
    expect(val[1]).toBe('data-steward');
    expect(val[2]).toBe('compliance-officer');
  });

  it('bulkExport: approverRoles at correct indices', () => {
    const roles = (requireApprovalForBulkExportPolicy.rules[0] as any).approverRoles;
    expect(roles[0]).toBe('manager');
    expect(roles[1]).toBe('data-steward');
    expect(roles[2]).toBe('admin');
  });

  it('geoRestrict: allowedCountries at correct indices', () => {
    const countries = (geoRestrictSensitiveOperationsPolicy.rules[0] as any).allowedCountries;
    expect(countries[0]).toBe('US');
    expect(countries[1]).toBe('CA');
    expect(countries[2]).toBe('GB');
    expect(countries[3]).toBe('DE');
    expect(countries[4]).toBe('FR');
    expect(countries[5]).toBe('AU');
  });

  it('geoRestrict: sensitivity sub-condition values at correct indices', () => {
    const val = (geoRestrictSensitiveOperationsPolicy.conditions[0] as any).conditions[0].value;
    expect(val[0]).toBe('restricted');
    expect(val[1]).toBe('top_secret');
  });

  it('geoRestrict: method sub-condition values at correct indices', () => {
    const val = (geoRestrictSensitiveOperationsPolicy.conditions[0] as any).conditions[1].value;
    expect(val[0]).toBe('POST');
    expect(val[1]).toBe('PUT');
    expect(val[2]).toBe('DELETE');
    expect(val[3]).toBe('PATCH');
  });

  it('blockHighRiskIps: notify channels at correct indices', () => {
    const channels = (blockHighRiskIpsPolicy.actions[1] as any).channels;
    expect(channels[0]).toBe('slack');
    expect(channels[1]).toBe('email');
  });

  it('blockHighRiskIps: log tags at correct indices', () => {
    const tags = (blockHighRiskIpsPolicy.actions[2] as any).tags;
    expect(tags[0]).toBe('blocked');
    expect(tags[1]).toBe('high-risk-ip');
  });

  it('blockCriticalThreats: notify channels at correct indices', () => {
    const channels = (blockCriticalThreatsPolicy.actions[1] as any).channels;
    expect(channels[0]).toBe('pagerduty');
    expect(channels[1]).toBe('slack');
  });

  it('blockCriticalThreats: assignToRoles at correct indices', () => {
    const roles = (blockCriticalThreatsPolicy.actions[2] as any).assignToRoles;
    expect(roles[0]).toBe('security-team');
    expect(roles[1]).toBe('incident-responder');
  });

  it('blockCriticalThreats: log tags at correct indices', () => {
    const tags = (blockCriticalThreatsPolicy.actions[4] as any).tags;
    expect(tags[0]).toBe('critical');
    expect(tags[1]).toBe('threat');
    expect(tags[2]).toBe('blocked');
  });

  it('rateLimitByRisk: keyBy at correct indices', () => {
    const keyBy = (rateLimitByRiskScorePolicy.rules[0] as any).keyBy;
    expect(keyBy[0]).toBe('user');
    expect(keyBy[1]).toBe('ip');
  });

  it('requireMfaForAdmin: action tags at correct indices', () => {
    const tags = (requireMfaForAdminPolicy.actions[0] as any).tags;
    expect(tags[0]).toBe('admin-access');
    expect(tags[1]).toBe('mfa-verified');
  });

  it('bulkExport: challenge action tags at correct indices', () => {
    const tags = (requireApprovalForBulkExportPolicy.actions[2] as any).tags;
    expect(tags[0]).toBe('bulk-export');
    expect(tags[1]).toBe('pending-approval');
  });

  it('bulkExport: notify action channels has email at index 0', () => {
    const channels = (requireApprovalForBulkExportPolicy.actions[1] as any).channels;
    expect(channels[0]).toBe('email');
  });
});

// ============================================================================
// Cross-cutting: exact tag arrays per policy (mutation killers for tag arrays)
// ============================================================================

describe('exact tag arrays per policy', () => {
  it('requireMfaForAdmin tags', () => {
    expect(requireMfaForAdminPolicy.tags).toEqual(['admin', 'mfa', 'built-in']);
    expect(requireMfaForAdminPolicy.tags).toHaveLength(3);
  });

  it('blockHighRiskIps tags', () => {
    expect(blockHighRiskIpsPolicy.tags).toEqual(['security', 'ip-reputation', 'built-in']);
    expect(blockHighRiskIpsPolicy.tags).toHaveLength(3);
  });

  it('requireApprovalForBulkExport tags', () => {
    expect(requireApprovalForBulkExportPolicy.tags).toEqual(['data-protection', 'approval', 'built-in']);
    expect(requireApprovalForBulkExportPolicy.tags).toHaveLength(3);
  });

  it('enhancedLoggingForSensitiveResources tags', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.tags).toEqual(['audit', 'sensitive-data', 'built-in']);
    expect(enhancedLoggingForSensitiveResourcesPolicy.tags).toHaveLength(3);
  });

  it('rateLimitByRiskScore tags', () => {
    expect(rateLimitByRiskScorePolicy.tags).toEqual(['rate-limit', 'risk-based', 'built-in']);
    expect(rateLimitByRiskScorePolicy.tags).toHaveLength(3);
  });

  it('mfaOutsideBusinessHours tags', () => {
    expect(mfaOutsideBusinessHoursPolicy.tags).toEqual(['mfa', 'business-hours', 'built-in']);
    expect(mfaOutsideBusinessHoursPolicy.tags).toHaveLength(3);
  });

  it('blockCriticalThreats tags', () => {
    expect(blockCriticalThreatsPolicy.tags).toEqual(['security', 'threat', 'critical', 'built-in']);
    expect(blockCriticalThreatsPolicy.tags).toHaveLength(4);
  });

  it('geoRestrictSensitiveOperations tags', () => {
    expect(geoRestrictSensitiveOperationsPolicy.tags).toEqual(['geo-restriction', 'sensitive', 'built-in']);
    expect(geoRestrictSensitiveOperationsPolicy.tags).toHaveLength(3);
  });

  it('sessionSecurityHighRiskUsers tags', () => {
    expect(sessionSecurityHighRiskUsersPolicy.tags).toEqual(['session', 'risk-based', 'built-in']);
    expect(sessionSecurityHighRiskUsersPolicy.tags).toHaveLength(3);
  });

  it('dataMaskingForPii tags', () => {
    expect(dataMaskingForPiiPolicy.tags).toEqual(['pii', 'data-masking', 'built-in']);
    expect(dataMaskingForPiiPolicy.tags).toHaveLength(3);
  });
});

// ============================================================================
// Boundary / exact numeric value assertions (kills +1/-1 numeric mutants)
// ============================================================================

describe('exact numeric values (boundary mutation killers)', () => {
  it('requireMfaForAdmin: priority is exactly 1000, not 999 or 1001', () => {
    expect(requireMfaForAdminPolicy.priority).not.toBe(999);
    expect(requireMfaForAdminPolicy.priority).not.toBe(1001);
    expect(requireMfaForAdminPolicy.priority).toBe(1000);
  });

  it('blockHighRiskIps: priority is exactly 2000', () => {
    expect(blockHighRiskIpsPolicy.priority).not.toBe(1999);
    expect(blockHighRiskIpsPolicy.priority).not.toBe(2001);
    expect(blockHighRiskIpsPolicy.priority).toBe(2000);
  });

  it('blockCriticalThreats: priority is exactly 3000', () => {
    expect(blockCriticalThreatsPolicy.priority).not.toBe(2999);
    expect(blockCriticalThreatsPolicy.priority).not.toBe(3001);
    expect(blockCriticalThreatsPolicy.priority).toBe(3000);
  });

  it('requireMfaForAdmin rule: timeout is exactly 300', () => {
    expect((requireMfaForAdminPolicy.rules[0] as any).timeout).toBe(300);
    expect((requireMfaForAdminPolicy.rules[0] as any).timeout).not.toBe(299);
    expect((requireMfaForAdminPolicy.rules[0] as any).timeout).not.toBe(301);
  });

  it('blockHighRiskIps condition: value is exactly 30', () => {
    expect((blockHighRiskIpsPolicy.conditions[0] as any).value).toBe(30);
    expect((blockHighRiskIpsPolicy.conditions[0] as any).value).not.toBe(29);
    expect((blockHighRiskIpsPolicy.conditions[0] as any).value).not.toBe(31);
  });

  it('bulkExport condition: limit value is exactly 1000', () => {
    const sub = (requireApprovalForBulkExportPolicy.conditions[0] as any).conditions[1];
    expect(sub.value).toBe(1000);
    expect(sub.value).not.toBe(999);
  });

  it('bulkExport rule: approvalTimeout=3600, minApprovers=1', () => {
    const r = requireApprovalForBulkExportPolicy.rules[0] as any;
    expect(r.approvalTimeout).toBe(3600);
    expect(r.minApprovers).toBe(1);
    expect(r.minApprovers).not.toBe(0);
    expect(r.minApprovers).not.toBe(2);
  });

  it('rateLimitByRisk rule: limit=30, window=60, burstLimit=5, retryAfter=60', () => {
    const r = rateLimitByRiskScorePolicy.rules[0] as any;
    expect(r.limit).toBe(30);
    expect(r.limit).not.toBe(29);
    expect(r.window).toBe(60);
    expect(r.window).not.toBe(59);
    expect(r.burstLimit).toBe(5);
    expect(r.burstLimit).not.toBe(4);
    expect(r.burstLimit).not.toBe(6);
    expect(r.retryAfter).toBe(60);
  });

  it('rateLimitByRisk condition: value is exactly 50', () => {
    expect((rateLimitByRiskScorePolicy.conditions[0] as any).value).toBe(50);
    expect((rateLimitByRiskScorePolicy.conditions[0] as any).value).not.toBe(49);
    expect((rateLimitByRiskScorePolicy.conditions[0] as any).value).not.toBe(51);
  });

  it('mfaOutsideBusinessHours condition: startHour=9, endHour=18', () => {
    const c = mfaOutsideBusinessHoursPolicy.conditions[0] as any;
    expect(c.startHour).toBe(9);
    expect(c.startHour).not.toBe(8);
    expect(c.startHour).not.toBe(10);
    expect(c.endHour).toBe(18);
    expect(c.endHour).not.toBe(17);
    expect(c.endHour).not.toBe(19);
  });

  it('mfaOutsideBusinessHours rule: timeout=600, rememberDuration=28800', () => {
    const r = mfaOutsideBusinessHoursPolicy.rules[0] as any;
    expect(r.timeout).toBe(600);
    expect(r.timeout).not.toBe(599);
    expect(r.rememberDuration).toBe(28800);
    expect(r.rememberDuration).not.toBe(28799);
  });

  it('blockCriticalThreats escalate: timeout=300', () => {
    const a = blockCriticalThreatsPolicy.actions[2] as any;
    expect(a.timeout).toBe(300);
    expect(a.timeout).not.toBe(299);
  });

  it('blockCriticalThreats quarantine: duration=24', () => {
    const a = blockCriticalThreatsPolicy.actions[3] as any;
    expect(a.duration).toBe(24);
    expect(a.duration).not.toBe(23);
    expect(a.duration).not.toBe(25);
  });

  it('blockCriticalThreats deny: httpStatus=403', () => {
    const a = blockCriticalThreatsPolicy.actions[0] as any;
    expect(a.httpStatus).toBe(403);
    expect(a.httpStatus).not.toBe(402);
    expect(a.httpStatus).not.toBe(404);
  });

  it('blockHighRiskIps deny: httpStatus=403', () => {
    const a = blockHighRiskIpsPolicy.actions[0] as any;
    expect(a.httpStatus).toBe(403);
  });

  it('sessionSecurity condition: value is exactly 70', () => {
    expect((sessionSecurityHighRiskUsersPolicy.conditions[0] as any).value).toBe(70);
    expect((sessionSecurityHighRiskUsersPolicy.conditions[0] as any).value).not.toBe(69);
    expect((sessionSecurityHighRiskUsersPolicy.conditions[0] as any).value).not.toBe(71);
  });

  it('sessionSecurity rule: maxDuration=3600, idleTimeout=300', () => {
    const r = sessionSecurityHighRiskUsersPolicy.rules[0] as any;
    expect(r.maxDuration).toBe(3600);
    expect(r.maxDuration).not.toBe(3599);
    expect(r.idleTimeout).toBe(300);
    expect(r.idleTimeout).not.toBe(299);
  });

  it('geoRestrict priority is exactly 900', () => {
    expect(geoRestrictSensitiveOperationsPolicy.priority).toBe(900);
    expect(geoRestrictSensitiveOperationsPolicy.priority).not.toBe(899);
  });

  it('bulkExport priority is exactly 800', () => {
    expect(requireApprovalForBulkExportPolicy.priority).toBe(800);
  });

  it('mfaOutsideBusinessHours priority is exactly 700', () => {
    expect(mfaOutsideBusinessHoursPolicy.priority).toBe(700);
  });

  it('sessionSecurity priority is exactly 650', () => {
    expect(sessionSecurityHighRiskUsersPolicy.priority).toBe(650);
  });

  it('rateLimitByRisk priority is exactly 600', () => {
    expect(rateLimitByRiskScorePolicy.priority).toBe(600);
  });

  it('enhancedLogging priority is exactly 500', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.priority).toBe(500);
  });

  it('dataMaskingPii priority is exactly 400', () => {
    expect(dataMaskingForPiiPolicy.priority).toBe(400);
  });

  it('bulkExport challenge timeout is exactly 3600', () => {
    expect((requireApprovalForBulkExportPolicy.actions[0] as any).timeout).toBe(3600);
  });
});

// ============================================================================
// Boolean mutation killers — verify both true and false values distinctly
// ============================================================================

describe('boolean value mutation killers', () => {
  it('requireMfaForAdmin: rule.rememberDevice is false (not true)', () => {
    expect((requireMfaForAdminPolicy.rules[0] as any).rememberDevice).toBe(false);
    expect((requireMfaForAdminPolicy.rules[0] as any).rememberDevice).not.toBe(true);
  });

  it('mfaOutsideBusinessHours: condition.value is false (not true)', () => {
    expect((mfaOutsideBusinessHoursPolicy.conditions[0] as any).value).toBe(false);
    expect((mfaOutsideBusinessHoursPolicy.conditions[0] as any).value).not.toBe(true);
  });

  it('mfaOutsideBusinessHours: rule.rememberDevice is true (not false)', () => {
    expect((mfaOutsideBusinessHoursPolicy.rules[0] as any).rememberDevice).toBe(true);
    expect((mfaOutsideBusinessHoursPolicy.rules[0] as any).rememberDevice).not.toBe(false);
  });

  it('blockHighRiskIps: deny.retryable is false', () => {
    expect((blockHighRiskIpsPolicy.actions[0] as any).retryable).toBe(false);
    expect((blockHighRiskIpsPolicy.actions[0] as any).retryable).not.toBe(true);
  });

  it('blockCriticalThreats: deny.retryable is false', () => {
    expect((blockCriticalThreatsPolicy.actions[0] as any).retryable).toBe(false);
  });

  it('blockCriticalThreats: escalate.createIncident is true', () => {
    expect((blockCriticalThreatsPolicy.actions[2] as any).createIncident).toBe(true);
    expect((blockCriticalThreatsPolicy.actions[2] as any).createIncident).not.toBe(false);
  });

  it('blockCriticalThreats: quarantine.notifyUser=false, notifyAdmin=true, allowAppeal=false', () => {
    const q = blockCriticalThreatsPolicy.actions[3] as any;
    expect(q.notifyUser).toBe(false);
    expect(q.notifyUser).not.toBe(true);
    expect(q.notifyAdmin).toBe(true);
    expect(q.notifyAdmin).not.toBe(false);
    expect(q.allowAppeal).toBe(false);
    expect(q.allowAppeal).not.toBe(true);
  });

  it('bulkExport: requireJustification=true, autoRejectOnTimeout=true', () => {
    const r = requireApprovalForBulkExportPolicy.rules[0] as any;
    expect(r.requireJustification).toBe(true);
    expect(r.requireJustification).not.toBe(false);
    expect(r.autoRejectOnTimeout).toBe(true);
    expect(r.autoRejectOnTimeout).not.toBe(false);
  });

  it('sessionSecurity: requireReauth is true', () => {
    expect((sessionSecurityHighRiskUsersPolicy.rules[0] as any).requireReauth).toBe(true);
    expect((sessionSecurityHighRiskUsersPolicy.rules[0] as any).requireReauth).not.toBe(false);
  });

  it('all policies have enabled=true', () => {
    for (const p of builtInPolicies) {
      expect(p.enabled).toBe(true);
      expect(p.enabled).not.toBe(false);
    }
  });

  it('all rules have enforced=true', () => {
    for (const p of builtInPolicies) {
      for (const r of p.rules) {
        expect(r.enforced).toBe(true);
        expect(r.enforced).not.toBe(false);
      }
    }
  });

  it('requireMfaForAdmin: log.includeUser=true, log.includeRequest=true', () => {
    const a = requireMfaForAdminPolicy.actions[0] as any;
    expect(a.includeUser).toBe(true);
    expect(a.includeRequest).toBe(true);
  });

  it('blockHighRiskIps: notify.includeContext=true', () => {
    expect((blockHighRiskIpsPolicy.actions[1] as any).includeContext).toBe(true);
  });

  it('blockHighRiskIps: log.includeContext=true, log.includeRequest=true', () => {
    const a = blockHighRiskIpsPolicy.actions[2] as any;
    expect(a.includeContext).toBe(true);
    expect(a.includeRequest).toBe(true);
  });

  it('enhancedLogging: rule.includeRequest=true, includeResponse=true, includeHeaders=true', () => {
    const r = enhancedLoggingForSensitiveResourcesPolicy.rules[0] as any;
    expect(r.includeRequest).toBe(true);
    expect(r.includeResponse).toBe(true);
    expect(r.includeHeaders).toBe(true);
  });

  it('enhancedLogging: log.includeContext=true, includeRequest=true, includeUser=true', () => {
    const a = enhancedLoggingForSensitiveResourcesPolicy.actions[0] as any;
    expect(a.includeContext).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.includeUser).toBe(true);
  });

  it('bulkExport: audit_log.includeRequest=true', () => {
    expect((requireApprovalForBulkExportPolicy.rules[1] as any).includeRequest).toBe(true);
  });

  it('bulkExport: notify.includeContext=true', () => {
    expect((requireApprovalForBulkExportPolicy.actions[1] as any).includeContext).toBe(true);
  });

  it('bulkExport: log.includeUser=true, includeRequest=true', () => {
    const a = requireApprovalForBulkExportPolicy.actions[2] as any;
    expect(a.includeUser).toBe(true);
    expect(a.includeRequest).toBe(true);
  });

  it('blockCriticalThreats: notify.includeContext=true', () => {
    expect((blockCriticalThreatsPolicy.actions[1] as any).includeContext).toBe(true);
  });

  it('blockCriticalThreats: log.includeContext=true, includeRequest=true, includeUser=true', () => {
    const a = blockCriticalThreatsPolicy.actions[4] as any;
    expect(a.includeContext).toBe(true);
    expect(a.includeRequest).toBe(true);
    expect(a.includeUser).toBe(true);
  });

  it('geoRestrict: log.includeContext=true', () => {
    expect((geoRestrictSensitiveOperationsPolicy.actions[0] as any).includeContext).toBe(true);
  });

  it('rateLimitByRisk: log.includeUser=true', () => {
    expect((rateLimitByRiskScorePolicy.actions[0] as any).includeUser).toBe(true);
  });

  it('mfaOutsideBusinessHours: log.includeUser=true', () => {
    expect((mfaOutsideBusinessHoursPolicy.actions[0] as any).includeUser).toBe(true);
  });

  it('sessionSecurity: log.includeUser=true', () => {
    expect((sessionSecurityHighRiskUsersPolicy.actions[0] as any).includeUser).toBe(true);
  });
});

// ============================================================================
// String literal mutation killers — exact messages, reasons, errorCodes, etc.
// ============================================================================

describe('exact string literal mutation killers', () => {
  it('blockHighRiskIps: rule reason and errorCode', () => {
    const r = blockHighRiskIpsPolicy.rules[0] as any;
    expect(r.reason).toBe('Access blocked due to high-risk IP address');
    expect(r.errorCode).toBe('IP_BLOCKED');
  });

  it('blockHighRiskIps: deny reason and errorCode', () => {
    const a = blockHighRiskIpsPolicy.actions[0] as any;
    expect(a.reason).toBe('Access blocked due to high-risk IP address');
    expect(a.errorCode).toBe('IP_BLOCKED');
  });

  it('blockHighRiskIps: notify severity and template', () => {
    const a = blockHighRiskIpsPolicy.actions[1] as any;
    expect(a.severity).toBe('high');
    expect(a.template).toBe('high-risk-ip-access');
  });

  it('blockHighRiskIps: log message', () => {
    expect((blockHighRiskIpsPolicy.actions[2] as any).message).toBe(
      'Blocked access from high-risk IP'
    );
  });

  it('blockCriticalThreats: rule reason and errorCode', () => {
    const r = blockCriticalThreatsPolicy.rules[0] as any;
    expect(r.reason).toBe('Request blocked due to critical threat detection');
    expect(r.errorCode).toBe('THREAT_BLOCKED');
  });

  it('blockCriticalThreats: deny reason and errorCode', () => {
    const a = blockCriticalThreatsPolicy.actions[0] as any;
    expect(a.reason).toBe('Request blocked due to critical threat detection');
    expect(a.errorCode).toBe('THREAT_BLOCKED');
  });

  it('blockCriticalThreats: notify severity and template', () => {
    const a = blockCriticalThreatsPolicy.actions[1] as any;
    expect(a.severity).toBe('critical');
    expect(a.template).toBe('critical-threat-blocked');
  });

  it('blockCriticalThreats: escalate incidentType', () => {
    expect((blockCriticalThreatsPolicy.actions[2] as any).incidentType).toBe('security-threat');
  });

  it('blockCriticalThreats: quarantine durationUnit and reason', () => {
    const a = blockCriticalThreatsPolicy.actions[3] as any;
    expect(a.durationUnit).toBe('hour');
    expect(a.reason).toBe('Critical threat detected');
  });

  it('blockCriticalThreats: log message', () => {
    expect((blockCriticalThreatsPolicy.actions[4] as any).message).toBe('Critical threat blocked');
  });

  it('bulkExport: path condition regex value', () => {
    const sub = (requireApprovalForBulkExportPolicy.conditions[0] as any).conditions[0];
    expect(sub.value).toBe('.*/(export|download|bulk).*');
  });

  it('bulkExport: audit_log rule level and destination', () => {
    const r = requireApprovalForBulkExportPolicy.rules[1] as any;
    expect(r.level).toBe('detailed');
    expect(r.destination).toBe('audit-log');
  });

  it('bulkExport: notify severity and template', () => {
    const a = requireApprovalForBulkExportPolicy.actions[1] as any;
    expect(a.severity).toBe('medium');
    expect(a.template).toBe('bulk-export-approval-request');
  });

  it('bulkExport: log message', () => {
    expect((requireApprovalForBulkExportPolicy.actions[2] as any).message).toBe(
      'Bulk export request pending approval'
    );
  });

  it('enhancedLogging: rule destination', () => {
    expect((enhancedLoggingForSensitiveResourcesPolicy.rules[0] as any).destination).toBe(
      'sensitive-audit-log'
    );
  });

  it('enhancedLogging: log message', () => {
    expect((enhancedLoggingForSensitiveResourcesPolicy.actions[0] as any).message).toBe(
      'Access to sensitive resource'
    );
  });

  it('rateLimitByRisk: rule windowUnit', () => {
    expect((rateLimitByRiskScorePolicy.rules[0] as any).windowUnit).toBe('second');
  });

  it('rateLimitByRisk: log message', () => {
    expect((rateLimitByRiskScorePolicy.actions[0] as any).message).toBe(
      'Applied risk-based rate limiting'
    );
  });

  it('mfaOutsideBusinessHours: condition timezone', () => {
    expect((mfaOutsideBusinessHoursPolicy.conditions[0] as any).timezone).toBe('UTC');
  });

  it('mfaOutsideBusinessHours: log message', () => {
    expect((mfaOutsideBusinessHoursPolicy.actions[0] as any).message).toBe(
      'Off-hours access with MFA'
    );
  });

  it('geoRestrict: log message', () => {
    expect((geoRestrictSensitiveOperationsPolicy.actions[0] as any).message).toBe(
      'Geo-validated sensitive operation'
    );
  });

  it('sessionSecurity: log message', () => {
    expect((sessionSecurityHighRiskUsersPolicy.actions[0] as any).message).toBe(
      'Applied high-risk session controls'
    );
  });

  it('dataMaskingPii: rule partialMaskPattern', () => {
    expect((dataMaskingForPiiPolicy.rules[0] as any).partialMaskPattern).toBe('***');
  });

  it('dataMaskingPii: log message', () => {
    expect((dataMaskingForPiiPolicy.actions[1] as any).message).toBe('PII data masked');
  });

  it('requireMfaForAdmin: log message', () => {
    expect((requireMfaForAdminPolicy.actions[0] as any).message).toBe(
      'Admin access with MFA verification'
    );
  });
});

// ============================================================================
// Empty string / empty array mutation killers
// ============================================================================

describe('empty string and empty array mutation killers', () => {
  it('bulkExport: notify recipients is empty array (not removed)', () => {
    const a = requireApprovalForBulkExportPolicy.actions[1] as any;
    expect(a.recipients).toBeDefined();
    expect(Array.isArray(a.recipients)).toBe(true);
    expect(a.recipients).toHaveLength(0);
  });

  it('geoRestrict: blockedCountries is empty array (not removed)', () => {
    const r = geoRestrictSensitiveOperationsPolicy.rules[0] as any;
    expect(r.blockedCountries).toBeDefined();
    expect(Array.isArray(r.blockedCountries)).toBe(true);
    expect(r.blockedCountries).toHaveLength(0);
  });
});

// ============================================================================
// Regex mutation killers for createPolicyId
// ============================================================================

describe('createPolicyId regex behavior (via computed IDs)', () => {
  it('should handle multiple spaces by converting to single dashes', () => {
    // The input 'require-mfa-admin' has only dashes, proving spaces->dashes works
    // But also, the regex \s+ handles multiple spaces → single dash
    // All IDs should have no consecutive dashes, proving the regex works
    for (const p of builtInPolicies) {
      expect(p.id).not.toMatch(/--/);
    }
  });

  it('all IDs should be lowercase only', () => {
    for (const p of builtInPolicies) {
      expect(p.id).toBe(p.id.toLowerCase());
    }
  });

  it('all IDs should contain only a-z, 0-9, and dashes', () => {
    for (const p of builtInPolicies) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('no IDs should be empty strings', () => {
    for (const p of builtInPolicies) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.id).not.toBe('');
    }
  });
});

// ============================================================================
// Action/rule counts per policy (kills array removal mutants)
// ============================================================================

describe('exact counts of conditions, rules, and actions per policy', () => {
  it('requireMfaForAdmin: 1 condition, 1 rule, 1 action', () => {
    expect(requireMfaForAdminPolicy.conditions).toHaveLength(1);
    expect(requireMfaForAdminPolicy.rules).toHaveLength(1);
    expect(requireMfaForAdminPolicy.actions).toHaveLength(1);
  });

  it('blockHighRiskIps: 1 condition, 1 rule, 3 actions', () => {
    expect(blockHighRiskIpsPolicy.conditions).toHaveLength(1);
    expect(blockHighRiskIpsPolicy.rules).toHaveLength(1);
    expect(blockHighRiskIpsPolicy.actions).toHaveLength(3);
  });

  it('bulkExport: 1 condition (composite with 2), 2 rules, 3 actions', () => {
    expect(requireApprovalForBulkExportPolicy.conditions).toHaveLength(1);
    expect((requireApprovalForBulkExportPolicy.conditions[0] as any).conditions).toHaveLength(2);
    expect(requireApprovalForBulkExportPolicy.rules).toHaveLength(2);
    expect(requireApprovalForBulkExportPolicy.actions).toHaveLength(3);
  });

  it('enhancedLogging: 1 condition, 1 rule, 2 actions', () => {
    expect(enhancedLoggingForSensitiveResourcesPolicy.conditions).toHaveLength(1);
    expect(enhancedLoggingForSensitiveResourcesPolicy.rules).toHaveLength(1);
    expect(enhancedLoggingForSensitiveResourcesPolicy.actions).toHaveLength(2);
  });

  it('rateLimitByRisk: 1 condition, 1 rule, 1 action', () => {
    expect(rateLimitByRiskScorePolicy.conditions).toHaveLength(1);
    expect(rateLimitByRiskScorePolicy.rules).toHaveLength(1);
    expect(rateLimitByRiskScorePolicy.actions).toHaveLength(1);
  });

  it('mfaOutsideBusinessHours: 1 condition, 1 rule, 1 action', () => {
    expect(mfaOutsideBusinessHoursPolicy.conditions).toHaveLength(1);
    expect(mfaOutsideBusinessHoursPolicy.rules).toHaveLength(1);
    expect(mfaOutsideBusinessHoursPolicy.actions).toHaveLength(1);
  });

  it('blockCriticalThreats: 1 condition, 1 rule, 5 actions', () => {
    expect(blockCriticalThreatsPolicy.conditions).toHaveLength(1);
    expect(blockCriticalThreatsPolicy.rules).toHaveLength(1);
    expect(blockCriticalThreatsPolicy.actions).toHaveLength(5);
  });

  it('geoRestrict: 1 condition (composite with 2), 1 rule, 1 action', () => {
    expect(geoRestrictSensitiveOperationsPolicy.conditions).toHaveLength(1);
    expect((geoRestrictSensitiveOperationsPolicy.conditions[0] as any).conditions).toHaveLength(2);
    expect(geoRestrictSensitiveOperationsPolicy.rules).toHaveLength(1);
    expect(geoRestrictSensitiveOperationsPolicy.actions).toHaveLength(1);
  });

  it('sessionSecurity: 1 condition, 1 rule, 1 action', () => {
    expect(sessionSecurityHighRiskUsersPolicy.conditions).toHaveLength(1);
    expect(sessionSecurityHighRiskUsersPolicy.rules).toHaveLength(1);
    expect(sessionSecurityHighRiskUsersPolicy.actions).toHaveLength(1);
  });

  it('dataMaskingPii: 1 condition (composite with 2), 1 rule, 2 actions', () => {
    expect(dataMaskingForPiiPolicy.conditions).toHaveLength(1);
    expect((dataMaskingForPiiPolicy.conditions[0] as any).conditions).toHaveLength(2);
    expect(dataMaskingForPiiPolicy.rules).toHaveLength(1);
    expect(dataMaskingForPiiPolicy.actions).toHaveLength(2);
  });
});
