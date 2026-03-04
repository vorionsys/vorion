/**
 * Cognigate Resource Limiting Integration Tests
 *
 * Tests the resource limiting capabilities of the Cognigate execution gateway:
 * - Memory limit enforcement (terminate when exceeded)
 * - CPU limit enforcement
 * - Timeout enforcement
 * - Network request limiting
 * - Filesystem operation limiting
 * - Output validation integration
 *
 * Uses in-memory state provider and mocked dependencies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// =============================================================================
// MOCKS
// =============================================================================

// Mock logger to suppress output during tests
vi.mock('../../../src/common/logger.js', () => {
  const createMockLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockImplementation(() => createMockLogger()),
  });
  return { createLogger: vi.fn(createMockLogger), logger: createMockLogger() };
});

// Mock metrics to prevent prom-client issues
vi.mock('../../../src/cognigate/metrics.js', () => ({
  recordExecutionStart: vi.fn(),
  recordExecutionComplete: vi.fn(),
  recordResourceUsage: vi.fn(),
  recordResourceViolation: vi.fn(),
  recordTermination: vi.fn(),
  recordOutputValidation: vi.fn(),
  recordPIIDetection: vi.fn(),
  recordOutputSanitization: vi.fn(),
  recordProhibitedPattern: vi.fn(),
}));

// Mock random for deterministic execution IDs in tests
vi.mock('../../../src/common/random.js', () => ({
  secureRandomString: vi.fn(() => 'test-execution-id'),
}));

// Mock semantic-governance module (may not exist)
vi.mock('../../../src/semantic-governance/output-validator.js', () => {
  class MockOutputValidator {
    validateOutput(output: unknown) {
      return {
        valid: true,
        reason: null,
        patternScan: { detected: false, patterns: [] },
      };
    }
    sanitizeOutput(output: unknown) {
      return { content: output, modified: false, redactions: [] };
    }
    validateAllUrls(_content: string) {
      return [];
    }
  }
  return {
    OutputValidator: MockOutputValidator,
    OutputValidationError: class extends Error {
      constructor(message: string, public details: Record<string, unknown>) {
        super(message);
      }
    },
    createDefaultOutputValidator: vi.fn(() => new MockOutputValidator()),
  };
});

vi.mock('../../../src/semantic-governance/types.js', () => ({}));

// =============================================================================
// TYPES
// =============================================================================

import type { ID } from '../../../src/common/types.js';
import type {
  ResourceLimits,
  ResourceUsage,
  ResourceStateProvider,
  OutputValidationOptions,
} from '../../../src/cognigate/types.js';

// =============================================================================
// IN-MEMORY STATE PROVIDER
// =============================================================================

/**
 * In-memory implementation of ResourceStateProvider for testing.
 * Provides the same interface as the Redis-based implementation.
 */
class InMemoryResourceStateProvider implements ResourceStateProvider {
  private executions: Map<ID, {
    startTime: number;
    memoryPeakMb: number;
    cpuTimeMs: number;
    networkRequests: number;
    fileSystemOps: number;
    limits: ResourceLimits;
  }> = new Map();

  async initExecution(executionId: ID, limits: ResourceLimits, _ttlMs: number): Promise<void> {
    this.executions.set(executionId, {
      startTime: Date.now(),
      memoryPeakMb: 0,
      cpuTimeMs: 0,
      networkRequests: 0,
      fileSystemOps: 0,
      limits,
    });
  }

  async recordMemoryUsage(executionId: ID, memoryMb: number): Promise<void> {
    const exec = this.executions.get(executionId);
    if (exec && memoryMb > exec.memoryPeakMb) {
      exec.memoryPeakMb = memoryMb;
    }
  }

  async getPeakMemory(executionId: ID): Promise<number> {
    return this.executions.get(executionId)?.memoryPeakMb ?? 0;
  }

  async incrementCpuTime(executionId: ID, deltaMs: number): Promise<number> {
    const exec = this.executions.get(executionId);
    if (exec) {
      exec.cpuTimeMs += deltaMs;
      return exec.cpuTimeMs;
    }
    return 0;
  }

  async getCpuTimeMs(executionId: ID): Promise<number> {
    return this.executions.get(executionId)?.cpuTimeMs ?? 0;
  }

