/**
 * Resource Interceptors Unit Tests
 *
 * Tests for Cognigate network and filesystem operation interceptors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createNetworkInterceptor,
  createFileSystemInterceptors,
  createExecutionInterceptors,
  ResourceLimitExceededError,
} from '../../../src/cognigate/resource-interceptors.js';
import type { ResourceLimits, ResourceStateProvider } from '../../../src/cognigate/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Resource Interceptors', () => {
  const defaultLimits: ResourceLimits = {
    maxMemoryMb: 512,
    maxCpuPercent: 80,
    timeoutMs: 30000,
    maxNetworkRequests: 10,
    maxFileSystemOps: 20,
  };

  let mockStateProvider: ResourceStateProvider;
  let abortController: AbortController;

  beforeEach(() => {
    abortController = new AbortController();

    // Mock global fetch for each test
    const mockFetchResponse = new Response(JSON.stringify({ data: 'test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse));

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

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ResourceLimitExceededError', () => {
    it('should create error with correct properties', () => {
      const error = new ResourceLimitExceededError(
        'Network limit exceeded',
        'network',
        11,
        10
      );

      expect(error.message).toBe('Network limit exceeded');
      expect(error.name).toBe('ResourceLimitExceededError');
      expect(error.limitType).toBe('network');
      expect(error.current).toBe(11);
      expect(error.limit).toBe(10);
    });

    it('should work with filesystem limit type', () => {
      const error = new ResourceLimitExceededError(
        'Filesystem limit exceeded',
        'filesystem',
        21,
        20
      );

      expect(error.limitType).toBe('filesystem');
      expect(error.current).toBe(21);
      expect(error.limit).toBe(20);
    });
  });

  describe('createNetworkInterceptor', () => {
    it('should create a wrapped fetch function', () => {
      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      expect(typeof wrappedFetch).toBe('function');
    });

    it('should allow requests under limit', async () => {
      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      const response = await wrappedFetch('https://api.example.com/data');

      expect(response).toBeDefined();
      expect(mockStateProvider.incrementNetworkRequests).toHaveBeenCalledWith(
        'exec-123',
        10
      );
    });

    it('should reject requests when limit exceeded', async () => {
      mockStateProvider.incrementNetworkRequests = vi.fn().mockResolvedValue({
        allowed: false,
        current: 10,
      });

      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      await expect(wrappedFetch('https://api.example.com/data')).rejects.toThrow(
        ResourceLimitExceededError
      );
    });

    it('should reject when already aborted', async () => {
      abortController.abort();

      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      await expect(wrappedFetch('https://api.example.com/data')).rejects.toThrow(
        ResourceLimitExceededError
      );
    });

    it('should work with no network limit', async () => {
      const limitsNoNetwork: ResourceLimits = {
        ...defaultLimits,
        maxNetworkRequests: undefined,
      };

      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        limitsNoNetwork,
        mockStateProvider,
        abortController.signal
      );

      const response = await wrappedFetch('https://api.example.com/data');

      expect(response).toBeDefined();
      // Should not check limits when undefined
      expect(mockStateProvider.incrementNetworkRequests).not.toHaveBeenCalled();
    });

    it('should pass request options through', async () => {
      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      await wrappedFetch('https://api.example.com/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  describe('createFileSystemInterceptors', () => {
    it('should create wrapped fs functions', () => {
      const wrappedFs = createFileSystemInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      expect(wrappedFs.readFile).toBeDefined();
      expect(wrappedFs.writeFile).toBeDefined();
      expect(wrappedFs.appendFile).toBeDefined();
      expect(wrappedFs.unlink).toBeDefined();
      expect(wrappedFs.mkdir).toBeDefined();
      expect(wrappedFs.rmdir).toBeDefined();
      expect(wrappedFs.readdir).toBeDefined();
      expect(wrappedFs.stat).toBeDefined();
      expect(wrappedFs.access).toBeDefined();
      expect(wrappedFs.rename).toBeDefined();
      expect(wrappedFs.copyFile).toBeDefined();
    });

    it('should reject when limit exceeded', async () => {
      mockStateProvider.incrementFileSystemOps = vi.fn().mockResolvedValue({
        allowed: false,
        current: 20,
      });

      const wrappedFs = createFileSystemInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      // Using stat as it's least likely to cause side effects
      await expect(wrappedFs.stat('/some/path')).rejects.toThrow(
        ResourceLimitExceededError
      );
    });

    it('should reject when already aborted', async () => {
      abortController.abort();

      const wrappedFs = createFileSystemInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      await expect(wrappedFs.stat('/some/path')).rejects.toThrow(
        ResourceLimitExceededError
      );
    });

    it('should track each operation', async () => {
      const wrappedFs = createFileSystemInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      // These will fail because paths don't exist, but should still track
      try {
        await wrappedFs.stat('/nonexistent/path1');
      } catch {
        // Expected - path doesn't exist
      }

      try {
        await wrappedFs.stat('/nonexistent/path2');
      } catch {
        // Expected - path doesn't exist
      }

      expect(mockStateProvider.incrementFileSystemOps).toHaveBeenCalledTimes(2);
    });

    it('should work with no filesystem limit', async () => {
      const limitsNoFs: ResourceLimits = {
        ...defaultLimits,
        maxFileSystemOps: undefined,
      };

      const wrappedFs = createFileSystemInterceptors(
        'exec-123',
        limitsNoFs,
        mockStateProvider,
        abortController.signal
      );

      try {
        await wrappedFs.stat('/nonexistent/path');
      } catch {
        // Expected - path doesn't exist
      }

      // Should not check limits when undefined
      expect(mockStateProvider.incrementFileSystemOps).not.toHaveBeenCalled();
    });
  });

  describe('createExecutionInterceptors', () => {
    it('should create all interceptors', () => {
      const interceptors = createExecutionInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      expect(interceptors.fetch).toBeDefined();
      expect(interceptors.fs).toBeDefined();
      expect(interceptors.signal).toBe(abortController.signal);
    });

    it('should use same abort signal for all interceptors', () => {
      const interceptors = createExecutionInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      abortController.abort();

      expect(interceptors.signal.aborted).toBe(true);
    });
  });

  describe('error details', () => {
    it('should include current count and limit in network error', async () => {
      mockStateProvider.incrementNetworkRequests = vi.fn().mockResolvedValue({
        allowed: false,
        current: 15,
      });

      const wrappedFetch = createNetworkInterceptor(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      try {
        await wrappedFetch('https://api.example.com/data');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceLimitExceededError);
        const rlError = error as ResourceLimitExceededError;
        expect(rlError.current).toBe(15);
        expect(rlError.limit).toBe(10);
        expect(rlError.limitType).toBe('network');
      }
    });

    it('should include current count and limit in filesystem error', async () => {
      mockStateProvider.incrementFileSystemOps = vi.fn().mockResolvedValue({
        allowed: false,
        current: 25,
      });

      const wrappedFs = createFileSystemInterceptors(
        'exec-123',
        defaultLimits,
        mockStateProvider,
        abortController.signal
      );

      try {
        await wrappedFs.stat('/some/path');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceLimitExceededError);
        const rlError = error as ResourceLimitExceededError;
        expect(rlError.current).toBe(25);
        expect(rlError.limit).toBe(20);
        expect(rlError.limitType).toBe('filesystem');
      }
    });
  });
});
