/**
 * SSO Clustering Security Regression Tests
 *
 * Security regression tests for SSO state management vulnerabilities:
 * - SSO state is stored in Redis (not in-memory only)
 * - State cannot be replayed (single-use)
 * - Session validation across instances
 * - State expiration (5 min TTL)
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import {
  RedisStateStore,
  createRedisStateStore,
  type RedisStateStoreConfig,
  type ConsumeStateResult,
} from '../../src/auth/sso/redis-state-store.js';
import type { AuthorizationState } from '../../src/auth/sso/types.js';

// Mock Redis client
const mockRedisClient = {
  status: 'ready' as const,
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
  script: vi.fn(),
  eval: vi.fn(),
  evalsha: vi.fn(),
  scan: vi.fn(),
  duplicate: vi.fn().mockReturnThis(),
};

// Mock logger
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('SSO Clustering Security Regression Tests', () => {
  let stateStore: RedisStateStore;

  const createMockState = (overrides: Partial<AuthorizationState> = {}): AuthorizationState => ({
    state: `state-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nonce: `nonce-${Date.now()}`,
    providerId: 'test-provider',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockRedisClient.set.mockResolvedValue('OK');
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.del.mockResolvedValue(1);
    mockRedisClient.ttl.mockResolvedValue(300);
    mockRedisClient.script.mockResolvedValue('sha1hash');
    mockRedisClient.eval.mockResolvedValue(null);
    mockRedisClient.evalsha.mockResolvedValue(null);
    mockRedisClient.scan.mockResolvedValue(['0', []]);

    stateStore = createRedisStateStore({
      redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
      stateTtlSeconds: 300,
      enableMemoryFallback: false,
    });
  });

  afterEach(() => {
    stateStore.shutdown();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // REGRESSION: SSO State is Stored in Redis
  // ===========================================================================

  describe('SSO State is Stored in Redis', () => {
    it('should store state in Redis with SET NX command', async () => {
      const state = createMockState();

      await stateStore.set(state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('sso:state:'),
        expect.any(String),
        'EX',
        300,
        'NX'
      );
    });

    it('should use correct key prefix for state storage', async () => {
      const state = createMockState({ state: 'unique-state-123' });

      await stateStore.set(state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'sso:state:unique-state-123',
        expect.any(String),
        'EX',
        300,
        'NX'
      );
    });

    it('should serialize state data correctly for Redis storage', async () => {
      const state = createMockState({
        state: 'test-state',
        nonce: 'test-nonce',
        providerId: 'okta',
        codeVerifier: 'pkce-verifier',
        returnUrl: '/dashboard',
        tenantId: 'tenant-123',
      });

      await stateStore.set(state);

      const storedData = mockRedisClient.set.mock.calls[0][1];
      const parsed = JSON.parse(storedData);

      expect(parsed.state).toBe('test-state');
      expect(parsed.nonce).toBe('test-nonce');
      expect(parsed.providerId).toBe('okta');
      expect(parsed.codeVerifier).toBe('pkce-verifier');
      expect(parsed.returnUrl).toBe('/dashboard');
      expect(parsed.tenantId).toBe('tenant-123');
    });

    it('should retrieve state from Redis', async () => {
      const state = createMockState({ state: 'retrieve-test' });
      const serialized = JSON.stringify({
        state: state.state,
        nonce: state.nonce,
        providerId: state.providerId,
        createdAt: state.createdAt.toISOString(),
        expiresAt: state.expiresAt.toISOString(),
      });

      mockRedisClient.get.mockResolvedValueOnce(serialized);

      const retrieved = await stateStore.get('retrieve-test');

      expect(mockRedisClient.get).toHaveBeenCalledWith('sso:state:retrieve-test');
      expect(retrieved?.state).toBe('retrieve-test');
    });

    it('should throw error when Redis is unavailable and fallback is disabled', async () => {
      const noFallbackStore = createRedisStateStore({
        redis: null,
        enableMemoryFallback: false,
      });

      const state = createMockState();

      await expect(noFallbackStore.set(state)).rejects.toThrow(/Redis not available/);

      noFallbackStore.shutdown();
    });
  });

  // ===========================================================================
  // REGRESSION: State Cannot Be Replayed
  // ===========================================================================

  describe('State Cannot Be Replayed', () => {
    it('should use SET NX to prevent duplicate state creation', async () => {
      const state = createMockState();

      // First attempt succeeds
      mockRedisClient.set.mockResolvedValueOnce('OK');
      const firstResult = await stateStore.set(state);
      expect(firstResult).toBe(true);

      // Second attempt fails (state already exists)
      mockRedisClient.set.mockResolvedValueOnce(null);
      const secondResult = await stateStore.set(state);
      expect(secondResult).toBe(false);
    });

    it('should atomically consume state (get and delete in one operation)', async () => {
      const state = createMockState({ state: 'consume-test' });
      const serialized = JSON.stringify({
        state: state.state,
        nonce: state.nonce,
        providerId: state.providerId,
        createdAt: state.createdAt.toISOString(),
        expiresAt: state.expiresAt.toISOString(),
      });

      mockRedisClient.evalsha.mockResolvedValueOnce(serialized);

      const result = await stateStore.consume('consume-test');

      expect(result.success).toBe(true);
      expect(result.state?.state).toBe('consume-test');
    });

    it('should fail to consume already-consumed state', async () => {
      // First consume succeeds
      const state = createMockState({ state: 'single-use-state' });
      const serialized = JSON.stringify({
        state: state.state,
        nonce: state.nonce,
        providerId: state.providerId,
        createdAt: state.createdAt.toISOString(),
        expiresAt: state.expiresAt.toISOString(),
      });

      mockRedisClient.evalsha.mockResolvedValueOnce(serialized);
      const firstConsume = await stateStore.consume('single-use-state');
      expect(firstConsume.success).toBe(true);

      // Second consume fails (state was deleted)
      mockRedisClient.evalsha.mockResolvedValueOnce(null);
      const secondConsume = await stateStore.consume('single-use-state');
      expect(secondConsume.success).toBe(false);
      expect(secondConsume.error).toContain('not found');
    });

    it('should use Lua script for atomic consume operation', async () => {
      const state = createMockState();

      mockRedisClient.evalsha.mockResolvedValueOnce(null);

      await stateStore.consume(state.state);

      // Should attempt to use EVALSHA (atomic get+delete)
      expect(mockRedisClient.evalsha).toHaveBeenCalled();
    });

    it('should fall back to EVAL if script is not loaded', async () => {
      const errorWithNoscript = new Error('NOSCRIPT No matching script');
      mockRedisClient.evalsha
        .mockRejectedValueOnce(errorWithNoscript)
        .mockResolvedValueOnce(null);
      mockRedisClient.script.mockResolvedValueOnce('new-sha');

      await stateStore.consume('fallback-test');

      // Should have attempted script reload after NOSCRIPT error
      expect(mockRedisClient.script).toHaveBeenCalled();
    });

    it('should delete state after successful consume', async () => {
      const state = createMockState({ state: 'delete-after-consume' });
      const serialized = JSON.stringify({
        state: state.state,
        nonce: state.nonce,
        providerId: state.providerId,
        createdAt: state.createdAt.toISOString(),
        expiresAt: state.expiresAt.toISOString(),
      });

      // The Lua script returns the value and deletes atomically
      mockRedisClient.evalsha.mockResolvedValueOnce(serialized);

      const result = await stateStore.consume('delete-after-consume');

      expect(result.success).toBe(true);

      // Subsequent get should return nothing
      mockRedisClient.get.mockResolvedValueOnce(null);
      const afterConsume = await stateStore.get('delete-after-consume');
      expect(afterConsume).toBeUndefined();
    });
  });

  // ===========================================================================
  // REGRESSION: Session Validation Across Instances (Mock)
  // ===========================================================================

  describe('Session Validation Across Instances', () => {
    it('should allow state created on instance A to be consumed on instance B', async () => {
      // Simulate two instances sharing the same Redis
      const instanceA = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        keyPrefix: 'sso:state:', // Same prefix
      });

      const instanceB = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        keyPrefix: 'sso:state:', // Same prefix
      });

      const state = createMockState({ state: 'cross-instance-state' });

      // Instance A creates state
      mockRedisClient.set.mockResolvedValueOnce('OK');
      await instanceA.set(state);

      // Instance B consumes state
      const serialized = JSON.stringify({
        state: state.state,
        nonce: state.nonce,
        providerId: state.providerId,
        createdAt: state.createdAt.toISOString(),
        expiresAt: state.expiresAt.toISOString(),
      });
      mockRedisClient.evalsha.mockResolvedValueOnce(serialized);

      const result = await instanceB.consume('cross-instance-state');

      expect(result.success).toBe(true);
      expect(result.state?.state).toBe('cross-instance-state');

      instanceA.shutdown();
      instanceB.shutdown();
    });

    it('should use same key structure across instances', async () => {
      const instance1 = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        keyPrefix: 'sso:state:',
      });

      const instance2 = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        keyPrefix: 'sso:state:',
      });

      const state = createMockState({ state: 'shared-state' });

      await instance1.set(state);

      const setCall = mockRedisClient.set.mock.calls[0];
      expect(setCall[0]).toBe('sso:state:shared-state');

      instance1.shutdown();
      instance2.shutdown();
    });

    it('should prevent race conditions with SET NX', async () => {
      // Simulate two instances trying to create the same state simultaneously
      const state = createMockState({ state: 'race-condition-state' });

      // First instance wins
      mockRedisClient.set.mockResolvedValueOnce('OK');
      const result1 = await stateStore.set(state);
      expect(result1).toBe(true);

      // Second instance loses (SET NX returns null for existing key)
      mockRedisClient.set.mockResolvedValueOnce(null);
      const result2 = await stateStore.set(state);
      expect(result2).toBe(false);
    });

    it('should handle Redis cluster failover gracefully', async () => {
      const storeWithFallback = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        enableMemoryFallback: true,
      });

      const state = createMockState();

      // Simulate Redis failure
      mockRedisClient.set.mockRejectedValueOnce(new Error('Connection lost'));

      // Should fall back to memory and still succeed
      const result = await storeWithFallback.set(state);
      expect(result).toBe(true);

      storeWithFallback.shutdown();
    });
  });

  // ===========================================================================
  // REGRESSION: State Expiration (5 min TTL)
  // ===========================================================================

  describe('State Expiration (5 min TTL)', () => {
    it('should set 5 minute TTL on state creation', async () => {
      const storeWith5MinTTL = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        stateTtlSeconds: 300, // 5 minutes
      });

      const state = createMockState();
      await storeWith5MinTTL.set(state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        300, // 5 minutes
        'NX'
      );

      storeWith5MinTTL.shutdown();
    });

    it('should reject expired state on consume', async () => {
      const expiredState = createMockState({
        state: 'expired-state',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      const serialized = JSON.stringify({
        state: expiredState.state,
        nonce: expiredState.nonce,
        providerId: expiredState.providerId,
        createdAt: expiredState.createdAt.toISOString(),
        expiresAt: expiredState.expiresAt.toISOString(),
      });

      mockRedisClient.evalsha.mockResolvedValueOnce(serialized);

      const result = await stateStore.consume('expired-state');

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject expired state on get', async () => {
      const expiredState = createMockState({
        state: 'expired-get-state',
        expiresAt: new Date(Date.now() - 1000), // Expired
      });

      const serialized = JSON.stringify({
        state: expiredState.state,
        nonce: expiredState.nonce,
        providerId: expiredState.providerId,
        createdAt: expiredState.createdAt.toISOString(),
        expiresAt: expiredState.expiresAt.toISOString(),
      });

      mockRedisClient.get.mockResolvedValueOnce(serialized);

      const result = await stateStore.get('expired-get-state');

      // Should return undefined for expired state
      expect(result).toBeUndefined();

      // Should attempt to delete expired state
      expect(mockRedisClient.del).toHaveBeenCalledWith('sso:state:expired-get-state');
    });

    it('should use configurable TTL', async () => {
      const customTTLStore = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        stateTtlSeconds: 600, // 10 minutes custom TTL
      });

      const state = createMockState();
      await customTTLStore.set(state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        600, // Custom 10 minute TTL
        'NX'
      );

      customTTLStore.shutdown();
    });

    it('should default to 5 minute TTL', async () => {
      const defaultTTLStore = createRedisStateStore({
        redis: mockRedisClient as unknown as RedisStateStoreConfig['redis'],
        // No stateTtlSeconds specified
      });

      const state = createMockState();
      await defaultTTLStore.set(state);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        300, // Default 5 minutes
        'NX'
      );

      defaultTTLStore.shutdown();
    });

    it('should clean up expired memory-stored states', async () => {
      const memoryFallbackStore = createRedisStateStore({
        redis: null, // Force memory fallback
        enableMemoryFallback: true,
        stateTtlSeconds: 1, // 1 second for quick test
      });

      const state = createMockState({
        expiresAt: new Date(Date.now() + 100), // Expires in 100ms
      });

      await memoryFallbackStore.set(state);

      // State should exist initially
      const initialGet = await memoryFallbackStore.get(state.state);
      expect(initialGet).toBeDefined();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // State should be expired now
      const expiredGet = await memoryFallbackStore.get(state.state);
      expect(expiredGet).toBeUndefined();

      memoryFallbackStore.shutdown();
    });
  });

  // ===========================================================================
  // ADDITIONAL SECURITY TESTS
  // ===========================================================================

  describe('Additional SSO Security', () => {
    it('should include PKCE code verifier in stored state', async () => {
      const state = createMockState({
        state: 'pkce-state',
        codeVerifier: 'secure-random-code-verifier-for-pkce',
      });

      await stateStore.set(state);

      const storedData = mockRedisClient.set.mock.calls[0][1];
      const parsed = JSON.parse(storedData);

      expect(parsed.codeVerifier).toBe('secure-random-code-verifier-for-pkce');
    });

    it('should include tenant context in stored state', async () => {
      const state = createMockState({
        state: 'tenant-state',
        tenantId: 'tenant-abc-123',
      });

      await stateStore.set(state);

      const storedData = mockRedisClient.set.mock.calls[0][1];
      const parsed = JSON.parse(storedData);

      expect(parsed.tenantId).toBe('tenant-abc-123');
    });

    it('should preserve return URL in stored state', async () => {
      const state = createMockState({
        state: 'return-url-state',
        returnUrl: '/admin/settings?tab=security',
      });

      await stateStore.set(state);

      const storedData = mockRedisClient.set.mock.calls[0][1];
      const parsed = JSON.parse(storedData);

      expect(parsed.returnUrl).toBe('/admin/settings?tab=security');
    });

    it('should handle concurrent consume attempts correctly', async () => {
      const state = createMockState({ state: 'concurrent-state' });
      const serialized = JSON.stringify({
        state: state.state,
        nonce: state.nonce,
        providerId: state.providerId,
        createdAt: state.createdAt.toISOString(),
        expiresAt: state.expiresAt.toISOString(),
      });

      // First consume wins (atomic operation)
      mockRedisClient.evalsha.mockResolvedValueOnce(serialized);
      const result1 = stateStore.consume('concurrent-state');

      // Second consume loses
      mockRedisClient.evalsha.mockResolvedValueOnce(null);
      const result2 = stateStore.consume('concurrent-state');

      const [res1, res2] = await Promise.all([result1, result2]);

      // Only one should succeed
      const successes = [res1.success, res2.success].filter(Boolean);
      expect(successes.length).toBe(1);
    });

    it('should clear all states on shutdown request', async () => {
      mockRedisClient.scan.mockResolvedValueOnce(['0', ['sso:state:1', 'sso:state:2']]);
      mockRedisClient.del.mockResolvedValueOnce(2);

      await stateStore.clear();

      expect(mockRedisClient.scan).toHaveBeenCalled();
      expect(mockRedisClient.del).toHaveBeenCalledWith('sso:state:1', 'sso:state:2');
    });
  });
});
