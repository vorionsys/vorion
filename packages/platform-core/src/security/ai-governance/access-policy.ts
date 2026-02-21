/**
 * AI Model Access Policy Manager
 * Controls access to AI models based on roles, departments, and security requirements
 * Vorion Security Platform
 */

import { EventEmitter } from 'events';
import {
  ModelAccessPolicy,
  DataClassification,
  AuditLevel,
  TimeRestriction,
} from './types';

/**
 * Access request context
 */
export interface AccessRequestContext {
  userId: string;
  modelId: string;
  roles: string[];
  department: string;
  mfaVerified: boolean;
  ipAddress: string;
  timestamp: Date;
  queryDataClassification?: DataClassification;
  requestedOperation?: string;
  geolocation?: {
    country: string;
    region?: string;
  };
}

/**
 * Access decision result
 */
export interface AccessDecision {
  allowed: boolean;
  reason: string;
  policy?: ModelAccessPolicy;
  violations: PolicyViolation[];
  auditLevel: AuditLevel;
  restrictions: AccessRestriction[];
  expiresAt?: Date;
}

/**
 * Policy violation details
 */
export interface PolicyViolation {
  type: PolicyViolationType;
  message: string;
  severity: 'warning' | 'error' | 'critical';
  policyField: string;
}

/**
 * Policy violation types
 */
export type PolicyViolationType =
  | 'role-not-allowed'
  | 'department-not-allowed'
  | 'mfa-required'
  | 'rate-limit-exceeded'
  | 'data-classification-exceeded'
  | 'time-restricted'
  | 'ip-blocked'
  | 'ip-not-whitelisted'
  | 'operation-denied'
  | 'approval-required'
  | 'policy-expired'
  | 'geographic-restricted'
  | 'token-limit-exceeded'
  | 'cost-limit-exceeded';

/**
 * Access restriction
 */
export interface AccessRestriction {
  type: string;
  value: unknown;
  description: string;
}

/**
 * Policy storage interface
 */
export interface PolicyStorage {
  save(policy: ModelAccessPolicy): Promise<void>;
  get(modelId: string): Promise<ModelAccessPolicy | null>;
  delete(modelId: string): Promise<void>;
  list(): Promise<ModelAccessPolicy[]>;
  getByRole(role: string): Promise<ModelAccessPolicy[]>;
  getByDepartment(department: string): Promise<ModelAccessPolicy[]>;
}

/**
 * In-memory policy storage implementation
 */
export class InMemoryPolicyStorage implements PolicyStorage {
  private policies: Map<string, ModelAccessPolicy> = new Map();

  async save(policy: ModelAccessPolicy): Promise<void> {
    this.policies.set(policy.modelId, { ...policy });
  }

  async get(modelId: string): Promise<ModelAccessPolicy | null> {
    const policy = this.policies.get(modelId);
    return policy ? { ...policy } : null;
  }

  async delete(modelId: string): Promise<void> {
    this.policies.delete(modelId);
  }

  async list(): Promise<ModelAccessPolicy[]> {
    return Array.from(this.policies.values()).map((p) => ({ ...p }));
  }

  async getByRole(role: string): Promise<ModelAccessPolicy[]> {
    const policies = await this.list();
    return policies.filter((p) => p.allowedRoles.includes(role));
  }

  async getByDepartment(department: string): Promise<ModelAccessPolicy[]> {
    const policies = await this.list();
    return policies.filter((p) => p.allowedDepartments.includes(department));
  }
}

/**
 * Usage tracking for rate limiting
 */
export interface UsageTracker {
  getQueriesInLastHour(userId: string, modelId: string): Promise<number>;
  getTokensUsedToday(userId: string, modelId: string): Promise<number>;
  getCostToday(userId: string, modelId: string): Promise<number>;
  recordQuery(userId: string, modelId: string): Promise<void>;
}

/**
 * In-memory usage tracker implementation
 */
