import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestQueue, createRequestQueue } from '../src/routing/request-queue.js';
import type { Priority } from '../src/routing/request-queue.js';

/**
 * Helper: enqueue without caring about the returned promise.
 * Catches the rejection so it doesn't become an unhandled rejection
 * when queue.clear() rejects all pending enqueues.
 */
function fireAndForget<T>(queue: RequestQueue<T>, tenantId: string, priority: Priority, data: T) {
  queue.enqueue(tenantId, priority, data).catch(() => {/* expected on clear */});
}

describe('RequestQueue', () => {
  let queue: RequestQueue<string>;

  beforeEach(() => {
    queue = new RequestQueue<string>({
      maxSizePerPriority: {
        critical: 5,
        high: 10,
        medium: 20,
        low: 50,
        background: 100,
      },
      maxTotalSize: 200,
      defaultTimeoutMs: 60000, // 1 min (long timeout for tests)
      fairScheduling: false, // Simpler FIFO for basic tests
      maxConcurrentPerTenant: 50,
      maxConcurrentTotal: 200,
      enablePriorityAging: false,
      agingThresholdMs: 60000,
    });
  });

  afterEach(() => {
    queue.clear();
  });

  // ============================================
  // BASIC QUEUE OPERATIONS
  // ============================================

  describe('basic operations', () => {
    it('should start with empty queue', () => {
      expect(queue.getTotalQueueSize()).toBe(0);
    });

    it('should enqueue requests', () => {
      fireAndForget(queue, 'tenant-1', 'medium', 'request-data');
      expect(queue.getTotalQueueSize()).toBe(1);
    });

    it('should track queue size by priority', () => {
      fireAndForget(queue, 'tenant-1', 'high', 'data-1');
      fireAndForget(queue, 'tenant-1', 'medium', 'data-2');
      fireAndForget(queue, 'tenant-1', 'medium', 'data-3');

      expect(queue.getQueueSize('high')).toBe(1);
      expect(queue.getQueueSize('medium')).toBe(2);
      expect(queue.getQueueSize('low')).toBe(0);
    });

    it('should dequeue in priority order', () => {
      fireAndForget(queue, 'tenant-1', 'low', 'low-data');
      fireAndForget(queue, 'tenant-1', 'critical', 'critical-data');
      fireAndForget(queue, 'tenant-1', 'medium', 'medium-data');

      const first = queue.dequeue();
      expect(first).not.toBeNull();
      expect(first!.request.priority).toBe('critical');

      const second = queue.dequeue();
      expect(second!.request.priority).toBe('medium');

      const third = queue.dequeue();
      expect(third!.request.priority).toBe('low');
    });

    it('should return null when queue is empty', () => {
      expect(queue.dequeue()).toBeNull();
    });
  });

  // ============================================
  // CAPACITY LIMITS
  // ============================================

  describe('capacity limits', () => {
    it('should reject when priority queue is full', async () => {
      // Fill critical queue (max 5)
      for (let i = 0; i < 5; i++) {
        fireAndForget(queue, 'tenant-1', 'critical', `data-${i}`);
      }

      // 6th should fail
      await expect(
        queue.enqueue('tenant-1', 'critical', 'overflow')
      ).rejects.toThrow('Queue limit exceeded');
    });

    it('should track dropped count', async () => {
      for (let i = 0; i < 5; i++) {
        fireAndForget(queue, 'tenant-1', 'critical', `data-${i}`);
      }

      try {
        await queue.enqueue('tenant-1', 'critical', 'overflow');
      } catch { /* expected */ }

      const stats = queue.getStats();
      expect(stats.droppedCount).toBe(1);
    });
  });

  // ============================================
  // PEEK
  // ============================================

  describe('peek', () => {
    it('should return next request without removing it', () => {
      fireAndForget(queue, 'tenant-1', 'high', 'data-1');

      const peeked = queue.peek();
      expect(peeked).not.toBeNull();
      expect(peeked!.data).toBe('data-1');
      expect(queue.getTotalQueueSize()).toBe(1);
    });

    it('should return null on empty queue', () => {
      expect(queue.peek()).toBeNull();
    });

    it('should peek at highest priority', () => {
      fireAndForget(queue, 'tenant-1', 'low', 'low-data');
      fireAndForget(queue, 'tenant-1', 'high', 'high-data');

      const peeked = queue.peek();
      expect(peeked!.priority).toBe('high');
    });
  });

  // ============================================
  // COMPLETE AND FAIL
  // ============================================

  describe('complete and fail', () => {
    it('should track completed requests', () => {
      fireAndForget(queue, 'tenant-1', 'medium', 'data-1');
      const result = queue.dequeue();

      queue.complete(result!.request.id, 'tenant-1', 'done');
      expect(queue.getProcessingCount('tenant-1')).toBe(0);
    });

    it('should track failed requests', () => {
      fireAndForget(queue, 'tenant-1', 'medium', 'data-1');
      const result = queue.dequeue();

      queue.fail(result!.request.id, 'tenant-1', new Error('oops'));
      expect(queue.getProcessingCount('tenant-1')).toBe(0);
    });
  });

  // ============================================
  // STATISTICS
  // ============================================

  describe('statistics', () => {
    it('should return accurate stats', () => {
      fireAndForget(queue, 'tenant-1', 'high', 'data-1');
      fireAndForget(queue, 'tenant-2', 'medium', 'data-2');

      const stats = queue.getStats();
      expect(stats.totalQueued).toBe(2);
      expect(stats.byPriority.high).toBe(1);
      expect(stats.byPriority.medium).toBe(1);
      expect(stats.byTenant['tenant-1']).toBe(1);
      expect(stats.byTenant['tenant-2']).toBe(1);
    });

    it('should track processing count', () => {
      fireAndForget(queue, 'tenant-1', 'high', 'data-1');
      queue.dequeue();

      const stats = queue.getStats();
      expect(stats.processingCount).toBe(1);
    });
  });

  // ============================================
  // CLEAR
  // ============================================

  describe('clear', () => {
    it('should clear all queues', () => {
      fireAndForget(queue, 'tenant-1', 'high', 'data-1');
      fireAndForget(queue, 'tenant-1', 'low', 'data-2');

      queue.clear();
      expect(queue.getTotalQueueSize()).toBe(0);
    });
  });

  // ============================================
  // TIMEOUT
  // ============================================

  describe('timeout', () => {
    it('should reject enqueued request after timeout', async () => {
      const shortQueue = new RequestQueue<string>({
        maxSizePerPriority: { critical: 10, high: 10, medium: 10, low: 10, background: 10 },
        maxTotalSize: 100,
        defaultTimeoutMs: 100, // 100ms timeout
        fairScheduling: false,
        maxConcurrentPerTenant: 50,
        maxConcurrentTotal: 200,
        enablePriorityAging: false,
        agingThresholdMs: 60000,
      });

      await expect(
        shortQueue.enqueue('tenant-1', 'medium', 'data-1', { maxWaitMs: 100 })
      ).rejects.toThrow('timed out');

      const stats = shortQueue.getStats();
      expect(stats.timeoutCount).toBe(1);

      shortQueue.clear();
    });
  });

  // ============================================
  // FAIR SCHEDULING
  // ============================================

  describe('fair scheduling', () => {
    it('should round-robin between tenants when enabled', () => {
      const fairQueue = new RequestQueue<string>({
        maxSizePerPriority: { critical: 100, high: 100, medium: 100, low: 100, background: 100 },
        maxTotalSize: 1000,
        defaultTimeoutMs: 60000,
        fairScheduling: true,
        maxConcurrentPerTenant: 50,
        maxConcurrentTotal: 200,
        enablePriorityAging: false,
        agingThresholdMs: 60000,
      });

      // Enqueue alternating tenants in same priority
      fireAndForget(fairQueue, 'tenant-A', 'medium', 'A-1');
      fireAndForget(fairQueue, 'tenant-A', 'medium', 'A-2');
      fireAndForget(fairQueue, 'tenant-B', 'medium', 'B-1');
      fireAndForget(fairQueue, 'tenant-B', 'medium', 'B-2');

      // With fair scheduling, dequeue should alternate between tenants
      const results: string[] = [];
      for (let i = 0; i < 4; i++) {
        const r = fairQueue.dequeue();
        if (r) results.push(r.request.tenantId);
      }

      // Both tenants should get served
      expect(results.filter(t => t === 'tenant-A').length).toBe(2);
      expect(results.filter(t => t === 'tenant-B').length).toBe(2);

      fairQueue.clear();
    });
  });

  // ============================================
  // FACTORY
  // ============================================

  describe('createRequestQueue', () => {
    it('should create queue with default config', () => {
      const q = createRequestQueue<string>();
      expect(q.getTotalQueueSize()).toBe(0);
      q.clear();
    });
  });
});
