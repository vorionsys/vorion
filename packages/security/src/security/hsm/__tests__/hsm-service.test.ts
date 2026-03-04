/**
 * Tests for HSMService and KeyCeremonyManager
 *
 * Validates:
 * - HSMService initialization, shutdown, and provider lifecycle
 * - Key generation, retrieval, and caching via executeWithFailover
 * - Cryptographic operations (sign, verify, encrypt, decrypt)
 * - Automatic failover when primary provider fails
 * - Status reporting and metrics tracking
 * - KeyCeremonyManager creation and validation rules
 * - Ceremony lifecycle (start, mark present, submit shares, cancel)
 * - Master key generation with Shamir secret splitting
 * - Ceremony integrity verification via audit trail signatures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IHSMProvider, KeyHandle, KeySpec, HSMStatus } from '../provider';
import { KeyType, KeyUsage } from '../provider';
import {
  CeremonyType,
  CeremonyStatus,
  CustodianRole,
  type CeremonyConfig,
  type KeyCustodian,
} from '../key-ceremony';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../common/circuit-breaker.js', () => ({
  withCircuitBreakerResult: vi.fn().mockImplementation(async (_name: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      return { success: true, result, circuitOpen: false };
    } catch (error) {
      return { success: false, error, circuitOpen: false };
    }
  }),
  CircuitBreakerOpenError: class extends Error {
    constructor(name: string) {
      super(`Circuit open: ${name}`);
    }
  },
}));

/**
 * Build a fresh mock IHSMProvider that satisfies the full interface.
 * Each call to createMockProvider() returns a distinct set of vi.fn() spies
 * so parallel tests do not share state.
 */
function createMockProvider(overrides: Partial<Record<string, unknown>> = {}): IHSMProvider {
  const emitter = new EventEmitter();
  const base = {
    name: 'MockHSM',
    isProduction: false,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({
      connected: true,
      healthy: true,
      provider: 'MockHSM',
      lastHealthCheck: new Date(),
    } satisfies HSMStatus),
    generateKey: vi.fn().mockResolvedValue({
      id: 'key-1',
      label: 'test',
      type: KeyType.AES,
      usage: [KeyUsage.ENCRYPT],
      createdAt: new Date(),
      extractable: false,
    } satisfies KeyHandle),
    importKey: vi.fn().mockResolvedValue({
      id: 'key-2',
      label: 'imported',
      type: KeyType.AES,
      usage: [KeyUsage.ENCRYPT],
      createdAt: new Date(),
      extractable: false,
    } satisfies KeyHandle),
    getKey: vi.fn().mockResolvedValue({
      id: 'key-1',
      label: 'test',
      type: KeyType.AES,
      usage: [KeyUsage.ENCRYPT],
      createdAt: new Date(),
      extractable: false,
    } satisfies KeyHandle),
    listKeys: vi.fn().mockResolvedValue([]),
    exportPublicKey: vi.fn().mockResolvedValue(Buffer.from('pubkey')),
    destroyKey: vi.fn().mockResolvedValue(undefined),
    sign: vi.fn().mockResolvedValue(Buffer.from('signature')),
    verify: vi.fn().mockResolvedValue(true),
    encrypt: vi.fn().mockResolvedValue(Buffer.from('encrypted')),
    decrypt: vi.fn().mockResolvedValue(Buffer.from('decrypted')),
    wrapKey: vi.fn().mockResolvedValue(Buffer.from('wrapped')),
    unwrapKey: vi.fn().mockResolvedValue('unwrapped-key-id'),
    getAuditLogs: vi.fn().mockResolvedValue([]),
    ...overrides,
  };

  // Merge EventEmitter methods onto the mock so it satisfies the interface
  const mock = Object.assign(emitter, base) as unknown as IHSMProvider;
  return mock;
}

/**
 * Factory function that the mocked SoftHSMProvider constructor delegates to.
 * Tests override this to control which provider instance is returned.
 */
let softHSMFactory: () => IHSMProvider = () => createMockProvider();

