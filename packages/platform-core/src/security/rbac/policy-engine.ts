/**
 * RBAC Policy Evaluation Engine
 *
 * Evaluates access control policies based on:
 * - Role-based permissions
 * - Resource-based access control
 * - Trust tier requirements
 * - Time-based and conditional policies
 * - Tenant context isolation
 *
 * Integrates with TenantContext for multi-tenant authorization and
 * Trust-engine for trust-based access decisions.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { createLogger } from '../../common/logger.js';
import { withSpan, type TraceSpan } from '../../common/trace.js';
import { ForbiddenError } from '../../common/errors.js';
import { Counter, Histogram } from 'prom-client';
import { vorionRegistry } from '../../common/metrics-registry.js';
import type { ID, TrustLevel } from '../../common/types.js';
import {
  type RoleDefinition,
  type RoleAssignment,
  type TimeRestriction,
  getEffectivePermissions,
  meetsTrustRequirement,
  getBuiltinRoles,
  ROLE_PRIORITY,
  BuiltinRoles,
} from './roles.js';
import {
  type PermissionDefinition,
  type PermissionCheckRequest,
  type PermissionCheckResult,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getBuiltinPermissions,
} from './permissions.js';
import {
  SecurityAuditLogger,
  getSecurityAuditLogger,
} from '../../audit/security-logger.js';
import type { SecurityActor, SecurityResource } from '../../audit/security-events.js';

const logger = createLogger({ component: 'rbac-policy-engine' });

// =============================================================================
// METRICS
// =============================================================================

const policyEvaluations = new Counter({
  name: 'vorion_rbac_policy_evaluations_total',
  help: 'Total RBAC policy evaluations',
  labelNames: ['result', 'policy_type'] as const,
  registers: [vorionRegistry],
});

const policyEvaluationDuration = new Histogram({
  name: 'vorion_rbac_policy_evaluation_duration_seconds',
  help: 'Duration of RBAC policy evaluation',
  labelNames: ['policy_type'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [vorionRegistry],
});

const permissionChecks = new Counter({
  name: 'vorion_rbac_permission_checks_total',
  help: 'Total RBAC permission checks',
  labelNames: ['result', 'resource_type'] as const,
  registers: [vorionRegistry],
});

// =============================================================================
// TYPES
// =============================================================================

/**
 * Access control policy types
 */
export const PolicyTypes = {
  /** Role-based permission check */
  ROLE_BASED: 'role_based',
  /** Resource-based permission check */
  RESOURCE_BASED: 'resource_based',
  /** Trust-tier requirement */
  TRUST_BASED: 'trust_based',
  /** Time-based restriction */
  TIME_BASED: 'time_based',
  /** Conditional policy */
  CONDITIONAL: 'conditional',
  /** Composite (multiple policies) */
  COMPOSITE: 'composite',
} as const;

export type PolicyType = (typeof PolicyTypes)[keyof typeof PolicyTypes];

/**
 * Policy evaluation effect
 */
export const PolicyEffects = {
  ALLOW: 'allow',
  DENY: 'deny',
  INDETERMINATE: 'indeterminate',
  NOT_APPLICABLE: 'not_applicable',
} as const;

export type PolicyEffect = (typeof PolicyEffects)[keyof typeof PolicyEffects];

/**
 * Policy combining algorithm
 */
export const CombiningAlgorithms = {
  /** First deny wins */
  DENY_OVERRIDES: 'deny_overrides',
  /** First allow wins */
  PERMIT_OVERRIDES: 'permit_overrides',
  /** All must allow */
  UNANIMOUS: 'unanimous',
  /** First applicable wins */
  FIRST_APPLICABLE: 'first_applicable',
  /** Priority-based (highest priority wins) */
  PRIORITY_BASED: 'priority_based',
} as const;

export type CombiningAlgorithm = (typeof CombiningAlgorithms)[keyof typeof CombiningAlgorithms];

/**
 * Access control policy definition
 */
