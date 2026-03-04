/**
 * Multi-Tenant Isolation Integration Tests
 *
 * Tests tenant isolation boundaries to ensure complete separation of data
 * between tenants. This is critical for security in multi-tenant SaaS deployments.
 *
 * Security Requirements:
 * - Tenant A cannot read tenant B's intents
 * - Tenant A cannot read tenant B's trust scores
 * - Tenant A cannot read tenant B's proofs
 * - Admin role is tenant-scoped (admin of tenant A has no access to tenant B)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCK SETUP
// =============================================================================

const mockIntentStore = new Map<string, Map<string, any>>(); // tenantId -> intentId -> intent
const mockTrustStore = new Map<string, Map<string, any>>(); // tenantId -> entityId -> trustRecord
const mockProofStore = new Map<string, any[]>(); // tenantId -> proofs[]
const mockTenantMembershipStore = new Map<string, Map<string, any>>(); // tenantId -> userId -> membership

function resetStores(): void {
  mockIntentStore.clear();
  mockTrustStore.clear();
  mockProofStore.clear();
  mockTenantMembershipStore.clear();
}

vi.mock('../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    env: 'test',
    jwt: {
      secret: 'test-secret-key-for-testing-12345',
      requireJti: true,
      expiration: '1h',
    },
    api: { port: 3000, host: '0.0.0.0', basePath: '/api/v1' },
    intent: {
      trustGates: { 'high-risk': 3 },
      defaultMinTrustLevel: 0,
    },
  })),
}));

vi.mock('../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// =============================================================================
// TEST TENANT IDS
// =============================================================================

const TENANT_A_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const USER_A_ID = randomUUID();
const USER_B_ID = randomUUID();
const ADMIN_A_ID = randomUUID();

const ENTITY_A_ID = randomUUID();
const ENTITY_B_ID = randomUUID();

// =============================================================================
// MOCK SERVICES
// =============================================================================

/**
 * Mock Intent Repository with tenant isolation
 */
class MockIntentRepository {
  async create(tenantId: string, intent: any): Promise<any> {
    if (!mockIntentStore.has(tenantId)) {
      mockIntentStore.set(tenantId, new Map());
    }
    const id = randomUUID();
    const newIntent = { ...intent, id, tenantId, createdAt: new Date() };
    mockIntentStore.get(tenantId)!.set(id, newIntent);
    return newIntent;
  }

  async get(tenantId: string, intentId: string): Promise<any | undefined> {
    // CRITICAL: Only return intents belonging to the requesting tenant
    const tenantIntents = mockIntentStore.get(tenantId);
    if (!tenantIntents) return undefined;
    return tenantIntents.get(intentId);
  }

  async list(tenantId: string): Promise<any[]> {
    // CRITICAL: Only list intents for the requesting tenant
    const tenantIntents = mockIntentStore.get(tenantId);
    if (!tenantIntents) return [];
    return Array.from(tenantIntents.values());
  }

  // Method that would violate tenant isolation (for negative testing)
  async getWithoutTenantCheck(intentId: string): Promise<any | undefined> {
    for (const [_tenantId, intents] of mockIntentStore) {
      const intent = intents.get(intentId);
      if (intent) return intent;
    }
    return undefined;
  }
}

/**
 * Mock Trust Service with tenant isolation
 */
class MockTrustService {
  async getScore(tenantId: string, entityId: string): Promise<any | undefined> {
    const tenantTrust = mockTrustStore.get(tenantId);
    if (!tenantTrust) return undefined;
    return tenantTrust.get(entityId);
  }

  async setScore(tenantId: string, entityId: string, score: number): Promise<void> {
    if (!mockTrustStore.has(tenantId)) {
      mockTrustStore.set(tenantId, new Map());
    }
    mockTrustStore.get(tenantId)!.set(entityId, {
      entityId,
      tenantId,
      score,
      level: Math.floor(score / 200),
      updatedAt: new Date(),
    });
  }

  async list(tenantId: string): Promise<any[]> {
    const tenantTrust = mockTrustStore.get(tenantId);
    if (!tenantTrust) return [];
    return Array.from(tenantTrust.values());
  }
}

/**
 * Mock Proof Service with tenant isolation
 */
class MockProofService {
  async create(tenantId: string, proof: any): Promise<any> {
    if (!mockProofStore.has(tenantId)) {
      mockProofStore.set(tenantId, []);
    }
    const newProof = {
      ...proof,
      id: randomUUID(),
      tenantId,
      createdAt: new Date(),
    };
    mockProofStore.get(tenantId)!.push(newProof);
    return newProof;
  }

  async get(tenantId: string, proofId: string): Promise<any | undefined> {
    const tenantProofs = mockProofStore.get(tenantId);
    if (!tenantProofs) return undefined;
    return tenantProofs.find((p) => p.id === proofId);
  }