vi.mock('../aws-cloudhsm', () => ({ AWSCloudHSMProvider: vi.fn() }));
vi.mock('../azure-hsm', () => ({ AzureHSMProvider: vi.fn() }));
vi.mock('../gcp-hsm', () => ({ GCPHSMProvider: vi.fn() }));
vi.mock('../thales-luna', () => ({ ThalesLunaProvider: vi.fn() }));

/**
 * The source code calls `new SoftHSMProvider(config)`, so the mock must be
 * a real class (constructor function) rather than a plain vi.fn(). We define
 * a thin class whose constructor delegates to the test-controlled factory.
 */
vi.mock('../local-softHSM', () => {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class MockSoftHSMProvider {
    constructor() {
      // Return the provider built by the current test's factory.
      // In JS, returning an object from a constructor replaces `this`.
      return softHSMFactory();
    }
  }
  return { SoftHSMProvider: MockSoftHSMProvider };
});

// Import after mocks are registered
import { HSMService, type HSMServiceConfig } from '../hsm-service.js';
import { KeyCeremonyManager } from '../key-ceremony.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid HSMServiceConfig pointing at our mocked SoftHSM provider. */
function makeConfig(overrides: Partial<HSMServiceConfig> = {}): HSMServiceConfig {
  return {
    primary: { type: 'softhsm', config: { name: 'test', tokenLabel: 'test' } },
    enableFailover: false,
    healthCheckInterval: 60_000, // long interval so timer doesn't fire during tests
    ...overrides,
  };
}

/** Build custodians suitable for a ceremony with the given share count. */
function makeCustodians(keyHolderCount: number, witnessCount = 0): KeyCustodian[] {
  const custodians: KeyCustodian[] = [];
  for (let i = 0; i < keyHolderCount; i++) {
    custodians.push({
      id: `holder-${i}`,
      name: `Holder ${i}`,
      email: `holder${i}@example.com`,
      role: CustodianRole.KEY_HOLDER,
    });
  }
  for (let i = 0; i < witnessCount; i++) {
    custodians.push({
      id: `witness-${i}`,
      name: `Witness ${i}`,
      email: `witness${i}@example.com`,
      role: CustodianRole.WITNESS,
    });
  }
  return custodians;
}

// ===========================================================================
// HSMService
// ===========================================================================