export interface AccessPolicy {
  /** Unique policy identifier */
  id: ID;
  /** Policy name */
  name: string;
  /** Policy description */
  description?: string;
  /** Policy type */
  type: PolicyType;
  /** Policy priority (higher = more important) */
  priority: number;
  /** Effect when policy matches */
  effect: PolicyEffect;
  /** Target subjects (who the policy applies to) */
  target?: PolicyTarget;
  /** Conditions for policy application */
  conditions?: PolicyConditions;
  /** Required permissions for allow */
  requiredPermissions?: string[];
  /** Required roles for allow */
  requiredRoles?: string[];
  /** Required trust tier */
  requiredTrustTier?: TrustLevel;
  /** Resource patterns this policy applies to */
  resourcePatterns?: string[];
  /** Time restrictions */
  timeRestrictions?: TimeRestriction[];
  /** Child policies (for composite) */
  childPolicies?: AccessPolicy[];
  /** Combining algorithm for child policies */
  combiningAlgorithm?: CombiningAlgorithm;
  /** Whether policy is enabled */
  enabled: boolean;
  /** Tenant scope (if tenant-specific) */
  tenantId?: ID;
  /** Metadata */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Policy target (who the policy applies to)
 */
export interface PolicyTarget {
  /** Subject IDs */
  subjectIds?: ID[];
  /** Subject types */
  subjectTypes?: ('user' | 'agent' | 'service')[];
  /** Role IDs */
  roleIds?: string[];
  /** Tenant IDs */
  tenantIds?: ID[];
  /** Exclude these subjects */
  excludeSubjectIds?: ID[];
}

/**
 * Policy conditions
 */
export interface PolicyConditions {
  /** IP address restrictions */
  ipAddresses?: string[];
  /** Time window */
  timeWindow?: TimeRestriction;
  /** Custom attribute conditions */
  attributes?: Record<string, unknown>;
  /** Expression-based condition */
  expression?: string;
}

/**
 * Policy evaluation context
 */
export interface PolicyEvaluationContext {
  /** Subject making the request */
  subject: {
    id: ID;
    type: 'user' | 'agent' | 'service';
    trustTier: TrustLevel;
    roles: string[];
    permissions: Set<string>;
    attributes?: Record<string, unknown>;
  };
  /** Resource being accessed */
  resource: {
    id?: ID;
    type: string;
    action: string;
    tenantId?: ID;
    attributes?: Record<string, unknown>;
  };
  /** Environment context */
  environment: {
    timestamp: Date;
    ipAddress?: string;
    userAgent?: string;
    tenantId?: ID;
    requestId?: ID;
  };
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  /** Final effect */
  effect: PolicyEffect;
  /** Whether access is permitted */
  permitted: boolean;
  /** Policies that were evaluated */
  evaluatedPolicies: EvaluatedPolicy[];
  /** Policy that determined the outcome */
  decidingPolicy?: EvaluatedPolicy;
  /** Reason for the decision */
  reason: string;
  /** Missing requirements (if denied) */
  missingRequirements?: {
    permissions?: string[];
    roles?: string[];
    trustTier?: TrustLevel;
  };
  /** Evaluation duration */
  durationMs: number;
  /** Evaluation timestamp */
  evaluatedAt: string;
}

/**
 * Individual policy evaluation
 */
export interface EvaluatedPolicy {
  /** Policy ID */
  policyId: ID;
  /** Policy name */
  policyName: string;
  /** Policy type */
  policyType: PolicyType;
  /** Evaluation effect */
  effect: PolicyEffect;
  /** Whether policy matched the target */
  matched: boolean;
  /** Evaluation reason */
  reason?: string;
  /** Evaluation duration */
  durationMs: number;
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const policyTargetSchema = z.object({
  subjectIds: z.array(z.string()).optional(),
  subjectTypes: z.array(z.enum(['user', 'agent', 'service'])).optional(),
  roleIds: z.array(z.string()).optional(),
  tenantIds: z.array(z.string()).optional(),
  excludeSubjectIds: z.array(z.string()).optional(),
});

export const policyConditionsSchema = z.object({
  ipAddresses: z.array(z.string()).optional(),
  timeWindow: z.object({
    startTime: z.string(),
    endTime: z.string(),
    daysOfWeek: z.array(z.number()),
    timezone: z.string(),
  }).optional(),
  attributes: z.record(z.unknown()).optional(),
  expression: z.string().optional(),
});

export const accessPolicySchema: z.ZodType<AccessPolicy> = z.lazy(() => z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.nativeEnum(PolicyTypes),
  priority: z.number().int().min(0),
  effect: z.nativeEnum(PolicyEffects),
  target: policyTargetSchema.optional(),
  conditions: policyConditionsSchema.optional(),
  requiredPermissions: z.array(z.string()).optional(),
  requiredRoles: z.array(z.string()).optional(),
  requiredTrustTier: z.number().int().min(0).max(7).optional() as z.ZodType<TrustLevel | undefined>,
  resourcePatterns: z.array(z.string()).optional(),
  timeRestrictions: z.array(z.object({
    startTime: z.string(),
    endTime: z.string(),
    daysOfWeek: z.array(z.number()),
    timezone: z.string(),
  })).optional(),
  childPolicies: z.array(z.lazy(() => accessPolicySchema)).optional(),
  combiningAlgorithm: z.nativeEnum(CombiningAlgorithms).optional(),
  enabled: z.boolean(),
  tenantId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})) as z.ZodType<AccessPolicy>;

// =============================================================================
// POLICY ENGINE
// =============================================================================

/**
 * RBAC Policy Engine options
 */
export interface PolicyEngineOptions {
  /** Default combining algorithm */
  defaultCombiningAlgorithm?: CombiningAlgorithm;
  /** Default effect when no policies match */
  defaultEffect?: PolicyEffect;
  /** Enable audit logging */
  enableAuditLogging?: boolean;
  /** Enable OpenTelemetry tracing */
  enableTracing?: boolean;
  /** Cache policy evaluations */
  enableCaching?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
}

/**
 * RBAC Policy Evaluation Engine
 *
 * Provides comprehensive policy evaluation for access control decisions.
 * Supports multiple policy types and combining algorithms.
 */
export class RBACPolicyEngine {
  private policies: Map<ID, AccessPolicy> = new Map();
  private roleRegistry: Map<string, RoleDefinition> = new Map();
  private permissionRegistry: Map<string, PermissionDefinition> = new Map();
  private roleAssignments: Map<ID, RoleAssignment[]> = new Map();
  private options: Required<PolicyEngineOptions>;
  private auditLogger: SecurityAuditLogger;
  private evaluationCache: Map<string, { result: PolicyEvaluationResult; expiresAt: number }> = new Map();

