/**
 * Tests for database and Redis resilience / circuit breaker patterns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the redis module
vi.mock('../../../src/common/redis.js', () => ({
  getRedis: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
  })),
}));

// Mock the db module
vi.mock('../../../src/common/db.js', () => ({
  getPool: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ health_check: 1 }] }),
      release: vi.fn(),
    }),
  })),
  getDatabase: vi.fn(),
  withStatementTimeout: vi.fn((fn) => fn()),
  DEFAULT_STATEMENT_TIMEOUT_MS: 30000,
}));

// Mock config
vi.mock('../../../src/common/config.js', () => ({
  getConfig: vi.fn(() => ({
    database: {
      statementTimeoutMs: 30000,
      poolMin: 5,
      poolMax: 20,
    },
    circuitBreaker: {
      database: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenMaxAttempts: 3,
        monitorWindowMs: 60000,
      },
      redis: {
        failureThreshold: 10,
        resetTimeoutMs: 10000,
        halfOpenMaxAttempts: 5,
        monitorWindowMs: 30000,
      },
    },
    health: {
      checkTimeoutMs: 5000,
      readyTimeoutMs: 10000,
      livenessTimeoutMs: 1000,
    },
    env: 'test',
  })),
}));

// Mock circuit-breaker module
vi.mock('../../../src/common/circuit-breaker.js', () => {
  const mockBreakers = new Map();

  const createMockBreaker = (name: string) => ({
    name,
    state: 'CLOSED' as const,
    failureCount: 0,
    isOpen: vi.fn().mockResolvedValue(false),
    getCircuitState: vi.fn().mockResolvedValue('CLOSED'),
    getStatus: vi.fn().mockResolvedValue({
      name,
      state: 'CLOSED',
      failureCount: 0,
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      halfOpenMaxAttempts: 3,
      halfOpenAttempts: 0,
      monitorWindowMs: 60000,
      lastFailureTime: null,
      openedAt: null,
      timeUntilReset: null,
    }),
    execute: vi.fn().mockImplementation(async (fn) => {
      try {
        const result = await fn();
        return { success: true, result, circuitOpen: false };
      } catch (error) {
        return { success: false, error, circuitOpen: false };
      }
    }),
    forceOpen: vi.fn(),
    forceClose: vi.fn(),
    reset: vi.fn(),
  });

  return {
    CircuitBreaker: vi.fn(),
    CircuitState: {},
    getCircuitBreaker: vi.fn((name: string) => {
      if (!mockBreakers.has(name)) {
        mockBreakers.set(name, createMockBreaker(name));
      }
      return mockBreakers.get(name);
    }),
    CircuitBreakerOpenError: class extends Error {
      serviceName: string;
      circuitState: string;
      constructor(serviceName: string, circuitState: string = 'OPEN') {
        super(`Circuit breaker '${serviceName}' is ${circuitState}`);
        this.serviceName = serviceName;
        this.circuitState = circuitState;
      }
    },
    withCircuitBreaker: vi.fn(async (serviceName, fn) => {
      return fn();
    }),
    withCircuitBreakerResult: vi.fn(async (serviceName, fn) => {
      try {
        const result = await fn();
        return { success: true, result, circuitOpen: false };
      } catch (error) {
        return { success: false, error, circuitOpen: false };
      }
    }),
    getAllCircuitBreakerStatuses: vi.fn().mockResolvedValue(new Map()),
    clearCircuitBreakerRegistry: vi.fn(),
  };
});

describe('Database Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expose getDatabaseCircuitBreaker function', async () => {
    const { getDatabaseCircuitBreaker } = await import('../../../src/common/database-resilience.js');
    const breaker = getDatabaseCircuitBreaker();
    expect(breaker).toBeDefined();
    expect(breaker.getStatus).toBeDefined();
  });

  it('should expose isDatabaseCircuitOpen function', async () => {
    const { isDatabaseCircuitOpen } = await import('../../../src/common/database-resilience.js');
    const isOpen = await isDatabaseCircuitOpen();
    expect(typeof isOpen).toBe('boolean');
  });

  it('should expose getDatabaseCircuitStatus function', async () => {
    const { getDatabaseCircuitStatus } = await import('../../../src/common/database-resilience.js');
    const status = await getDatabaseCircuitStatus();
    expect(status).toBeDefined();
    expect(status.state).toBe('CLOSED');
    expect(status.failureCount).toBe(0);
  });

  it('should wrap database operations with circuit breaker', async () => {
    const { withDatabaseCircuitBreaker } = await import('../../../src/common/database-resilience.js');

    const mockResult = { id: 1, name: 'test' };
    const result = await withDatabaseCircuitBreaker(async () => mockResult);

    expect(result).toEqual(mockResult);
  });

  it('should expose checkDatabaseHealthWithCircuit function', async () => {
    const { checkDatabaseHealthWithCircuit } = await import('../../../src/common/database-resilience.js');
    const health = await checkDatabaseHealthWithCircuit();

    expect(health).toBeDefined();
    expect(health.circuit).toBeDefined();
    expect(health.circuit.state).toBeDefined();
  });
});

describe('Redis Resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expose getRedisCircuitBreaker function', async () => {
    const { getRedisCircuitBreaker } = await import('../../../src/common/redis-resilience.js');
    const breaker = getRedisCircuitBreaker();
    expect(breaker).toBeDefined();
  });

  it('should expose isRedisCircuitOpen function', async () => {
    const { isRedisCircuitOpen } = await import('../../../src/common/redis-resilience.js');
    const isOpen = await isRedisCircuitOpen();
    expect(typeof isOpen).toBe('boolean');
  });

  it('should provide rate limiting with fallback', async () => {
    const { rateLimitWithFallback } = await import('../../../src/common/redis-resilience.js');

    // Mock Redis incr
    const { getRedis } = await import('../../../src/common/redis.js');
    const mockRedis = getRedis();
    (mockRedis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (mockRedis.expire as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const result = await rateLimitWithFallback('test:key', 100, 60);

    expect(result).toBeDefined();
    expect(result.allowed).toBeDefined();
    expect(result.remaining).toBeDefined();
    expect(result.fallbackMode).toBeDefined();
  });

  it('should provide cache get with fallback', async () => {
    const { cacheGetWithFallback } = await import('../../../src/common/redis-resilience.js');

    const { getRedis } = await import('../../../src/common/redis.js');
    const mockRedis = getRedis();
    (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue('{"test": "value"}');

    const result = await cacheGetWithFallback<{ test: string }>('test:key');

    expect(result).toBeDefined();
    expect(result.fallbackMode).toBe(false);
  });

  it('should provide cache set with fallback', async () => {
    const { cacheSetWithFallback } = await import('../../../src/common/redis-resilience.js');

    const { getRedis } = await import('../../../src/common/redis.js');
    const mockRedis = getRedis();
    (mockRedis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    const result = await cacheSetWithFallback('test:key', { test: 'value' }, 300);

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.fallbackMode).toBe(false);
  });

  it('should provide lock acquisition with fallback', async () => {
    const { withCircuitBreakerResult } = await import('../../../src/common/circuit-breaker.js');

    // Mock successful lock acquisition
    (withCircuitBreakerResult as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
      result: true, // Lock acquired
      circuitOpen: false,
    });

    const { acquireLockWithFallback } = await import('../../../src/common/redis-resilience.js');
    const result = await acquireLockWithFallback('test:lock', 'owner-1', 30000);

    expect(result).toBeDefined();
    expect(result.acquired).toBe(true);
    expect(result.fallbackMode).toBe(false);
    expect(result.release).toBeDefined();
  });

  it('should expose checkRedisHealthWithCircuit function', async () => {
    const { checkRedisHealthWithCircuit } = await import('../../../src/common/redis-resilience.js');
    const health = await checkRedisHealthWithCircuit();

    expect(health).toBeDefined();
    expect(health.circuit).toBeDefined();
    expect(health.circuit.state).toBeDefined();
  });
});

describe('In-Memory Mutex Fallback', () => {
  it('should fall back to in-memory mutex when Redis is unavailable', async () => {
    const { withCircuitBreakerResult } = await import('../../../src/common/circuit-breaker.js');

    // Simulate circuit open
    (withCircuitBreakerResult as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      circuitOpen: true,
    });

    const { acquireLockWithFallback } = await import('../../../src/common/redis-resilience.js');

    const result = await acquireLockWithFallback('test:lock', 'owner-1', 30000);

    expect(result.fallbackMode).toBe(true);
  });
});

describe('Circuit Breaker State Transitions', () => {
  it('should start in CLOSED state', async () => {
    const { getDatabaseCircuitStatus } = await import('../../../src/common/database-resilience.js');
    const status = await getDatabaseCircuitStatus();
    expect(status.state).toBe('CLOSED');
  });

  it('should track failure count', async () => {
    const { getDatabaseCircuitStatus } = await import('../../../src/common/database-resilience.js');
    const status = await getDatabaseCircuitStatus();
    expect(status.failureCount).toBe(0);
  });

  it('should have configured failure threshold', async () => {
    const { getDatabaseCircuitStatus } = await import('../../../src/common/database-resilience.js');
    const status = await getDatabaseCircuitStatus();
    expect(status.failureThreshold).toBe(5);
  });
});