export class InMemoryUsageTracker implements UsageTracker {
  private queries: Map<string, Date[]> = new Map();
  private tokens: Map<string, number> = new Map();
  private costs: Map<string, number> = new Map();

  private getKey(userId: string, modelId: string): string {
    return `${userId}:${modelId}`;
  }

  async getQueriesInLastHour(userId: string, modelId: string): Promise<number> {
    const key = this.getKey(userId, modelId);
    const queries = this.queries.get(key) || [];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return queries.filter((q) => q > oneHourAgo).length;
  }

  async getTokensUsedToday(userId: string, modelId: string): Promise<number> {
    const key = `${this.getKey(userId, modelId)}:tokens:${new Date().toDateString()}`;
    return this.tokens.get(key) || 0;
  }

  async getCostToday(userId: string, modelId: string): Promise<number> {
    const key = `${this.getKey(userId, modelId)}:cost:${new Date().toDateString()}`;
    return this.costs.get(key) || 0;
  }

  async recordQuery(userId: string, modelId: string): Promise<void> {
    const key = this.getKey(userId, modelId);
    const queries = this.queries.get(key) || [];
    queries.push(new Date());
    // Keep only last hour of queries
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.queries.set(
      key,
      queries.filter((q) => q > oneHourAgo)
    );
  }

  async recordTokens(userId: string, modelId: string, tokens: number): Promise<void> {
    const key = `${this.getKey(userId, modelId)}:tokens:${new Date().toDateString()}`;
    const current = this.tokens.get(key) || 0;
    this.tokens.set(key, current + tokens);
  }

  async recordCost(userId: string, modelId: string, cost: number): Promise<void> {
    const key = `${this.getKey(userId, modelId)}:cost:${new Date().toDateString()}`;
    const current = this.costs.get(key) || 0;
    this.costs.set(key, current + cost);
  }
}

/**
 * Access Policy Manager
 * Evaluates and enforces access policies for AI models
 */
export class AccessPolicyManager extends EventEmitter {
  private storage: PolicyStorage;
  private usageTracker: UsageTracker;
  private dataClassificationHierarchy: DataClassification[];

  constructor(storage?: PolicyStorage, usageTracker?: UsageTracker) {
    super();
    this.storage = storage || new InMemoryPolicyStorage();
    this.usageTracker = usageTracker || new InMemoryUsageTracker();
    this.dataClassificationHierarchy = [
      'public',
      'internal',
      'confidential',
      'restricted',
      'top-secret',
    ];
  }

  /**
   * Create a new access policy
   */
  async createPolicy(policy: ModelAccessPolicy): Promise<ModelAccessPolicy> {
    this.validatePolicy(policy);
    await this.storage.save(policy);
    this.emit('policy:created', policy);
    return policy;
  }

  /**
   * Update an existing policy
   */
  async updatePolicy(
    modelId: string,
    updates: Partial<Omit<ModelAccessPolicy, 'modelId'>>
  ): Promise<ModelAccessPolicy> {
    const existing = await this.storage.get(modelId);
    if (!existing) {
      throw new Error(`Policy for model ${modelId} not found`);
    }

    const updated: ModelAccessPolicy = {
      ...existing,
      ...updates,
      modelId,
    };

    this.validatePolicy(updated);
    await this.storage.save(updated);
    this.emit('policy:updated', updated);
    return updated;
  }

  /**
   * Get a policy by model ID
   */
  async getPolicy(modelId: string): Promise<ModelAccessPolicy | null> {
    return this.storage.get(modelId);
  }

  /**
   * Delete a policy
   */
  async deletePolicy(modelId: string): Promise<void> {
    await this.storage.delete(modelId);
    this.emit('policy:deleted', { modelId });
  }

  /**
   * List all policies
   */
  async listPolicies(): Promise<ModelAccessPolicy[]> {
    return this.storage.list();
  }

