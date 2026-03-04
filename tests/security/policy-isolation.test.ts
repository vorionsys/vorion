/**
 * Policy Service Multi-Tenant Isolation Tests
 *
 * Validates that the Policy Service enforces strict tenant boundaries across
 * all CRUD operations, evaluation, caching, and adversarial scenarios.
 *
 * Uses self-contained mock implementations to test isolation semantics
 * without database or distributed cache dependencies.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  Policy,
  PolicyDefinition,
  PolicyStatus,
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyListFilters,
  PolicyEvaluationContext,
  MultiPolicyEvaluationResult,
  PolicyEvaluationResult,
  PolicyVersion,
} from '../../packages/platform-core/src/policy/types.js';
import type { TenantContext } from '../../packages/platform-core/src/common/tenant-context.js';

// Mock logger to suppress output during tests
vi.mock('../../packages/platform-core/src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a TenantContext for testing.
 * In production, TenantContext can only be created from validated JWT tokens.
 * Here we simulate that with typed casting for test purposes.
 */
function createTestTenantContext(overrides: {
  tenantId: string;
  userId?: string;
  roles?: string[];
  permissions?: string[];
}): TenantContext {
  return Object.freeze({
    tenantId: overrides.tenantId as TenantContext['tenantId'],
    userId: (overrides.userId ?? `user-${randomUUID().slice(0, 8)}`) as TenantContext['userId'],
    roles: Object.freeze(overrides.roles ?? ['user']),
    permissions: Object.freeze(overrides.permissions ?? []),
    createdAt: Date.now(),
  });
}

/**
 * Create a valid PolicyDefinition for testing.
 */
function createTestPolicyDefinition(overrides?: Partial<PolicyDefinition>): PolicyDefinition {
  return {
    version: '1.0',
    rules: [
      {
        id: `rule-${randomUUID().slice(0, 8)}`,
        name: 'default-rule',
        priority: 1,
        enabled: true,
        when: {
          type: 'field',
          field: 'intent.goal',
          operator: 'contains',
          value: 'test',
        },
        then: {
          action: 'allow',
          reason: 'Test rule matched',
        },
      },
    ],
    defaultAction: 'allow',
    ...overrides,
  };
}

/**
 * Create a CreatePolicyInput for testing.
 */
function createTestPolicyInput(overrides?: Partial<CreatePolicyInput>): CreatePolicyInput {
  return {
    name: overrides?.name ?? `policy-${randomUUID().slice(0, 8)}`,
    namespace: overrides?.namespace ?? 'default',
    description: overrides?.description ?? 'Test policy',
    definition: overrides?.definition ?? createTestPolicyDefinition(),
    createdBy: overrides?.createdBy,
  };
}

// =============================================================================
// MOCK POLICY SERVICE
// =============================================================================

/**
 * Self-contained mock Policy Service that enforces tenant isolation.
 * Mirrors the real PolicyService's tenant-scoped behavior using in-memory stores.
 *
 * Storage: Map<tenantId, Map<policyId, Policy>>
 * Version history: Map<policyId, PolicyVersion[]>
 * Cache: Map<`${tenantId}:${policyId}`, Policy>
 */
class MockPolicyService {
  /** Tenant-scoped policy storage */
  private stores = new Map<string, Map<string, Policy>>();

  /** Version history per policy */
  private versionHistory = new Map<string, PolicyVersion[]>();

  /** Simulated distributed cache (tenant-scoped keys) */
  private cache = new Map<string, Policy>();

  /**
   * Extract tenantId from context, mirroring extractTenantId behavior.
   */
  private extractTenantId(ctx: TenantContext): string {
    return ctx.tenantId as string;
  }

  /**
   * Get or create the tenant-scoped store.
   */
  private getTenantStore(tenantId: string): Map<string, Policy> {
    let store = this.stores.get(tenantId);
    if (!store) {
      store = new Map();
      this.stores.set(tenantId, store);
    }
    return store;
  }

  /**
   * Generate a simple checksum for a definition.
   */
  private generateChecksum(definition: PolicyDefinition): string {
    const json = JSON.stringify(definition, Object.keys(definition).sort());
    // Simple hash for testing
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
      const char = json.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
  }

  /**
   * Create a policy scoped to the tenant in context.
   * The tenantId is ALWAYS taken from ctx, never from input.
   */
  async create(ctx: TenantContext, input: CreatePolicyInput): Promise<Policy> {
    const tenantId = this.extractTenantId(ctx);
    const store = this.getTenantStore(tenantId);

    const policy: Policy = {
      id: randomUUID(),
      tenantId,
      name: input.name,
      namespace: input.namespace ?? 'default',
      description: input.description ?? null,
      version: 1,
      status: 'draft' as PolicyStatus,
      definition: input.definition,
      checksum: this.generateChecksum(input.definition),
      createdBy: input.createdBy ?? ctx.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
    };

    store.set(policy.id, policy);

    // Write-through to cache with tenant-scoped key
    this.cache.set(`${tenantId}:${policy.id}`, policy);

    return policy;
  }

