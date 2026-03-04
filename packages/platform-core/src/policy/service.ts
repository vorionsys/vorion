/**
 * Policy Service
 *
 * Handles CRUD operations for policies with versioning and validation.
 * Supports full version history, rollback, and diff capabilities.
 *
 * @packageDocumentation
 */

import { eq, and, desc, asc } from 'drizzle-orm';
import { createHash } from 'crypto';
import { createLogger } from '../common/logger.js';
import { getDatabase } from '../common/db.js';
import { policies, policyVersions } from '../intent/schema.js';
import type { ID } from '../common/types.js';
import { DatabaseError, ServiceError, isVorionError, NotFoundError } from '../common/errors.js';
import { invalidatePolicyCache } from './evaluator.js';
import { diffPolicyDefinitions, type PolicyDiffResult } from './diff.js';
import {
  getDistributedPolicyCache,
  withPolicyLock,
  PolicyLockError,
  type PolicyLockOptions,
} from './distributed-cache.js';
import type {
  TenantContext,
  ValidatedTenantId,
} from '../common/tenant-context.js';
import { extractTenantId } from '../common/tenant-context.js';
import type {
  Policy,
  PolicyVersion,
  PolicyDefinition,
  PolicyStatus,
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyListFilters,
  PolicyValidationResult,
  PolicyValidationError,
  PolicyRule,
  PolicyCondition,
  POLICY_STATUSES,
  CONDITION_OPERATORS,
} from './types.js';

/**
 * Input for updating a policy with versioning
 */
export interface UpdateWithVersioningInput {
  definition?: PolicyDefinition;
  description?: string;
  status?: PolicyStatus;
  changeSummary?: string;
  changedBy?: string;
}

/**
 * Extended policy version with additional metadata
 */
export interface PolicyVersionWithMeta extends PolicyVersion {
  isCurrent: boolean;
}

/**
 * Result of comparing two policy versions
 */
export interface PolicyVersionCompareResult {
  policyId: ID;
  version1: number;
  version2: number;
  diff: PolicyDiffResult;
}

const logger = createLogger({ component: 'policy-service' });

/**
 * Generate a checksum for a policy definition
 */
