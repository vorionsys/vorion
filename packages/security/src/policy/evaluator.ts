/**
 * Policy Evaluator
 *
 * Evaluates policies against intents to determine control actions.
 * Includes result caching with 5-minute TTL for performance optimization.
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../common/logger.js';
import type { ControlAction, TrustLevel } from '../common/types.js';
import {
  policyEvaluationsTotal,
  policyEvaluationDurationSeconds,
  rulesEvaluatedPerRequest,
  policyCacheOperationsTotal,
  recordPolicyEvaluationMetric,
} from '../common/metrics.js';
import type {
  Policy,
  PolicyRule,
  PolicyCondition,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  MultiPolicyEvaluationResult,
  RuleEvaluationResult,
  FieldCondition,
  CompoundCondition,
  TrustCondition,
  TimeCondition,
} from './types.js';

const logger = createLogger({ component: 'policy-evaluator' });

// =============================================================================
// Policy Evaluation Cache
// =============================================================================

/**
 * Cache entry for policy evaluation results
 */
interface PolicyEvaluationCacheEntry {
  result: MultiPolicyEvaluationResult;
  expiresAt: number;
  policyVersions: Map<string, number>; // policyId -> version for invalidation
}

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum cache entries before LRU eviction
 */
const MAX_CACHE_ENTRIES = 5000;

/**
 * Cache metrics for monitoring
 */
export interface PolicyCacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
  size: number;
  hitRate: number;
}

/**
 * LRU Cache for policy evaluation results
 */
class PolicyEvaluationCache {
  private cache: Map<string, PolicyEvaluationCacheEntry> = new Map();
  private accessOrder: string[] = []; // For LRU tracking
  private metrics = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
    this.cleanupInterval.unref();
  }

  /**
   * Generate a cache key from policy IDs and context
   */
  generateKey(policies: Policy[], context: PolicyEvaluationContext): string {
    // Include policy IDs and versions in the key
    const policyKey = policies
      .map((p) => `${p.id}:${p.version}`)
      .sort()
      .join(',');

    // Hash relevant context fields (exclude timestamps which change)
    const contextHash = this.hashContext(context);

    return `${policyKey}:${contextHash}`;
  }

  /**
   * Hash the evaluation context for cache key generation
   */
  private hashContext(context: PolicyEvaluationContext): string {
    // Include only fields that affect evaluation results
    const relevant = {
      intentId: context.intent.id,
      intentType: context.intent.intentType,
      entityId: context.entity.id,
      entityType: context.entity.type,
      trustScore: context.entity.trustScore,
      trustLevel: context.entity.trustLevel,
      // Include custom fields if present
      custom: context.custom,
    };

    const hash = createHash('sha256');
    hash.update(JSON.stringify(relevant));
    return hash.digest('hex').substring(0, 16); // Use first 16 chars
  }

  /**
   * Get a cached evaluation result
   */
  get(key: string): MultiPolicyEvaluationResult | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.metrics.misses++;
      return null;
    }

    // Update access order for LRU
    this.updateAccessOrder(key);
    this.metrics.hits++;

    return entry.result;
  }

  /**
   * Set a cached evaluation result
   */
  set(
    key: string,
    result: MultiPolicyEvaluationResult,
    policies: Policy[]
  ): void {
    // Evict if at capacity
    if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
      this.evictLru();
    }

    // Build policy version map for invalidation
    const policyVersions = new Map<string, number>();
    for (const policy of policies) {
      policyVersions.set(policy.id, policy.version);
    }

    this.cache.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
      policyVersions,
    });

    this.updateAccessOrder(key);
  }

  /**
   * Invalidate cache entries for a specific policy
   * Called when a policy is updated
   */
  invalidatePolicy(policyId: string): number {
    let invalidated = 0;
    const keysToDelete: string[] = [];
    const entries = Array.from(this.cache.entries());

    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i]!;
      if (entry.policyVersions.has(policyId)) {
        keysToDelete.push(key);
        invalidated++;
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
    }

    if (invalidated > 0) {
      this.metrics.invalidations += invalidated;
      logger.debug({ policyId, invalidatedCount: invalidated }, 'Invalidated policy cache entries');
    }

    return invalidated;
  }

  /**
   * Evict least recently used entry
   */
  private evictLru(): void {
    if (this.accessOrder.length === 0) return;

    const oldestKey = this.accessOrder.shift()!;
    this.cache.delete(oldestKey);
    this.metrics.evictions++;
  }

  /**
   * Update access order for LRU tracking
   */
  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  /**
   * Remove key from access order
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    const entries = Array.from(this.cache.entries());

    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i]!;
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
    }

    if (keysToDelete.length > 0) {
      logger.debug({ expiredCount: keysToDelete.length }, 'Cleaned up expired cache entries');
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): PolicyCacheMetrics {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      ...this.metrics,
      size: this.cache.size,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    logger.debug('Policy evaluation cache cleared');
  }

  /**
   * Stop the cache cleanup timer
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

// Singleton cache instance
let evaluationCache: PolicyEvaluationCache | null = null;

/**
 * Get the singleton policy evaluation cache
 */