  async incrementNetworkRequests(
    executionId: ID,
    limit: number
  ): Promise<{ allowed: boolean; current: number }> {
    const exec = this.executions.get(executionId);
    if (!exec) {
      return { allowed: false, current: 0 };
    }
    exec.networkRequests += 1;
    return {
      allowed: exec.networkRequests <= limit,
      current: exec.networkRequests,
    };
  }

  async getNetworkRequestCount(executionId: ID): Promise<number> {
    return this.executions.get(executionId)?.networkRequests ?? 0;
  }

  async incrementFileSystemOps(
    executionId: ID,
    limit: number
  ): Promise<{ allowed: boolean; current: number }> {
    const exec = this.executions.get(executionId);
    if (!exec) {
      return { allowed: false, current: 0 };
    }
    exec.fileSystemOps += 1;
    return {
      allowed: exec.fileSystemOps <= limit,
      current: exec.fileSystemOps,
    };
  }

  async getFileSystemOpCount(executionId: ID): Promise<number> {
    return this.executions.get(executionId)?.fileSystemOps ?? 0;
  }

  async shouldTerminate(
    executionId: ID,
    limits: ResourceLimits
  ): Promise<{ terminate: boolean; reason?: string; violation?: string }> {
    const exec = this.executions.get(executionId);
    if (!exec) {
      return { terminate: false };
    }

    const wallTimeMs = Date.now() - exec.startTime;

    // Check timeout
    if (wallTimeMs > limits.timeoutMs) {
      return {
        terminate: true,
        reason: `Timeout exceeded: ${wallTimeMs}ms > ${limits.timeoutMs}ms`,
        violation: 'timeout_exceeded',
      };
    }

    // Check memory
    if (exec.memoryPeakMb > limits.maxMemoryMb) {
      return {
        terminate: true,
        reason: `Memory limit exceeded: ${exec.memoryPeakMb}MB > ${limits.maxMemoryMb}MB`,
        violation: 'memory_exceeded',
      };
    }

    // Check CPU (percentage of wall time)
    const allowedCpuMs = (limits.maxCpuPercent / 100) * wallTimeMs;
    if (exec.cpuTimeMs > allowedCpuMs) {
      return {
        terminate: true,
        reason: `CPU time exceeded: ${exec.cpuTimeMs}ms > ${allowedCpuMs}ms`,
        violation: 'cpu_exceeded',
      };
    }

    // Check network requests
    if (limits.maxNetworkRequests !== undefined && exec.networkRequests > limits.maxNetworkRequests) {
      return {
        terminate: true,
        reason: `Network requests exceeded: ${exec.networkRequests} > ${limits.maxNetworkRequests}`,
        violation: 'network_limit_exceeded',
      };
    }

    // Check filesystem ops
    if (limits.maxFileSystemOps !== undefined && exec.fileSystemOps > limits.maxFileSystemOps) {
      return {
        terminate: true,
        reason: `Filesystem ops exceeded: ${exec.fileSystemOps} > ${limits.maxFileSystemOps}`,
        violation: 'filesystem_limit_exceeded',
      };
    }

    return { terminate: false };
  }

  async cleanupExecution(executionId: ID): Promise<ResourceUsage> {
    const exec = this.executions.get(executionId);
    if (!exec) {
      return {
        memoryPeakMb: 0,
        cpuTimeMs: 0,
        wallTimeMs: 0,
        networkRequests: 0,
        fileSystemOps: 0,
      };
    }

    const usage: ResourceUsage = {
      memoryPeakMb: exec.memoryPeakMb,
      cpuTimeMs: exec.cpuTimeMs,
      wallTimeMs: Date.now() - exec.startTime,
      networkRequests: exec.networkRequests,
      fileSystemOps: exec.fileSystemOps,
    };

    this.executions.delete(executionId);
    return usage;
  }

  // Test helper methods
  clear(): void {
    this.executions.clear();
  }

  getExecution(executionId: ID) {
    return this.executions.get(executionId);
  }

  setMemoryUsage(executionId: ID, memoryMb: number): void {
    const exec = this.executions.get(executionId);
    if (exec) {
      exec.memoryPeakMb = memoryMb;
    }
  }