function generateChecksum(definition: PolicyDefinition): string {
  const json = JSON.stringify(definition, Object.keys(definition).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Validate a policy definition
 */
export function validatePolicyDefinition(definition: unknown): PolicyValidationResult {
  const errors: PolicyValidationError[] = [];

  if (!definition || typeof definition !== 'object') {
    errors.push({
      path: '',
      message: 'Policy definition must be an object',
      code: 'INVALID_TYPE',
    });
    return { valid: false, errors };
  }

  const def = definition as Record<string, unknown>;

  // Validate version
  if (def.version !== '1.0') {
    errors.push({
      path: 'version',
      message: 'Policy version must be "1.0"',
      code: 'INVALID_VERSION',
    });
  }

  // Validate rules array
  if (!Array.isArray(def.rules)) {
    errors.push({
      path: 'rules',
      message: 'Policy must have a rules array',
      code: 'MISSING_RULES',
    });
  } else {
    // Validate each rule
    def.rules.forEach((rule, index) => {
      const ruleErrors = validateRule(rule, `rules[${index}]`);
      errors.push(...ruleErrors);
    });
  }

  // Validate defaultAction
  const validActions = ['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate'];
  if (!validActions.includes(def.defaultAction as string)) {
    errors.push({
      path: 'defaultAction',
      message: `defaultAction must be one of: ${validActions.join(', ')}`,
      code: 'INVALID_DEFAULT_ACTION',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single rule
 */
function validateRule(rule: unknown, path: string): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  if (!rule || typeof rule !== 'object') {
    errors.push({
      path,
      message: 'Rule must be an object',
      code: 'INVALID_RULE_TYPE',
    });
    return errors;
  }

  const r = rule as Record<string, unknown>;

  // Required fields
  if (typeof r.id !== 'string' || !r.id) {
    errors.push({
      path: `${path}.id`,
      message: 'Rule must have a string id',
      code: 'MISSING_RULE_ID',
    });
  }

  if (typeof r.name !== 'string' || !r.name) {
    errors.push({
      path: `${path}.name`,
      message: 'Rule must have a string name',
      code: 'MISSING_RULE_NAME',
    });
  }

  if (typeof r.priority !== 'number') {
    errors.push({
      path: `${path}.priority`,
      message: 'Rule must have a numeric priority',
      code: 'MISSING_PRIORITY',
    });
  }

  // Validate when condition
  if (!r.when) {
    errors.push({
      path: `${path}.when`,
      message: 'Rule must have a when condition',
      code: 'MISSING_WHEN',
    });
  } else {
    const conditionErrors = validateCondition(r.when, `${path}.when`);
    errors.push(...conditionErrors);
  }

  // Validate then action
  if (!r.then || typeof r.then !== 'object') {
    errors.push({
      path: `${path}.then`,
      message: 'Rule must have a then action',
      code: 'MISSING_THEN',
    });
  } else {
    const then = r.then as Record<string, unknown>;
    const validActions = ['allow', 'deny', 'escalate', 'limit', 'monitor', 'terminate'];
    if (!validActions.includes(then.action as string)) {
      errors.push({
        path: `${path}.then.action`,
        message: `Action must be one of: ${validActions.join(', ')}`,
        code: 'INVALID_ACTION',
      });
    }
  }

  return errors;
}

/**
 * Validate a condition
 */
function validateCondition(condition: unknown, path: string): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  if (!condition || typeof condition !== 'object') {
    errors.push({
      path,
      message: 'Condition must be an object',
      code: 'INVALID_CONDITION_TYPE',
    });
    return errors;
  }

  const c = condition as Record<string, unknown>;

  switch (c.type) {
    case 'field':
      if (typeof c.field !== 'string') {
        errors.push({
          path: `${path}.field`,
          message: 'Field condition must specify a field path',
          code: 'MISSING_FIELD_PATH',
        });
      }
      if (typeof c.operator !== 'string') {
        errors.push({
          path: `${path}.operator`,
          message: 'Field condition must specify an operator',
          code: 'MISSING_OPERATOR',
        });
      }
      break;

    case 'compound':
      if (!['and', 'or', 'not'].includes(c.operator as string)) {
        errors.push({
          path: `${path}.operator`,
          message: 'Compound operator must be "and", "or", or "not"',
          code: 'INVALID_LOGICAL_OPERATOR',
        });
      }
      if (!Array.isArray(c.conditions)) {
        errors.push({
          path: `${path}.conditions`,
          message: 'Compound condition must have conditions array',
          code: 'MISSING_CONDITIONS',
        });
      } else {
        c.conditions.forEach((subCond, i) => {
          errors.push(...validateCondition(subCond, `${path}.conditions[${i}]`));
        });
      }
      break;

    case 'trust':
      if (typeof c.level !== 'number' || c.level < 0 || c.level > 4) {
        errors.push({
          path: `${path}.level`,
          message: 'Trust level must be a number between 0 and 4',
          code: 'INVALID_TRUST_LEVEL',
        });
      }
      break;

    case 'time':
      if (!['hour', 'dayOfWeek', 'date'].includes(c.field as string)) {
        errors.push({
          path: `${path}.field`,
          message: 'Time field must be "hour", "dayOfWeek", or "date"',
          code: 'INVALID_TIME_FIELD',
        });
      }
      break;

    default:
      errors.push({
        path: `${path}.type`,
        message: 'Condition type must be "field", "compound", "trust", or "time"',
        code: 'INVALID_CONDITION_TYPE',
      });
  }

  return errors;
}

/**
 * Policy Service class
 *
 * SECURITY: All methods now accept TenantContext instead of raw tenantId.
 * TenantContext can only be created from validated JWT tokens, preventing
 * tenant ID injection attacks.
 *
 * SECURITY: Uses distributed locking and 2-phase cache invalidation to
 * prevent race conditions where concurrent requests read stale policy data
 * (MEDIUM vulnerability fix).
 *
 * @see TenantContext in ../common/tenant-context.ts
 * @see distributed-cache.ts for locking and cache implementation
 */
export class PolicyService {
  private distributedCache = getDistributedPolicyCache();
  /**
   * Create a new policy with write-through caching
   *
   * SECURITY: Atomically updates distributed cache after DB commit.
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param input - Policy creation input
   * @returns Created policy
   */
  async create(ctx: TenantContext, input: CreatePolicyInput): Promise<Policy> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = getDatabase();

      // Validate definition
      const validation = validatePolicyDefinition(input.definition);
      if (!validation.valid) {
        throw new PolicyValidationException('Invalid policy definition', validation.errors);
      }

      const checksum = generateChecksum(input.definition);

      const [row] = await db
        .insert(policies)
        .values({
          tenantId,
          name: input.name,
          namespace: input.namespace ?? 'default',
          description: input.description,
          version: 1,
          status: 'draft',
          definition: input.definition,
          checksum,
          createdBy: input.createdBy ?? ctx.userId,
        })
        .returning();

      if (!row) {
        throw new DatabaseError('Failed to create policy - no row returned', {
          operation: 'create',
          tenantId,
          name: input.name,
        });
      }

      const policy = this.rowToPolicy(row);

      // Write-through to distributed cache
      try {
        await this.distributedCache.set(policy);
        logger.debug({ policyId: row.id }, 'Policy written to distributed cache');
      } catch (cacheError) {
        // Log but don't fail - DB is source of truth
        logger.warn(
          { error: cacheError, policyId: row.id },
          'Failed to write policy to distributed cache'
        );
      }

      logger.info(
        { policyId: row.id, name: input.name, tenantId, userId: ctx.userId },
        'Policy created'
      );

      return policy;
    } catch (error) {
      if (error instanceof PolicyValidationException || isVorionError(error)) {
        throw error;
      }
      logger.error({ error, tenantId, name: input.name }, 'Failed to create policy');
      throw new DatabaseError(
        `Failed to create policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { operation: 'create', tenantId, name: input.name }
      );
    }
  }

  /**
   * Get a policy by ID with distributed cache support
   *
   * SECURITY: Checks distributed cache first with stale detection.
   * Rejects stale cache entries to prevent reading outdated policies.
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Policy or null if not found
   */
  async findById(id: ID, ctx: TenantContext): Promise<Policy | null> {
    const tenantId = extractTenantId(ctx);

    try {
      // Check distributed cache first with stale detection
      const cacheResult = await this.distributedCache.get(id, tenantId);

      if (cacheResult.policy && !cacheResult.stale) {
        logger.debug({ policyId: id, tenantId, cacheHit: true }, 'Policy found in cache');
        return cacheResult.policy;
      }

      // Cache miss or stale - fetch from database
      const db = getDatabase();

      const [row] = await db
        .select()
        .from(policies)
        .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
        .limit(1);

      if (!row) {
        return null;
      }

      const policy = this.rowToPolicy(row);

      // Update cache with fresh data
      try {
        await this.distributedCache.set(policy);
      } catch (cacheError) {
        logger.warn(
          { error: cacheError, policyId: id },
          'Failed to update distributed cache'
        );
      }

      return policy;
    } catch (error) {
      logger.error({ error, id, tenantId }, 'Failed to find policy by ID');
      throw new DatabaseError(
        `Failed to find policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { operation: 'findById', id, tenantId }
      );
    }
  }

  /**
   * Get a policy by name and namespace
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param name - Policy name
   * @param namespace - Policy namespace (default: 'default')
   * @returns Policy or null if not found
   */
  async findByName(
    ctx: TenantContext,
    name: string,
    namespace: string = 'default'
  ): Promise<Policy | null> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = getDatabase();

      const [row] = await db
        .select()
        .from(policies)
        .where(
          and(
            eq(policies.tenantId, tenantId),
            eq(policies.name, name),
            eq(policies.namespace, namespace)
          )
        )
        .orderBy(desc(policies.version))
        .limit(1);

      return row ? this.rowToPolicy(row) : null;
    } catch (error) {
      logger.error({ error, tenantId, name, namespace }, 'Failed to find policy by name');
      throw new DatabaseError(
        `Failed to find policy by name: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { operation: 'findByName', tenantId, name, namespace }
      );
    }
  }

  /**
   * Update a policy with distributed locking and 2-phase cache invalidation
   *
   * SECURITY FIX: Uses distributed locking and 2-phase cache invalidation
   * to prevent race conditions where concurrent requests read stale policies.
   *
   * Flow:
   * 1. Acquire distributed lock on policy
   * 2. Mark cache as stale (2-phase step 1) - BEFORE DB commit
   * 3. Perform database transaction
   * 4. Invalidate local in-memory cache
   * 5. Write to distributed cache atomically (write-through, 2-phase step 2)
   * 6. Release lock
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param input - Policy update input
   * @returns Updated policy or null if not found
   */
  async update(id: ID, ctx: TenantContext, input: UpdatePolicyInput): Promise<Policy | null> {
    const tenantId = extractTenantId(ctx);

    // Use distributed lock to prevent race conditions
    return withPolicyLock(id, tenantId, async () => {
      try {
        const db = getDatabase();

        const existing = await this.findById(id, ctx);
        if (!existing) return null;

        // Validate new definition if provided
        if (input.definition) {
          const validation = validatePolicyDefinition(input.definition);
          if (!validation.valid) {
            throw new PolicyValidationException('Invalid policy definition', validation.errors);
          }
        }

        const newDefinition = input.definition ?? existing.definition;
        const newChecksum = generateChecksum(newDefinition);
        const newVersion = existing.version + 1;

        // 2-PHASE CACHE INVALIDATION - Step 1: Mark as stale BEFORE DB commit
        // This ensures any concurrent reads will see the stale marker and
        // won't return cached data during the update window
        try {
          await this.distributedCache.markStale(id, tenantId);
          logger.debug({ policyId: id }, 'Policy marked as stale before update');
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to mark policy as stale - continuing with update'
          );
        }

        // Database transaction
        const updated = await db.transaction(async (tx) => {
          // Archive current version
          await tx.insert(policyVersions).values({
            policyId: existing.id,
            version: existing.version,
            definition: existing.definition,
            checksum: existing.checksum,
            changeSummary: input.changeSummary,
            createdBy: input.updatedBy,
          });

          // Update policy
          const [updatedRow] = await tx
            .update(policies)
            .set({
              description: input.description ?? existing.description,
              definition: newDefinition,
              checksum: newChecksum,
              version: newVersion,
              status: input.status ?? existing.status,
              updatedAt: new Date(),
              publishedAt: input.status === 'published' ? new Date() : (existing.publishedAt ? new Date(existing.publishedAt) : null),
            })
            .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
            .returning();

          if (!updatedRow) {
            throw new DatabaseError('Failed to update policy - no row returned', {
              operation: 'update',
              id,
              tenantId,
            });
          }

          return this.rowToPolicy(updatedRow);
        });

        // Invalidate local in-memory policy evaluation cache
        const invalidatedCount = invalidatePolicyCache(id);
        if (invalidatedCount > 0) {
          logger.debug({ policyId: id, invalidatedCount }, 'Invalidated local policy cache entries');
        }

        // 2-PHASE CACHE INVALIDATION - Step 2: Write-through to distributed cache
        // This atomically updates the cache with the new version
        try {
          await this.distributedCache.set(updated);
          logger.debug({ policyId: id, version: newVersion }, 'Policy written to distributed cache');
        } catch (cacheError) {
          // Log but don't fail - try to at least invalidate
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to write policy to distributed cache, invalidating instead'
          );
          try {
            await this.distributedCache.invalidate(id, tenantId);
          } catch (invalidateError) {
            logger.error(
              { error: invalidateError, policyId: id },
              'Failed to invalidate distributed cache'
            );
          }
        }

        logger.info(
          { policyId: id, version: newVersion, tenantId },
          'Policy updated with distributed locking'
        );

        return updated;
      } catch (error) {
        if (error instanceof PolicyValidationException || isVorionError(error)) {
          throw error;
        }
        logger.error({ error, id, tenantId }, 'Failed to update policy');
        throw new DatabaseError(
          `Failed to update policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { operation: 'update', id, tenantId }
        );
      }
    });
  }

  /**
   * Publish a policy (makes it active)
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Published policy or null if not found
   */
  async publish(id: ID, ctx: TenantContext): Promise<Policy | null> {
    return this.update(id, ctx, { status: 'published' });
  }

  /**
   * Deprecate a policy
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Deprecated policy or null if not found
   */
  async deprecate(id: ID, ctx: TenantContext): Promise<Policy | null> {
    return this.update(id, ctx, { status: 'deprecated' });
  }

  /**
   * Archive a policy
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Archived policy or null if not found
   */
  async archive(id: ID, ctx: TenantContext): Promise<Policy | null> {
    return this.update(id, ctx, { status: 'archived' });
  }

  /**
   * List policies with filters
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param filters - Optional filters (namespace, status, etc.)
   * @returns Array of policies
   */
  async list(ctx: TenantContext, filters?: Omit<PolicyListFilters, 'tenantId'>): Promise<Policy[]> {
    const tenantId = extractTenantId(ctx);

    try {
      const db = getDatabase();
      const { namespace, status, name, limit = 50, offset = 0 } = filters ?? {};

      const conditions = [eq(policies.tenantId, tenantId)];

      if (namespace) {
        conditions.push(eq(policies.namespace, namespace));
      }
      if (status) {
        conditions.push(eq(policies.status, status));
      }
      // Note: name filtering would need LIKE, implementing simple exact match for now

      const rows = await db
        .select()
        .from(policies)
        .where(and(...conditions))
        .orderBy(desc(policies.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows.map((row) => this.rowToPolicy(row));
    } catch (error) {
      logger.error({ error, tenantId }, 'Failed to list policies');
      throw new DatabaseError(
        `Failed to list policies: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { operation: 'list', tenantId }
      );
    }
  }

  /**
   * Get published policies for evaluation
   *
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param namespace - Optional namespace filter
   * @returns Array of published policies
   */
  async getPublishedPolicies(ctx: TenantContext, namespace?: string): Promise<Policy[]> {
    return this.list(ctx, {
      namespace,
      status: 'published',
    });
  }

  /**
   * Update a policy with explicit versioning and distributed locking.
   * Creates a new version record before applying changes.
   *
   * SECURITY FIX: Uses distributed locking and 2-phase cache invalidation.
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @param changes - Changes to apply
   * @returns Updated policy with new version number
   */
  async updateWithVersioning(
    id: ID,
    ctx: TenantContext,
    changes: UpdateWithVersioningInput
  ): Promise<Policy | null> {
    const tenantId = extractTenantId(ctx);

    // Use distributed lock to prevent race conditions
    return withPolicyLock(id, tenantId, async () => {
      try {
        const db = getDatabase();

        const existing = await this.findById(id, ctx);
        if (!existing) return null;

        // Validate new definition if provided
        if (changes.definition) {
          const validation = validatePolicyDefinition(changes.definition);
          if (!validation.valid) {
            throw new PolicyValidationException('Invalid policy definition', validation.errors);
          }
        }

        const newDefinition = changes.definition ?? existing.definition;
        const newChecksum = generateChecksum(newDefinition);
        const newVersion = existing.version + 1;

        // Auto-generate change summary if not provided and definition changed
        let changeSummary = changes.changeSummary;
        if (!changeSummary && changes.definition) {
          const diff = diffPolicyDefinitions(existing.definition, changes.definition);
          changeSummary = diff.summary;
        }

        // 2-PHASE CACHE INVALIDATION - Step 1: Mark as stale
        try {
          await this.distributedCache.markStale(id, tenantId);
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to mark policy as stale'
          );
        }

        // Database transaction
        const updated = await db.transaction(async (tx) => {
          // Archive current version before updating
          await tx.insert(policyVersions).values({
            policyId: existing.id,
            version: existing.version,
            definition: existing.definition,
            checksum: existing.checksum,
            changeSummary: changeSummary,
            createdBy: changes.changedBy,
          });

          // Update policy to new version
          const [updatedRow] = await tx
            .update(policies)
            .set({
              description: changes.description ?? existing.description,
              definition: newDefinition,
              checksum: newChecksum,
              version: newVersion,
              status: changes.status ?? existing.status,
              updatedAt: new Date(),
              publishedAt: changes.status === 'published' ? new Date() : (existing.publishedAt ? new Date(existing.publishedAt) : null),
            })
            .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
            .returning();

          if (!updatedRow) {
            throw new DatabaseError('Failed to update policy - no row returned', {
              operation: 'updateWithVersioning',
              id,
              tenantId,
            });
          }

          return this.rowToPolicy(updatedRow);
        });

        // Invalidate local policy evaluation cache
        const invalidatedCount = invalidatePolicyCache(id);
        if (invalidatedCount > 0) {
          logger.debug({ policyId: id, invalidatedCount }, 'Invalidated local policy cache entries');
        }

        // 2-PHASE CACHE INVALIDATION - Step 2: Write-through
        try {
          await this.distributedCache.set(updated);
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to write policy to distributed cache'
          );
          try {
            await this.distributedCache.invalidate(id, tenantId);
          } catch (invalidateError) {
            logger.error(
              { error: invalidateError, policyId: id },
              'Failed to invalidate distributed cache'
            );
          }
        }

        logger.info(
          { policyId: id, previousVersion: existing.version, newVersion, tenantId, changedBy: changes.changedBy },
          'Policy updated with versioning'
        );

        return updated;
      } catch (error) {
        if (error instanceof PolicyValidationException || isVorionError(error)) {
          throw error;
        }
        logger.error({ error, id, tenantId }, 'Failed to update policy with versioning');
        throw new DatabaseError(
          `Failed to update policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { operation: 'updateWithVersioning', id, tenantId }
        );
      }
    });
  }

  /**
   * Get complete version history for a policy.
   * Returns all historical versions plus the current version.
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns List of all versions, newest first
   */
  async getVersionHistory(id: ID, ctx: TenantContext): Promise<PolicyVersionWithMeta[]> {
    const db = getDatabase();

    // First verify the policy belongs to the tenant and get current version
    const policy = await this.findById(id, ctx);
    if (!policy) return [];

    // Get all archived versions
    const rows = await db
      .select()
      .from(policyVersions)
      .where(eq(policyVersions.policyId, id))
      .orderBy(desc(policyVersions.version));

    // Map archived versions
    const archivedVersions: PolicyVersionWithMeta[] = rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      version: row.version,
      definition: row.definition as PolicyDefinition,
      checksum: row.checksum,
      changeSummary: row.changeSummary,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      isCurrent: false,
    }));

    // Add current version at the beginning (newest)
    const currentVersion: PolicyVersionWithMeta = {
      id: policy.id,
      policyId: policy.id,
      version: policy.version,
      definition: policy.definition,
      checksum: policy.checksum,
      changeSummary: null,
      createdBy: policy.createdBy,
      createdAt: policy.updatedAt,
      isCurrent: true,
    };

    return [currentVersion, ...archivedVersions];
  }

  /**
   * Get a specific version of a policy.
   *
   * @param id - Policy ID
   * @param version - Version number to retrieve
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns The policy version or null if not found
   */
  async getVersion(id: ID, version: number, ctx: TenantContext): Promise<PolicyVersion | null> {
    const db = getDatabase();

    // First verify the policy belongs to the tenant
    const policy = await this.findById(id, ctx);
    if (!policy) return null;

    // If requesting current version, return from policy
    if (version === policy.version) {
      return {
        id: policy.id,
        policyId: policy.id,
        version: policy.version,
        definition: policy.definition,
        checksum: policy.checksum,
        changeSummary: null,
        createdBy: policy.createdBy,
        createdAt: policy.updatedAt,
      };
    }

    // Otherwise look in version history
    const [row] = await db
      .select()
      .from(policyVersions)
      .where(and(eq(policyVersions.policyId, id), eq(policyVersions.version, version)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      policyId: row.policyId,
      version: row.version,
      definition: row.definition as PolicyDefinition,
      checksum: row.checksum,
      changeSummary: row.changeSummary,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Rollback a policy to a previous version with distributed locking.
   * Creates a new version with the definition from the target version.
   *
   * SECURITY FIX: Uses distributed locking and 2-phase cache invalidation.
   *
   * @param id - Policy ID
   * @param targetVersion - Version number to rollback to
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Updated policy with new version number
   */
  async rollbackToVersion(
    id: ID,
    targetVersion: number,
    ctx: TenantContext
  ): Promise<Policy | null> {
    const tenantId = extractTenantId(ctx);
    const userId = ctx.userId;

    // Use distributed lock to prevent race conditions
    return withPolicyLock(id, tenantId, async () => {
      try {
        const db = getDatabase();

        // Get current policy
        const policy = await this.findById(id, ctx);
        if (!policy) return null;

        // Cannot rollback to current version
        if (targetVersion === policy.version) {
          throw new ServiceError(
            'Cannot rollback to current version',
            'PolicyService',
            'rollbackToVersion',
            {
              code: 'INVALID_ROLLBACK_TARGET',
              policyId: id,
              currentVersion: policy.version,
              targetVersion,
            }
          );
        }

        // Cannot rollback to future version
        if (targetVersion > policy.version) {
          throw new ServiceError(
            'Cannot rollback to future version',
            'PolicyService',
            'rollbackToVersion',
            {
              code: 'INVALID_ROLLBACK_TARGET',
              policyId: id,
              currentVersion: policy.version,
              targetVersion,
            }
          );
        }

        // Get target version
        const [targetRow] = await db
          .select()
          .from(policyVersions)
          .where(and(eq(policyVersions.policyId, id), eq(policyVersions.version, targetVersion)))
          .limit(1);

        if (!targetRow) {
          throw new NotFoundError('Target version not found', {
            policyId: id,
            targetVersion,
          });
        }

        const targetDefinition = targetRow.definition as PolicyDefinition;
        const newVersion = policy.version + 1;
        const newChecksum = generateChecksum(targetDefinition);

        // 2-PHASE CACHE INVALIDATION - Step 1: Mark as stale
        try {
          await this.distributedCache.markStale(id, tenantId);
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to mark policy as stale before rollback'
          );
        }

        // Database transaction
        const updated = await db.transaction(async (tx) => {
          // Archive current version
          await tx.insert(policyVersions).values({
            policyId: policy.id,
            version: policy.version,
            definition: policy.definition,
            checksum: policy.checksum,
            changeSummary: `Rolled back to version ${targetVersion}`,
            createdBy: userId,
          });

          // Update policy with target version's definition
          const [updatedRow] = await tx
            .update(policies)
            .set({
              definition: targetDefinition,
              checksum: newChecksum,
              version: newVersion,
              updatedAt: new Date(),
            })
            .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
            .returning();

          if (!updatedRow) {
            throw new DatabaseError('Failed to rollback policy - no row returned', {
              operation: 'rollbackToVersion',
              id,
              tenantId,
              targetVersion,
            });
          }

          return this.rowToPolicy(updatedRow);
        });

        // Invalidate local policy evaluation cache
        const invalidatedCount = invalidatePolicyCache(id);
        if (invalidatedCount > 0) {
          logger.debug({ policyId: id, invalidatedCount }, 'Invalidated local policy cache entries after rollback');
        }

        // 2-PHASE CACHE INVALIDATION - Step 2: Write-through
        try {
          await this.distributedCache.set(updated);
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to write policy to distributed cache after rollback'
          );
          try {
            await this.distributedCache.invalidate(id, tenantId);
          } catch (invalidateError) {
            logger.error(
              { error: invalidateError, policyId: id },
              'Failed to invalidate distributed cache after rollback'
            );
          }
        }

        logger.info(
          {
            policyId: id,
            previousVersion: policy.version,
            targetVersion,
            newVersion,
            tenantId,
            userId,
          },
          'Policy rolled back with distributed locking'
        );

        return updated;
      } catch (error) {
        if (isVorionError(error)) {
          throw error;
        }
        logger.error({ error, id, tenantId, targetVersion }, 'Failed to rollback policy');
        throw new DatabaseError(
          `Failed to rollback policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { operation: 'rollbackToVersion', id, tenantId }
        );
      }
    });
  }

  /**
   * Compare two versions of a policy.
   *
   * @param id - Policy ID
   * @param version1 - First version to compare
   * @param version2 - Second version to compare
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns Diff result between the two versions
   */
  async compareVersions(
    id: ID,
    version1: number,
    version2: number,
    ctx: TenantContext
  ): Promise<PolicyVersionCompareResult | null> {
    // Get both versions
    const [v1, v2] = await Promise.all([
      this.getVersion(id, version1, ctx),
      this.getVersion(id, version2, ctx),
    ]);

    if (!v1 || !v2) {
      return null;
    }

    // Compare definitions
    const diff = diffPolicyDefinitions(v1.definition, v2.definition);

    return {
      policyId: id,
      version1,
      version2,
      diff,
    };
  }

  /**
   * Delete a policy with distributed locking (soft delete - archives it)
   *
   * SECURITY FIX: Uses distributed locking and 2-phase cache invalidation.
   *
   * @param id - Policy ID
   * @param ctx - Validated tenant context from JWT (REQUIRED for security)
   * @returns True if deleted successfully
   */
  async delete(id: ID, ctx: TenantContext): Promise<boolean> {
    const tenantId = extractTenantId(ctx);

    // Use distributed lock to prevent race conditions
    return withPolicyLock(id, tenantId, async () => {
      try {
        // Mark as stale before any changes
        try {
          await this.distributedCache.markStale(id, tenantId);
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to mark policy as stale before delete'
          );
        }

        // Archive instead of hard delete (calls update internally which handles cache)
        const result = await this.archive(id, ctx);

        // Ensure distributed cache is invalidated
        try {
          await this.distributedCache.invalidate(id, tenantId);
        } catch (cacheError) {
          logger.warn(
            { error: cacheError, policyId: id },
            'Failed to invalidate distributed cache after delete'
          );
        }

        return result !== null;
      } catch (error) {
        if (error instanceof PolicyLockError) {
          throw error;
        }
        logger.error({ error, id, tenantId }, 'Failed to delete policy');
        return false;
      }
    });
  }

  /**
   * Get policies for evaluation with stale cache rejection
   *
   * This method is used by the policy evaluator to get policies for
   * evaluation. It validates cache versions and rejects stale data.
   *
   * SECURITY: Ensures policy evaluation always uses fresh data.
   *
   * @param ctx - Validated tenant context from JWT
   * @param policyIds - Policy IDs to evaluate
   * @returns Array of policies (refreshed if stale)
   */
  async getPoliciesForEvaluation(ctx: TenantContext, policyIds: ID[]): Promise<Policy[]> {
    const tenantId = extractTenantId(ctx);
    const results: Policy[] = [];

    for (const id of policyIds) {
      const cacheResult = await this.distributedCache.get(id, tenantId);

      if (cacheResult.policy && !cacheResult.stale) {
        results.push(cacheResult.policy);
      } else {
        // Stale or missing - fetch fresh from DB
        const policy = await this.findById(id, ctx);
        if (policy) {
          results.push(policy);
        }
      }
    }

    return results;
  }

  /**
   * Convert database row to Policy object
   */
  private rowToPolicy(row: typeof policies.$inferSelect): Policy {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      namespace: row.namespace,
      description: row.description,
      version: row.version,
      status: row.status as PolicyStatus,
      definition: row.definition as PolicyDefinition,
      checksum: row.checksum,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString() ?? null,
    };
  }
}

/**
 * Custom error for policy validation failures
 */
export class PolicyValidationException extends Error {
  public readonly errors: PolicyValidationError[];

  constructor(message: string, errors: PolicyValidationError[]) {
    super(message);
    this.name = 'PolicyValidationException';
    this.errors = errors;
  }
}

/**
 * Create a new policy service instance
 */
export function createPolicyService(): PolicyService {
  return new PolicyService();
}

// Re-export distributed cache utilities for external use
export { withPolicyLock, PolicyLockError } from './distributed-cache.js';