  constructor(options: PolicyEngineOptions = {}) {
    this.options = {
      defaultCombiningAlgorithm: options.defaultCombiningAlgorithm ?? CombiningAlgorithms.DENY_OVERRIDES,
      defaultEffect: options.defaultEffect ?? PolicyEffects.DENY,
      enableAuditLogging: options.enableAuditLogging ?? true,
      enableTracing: options.enableTracing ?? true,
      enableCaching: options.enableCaching ?? true,
      cacheTtlMs: options.cacheTtlMs ?? 60000, // 1 minute
    };

    this.auditLogger = getSecurityAuditLogger();

    // Initialize with built-in roles and permissions
    this.initializeBuiltins();

    logger.info({
      defaultCombiningAlgorithm: this.options.defaultCombiningAlgorithm,
      defaultEffect: this.options.defaultEffect,
    }, 'RBAC policy engine initialized');
  }

  /**
   * Initialize built-in roles and permissions
   */
  private initializeBuiltins(): void {
    // Register built-in roles
    for (const role of getBuiltinRoles()) {
      this.roleRegistry.set(role.id, role);
    }

    // Register built-in permissions
    for (const permission of getBuiltinPermissions()) {
      this.permissionRegistry.set(permission.id, permission);
    }

    logger.debug({
      roles: this.roleRegistry.size,
      permissions: this.permissionRegistry.size,
    }, 'Built-in roles and permissions initialized');
  }

  // ===========================================================================
  // POLICY EVALUATION
  // ===========================================================================

  /**
   * Evaluate access request against all applicable policies
   */
  async evaluate(context: PolicyEvaluationContext): Promise<PolicyEvaluationResult> {
    const startTime = performance.now();

    // Check cache
    if (this.options.enableCaching) {
      const cacheKey = this.buildCacheKey(context);
      const cached = this.evaluationCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        policyEvaluations.inc({ result: cached.result.effect, policy_type: 'cached' });
        return cached.result;
      }
    }

    const evaluatedPolicies: EvaluatedPolicy[] = [];
    const effects: { effect: PolicyEffect; policy: EvaluatedPolicy; priority: number }[] = [];

    // Get applicable policies sorted by priority
    const applicablePolicies = this.getApplicablePolicies(context);

    for (const policy of applicablePolicies) {
      const policyStartTime = performance.now();
      const evaluation = await this.evaluatePolicy(policy, context);
      const policyDuration = performance.now() - policyStartTime;

      const evaluatedPolicy: EvaluatedPolicy = {
        policyId: policy.id,
        policyName: policy.name,
        policyType: policy.type,
        effect: evaluation.effect,
        matched: evaluation.matched,
        reason: evaluation.reason,
        durationMs: policyDuration,
      };

      evaluatedPolicies.push(evaluatedPolicy);

      if (evaluation.matched && evaluation.effect !== PolicyEffects.NOT_APPLICABLE) {
        effects.push({
          effect: evaluation.effect,
          policy: evaluatedPolicy,
          priority: policy.priority,
        });
      }

      policyEvaluationDuration.observe({ policy_type: policy.type }, policyDuration / 1000);
    }

    // Combine effects using the configured algorithm
    const { effect, decidingPolicy } = this.combineEffects(
      effects,
      this.options.defaultCombiningAlgorithm
    );

    const finalEffect = effects.length === 0 ? this.options.defaultEffect : effect;
    const permitted = finalEffect === PolicyEffects.ALLOW;
    const durationMs = performance.now() - startTime;

    // Build missing requirements if denied
    const missingRequirements = !permitted
      ? this.getMissingRequirements(context, applicablePolicies)
      : undefined;

    const result: PolicyEvaluationResult = {
      effect: finalEffect,
      permitted,
      evaluatedPolicies,
      decidingPolicy,
      reason: this.buildDecisionReason(finalEffect, decidingPolicy, missingRequirements),
      missingRequirements,
      durationMs,
      evaluatedAt: new Date().toISOString(),
    };

    // Cache result
    if (this.options.enableCaching) {
      const cacheKey = this.buildCacheKey(context);
      this.evaluationCache.set(cacheKey, {
        result,
        expiresAt: Date.now() + this.options.cacheTtlMs,
      });
    }

    // Audit logging
    if (this.options.enableAuditLogging) {
      await this.logAccessDecision(context, result);
    }

    policyEvaluations.inc({ result: finalEffect, policy_type: 'evaluated' });

    logger.debug({
      subjectId: context.subject.id,
      resourceType: context.resource.type,
      action: context.resource.action,
      effect: finalEffect,
      permitted,
      policiesEvaluated: evaluatedPolicies.length,
      durationMs,
    }, 'Policy evaluation completed');

