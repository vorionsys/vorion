/**
 * MemoryQueueAdapter Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryQueueAdapter,
  createMemoryQueueAdapter,
} from '../../../src/common/adapters/memory-queue.js';
import type { Job } from '../../../src/common/adapters/types.js';

// Mock logger
vi.mock('../../../src/common/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('MemoryQueueAdapter', () => {
  let queue: MemoryQueueAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new MemoryQueueAdapter('test-queue');
  });

  afterEach(async () => {
    await queue.close();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create a queue with name', () => {
      const adapter = new MemoryQueueAdapter('my-queue');
      expect(adapter).toBeInstanceOf(MemoryQueueAdapter);
    });

    it('should create queue via factory function', () => {
      const adapter = createMemoryQueueAdapter('factory-queue');
      expect(adapter).toBeDefined();
    });
  });

  describe('add', () => {
    it('should add a job to the queue', async () => {
      const jobId = await queue.add('testJob', { data: 'value' });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
    });

    it('should add job with custom jobId', async () => {
      const customId = 'my-custom-id';
      const jobId = await queue.add('testJob', { data: 'value' }, { jobId: customId });

      expect(jobId).toBe(customId);
    });

    it('should add job with delay', async () => {
      await queue.add('testJob', { data: 'value' }, { delay: 5000 });

      const counts = await queue.getJobCounts();
      expect(counts.delayed).toBe(1);
      expect(counts.waiting).toBe(0);
    });

    it('should throw when queue is closed', async () => {
      await queue.close();

      await expect(queue.add('testJob', { data: 'value' })).rejects.toThrow('Queue is closed');
    });

    it('should add multiple jobs', async () => {
      await queue.add('job1', { value: 1 });
      await queue.add('job2', { value: 2 });
      await queue.add('job3', { value: 3 });

      const counts = await queue.getJobCounts();
      expect(counts.waiting).toBe(3);
    });
  });

  describe('process', () => {
    it('should process a job', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);

      await queue.add('testJob', { value: 'test' });

      // Allow processing to occur
      await vi.advanceTimersByTimeAsync(10);

      expect(handler).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { value: 'test' },
          attemptsMade: 1,
        })
      );
    });

    it('should process jobs in order by priority', async () => {
      const processedJobs: number[] = [];
      const handler = vi.fn().mockImplementation(async (job: Job<{ priority: number }>) => {
        processedJobs.push(job.data.priority);
      });

      queue.process(handler);

      await queue.add('job1', { priority: 3 }, { priority: 3 });
      await queue.add('job2', { priority: 1 }, { priority: 1 });
      await queue.add('job3', { priority: 2 }, { priority: 2 });

      // Process all jobs
      await vi.advanceTimersByTimeAsync(100);

      expect(processedJobs).toEqual([1, 2, 3]);
    });

    it('should mark job as completed on success', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);

      await queue.add('testJob', { value: 'test' });

      await vi.advanceTimersByTimeAsync(10);

      const counts = await queue.getJobCounts();
      expect(counts.completed).toBe(1);
      expect(counts.waiting).toBe(0);
    });

    it('should retry failed jobs with exponential backoff', async () => {
      let attempts = 0;
      const handler = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Test error');
        }
      });

      queue.process(handler);

      await queue.add('testJob', { value: 'test' }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 100 },
      });

      // First attempt (fails)
      await vi.advanceTimersByTimeAsync(10);
      expect(attempts).toBe(1);

      // Wait for first retry (100ms backoff)
      await vi.advanceTimersByTimeAsync(150);
      expect(attempts).toBe(2);

      // Wait for second retry (200ms backoff)
      await vi.advanceTimersByTimeAsync(250);
      expect(attempts).toBe(3);

      const counts = await queue.getJobCounts();
      expect(counts.completed).toBe(1);
    });

    it('should retry failed jobs with fixed backoff', async () => {
      let attempts = 0;
      const handler = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Test error');
        }
      });

      queue.process(handler);

      await queue.add('testJob', { value: 'test' }, {
        attempts: 3,
        backoff: { type: 'fixed', delay: 100 },
      });

      // First attempt (fails)
      await vi.advanceTimersByTimeAsync(10);
      expect(attempts).toBe(1);

      // Wait for retry (fixed 100ms backoff)
      await vi.advanceTimersByTimeAsync(150);
      expect(attempts).toBe(2);
    });

    it('should mark job as failed after max retries', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Always fails'));
      queue.process(handler);

      await queue.add('testJob', { value: 'test' }, { attempts: 2 });

      // Process all attempts
      await vi.advanceTimersByTimeAsync(5000);

      const counts = await queue.getJobCounts();
      expect(counts.failed).toBe(1);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should handle non-Error throws', async () => {
      const handler = vi.fn().mockRejectedValue('string error');
      queue.process(handler);

      await queue.add('testJob', { value: 'test' }, { attempts: 1 });

      await vi.advanceTimersByTimeAsync(100);

      const counts = await queue.getJobCounts();
      expect(counts.failed).toBe(1);
    });
  });

  describe('getJobCounts', () => {
    it('should return correct counts for empty queue', async () => {
      const counts = await queue.getJobCounts();

      expect(counts).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });
    });

    it('should return correct counts for waiting jobs', async () => {
      await queue.add('job1', {});
      await queue.add('job2', {});

      const counts = await queue.getJobCounts();
      expect(counts.waiting).toBe(2);
    });

    it('should return correct counts for delayed jobs', async () => {
      await queue.add('job1', {}, { delay: 5000 });
      await queue.add('job2', {}, { delay: 10000 });

      const counts = await queue.getJobCounts();
      expect(counts.delayed).toBe(2);
    });

    it('should move delayed jobs to waiting when delay passes', async () => {
      await queue.add('job1', {}, { delay: 1000 });

      // Initially delayed
      let counts = await queue.getJobCounts();
      expect(counts.delayed).toBe(1);
      expect(counts.waiting).toBe(0);

      // Advance time past delay
      vi.advanceTimersByTime(1500);

      // Now add a waiting job to trigger processing
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);
      await queue.add('immediate-job', {});

      // Processing should handle both jobs
      await vi.advanceTimersByTimeAsync(100);

      // Both jobs should be processed (the delayed one is now ready)
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('close', () => {
    it('should close the queue', async () => {
      await queue.close();

      await expect(queue.add('testJob', {})).rejects.toThrow('Queue is closed');
    });

    it('should wait for active jobs to complete', async () => {
      let jobCompleted = false;
      const handler = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        jobCompleted = true;
      });

      queue.process(handler);
      await queue.add('testJob', {});

      // Start processing
      await vi.advanceTimersByTimeAsync(10);

      // Close queue (should wait for active job)
      const closePromise = queue.close();

      // Complete the job
      await vi.advanceTimersByTimeAsync(200);

      await closePromise;
      expect(jobCompleted).toBe(true);
    });

    it('should be safe to close multiple times', async () => {
      await queue.close();
      await expect(queue.close()).resolves.not.toThrow();
    });
  });

  describe('delayed job processing', () => {
    it('should not process delayed jobs until delay passes', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);

      await queue.add('testJob', {}, { delay: 5000 });

      // Process immediately - should not process delayed job
      await vi.advanceTimersByTimeAsync(100);
      expect(handler).not.toHaveBeenCalled();

      // Add an immediate job to verify handler works for non-delayed jobs
      await queue.add('immediateJob', {});
      await vi.advanceTimersByTimeAsync(100);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ data: {} }) // immediate job data
      );
    });

    it('should start as delayed and show in job counts', async () => {
      await queue.add('delayed1', { value: 1 }, { delay: 5000 });
      await queue.add('delayed2', { value: 2 }, { delay: 10000 });

      const counts = await queue.getJobCounts();
      expect(counts.delayed).toBe(2);
      expect(counts.waiting).toBe(0);
    });
  });

  describe('multiple handlers', () => {
    it('should run all registered handlers for each job', async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      queue.process(handler1);
      queue.process(handler2);

      await queue.add('testJob', { value: 'test' });

      await vi.advanceTimersByTimeAsync(10);

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('job data types', () => {
    it('should handle various data types', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);

      // Object
      await queue.add('objectJob', { nested: { value: 123 } });
      await vi.advanceTimersByTimeAsync(10);

      // Array
      await queue.add('arrayJob', [1, 2, 3]);
      await vi.advanceTimersByTimeAsync(10);

      // Primitive
      await queue.add('stringJob', 'simple string' as any);
      await vi.advanceTimersByTimeAsync(10);

      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe('scheduling behavior', () => {
    it('should not schedule processing when no handlers registered', async () => {
      await queue.add('testJob', {});

      await vi.advanceTimersByTimeAsync(100);

      const counts = await queue.getJobCounts();
      expect(counts.waiting).toBe(1);
    });

    it('should start processing when handler is registered', async () => {
      await queue.add('testJob', {});

      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);

      await vi.advanceTimersByTimeAsync(10);

      expect(handler).toHaveBeenCalled();
    });
  });
});