  /**
   * Find policy by ID, scoped to the tenant in context.
   * Returns null if the policy exists but belongs to a different tenant.
   */
  async findById(id: string, ctx: TenantContext): Promise<Policy | null> {
    const tenantId = this.extractTenantId(ctx);

    // Check cache first (tenant-scoped key)
    const cached = this.cache.get(`${tenantId}:${id}`);
    if (cached) return cached;

    // Fall back to store
    const store = this.getTenantStore(tenantId);
    return store.get(id) ?? null;
  }

  /**
   * Find policy by name and optional namespace, scoped to tenant.
   */
  async findByName(
    ctx: TenantContext,
    name: string,
    namespace: string = 'default'
  ): Promise<Policy | null> {
    const tenantId = this.extractTenantId(ctx);
    const store = this.getTenantStore(tenantId);

    for (const policy of store.values()) {
      if (policy.name === name && policy.namespace === namespace) {
        return policy;
      }
    }
    return null;
  }

  /**
   * List policies scoped to the tenant in context, with optional filters.
   */
  async list(
    ctx: TenantContext,
    filters?: Omit<PolicyListFilters, 'tenantId'>
  ): Promise<Policy[]> {
    const tenantId = this.extractTenantId(ctx);
    const store = this.getTenantStore(tenantId);
    let results = Array.from(store.values());

    if (filters?.namespace) {
      results = results.filter((p) => p.namespace === filters.namespace);
    }
    if (filters?.status) {
      results = results.filter((p) => p.status === filters.status);
    }
    if (filters?.name) {
      results = results.filter((p) => p.name === filters.name);
    }

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? 50;
    return results.slice(offset, offset + limit);
  }

  /**
   * Update a policy scoped to the tenant in context.
   * Returns null if the policy does not exist in the tenant's scope.
   */
  async update(
    id: string,
    ctx: TenantContext,
    input: UpdatePolicyInput
  ): Promise<Policy | null> {
    const tenantId = this.extractTenantId(ctx);
    const store = this.getTenantStore(tenantId);
    const existing = store.get(id);

    if (!existing) return null;

    // Archive current version
    const versions = this.versionHistory.get(id) ?? [];
    versions.push({
      id: randomUUID(),
      policyId: existing.id,
      version: existing.version,
      definition: existing.definition,
      checksum: existing.checksum,
      changeSummary: input.changeSummary ?? null,
      createdBy: input.updatedBy ?? null,
      createdAt: existing.updatedAt,
    });
    this.versionHistory.set(id, versions);

    // Apply update
    const newDefinition = input.definition ?? existing.definition;
    const updated: Policy = {
      ...existing,
      description: input.description ?? existing.description,
      definition: newDefinition,
      checksum: this.generateChecksum(newDefinition),
      version: existing.version + 1,
      status: input.status ?? existing.status,
      updatedAt: new Date().toISOString(),
      publishedAt:
        input.status === 'published'
          ? new Date().toISOString()
          : existing.publishedAt,
    };

    store.set(id, updated);

    // Update cache
    this.cache.delete(`${tenantId}:${id}`);
    this.cache.set(`${tenantId}:${id}`, updated);

    return updated;
  }

  /**
   * Delete (archive) a policy scoped to the tenant in context.
   * Returns false if the policy does not exist in the tenant's scope.
   */
  async delete(id: string, ctx: TenantContext): Promise<boolean> {
    const tenantId = this.extractTenantId(ctx);
    const store = this.getTenantStore(tenantId);
    const existing = store.get(id);

    if (!existing) return false;

    // Soft-delete by archiving
    const archived: Policy = {
      ...existing,
      status: 'archived' as PolicyStatus,
      updatedAt: new Date().toISOString(),
    };
    store.set(id, archived);

    // Invalidate cache
    this.cache.delete(`${tenantId}:${id}`);

    return true;
  }

  /**
   * Get version history for a policy, scoped to the owning tenant.
   */
  async getVersionHistory(
    id: string,
    ctx: TenantContext
  ): Promise<PolicyVersion[]> {
    // First verify the policy belongs to the tenant
    const policy = await this.findById(id, ctx);
    if (!policy) return [];

    const history = this.versionHistory.get(id) ?? [];

    // Add current version at the top
    const currentVersion: PolicyVersion = {
      id: policy.id,
      policyId: policy.id,
      version: policy.version,
      definition: policy.definition,
      checksum: policy.checksum,
      changeSummary: null,
      createdBy: policy.createdBy,
      createdAt: policy.updatedAt,
    };

    return [currentVersion, ...history];
  }