  /**
   * Check if access is allowed
   */
  async checkAccess(context: AccessRequestContext): Promise<AccessDecision> {
    const policy = await this.storage.get(context.modelId);

    if (!policy) {
      // Default deny if no policy exists
      return {
        allowed: false,
        reason: 'No access policy defined for this model',
        violations: [
          {
            type: 'role-not-allowed',
            message: 'No policy exists for this model',
            severity: 'error',
            policyField: 'modelId',
          },
        ],
        auditLevel: 'full',
        restrictions: [],
      };
    }

    const violations: PolicyViolation[] = [];
    const restrictions: AccessRestriction[] = [];

    // Check policy expiration
    if (policy.expiresAt && new Date() > policy.expiresAt) {
      violations.push({
        type: 'policy-expired',
        message: 'Access policy has expired',
        severity: 'error',
        policyField: 'expiresAt',
      });
    }

    // Check role authorization
    const hasAllowedRole = context.roles.some((role) =>
      policy.allowedRoles.includes(role) || policy.allowedRoles.includes('*')
    );
    if (!hasAllowedRole) {
      violations.push({
        type: 'role-not-allowed',
        message: `User roles [${context.roles.join(', ')}] not in allowed roles`,
        severity: 'error',
        policyField: 'allowedRoles',
      });
    }

    // Check department authorization
    const departmentAllowed =
      policy.allowedDepartments.includes(context.department) ||
      policy.allowedDepartments.includes('*');
    if (!departmentAllowed) {
      violations.push({
        type: 'department-not-allowed',
        message: `Department ${context.department} not allowed`,
        severity: 'error',
        policyField: 'allowedDepartments',
      });
    }

    // Check MFA requirement
    if (policy.requireMFA && !context.mfaVerified) {
      violations.push({
        type: 'mfa-required',
        message: 'Multi-factor authentication required',
        severity: 'error',
        policyField: 'requireMFA',
      });
    }

    // Check rate limit
    const queriesInLastHour = await this.usageTracker.getQueriesInLastHour(
      context.userId,
      context.modelId
    );
    if (queriesInLastHour >= policy.maxQueriesPerHour) {
      violations.push({
        type: 'rate-limit-exceeded',
        message: `Rate limit exceeded: ${queriesInLastHour}/${policy.maxQueriesPerHour} queries per hour`,
        severity: 'error',
        policyField: 'maxQueriesPerHour',
      });
    } else {
      restrictions.push({
        type: 'rate-limit',
        value: {
          remaining: policy.maxQueriesPerHour - queriesInLastHour,
          limit: policy.maxQueriesPerHour,
        },
        description: `${policy.maxQueriesPerHour - queriesInLastHour} queries remaining this hour`,
      });
    }

    // Check data classification
    if (context.queryDataClassification) {
      const requestedLevel = this.dataClassificationHierarchy.indexOf(
        context.queryDataClassification
      );
      const allowedLevel = this.dataClassificationHierarchy.indexOf(
        policy.dataClassificationLimit
      );
      if (requestedLevel > allowedLevel) {
        violations.push({
          type: 'data-classification-exceeded',
          message: `Requested data classification ${context.queryDataClassification} exceeds limit ${policy.dataClassificationLimit}`,
          severity: 'critical',
          policyField: 'dataClassificationLimit',
        });
      }
    }

    // Check time restrictions
    if (policy.timeRestrictions && policy.timeRestrictions.length > 0) {
      const isWithinAllowedTime = this.checkTimeRestrictions(
        context.timestamp,
        policy.timeRestrictions
      );
      if (!isWithinAllowedTime) {
        violations.push({
          type: 'time-restricted',
          message: 'Access not allowed at current time',
          severity: 'error',
          policyField: 'timeRestrictions',
        });
      }
    }

    // Check IP whitelist
    if (policy.ipWhitelist && policy.ipWhitelist.length > 0) {
      if (!this.isIPAllowed(context.ipAddress, policy.ipWhitelist)) {
        violations.push({
          type: 'ip-not-whitelisted',
          message: `IP address ${context.ipAddress} not in whitelist`,
          severity: 'error',
          policyField: 'ipWhitelist',
        });
      }
    }

    // Check IP blacklist
    if (policy.ipBlacklist && policy.ipBlacklist.length > 0) {
      if (this.isIPAllowed(context.ipAddress, policy.ipBlacklist)) {
        violations.push({
          type: 'ip-blocked',
          message: `IP address ${context.ipAddress} is blocked`,
          severity: 'critical',
          policyField: 'ipBlacklist',
        });
      }
    }

    // Check operation permissions
    if (context.requestedOperation) {
      if (
        policy.deniedOperations &&
        policy.deniedOperations.includes(context.requestedOperation)
      ) {
        violations.push({
          type: 'operation-denied',
          message: `Operation ${context.requestedOperation} is explicitly denied`,
          severity: 'error',
          policyField: 'deniedOperations',
        });
      }
      if (
        policy.allowedOperations &&
        policy.allowedOperations.length > 0 &&
        !policy.allowedOperations.includes(context.requestedOperation)
      ) {
        violations.push({
          type: 'operation-denied',
          message: `Operation ${context.requestedOperation} is not in allowed operations`,
          severity: 'error',
          policyField: 'allowedOperations',
        });
      }
    }

    // Check geographic restrictions
    if (
      policy.geographicRestrictions &&
      policy.geographicRestrictions.length > 0 &&
      context.geolocation
    ) {
      if (!policy.geographicRestrictions.includes(context.geolocation.country)) {
        violations.push({
          type: 'geographic-restricted',
          message: `Access not allowed from ${context.geolocation.country}`,
          severity: 'error',
          policyField: 'geographicRestrictions',
        });
      }
    }

    // Check if approval is required
    if (policy.requireApproval) {
      restrictions.push({
        type: 'approval-required',
        value: policy.approvers,
        description: 'This access requires approval from designated approvers',
      });
    }

    // Add token limit restriction if applicable
    if (policy.maxTokensPerQuery) {
      restrictions.push({
        type: 'token-limit',
        value: policy.maxTokensPerQuery,
        description: `Maximum ${policy.maxTokensPerQuery} tokens per query`,
      });
    }

    // Add cost limit restriction if applicable
    if (policy.maxCostPerDay) {
      const costToday = await this.usageTracker.getCostToday(
        context.userId,
        context.modelId
      );
      restrictions.push({
        type: 'cost-limit',
        value: {
          used: costToday,
          limit: policy.maxCostPerDay,
          remaining: Math.max(0, policy.maxCostPerDay - costToday),
        },
        description: `Daily cost limit: $${policy.maxCostPerDay}`,
      });
    }

    const hasErrors = violations.some((v) => v.severity === 'error' || v.severity === 'critical');
    const allowed = !hasErrors;

    const decision: AccessDecision = {
      allowed,
      reason: allowed
        ? 'Access granted'
        : violations.map((v) => v.message).join('; '),
      policy,
      violations,
      auditLevel: policy.auditLevel,
      restrictions,
      expiresAt: policy.expiresAt,
    };

    if (!allowed) {
      this.emit('policy:violated', {
        policy,
        violation: decision.reason,
        userId: context.userId,
        context,
      });
    }

    return decision;
  }

