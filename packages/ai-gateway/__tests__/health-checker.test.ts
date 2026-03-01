import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthChecker, createHealthChecker } from '../src/routing/health-checker.js';
import type { ProviderId, HealthStatus } from '../src/routing/health-checker.js';

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker({
      checkIntervalMs: 30000,
      checkTimeoutMs: 5000,
      unhealthyThreshold: 3,
      recoveryThreshold: 2,
      rateWindowSize: 100,
      enableActiveProbing: false, // Disable auto-probing for tests
      providers: ['anthropic', 'google', 'ollama'],
    });
  });

  afterEach(() => {
    checker.stop();
  });

  // ============================================
  // INITIAL STATE
  // ============================================

  describe('initial state', () => {
    it('should initialize all providers with unknown status', () => {
      const health = checker.getHealth('anthropic');
      expect(health).toBeDefined();
      expect(health!.status).toBe('unknown');
    });

    it('should initialize all configured providers', () => {
      const all = checker.getAllHealth();
      expect(all.size).toBe(3);
      expect(all.has('anthropic')).toBe(true);
      expect(all.has('google')).toBe(true);
      expect(all.has('ollama')).toBe(true);
    });

    it('should return undefined for non-configured providers', () => {
      const health = checker.getHealth('azure');
      expect(health).toBeUndefined();
    });
  });

  // ============================================
  // PASSIVE HEALTH TRACKING
  // ============================================

  describe('passive health tracking', () => {
    it('should mark provider as healthy after successful requests', () => {
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('anthropic', 'claude-3', true, 250);

      const health = checker.getHealth('anthropic');
      expect(health!.status).toBe('healthy');
      expect(health!.consecutiveSuccesses).toBe(2);
    });

    it('should mark provider as unhealthy after consecutive failures', () => {
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'timeout');
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'timeout');
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'timeout');

      const health = checker.getHealth('anthropic');
      expect(health!.status).toBe('unhealthy');
      expect(health!.consecutiveFailures).toBe(3);
    });

    it('should mark provider as degraded on single failure', () => {
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'timeout');

      const health = checker.getHealth('anthropic');
      expect(health!.status).toBe('degraded');
    });

    it('should reset consecutive failures on success', () => {
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'timeout');
      checker.recordRequest('anthropic', 'claude-3', true, 200);

      const health = checker.getHealth('anthropic');
      expect(health!.consecutiveFailures).toBe(0);
      expect(health!.consecutiveSuccesses).toBe(1);
    });

    it('should track success rate', () => {
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'err');

      const health = checker.getHealth('anthropic');
      // 2 out of 3 = ~66.7%
      expect(health!.successRate).toBeCloseTo(66.67, 0);
    });

    it('should track error types', () => {
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'timeout');
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'rate limit');

      const health = checker.getHealth('anthropic');
      expect(health!.errorCounts['timeout']).toBe(1);
      expect(health!.errorCounts['rate_limit']).toBe(1);
    });

    it('should track model-specific health', () => {
      checker.recordRequest('anthropic', 'claude-3-opus', true, 200);
      checker.recordRequest('anthropic', 'claude-3-haiku', false, 500, 'error');

      const health = checker.getHealth('anthropic');
      const opusHealth = health!.models.get('claude-3-opus');
      const haikuHealth = health!.models.get('claude-3-haiku');

      expect(opusHealth!.status).toBe('healthy');
      expect(haikuHealth!.status).toBe('unhealthy');
    });
  });

  // ============================================
  // AVAILABILITY
  // ============================================

  describe('availability', () => {
    it('should report healthy providers as available', () => {
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      expect(checker.isAvailable('anthropic')).toBe(true);
    });

    it('should report degraded providers as available', () => {
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'err');
      expect(checker.isAvailable('anthropic')).toBe(true);
    });

    it('should report unhealthy providers as unavailable', () => {
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'err');
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'err');
      checker.recordRequest('anthropic', 'claude-3', false, 500, 'err');
      expect(checker.isAvailable('anthropic')).toBe(false);
    });

    it('should report non-configured providers as unavailable', () => {
      expect(checker.isAvailable('azure')).toBe(false);
    });
  });

  // ============================================
  // AVAILABLE PROVIDERS SORTING
  // ============================================

  describe('getAvailableProviders', () => {
    it('should return healthy providers sorted by latency', () => {
      checker.recordRequest('anthropic', 'claude-3', true, 300);
      checker.recordRequest('anthropic', 'claude-3', true, 300);
      checker.recordRequest('google', 'gemini', true, 150);
      checker.recordRequest('google', 'gemini', true, 150);

      const providers = checker.getAvailableProviders();
      expect(providers[0]).toBe('google'); // lower latency
      expect(providers[1]).toBe('anthropic');
    });

    it('should exclude unhealthy providers', () => {
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('google', 'gemini', false, 500, 'err');
      checker.recordRequest('google', 'gemini', false, 500, 'err');
      checker.recordRequest('google', 'gemini', false, 500, 'err');

      const providers = checker.getAvailableProviders();
      expect(providers).toContain('anthropic');
      expect(providers).not.toContain('google');
    });
  });

  // ============================================
  // LISTENERS
  // ============================================

  describe('listeners', () => {
    it('should notify listeners on health change', () => {
      const listener = vi.fn();
      checker.onHealthChange(listener);

      checker.recordRequest('anthropic', 'claude-3', true, 200);
      expect(listener).toHaveBeenCalledWith('anthropic', expect.objectContaining({
        provider: 'anthropic',
      }));
    });

    it('should allow removing listeners', () => {
      const listener = vi.fn();
      const remove = checker.onHealthChange(listener);
      remove();

      checker.recordRequest('anthropic', 'claude-3', true, 200);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // SUMMARY
  // ============================================

  describe('getSummary', () => {
    it('should return summary of all providers', () => {
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('anthropic', 'claude-3', true, 200);
      checker.recordRequest('google', 'gemini', false, 500, 'err');
      checker.recordRequest('google', 'gemini', false, 500, 'err');
      checker.recordRequest('google', 'gemini', false, 500, 'err');

      const summary = checker.getSummary();
      expect(summary.healthyCount).toBe(1);
      expect(summary.unhealthyCount).toBe(1);
      expect(summary.availableCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================
  // FACTORY
  // ============================================

  describe('createHealthChecker', () => {
    it('should create checker with custom config', () => {
      const custom = createHealthChecker({
        providers: ['openai'],
        enableActiveProbing: false,
      });
      const health = custom.getHealth('openai');
      expect(health).toBeDefined();
    });
  });
});