function getEvaluationCache(): PolicyEvaluationCache {
  if (!evaluationCache) {
    evaluationCache = new PolicyEvaluationCache();
  }
  return evaluationCache;
}

/**
 * Invalidate policy cache entries when a policy is updated.
 * Call this from policy update/delete operations.
 */
export function invalidatePolicyCache(policyId: string): number {
  if (!evaluationCache) return 0;
  return evaluationCache.invalidatePolicy(policyId);
}

/**
 * Get policy evaluation cache metrics
 */
export function getPolicyCacheMetrics(): PolicyCacheMetrics | null {
  if (!evaluationCache) return null;
  return evaluationCache.getMetrics();
}

/**
 * Clear the entire policy evaluation cache
 */
export function clearPolicyCache(): void {
  if (evaluationCache) {
    evaluationCache.clear();
  }
}

/**
 * Stop and clean up the policy cache (for shutdown)
 */
export function stopPolicyCache(): void {
  if (evaluationCache) {
    evaluationCache.stop();
    evaluationCache = null;
  }
}

/**
 * Action priority (lower number = higher priority)
 */
const ACTION_PRIORITY: Record<ControlAction, number> = {
  deny: 0,
  terminate: 1,
  escalate: 2,
  limit: 3,
  monitor: 4,
  allow: 5,
};

/**
 * Policy Evaluator class
 * Includes result caching for improved performance
 */
export class PolicyEvaluator {
  private readonly enableCache: boolean;

  constructor(options: { enableCache?: boolean } = {}) {
    this.enableCache = options.enableCache ?? true;
  }

  /**
   * Evaluate multiple policies against a context
   * Uses caching to avoid redundant evaluations
   */
  async evaluateMultiple(
    policies: Policy[],
    context: PolicyEvaluationContext
  ): Promise<MultiPolicyEvaluationResult> {
    // Check cache first (if enabled)
    if (this.enableCache && policies.length > 0) {
      const cache = getEvaluationCache();
      const cacheKey = cache.generateKey(policies, context);
      const cached = cache.get(cacheKey);

      if (cached) {
        // Record cache hit metric
        policyCacheOperationsTotal.inc({
          operation: 'hit',
          tenant_id: context.intent.tenantId ?? 'unknown',
        });
        logger.debug(
          {
            intentId: context.intent.id,
            policiesCount: policies.length,
            cacheHit: true,
          },
          'Policy evaluation cache hit'
        );
        return cached;
      }
      // Record cache miss metric
      policyCacheOperationsTotal.inc({
        operation: 'miss',
        tenant_id: context.intent.tenantId ?? 'unknown',
      });
    }

    const startTime = performance.now();
    const policiesEvaluated: PolicyEvaluationResult[] = [];
    let appliedPolicy: PolicyEvaluationResult | undefined;
    let finalAction: ControlAction = 'allow';
    let reason: string | undefined;

    // Filter policies that apply to this context
    const applicablePolicies = policies.filter((policy) =>
      this.policyApplies(policy, context)
    );

    logger.debug(
      {
        totalPolicies: policies.length,
        applicablePolicies: applicablePolicies.length,
        intentId: context.intent.id,
      },
      'Evaluating applicable policies'
    );

    // Evaluate each applicable policy
    for (const policy of applicablePolicies) {
      const result = await this.evaluatePolicy(policy, context);
      policiesEvaluated.push(result);

      // Apply the most restrictive action
      if (ACTION_PRIORITY[result.action] < ACTION_PRIORITY[finalAction]) {
        finalAction = result.action;
        reason = result.reason;
        appliedPolicy = result;

        // Short-circuit on deny
        if (finalAction === 'deny') {
          logger.info(
            {
              policyId: policy.id,
              policyName: policy.name,
              intentId: context.intent.id,
              action: finalAction,
            },
            'Policy denied intent - short-circuiting'
          );
          break;
        }
      }
    }

    const totalDurationMs = performance.now() - startTime;

    // Record policy evaluation metrics
    const tenantId = context.intent.tenantId ?? 'unknown';
    const namespace = applicablePolicies[0]?.namespace ?? 'default';
    const durationSeconds = totalDurationMs / 1000;

    // Map finalAction to result for metrics
    const evalResult = finalAction === 'allow' ? 'allow' :
                       finalAction === 'deny' ? 'deny' :
                       finalAction === 'escalate' ? 'escalate' : 'deny';

    policyEvaluationsTotal.inc({
      result: evalResult,
      tenant_id: tenantId,
      namespace,
      policy_name: appliedPolicy?.policyName ?? 'none',
    });
    policyEvaluationDurationSeconds.observe({ tenant_id: tenantId, namespace }, durationSeconds);
    rulesEvaluatedPerRequest.observe(
      { tenant_id: tenantId, namespace },
      policiesEvaluated.reduce((sum, p) => sum + p.rulesEvaluated.length, 0)
    );

    logger.info(
      {
        intentId: context.intent.id,
        policiesEvaluated: policiesEvaluated.length,
        finalAction,
        durationMs: totalDurationMs,
        cacheHit: false,
      },
      'Multi-policy evaluation completed'
    );

    const result: MultiPolicyEvaluationResult = {
      passed: finalAction === 'allow',
      finalAction,
      reason,
      policiesEvaluated,
      appliedPolicy,
      totalDurationMs,
      evaluatedAt: new Date().toISOString(),
    };

    // Cache the result (if caching enabled)
    if (this.enableCache && policies.length > 0) {
      const cache = getEvaluationCache();
      const cacheKey = cache.generateKey(policies, context);
      cache.set(cacheKey, result, policies);
    }

    return result;
  }

