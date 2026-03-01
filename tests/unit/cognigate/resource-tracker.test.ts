/**
 * Resource Tracker Unit Tests
 *
 * Tests for Cognigate resource tracking with polling-based monitoring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResourceTracker, createResourceTracker } from '../../../src/cognigate/resource-tracker.js';
import type { ResourceLimits, ResourceStateProvider, ResourceUsage } from '../../../src/cognigate/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ResourceTracker', () => {
  const defaultLimits: ResourceLimits = {
    maxMemoryMb: 512,
    maxCpuPercent: 80,
    timeoutMs: 30000,
    maxNetworkRequests: 100,
    maxFileSystemOps: 50,
  };

  let tracker: ResourceTracker;
  let originalCpuUsage: typeof process.cpuUsage;

  beforeEach(() => {
    vi.useFakeTimers();
    // Mock process.cpuUsage to return minimal values (prevents CPU limit from triggering)
    originalCpuUsage = process.cpuUsage;
    process.cpuUsage = vi.fn().mockReturnValue({ user: 0, system: 0 });
  });

  afterEach(async () => {
    if (tracker) {
      await tracker.stop();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
    process.cpuUsage = originalCpuUsage;
  });

  describe('createResourceTracker', () => {
    it('should create a resource tracker instance', () => {
      tracker = createResourceTracker('exec-123', defaultLimits);
      expect(tracker).toBeInstanceOf(ResourceTracker);
    });

    it('should accept custom poll interval', () => {
      tracker = createResourceTracker('exec-123', defaultLimits, {
        pollIntervalMs: 50,
      });
      expect(tracker).toBeInstanceOf(ResourceTracker);
    });
  });

  describe('start and stop', () => {
    it('should start tracking and return usage on stop', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits);

      await tracker.start();

      // Advance time to trigger polls
      vi.advanceTimersByTime(500);

      const usage = await tracker.stop();

      expect(usage).toBeDefined();
      expect(usage.memoryPeakMb).toBeGreaterThanOrEqual(0);
      expect(usage.cpuTimeMs).toBeGreaterThanOrEqual(0);
      expect(usage.wallTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should not start twice', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits);

      await tracker.start();
      await tracker.start(); // Should warn but not error

      await tracker.stop();
    });

    it('should track wall time correctly', async () => {
      vi.useRealTimers();
      tracker = createResourceTracker('exec-123', defaultLimits, { pollIntervalMs: 10 });

      await tracker.start();

      // Wait a short time
      await new Promise((resolve) => setTimeout(resolve, 50));

      const usage = await tracker.stop();

      expect(usage.wallTimeMs).toBeGreaterThanOrEqual(40);
      expect(usage.wallTimeMs).toBeLessThan(200);
    });
  });

  describe('abort signal', () => {
    it('should provide abort signal', () => {
      tracker = createResourceTracker('exec-123', defaultLimits);

      expect(tracker.signal).toBeInstanceOf(AbortSignal);
      expect(tracker.signal.aborted).toBe(false);
    });

    it('should signal abort on termination', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits);

      await tracker.start();

      tracker.terminate('Test termination', 'timeout_exceeded');

      expect(tracker.signal.aborted).toBe(true);
      expect(tracker.isTerminated()).toBe(true);
    });
  });

  describe('termination', () => {
    // Use very permissive limits so auto-termination doesn't interfere
    const permissiveLimits: ResourceLimits = {
      maxMemoryMb: 100000,
      maxCpuPercent: 100000,
      timeoutMs: 3600000,
      maxNetworkRequests: 100000,
      maxFileSystemOps: 100000,
    };

    it('should track termination reason', async () => {
      tracker = createResourceTracker('exec-123', permissiveLimits);

      await tracker.start();

      tracker.terminate('Memory limit exceeded', 'memory_exceeded');

      expect(tracker.isTerminated()).toBe(true);
      const reason = tracker.getTerminationReason();
      expect(reason).toBeDefined();
      expect(reason?.violation).toBe('memory_exceeded');
      expect(reason?.reason).toBe('Memory limit exceeded');
    });

    it('should not terminate twice', async () => {
      tracker = createResourceTracker('exec-123', permissiveLimits);

      await tracker.start();

      tracker.terminate('First reason', 'timeout_exceeded');
      tracker.terminate('Second reason', 'memory_exceeded');

      const reason = tracker.getTerminationReason();
      expect(reason?.reason).toBe('First reason');
      expect(reason?.violation).toBe('timeout_exceeded');
    });

    it('should stop polling after termination', async () => {
      tracker = createResourceTracker('exec-123', permissiveLimits);

      await tracker.start();

      tracker.terminate('Test', 'timeout_exceeded');

      // Advance time - should not poll anymore
      vi.advanceTimersByTime(1000);

      expect(tracker.isTerminated()).toBe(true);
    });
  });

  describe('local limit checking', () => {
    it('should terminate on timeout exceeded', async () => {
      const shortTimeout: ResourceLimits = {
        maxMemoryMb: 100000,
        maxCpuPercent: 100000, // Very high to avoid CPU limit triggering first
        timeoutMs: 100,
        maxNetworkRequests: 100,
        maxFileSystemOps: 50,
      };

      tracker = createResourceTracker('exec-123', shortTimeout);
      await tracker.start();

      // Advance beyond timeout
      vi.advanceTimersByTime(200);

      expect(tracker.isTerminated()).toBe(true);
      expect(tracker.getTerminationReason()?.violation).toBe('timeout_exceeded');
    });
  });

  describe('getCurrentUsage', () => {
    it('should return current usage snapshot', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits);

      await tracker.start();
      vi.advanceTimersByTime(100);

      const usage = tracker.getCurrentUsage();

      expect(usage.memoryPeakMb).toBeGreaterThanOrEqual(0);
      expect(usage.cpuTimeMs).toBeGreaterThanOrEqual(0);
      expect(usage.wallTimeMs).toBeGreaterThanOrEqual(0);
      expect(usage.networkRequests).toBe(0);
      expect(usage.fileSystemOps).toBe(0);

      await tracker.stop();
    });
  });

  describe('with state provider', () => {
    let mockStateProvider: ResourceStateProvider;

    beforeEach(() => {
      mockStateProvider = {
        initExecution: vi.fn().mockResolvedValue(undefined),
        recordMemoryUsage: vi.fn().mockResolvedValue(undefined),
        getPeakMemory: vi.fn().mockResolvedValue(100),
        incrementCpuTime: vi.fn().mockResolvedValue(50),
        getCpuTimeMs: vi.fn().mockResolvedValue(50),
        incrementNetworkRequests: vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
        getNetworkRequestCount: vi.fn().mockResolvedValue(1),
        incrementFileSystemOps: vi.fn().mockResolvedValue({ allowed: true, current: 1 }),
        getFileSystemOpCount: vi.fn().mockResolvedValue(1),
        shouldTerminate: vi.fn().mockResolvedValue({ terminate: false }),
        cleanupExecution: vi.fn().mockResolvedValue({
          memoryPeakMb: 100,
          cpuTimeMs: 50,
          wallTimeMs: 1000,
          networkRequests: 5,
          fileSystemOps: 3,
        }),
      };
    });

    it('should initialize state provider on start', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits, {
        stateProvider: mockStateProvider,
      });

      await tracker.start();

      expect(mockStateProvider.initExecution).toHaveBeenCalledWith(
        'exec-123',
        defaultLimits,
        expect.any(Number)
      );

      await tracker.stop();
    });

    it('should report memory to state provider', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits, {
        stateProvider: mockStateProvider,
        pollIntervalMs: 50,
      });

      await tracker.start();
      vi.advanceTimersByTime(100);

      expect(mockStateProvider.recordMemoryUsage).toHaveBeenCalled();

      await tracker.stop();
    });

    it('should check termination from state provider', async () => {
      mockStateProvider.shouldTerminate = vi.fn().mockResolvedValue({
        terminate: true,
        reason: 'Memory exceeded from provider',
        violation: 'memory_exceeded',
      });

      tracker = createResourceTracker('exec-123', defaultLimits, {
        stateProvider: mockStateProvider,
      });

      await tracker.start();
      vi.advanceTimersByTime(100);

      expect(tracker.isTerminated()).toBe(true);
      expect(tracker.getTerminationReason()?.reason).toContain('Memory exceeded');

      await tracker.stop();
    });

    it('should cleanup state provider on stop', async () => {
      tracker = createResourceTracker('exec-123', defaultLimits, {
        stateProvider: mockStateProvider,
      });

      await tracker.start();
      const usage = await tracker.stop();

      expect(mockStateProvider.cleanupExecution).toHaveBeenCalledWith('exec-123');
      expect(usage.memoryPeakMb).toBe(100);
      expect(usage.cpuTimeMs).toBe(50);
    });

    it('should fall back to local metrics on cleanup failure', async () => {
      mockStateProvider.cleanupExecution = vi.fn().mockRejectedValue(new Error('Redis error'));

      tracker = createResourceTracker('exec-123', defaultLimits, {
        stateProvider: mockStateProvider,
      });

      await tracker.start();
      vi.advanceTimersByTime(100);

      const usage = await tracker.stop();

      // Should return local metrics, not throw
      expect(usage).toBeDefined();
      expect(usage.memoryPeakMb).toBeGreaterThanOrEqual(0);
    });
  });
});