    return result;
  }

  /**
   * Evaluate with OpenTelemetry tracing
   */
  async evaluateWithTracing(context: PolicyEvaluationContext): Promise<PolicyEvaluationResult> {
    if (!this.options.enableTracing) {
      return this.evaluate(context);
    }

    return withSpan(
      'rbac.evaluatePolicy',
      async (span: TraceSpan) => {
        span.attributes['subject.id'] = context.subject.id;
        span.attributes['subject.type'] = context.subject.type;
        span.attributes['resource.type'] = context.resource.type;
        span.attributes['resource.action'] = context.resource.action;

        const result = await this.evaluate(context);

        span.attributes['result.effect'] = result.effect;
        span.attributes['result.permitted'] = result.permitted;
        span.attributes['result.policiesEvaluated'] = result.evaluatedPolicies.length;
        span.attributes['result.durationMs'] = result.durationMs;

        return result;
      },
      { 'tenant.id': context.environment.tenantId }
    );
  }

  /**
   * Evaluate a single policy
   */
  private async evaluatePolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): Promise<{ effect: PolicyEffect; matched: boolean; reason?: string }> {
    // Check if policy targets this subject
    if (!this.policyTargetsSubject(policy, context)) {
      return { effect: PolicyEffects.NOT_APPLICABLE, matched: false, reason: 'Target mismatch' };
    }

    // Check conditions
    if (policy.conditions && !this.checkConditions(policy.conditions, context)) {
      return { effect: PolicyEffects.NOT_APPLICABLE, matched: false, reason: 'Conditions not met' };
    }

    // Check time restrictions
    if (policy.timeRestrictions && !this.checkTimeRestrictions(policy.timeRestrictions, context.environment.timestamp)) {
      return { effect: PolicyEffects.NOT_APPLICABLE, matched: false, reason: 'Outside time window' };
    }

    // Evaluate based on policy type
    switch (policy.type) {
      case PolicyTypes.ROLE_BASED:
        return this.evaluateRoleBasedPolicy(policy, context);

      case PolicyTypes.RESOURCE_BASED:
        return this.evaluateResourceBasedPolicy(policy, context);

      case PolicyTypes.TRUST_BASED:
        return this.evaluateTrustBasedPolicy(policy, context);

      case PolicyTypes.TIME_BASED:
        return this.evaluateTimeBasedPolicy(policy, context);

      case PolicyTypes.CONDITIONAL:
        return this.evaluateConditionalPolicy(policy, context);

      case PolicyTypes.COMPOSITE:
        return this.evaluateCompositePolicy(policy, context);

      default:
        return { effect: PolicyEffects.INDETERMINATE, matched: false, reason: 'Unknown policy type' };
    }
  }

  /**
   * Evaluate role-based policy
   */
  private evaluateRoleBasedPolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): { effect: PolicyEffect; matched: boolean; reason?: string } {
    // Check required roles
    if (policy.requiredRoles && policy.requiredRoles.length > 0) {
      const hasRequiredRole = policy.requiredRoles.some(role =>
        context.subject.roles.includes(role)
      );

      if (!hasRequiredRole) {
        return {
          effect: PolicyEffects.DENY,
          matched: true,
          reason: `Missing required role: ${policy.requiredRoles.join(' or ')}`,
        };
      }
    }

    // Check required permissions
    if (policy.requiredPermissions && policy.requiredPermissions.length > 0) {
      const hasAllRequired = hasAllPermissions(
        context.subject.permissions,
        policy.requiredPermissions
      );

      if (!hasAllRequired) {
        return {
          effect: PolicyEffects.DENY,
          matched: true,
          reason: 'Missing required permissions',
        };
      }
    }

    return { effect: policy.effect, matched: true };
  }

  /**
   * Evaluate resource-based policy
   */
  private evaluateResourceBasedPolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): { effect: PolicyEffect; matched: boolean; reason?: string } {
    // Check resource patterns
    if (policy.resourcePatterns && policy.resourcePatterns.length > 0) {
      const resourceKey = `${context.resource.type}:${context.resource.action}`;
      const matches = policy.resourcePatterns.some(pattern =>
        this.matchPattern(resourceKey, pattern)
      );

      if (!matches) {
        return {
          effect: PolicyEffects.NOT_APPLICABLE,
          matched: false,
          reason: 'Resource pattern mismatch',
        };
      }
    }

    // Check if subject has permission for this resource action
    const requiredPermission = `${context.resource.type}:${context.resource.action}`;
    if (!hasPermission(context.subject.permissions, requiredPermission)) {
      return {
        effect: PolicyEffects.DENY,
        matched: true,
        reason: `Missing permission: ${requiredPermission}`,
      };
    }

    return { effect: policy.effect, matched: true };
  }

  /**
   * Evaluate trust-based policy
   */
  private evaluateTrustBasedPolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): { effect: PolicyEffect; matched: boolean; reason?: string } {
    if (policy.requiredTrustTier !== undefined) {
      if (context.subject.trustTier < policy.requiredTrustTier) {
        return {
          effect: PolicyEffects.DENY,
          matched: true,
          reason: `Insufficient trust tier: requires T${policy.requiredTrustTier}, has T${context.subject.trustTier}`,
        };
      }
    }

    return { effect: policy.effect, matched: true };
  }

  /**
   * Evaluate time-based policy
   */
  private evaluateTimeBasedPolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): { effect: PolicyEffect; matched: boolean; reason?: string } {
    if (policy.timeRestrictions && policy.timeRestrictions.length > 0) {
      const withinWindow = this.checkTimeRestrictions(
        policy.timeRestrictions,
        context.environment.timestamp
      );

      if (!withinWindow) {
        return {
          effect: PolicyEffects.DENY,
          matched: true,
          reason: 'Access outside allowed time window',
        };
      }
    }

    return { effect: policy.effect, matched: true };
  }

  /**
   * Evaluate conditional policy
   */
  private evaluateConditionalPolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): { effect: PolicyEffect; matched: boolean; reason?: string } {
    if (!policy.conditions) {
      return { effect: policy.effect, matched: true };
    }

    const conditionsMet = this.checkConditions(policy.conditions, context);
    if (!conditionsMet) {
      return {
        effect: PolicyEffects.DENY,
        matched: true,
        reason: 'Policy conditions not met',
      };
    }

    return { effect: policy.effect, matched: true };
  }

  /**
   * Evaluate composite policy (with child policies)
   */
  private async evaluateCompositePolicy(
    policy: AccessPolicy,
    context: PolicyEvaluationContext
  ): Promise<{ effect: PolicyEffect; matched: boolean; reason?: string }> {
    if (!policy.childPolicies || policy.childPolicies.length === 0) {
      return { effect: policy.effect, matched: true };
    }

    const childEffects: { effect: PolicyEffect; policy: AccessPolicy; priority: number }[] = [];

    for (const childPolicy of policy.childPolicies) {
      if (!childPolicy.enabled) continue;

      const evaluation = await this.evaluatePolicy(childPolicy, context);
      if (evaluation.matched) {
        childEffects.push({
          effect: evaluation.effect,
          policy: childPolicy,
          priority: childPolicy.priority,
        });
      }
    }

    const algorithm = policy.combiningAlgorithm ?? this.options.defaultCombiningAlgorithm;
    const { effect } = this.combineEffects(
      childEffects.map(e => ({
        effect: e.effect,
        policy: {
          policyId: e.policy.id,
          policyName: e.policy.name,
          policyType: e.policy.type,
          effect: e.effect,
          matched: true,
          durationMs: 0,
        },
        priority: e.priority,
      })),
      algorithm
    );

    return { effect, matched: true };
  }

  // ===========================================================================
  // PERMISSION CHECKING
  // ===========================================================================

  /**
   * Check if a subject has specific permissions
   */
  async checkPermissions(request: PermissionCheckRequest): Promise<PermissionCheckResult> {
    const startTime = performance.now();
    const grantedPermissions: string[] = [];
    const deniedPermissions: string[] = [];

    // Get subject's effective permissions from roles
    const subjectPermissions = await this.getSubjectPermissions(
      request.subjectId,
      request.tenantId
    );

    for (const required of request.permissions) {
      if (hasPermission(subjectPermissions, required)) {
        grantedPermissions.push(required);
      } else {
        deniedPermissions.push(required);
      }
    }

    const granted = deniedPermissions.length === 0;
    const result: PermissionCheckResult = {
      granted,
      grantedPermissions,
      deniedPermissions,
      reason: granted
        ? undefined
        : `Missing permissions: ${deniedPermissions.join(', ')}`,
      grantSource: granted ? this.determineGrantSource(subjectPermissions, grantedPermissions) : undefined,
      evaluatedAt: new Date().toISOString(),
    };

    permissionChecks.inc({
      result: granted ? 'granted' : 'denied',
      resource_type: request.resourceType ?? 'unknown',
    });

    logger.debug({
      subjectId: request.subjectId,
      permissions: request.permissions,
      granted,
      durationMs: performance.now() - startTime,
    }, 'Permission check completed');

    return result;
  }

  /**
   * Get all effective permissions for a subject
   */
  async getSubjectPermissions(subjectId: ID, tenantId?: ID): Promise<Set<string>> {
    const permissions = new Set<string>();

    // Get role assignments for subject
    const assignments = this.roleAssignments.get(subjectId) ?? [];

    for (const assignment of assignments) {
      if (!assignment.active) continue;
      if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date()) continue;
      if (tenantId && assignment.tenantId && assignment.tenantId !== tenantId) continue;

      const role = this.roleRegistry.get(assignment.roleId);
      if (!role || !role.enabled) continue;

      // Get effective permissions for role (including inherited)
      const rolePermissions = getEffectivePermissions(role, this.roleRegistry);
      for (const perm of rolePermissions) {
        permissions.add(perm);
      }
    }

    return permissions;
  }

  /**
   * Get all roles assigned to a subject
   */
  async getSubjectRoles(subjectId: ID, tenantId?: ID): Promise<RoleDefinition[]> {
    const roles: RoleDefinition[] = [];
    const assignments = this.roleAssignments.get(subjectId) ?? [];

    for (const assignment of assignments) {
      if (!assignment.active) continue;
      if (assignment.expiresAt && new Date(assignment.expiresAt) < new Date()) continue;
      if (tenantId && assignment.tenantId && assignment.tenantId !== tenantId) continue;

      const role = this.roleRegistry.get(assignment.roleId);
      if (role && role.enabled) {
        roles.push(role);
      }
    }

    return roles;
  }

  // ===========================================================================
  // POLICY MANAGEMENT
  // ===========================================================================

  /**
   * Add an access policy
   */
  addPolicy(policy: AccessPolicy): void {
    accessPolicySchema.parse(policy);
    this.policies.set(policy.id, policy);
    this.clearCache();

    logger.info({ policyId: policy.id, policyName: policy.name }, 'Policy added');
  }

  /**
   * Update an access policy
   */
  updatePolicy(policyId: ID, updates: Partial<AccessPolicy>): void {
    const existing = this.policies.get(policyId);
    if (!existing) {
      throw new Error(`Policy not found: ${policyId}`);
    }

    const updated: AccessPolicy = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    accessPolicySchema.parse(updated);
    this.policies.set(policyId, updated);
    this.clearCache();

    logger.info({ policyId }, 'Policy updated');
  }

  /**
   * Remove an access policy
   */
  removePolicy(policyId: ID): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) {
      this.clearCache();
      logger.info({ policyId }, 'Policy removed');
    }
    return removed;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(policyId: ID): AccessPolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Get all policies
   */
  getAllPolicies(): AccessPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get enabled policies
   */
  getEnabledPolicies(): AccessPolicy[] {
    return Array.from(this.policies.values()).filter(p => p.enabled);
  }

  // ===========================================================================
  // ROLE MANAGEMENT
  // ===========================================================================

  /**
   * Add a custom role
   */
  addRole(role: RoleDefinition): void {
    if (role.isSystemRole) {
      throw new Error('Cannot add system role');
    }
    this.roleRegistry.set(role.id, role);
    this.clearCache();

    logger.info({ roleId: role.id, roleName: role.name }, 'Role added');
  }

  /**
   * Update a custom role
   */
  updateRole(roleId: string, updates: Partial<RoleDefinition>): void {
    const existing = this.roleRegistry.get(roleId);
    if (!existing) {
      throw new Error(`Role not found: ${roleId}`);
    }
    if (existing.isSystemRole) {
      throw new Error('Cannot modify system role');
    }

    const updated: RoleDefinition = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.roleRegistry.set(roleId, updated);
    this.clearCache();

    logger.info({ roleId }, 'Role updated');
  }

  /**
   * Remove a custom role
   */
  removeRole(roleId: string): boolean {
    const existing = this.roleRegistry.get(roleId);
    if (existing?.isSystemRole) {
      throw new Error('Cannot remove system role');
    }

    const removed = this.roleRegistry.delete(roleId);
    if (removed) {
      this.clearCache();
      logger.info({ roleId }, 'Role removed');
    }
    return removed;
  }

  /**
   * Get a role by ID
   */
  getRole(roleId: string): RoleDefinition | undefined {
    return this.roleRegistry.get(roleId);
  }

  /**
   * Get all roles
   */
  getAllRoles(): RoleDefinition[] {
    return Array.from(this.roleRegistry.values());
  }

  // ===========================================================================
  // ROLE ASSIGNMENT
  // ===========================================================================

  /**
   * Assign a role to a subject
   */
  assignRole(assignment: RoleAssignment): void {
    const role = this.roleRegistry.get(assignment.roleId);
    if (!role) {
      throw new Error(`Role not found: ${assignment.roleId}`);
    }

    const assignments = this.roleAssignments.get(assignment.subjectId) ?? [];
    assignments.push(assignment);
    this.roleAssignments.set(assignment.subjectId, assignments);
    this.clearCache();

    logger.info({
      subjectId: assignment.subjectId,
      roleId: assignment.roleId,
    }, 'Role assigned');
  }

  /**
   * Revoke a role from a subject
   */
  revokeRole(subjectId: ID, roleId: string, tenantId?: ID): boolean {
    const assignments = this.roleAssignments.get(subjectId);
    if (!assignments) return false;

    const index = assignments.findIndex(a =>
      a.roleId === roleId &&
      (!tenantId || a.tenantId === tenantId)
    );

    if (index === -1) return false;

    assignments[index]!.active = false;
    this.clearCache();

    logger.info({ subjectId, roleId }, 'Role revoked');
    return true;
  }

  /**
   * Get role assignments for a subject
   */
  getRoleAssignments(subjectId: ID): RoleAssignment[] {
    return this.roleAssignments.get(subjectId) ?? [];
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Get applicable policies for a context
   */
  private getApplicablePolicies(context: PolicyEvaluationContext): AccessPolicy[] {
    return Array.from(this.policies.values())
      .filter(policy => {
        if (!policy.enabled) return false;

        // Check tenant scope
        if (policy.tenantId && policy.tenantId !== context.environment.tenantId) {
          return false;
        }

        return true;
      })
      .sort((a, b) => b.priority - a.priority); // Higher priority first
  }

  /**
   * Check if a policy targets the subject
   */
  private policyTargetsSubject(policy: AccessPolicy, context: PolicyEvaluationContext): boolean {
    if (!policy.target) return true;

    const target = policy.target;

    // Check exclusions first
    if (target.excludeSubjectIds?.includes(context.subject.id)) {
      return false;
    }

    // Check subject ID
    if (target.subjectIds && !target.subjectIds.includes(context.subject.id)) {
      return false;
    }

    // Check subject type
    if (target.subjectTypes && !target.subjectTypes.includes(context.subject.type)) {
      return false;
    }

    // Check role
    if (target.roleIds) {
      const hasRole = target.roleIds.some(roleId =>
        context.subject.roles.includes(roleId)
      );
      if (!hasRole) return false;
    }

    // Check tenant
    if (target.tenantIds && context.environment.tenantId) {
      if (!target.tenantIds.includes(context.environment.tenantId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check policy conditions
   */
  private checkConditions(conditions: PolicyConditions, context: PolicyEvaluationContext): boolean {
    // Check IP address
    if (conditions.ipAddresses && context.environment.ipAddress) {
      const matchesIp = conditions.ipAddresses.some(allowed =>
        this.matchIpAddress(context.environment.ipAddress!, allowed)
      );
      if (!matchesIp) return false;
    }

    // Check time window
    if (conditions.timeWindow) {
      const withinWindow = this.checkTimeRestriction(
        conditions.timeWindow,
        context.environment.timestamp
      );
      if (!withinWindow) return false;
    }

    // Check custom attributes
    if (conditions.attributes) {
      for (const [key, value] of Object.entries(conditions.attributes)) {
        const subjectValue = context.subject.attributes?.[key];
        if (subjectValue !== value) return false;
      }
    }

    return true;
  }

  /**
   * Check time restrictions
   */
  private checkTimeRestrictions(restrictions: TimeRestriction[], now: Date): boolean {
    return restrictions.some(restriction => this.checkTimeRestriction(restriction, now));
  }

  /**
   * Check a single time restriction
   */
  private checkTimeRestriction(restriction: TimeRestriction, now: Date): boolean {
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentTime = hour * 60 + minute;

    const [startHour, startMinute] = restriction.startTime.split(':').map(Number);
    const [endHour, endMinute] = restriction.endTime.split(':').map(Number);
    const startTime = startHour! * 60 + startMinute!;
    const endTime = endHour! * 60 + endMinute!;

    // Check time range
    let withinTime: boolean;
    if (startTime <= endTime) {
      withinTime = currentTime >= startTime && currentTime <= endTime;
    } else {
      // Wrapping (e.g., 22:00 to 06:00)
      withinTime = currentTime >= startTime || currentTime <= endTime;
    }

    if (!withinTime) return false;

    // Check day of week
    if (restriction.daysOfWeek.length > 0) {
      const day = now.getDay();
      if (!restriction.daysOfWeek.includes(day)) return false;
    }

    return true;
  }

  /**
   * Combine policy effects using the specified algorithm
   */
  private combineEffects(
    effects: { effect: PolicyEffect; policy: EvaluatedPolicy; priority: number }[],
    algorithm: CombiningAlgorithm
  ): { effect: PolicyEffect; decidingPolicy?: EvaluatedPolicy } {
    if (effects.length === 0) {
      return { effect: this.options.defaultEffect };
    }

    switch (algorithm) {
      case CombiningAlgorithms.DENY_OVERRIDES: {
        const deny = effects.find(e => e.effect === PolicyEffects.DENY);
        if (deny) return { effect: PolicyEffects.DENY, decidingPolicy: deny.policy };
        const allow = effects.find(e => e.effect === PolicyEffects.ALLOW);
        if (allow) return { effect: PolicyEffects.ALLOW, decidingPolicy: allow.policy };
        return { effect: PolicyEffects.INDETERMINATE };
      }

      case CombiningAlgorithms.PERMIT_OVERRIDES: {
        const allow = effects.find(e => e.effect === PolicyEffects.ALLOW);
        if (allow) return { effect: PolicyEffects.ALLOW, decidingPolicy: allow.policy };
        const deny = effects.find(e => e.effect === PolicyEffects.DENY);
        if (deny) return { effect: PolicyEffects.DENY, decidingPolicy: deny.policy };
        return { effect: PolicyEffects.INDETERMINATE };
      }

      case CombiningAlgorithms.UNANIMOUS: {
        const allAllow = effects.every(e => e.effect === PolicyEffects.ALLOW);
        if (allAllow) return { effect: PolicyEffects.ALLOW, decidingPolicy: effects[0]?.policy };
        const anyDeny = effects.find(e => e.effect === PolicyEffects.DENY);
        return { effect: PolicyEffects.DENY, decidingPolicy: anyDeny?.policy };
      }

      case CombiningAlgorithms.FIRST_APPLICABLE: {
        const first = effects[0];
        if (first) return { effect: first.effect, decidingPolicy: first.policy };
        return { effect: PolicyEffects.INDETERMINATE };
      }

      case CombiningAlgorithms.PRIORITY_BASED: {
        // Sort by priority (highest first) and take first
        const sorted = [...effects].sort((a, b) => b.priority - a.priority);
        const highest = sorted[0];
        if (highest) return { effect: highest.effect, decidingPolicy: highest.policy };
        return { effect: PolicyEffects.INDETERMINATE };
      }

      default:
        return { effect: this.options.defaultEffect };
    }
  }

  /**
   * Match a pattern (supports wildcards)
   */
  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    if (pattern.startsWith('*')) {
      return value.endsWith(pattern.slice(1));
    }
    return value === pattern;
  }

  /**
   * Match IP address (supports CIDR notation)
   */
  private matchIpAddress(ip: string, pattern: string): boolean {
    // Simple exact match for now
    // TODO: Add CIDR notation support
    if (pattern === '*') return true;
    return ip === pattern;
  }

  /**
   * Get missing requirements for a denied request
   */
  private getMissingRequirements(
    context: PolicyEvaluationContext,
    policies: AccessPolicy[]
  ): PolicyEvaluationResult['missingRequirements'] {
    const missingPermissions: string[] = [];
    const missingRoles: string[] = [];
    let requiredTrustTier: TrustLevel | undefined;

    for (const policy of policies) {
      if (policy.requiredPermissions) {
        for (const perm of policy.requiredPermissions) {
          if (!hasPermission(context.subject.permissions, perm)) {
            missingPermissions.push(perm);
          }
        }
      }

      if (policy.requiredRoles) {
        for (const role of policy.requiredRoles) {
          if (!context.subject.roles.includes(role)) {
            missingRoles.push(role);
          }
        }
      }

      if (policy.requiredTrustTier !== undefined) {
        if (context.subject.trustTier < policy.requiredTrustTier) {
          if (!requiredTrustTier || policy.requiredTrustTier > requiredTrustTier) {
            requiredTrustTier = policy.requiredTrustTier;
          }
        }
      }
    }

    return {
      permissions: missingPermissions.length > 0 ? [...new Set(missingPermissions)] : undefined,
      roles: missingRoles.length > 0 ? [...new Set(missingRoles)] : undefined,
      trustTier: requiredTrustTier,
    };
  }

  /**
   * Build decision reason string
   */
  private buildDecisionReason(
    effect: PolicyEffect,
    decidingPolicy?: EvaluatedPolicy,
    missingRequirements?: PolicyEvaluationResult['missingRequirements']
  ): string {
    if (effect === PolicyEffects.ALLOW) {
      return decidingPolicy
        ? `Access granted by policy: ${decidingPolicy.policyName}`
        : 'Access granted (default)';
    }

    if (effect === PolicyEffects.DENY) {
      const reasons: string[] = [];

      if (decidingPolicy?.reason) {
        reasons.push(decidingPolicy.reason);
      } else if (decidingPolicy) {
        reasons.push(`Denied by policy: ${decidingPolicy.policyName}`);
      }

      if (missingRequirements?.permissions?.length) {
        reasons.push(`Missing permissions: ${missingRequirements.permissions.join(', ')}`);
      }

      if (missingRequirements?.roles?.length) {
        reasons.push(`Missing roles: ${missingRequirements.roles.join(', ')}`);
      }

      if (missingRequirements?.trustTier !== undefined) {
        reasons.push(`Insufficient trust tier: requires T${missingRequirements.trustTier}`);
      }

      return reasons.length > 0 ? reasons.join('; ') : 'Access denied';
    }

    return 'Unable to determine access';
  }

  /**
   * Determine how permission was granted
   */
  private determineGrantSource(
    permissions: Set<string>,
    grantedPermissions: string[]
  ): 'role' | 'direct' | 'inherited' | 'wildcard' {
    if (permissions.has('*')) {
      return 'wildcard';
    }

    // Check if any are direct matches vs wildcards
    for (const perm of grantedPermissions) {
      if (permissions.has(perm)) {
        return 'direct';
      }
    }

    return 'inherited';
  }

  /**
   * Build cache key for evaluation context
   */
  private buildCacheKey(context: PolicyEvaluationContext): string {
    return [
      context.subject.id,
      context.subject.type,
      context.resource.type,
      context.resource.action,
      context.resource.id ?? '',
      context.environment.tenantId ?? '',
    ].join(':');
  }

  /**
   * Clear evaluation cache
   */
  private clearCache(): void {
    this.evaluationCache.clear();
  }

  /**
   * Log access decision for audit
   */
  private async logAccessDecision(
    context: PolicyEvaluationContext,
    result: PolicyEvaluationResult
  ): Promise<void> {
    const actor: SecurityActor = {
      type: context.subject.type === 'user' ? 'user' : 'agent',
      id: context.subject.id,
      tenantId: context.environment.tenantId,
      ip: context.environment.ipAddress,
    };

    const resource: SecurityResource = {
      type: context.resource.type,
      id: context.resource.id ?? context.resource.type,
      path: `${context.resource.type}:${context.resource.action}`,
    };

    if (result.permitted) {
      await this.auditLogger.logAccessGranted(actor, resource, {
        effect: result.effect,
        decidingPolicy: result.decidingPolicy?.policyId,
        durationMs: result.durationMs,
      });
    } else {
      await this.auditLogger.logAccessDenied(actor, resource, result.reason, {
        effect: result.effect,
        decidingPolicy: result.decidingPolicy?.policyId,
        missingRequirements: result.missingRequirements,
        durationMs: result.durationMs,
      });
    }
  }

  /**
   * Get engine statistics
   */
  getStats(): {
    totalPolicies: number;
    enabledPolicies: number;
    totalRoles: number;
    systemRoles: number;
    customRoles: number;
    totalAssignments: number;
    cacheSize: number;
  } {
    const roles = Array.from(this.roleRegistry.values());
    let totalAssignments = 0;
    for (const assignments of this.roleAssignments.values()) {
      totalAssignments += assignments.length;
    }

    return {
      totalPolicies: this.policies.size,
      enabledPolicies: Array.from(this.policies.values()).filter(p => p.enabled).length,
      totalRoles: roles.length,
      systemRoles: roles.filter(r => r.isSystemRole).length,
      customRoles: roles.filter(r => !r.isSystemRole).length,
      totalAssignments,
      cacheSize: this.evaluationCache.size,
    };
  }

  /**
   * Destroy the engine and cleanup resources
   */
  destroy(): void {
    this.clearCache();
    logger.info('RBAC policy engine destroyed');
  }
}

/**
 * Create a new RBAC policy engine
 */
export function createRBACPolicyEngine(options?: PolicyEngineOptions): RBACPolicyEngine {
  return new RBACPolicyEngine(options);
}

/**
 * Create a policy evaluation context
 */
export function createPolicyEvaluationContext(params: {
  subjectId: ID;
  subjectType: 'user' | 'agent' | 'service';
  trustTier: TrustLevel;
  roles: string[];
  permissions: string[];
  resourceType: string;
  resourceAction: string;
  resourceId?: ID;
  tenantId?: ID;
  ipAddress?: string;
  userAgent?: string;
  requestId?: ID;
  subjectAttributes?: Record<string, unknown>;
  resourceAttributes?: Record<string, unknown>;
}): PolicyEvaluationContext {
  return {
    subject: {
      id: params.subjectId,
      type: params.subjectType,
      trustTier: params.trustTier,
      roles: params.roles,
      permissions: new Set(params.permissions),
      attributes: params.subjectAttributes,
    },
    resource: {
      id: params.resourceId,
      type: params.resourceType,
      action: params.resourceAction,
      tenantId: params.tenantId,
      attributes: params.resourceAttributes,
    },
    environment: {
      timestamp: new Date(),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      tenantId: params.tenantId,
      requestId: params.requestId,
    },
  };
}

/**
 * Create an access policy
 */
export function createAccessPolicy(
  partial: Omit<AccessPolicy, 'createdAt' | 'updatedAt' | 'enabled'> &
    Partial<Pick<AccessPolicy, 'enabled'>>
): AccessPolicy {
  const now = new Date().toISOString();
  return {
    ...partial,
    enabled: partial.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}