  /**
   * Evaluate a single policy against a context
   */
  async evaluatePolicy(
    policy: Policy,
    context: PolicyEvaluationContext
  ): Promise<PolicyEvaluationResult> {
    const startTime = performance.now();
    const rulesEvaluated: RuleEvaluationResult[] = [];
    const matchedRules: RuleEvaluationResult[] = [];

    // Sort rules by priority (lower = higher priority)
    const sortedRules = [...policy.definition.rules]
      .filter((rule) => rule.enabled !== false)
      .sort((a, b) => a.priority - b.priority);

    // Start with default action; matched rules will override
    let action = policy.definition.defaultAction;
    let reason = policy.definition.defaultReason;
    let matched = false;
    // Track if any rule has set the action (vs still using default)
    let actionSetByRule = false;

    // Evaluate each rule
    for (const rule of sortedRules) {
      const ruleResult = await this.evaluateRule(rule, context);
      rulesEvaluated.push(ruleResult);

      if (ruleResult.conditionsMet) {
        matchedRules.push(ruleResult);
        matched = true;

        // First matched rule sets the action, subsequent rules only override if more restrictive
        if (!actionSetByRule) {
          action = ruleResult.action;
          reason = ruleResult.reason;
          actionSetByRule = true;
        } else if (ACTION_PRIORITY[ruleResult.action] < ACTION_PRIORITY[action]) {
          action = ruleResult.action;
          reason = ruleResult.reason;
        }

        // Short-circuit on deny
        if (ruleResult.action === 'deny') {
          break;
        }
      }
    }

    const durationMs = performance.now() - startTime;

    return {
      policyId: policy.id,
      policyName: policy.name,
      policyVersion: policy.version,
      matched,
      action,
      reason,
      rulesEvaluated,
      matchedRules,
      durationMs,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Evaluate a single rule against a context
   */
  private async evaluateRule(
    rule: PolicyRule,
    context: PolicyEvaluationContext
  ): Promise<RuleEvaluationResult> {
    const startTime = performance.now();

    const conditionsMet = this.evaluateCondition(rule.when, context);
    const durationMs = performance.now() - startTime;

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: conditionsMet,
      conditionsMet,
      action: conditionsMet ? rule.then.action : 'allow',
      reason: conditionsMet ? rule.then.reason : undefined,
      durationMs,
    };
  }

  /**
   * Check if a policy applies to the given context
   */
  private policyApplies(policy: Policy, context: PolicyEvaluationContext): boolean {
    const target = policy.definition.target;
    if (!target) return true;

    // Check intent type
    if (target.intentTypes && target.intentTypes.length > 0) {
      const intentType = context.intent.intentType;
      if (
        intentType &&
        !target.intentTypes.includes(intentType) &&
        !target.intentTypes.includes('*')
      ) {
        return false;
      }
    }

    // Check entity type
    if (target.entityTypes && target.entityTypes.length > 0) {
      if (
        !target.entityTypes.includes(context.entity.type) &&
        !target.entityTypes.includes('*')
      ) {
        return false;
      }
    }

    // Check trust level
    if (target.trustLevels && target.trustLevels.length > 0) {
      if (!target.trustLevels.includes(context.entity.trustLevel)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a condition against a context
   */
  private evaluateCondition(
    condition: PolicyCondition,
    context: PolicyEvaluationContext
  ): boolean {
    switch (condition.type) {
      case 'field':
        return this.evaluateFieldCondition(condition, context);
      case 'compound':
        return this.evaluateCompoundCondition(condition, context);
      case 'trust':
        return this.evaluateTrustCondition(condition, context);
      case 'time':
        return this.evaluateTimeCondition(condition, context);
      default:
        logger.warn({ condition }, 'Unknown condition type');
        return false;
    }
  }

  /**
   * Evaluate a field condition
   */
  private evaluateFieldCondition(
    condition: FieldCondition,
    context: PolicyEvaluationContext
  ): boolean {
    const fieldValue = this.resolveField(condition.field, context);
    const targetValue = condition.value;

    return this.compareValues(fieldValue, condition.operator, targetValue);
  }

  /**
   * Evaluate a compound condition (AND, OR, NOT)
   */
  private evaluateCompoundCondition(
    condition: CompoundCondition,
    context: PolicyEvaluationContext
  ): boolean {
    const { operator, conditions } = condition;

    switch (operator) {
      case 'and':
        return conditions.every((c) => this.evaluateCondition(c, context));
      case 'or':
        return conditions.some((c) => this.evaluateCondition(c, context));
      case 'not':
        // NOT applies to the first condition
        return conditions.length > 0 && !this.evaluateCondition(conditions[0]!, context);
      default:
        return false;
    }
  }

  /**
   * Evaluate a trust level condition
   */
  private evaluateTrustCondition(
    condition: TrustCondition,
    context: PolicyEvaluationContext
  ): boolean {
    const actualLevel = context.entity.trustLevel;
    const requiredLevel = condition.level;

    return this.compareValues(actualLevel, condition.operator, requiredLevel);
  }

  /**
   * Evaluate a time-based condition
   */
  private evaluateTimeCondition(
    condition: TimeCondition,
    context: PolicyEvaluationContext
  ): boolean {
    const timezone = condition.timezone ?? context.environment.timezone ?? 'UTC';
    const now = new Date(context.environment.timestamp);

    let fieldValue: number | string;

    switch (condition.field) {
      case 'hour':
        // Get hour in the specified timezone
        fieldValue = parseInt(
          now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone })
        );
        break;
      case 'dayOfWeek':
        // 0 = Sunday, 6 = Saturday
        fieldValue = now.getDay();
        break;
      case 'date':
        fieldValue = now.toISOString().split('T')[0]!;
        break;
      default:
        return false;
    }

    return this.compareValues(fieldValue, condition.operator, condition.value);
  }

  /**
   * Resolve a field path to its value in the context
   */
  private resolveField(field: string, context: PolicyEvaluationContext): unknown {
    const parts = field.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Compare two values using an operator
   */
  private compareValues(
    fieldValue: unknown,
    operator: string,
    targetValue: unknown
  ): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === targetValue;

      case 'not_equals':
        return fieldValue !== targetValue;

      case 'greater_than':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue > targetValue
        );

      case 'less_than':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue < targetValue
        );

      case 'greater_than_or_equal':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue >= targetValue
        );