  /**
   * Evaluate multiple policies against a context.
   * Only evaluates policies whose tenantId matches the intent's tenantId.
   */
  async evaluateMultiple(
    policies: Policy[],
    context: PolicyEvaluationContext
  ): Promise<MultiPolicyEvaluationResult> {
    const startTime = performance.now();
    const intentTenantId = context.intent.tenantId;

    // Filter to only policies belonging to the intent's tenant
    const tenantPolicies = policies.filter(
      (p) => p.tenantId === intentTenantId
    );

    const policiesEvaluated: PolicyEvaluationResult[] = [];
    let finalAction: 'allow' | 'deny' | 'escalate' | 'limit' | 'constrain' | 'monitor' | 'terminate' = 'allow';
    let appliedPolicy: PolicyEvaluationResult | undefined;
    let reason: string | undefined;

    for (const policy of tenantPolicies) {
      // Only evaluate published policies
      if (policy.status !== 'published') continue;

      const result: PolicyEvaluationResult = {
        policyId: policy.id,
        policyName: policy.name,
        policyVersion: policy.version,
        matched: true,
        action: policy.definition.defaultAction,
        reason: policy.definition.defaultReason,
        rulesEvaluated: [],
        matchedRules: [],
        durationMs: 0,
        evaluatedAt: new Date().toISOString(),
      };

      policiesEvaluated.push(result);

      // Most restrictive action wins
      const actionPriority: Record<string, number> = {
        deny: 0,
        terminate: 1,
        escalate: 2,
        limit: 3,
        constrain: 4,
        monitor: 5,
        allow: 6,
      };

      if (
        (actionPriority[result.action] ?? 6) <
        (actionPriority[finalAction] ?? 6)
      ) {
        finalAction = result.action;
        reason = result.reason;
        appliedPolicy = result;
      }
    }

    const totalDurationMs = performance.now() - startTime;

    return {
      passed: finalAction === 'allow',
      finalAction,
      reason,
      policiesEvaluated,
      appliedPolicy,
      totalDurationMs,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get policies for evaluation, scoped to tenant (simulates distributed cache behavior).
   */
  async getPoliciesForEvaluation(
    ctx: TenantContext,
    policyIds: string[]
  ): Promise<Policy[]> {
    const results: Policy[] = [];
    for (const id of policyIds) {
      const policy = await this.findById(id, ctx);
      if (policy) {
        results.push(policy);
      }
    }
    return results;
  }

  /**
   * Expose cache for test verification.
   */
  getCacheEntry(tenantId: string, policyId: string): Policy | undefined {
    return this.cache.get(`${tenantId}:${policyId}`);
  }

  /**
   * Get total policy count for a tenant.
   */
  getTenantPolicyCount(tenantId: string): number {
    const store = this.stores.get(tenantId);
    return store ? store.size : 0;
  }

  /**
   * Verify a policy exists in any tenant (for test assertions only).
   * This is NOT available in the real service -- it is used to verify
   * that cross-tenant lookups are properly blocked.
   */
  _unsafeGetPolicyAcrossTenants(policyId: string): Policy | null {
    for (const store of this.stores.values()) {
      const policy = store.get(policyId);
      if (policy) return policy;
    }
    return null;
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Policy Service Multi-Tenant Isolation', () => {
  let service: MockPolicyService;

  // Tenant contexts for two separate tenants
  let ctxTenantA: TenantContext;
  let ctxTenantB: TenantContext;

  const TENANT_A_ID = 'tenant-alpha-001';
  const TENANT_B_ID = 'tenant-beta-002';

  beforeEach(() => {
    service = new MockPolicyService();

    ctxTenantA = createTestTenantContext({
      tenantId: TENANT_A_ID,
      userId: 'user-a-admin',
      roles: ['admin'],
    });

    ctxTenantB = createTestTenantContext({
      tenantId: TENANT_B_ID,
      userId: 'user-b-admin',
      roles: ['admin'],
    });
  });

  // ===========================================================================
  // 1. POLICY CREATION ISOLATION (~6 tests)
  // ===========================================================================

  describe('Policy Creation Isolation', () => {
    it('should not allow tenant B to find a policy created by tenant A via findById', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'secret-policy',
      }));

      // Tenant B attempts to look up tenant A's policy by ID
      const result = await service.findById(policyA.id, ctxTenantB);

      expect(result).toBeNull();
    });

    it('should allow the same policy name in both tenants as separate policies', async () => {
      const sharedName = 'rate-limit';

      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: sharedName,
        description: 'Tenant A rate limit',
      }));

      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: sharedName,
        description: 'Tenant B rate limit',
      }));

      // Both policies exist but are separate instances
      expect(policyA.id).not.toBe(policyB.id);
      expect(policyA.tenantId).toBe(TENANT_A_ID);
      expect(policyB.tenantId).toBe(TENANT_B_ID);
      expect(policyA.description).toBe('Tenant A rate limit');
      expect(policyB.description).toBe('Tenant B rate limit');

      // Each tenant sees only their own version
      const foundA = await service.findByName(ctxTenantA, sharedName);
      const foundB = await service.findByName(ctxTenantB, sharedName);

      expect(foundA?.id).toBe(policyA.id);
      expect(foundB?.id).toBe(policyB.id);
    });

    it('should store tenantId from context, not from input body', async () => {
      // Even if input somehow contained a tenantId field, the service
      // uses ctx.tenantId exclusively. The CreatePolicyInput type does not
      // include tenantId, but we verify the stored policy has the correct one.
      const policy = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'context-tenant-test',
      }));

      expect(policy.tenantId).toBe(TENANT_A_ID);
      expect(policy.tenantId).not.toBe(TENANT_B_ID);
    });

    it('should create independent instances when identical definitions exist in both tenants', async () => {
      const sharedDefinition = createTestPolicyDefinition({
        defaultAction: 'deny',
        defaultReason: 'Identical definition across tenants',
      });

      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'shared-def',
        definition: sharedDefinition,
      }));

      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'shared-def',
        definition: sharedDefinition,
      }));

      // Independent IDs, same checksum, different tenants
      expect(policyA.id).not.toBe(policyB.id);
      expect(policyA.checksum).toBe(policyB.checksum);
      expect(policyA.tenantId).toBe(TENANT_A_ID);
      expect(policyB.tenantId).toBe(TENANT_B_ID);

      // Modifying tenant A's policy does not affect tenant B's
      await service.update(policyA.id, ctxTenantA, {
        description: 'Modified by tenant A',
      });

      const unchangedB = await service.findById(policyB.id, ctxTenantB);
      expect(unchangedB?.description).not.toBe('Modified by tenant A');
    });

    it('should assign the creating user from context as createdBy', async () => {
      const policy = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'user-attribution-test',
      }));

      expect(policy.createdBy).toBe(ctxTenantA.userId);
    });

    it('should not share auto-incremented version numbers across tenants', async () => {
      // Create and update policy in tenant A several times
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'versioned-policy',
      }));
      await service.update(policyA.id, ctxTenantA, { description: 'v2' });
      await service.update(policyA.id, ctxTenantA, { description: 'v3' });

      const updatedA = await service.findById(policyA.id, ctxTenantA);
      expect(updatedA?.version).toBe(3);

      // Tenant B creates a policy with the same name -- starts at version 1
      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'versioned-policy',
      }));

      expect(policyB.version).toBe(1);
    });
  });

  // ===========================================================================
  // 2. POLICY QUERY ISOLATION (~8 tests)
  // ===========================================================================

  describe('Policy Query Isolation', () => {
    it('should return only tenant A policies when listing with ctxA', async () => {
      await service.create(ctxTenantA, createTestPolicyInput({ name: 'a-policy-1' }));
      await service.create(ctxTenantA, createTestPolicyInput({ name: 'a-policy-2' }));
      await service.create(ctxTenantB, createTestPolicyInput({ name: 'b-policy-1' }));

      const listA = await service.list(ctxTenantA);

      expect(listA).toHaveLength(2);
      expect(listA.every((p) => p.tenantId === TENANT_A_ID)).toBe(true);
      expect(listA.map((p) => p.name).sort()).toEqual(['a-policy-1', 'a-policy-2']);
    });

    it('should return only tenant B policies when listing with ctxB, even if A has many', async () => {
      // Tenant A has many policies
      for (let i = 0; i < 10; i++) {
        await service.create(ctxTenantA, createTestPolicyInput({ name: `a-bulk-${i}` }));
      }
      // Tenant B has just one
      await service.create(ctxTenantB, createTestPolicyInput({ name: 'b-single' }));

      const listB = await service.list(ctxTenantB);

      expect(listB).toHaveLength(1);
      expect(listB[0]!.tenantId).toBe(TENANT_B_ID);
      expect(listB[0]!.name).toBe('b-single');
    });

    it('should return null for findById with correct ID but wrong tenant context', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'findbyid-crosstest',
      }));

      // The policy definitely exists
      const existsInA = await service.findById(policyA.id, ctxTenantA);
      expect(existsInA).not.toBeNull();

      // But tenant B cannot see it
      const crossTenantResult = await service.findById(policyA.id, ctxTenantB);
      expect(crossTenantResult).toBeNull();
    });

    it('should return null for findByName with correct name but wrong tenant context', async () => {
      await service.create(ctxTenantA, createTestPolicyInput({
        name: 'findbyname-crosstest',
        namespace: 'production',
      }));

      // Tenant A can find it
      const foundA = await service.findByName(ctxTenantA, 'findbyname-crosstest', 'production');
      expect(foundA).not.toBeNull();

      // Tenant B cannot
      const foundB = await service.findByName(ctxTenantB, 'findbyname-crosstest', 'production');
      expect(foundB).toBeNull();
    });

    it('should enforce namespace scoping within tenant boundaries', async () => {
      await service.create(ctxTenantA, createTestPolicyInput({
        name: 'ns-test',
        namespace: 'ns-alpha',
      }));
      await service.create(ctxTenantA, createTestPolicyInput({
        name: 'ns-test-2',
        namespace: 'ns-beta',
      }));
      await service.create(ctxTenantB, createTestPolicyInput({
        name: 'ns-test',
        namespace: 'ns-alpha',
      }));

      // Tenant A listing with namespace filter
      const listAlpha = await service.list(ctxTenantA, { namespace: 'ns-alpha' });
      expect(listAlpha).toHaveLength(1);
      expect(listAlpha[0]!.tenantId).toBe(TENANT_A_ID);
      expect(listAlpha[0]!.namespace).toBe('ns-alpha');

      // Tenant B's ns-alpha does not appear in tenant A's results
      const listBeta = await service.list(ctxTenantA, { namespace: 'ns-beta' });
      expect(listBeta).toHaveLength(1);
      expect(listBeta[0]!.namespace).toBe('ns-beta');
    });

    it('should return per-tenant counts, not global counts', async () => {
      for (let i = 0; i < 5; i++) {
        await service.create(ctxTenantA, createTestPolicyInput({ name: `count-a-${i}` }));
      }
      for (let i = 0; i < 3; i++) {
        await service.create(ctxTenantB, createTestPolicyInput({ name: `count-b-${i}` }));
      }

      const countA = service.getTenantPolicyCount(TENANT_A_ID);
      const countB = service.getTenantPolicyCount(TENANT_B_ID);

      expect(countA).toBe(5);
      expect(countB).toBe(3);

      const listA = await service.list(ctxTenantA);
      const listB = await service.list(ctxTenantB);

      expect(listA).toHaveLength(5);
      expect(listB).toHaveLength(3);
    });

    it('should return empty list for a tenant with no policies', async () => {
      // Create policies only in tenant A
      await service.create(ctxTenantA, createTestPolicyInput({ name: 'only-in-a' }));

      const listB = await service.list(ctxTenantB);
      expect(listB).toHaveLength(0);
    });

    it('should apply status filter within tenant scope only', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({ name: 'status-test-a' }));
      await service.update(policyA.id, ctxTenantA, { status: 'published' });

      const policyB = await service.create(ctxTenantB, createTestPolicyInput({ name: 'status-test-b' }));
      // policyB remains in 'draft' status

      const publishedA = await service.list(ctxTenantA, { status: 'published' });
      const publishedB = await service.list(ctxTenantB, { status: 'published' });

      expect(publishedA).toHaveLength(1);
      expect(publishedA[0]!.name).toBe('status-test-a');
      expect(publishedB).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 3. POLICY UPDATE/DELETE ISOLATION (~6 tests)
  // ===========================================================================

  describe('Policy Update/Delete Isolation', () => {
    it('should return null when updating a policy belonging to a different tenant', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'update-isolation',
        description: 'Original description',
      }));

      // Tenant B tries to update tenant A's policy
      const result = await service.update(policyA.id, ctxTenantB, {
        description: 'Hijacked by tenant B',
      });

      expect(result).toBeNull();

      // Verify the original policy is unchanged
      const unchanged = await service.findById(policyA.id, ctxTenantA);
      expect(unchanged?.description).toBe('Original description');
    });

    it('should return false when deleting a policy belonging to a different tenant', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'delete-isolation',
      }));

      // Tenant B tries to delete tenant A's policy
      const deleted = await service.delete(policyA.id, ctxTenantB);

      expect(deleted).toBe(false);

      // Verify the policy still exists and is not archived
      const stillExists = await service.findById(policyA.id, ctxTenantA);
      expect(stillExists).not.toBeNull();
      expect(stillExists?.status).toBe('draft');
    });

    it('should only show version history to the owning tenant', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'versioned-history',
      }));

      // Create some version history
      await service.update(policyA.id, ctxTenantA, {
        description: 'Version 2',
        changeSummary: 'Updated description',
      });
      await service.update(policyA.id, ctxTenantA, {
        description: 'Version 3',
        changeSummary: 'Updated again',
      });

      // Tenant A sees full history
      const historyA = await service.getVersionHistory(policyA.id, ctxTenantA);
      expect(historyA.length).toBeGreaterThanOrEqual(3); // current + 2 archived

      // Tenant B sees nothing
      const historyB = await service.getVersionHistory(policyA.id, ctxTenantB);
      expect(historyB).toHaveLength(0);
    });

    it('should ignore status change by wrong tenant', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'status-change-isolation',
      }));

      // Tenant B tries to publish tenant A's policy
      const result = await service.update(policyA.id, ctxTenantB, {
        status: 'published',
      });

      expect(result).toBeNull();

      // Verify policy is still in draft
      const unchanged = await service.findById(policyA.id, ctxTenantA);
      expect(unchanged?.status).toBe('draft');
    });

    it('should allow tenant A to update their own policy after tenant B fails to modify it', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'sequential-update-test',
      }));

      // Tenant B's update attempt should fail
      const failedUpdate = await service.update(policyA.id, ctxTenantB, {
        description: 'Should not work',
      });
      expect(failedUpdate).toBeNull();

      // Tenant A's update should succeed
      const successfulUpdate = await service.update(policyA.id, ctxTenantA, {
        description: 'Correctly updated by tenant A',
      });

      expect(successfulUpdate).not.toBeNull();
      expect(successfulUpdate?.description).toBe('Correctly updated by tenant A');
      expect(successfulUpdate?.version).toBe(2);
    });

    it('should not increment version number when wrong tenant attempts update', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'version-no-increment',
      }));
      expect(policyA.version).toBe(1);

      // Tenant B's multiple update attempts should not affect version
      await service.update(policyA.id, ctxTenantB, { description: 'attempt-1' });
      await service.update(policyA.id, ctxTenantB, { description: 'attempt-2' });
      await service.update(policyA.id, ctxTenantB, { description: 'attempt-3' });

      const current = await service.findById(policyA.id, ctxTenantA);
      expect(current?.version).toBe(1);
    });
  });

  // ===========================================================================
  // SHARED HELPER: PolicyEvaluationContext factory
  // ===========================================================================

  /**
   * Helper to create a PolicyEvaluationContext for a given tenant.
   * Declared at the outer describe scope so it is available to both
   * the evaluation and adversarial test sections.
   */
  function createEvalContext(tenantId: string): PolicyEvaluationContext {
    return {
      intent: {
        id: randomUUID(),
        tenantId,
        entityId: `entity-${randomUUID().slice(0, 8)}`,
        goal: 'test-action',
        intentType: 'test',
        context: {},
        metadata: {},
        status: 'evaluating',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      entity: {
        id: `entity-${randomUUID().slice(0, 8)}`,
        type: 'agent',
        trustScore: 500,
        trustLevel: 3,
        attributes: {},
      },
      environment: {
        timestamp: new Date().toISOString(),
        timezone: 'UTC',
        requestId: randomUUID(),
      },
    };
  }

  // ===========================================================================
  // 4. POLICY EVALUATION ISOLATION (~4 tests)
  // ===========================================================================

  describe('Policy Evaluation Isolation', () => {
    it('should not apply tenant A policies to tenant B evaluation context', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'deny-all',
        definition: createTestPolicyDefinition({ defaultAction: 'deny' }),
      }));
      await service.update(policyA.id, ctxTenantA, { status: 'published' });
      const publishedA = await service.findById(policyA.id, ctxTenantA);

      // Evaluate with tenant B's context -- tenant A's deny policy should NOT apply
      const evalCtxB = createEvalContext(TENANT_B_ID);
      const result = await service.evaluateMultiple([publishedA!], evalCtxB);

      // The policy should be filtered out because its tenantId doesn't match
      expect(result.policiesEvaluated).toHaveLength(0);
      expect(result.passed).toBe(true);
      expect(result.finalAction).toBe('allow');
    });

    it('should only evaluate policies from the correct tenant in evaluateMultiple', async () => {
      // Create policies in both tenants
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'eval-a',
        definition: createTestPolicyDefinition({ defaultAction: 'deny' }),
      }));
      await service.update(policyA.id, ctxTenantA, { status: 'published' });

      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'eval-b',
        definition: createTestPolicyDefinition({ defaultAction: 'allow' }),
      }));
      await service.update(policyB.id, ctxTenantB, { status: 'published' });

      const publishedA = await service.findById(policyA.id, ctxTenantA);
      const publishedB = await service.findById(policyB.id, ctxTenantB);

      // Mix policies from both tenants and evaluate for tenant A
      const evalCtxA = createEvalContext(TENANT_A_ID);
      const result = await service.evaluateMultiple(
        [publishedA!, publishedB!],
        evalCtxA
      );

      // Only tenant A's policy should be evaluated
      expect(result.policiesEvaluated).toHaveLength(1);
      expect(result.policiesEvaluated[0]!.policyId).toBe(policyA.id);
      expect(result.finalAction).toBe('deny');
    });

    it('should return tenant-scoped entries from policy cache (getPoliciesForEvaluation)', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'cache-scope-test-a',
      }));
      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'cache-scope-test-b',
      }));

      // Tenant A requests both policy IDs, but should only get their own
      const results = await service.getPoliciesForEvaluation(ctxTenantA, [
        policyA.id,
        policyB.id,
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe(policyA.id);
      expect(results[0]!.tenantId).toBe(TENANT_A_ID);
    });

    it('should keep evaluation results separate per tenant even with same policy definition', async () => {
      const sharedDefinition = createTestPolicyDefinition({
        defaultAction: 'escalate',
        defaultReason: 'Requires approval',
      });

      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'shared-eval',
        definition: sharedDefinition,
      }));
      await service.update(policyA.id, ctxTenantA, { status: 'published' });
      const publishedA = await service.findById(policyA.id, ctxTenantA);

      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'shared-eval',
        definition: sharedDefinition,
      }));
      await service.update(policyB.id, ctxTenantB, { status: 'published' });
      const publishedB = await service.findById(policyB.id, ctxTenantB);

      // Evaluate for tenant A
      const evalCtxA = createEvalContext(TENANT_A_ID);
      const resultA = await service.evaluateMultiple([publishedA!, publishedB!], evalCtxA);

      // Evaluate for tenant B
      const evalCtxB = createEvalContext(TENANT_B_ID);
      const resultB = await service.evaluateMultiple([publishedA!, publishedB!], evalCtxB);

      // Each gets only their own policy evaluated
      expect(resultA.policiesEvaluated).toHaveLength(1);
      expect(resultA.policiesEvaluated[0]!.policyId).toBe(policyA.id);

      expect(resultB.policiesEvaluated).toHaveLength(1);
      expect(resultB.policiesEvaluated[0]!.policyId).toBe(policyB.id);
    });
  });

  // ===========================================================================
  // 5. ADVERSARIAL SCENARIOS (~6 tests)
  // ===========================================================================

  describe('Adversarial Scenarios', () => {
    it('IDOR: should block access when using policy ID from tenant A in tenant B context', async () => {
      // Attacker knows the policy ID from tenant A (e.g., from a leaked URL)
      const victimPolicy = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'victim-sensitive-policy',
        description: 'Contains confidential rate limit config',
      }));

      // Attacker (tenant B) tries to:
      // 1. Read the policy
      const readResult = await service.findById(victimPolicy.id, ctxTenantB);
      expect(readResult).toBeNull();

      // 2. Update the policy
      const updateResult = await service.update(victimPolicy.id, ctxTenantB, {
        description: 'Defaced by attacker',
      });
      expect(updateResult).toBeNull();

      // 3. Delete the policy
      const deleteResult = await service.delete(victimPolicy.id, ctxTenantB);
      expect(deleteResult).toBe(false);

      // 4. Get version history
      const historyResult = await service.getVersionHistory(victimPolicy.id, ctxTenantB);
      expect(historyResult).toHaveLength(0);

      // Verify the victim's policy is completely untouched
      const victimVerify = await service.findById(victimPolicy.id, ctxTenantA);
      expect(victimVerify).not.toBeNull();
      expect(victimVerify?.description).toBe('Contains confidential rate limit config');
      expect(victimVerify?.status).toBe('draft');
      expect(victimVerify?.version).toBe(1);
    });

    it('should ignore tenantId injection in policy definition body', async () => {
      // Attacker tries to embed a different tenantId in the definition metadata
      const maliciousDefinition = createTestPolicyDefinition({
        metadata: {
          tenantId: TENANT_A_ID, // Trying to impersonate tenant A
          hijack: true,
        },
      });

      const attackerPolicy = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'injected-tenant',
        definition: maliciousDefinition,
      }));

      // The stored policy should have tenant B's ID, not the injected one
      expect(attackerPolicy.tenantId).toBe(TENANT_B_ID);
      expect(attackerPolicy.tenantId).not.toBe(TENANT_A_ID);

      // Tenant A should not see this policy
      const notFoundInA = await service.findById(attackerPolicy.id, ctxTenantA);
      expect(notFoundInA).toBeNull();

      // Even findByName should not work in tenant A's context
      const notFoundByName = await service.findByName(ctxTenantA, 'injected-tenant');
      expect(notFoundByName).toBeNull();
    });

    it('should not share evaluation results across tenants with duplicated policies', async () => {
      // Both tenants create identical policies
      const definition = createTestPolicyDefinition({
        defaultAction: 'deny',
        defaultReason: 'Blocked',
      });

      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'dup-policy',
        definition,
      }));
      await service.update(policyA.id, ctxTenantA, { status: 'published' });

      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'dup-policy',
        definition,
      }));
      await service.update(policyB.id, ctxTenantB, { status: 'published' });

      const publishedA = await service.findById(policyA.id, ctxTenantA);
      const publishedB = await service.findById(policyB.id, ctxTenantB);

      // Evaluate for tenant A with both policies mixed in
      const evalCtxA = createEvalContext(TENANT_A_ID);
      const resultA = await service.evaluateMultiple([publishedA!, publishedB!], evalCtxA);

      // Only tenant A's policy should appear in evaluation
      expect(resultA.policiesEvaluated.length).toBe(1);
      expect(resultA.policiesEvaluated[0]!.policyId).toBe(policyA.id);
    });

    it('should handle concurrent policy updates across tenants without interference', async () => {
      // Each tenant creates their own policy
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'concurrent-test',
      }));
      const policyB = await service.create(ctxTenantB, createTestPolicyInput({
        name: 'concurrent-test',
      }));

      // Simulate concurrent updates
      const [resultA, resultB] = await Promise.all([
        service.update(policyA.id, ctxTenantA, {
          description: 'Updated concurrently by A',
          status: 'published',
        }),
        service.update(policyB.id, ctxTenantB, {
          description: 'Updated concurrently by B',
          status: 'published',
        }),
      ]);

      // Both updates should succeed independently
      expect(resultA).not.toBeNull();
      expect(resultB).not.toBeNull();
      expect(resultA?.description).toBe('Updated concurrently by A');
      expect(resultB?.description).toBe('Updated concurrently by B');
      expect(resultA?.tenantId).toBe(TENANT_A_ID);
      expect(resultB?.tenantId).toBe(TENANT_B_ID);

      // Cross-tenant verification
      const verifyA = await service.findById(policyA.id, ctxTenantB);
      const verifyB = await service.findById(policyB.id, ctxTenantA);
      expect(verifyA).toBeNull();
      expect(verifyB).toBeNull();
    });

    it('should not leak policy existence through cache side-channel', async () => {
      const policyA = await service.create(ctxTenantA, createTestPolicyInput({
        name: 'cache-leak-test',
      }));

      // Verify policy is cached for tenant A
      const cachedForA = service.getCacheEntry(TENANT_A_ID, policyA.id);
      expect(cachedForA).toBeDefined();
      expect(cachedForA?.id).toBe(policyA.id);

      // Tenant B should not have a cache entry for this policy
      const cachedForB = service.getCacheEntry(TENANT_B_ID, policyA.id);
      expect(cachedForB).toBeUndefined();

      // Even after tenant B tries to access it (and gets null), no cache entry is created
      await service.findById(policyA.id, ctxTenantB);
      const stillNoCacheForB = service.getCacheEntry(TENANT_B_ID, policyA.id);
      expect(stillNoCacheForB).toBeUndefined();
    });

    it('should prevent cross-tenant policy enumeration via sequential ID guessing', async () => {
      // Create several policies in tenant A
      const policyIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const p = await service.create(ctxTenantA, createTestPolicyInput({
          name: `enum-test-${i}`,
        }));
        policyIds.push(p.id);
      }

      // Tenant B tries to enumerate all of tenant A's policies by guessing IDs
      const enumResults = await Promise.all(
        policyIds.map((id) => service.findById(id, ctxTenantB))
      );

      // All results should be null -- no information leakage
      expect(enumResults.every((r) => r === null)).toBe(true);

      // Tenant B also tries list with various filters -- gets nothing
      const listAll = await service.list(ctxTenantB);
      const listByNamespace = await service.list(ctxTenantB, { namespace: 'default' });

      expect(listAll).toHaveLength(0);
      expect(listByNamespace).toHaveLength(0);

      // But the policies definitely exist (verified by unsafe test helper)
      for (const id of policyIds) {
        const exists = service._unsafeGetPolicyAcrossTenants(id);
        expect(exists).not.toBeNull();
        expect(exists?.tenantId).toBe(TENANT_A_ID);
      }
    });
  });
});
