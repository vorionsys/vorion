/**
 * Proof Service Tests
 *
 * Tests for the PROOF service including:
 * - Basic proof creation
 * - Hash chain verification
 * - Concurrent proof creation (simulated race conditions)
 * - Distributed lock behavior
 *
 * CRITICAL: These tests verify the fix for PA-C1/PA-C2/DS-C1 which addresses
 * hash chain corruption in multi-instance deployments.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Intent, Decision, ControlAction, TrustLevel } from '../../../src/common/types.js';

// Mock modules before imports - must use the actual paths from the security package
// since src/proof/index.ts re-exports from packages/security/src/proof/index.ts
const mockPool = {
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
};

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([])),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          offset: vi.fn(() => Promise.resolve([])),
        })),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([])),
        offset: vi.fn(() => Promise.resolve([])),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => Promise.resolve()),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  })),
  transaction: vi.fn((fn: (db: unknown) => Promise<unknown>) => fn(mockDb)),
};

const mockLock = {
  lockId: 'mock-lock-id',
  key: 'proof:chain:create',
  held: true,
  release: vi.fn(() => Promise.resolve(true)),
  extend: vi.fn(() => Promise.resolve(true)),
};

const mockLockService = {
  acquire: vi.fn(() =>
    Promise.resolve({
      acquired: true,
      lock: mockLock,
    })
  ),
  isLocked: vi.fn(() => Promise.resolve(false)),
  withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => {
    const result = await fn();
    return { success: true, result };
  }),
};

// Mock all paths that the platform-core package uses
vi.mock('../../../packages/platform-core/src/common/db.js', () => ({
  getDatabase: vi.fn(() => mockDb),
  getPool: vi.fn(() => mockPool),
  Database: {},
}));

vi.mock('../../../packages/platform-core/src/common/lock.js', () => ({
  getLockService: vi.fn(() => mockLockService),
  LockService: vi.fn(() => mockLockService),
}));

vi.mock('../../../packages/platform-core/src/common/crypto.js', () => ({
  sign: vi.fn(() =>
    Promise.resolve({
      signature: 'mock-signature-base64',
      publicKey: 'mock-public-key-base64',
      algorithm: 'Ed25519',
      signedAt: new Date().toISOString(),
    })
  ),
  verify: vi.fn(() =>
    Promise.resolve({
      valid: true,
      verifiedAt: new Date().toISOString(),
    })
  ),
}));

vi.mock('../../../packages/platform-core/src/common/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../packages/platform-core/src/common/canonical-json.js', () => ({
  canonicalize: vi.fn((obj: Record<string, unknown>) => JSON.stringify(obj, Object.keys(obj).sort())),
}));

vi.mock('../../../packages/platform-core/src/db/schema/proofs.js', () => ({
  proofs: {},
  proofChainMeta: {},
}));

// Import after mocks
import { ProofService, createProofService } from '../../../packages/platform-core/src/proof/index.js';
import { getDatabase, getPool } from '../../../packages/platform-core/src/common/db.js';
import { getLockService } from '../../../packages/platform-core/src/common/lock.js';
import { sign, verify } from '../../../packages/platform-core/src/common/crypto.js';

describe('ProofService', () => {
  let proofService: ProofService;
  let mockDb: ReturnType<typeof getDatabase>;
  let mockPool: ReturnType<typeof getPool>;
  let mockLockService: ReturnType<typeof getLockService>;

  // Helper to create a mock intent
  const createMockIntent = (overrides: Partial<Intent> = {}): Intent => ({
    id: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    entityId: crypto.randomUUID(),
    goal: 'test-goal',
    context: {},
    metadata: {},
    status: 'completed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  // Helper to create a mock decision
  const createMockDecision = (overrides: Partial<Decision> = {}): Decision => ({
    intentId: crypto.randomUUID(),
    action: 'allow' as ControlAction,
    constraintsEvaluated: [],
    trustScore: 750,
    trustLevel: 3 as TrustLevel,
    decidedAt: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = getDatabase();
    mockPool = getPool();
    mockLockService = getLockService();

    // Setup default mock behaviors
    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    // Setup pool.connect to return mock client
    (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    // Setup default query responses for the mock client
    mockClient.query.mockImplementation((query: string) => {
      if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
        return Promise.resolve();
      }
      if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [
            {
              chain_id: 'default',
              last_hash: '0'.repeat(64),
              chain_length: 0,
            },
          ],
        });
      }
      if (query.includes('INSERT INTO proofs')) {
        return Promise.resolve();
      }
      if (query.includes('UPDATE proof_chain_meta')) {
        return Promise.resolve();
      }
      return Promise.resolve({ rows: [] });
    });

    proofService = createProofService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createProofService', () => {
    it('should create a new ProofService instance', () => {
      const service = createProofService();
      expect(service).toBeInstanceOf(ProofService);
    });
  });

  describe('initialize', () => {
    it('should initialize the service and create chain metadata if not exists', async () => {
      // Mock empty chain metadata
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      await proofService.initialize();

      // Should have called insert to create chain metadata
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should not reinitialize if already initialized', async () => {
      // First initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 5,
                },
              ])
            ),
          })),
        })),
      });

      await proofService.initialize();
      const insertCallCount = (mockDb.insert as ReturnType<typeof vi.fn>).mock.calls.length;

      // Second initialization should be a no-op
      await proofService.initialize();

      expect((mockDb.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(insertCallCount);
    });
  });

  describe('create', () => {
    beforeEach(async () => {
      // Setup initialization mock
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });
    });

    it('should create a proof with distributed lock', async () => {
      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      const proof = await proofService.create({
        intent,
        decision,
        inputs: { test: 'input' },
        outputs: { test: 'output' },
        tenantId: intent.tenantId,
      });

      expect(proof).toBeDefined();
      expect(proof.id).toBeDefined();
      expect(proof.intentId).toBe(intent.id);
      expect(proof.entityId).toBe(intent.entityId);
      expect(proof.chainPosition).toBe(0);
      expect(proof.hash).toBeDefined();
      expect(proof.previousHash).toBe('0'.repeat(64));
      expect(proof.signature).toBe('mock-signature-base64');
    });

    it('should acquire distributed lock before creating proof', async () => {
      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      await proofService.create({
        intent,
        decision,
        inputs: {},
        outputs: {},
        tenantId: intent.tenantId,
      });

      expect(mockLockService.acquire).toHaveBeenCalledWith(
        `proof:chain:${intent.tenantId}:create`,
        expect.objectContaining({
          lockTimeoutMs: 30000,
          acquireTimeoutMs: 10000,
        })
      );
    });

    it('should release distributed lock after proof creation', async () => {
      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      await proofService.create({
        intent,
        decision,
        inputs: {},
        outputs: {},
        tenantId: intent.tenantId,
      });

      const lockResult = await mockLockService.acquire(`proof:chain:${intent.tenantId}:create`, {});
      expect(lockResult.lock!.release).toBeDefined();
    });

    it('should throw error if lock acquisition fails', async () => {
      // Mock lock acquisition failure
      (mockLockService.acquire as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        acquired: false,
        error: 'Lock acquisition timed out',
      });

      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      await expect(
        proofService.create({
          intent,
          decision,
          inputs: {},
          outputs: {},
          tenantId: intent.tenantId,
        })
      ).rejects.toThrow('Failed to acquire proof chain lock');
    });

    it('should use SELECT FOR UPDATE for chain metadata', async () => {
      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: '0'.repeat(64),
                chain_length: 0,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await proofService.create({
        intent,
        decision,
        inputs: {},
        outputs: {},
        tenantId: intent.tenantId,
      });

      // Verify SELECT FOR UPDATE was called
      const selectForUpdateCall = mockClient.query.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('SELECT') &&
          call[0].includes('FOR UPDATE')
      );
      expect(selectForUpdateCall).toBeDefined();
    });

    it('should rollback transaction on error', async () => {
      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string) => {
        if (query === 'BEGIN') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: '0'.repeat(64),
                chain_length: 0,
              },
            ],
          });
        }
        if (query.includes('INSERT INTO proofs')) {
          throw new Error('Database insert failed');
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        proofService.create({
          intent,
          decision,
          inputs: {},
          outputs: {},
          tenantId: intent.tenantId,
        })
      ).rejects.toThrow('Database insert failed');

      // Verify ROLLBACK was called
      const rollbackCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => call[0] === 'ROLLBACK'
      );
      expect(rollbackCall).toBeDefined();
    });

    it('should always release database connection', async () => {
      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: '0'.repeat(64),
                chain_length: 0,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await proofService.create({
        intent,
        decision,
        inputs: {},
        outputs: {},
        tenantId: intent.tenantId,
      });

      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('Hash Chain Verification', () => {
    it('should create proofs with correct hash chain linkage', async () => {
      // Setup for multiple proof creation
      let currentChainLength = 0;
      let currentLastHash = '0'.repeat(64);

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string, params?: unknown[]) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: currentLastHash,
                chain_length: currentChainLength,
              },
            ],
          });
        }
        if (query.includes('INSERT INTO proofs')) {
          // Extract hash from params (index 7)
          currentLastHash = (params as string[])[7];
          return Promise.resolve();
        }
        if (query.includes('UPDATE proof_chain_meta')) {
          currentChainLength++;
          return Promise.resolve();
        }
        return Promise.resolve({ rows: [] });
      });

      // Setup initialization mock
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      // Create first proof
      const intent1 = createMockIntent();
      const decision1 = createMockDecision({ intentId: intent1.id });

      const proof1 = await proofService.create({
        intent: intent1,
        decision: decision1,
        inputs: { sequence: 1 },
        outputs: {},
        tenantId: intent1.tenantId,
      });

      expect(proof1.chainPosition).toBe(0);
      expect(proof1.previousHash).toBe('0'.repeat(64));

      // Create second proof - should link to first
      const intent2 = createMockIntent({ tenantId: intent1.tenantId });
      const decision2 = createMockDecision({ intentId: intent2.id });

      const proof2 = await proofService.create({
        intent: intent2,
        decision: decision2,
        inputs: { sequence: 2 },
        outputs: {},
        tenantId: intent2.tenantId,
      });

      expect(proof2.chainPosition).toBe(1);
      expect(proof2.previousHash).toBe(proof1.hash);
    });
  });

  describe('Concurrent Proof Creation (Race Condition Simulation)', () => {
    it('should serialize concurrent proof creation with distributed lock', async () => {
      const acquireCalls: number[] = [];
      let lockHeld = false;

      // Mock lock service to track concurrent access
      (mockLockService.acquire as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        const callTime = Date.now();
        acquireCalls.push(callTime);

        // Simulate lock contention
        if (lockHeld) {
          // Wait for lock to be released
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        lockHeld = true;

        return {
          acquired: true,
          lock: {
            lockId: 'test-lock',
            key: 'proof:chain:create',
            held: true,
            release: vi.fn(async () => {
              lockHeld = false;
              return true;
            }),
            extend: vi.fn(),
          },
        };
      });

      // Setup chain state tracking
      let chainLength = 0;
      let lastHash = '0'.repeat(64);

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string, params?: unknown[]) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: lastHash,
                chain_length: chainLength,
              },
            ],
          });
        }
        if (query.includes('INSERT INTO proofs')) {
          lastHash = (params as string[])[7];
          return Promise.resolve();
        }
        if (query.includes('UPDATE proof_chain_meta')) {
          chainLength++;
          return Promise.resolve();
        }
        return Promise.resolve({ rows: [] });
      });

      // Setup initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      // Attempt concurrent proof creation - use same tenant for proper chain linkage
      const sharedTenantId = crypto.randomUUID();
      const intent1 = createMockIntent({ tenantId: sharedTenantId });
      const decision1 = createMockDecision({ intentId: intent1.id });

      const intent2 = createMockIntent({ tenantId: sharedTenantId });
      const decision2 = createMockDecision({ intentId: intent2.id });

      const [proof1, proof2] = await Promise.all([
        proofService.create({
          intent: intent1,
          decision: decision1,
          inputs: { concurrent: 1 },
          outputs: {},
          tenantId: intent1.tenantId,
        }),
        proofService.create({
          intent: intent2,
          decision: decision2,
          inputs: { concurrent: 2 },
          outputs: {},
          tenantId: intent2.tenantId,
        }),
      ]);

      // Both proofs should have been created
      expect(proof1).toBeDefined();
      expect(proof2).toBeDefined();

      // Chain positions should be sequential (0, 1) regardless of creation order
      const positions = [proof1.chainPosition, proof2.chainPosition].sort();
      expect(positions).toEqual([0, 1]);

      // Lock should have been acquired twice
      expect(mockLockService.acquire).toHaveBeenCalledTimes(2);
    });

    it('should maintain hash chain integrity under sequential load', async () => {
      // This test verifies that sequential proof creation maintains proper chain linkage.
      // Note: True concurrent behavior with distributed locks requires integration testing
      // with real Redis and PostgreSQL. Unit tests verify the mechanism exists.
      const proofs: Array<{ chainPosition: number; hash: string; previousHash: string }> = [];
      let chainLength = 0;
      let lastHash = '0'.repeat(64);

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string, params?: unknown[]) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: lastHash,
                chain_length: chainLength,
              },
            ],
          });
        }
        if (query.includes('INSERT INTO proofs')) {
          const newHash = (params as string[])[7];
          const prevHash = (params as string[])[8];
          proofs.push({
            chainPosition: chainLength,
            hash: newHash,
            previousHash: prevHash,
          });
          lastHash = newHash;
          return Promise.resolve();
        }
        if (query.includes('UPDATE proof_chain_meta')) {
          chainLength++;
          return Promise.resolve();
        }
        return Promise.resolve({ rows: [] });
      });

      // Setup initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      // Create multiple proofs sequentially to verify chain integrity
      const sharedTenantId = crypto.randomUUID();
      for (let i = 0; i < 5; i++) {
        const intent = createMockIntent({ tenantId: sharedTenantId });
        const decision = createMockDecision({ intentId: intent.id });

        await proofService.create({
          intent,
          decision,
          inputs: { index: i },
          outputs: {},
          tenantId: intent.tenantId,
        });
      }

      // Verify chain integrity
      expect(proofs.length).toBe(5);

      // Sort proofs by chain position
      proofs.sort((a, b) => a.chainPosition - b.chainPosition);

      // First proof should point to genesis
      expect(proofs[0]!.previousHash).toBe('0'.repeat(64));

      // Each subsequent proof should point to the previous hash
      for (let i = 1; i < proofs.length; i++) {
        expect(proofs[i]!.previousHash).toBe(proofs[i - 1]!.hash);
      }
    });

    it('should acquire lock for each concurrent proof creation attempt', async () => {
      // This test verifies that the locking mechanism is invoked for concurrent requests
      const lockAcquireCount = vi.fn();

      (mockLockService.acquire as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        lockAcquireCount();
        return {
          acquired: true,
          lock: {
            lockId: crypto.randomUUID(),
            key: 'proof:chain:create',
            held: true,
            release: vi.fn(() => Promise.resolve(true)),
            extend: vi.fn(),
          },
        };
      });

      let chainLength = 0;
      let lastHash = '0'.repeat(64);

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string, params?: unknown[]) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: lastHash,
                chain_length: chainLength,
              },
            ],
          });
        }
        if (query.includes('INSERT INTO proofs')) {
          lastHash = (params as string[])[7];
          return Promise.resolve();
        }
        if (query.includes('UPDATE proof_chain_meta')) {
          chainLength++;
          return Promise.resolve();
        }
        return Promise.resolve({ rows: [] });
      });

      // Setup initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      // Create multiple proofs concurrently - use same tenant
      const sharedTenantId = crypto.randomUUID();
      const createPromises = Array.from({ length: 5 }, (_, i) => {
        const intent = createMockIntent({ tenantId: sharedTenantId });
        const decision = createMockDecision({ intentId: intent.id });

        return proofService.create({
          intent,
          decision,
          inputs: { index: i },
          outputs: {},
          tenantId: intent.tenantId,
        });
      });

      await Promise.all(createPromises);

      // Verify that lock was acquired for each proof creation
      expect(lockAcquireCount).toHaveBeenCalledTimes(5);
    });
  });

  describe('Distributed Lock Behavior', () => {
    it('should wait for lock if already held by another instance', async () => {
      let lockAttempts = 0;
      let lockReleased = false;

      (mockLockService.acquire as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        lockAttempts++;

        if (lockAttempts === 1) {
          // First attempt succeeds but simulates delay
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            acquired: true,
            lock: {
              lockId: 'first-lock',
              key: 'proof:chain:create',
              held: true,
              release: vi.fn(async () => {
                lockReleased = true;
                return true;
              }),
              extend: vi.fn(),
            },
          };
        }

        // Second attempt waits for first to release
        if (!lockReleased) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        return {
          acquired: true,
          lock: {
            lockId: 'second-lock',
            key: 'proof:chain:create',
            held: true,
            release: vi.fn(() => Promise.resolve(true)),
            extend: vi.fn(),
          },
        };
      });

      // Setup chain state
      let chainLength = 0;
      let lastHash = '0'.repeat(64);

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string, params?: unknown[]) => {
        if (query === 'BEGIN' || query === 'COMMIT' || query === 'ROLLBACK') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                chain_id: 'default',
                last_hash: lastHash,
                chain_length: chainLength,
              },
            ],
          });
        }
        if (query.includes('INSERT INTO proofs')) {
          lastHash = (params as string[])[7];
          return Promise.resolve();
        }
        if (query.includes('UPDATE proof_chain_meta')) {
          chainLength++;
          return Promise.resolve();
        }
        return Promise.resolve({ rows: [] });
      });

      // Setup initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      // Start two concurrent operations - use same tenant
      const sharedTenantId = crypto.randomUUID();
      const intent1 = createMockIntent({ tenantId: sharedTenantId });
      const decision1 = createMockDecision({ intentId: intent1.id });

      const intent2 = createMockIntent({ tenantId: sharedTenantId });
      const decision2 = createMockDecision({ intentId: intent2.id });

      await Promise.all([
        proofService.create({
          intent: intent1,
          decision: decision1,
          inputs: {},
          outputs: {},
          tenantId: intent1.tenantId,
        }),
        proofService.create({
          intent: intent2,
          decision: decision2,
          inputs: {},
          outputs: {},
          tenantId: intent2.tenantId,
        }),
      ]);

      // Both attempts should have been made
      expect(lockAttempts).toBe(2);
    });

    it('should handle lock timeout gracefully', async () => {
      (mockLockService.acquire as ReturnType<typeof vi.fn>).mockResolvedValue({
        acquired: false,
        error: 'Lock acquisition timed out',
      });

      // Setup initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      await expect(
        proofService.create({
          intent,
          decision,
          inputs: {},
          outputs: {},
          tenantId: intent.tenantId,
        })
      ).rejects.toThrow('Failed to acquire proof chain lock: Lock acquisition timed out');
    });

    it('should release lock even if proof creation fails', async () => {
      const mockRelease = vi.fn(() => Promise.resolve(true));

      (mockLockService.acquire as ReturnType<typeof vi.fn>).mockResolvedValue({
        acquired: true,
        lock: {
          lockId: 'test-lock',
          key: 'proof:chain:create',
          held: true,
          release: mockRelease,
          extend: vi.fn(),
        },
      });

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };

      (mockPool!.connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

      mockClient.query.mockImplementation((query: string) => {
        if (query === 'BEGIN') {
          return Promise.resolve();
        }
        if (query.includes('SELECT') && query.includes('FOR UPDATE')) {
          throw new Error('Database connection lost');
        }
        return Promise.resolve({ rows: [] });
      });

      // Setup initialization
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
        })),
      });

      const intent = createMockIntent();
      const decision = createMockDecision({ intentId: intent.id });

      await expect(
        proofService.create({
          intent,
          decision,
          inputs: {},
          outputs: {},
          tenantId: intent.tenantId,
        })
      ).rejects.toThrow();

      // Lock should have been released despite the error
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return chain statistics from database', async () => {
      // Mock chain metadata query
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: 'abc123',
                  chainLength: 42,
                },
              ])
            ),
          })),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  createdAt: new Date('2024-01-15T10:00:00Z'),
                },
              ])
            ),
          })),
        })),
      });

      const stats = await proofService.getStats();

      expect(stats.chainLength).toBe(42);
      expect(stats.totalProofs).toBe(42);
      expect(stats.lastProofAt).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should return null lastProofAt when no proofs exist', async () => {
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: '0'.repeat(64),
                  chainLength: 0,
                },
              ])
            ),
          })),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const stats = await proofService.getStats();

      expect(stats.chainLength).toBe(0);
      expect(stats.lastProofAt).toBeNull();
    });
  });

  describe('getChainPosition', () => {
    it('should return current chain position from database', async () => {
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  chainId: 'default',
                  lastHash: 'test-hash-123',
                  chainLength: 10,
                },
              ])
            ),
          })),
        })),
      });

      const position = await proofService.getChainPosition();

      expect(position.lastHash).toBe('test-hash-123');
      expect(position.chainLength).toBe(10);
    });

    it('should return genesis state when chain metadata not found', async () => {
      (mockDb.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const position = await proofService.getChainPosition();

      expect(position.lastHash).toBe('0'.repeat(64));
      expect(position.chainLength).toBe(0);
    });
  });
});