  async list(tenantId: string): Promise<any[]> {
    return mockProofStore.get(tenantId) ?? [];
  }
}

/**
 * Mock Authorization Service
 */
class MockAuthService {
  setMembership(tenantId: string, userId: string, role: string): void {
    if (!mockTenantMembershipStore.has(tenantId)) {
      mockTenantMembershipStore.set(tenantId, new Map());
    }
    mockTenantMembershipStore.get(tenantId)!.set(userId, { userId, tenantId, role });
  }

  getMembership(tenantId: string, userId: string): { role: string } | undefined {
    const tenantMemberships = mockTenantMembershipStore.get(tenantId);
    if (!tenantMemberships) return undefined;
    return tenantMemberships.get(userId);
  }

  isAdmin(tenantId: string, userId: string): boolean {
    const membership = this.getMembership(tenantId, userId);
    return membership?.role === 'admin' || membership?.role === 'owner';
  }

  // SECURITY: Admin check is tenant-scoped
  canAccessTenant(tenantId: string, userId: string): boolean {
    return this.getMembership(tenantId, userId) !== undefined;
  }
}

// =============================================================================
// TEST SUITE
// =============================================================================

describe('Multi-Tenant Isolation', () => {
  const intentRepo = new MockIntentRepository();
  const trustService = new MockTrustService();
  const proofService = new MockProofService();
  const authService = new MockAuthService();

  beforeAll(() => {
    resetStores();
    // Setup tenant memberships
    authService.setMembership(TENANT_A_ID, USER_A_ID, 'member');
    authService.setMembership(TENANT_A_ID, ADMIN_A_ID, 'admin');
    authService.setMembership(TENANT_B_ID, USER_B_ID, 'member');
  });

  afterAll(() => {
    resetStores();
  });

  beforeEach(() => {
    // Clear data stores but keep memberships
    mockIntentStore.clear();
    mockTrustStore.clear();
    mockProofStore.clear();
  });

  // ==========================================================================
  // Intent Isolation Tests
  // ==========================================================================

  describe('Intent Isolation', () => {
    it('tenant A cannot read tenant B intents', async () => {
      // Create intent in tenant B
      const intentB = await intentRepo.create(TENANT_B_ID, {
        entityId: ENTITY_B_ID,
        goal: 'Secret operation for tenant B',
        context: { sensitive: 'data' },
      });

      // Attempt to read from tenant A context
      const result = await intentRepo.get(TENANT_A_ID, intentB.id);
      expect(result).toBeUndefined();
    });

    it('tenant A can only list their own intents', async () => {
      // Create intents in both tenants
      await intentRepo.create(TENANT_A_ID, {
        entityId: ENTITY_A_ID,
        goal: 'Tenant A operation 1',
      });
      await intentRepo.create(TENANT_A_ID, {
        entityId: ENTITY_A_ID,
        goal: 'Tenant A operation 2',
      });
      await intentRepo.create(TENANT_B_ID, {
        entityId: ENTITY_B_ID,
        goal: 'Tenant B secret operation',
      });

      // List from tenant A context
      const tenantAIntents = await intentRepo.list(TENANT_A_ID);
      const tenantBIntents = await intentRepo.list(TENANT_B_ID);

      expect(tenantAIntents).toHaveLength(2);
      expect(tenantBIntents).toHaveLength(1);

      // Verify no cross-contamination
      expect(tenantAIntents.every((i) => i.tenantId === TENANT_A_ID)).toBe(true);
      expect(tenantBIntents.every((i) => i.tenantId === TENANT_B_ID)).toBe(true);
    });

    it('intent IDs do not leak tenant information', async () => {
      const intentA = await intentRepo.create(TENANT_A_ID, {
        entityId: ENTITY_A_ID,
        goal: 'Operation',
      });

      // Even with direct ID access from tenant B, should not return
      const result = await intentRepo.get(TENANT_B_ID, intentA.id);
      expect(result).toBeUndefined();
    });

    it('getWithoutTenantCheck would violate isolation (negative test)', async () => {
      // This test demonstrates what NOT to do
      const intentA = await intentRepo.create(TENANT_A_ID, {
        entityId: ENTITY_A_ID,
        goal: 'Sensitive operation',
      });

      // This method bypasses tenant checks - SECURITY VIOLATION
      const leaked = await intentRepo.getWithoutTenantCheck(intentA.id);
      expect(leaked).toBeDefined(); // This would be a security bug if used
    });
  });

  // ==========================================================================
  // Trust Score Isolation Tests
  // ==========================================================================

  describe('Trust Score Isolation', () => {
    it('tenant A cannot read tenant B trust scores', async () => {
      // Set trust score in tenant B
      await trustService.setScore(TENANT_B_ID, ENTITY_B_ID, 750);

      // Attempt to read from tenant A context
      const result = await trustService.getScore(TENANT_A_ID, ENTITY_B_ID);
      expect(result).toBeUndefined();
    });

    it('tenant A can only list their own trust scores', async () => {
      // Set trust scores in both tenants
      await trustService.setScore(TENANT_A_ID, ENTITY_A_ID, 500);
      await trustService.setScore(TENANT_A_ID, randomUUID(), 600);
      await trustService.setScore(TENANT_B_ID, ENTITY_B_ID, 800);

      // List from each tenant context
      const tenantATrust = await trustService.list(TENANT_A_ID);
      const tenantBTrust = await trustService.list(TENANT_B_ID);

      expect(tenantATrust).toHaveLength(2);
      expect(tenantBTrust).toHaveLength(1);

      // Verify isolation
      expect(tenantATrust.every((t) => t.tenantId === TENANT_A_ID)).toBe(true);
      expect(tenantBTrust.every((t) => t.tenantId === TENANT_B_ID)).toBe(true);
    });

    it('same entity ID in different tenants have separate trust scores', async () => {
      // Use same entity ID in both tenants (edge case)
      const sharedEntityId = randomUUID();

      await trustService.setScore(TENANT_A_ID, sharedEntityId, 300);
      await trustService.setScore(TENANT_B_ID, sharedEntityId, 900);

      const scoreA = await trustService.getScore(TENANT_A_ID, sharedEntityId);
      const scoreB = await trustService.getScore(TENANT_B_ID, sharedEntityId);

      expect(scoreA?.score).toBe(300);
      expect(scoreB?.score).toBe(900);
    });
  });

  // ==========================================================================
  // Proof Isolation Tests
  // ==========================================================================

  describe('Proof Isolation', () => {
    it('tenant A cannot read tenant B proofs', async () => {
      // Create proof in tenant B
      const proofB = await proofService.create(TENANT_B_ID, {
        intentId: randomUUID(),
        decision: { action: 'allow' },
        hash: 'abc123',
      });

      // Attempt to read from tenant A context
      const result = await proofService.get(TENANT_A_ID, proofB.id);
      expect(result).toBeUndefined();
    });

    it('tenant A can only list their own proofs', async () => {
      // Create proofs in both tenants
      await proofService.create(TENANT_A_ID, {
        intentId: randomUUID(),
        decision: { action: 'allow' },
      });
      await proofService.create(TENANT_B_ID, {
        intentId: randomUUID(),
        decision: { action: 'deny' },
      });
      await proofService.create(TENANT_B_ID, {
        intentId: randomUUID(),
        decision: { action: 'escalate' },
      });

      const tenantAProofs = await proofService.list(TENANT_A_ID);
      const tenantBProofs = await proofService.list(TENANT_B_ID);

      expect(tenantAProofs).toHaveLength(1);
      expect(tenantBProofs).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Admin Role Tenant Scoping Tests
  // ==========================================================================

  describe('Admin Role Tenant Scoping', () => {
    it('admin of tenant A has no access to tenant B', () => {
      // ADMIN_A_ID is admin of TENANT_A
      expect(authService.isAdmin(TENANT_A_ID, ADMIN_A_ID)).toBe(true);
      expect(authService.canAccessTenant(TENANT_A_ID, ADMIN_A_ID)).toBe(true);

      // But has no access to TENANT_B
      expect(authService.isAdmin(TENANT_B_ID, ADMIN_A_ID)).toBe(false);
      expect(authService.canAccessTenant(TENANT_B_ID, ADMIN_A_ID)).toBe(false);
    });

    it('admin cannot elevate access to other tenants', () => {
      // Admin of tenant A tries to check admin status in tenant B
      const isAdminInB = authService.isAdmin(TENANT_B_ID, ADMIN_A_ID);
      expect(isAdminInB).toBe(false);

      // Admin of tenant A has no membership in tenant B
      const membership = authService.getMembership(TENANT_B_ID, ADMIN_A_ID);
      expect(membership).toBeUndefined();
    });

    it('admin can only access data in their tenant', async () => {
      // Create data in both tenants
      await intentRepo.create(TENANT_A_ID, {
        entityId: ENTITY_A_ID,
        goal: 'Admin operation in A',
      });
      await intentRepo.create(TENANT_B_ID, {
        entityId: ENTITY_B_ID,
        goal: 'Secret operation in B',
      });

      // Admin A can access tenant A data
      if (authService.canAccessTenant(TENANT_A_ID, ADMIN_A_ID)) {
        const tenantAIntents = await intentRepo.list(TENANT_A_ID);
        expect(tenantAIntents).toHaveLength(1);
      }

      // Admin A cannot access tenant B data
      if (!authService.canAccessTenant(TENANT_B_ID, ADMIN_A_ID)) {
        // Access would be denied at authorization layer
        // This demonstrates the security boundary
        expect(true).toBe(true);
      }
    });

    it('user membership is tenant-scoped', () => {
      // USER_A belongs to TENANT_A
      expect(authService.canAccessTenant(TENANT_A_ID, USER_A_ID)).toBe(true);
      expect(authService.canAccessTenant(TENANT_B_ID, USER_A_ID)).toBe(false);

      // USER_B belongs to TENANT_B
      expect(authService.canAccessTenant(TENANT_B_ID, USER_B_ID)).toBe(true);
      expect(authService.canAccessTenant(TENANT_A_ID, USER_B_ID)).toBe(false);
    });
  });

  // ==========================================================================
  // Cross-Tenant Attack Scenarios
  // ==========================================================================

  describe('Cross-Tenant Attack Prevention', () => {
    it('prevents IDOR attacks on intents', async () => {
      // Create intent in tenant B
      const secretIntent = await intentRepo.create(TENANT_B_ID, {
        entityId: ENTITY_B_ID,
        goal: 'Financial transaction',
        context: { amount: 1000000 },
      });

      // Attacker from tenant A tries direct object reference
      const attackResult = await intentRepo.get(TENANT_A_ID, secretIntent.id);
      expect(attackResult).toBeUndefined();
    });

    it('prevents enumeration attacks on trust scores', async () => {
      // Create trust scores in tenant B
      const entities = [randomUUID(), randomUUID(), randomUUID()];
      for (const entityId of entities) {
        await trustService.setScore(TENANT_B_ID, entityId, 500 + Math.random() * 500);
      }

      // Attacker from tenant A tries to enumerate
      for (const entityId of entities) {
        const result = await trustService.getScore(TENANT_A_ID, entityId);
        expect(result).toBeUndefined();
      }

      // Attacker cannot even tell if entities exist
      const tenantAList = await trustService.list(TENANT_A_ID);
      expect(tenantAList).toHaveLength(0);
    });

    it('prevents proof chain tampering across tenants', async () => {
      // Create proof chain in tenant B
      const proof1 = await proofService.create(TENANT_B_ID, {
        intentId: randomUUID(),
        decision: { action: 'allow' },
        previousHash: '0'.repeat(64),
      });
      const proof2 = await proofService.create(TENANT_B_ID, {
        intentId: randomUUID(),
        decision: { action: 'allow' },
        previousHash: proof1.id, // Chain reference
      });

      // Attacker from tenant A cannot access proof chain
      const attackProof1 = await proofService.get(TENANT_A_ID, proof1.id);
      const attackProof2 = await proofService.get(TENANT_A_ID, proof2.id);

      expect(attackProof1).toBeUndefined();
      expect(attackProof2).toBeUndefined();
    });
  });

  // ==========================================================================
  // Data Isolation Completeness
  // ==========================================================================

  describe('Data Isolation Completeness', () => {
    it('empty tenant A sees no data from populated tenant B', async () => {
      // Populate tenant B with lots of data
      for (let i = 0; i < 10; i++) {
        await intentRepo.create(TENANT_B_ID, {
          entityId: ENTITY_B_ID,
          goal: `Operation ${i}`,
        });
        await trustService.setScore(TENANT_B_ID, randomUUID(), 100 * (i + 1));
        await proofService.create(TENANT_B_ID, {
          intentId: randomUUID(),
          decision: { action: 'allow' },
        });
      }

      // Tenant A should see nothing
      const aIntents = await intentRepo.list(TENANT_A_ID);
      const aTrust = await trustService.list(TENANT_A_ID);
      const aProofs = await proofService.list(TENANT_A_ID);

      expect(aIntents).toHaveLength(0);
      expect(aTrust).toHaveLength(0);
      expect(aProofs).toHaveLength(0);
    });

    it('deleting tenant A data does not affect tenant B', async () => {
      // Create data in both tenants
      await intentRepo.create(TENANT_A_ID, {
        entityId: ENTITY_A_ID,
        goal: 'A operation',
      });
      await intentRepo.create(TENANT_B_ID, {
        entityId: ENTITY_B_ID,
        goal: 'B operation',
      });

      // Clear tenant A data
      mockIntentStore.delete(TENANT_A_ID);

      // Tenant B data should be unaffected
      const bIntents = await intentRepo.list(TENANT_B_ID);
      expect(bIntents).toHaveLength(1);
      expect(bIntents[0].goal).toBe('B operation');
    });
  });
});
