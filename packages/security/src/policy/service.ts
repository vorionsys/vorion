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
 */
export class PolicyService {
  /**
   * Create a new policy
   */
  async create(tenantId: ID, input: CreatePolicyInput): Promise<Policy> {
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
          createdBy: input.createdBy,
        })
        .returning();

      if (!row) {
        throw new DatabaseError('Failed to create policy - no row returned', {
          operation: 'create',
          tenantId,
          name: input.name,
        });
      }

      logger.info(
        { policyId: row.id, name: input.name, tenantId },
        'Policy created'
      );

      return this.rowToPolicy(row);
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
   * Get a policy by ID
   */
  async findById(id: ID, tenantId: ID): Promise<Policy | null> {
    try {
      const db = getDatabase();

      const [row] = await db
        .select()
        .from(policies)
        .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
        .limit(1);

      return row ? this.rowToPolicy(row) : null;
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
   */
  async findByName(
    tenantId: ID,
    name: string,
    namespace: string = 'default'
  ): Promise<Policy | null> {
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
   * Update a policy (creates new version)
   */
  async update(id: ID, tenantId: ID, input: UpdatePolicyInput): Promise<Policy | null> {
    try {
      const db = getDatabase();

      const existing = await this.findById(id, tenantId);
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

      // Start transaction
      return await db.transaction(async (tx) => {
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
        const [updated] = await tx
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

        if (!updated) {
          throw new DatabaseError('Failed to update policy - no row returned', {
            operation: 'update',
            id,
            tenantId,
          });
        }

        // Invalidate policy evaluation cache
        const invalidatedCount = invalidatePolicyCache(id);
        if (invalidatedCount > 0) {
          logger.debug({ policyId: id, invalidatedCount }, 'Invalidated policy cache entries');
        }

        logger.info(
          { policyId: id, version: newVersion, tenantId },
          'Policy updated'
        );

        return this.rowToPolicy(updated);
      });
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
  }

  /**
   * Publish a policy (makes it active)
   */
  async publish(id: ID, tenantId: ID): Promise<Policy | null> {
    return this.update(id, tenantId, { status: 'published' });
  }

  /**
   * Deprecate a policy
   */
  async deprecate(id: ID, tenantId: ID): Promise<Policy | null> {
    return this.update(id, tenantId, { status: 'deprecated' });
  }

  /**
   * Archive a policy
   */
  async archive(id: ID, tenantId: ID): Promise<Policy | null> {
    return this.update(id, tenantId, { status: 'archived' });
  }

  /**
   * List policies with filters
   */
  async list(filters: PolicyListFilters): Promise<Policy[]> {
    try {
      const db = getDatabase();
      const { tenantId, namespace, status, name, limit = 50, offset = 0 } = filters;

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
      logger.error({ error, tenantId: filters.tenantId }, 'Failed to list policies');
      throw new DatabaseError(
        `Failed to list policies: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { operation: 'list', tenantId: filters.tenantId }
      );
    }
  }

  /**
   * Get published policies for evaluation
   */
  async getPublishedPolicies(tenantId: ID, namespace?: string): Promise<Policy[]> {
    return this.list({
      tenantId,
      namespace,
      status: 'published',
    });
  }

  /**
   * Update a policy with explicit versioning.
   * Creates a new version record before applying changes.
   *
   * @param id - Policy ID
   * @param tenantId - Tenant ID for access control
   * @param changes - Changes to apply
   * @returns Updated policy with new version number
   */
  async updateWithVersioning(
    id: ID,
    tenantId: ID,
    changes: UpdateWithVersioningInput
  ): Promise<Policy | null> {
    try {
      const db = getDatabase();

      const existing = await this.findById(id, tenantId);
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

      // Start transaction
      return await db.transaction(async (tx) => {
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
        const [updated] = await tx
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

        if (!updated) {
          throw new DatabaseError('Failed to update policy - no row returned', {
            operation: 'updateWithVersioning',
            id,
            tenantId,
          });
        }

        // Invalidate policy evaluation cache
        const invalidatedCount = invalidatePolicyCache(id);
        if (invalidatedCount > 0) {
          logger.debug({ policyId: id, invalidatedCount }, 'Invalidated policy cache entries');
        }

        logger.info(
          { policyId: id, previousVersion: existing.version, newVersion, tenantId, changedBy: changes.changedBy },
          'Policy updated with versioning'
        );

        return this.rowToPolicy(updated);
      });
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
  }

  /**
   * Get complete version history for a policy.
   * Returns all historical versions plus the current version.
   *
   * @param id - Policy ID
   * @param tenantId - Tenant ID for access control
   * @returns List of all versions, newest first
   */
  async getVersionHistory(id: ID, tenantId: ID): Promise<PolicyVersionWithMeta[]> {
    const db = getDatabase();

    // First verify the policy belongs to the tenant and get current version
    const policy = await this.findById(id, tenantId);
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
   * @param tenantId - Tenant ID for access control
   * @returns The policy version or null if not found
   */
  async getVersion(id: ID, version: number, tenantId: ID): Promise<PolicyVersion | null> {
    const db = getDatabase();

    // First verify the policy belongs to the tenant
    const policy = await this.findById(id, tenantId);
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
   * Rollback a policy to a previous version.
   * Creates a new version with the definition from the target version.
   *
   * @param id - Policy ID
   * @param targetVersion - Version number to rollback to
   * @param tenantId - Tenant ID for access control
   * @param userId - User performing the rollback
   * @returns Updated policy with new version number
   */
  async rollbackToVersion(
    id: ID,
    targetVersion: number,
    tenantId: ID,
    userId?: string
  ): Promise<Policy | null> {
    try {
      const db = getDatabase();

      // Get current policy
      const policy = await this.findById(id, tenantId);
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

      // Start transaction
      return await db.transaction(async (tx) => {
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
        const [updated] = await tx
          .update(policies)
          .set({
            definition: targetDefinition,
            checksum: newChecksum,
            version: newVersion,
            updatedAt: new Date(),
          })
          .where(and(eq(policies.id, id), eq(policies.tenantId, tenantId)))
          .returning();

        if (!updated) {
          throw new DatabaseError('Failed to rollback policy - no row returned', {
            operation: 'rollbackToVersion',
            id,
            tenantId,
            targetVersion,
          });
        }

        // Invalidate policy evaluation cache
        const invalidatedCount = invalidatePolicyCache(id);
        if (invalidatedCount > 0) {
          logger.debug({ policyId: id, invalidatedCount }, 'Invalidated policy cache entries after rollback');
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
          'Policy rolled back'
        );

        return this.rowToPolicy(updated);
      });
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
  }

  /**
   * Compare two versions of a policy.
   *
   * @param id - Policy ID
   * @param version1 - First version to compare
   * @param version2 - Second version to compare
   * @param tenantId - Tenant ID for access control
   * @returns Diff result between the two versions
   */
  async compareVersions(
    id: ID,
    version1: number,
    version2: number,
    tenantId: ID
  ): Promise<PolicyVersionCompareResult | null> {
    // Get both versions
    const [v1, v2] = await Promise.all([
      this.getVersion(id, version1, tenantId),
      this.getVersion(id, version2, tenantId),
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
   * Delete a policy (soft delete - archives it)
   */
  async delete(id: ID, tenantId: ID): Promise<boolean> {
    const result = await this.archive(id, tenantId);
    return result !== null;
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