      case 'less_than_or_equal':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue <= targetValue
        );

      case 'in':
        return Array.isArray(targetValue) && targetValue.includes(fieldValue);

      case 'not_in':
        return Array.isArray(targetValue) && !targetValue.includes(fieldValue);

      case 'contains':
        return (
          typeof fieldValue === 'string' &&
          typeof targetValue === 'string' &&
          fieldValue.includes(targetValue)
        );

      case 'not_contains':
        return (
          typeof fieldValue === 'string' &&
          typeof targetValue === 'string' &&
          !fieldValue.includes(targetValue)
        );

      case 'starts_with':
        return (
          typeof fieldValue === 'string' &&
          typeof targetValue === 'string' &&
          fieldValue.startsWith(targetValue)
        );

      case 'ends_with':
        return (
          typeof fieldValue === 'string' &&
          typeof targetValue === 'string' &&
          fieldValue.endsWith(targetValue)
        );

      case 'matches':
        try {
          return (
            typeof fieldValue === 'string' &&
            typeof targetValue === 'string' &&
            new RegExp(targetValue).test(fieldValue)
          );
        } catch (error) {
          logger.warn(
            {
              pattern: targetValue,
              fieldValue: typeof fieldValue === 'string' ? fieldValue.substring(0, 100) : typeof fieldValue,
              error: error instanceof Error ? error.message : String(error),
              operator: 'matches',
            },
            'Invalid regex pattern in policy condition'
          );
          return false;
        }

      case 'exists':
        return fieldValue !== undefined && fieldValue !== null;

      case 'not_exists':
        return fieldValue === undefined || fieldValue === null;

      default:
        logger.warn({ operator }, 'Unknown operator');
        return false;
    }
  }
}

/**
 * Create a new policy evaluator instance
 *
 * @param options - Configuration options
 * @param options.enableCache - Whether to enable result caching (default: true)
 */
export function createPolicyEvaluator(options?: { enableCache?: boolean }): PolicyEvaluator {
  return new PolicyEvaluator(options);
}