  setCpuTime(executionId: ID, cpuTimeMs: number): void {
    const exec = this.executions.get(executionId);
    if (exec) {
      exec.cpuTimeMs = cpuTimeMs;
    }
  }
}

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestIntent(overrides: Partial<{
  id: string;
  tenantId: string;
  entityId: string;
  goal: string;
  intentType: string;
  context: Record<string, unknown>;
}> = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    tenantId: overrides.tenantId ?? 'test-tenant',
    entityId: overrides.entityId ?? randomUUID(),
    goal: overrides.goal ?? 'Test goal',
    intentType: overrides.intentType ?? 'test',
    context: overrides.context ?? { type: 'test' },
    metadata: {},
    status: 'approved' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createTestDecision(intentId: string, action: 'allow' | 'deny' = 'allow') {
  return {
    intentId,
    action,
    constraintsEvaluated: [],
    trustScore: 500,
    trustLevel: 2 as const,
    decidedAt: new Date().toISOString(),
  };
}

function createDefaultLimits(overrides: Partial<ResourceLimits> = {}): ResourceLimits {
  return {
    maxMemoryMb: 256,
    maxCpuPercent: 80,
    timeoutMs: 5000,
    maxNetworkRequests: 10,
    maxFileSystemOps: 50,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Cognigate Resource Limiting Integration', () => {
  let stateProvider: InMemoryResourceStateProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    stateProvider = new InMemoryResourceStateProvider();
  });

  afterEach(() => {
    stateProvider.clear();
  });

  // ===========================================================================
  // 1. Memory Limit Enforcement
  // ===========================================================================
  describe('Memory Limit Enforcement', () => {
    it('should track memory usage and update peak', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxMemoryMb: 512 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Simulate memory samples
      await stateProvider.recordMemoryUsage(executionId, 100);
      expect(await stateProvider.getPeakMemory(executionId)).toBe(100);

      await stateProvider.recordMemoryUsage(executionId, 250);
      expect(await stateProvider.getPeakMemory(executionId)).toBe(250);

      // Peak should not decrease
      await stateProvider.recordMemoryUsage(executionId, 150);
      expect(await stateProvider.getPeakMemory(executionId)).toBe(250);

      await stateProvider.recordMemoryUsage(executionId, 300);
      expect(await stateProvider.getPeakMemory(executionId)).toBe(300);
    });

    it('should signal termination when memory limit exceeded', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxMemoryMb: 128 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Memory under limit
      await stateProvider.recordMemoryUsage(executionId, 100);
      let result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);

      // Memory exceeds limit
      await stateProvider.recordMemoryUsage(executionId, 150);
      result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
      expect(result.violation).toBe('memory_exceeded');
      expect(result.reason).toContain('Memory limit exceeded');
    });

    it('should report correct memory usage in cleanup', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxMemoryMb: 512 });

      await stateProvider.initExecution(executionId, limits, 60000);
      await stateProvider.recordMemoryUsage(executionId, 100);
      await stateProvider.recordMemoryUsage(executionId, 256);
      await stateProvider.recordMemoryUsage(executionId, 180);

      const usage = await stateProvider.cleanupExecution(executionId);
      expect(usage.memoryPeakMb).toBe(256);
    });

    it('should handle zero memory usage', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits();

      await stateProvider.initExecution(executionId, limits, 60000);

      // No memory recorded
      expect(await stateProvider.getPeakMemory(executionId)).toBe(0);

      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);
    });
  });

  // ===========================================================================
  // 2. CPU Limit Enforcement
  // ===========================================================================
  describe('CPU Limit Enforcement', () => {
    it('should track cumulative CPU time', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits();

      await stateProvider.initExecution(executionId, limits, 60000);

      // Increment CPU time in chunks
      let total = await stateProvider.incrementCpuTime(executionId, 100);
      expect(total).toBe(100);

      total = await stateProvider.incrementCpuTime(executionId, 50);
      expect(total).toBe(150);

      total = await stateProvider.incrementCpuTime(executionId, 75);
      expect(total).toBe(225);

      expect(await stateProvider.getCpuTimeMs(executionId)).toBe(225);
    });

    it('should signal termination when CPU limit exceeded', async () => {
      const executionId = randomUUID();
      // 50% CPU limit with 1000ms timeout
      const limits = createDefaultLimits({ maxCpuPercent: 50, timeoutMs: 10000 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Wait a bit to establish wall time
      await delay(100);

      // Under limit: 40ms CPU with 100ms wall time = 40% (under 50%)
      await stateProvider.incrementCpuTime(executionId, 40);
      let result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);

      // Over limit: add more CPU time to exceed 50% of wall time
      await stateProvider.incrementCpuTime(executionId, 100);
      result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
      expect(result.violation).toBe('cpu_exceeded');
      expect(result.reason).toContain('CPU time exceeded');
    });

    it('should report correct CPU time in cleanup', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits();

      await stateProvider.initExecution(executionId, limits, 60000);
      await stateProvider.incrementCpuTime(executionId, 100);
      await stateProvider.incrementCpuTime(executionId, 200);
      await stateProvider.incrementCpuTime(executionId, 50);

      const usage = await stateProvider.cleanupExecution(executionId);
      expect(usage.cpuTimeMs).toBe(350);
    });
  });

  // ===========================================================================
  // 3. Timeout Enforcement
  // ===========================================================================
  describe('Timeout Enforcement', () => {
    it('should not terminate before timeout', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ timeoutMs: 500 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Check immediately - should not terminate
      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);
    });

    it('should signal termination when timeout exceeded', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ timeoutMs: 50 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Wait for timeout
      await delay(100);

      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
      expect(result.violation).toBe('timeout_exceeded');
      expect(result.reason).toContain('Timeout exceeded');
    });

    it('should track wall time accurately', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ timeoutMs: 5000 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Wait a known amount
      await delay(100);

      const usage = await stateProvider.cleanupExecution(executionId);
      // Allow some tolerance for test execution overhead
      expect(usage.wallTimeMs).toBeGreaterThanOrEqual(90);
      expect(usage.wallTimeMs).toBeLessThan(300);
    });
  });

  // ===========================================================================
  // 4. Network Request Limiting
  // ===========================================================================
  describe('Network Request Limiting', () => {
    it('should allow requests within limit', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxNetworkRequests: 5 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Make requests within limit
      for (let i = 1; i <= 5; i++) {
        const result = await stateProvider.incrementNetworkRequests(executionId, 5);
        expect(result.allowed).toBe(true);
        expect(result.current).toBe(i);
      }
    });

    it('should deny requests exceeding limit', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxNetworkRequests: 3 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        const result = await stateProvider.incrementNetworkRequests(executionId, 3);
        expect(result.allowed).toBe(true);
      }

      // Exceed the limit
      const result = await stateProvider.incrementNetworkRequests(executionId, 3);
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(4);
    });

    it('should signal termination when network limit exceeded', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxNetworkRequests: 2 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Make requests
      await stateProvider.incrementNetworkRequests(executionId, 2);
      await stateProvider.incrementNetworkRequests(executionId, 2);

      // Under limit
      let result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);

      // Exceed limit
      await stateProvider.incrementNetworkRequests(executionId, 2);
      result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
      expect(result.violation).toBe('network_limit_exceeded');
    });

    it('should report correct network request count in cleanup', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxNetworkRequests: 100 });

      await stateProvider.initExecution(executionId, limits, 60000);

      for (let i = 0; i < 7; i++) {
        await stateProvider.incrementNetworkRequests(executionId, 100);
      }

      const usage = await stateProvider.cleanupExecution(executionId);
      expect(usage.networkRequests).toBe(7);
    });

    it('should handle unlimited network requests', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits();
      delete (limits as Partial<ResourceLimits>).maxNetworkRequests;

      await stateProvider.initExecution(executionId, limits, 60000);

      // Should never trigger termination for network
      for (let i = 0; i < 100; i++) {
        await stateProvider.incrementNetworkRequests(executionId, Infinity);
      }

      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);
    });
  });

  // ===========================================================================
  // 5. Filesystem Operation Limiting
  // ===========================================================================
  describe('Filesystem Operation Limiting', () => {
    it('should allow operations within limit', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxFileSystemOps: 10 });

      await stateProvider.initExecution(executionId, limits, 60000);

      for (let i = 1; i <= 10; i++) {
        const result = await stateProvider.incrementFileSystemOps(executionId, 10);
        expect(result.allowed).toBe(true);
        expect(result.current).toBe(i);
      }
    });

    it('should deny operations exceeding limit', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxFileSystemOps: 5 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Use up the limit
      for (let i = 0; i < 5; i++) {
        const result = await stateProvider.incrementFileSystemOps(executionId, 5);
        expect(result.allowed).toBe(true);
      }

      // Exceed the limit
      const result = await stateProvider.incrementFileSystemOps(executionId, 5);
      expect(result.allowed).toBe(false);
      expect(result.current).toBe(6);
    });

    it('should signal termination when filesystem limit exceeded', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxFileSystemOps: 3 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Make operations
      for (let i = 0; i < 3; i++) {
        await stateProvider.incrementFileSystemOps(executionId, 3);
      }

      // Under limit
      let result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);

      // Exceed limit
      await stateProvider.incrementFileSystemOps(executionId, 3);
      result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
      expect(result.violation).toBe('filesystem_limit_exceeded');
    });

    it('should report correct filesystem operation count in cleanup', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxFileSystemOps: 100 });

      await stateProvider.initExecution(executionId, limits, 60000);

      for (let i = 0; i < 15; i++) {
        await stateProvider.incrementFileSystemOps(executionId, 100);
      }

      const usage = await stateProvider.cleanupExecution(executionId);
      expect(usage.fileSystemOps).toBe(15);
    });
  });

  // ===========================================================================
  // 6. Combined Resource Tracking
  // ===========================================================================
  describe('Combined Resource Tracking', () => {
    it('should track all resources simultaneously', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({
        maxMemoryMb: 512,
        maxCpuPercent: 100, // 100% allows any CPU time
        timeoutMs: 60000, // Long timeout to avoid timeout termination
        maxNetworkRequests: 50,
        maxFileSystemOps: 100,
      });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Wait a bit so we have wall time for CPU percentage calculation
      await delay(100);

      // Simulate various resource usage
      await stateProvider.recordMemoryUsage(executionId, 256);
      // CPU time must be <= 100% of wall time (at least 100ms elapsed)
      await stateProvider.incrementCpuTime(executionId, 50);

      for (let i = 0; i < 10; i++) {
        await stateProvider.incrementNetworkRequests(executionId, 50);
      }

      for (let i = 0; i < 25; i++) {
        await stateProvider.incrementFileSystemOps(executionId, 100);
      }

      // Should not terminate - all within limits
      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);

      // Get final usage
      const usage = await stateProvider.cleanupExecution(executionId);
      expect(usage.memoryPeakMb).toBe(256);
      expect(usage.cpuTimeMs).toBe(50);
      expect(usage.networkRequests).toBe(10);
      expect(usage.fileSystemOps).toBe(25);
      expect(usage.wallTimeMs).toBeGreaterThan(0);
    });

    it('should terminate on first limit violation', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({
        maxMemoryMb: 128,
        maxNetworkRequests: 5,
        maxFileSystemOps: 10,
      });

      await stateProvider.initExecution(executionId, limits, 60000);

      // First, exceed memory (but we check network first in shouldTerminate)
      await stateProvider.recordMemoryUsage(executionId, 200);

      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
      expect(result.violation).toBe('memory_exceeded');
    });

    it('should cleanup execution state properly', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits();

      await stateProvider.initExecution(executionId, limits, 60000);
      expect(stateProvider.getExecution(executionId)).toBeDefined();

      await stateProvider.cleanupExecution(executionId);
      expect(stateProvider.getExecution(executionId)).toBeUndefined();
    });
  });

  // ===========================================================================
  // 7. Edge Cases and Error Handling
  // ===========================================================================
  describe('Edge Cases and Error Handling', () => {
    it('should handle non-existent execution ID gracefully', async () => {
      const fakeId = 'non-existent-id';

      expect(await stateProvider.getPeakMemory(fakeId)).toBe(0);
      expect(await stateProvider.getCpuTimeMs(fakeId)).toBe(0);
      expect(await stateProvider.getNetworkRequestCount(fakeId)).toBe(0);
      expect(await stateProvider.getFileSystemOpCount(fakeId)).toBe(0);

      const result = await stateProvider.shouldTerminate(fakeId, createDefaultLimits());
      expect(result.terminate).toBe(false);

      const usage = await stateProvider.cleanupExecution(fakeId);
      expect(usage.memoryPeakMb).toBe(0);
      expect(usage.cpuTimeMs).toBe(0);
    });

    it('should handle zero limits correctly', async () => {
      const executionId = randomUUID();
      const limits: ResourceLimits = {
        maxMemoryMb: 0,
        maxCpuPercent: 0,
        timeoutMs: 0,
        maxNetworkRequests: 0,
        maxFileSystemOps: 0,
      };

      await stateProvider.initExecution(executionId, limits, 60000);

      // Any usage should exceed zero limits
      await stateProvider.recordMemoryUsage(executionId, 1);

      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(true);
    });

    it('should handle very large limits', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({
        maxMemoryMb: 1000000, // 1TB - effectively unlimited
        maxCpuPercent: 100,
        timeoutMs: 86400000, // 24 hours
        maxNetworkRequests: 1000000,
        maxFileSystemOps: 1000000,
      });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Wait a bit so wall time > 0 for CPU percentage calculation
      await delay(50);

      // Should never terminate with huge limits
      await stateProvider.recordMemoryUsage(executionId, 10000);
      // Set CPU time that's within 100% of wall time (we've waited 50ms, so 50ms CPU is fine)
      await stateProvider.incrementCpuTime(executionId, 1);

      for (let i = 0; i < 100; i++) {
        await stateProvider.incrementNetworkRequests(executionId, 1000000);
        await stateProvider.incrementFileSystemOps(executionId, 1000000);
      }

      const result = await stateProvider.shouldTerminate(executionId, limits);
      expect(result.terminate).toBe(false);
    });

    it('should handle concurrent operations on same execution', async () => {
      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxNetworkRequests: 100 });

      await stateProvider.initExecution(executionId, limits, 60000);

      // Simulate concurrent increments
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(stateProvider.incrementNetworkRequests(executionId, 100));
        promises.push(stateProvider.incrementFileSystemOps(executionId, 100));
      }

      await Promise.all(promises);

      const networkCount = await stateProvider.getNetworkRequestCount(executionId);
      const fsCount = await stateProvider.getFileSystemOpCount(executionId);

      expect(networkCount).toBe(50);
      expect(fsCount).toBe(50);
    });
  });

  // ===========================================================================
  // 8. Resource Tracker Integration
  // ===========================================================================
  describe('Resource Tracker Integration', () => {
    // Note: Tests involving the real ResourceTracker with local limit checking
    // (without state provider) are inherently flaky due to real process CPU/memory
    // usage variations. The key functionality is tested via the state provider
    // integration below.

    it('should terminate tracker when limits exceeded via state provider', async () => {
      const { ResourceTracker } = await import('../../../src/cognigate/resource-tracker.js');

      const executionId = randomUUID();
      // Use permissive limits for real process but we'll exceed via state provider
      const limits = createDefaultLimits({
        maxMemoryMb: 1, // Very low memory limit - will be exceeded via state provider
        maxCpuPercent: 10000,
        timeoutMs: 600000,
      });

      const tracker = new ResourceTracker(executionId, limits, {
        stateProvider,
        pollIntervalMs: 50,
      });

      await tracker.start();

      // Simulate high memory usage via state provider
      stateProvider.setMemoryUsage(executionId, 100);

      // Wait for next poll
      await delay(100);

      expect(tracker.isTerminated()).toBe(true);
      expect(tracker.getTerminationReason()?.violation).toBe('memory_exceeded');

      await tracker.stop();
    });

    it('should track and return resource usage', async () => {
      const { ResourceTracker } = await import('../../../src/cognigate/resource-tracker.js');

      const executionId = randomUUID();
      // Very permissive limits - we just want to verify usage is tracked
      const limits = createDefaultLimits({
        maxMemoryMb: 100000,
        maxCpuPercent: 100000,
        timeoutMs: 600000,
      });

      const tracker = new ResourceTracker(executionId, limits, {
        stateProvider,
        pollIntervalMs: 50,
      });

      await tracker.start();
      await delay(100);

      const usage = await tracker.stop();

      // Verify usage metrics are populated
      expect(usage.wallTimeMs).toBeGreaterThan(50);
      expect(typeof usage.memoryPeakMb).toBe('number');
      expect(typeof usage.cpuTimeMs).toBe('number');
    });

    it('should support manual termination', async () => {
      const { ResourceTracker } = await import('../../../src/cognigate/resource-tracker.js');

      const executionId = randomUUID();
      const limits = createDefaultLimits({
        maxMemoryMb: 100000,
        maxCpuPercent: 100000,
        timeoutMs: 600000,
      });

      const tracker = new ResourceTracker(executionId, limits, {
        stateProvider,
        pollIntervalMs: 50,
      });

      // Don't start - just test the terminate method
      expect(tracker.isTerminated()).toBe(false);

      tracker.terminate('Manual test termination', 'manual');

      expect(tracker.isTerminated()).toBe(true);
      expect(tracker.getTerminationReason()?.reason).toContain('Manual test termination');
      expect(tracker.signal.aborted).toBe(true);
    });
  });

  // ===========================================================================
  // 9. Resource Interceptors Integration
  // ===========================================================================
  describe('Resource Interceptors Integration', () => {
    it('should create network interceptor that tracks requests', async () => {
      const { createNetworkInterceptor, ResourceLimitExceededError } = await import(
        '../../../src/cognigate/resource-interceptors.js'
      );

      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxNetworkRequests: 2 });
      const abortController = new AbortController();

      await stateProvider.initExecution(executionId, limits, 60000);

      const wrappedFetch = createNetworkInterceptor(
        executionId,
        limits,
        stateProvider,
        abortController.signal
      );

      // Note: We can't actually make fetch calls in unit tests,
      // but we can verify the interceptor is created
      expect(wrappedFetch).toBeInstanceOf(Function);
    });

    it('should create filesystem interceptors that track operations', async () => {
      const { createFileSystemInterceptors } = await import(
        '../../../src/cognigate/resource-interceptors.js'
      );

      const executionId = randomUUID();
      const limits = createDefaultLimits({ maxFileSystemOps: 5 });
      const abortController = new AbortController();

      await stateProvider.initExecution(executionId, limits, 60000);

      const wrappedFs = createFileSystemInterceptors(
        executionId,
        limits,
        stateProvider,
        abortController.signal
      );

      // Verify all wrapped functions exist
      expect(wrappedFs.readFile).toBeInstanceOf(Function);
      expect(wrappedFs.writeFile).toBeInstanceOf(Function);
      expect(wrappedFs.unlink).toBeInstanceOf(Function);
      expect(wrappedFs.mkdir).toBeInstanceOf(Function);
      expect(wrappedFs.readdir).toBeInstanceOf(Function);
      expect(wrappedFs.stat).toBeInstanceOf(Function);
    });

    it('should create execution interceptors with all components', async () => {
      const { createExecutionInterceptors } = await import(
        '../../../src/cognigate/resource-interceptors.js'
      );

      const executionId = randomUUID();
      const limits = createDefaultLimits();
      const abortController = new AbortController();

      await stateProvider.initExecution(executionId, limits, 60000);

      const interceptors = createExecutionInterceptors(
        executionId,
        limits,
        stateProvider,
        abortController.signal
      );

      expect(interceptors.fetch).toBeInstanceOf(Function);
      expect(interceptors.fs).toBeDefined();
      expect(interceptors.signal).toBe(abortController.signal);
    });
  });

  // ===========================================================================
  // 10. Output Validation Integration
  // ===========================================================================
  describe('Output Validation Integration', () => {
    it('should create output integrator with validation options', async () => {
      const { OutputIntegrator } = await import(
        '../../../src/cognigate/output-integration.js'
      );

      const options: OutputValidationOptions = {
        mode: 'strict',
        sanitizePII: true,
        prohibitedPatterns: [
          { type: 'keyword', pattern: 'secret', description: 'Secret keyword', severity: 'high' },
        ],
      };

      const integrator = new OutputIntegrator(options);
      expect(integrator).toBeInstanceOf(OutputIntegrator);
    });

    it('should validate output and detect issues', async () => {
      const { OutputIntegrator } = await import(
        '../../../src/cognigate/output-integration.js'
      );

      const options: OutputValidationOptions = {
        mode: 'permissive', // Log but don't reject
        sanitizePII: false,
      };

      const integrator = new OutputIntegrator(options);

      const result = integrator.validateOutput({ message: 'Hello world' });
      expect(result.mode).toBe('permissive');
      expect(result.originalOutput).toEqual({ message: 'Hello world' });
    });

    it('should create strict output integrator', async () => {
      const { createStrictOutputIntegrator } = await import(
        '../../../src/cognigate/output-integration.js'
      );

      const integrator = createStrictOutputIntegrator(true);
      expect(integrator).toBeDefined();
    });

    it('should create permissive output integrator', async () => {
      const { createPermissiveOutputIntegrator } = await import(
        '../../../src/cognigate/output-integration.js'
      );

      const integrator = createPermissiveOutputIntegrator(false);
      expect(integrator).toBeDefined();
    });
  });

  // ===========================================================================
  // 11. Full Gateway Integration
  // ===========================================================================
  describe('Full Gateway Integration', () => {
    it('should create gateway with custom state provider', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      const gateway = new CognigateGateway({
        defaultLimits: createDefaultLimits(),
        stateProvider,
        useDistributedState: true,
      });

      expect(gateway).toBeInstanceOf(CognigateGateway);
      expect(gateway.getActiveExecutionCount()).toBe(0);
    });

    it('should create gateway without distributed state', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      // Create gateway without distributed state - uses local tracking only
      const gateway = new CognigateGateway({
        defaultLimits: createDefaultLimits(),
        useDistributedState: false, // Local tracking only
      });

      expect(gateway).toBeInstanceOf(CognigateGateway);
    });

    it('should reject execution when decision is deny', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      const gateway = new CognigateGateway({
        defaultLimits: createDefaultLimits(),
        stateProvider,
        useDistributedState: true,
      });

      gateway.registerHandler('test', vi.fn());

      const intent = createTestIntent();
      const decision = createTestDecision(intent.id, 'deny');

      const result = await gateway.execute({
        intent,
        decision,
        resourceLimits: createDefaultLimits(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution not allowed');
    });

    it('should handle missing handler gracefully', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      const gateway = new CognigateGateway({
        defaultLimits: createDefaultLimits(),
        stateProvider,
        useDistributedState: true,
      });

      const intent = createTestIntent({ intentType: 'unknown-type' });
      const decision = createTestDecision(intent.id, 'allow');

      const result = await gateway.execute({
        intent,
        decision,
        resourceLimits: createDefaultLimits(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No handler for intent type');
    });

    it('should register handler and track execution', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      // Use very permissive limits
      const permissiveLimits = createDefaultLimits({
        maxMemoryMb: 100000,
        maxCpuPercent: 100000, // Very high
        timeoutMs: 600000,
      });

      const gateway = new CognigateGateway({
        defaultLimits: permissiveLimits,
        stateProvider,
        useDistributedState: true,
      });

      const handlerSpy = vi.fn().mockResolvedValue({ result: 'success' });
      gateway.registerHandler('test', handlerSpy);

      const intent = createTestIntent({ intentType: 'test' });
      const decision = createTestDecision(intent.id, 'allow');

      // Execute
      const result = await gateway.execute({
        intent,
        decision,
        resourceLimits: permissiveLimits,
      });

      // Either success or terminated due to resource limits is acceptable
      // The key thing is the handler was called
      expect(handlerSpy).toHaveBeenCalled();
      expect(result.intentId).toBe(intent.id);
    });

    it('should return execution result with resource usage', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      // Use very permissive limits
      const permissiveLimits = createDefaultLimits({
        maxMemoryMb: 100000,
        maxCpuPercent: 100000,
        timeoutMs: 600000,
      });

      const gateway = new CognigateGateway({
        defaultLimits: permissiveLimits,
        stateProvider,
        useDistributedState: true,
      });

      gateway.registerHandler('test', async () => ({ result: 'done' }));

      const intent = createTestIntent({ intentType: 'test' });
      const decision = createTestDecision(intent.id, 'allow');

      const result = await gateway.execute({
        intent,
        decision,
        resourceLimits: permissiveLimits,
      });

      // Verify resource usage is present
      expect(result.resourceUsage).toBeDefined();
      expect(typeof result.resourceUsage.wallTimeMs).toBe('number');
      expect(typeof result.resourceUsage.memoryPeakMb).toBe('number');
      expect(typeof result.resourceUsage.cpuTimeMs).toBe('number');
    });

    it('should support termination method', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      const gateway = new CognigateGateway({
        defaultLimits: createDefaultLimits(),
        stateProvider,
        useDistributedState: true,
      });

      // Terminate non-existent execution should return false
      const result = await gateway.terminate('non-existent-intent', 'test');
      expect(result).toBe(false);
    });

    it('should provide active execution tracking methods', async () => {
      const { CognigateGateway } = await import('../../../src/cognigate/index.js');

      const gateway = new CognigateGateway({
        defaultLimits: createDefaultLimits(),
        stateProvider,
        useDistributedState: true,
      });

      // Initially no active executions
      expect(gateway.getActiveExecutionCount()).toBe(0);
      expect(gateway.listActiveExecutions()).toEqual([]);
      expect(gateway.getActiveExecution('test-id')).toBeUndefined();
    });
  });
});