describe('HSMService', () => {
  let service: HSMService;
  let mockProvider: IHSMProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    // Every `new SoftHSMProvider(...)` in this suite returns our mockProvider
    softHSMFactory = () => mockProvider;
  });

  afterEach(async () => {
    // Ensure timers and resources are cleaned up
    try {
      await service?.shutdown();
    } catch {
      // ignore if already shut down or not yet created
    }
  });

  // -------------------------------------------------------------------------
  // 1. initialize() connects primary provider, sets activeProvider
  // -------------------------------------------------------------------------
  it('initialize() connects the primary provider and reports initialized status', async () => {
    service = new HSMService(makeConfig());
    await service.initialize();

    expect((mockProvider.connect as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((mockProvider.getStatus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();

    const status = await service.getStatus();
    expect(status.initialized).toBe(true);
    expect(status.activeProvider).toBe('MockHSM');
    expect(status.providers.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 2. generateKey delegates to provider via executeWithFailover
  // -------------------------------------------------------------------------
  it('generateKey delegates to the active provider', async () => {
    service = new HSMService(makeConfig());
    await service.initialize();

    const spec: KeySpec = {
      label: 'my-key',
      type: KeyType.AES,
      size: 256,
      usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
      extractable: false,
    };

    const key = await service.generateKey(spec);

    expect(key).toBeDefined();
    expect(key.id).toBe('key-1');
    expect((mockProvider.generateKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(spec);
  });

  // -------------------------------------------------------------------------
  // 3. sign/verify delegates to provider
  // -------------------------------------------------------------------------
  it('sign and verify delegate to the active provider', async () => {
    service = new HSMService(makeConfig());
    await service.initialize();

    const data = Buffer.from('hello');

    const signature = await service.sign('key-1', data, 'HMAC-SHA256');
    expect(Buffer.isBuffer(signature)).toBe(true);
    expect((mockProvider.sign as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('key-1', data, 'HMAC-SHA256');

    const valid = await service.verify('key-1', data, signature, 'HMAC-SHA256');
    expect(valid).toBe(true);
    expect((mockProvider.verify as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'key-1',
      data,
      signature,
      'HMAC-SHA256',
    );
  });

  // -------------------------------------------------------------------------
  // 4. encrypt/decrypt delegates to provider
  // -------------------------------------------------------------------------
  it('encrypt and decrypt delegate to the active provider', async () => {
    service = new HSMService(makeConfig());
    await service.initialize();

    const plaintext = Buffer.from('secret');
    const ciphertext = await service.encrypt('key-1', plaintext);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect((mockProvider.encrypt as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('key-1', plaintext, undefined);

    const decrypted = await service.decrypt('key-1', ciphertext);
    expect(Buffer.isBuffer(decrypted)).toBe(true);
    expect((mockProvider.decrypt as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('key-1', ciphertext, undefined);
  });

  // -------------------------------------------------------------------------
  // 5. getKey uses cache on second call
  // -------------------------------------------------------------------------
  it('getKey returns cached key on second call without hitting the provider again', async () => {
    service = new HSMService(makeConfig({ enableKeyCache: true, keyCacheTTL: 300 }));
    await service.initialize();

    // First call: provider is queried
    const key1 = await service.getKey('key-1');
    expect(key1).toBeDefined();
    expect((mockProvider.getKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    // Second call: served from cache -- provider NOT called again
    const key2 = await service.getKey('key-1');
    expect(key2).toBeDefined();
    expect(key2!.id).toBe('key-1');
    expect((mockProvider.getKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 6. failover: when primary fails N times, switches to failover provider
  // -------------------------------------------------------------------------
  it('fails over to a secondary provider after maxRetriesBeforeFailover failures', async () => {
    // Primary provider will fail on generateKey
    const failingProvider = createMockProvider({
      name: 'FailingHSM',
      generateKey: vi.fn().mockRejectedValue(new Error('HSM unavailable')),
    });

    // Failover provider succeeds
    const failoverProvider = createMockProvider({
      name: 'FailoverHSM',
    });

    // Track which constructor call we're on so the first `new SoftHSMProvider`
    // returns the failing primary and the second returns the failover.
    let callIndex = 0;
    const providers = [failingProvider, failoverProvider];
    softHSMFactory = () => providers[callIndex++] ?? failoverProvider;

    service = new HSMService(
      makeConfig({
        enableFailover: true,
        maxRetriesBeforeFailover: 2,
        failover: [{ type: 'softhsm', config: { name: 'failover', tokenLabel: 'failover' } }],
      }),
    );
    await service.initialize();

    const spec: KeySpec = {
      label: 'failover-key',
      type: KeyType.AES,
      size: 256,
      usage: [KeyUsage.ENCRYPT],
      extractable: false,
    };

    // Primary fails twice (maxRetries=2), then failover provider handles the call
    const key = await service.generateKey(spec);
    expect(key).toBeDefined();
    expect(key.id).toBe('key-1');

    // Primary's generateKey was called exactly maxRetriesBeforeFailover times
    expect((failingProvider.generateKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    // Failover's generateKey was called once
    expect((failoverProvider.generateKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 7. getStatus returns initialized status with provider info
  // -------------------------------------------------------------------------
  it('getStatus reflects correct initialization state and provider metadata', async () => {
    service = new HSMService(makeConfig());

    // Before initialization
    const beforeStatus = await service.getStatus();
    expect(beforeStatus.initialized).toBe(false);
    expect(beforeStatus.activeProvider).toBeNull();

    await service.initialize();

    const afterStatus = await service.getStatus();
    expect(afterStatus.initialized).toBe(true);
    expect(afterStatus.activeProvider).toBe('MockHSM');
    expect(afterStatus.providers).toHaveLength(1);
    expect(afterStatus.providers[0].isActive).toBe(true);
    expect(afterStatus.metrics).toBeDefined();
    expect(afterStatus.metrics.totalOperations).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 8. getMetrics tracks operations
  // -------------------------------------------------------------------------
  it('getMetrics reflects operations that have been performed', async () => {
    service = new HSMService(makeConfig());
    await service.initialize();

    const before = service.getMetrics();
    expect(before.totalOperations).toBe(0);
    expect(before.successfulOperations).toBe(0);

    await service.generateKey({
      label: 'metric-key',
      type: KeyType.AES,
      size: 256,
      usage: [KeyUsage.ENCRYPT],
      extractable: false,
    });

    const after = service.getMetrics();
    expect(after.totalOperations).toBe(1);
    expect(after.successfulOperations).toBe(1);
    expect(after.operationsByType['generateKey']).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 9. shutdown disconnects all providers
  // -------------------------------------------------------------------------
  it('shutdown disconnects all providers and resets state', async () => {
    service = new HSMService(makeConfig());
    await service.initialize();

    await service.shutdown();

    expect((mockProvider.disconnect as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    const status = await service.getStatus();
    expect(status.initialized).toBe(false);
    expect(status.activeProvider).toBeNull();
  });
});

// ===========================================================================
// KeyCeremonyManager
// ===========================================================================

describe('KeyCeremonyManager', () => {
  let manager: KeyCeremonyManager;
  let mockProvider: IHSMProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    manager = new KeyCeremonyManager(mockProvider);
  });

  // -------------------------------------------------------------------------
  // 10. createCeremony validates config (totalShares >= 2)
  // -------------------------------------------------------------------------
  it('createCeremony rejects totalShares < 2', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      totalShares: 1,
      requiredShares: 1,
      custodians: makeCustodians(1),
    };

    await expect(manager.createCeremony(config)).rejects.toThrow('Total shares must be at least 2');
  });

  // -------------------------------------------------------------------------
  // 11. createCeremony rejects if requiredShares > totalShares
  // -------------------------------------------------------------------------
  it('createCeremony rejects requiredShares > totalShares', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      totalShares: 3,
      requiredShares: 5,
      custodians: makeCustodians(5),
    };

    await expect(manager.createCeremony(config)).rejects.toThrow(
      'Required shares cannot exceed total shares',
    );
  });

  // -------------------------------------------------------------------------
  // 12. startCeremony requires PENDING status
  // -------------------------------------------------------------------------
  it('startCeremony throws when ceremony is not PENDING', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      totalShares: 3,
      requiredShares: 2,
      custodians: makeCustodians(3),
    };

    const ceremony = await manager.createCeremony(config);

    // Mark all custodians present (no dual control/witness requirements)
    for (const c of config.custodians) {
      await manager.markCustodianPresent(ceremony.id, c.id);
    }

    // Start the ceremony (transitions to IN_PROGRESS)
    await manager.startCeremony(ceremony.id);

    // Attempting to start again should fail
    await expect(manager.startCeremony(ceremony.id)).rejects.toThrow(
      'Ceremony cannot be started from status',
    );
  });

  // -------------------------------------------------------------------------
  // 13. markCustodianPresent adds to presentCustodians
  // -------------------------------------------------------------------------
  it('markCustodianPresent records the custodian as present', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      totalShares: 2,
      requiredShares: 2,
      custodians: makeCustodians(2),
    };

    const ceremony = await manager.createCeremony(config);
    await manager.markCustodianPresent(ceremony.id, 'holder-0');

    const updated = manager.getCeremony(ceremony.id);
    expect(updated).toBeDefined();
    expect(updated!.presentCustodians).toContain('holder-0');
  });

  // -------------------------------------------------------------------------
  // 14. executeMasterKeyGeneration generates key and splits shares
  // -------------------------------------------------------------------------
  it('executeMasterKeyGeneration creates key in HSM and distributes shares', async () => {
    const keySpec: KeySpec = {
      label: 'master-key',
      type: KeyType.AES,
      size: 256,
      usage: [KeyUsage.ENCRYPT, KeyUsage.DECRYPT],
      extractable: false,
    };

    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      keySpec,
      totalShares: 3,
      requiredShares: 2,
      custodians: makeCustodians(3),
    };

    const ceremony = await manager.createCeremony(config);

    // Mark all custodians present and start
    for (const c of config.custodians) {
      await manager.markCustodianPresent(ceremony.id, c.id);
    }
    await manager.startCeremony(ceremony.id);

    const keyHandle = await manager.executeMasterKeyGeneration(ceremony.id);

    expect(keyHandle).toBeDefined();
    expect(keyHandle.id).toBe('key-1');

    // Provider should have been called to generate two keys (master + KEK)
    // and then destroy the extractable KEK
    expect((mockProvider.generateKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect((mockProvider.destroyKey as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    // Ceremony should be COMPLETED with shares distributed
    const completed = manager.getCeremony(ceremony.id);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe(CeremonyStatus.COMPLETED);
    expect(completed!.shares).toHaveLength(3);
    expect(completed!.keyHandle).toBe('key-1');
  });

  // -------------------------------------------------------------------------
  // 15. submitShare collects shares, transitions to SHARES_COLLECTED
  // -------------------------------------------------------------------------
  it('submitShare collects shares and transitions to SHARES_COLLECTED when threshold met', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.KEY_RECOVERY,
      totalShares: 3,
      requiredShares: 2,
      custodians: makeCustodians(3),
    };

    const ceremony = await manager.createCeremony(config);

    // Mark present and start
    for (const c of config.custodians) {
      await manager.markCustodianPresent(ceremony.id, c.id);
    }
    await manager.startCeremony(ceremony.id);

    // Submit first share -- should transition to AWAITING_SHARES
    const share1 = Buffer.alloc(33);
    share1[0] = 1;
    await manager.submitShare(ceremony.id, 'holder-0', share1);

    let updated = manager.getCeremony(ceremony.id);
    expect(updated!.status).toBe(CeremonyStatus.AWAITING_SHARES);

    // Submit second share -- should transition to SHARES_COLLECTED (requiredShares = 2)
    const share2 = Buffer.alloc(33);
    share2[0] = 2;
    await manager.submitShare(ceremony.id, 'holder-1', share2);

    updated = manager.getCeremony(ceremony.id);
    expect(updated!.status).toBe(CeremonyStatus.SHARES_COLLECTED);
    expect(updated!.shares).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 16. cancelCeremony changes status to CANCELLED
  // -------------------------------------------------------------------------
  it('cancelCeremony transitions to CANCELLED with optional reason', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      totalShares: 2,
      requiredShares: 2,
      custodians: makeCustodians(2),
    };

    const ceremony = await manager.createCeremony(config);
    await manager.cancelCeremony(ceremony.id, 'Security concern');

    const cancelled = manager.getCeremony(ceremony.id);
    expect(cancelled).toBeDefined();
    expect(cancelled!.status).toBe(CeremonyStatus.CANCELLED);
    expect(cancelled!.error).toBe('Security concern');
  });

  // -------------------------------------------------------------------------
  // 17. verifyCeremonyIntegrity returns true for valid audit trail
  // -------------------------------------------------------------------------
  it('verifyCeremonyIntegrity returns true when audit signatures are intact', async () => {
    const config: CeremonyConfig = {
      type: CeremonyType.MASTER_KEY_GENERATION,
      totalShares: 2,
      requiredShares: 2,
      custodians: makeCustodians(2),
    };

    const ceremony = await manager.createCeremony(config);

    // createCeremony adds an audit entry with a SHA-256 signature.
    // verifyCeremonyIntegrity recalculates the hash and compares.
    const isValid = manager.verifyCeremonyIntegrity(ceremony.id);
    expect(isValid).toBe(true);
  });
});
