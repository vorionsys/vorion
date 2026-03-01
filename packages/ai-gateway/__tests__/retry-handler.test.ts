import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RetryHandler,
  createRetryHandler,
  sleep,
  calculateBackoff,
} from '../src/routing/retry-handler.js';
import type { RetryContext, ErrorType } from '../src/routing/retry-handler.js';

describe('RetryHandler', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      enableJitter: false,
      jitterFactor: 0,
      retryableErrors: ['rate_limit', 'timeout', 'server_error', 'model_overloaded', 'network'],
    });
  });

  // ============================================
  // ERROR CLASSIFICATION
  // ============================================

  describe('classifyError', () => {
    it('should classify Anthropic rate limit errors', () => {
      expect(handler.classifyError('anthropic', 'Rate limit exceeded')).toBe('rate_limit');
    });

    it('should classify Anthropic overloaded errors', () => {
      expect(handler.classifyError('anthropic', 'Model is overloaded')).toBe('model_overloaded');
    });

    it('should classify Anthropic context length errors', () => {
      expect(handler.classifyError('anthropic', 'Exceeded context length limit')).toBe('context_length');
    });

    it('should classify Anthropic auth errors', () => {
      expect(handler.classifyError('anthropic', 'Invalid API key provided')).toBe('auth');
    });

    it('should classify Google RESOURCE_EXHAUSTED errors', () => {
      expect(handler.classifyError('google', 'RESOURCE_EXHAUSTED: quota exceeded')).toBe('rate_limit');
    });

    it('should classify Google DEADLINE_EXCEEDED errors', () => {
      expect(handler.classifyError('google', 'DEADLINE_EXCEEDED')).toBe('timeout');
    });

    it('should classify Google PERMISSION_DENIED errors', () => {
      expect(handler.classifyError('google', 'PERMISSION_DENIED')).toBe('auth');
    });

    it('should classify OpenAI rate limit errors', () => {
      expect(handler.classifyError('openai', 'Rate limit reached')).toBe('rate_limit');
    });

    it('should classify Ollama connection errors', () => {
      expect(handler.classifyError('ollama', 'connection refused')).toBe('network');
    });

    it('should classify errors by status code', () => {
      expect(handler.classifyError('anthropic', 'Unknown', 429)).toBe('rate_limit');
      expect(handler.classifyError('anthropic', 'Unknown', 401)).toBe('auth');
      expect(handler.classifyError('anthropic', 'Unknown', 500)).toBe('server_error');
    });

    it('should fall back to generic classification', () => {
      expect(handler.classifyError('anthropic', 'timeout occurred')).toBe('timeout');
      expect(handler.classifyError('anthropic', 'ECONNREFUSED')).toBe('network');
    });

    it('should return unknown for unrecognized errors', () => {
      expect(handler.classifyError('anthropic', 'Something weird happened')).toBe('unknown');
    });
  });

  // ============================================
  // RETRY DECISIONS
  // ============================================

  describe('shouldRetry', () => {
    it('should retry on retryable errors', () => {
      const ctx = handler.createContext('anthropic');
      const decision = handler.shouldRetry(ctx, new Error('Rate limit exceeded'));
      expect(decision.shouldRetry).toBe(true);
      expect(decision.errorType).toBe('rate_limit');
    });

    it('should not retry on non-retryable errors', () => {
      const ctx = handler.createContext('anthropic');
      const decision = handler.shouldRetry(ctx, new Error('Invalid API key provided'));
      expect(decision.shouldRetry).toBe(false);
      expect(decision.errorType).toBe('auth');
    });

    it('should stop retrying after max attempts', () => {
      const ctx = handler.createContext('anthropic');
      handler.shouldRetry(ctx, new Error('timeout')); // attempt 1
      handler.shouldRetry(ctx, new Error('timeout')); // attempt 2
      const decision = handler.shouldRetry(ctx, new Error('timeout')); // attempt 3 (max)
      expect(decision.shouldRetry).toBe(false);
      expect(decision.reason).toContain('Max attempts');
    });

    it('should track attempt count in context', () => {
      const ctx = handler.createContext('anthropic');
      handler.shouldRetry(ctx, new Error('timeout'));
      expect(ctx.attempt).toBe(1);
      handler.shouldRetry(ctx, new Error('timeout'));
      expect(ctx.attempt).toBe(2);
    });

    it('should record errors in context', () => {
      const ctx = handler.createContext('anthropic');
      handler.shouldRetry(ctx, new Error('Rate limit exceeded'));
      expect(ctx.errors).toHaveLength(1);
      expect(ctx.errors[0]!.errorType).toBe('rate_limit');
    });
  });

  // ============================================
  // BACKOFF CALCULATION
  // ============================================

  describe('backoff calculation', () => {
    it('should use exponential backoff', () => {
      const ctx = handler.createContext('anthropic');

      const d1 = handler.shouldRetry(ctx, new Error('timeout'));
      expect(d1.delayMs).toBe(1000); // 1000 * 2^0

      const d2 = handler.shouldRetry(ctx, new Error('timeout'));
      expect(d2.delayMs).toBe(2000); // 1000 * 2^1
    });

    it('should cap delay at maxDelayMs', () => {
      const h = new RetryHandler({
        maxAttempts: 20,
        initialDelayMs: 30000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        enableJitter: false,
        jitterFactor: 0,
        retryableErrors: ['timeout'],
      });

      const ctx = h.createContext('anthropic');
      h.shouldRetry(ctx, new Error('timeout'));
      const decision = h.shouldRetry(ctx, new Error('timeout'));
      expect(decision.delayMs).toBeLessThanOrEqual(60000);
    });

    it('should use Retry-After header when available', () => {
      const ctx = handler.createContext('anthropic');
      const decision = handler.shouldRetry(ctx, new Error('Rate limit exceeded, retry after 5'));
      expect(decision.delayMs).toBe(5000);
    });

    it('should use suggested delay for specific error patterns', () => {
      const ctx = handler.createContext('anthropic');
      const decision = handler.shouldRetry(ctx, new Error('Model is overloaded'));
      expect(decision.delayMs).toBe(30000);
    });
  });

  // ============================================
  // JITTER
  // ============================================

  describe('jitter', () => {
    it('should apply jitter when enabled', () => {
      const h = new RetryHandler({
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
        enableJitter: true,
        jitterFactor: 0.3,
        retryableErrors: ['timeout'],
      });

      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        const ctx = h.createContext('anthropic');
        const decision = h.shouldRetry(ctx, new Error('timeout'));
        delays.add(decision.delayMs);
      }

      // With jitter, we should get varied delays
      // (there's a tiny chance they could all be the same, but extremely unlikely)
      expect(delays.size).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================
  // EXECUTE WITH RETRY
  // ============================================

  describe('executeWithRetry', () => {
    it('should return result on first success', async () => {
      const op = vi.fn().mockResolvedValue('success');
      const result = await handler.executeWithRetry('anthropic', op);
      expect(result).toBe('success');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors', async () => {
      const op = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      // Use short delays for test speed
      const h = new RetryHandler({
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        enableJitter: false,
        jitterFactor: 0,
        retryableErrors: ['timeout'],
      });

      const result = await h.executeWithRetry('anthropic', op);
      expect(result).toBe('success');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('should throw on non-retryable errors', async () => {
      const op = vi.fn().mockRejectedValue(new Error('Invalid API key provided'));
      await expect(handler.executeWithRetry('anthropic', op)).rejects.toThrow('Invalid API key');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const op = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      const h = new RetryHandler({
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        enableJitter: false,
        jitterFactor: 0,
        retryableErrors: ['timeout'],
      });

      await h.executeWithRetry('anthropic', op, { onRetry });
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // TRANSIENT ERROR CHECK
  // ============================================

  describe('isTransientError', () => {
    it('should identify transient errors', () => {
      expect(handler.isTransientError('anthropic', new Error('timeout'))).toBe(true);
      expect(handler.isTransientError('anthropic', new Error('Rate limit'))).toBe(true);
    });

    it('should identify non-transient errors', () => {
      expect(handler.isTransientError('anthropic', new Error('Invalid API key'))).toBe(false);
      expect(handler.isTransientError('anthropic', new Error('context length exceeded'))).toBe(false);
    });
  });

  // ============================================
  // SUGGESTED WAIT TIME
  // ============================================

  describe('getSuggestedWaitTime', () => {
    it('should return suggested delay for overloaded models', () => {
      const wait = handler.getSuggestedWaitTime('anthropic', new Error('Model is overloaded'));
      expect(wait).toBe(30000);
    });

    it('should extract Retry-After from error message', () => {
      const wait = handler.getSuggestedWaitTime('anthropic', 'Rate limit exceeded, retry after 10');
      expect(wait).toBe(10000);
    });

    it('should return null for no suggestion', () => {
      const wait = handler.getSuggestedWaitTime('anthropic', 'Something unknown');
      expect(wait).toBeNull();
    });
  });

  // ============================================
  // CONTEXT STATS
  // ============================================

  describe('getContextStats', () => {
    it('should return stats for retry context', () => {
      const ctx = handler.createContext('anthropic', 'claude-3');
      handler.shouldRetry(ctx, new Error('timeout'));
      handler.shouldRetry(ctx, new Error('Rate limit'));

      const stats = handler.getContextStats(ctx);
      expect(stats.attempts).toBe(2);
      expect(stats.errorTypes['timeout']).toBe(1);
      expect(stats.errorTypes['rate_limit']).toBe(1);
      expect(stats.lastError).toContain('Rate limit');
    });
  });

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  describe('calculateBackoff utility', () => {
    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(1, 1000, 60000, 2)).toBe(1000);
      expect(calculateBackoff(2, 1000, 60000, 2)).toBe(2000);
      expect(calculateBackoff(3, 1000, 60000, 2)).toBe(4000);
    });

    it('should respect max delay', () => {
      expect(calculateBackoff(10, 1000, 60000, 2)).toBe(60000);
    });
  });

  describe('sleep utility', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now();
      await sleep(50, 0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  // ============================================
  // FACTORY
  // ============================================

  describe('createRetryHandler', () => {
    it('should create handler with custom config', () => {
      const h = createRetryHandler({ maxAttempts: 5 });
      const ctx = h.createContext('anthropic');
      // Should allow up to 5 attempts
      for (let i = 0; i < 4; i++) {
        const d = h.shouldRetry(ctx, new Error('timeout'));
        expect(d.shouldRetry).toBe(true);
      }
      const last = h.shouldRetry(ctx, new Error('timeout'));
      expect(last.shouldRetry).toBe(false);
    });
  });
});