  /**
   * Record a successful access
   */
  async recordAccess(userId: string, modelId: string): Promise<void> {
    await this.usageTracker.recordQuery(userId, modelId);
  }

  /**
   * Validate policy configuration
   */
  private validatePolicy(policy: ModelAccessPolicy): void {
    if (!policy.modelId) {
      throw new Error('Policy must have a modelId');
    }
    if (!policy.allowedRoles || policy.allowedRoles.length === 0) {
      throw new Error('Policy must have at least one allowed role');
    }
    if (!policy.allowedDepartments || policy.allowedDepartments.length === 0) {
      throw new Error('Policy must have at least one allowed department');
    }
    if (policy.maxQueriesPerHour < 0) {
      throw new Error('maxQueriesPerHour must be non-negative');
    }
    if (!this.dataClassificationHierarchy.includes(policy.dataClassificationLimit)) {
      throw new Error(`Invalid data classification: ${policy.dataClassificationLimit}`);
    }
    if (!['none', 'basic', 'detailed', 'full'].includes(policy.auditLevel)) {
      throw new Error(`Invalid audit level: ${policy.auditLevel}`);
    }
  }

  /**
   * Check if current time is within allowed time restrictions
   */
  private checkTimeRestrictions(
    timestamp: Date,
    restrictions: TimeRestriction[]
  ): boolean {
    for (const restriction of restrictions) {
      const dayOfWeek = timestamp.getDay();
      if (!restriction.dayOfWeek.includes(dayOfWeek)) {
        continue;
      }

      // Convert to restriction timezone
      const options: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        hour12: false,
        timeZone: restriction.timezone,
      };
      const hour = parseInt(timestamp.toLocaleString('en-US', options), 10);

      if (hour >= restriction.startHour && hour < restriction.endHour) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if IP is in a list (supports CIDR notation)
   */
  private isIPAllowed(ip: string, ipList: string[]): boolean {
    for (const allowed of ipList) {
      if (allowed === ip) {
        return true;
      }
      if (allowed === '*') {
        return true;
      }
      if (allowed.includes('/')) {
        if (this.isIPInCIDR(ip, allowed)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if IP is within a CIDR range
   */
  private isIPInCIDR(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const mask = parseInt(bits, 10);

    const ipLong = this.ipToLong(ip);
    const rangeLong = this.ipToLong(range);
    const maskLong = -1 << (32 - mask);

    return (ipLong & maskLong) === (rangeLong & maskLong);
  }

  /**
   * Convert IP address to long integer
   */
  private ipToLong(ip: string): number {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  }

  /**
   * Create a default restrictive policy
   */
  createDefaultPolicy(modelId: string): ModelAccessPolicy {
    return {
      modelId,
      allowedRoles: [],
      allowedDepartments: [],
      requireMFA: true,
      maxQueriesPerHour: 100,
      dataClassificationLimit: 'internal',
      auditLevel: 'detailed',
    };
  }

  /**
   * Get policies for a specific role
   */
  async getPoliciesForRole(role: string): Promise<ModelAccessPolicy[]> {
    return this.storage.getByRole(role);
  }

  /**
   * Get policies for a specific department
   */
  async getPoliciesForDepartment(department: string): Promise<ModelAccessPolicy[]> {
    return this.storage.getByDepartment(department);
  }

  /**
   * Bulk update policies
   */
  async bulkUpdate(
    modelIds: string[],
    updates: Partial<Omit<ModelAccessPolicy, 'modelId'>>
  ): Promise<ModelAccessPolicy[]> {
    const results: ModelAccessPolicy[] = [];
    for (const modelId of modelIds) {
      const updated = await this.updatePolicy(modelId, updates);
      results.push(updated);
    }
    return results;
  }

  /**
   * Export policies for backup/audit
   */
  async exportPolicies(): Promise<{
    exportedAt: Date;
    policyCount: number;
    policies: ModelAccessPolicy[];
  }> {
    const policies = await this.listPolicies();
    return {
      exportedAt: new Date(),
      policyCount: policies.length,
      policies,
    };
  }

  /**
   * Import policies from backup
   */
  async importPolicies(
    policies: ModelAccessPolicy[],
    overwrite: boolean = false
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const policy of policies) {
      try {
        const existing = await this.storage.get(policy.modelId);
        if (existing && !overwrite) {
          skipped++;
          continue;
        }
        this.validatePolicy(policy);
        await this.storage.save(policy);
        imported++;
      } catch (error) {
        errors.push(`Failed to import policy for ${policy.modelId}: ${error}`);
      }
    }

    return { imported, skipped, errors };
  }
}

export default AccessPolicyManager;
